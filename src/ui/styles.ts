// Stylesheet for the DOM UI, injected once. Everything is scoped under #fsui.

export const UI_CSS = /* css */ `
#fsui {
  --fg: #eef3f8;
  --fg-dim: #9aa8b6;
  --accent: #52c3ff;
  --warn: #ffb224;
  --alert: #ff4d3d;
  --panel: rgba(16, 20, 27, 0.78);
  --panel-solid: #12161d;
  --line: rgba(255, 255, 255, 0.10);
  position: fixed; inset: 0; z-index: 20; pointer-events: none;
  font-family: Inter, "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--fg); font-size: 14px; -webkit-font-smoothing: antialiased; user-select: none;
}
#fsui * { box-sizing: border-box; }
#fsui .hidden { display: none !important; }
#fsui .num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }

/* ---------------- HUD ---------------- */
#fsui .hud { position: absolute; inset: 0; text-shadow: 0 1px 2px rgba(0,0,0,.7); }
#fsui .hud canvas { position: absolute; filter: drop-shadow(0 1px 2px rgba(0,0,0,.55)); }
#fsui .hud .spd { left: 32px; top: calc(50% - 160px); }
#fsui .hud .alt { right: 32px; top: calc(50% - 160px); }
#fsui .hud .hdg { left: calc(50% - 210px); top: 18px; }
#fsui .hud .readout { position: absolute; font-size: 12px; color: var(--fg-dim); letter-spacing: .04em; }
#fsui .hud .readout b { color: var(--fg); font-weight: 600; font-size: 14px; margin-left: 4px; }
#fsui .hud .gs { left: 32px; top: calc(50% + 168px); }
#fsui .hud .agl { right: 32px; top: calc(50% + 168px); text-align: right; min-width: 104px; }
#fsui .hud .vs { right: 146px; top: calc(50% - 12px); text-align: right; }
#fsui .hud .vs b { font-size: 16px; }
#fsui .hud .annunc { position: absolute; top: 74px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; }
#fsui .chip { padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 12px; letter-spacing: .08em;
  background: rgba(0,0,0,.45); border: 1px solid currentColor; text-shadow: none; }
#fsui .chip.warn { color: var(--warn); }
#fsui .chip.alert { color: #fff; background: var(--alert); border-color: var(--alert); animation: fsui-blink .5s steps(2) infinite; }
#fsui .chip.info { color: var(--accent); }
#fsui .chip.ok { color: #6ff0a0; }
@keyframes fsui-blink { 50% { opacity: .35; } }
#fsui .hud .controls { position: absolute; left: 24px; bottom: 22px; display: grid; grid-template-columns: auto 120px auto;
  gap: 5px 10px; align-items: center; padding: 10px 14px; border-radius: 10px; background: rgba(8,12,18,.38);
  backdrop-filter: blur(6px); font-size: 11px; color: var(--fg-dim); letter-spacing: .06em; }
#fsui .hud .controls .v { color: var(--fg); font-size: 12px; font-weight: 600; text-align: right; min-width: 44px; }
/* A twin's two lever sets: tighter rows, so the block stays clear of the GS / LOAD read-outs above it. */
#fsui .hud .controls.compact { gap: 1px 10px; padding: 7px 14px; font-size: 10px; }
#fsui .hud .controls.compact .v { font-size: 11px; }
#fsui .bar { position: relative; height: 6px; border-radius: 3px; background: rgba(255,255,255,.14); overflow: hidden; }
#fsui .bar i { position: absolute; top: 0; bottom: 0; left: 0; background: var(--fg); border-radius: 3px; }
#fsui .bar.mix i { background: #e2463a; }
#fsui .bar.trim i { background: var(--accent); width: 4px; margin-left: -2px; }
#fsui .bar.trim::after { content: ""; position: absolute; left: 50%; top: -2px; bottom: -2px; width: 1px; background: rgba(255,255,255,.5); }
#fsui .hud .wind { position: absolute; right: 24px; bottom: 22px; display: flex; align-items: center; gap: 10px;
  padding: 8px 14px 8px 8px; border-radius: 10px; background: rgba(8,12,18,.38); backdrop-filter: blur(6px); }
#fsui .hud .wind svg { width: 44px; height: 44px; }
#fsui .hud .wind .t { font-size: 11px; color: var(--fg-dim); letter-spacing: .06em; line-height: 1.5; }
#fsui .hud .wind .t b { color: var(--fg); font-size: 13px; }
#fsui .hud .g { position: absolute; left: 32px; top: calc(50% + 190px); font-size: 12px; color: var(--fg-dim); }
#fsui .hud .g b { color: var(--fg); font-size: 14px; margin-left: 4px; }

/* ---------------- Toasts / FPS / badges ---------------- */
#fsui .toasts { position: absolute; left: 50%; bottom: 96px; transform: translateX(-50%); display: flex; flex-direction: column-reverse;
  align-items: center; gap: 8px; }
#fsui .toast { padding: 8px 16px; border-radius: 999px; background: var(--panel); backdrop-filter: blur(10px);
  border: 1px solid var(--line); font-size: 13px; font-weight: 500; box-shadow: 0 6px 24px rgba(0,0,0,.35);
  animation: fsui-in .18s ease-out; transition: opacity .35s, transform .35s; }
#fsui .toast.out { opacity: 0; transform: translateY(6px); }
@keyframes fsui-in { from { opacity: 0; transform: translateY(8px); } }
#fsui .fps { position: absolute; top: 10px; right: 12px; padding: 4px 8px; border-radius: 6px; background: rgba(0,0,0,.55);
  font: 600 11px/1.4 ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: #b9f5c6; white-space: pre; }
/* Below the HUD heading tape (top 18-68 px) and its annunciator row (74 px), so it never covers them. */
#fsui .paused-badge { position: absolute; top: 112px; left: 50%; transform: translateX(-50%); }
#fsui .ap-badge { position: absolute; top: 16px; left: 16px; color: #6ff0a0; background: rgba(0,0,0,.5); white-space: pre; }
/* Annunciators for views without the HUD (cockpit): same place as the HUD's row. */
#fsui .status-annunc { position: absolute; top: 74px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; white-space: nowrap; }
#fsui .status-annunc .chip, #fsui .hud .annunc .chip { background-color: rgba(0,0,0,.55); }
#fsui .status-annunc .chip.alert, #fsui .hud .annunc .chip.alert { background-color: var(--alert); }

/* ---------------- Control-position widget (keyboard / mouse-yoke flying) ---------------- */
#fsui .ctlw { position: absolute; left: 16px; top: 56px; padding: 10px 12px 9px; border-radius: 10px; background: rgba(8,12,18,.5);
  backdrop-filter: blur(6px); opacity: 0; transition: opacity .6s; font-size: 11px; color: var(--fg-dim); letter-spacing: .06em; }
#fsui .ctlw.on { opacity: 1; transition: opacity .15s; }
#fsui .ctlw-top { display: flex; gap: 10px; }
#fsui .ctlw-yoke { position: relative; width: 64px; height: 64px; border-radius: 6px; border: 1px solid rgba(255,255,255,.22);
  background: linear-gradient(rgba(255,255,255,.18), rgba(255,255,255,.18)) center / 1px 100% no-repeat,
              linear-gradient(rgba(255,255,255,.18), rgba(255,255,255,.18)) center / 100% 1px no-repeat; }
#fsui .ctlw-yoke i { position: absolute; left: 27px; top: 27px; width: 10px; height: 10px; border-radius: 50%; background: var(--accent);
  box-shadow: 0 0 6px rgba(82,195,255,.7); }
#fsui .ctlw-trim { position: relative; width: 8px; height: 64px; border-radius: 4px; background: rgba(255,255,255,.14); }
#fsui .ctlw-trim::after { content: ""; position: absolute; left: -3px; right: -3px; top: 50%; height: 1px; background: rgba(255,255,255,.55); }
#fsui .ctlw-trim i { position: absolute; left: -2px; right: -2px; height: 4px; margin-top: -2px; border-radius: 2px; background: #6ff0a0; }
#fsui .ctlw-rud { position: relative; width: 64px; height: 6px; margin-top: 8px; border-radius: 3px; background: rgba(255,255,255,.14); }
#fsui .ctlw-rud::after { content: ""; position: absolute; left: 50%; top: -2px; bottom: -2px; width: 1px; background: rgba(255,255,255,.55); }
#fsui .ctlw-rud i { position: absolute; top: -1px; width: 8px; height: 8px; margin-left: -4px; border-radius: 50%; background: var(--accent); }
#fsui .ctlw-rtrim { position: absolute; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; background: #6ff0a0; }
#fsui .ctlw-eng { margin-top: 8px; }
#fsui .ctlw-sel b { color: var(--fg); font-weight: 600; font-size: 12px; margin-left: 2px; }
#fsui .ctlw-quad { display: flex; gap: 10px; margin-top: 6px; }
#fsui .ctlw-lever { display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 10px; }
#fsui .ctlw-pair { display: flex; gap: 3px; }
#fsui .ctlw-vbar { position: relative; width: 7px; height: 44px; border-radius: 3px; background: rgba(255,255,255,.14); overflow: hidden; }
#fsui .ctlw-vbar i { position: absolute; left: 0; right: 0; bottom: 0; background: var(--fg); }
#fsui .ctlw-vbar.propeller i { background: #4f8fe8; }
#fsui .ctlw-vbar.mixture i { background: #e2463a; }
#fsui .ctlw-vbar.dim { opacity: .35; }
#fsui .ctlw-text { margin-top: 7px; }
#fsui .ctlw-text b { color: var(--fg); font-weight: 600; font-size: 12px; margin-left: 2px; }
#fsui .ctlw-hint { margin-top: 5px; color: var(--warn); font-size: 11.5px; letter-spacing: .02em; white-space: nowrap; }

/* ---------------- Cockpit panel tooltip ---------------- */
#fsui .paneltip { position: absolute; left: 0; top: 0; padding: 5px 9px; border-radius: 7px; background: rgba(10,14,20,.82);
  border: 1px solid var(--line); font-size: 12px; font-weight: 550; white-space: nowrap; box-shadow: 0 4px 14px rgba(0,0,0,.4);
  font-variant-numeric: tabular-nums; }

/* ---------------- First-flight hints ---------------- */
/* Bottom right, over the right-hand panel (placards, not instruments), so the windscreen stays clear. */
#fsui .hints { position: absolute; right: 16px; bottom: 16px; width: 380px; max-height: calc(100vh - 32px); overflow-y: auto; max-width: calc(100vw - 36px); padding: 16px 18px 14px;
  pointer-events: auto; animation: fsui-in .25s ease-out; }
#fsui .hints-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
#fsui .hints-head b { font-size: 16px; }
#fsui .hints-head .x { border: none; background: transparent; font-size: 20px; line-height: 1; padding: 2px 8px; color: var(--fg-dim); }
#fsui .hints-grid { display: grid; grid-template-columns: 96px 1fr; gap: 5px 12px; font-size: 12.5px; }
#fsui .hints-grid span:nth-child(odd) { color: var(--fg-dim); }
#fsui .hints-startup { margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
#fsui .hints-sub { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); font-weight: 650; margin-bottom: 6px; }
#fsui .hints p { margin: 12px 0; font-size: 12.5px; color: var(--fg-dim); line-height: 1.45; }
#fsui .hints-actions { display: flex; justify-content: flex-end; gap: 8px; }
#fsui .hints-actions button { padding: 7px 14px; font-size: 13px; }
#fsui .keys .k .mouse { font-size: 12px; color: var(--fg); text-align: right; }
#fsui .ap-state { align-self: center; color: var(--fg-dim); font-size: 13px; }
#fsui button:disabled { opacity: .45; cursor: default; }

/* ---------------- Controllers page ---------------- */
#fsui select { font: inherit; font-size: 12.5px; color: var(--fg); background: rgba(255,255,255,.07); border: 1px solid var(--line);
  border-radius: 7px; padding: 4px 6px; min-width: 0; }
#fsui select option { background: var(--panel-solid); }
#fsui .pad-empty { display: flex; flex-direction: column; gap: 6px; padding: 18px; border: 1px dashed rgba(255,255,255,.18); border-radius: 12px; }
#fsui .pad-empty span { color: var(--fg-dim); font-size: 13px; line-height: 1.45; }
#fsui .pad { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; background: rgba(255,255,255,.03); }
#fsui .pad-head { display: flex; gap: 8px; align-items: center; }
#fsui .pad-head button { padding: 6px 12px; font-size: 12.5px; }
#fsui .pad-title { flex: 1; display: flex; flex-direction: column; min-width: 0; }
#fsui .pad-title span { color: var(--fg-dim); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#fsui .pad-note { color: var(--warn); font-size: 12.5px; margin: 10px 0 0; line-height: 1.45; }
#fsui .pad-axes { display: grid; grid-template-columns: 30px 130px minmax(120px, 1fr) 46px 110px 110px; gap: 6px 10px; align-items: center; margin-top: 12px; font-size: 12.5px; }
#fsui .pad-th { color: var(--fg-dim); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
#fsui .pad-axis { color: var(--fg-dim); }
#fsui .pad-live { display: flex; align-items: center; gap: 8px; }
#fsui .pad-live .bar { flex: 1; }
#fsui .pad-live span { width: 36px; text-align: right; color: var(--fg-dim); font-size: 11px; }
#fsui .pad-bar::after { content: ""; position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: rgba(255,255,255,.35); }
#fsui .pad-bar i { background: var(--accent); border-radius: 0; }
#fsui .pad-range { display: flex; align-items: center; gap: 6px; }
#fsui .pad-range output { width: 42px; font-size: 11px; color: var(--fg-dim); text-align: right; }
#fsui .pad-buttons { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px 12px; }
#fsui .pad-btn { display: flex; align-items: center; gap: 8px; font-size: 12px; }
#fsui .pad-btn i { width: 10px; height: 10px; border-radius: 50%; background: rgba(255,255,255,.15); flex: none; }
#fsui .pad-btn i.on { background: #6ff0a0; box-shadow: 0 0 6px #6ff0a0; }
#fsui .pad-btn span { width: 18px; color: var(--fg-dim); }
#fsui .pad-btn select { flex: 1; }

/* ---------------- Modal shell ---------------- */
#fsui .scrim { position: absolute; inset: 0; pointer-events: auto; background: radial-gradient(ellipse at center, rgba(5,8,12,.45), rgba(5,8,12,.78));
  backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; animation: fsui-fade .15s ease-out; }
@keyframes fsui-fade { from { opacity: 0; } }
#fsui .card { background: var(--panel); backdrop-filter: blur(18px) saturate(1.2); border: 1px solid var(--line); border-radius: 16px;
  box-shadow: 0 24px 80px rgba(0,0,0,.55); }
#fsui button { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--line); background: rgba(255,255,255,.06);
  border-radius: 10px; padding: 9px 14px; transition: background .12s, border-color .12s; }
#fsui button:hover { background: rgba(255,255,255,.12); }
#fsui button:focus-visible, #fsui input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
#fsui button.primary { background: var(--accent); color: #04121c; border-color: transparent; font-weight: 650; }
#fsui button.primary:hover { background: #7fd3ff; }
#fsui button.sel { border-color: var(--accent); background: rgba(82,195,255,.16); }

/* ---------------- Pause menu ---------------- */
#fsui .menu { width: min(920px, calc(100vw - 32px)); height: min(600px, calc(100vh - 32px)); display: grid; grid-template-columns: 210px 1fr; overflow: hidden; }
#fsui .menu nav { padding: 22px 12px; border-right: 1px solid var(--line); display: flex; flex-direction: column; gap: 4px; background: rgba(0,0,0,.18); }
#fsui .menu nav .brand { padding: 0 10px 18px; }
#fsui .menu nav .brand b { display: block; font-size: 17px; letter-spacing: .02em; }
#fsui .menu nav .brand span { font-size: 12px; color: var(--fg-dim); }
#fsui .menu nav button { text-align: left; border: none; background: transparent; padding: 10px 12px; color: var(--fg-dim); font-weight: 550; }
#fsui .menu nav button:hover { color: var(--fg); background: rgba(255,255,255,.06); }
#fsui .menu nav button.active { color: var(--fg); background: rgba(82,195,255,.14); box-shadow: inset 3px 0 0 var(--accent); }
#fsui .menu nav .spacer { flex: 1; }
#fsui .menu nav button.primary { text-align: center; color: #04121c; background: var(--accent); font-weight: 650; }
#fsui .menu nav button.primary:hover { background: #7fd3ff; }
#fsui .menu section { padding: 26px 30px; overflow-y: auto; }
#fsui .menu h2 { margin: 0 0 4px; font-size: 20px; font-weight: 650; }
#fsui .menu .sub { color: var(--fg-dim); margin: 0 0 20px; font-size: 13px; }
#fsui .menu h3 { margin: 22px 0 10px; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: var(--fg-dim); font-weight: 600; }
#fsui .scenarios { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
#fsui .scenarios button { text-align: left; padding: 14px; display: flex; flex-direction: column; gap: 4px; min-height: 86px; }
#fsui .scenarios button b { font-size: 14px; }
#fsui .scenarios button span { font-size: 12px; color: var(--fg-dim); line-height: 1.35; }
#fsui .scenarios button.current { border-color: var(--accent); background: rgba(82,195,255,.16); cursor: default; }
#fsui .row { display: grid; grid-template-columns: 150px 1fr 96px; align-items: center; gap: 14px; padding: 7px 0; }
#fsui .row label { color: var(--fg-dim); font-size: 13px; }
#fsui .row output { text-align: right; font-weight: 600; font-size: 13px; }
#fsui .chips { display: flex; flex-wrap: wrap; gap: 8px; }
#fsui .chips button { padding: 7px 12px; font-size: 13px; }
#fsui input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 22px; background: transparent; cursor: pointer; }
#fsui input[type=range]::-webkit-slider-runnable-track { height: 4px; border-radius: 2px;
  background: linear-gradient(to right, var(--accent) var(--p, 50%), rgba(255,255,255,.16) var(--p, 50%)); }
#fsui input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; margin-top: -6px;
  background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.5); }
#fsui input[type=range]::-moz-range-track { height: 4px; border-radius: 2px; background: rgba(255,255,255,.16); }
#fsui input[type=range]::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--accent); }
#fsui input[type=range]::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: #fff; border: none; }
#fsui .toggle { display: flex; align-items: center; gap: 10px; padding: 6px 0; color: var(--fg-dim); cursor: pointer; pointer-events: auto; }
#fsui .toggle input { accent-color: var(--accent); width: 16px; height: 16px; }
#fsui .keys { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 4px 28px; }
#fsui .keys .k { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
#fsui .keys .k span { color: var(--fg-dim); }
#fsui kbd { font: 600 11px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; padding: 4px 7px; border-radius: 5px; margin-left: 3px;
  background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.16); border-bottom-width: 2px; color: var(--fg); white-space: nowrap; }
#fsui .timebar { position: relative; height: 10px; border-radius: 5px; margin: 6px 0 2px;
  background: linear-gradient(to right, #0b1530 0%, #0b1530 17%, #f39a5a 25%, #8cc8f2 35%, #8cc8f2 65%, #f38a4a 75%, #0b1530 83%, #0b1530 100%); }

/* ---------------- Loading ---------------- */
#fsui .loading { position: absolute; inset: 0; pointer-events: auto; display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at 50% 120%, #33506e 0%, #111a26 55%, #070a0f 100%); transition: opacity .6s; }
#fsui .loading.done { opacity: 0; }
#fsui .loading .title { font-size: 34px; font-weight: 700; letter-spacing: .02em; }
#fsui .loading .tag { color: var(--fg-dim); margin: 6px 0 34px; letter-spacing: .12em; text-transform: uppercase; font-size: 12px; }
#fsui .loading .track { width: min(420px, 70vw); height: 4px; border-radius: 2px; background: rgba(255,255,255,.12); overflow: hidden; }
#fsui .loading .track i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, var(--accent), #b8ecff); transition: width .25s; }
#fsui .loading .label { margin-top: 12px; color: var(--fg-dim); font-size: 12px; min-height: 16px; }
#fsui .loading .tip { position: absolute; bottom: 42px; left: 50%; transform: translateX(-50%); width: min(620px, 86vw); text-align: center;
  color: rgba(238,243,248,.62); font-size: 13px; line-height: 1.5; }

/* ---------------- Crash dialog ---------------- */
#fsui .crash { width: min(440px, calc(100vw - 32px)); padding: 28px; text-align: center; }
#fsui .crash .icon { width: 52px; height: 52px; margin: 0 auto 12px; border-radius: 50%; display: grid; place-items: center;
  background: rgba(255,77,61,.16); color: var(--alert); font-size: 28px; font-weight: 800; }
#fsui .crash h2 { margin: 0 0 6px; font-size: 22px; }
#fsui .crash p { margin: 0 0 22px; color: var(--fg-dim); }
#fsui .crash .actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
`;
