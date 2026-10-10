export const CHECKLIST_CSS = /* css */ `
#fsui .checklist-launch { position:absolute;right:14px;top:14px;pointer-events:auto;padding:7px 12px;border:1px solid #506272;border-radius:7px;background:rgba(10,17,24,.94);color:var(--fg);font:600 12px system-ui; }
#fsui .flight-checklist { position:absolute;right:14px;top:54px;width:326px;max-width:calc(100vw - 28px);max-height:calc(100vh - 160px);pointer-events:auto;display:flex;flex-direction:column;gap:7px;padding:10px;border:1px solid #506272;border-radius:9px;background:rgba(10,17,24,.96);color:var(--fg);font:13px/1.35 system-ui;box-shadow:0 6px 24px #0005; }
#fsui .flight-checklist button,#fsui .flight-checklist select { border:1px solid #4a5968;border-radius:5px;background:#1b2835;color:var(--fg);padding:5px 7px;font:inherit; }
#fsui .flight-checklist button:disabled { opacity:.4; }
#fsui .flight-checklist button[aria-pressed=true] { border-color:var(--accent);color:var(--accent); }
#fsui .checklist-head,#fsui .checklist-tabs,#fsui .checklist-nav,#fsui .checklist-foot { display:flex;justify-content:space-between;align-items:center;gap:6px; }
#fsui .checklist-head button { line-height:1;font-size:18px; }
#fsui .checklist-tabs button { flex:1; }
#fsui .checklist-note { color:#bac9d6;font-size:11px;max-height:76px;overflow:auto; }
#fsui .checklist-items { max-height:31vh;min-height:42px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin; }
#fsui .checklist-item { display:flex;gap:7px;align-items:flex-start;padding:7px 4px;border:1px solid transparent;border-bottom-color:#ffffff12;cursor:pointer; }
#fsui .checklist-item input { flex:none;width:15px;height:15px;margin:2px 0;accent-color:#9aa8b6; }
#fsui .checklist-item.automatic input { accent-color:#52c3ff; }
#fsui .checklist-item > span { flex:1;min-width:0; }
#fsui .checklist-item b,#fsui .checklist-item span span { display:block; }
#fsui .checklist-item span span { color:#cad5df;font-size:12px; }
#fsui .checklist-item small { font-size:9px;color:#bdc6cf;margin-top:3px; }
#fsui .checklist-item.automatic small { color:#52c3ff; }
#fsui .checklist-item.current { background:#52c3ff15;border-color:#52c3ff66;border-radius:5px; }
#fsui .checklist-item.done b { color:#a8d8c5; }
#fsui .checklist-foot,#fsui .checklist-source { font-size:10px;color:#bac9d6; }
#fsui .checklist-source a { color:#9edcff; }
#fsui .checklist-foot button { white-space:nowrap;font-size:10px; }
#fsui button:focus-visible,#fsui select:focus-visible,#fsui input:focus-visible { outline:2px solid var(--accent);outline-offset:2px; }
@media (max-height:700px) { #fsui .flight-checklist { top:42px;gap:4px; } #fsui .checklist-items { max-height:26vh; } }
`;
