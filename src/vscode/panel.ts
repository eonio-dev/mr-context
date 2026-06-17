// src/vscode/panel.ts
import * as vscode from "vscode";
import type { MrcAgent } from "../agent/agent.js";
import type { SkillName } from "../agent/skills.js";

function nonce(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function panelHtml(n: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);
         color:var(--vscode-foreground);background:var(--vscode-editor-background);
         display:flex;flex-direction:column;height:100vh;overflow:hidden}
    #hdr{padding:8px 12px;border-bottom:1px solid var(--vscode-widget-border);
         font-size:11px;color:var(--vscode-descriptionForeground);
         display:flex;align-items:center;gap:8px}
    #hdr strong{color:var(--vscode-foreground)}
    #msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
    .msg{max-width:100%;line-height:1.55;word-break:break-word}
    .user{color:var(--vscode-textLink-foreground);font-weight:600}
    .assistant{white-space:pre-wrap}
    .error{color:var(--vscode-errorForeground)}
    .thinking{color:var(--vscode-descriptionForeground);font-style:italic}
    #bar{display:flex;gap:6px;padding:8px;
         border-top:1px solid var(--vscode-widget-border)}
    select{background:var(--vscode-dropdown-background);
           color:var(--vscode-dropdown-foreground);
           border:1px solid var(--vscode-dropdown-border);
           padding:4px 6px;border-radius:3px;font-size:11px;flex-shrink:0}
    textarea{flex:1;background:var(--vscode-input-background);
             color:var(--vscode-input-foreground);
             border:1px solid var(--vscode-input-border);
             padding:6px 8px;border-radius:3px;
             font-family:inherit;font-size:inherit;
             resize:none;min-height:34px}
    button{background:var(--vscode-button-background);
           color:var(--vscode-button-foreground);
           border:none;padding:6px 14px;border-radius:3px;
           cursor:pointer;font-size:12px}
    button:hover{background:var(--vscode-button-hoverBackground)}
    button:disabled{opacity:.5;cursor:not-allowed}
  </style>
</head>
<body>
<div id="hdr">
  <strong>Mr. Context</strong>
  <span id="stats">loading…</span>
</div>
<div id="msgs"></div>
<div id="bar">
  <select id="skill">
    <option value="">auto</option>
    <option value="query">query</option>
    <option value="feature">feature</option>
    <option value="review">review</option>
    <option value="onboard">onboard</option>
    <option value="patterns">patterns</option>
  </select>
  <textarea id="inp" rows="1" placeholder="Ask about your codebase…"></textarea>
  <button id="btn">Send</button>
</div>
<script nonce="${n}">
const vsc=acquireVsCodeApi(),
      msgs=document.getElementById('msgs'),
      inp=document.getElementById('inp'),
      btn=document.getElementById('btn'),
      skill=document.getElementById('skill'),
      stats=document.getElementById('stats');
let thinking=null;
function add(cls,text){
  const el=document.createElement('div');
  el.className='msg '+cls;el.textContent=text;
  msgs.appendChild(el);msgs.scrollTop=msgs.scrollHeight;
  return el;
}
function send(){
  const t=inp.value.trim();if(!t)return;
  add('user',t);inp.value='';btn.disabled=true;
  thinking=add('thinking','Mr. Context is thinking…');
  vsc.postMessage({type:'chat',text:t,skill:skill.value||undefined});
}
btn.addEventListener('click',send);
inp.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}
});
window.addEventListener('message',({data:m})=>{
  if(m.type==='chunk'){
    thinking?.remove();thinking=null;
    let last=msgs.lastElementChild;
    if(!last||!last.classList.contains('assistant'))last=add('assistant','');
    last.textContent+=m.value;msgs.scrollTop=msgs.scrollHeight;
  }else if(m.type==='done'){
    btn.disabled=false;
  }else if(m.type==='error'){
    thinking?.remove();thinking=null;
    add('error','Error: '+m.message);btn.disabled=false;
  }else if(m.type==='stats'){
    stats.textContent=m.text;
  }
});
</script>
</body></html>`;
}

export class MrcPanel {
  static current: MrcPanel | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly agent: MrcAgent
  ) {
    panel.webview.html = panelHtml(nonce());
    panel.onDidDispose(() => { MrcPanel.current = undefined; });
    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "chat") await this.handleChat(msg.text, msg.skill);
    });
    this.postStats();
  }

  static show(extensionUri: vscode.Uri, agent: MrcAgent): void {
    if (MrcPanel.current) {
      MrcPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "mrcPanel",
      "Mr. Context",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    MrcPanel.current = new MrcPanel(panel, agent);
  }

  private postStats(): void {
    const graph = this.agent.getGraph();
    if (graph) {
      this.panel.webview.postMessage({
        type: "stats",
        text: `${graph.repositories.length} repos · ${graph.nodes.length} nodes`,
      });
    }
  }

  private async handleChat(text: string, skill?: SkillName): Promise<void> {
    const cts = new vscode.CancellationTokenSource();
    try {
      for await (const chunk of this.agent.chat(text, cts.token, skill)) {
        this.panel.webview.postMessage({ type: "chunk", value: chunk });
      }
      this.panel.webview.postMessage({ type: "done" });
    } catch (err) {
      this.panel.webview.postMessage({
        type: "error",
        message: (err as Error).message,
      });
    } finally {
      cts.dispose();
    }
  }
}
