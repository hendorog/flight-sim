// Flight School stylesheet (section 5), appended to the UI CSS and scoped under #fsui like it. It reuses the
// shell's tokens (--fg, --accent, --panel, --line ...) and adds the school's own: grade colours, speaker
// colours and the logbook paper.

export const SCHOOL_CSS = /* css */ `
#fsui {
  --sc-ok: #5fe39a;
  --sc-g1: #ff6b5b;
  --sc-g2: #7fd1b0;
  --sc-g3: #5fe39a;
  --sc-g4: #ffd36b;
  --sc-teal: #3fd6c6;
  --sc-slate: #a9bccf;
  --sc-amber: #ffb224;
  --sc-paper: #f3eedf;
  --sc-ink: #1f2a37;
  --sc-ink-dim: #5f6b78;
}
#fsui .sc-layer { position: absolute; inset: 0; pointer-events: none; }
#fsui .sc-layer > * { pointer-events: none; }
#fsui .sc-layer > .scrim, #fsui .sc-layer > .sc-home-wrap { pointer-events: auto; }

/* ---------------- Shared ---------------- */
#fsui .scrim.sc-passthru { background: none; backdrop-filter: none; }
#fsui .sc-card { display: flex; flex-direction: column; overflow: hidden; }
#fsui .sc-wide { width: min(1180px, calc(100vw - 32px)); height: min(820px, calc(100vh - 32px)); }
#fsui .sc-wide.sc-fit { height: auto; max-height: calc(100vh - 32px); }
#fsui .sc-head { display: flex; align-items: flex-start; gap: 16px; padding: 20px 26px 14px; border-bottom: 1px solid var(--line); flex: none; }
#fsui .sc-head .sc-titles { flex: 1; min-width: 0; }
#fsui .sc-head h2 { margin: 0; font-size: 21px; font-weight: 650; letter-spacing: .01em; }
#fsui .sc-sub { color: var(--fg-dim); font-size: 13px; margin: 3px 0 0; line-height: 1.4; }
#fsui .sc-kicker { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); font-weight: 650; margin-bottom: 4px; }
#fsui .sc-body { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 26px 22px; }
#fsui .sc-foot { display: flex; align-items: center; gap: 10px; padding: 12px 26px 16px; border-top: 1px solid var(--line); flex: none; }
#fsui .sc-foot .sc-spacer { flex: 1; }
#fsui .sc-foot .sc-note { color: var(--fg-dim); font-size: 12px; }
#fsui .sc-section { font-size: 11px; letter-spacing: .11em; text-transform: uppercase; color: var(--fg-dim); font-weight: 650; margin: 18px 0 8px; }
#fsui .sc-section:first-child { margin-top: 0; }
#fsui .sc-badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;
  letter-spacing: .08em; text-transform: uppercase; border: 1px solid currentColor; color: var(--accent); white-space: nowrap; }
#fsui .sc-badge.warn { color: var(--sc-amber); }
#fsui .sc-badge.ok { color: var(--sc-ok); }
#fsui .sc-badge.bad { color: var(--sc-g1); }
#fsui .sc-badge.dim { color: var(--fg-dim); }
#fsui .sc-badges { display: flex; flex-wrap: wrap; gap: 6px; }
#fsui .sc-kbd { margin-left: 8px; font: 600 10.5px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; padding: 3px 5px; border-radius: 4px;
  background: rgba(0,0,0,.18); border: 1px solid rgba(255,255,255,.2); opacity: .85; }
#fsui button.primary .sc-kbd { background: rgba(4,18,28,.14); border-color: rgba(4,18,28,.3); }
#fsui .sc-x { border: none; background: transparent; font-size: 22px; line-height: 1; padding: 2px 8px; color: var(--fg-dim); }
#fsui .sc-banner { display: flex; align-items: center; gap: 10px; padding: 7px 11px; border-radius: 10px; font-size: 12.5px; line-height: 1.4;
  background: rgba(255,178,36,.12); border: 1px solid rgba(255,178,36,.35); color: #ffd994; margin-bottom: 10px; }
#fsui .sc-banner.info { background: rgba(82,195,255,.1); border-color: rgba(82,195,255,.35); color: #bfe8ff; }
#fsui .sc-banner span { flex: 1; }
#fsui .sc-banner button { padding: 5px 10px; font-size: 12px; }
#fsui .sc-stars { color: var(--sc-g4); letter-spacing: .12em; font-size: 14px; white-space: nowrap; }
#fsui .sc-stars.big { font-size: 26px; letter-spacing: .14em; }
#fsui .sc-pip { display: inline-grid; place-items: center; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 6px; font-size: 12px;
  font-weight: 750; color: #0b1118; background: var(--fg-dim); }
#fsui .sc-pip.g1 { background: var(--sc-g1); }
#fsui .sc-pip.g2 { background: var(--sc-g2); }
#fsui .sc-pip.g3 { background: var(--sc-g3); }
#fsui .sc-pip.g4 { background: var(--sc-g4); }
#fsui .sc-pip.test { background: transparent; color: var(--fg); border: 1px solid rgba(255,255,255,.35); }
#fsui .sc-pip.test.g1 { color: var(--sc-g1); border-color: var(--sc-g1); }
#fsui .sc-pip.none { background: rgba(255,255,255,.1); color: var(--fg-dim); }
#fsui .sc-chips { display: flex; flex-wrap: wrap; gap: 6px; }
#fsui .sc-chip { padding: 4px 9px; border-radius: 999px; font-size: 12px; border: 1px solid var(--line); background: rgba(255,255,255,.05); color: var(--fg); }
#fsui .sc-chip.demo { color: var(--fg-dim); }
#fsui .sc-chip.practice { border-color: rgba(82,195,255,.45); color: #bfe8ff; }
#fsui .sc-chip.assessed { border-color: rgba(255,178,36,.55); color: #ffd994; }
#fsui .sc-table { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
#fsui .sc-table th { text-align: left; font-weight: 600; color: var(--fg-dim); font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
  padding: 0 8px 6px 0; border-bottom: 1px solid var(--line); }
#fsui .sc-table td { padding: 6px 8px 6px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
#fsui .sc-table td.r, #fsui .sc-table th.r { text-align: right; }
#fsui .sc-table tr:last-child td { border-bottom: none; }
#fsui .sc-foot-note { color: var(--fg-dim); font-size: 11.5px; margin-top: 6px; line-height: 1.4; }
#fsui .sc-foot-note sup, #fsui .sc-table sup { color: var(--sc-amber); }
#fsui .sc-list { margin: 0; padding-left: 18px; line-height: 1.5; font-size: 13.5px; }
#fsui .sc-list li { margin: 3px 0; }
#fsui .sc-field { display: grid; grid-template-columns: 170px 1fr; align-items: center; gap: 12px; padding: 7px 0; }
#fsui .sc-field > label, #fsui .sc-field > span { color: var(--fg-dim); font-size: 13px; }
#fsui .sc-field .sc-inline { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
#fsui .sc-field .sc-inline input[type=text] { max-width: 320px; }
#fsui .sc-field .sc-inline select { min-width: 240px; padding: 6px 8px; }
#fsui .sc-field .sc-inline button { padding: 6px 12px; font-size: 12.5px; }
#fsui input[type=text] { font: inherit; font-size: 13.5px; color: var(--fg); background: rgba(255,255,255,.07); border: 1px solid var(--line);
  border-radius: 8px; padding: 7px 10px; min-width: 0; width: 100%; user-select: text; }
#fsui input[type=text]:focus { border-color: var(--accent); outline: none; }
#fsui .sc-seg { display: inline-flex; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; }
#fsui .sc-seg button { border: none; border-radius: 0; padding: 6px 12px; font-size: 12.5px; background: transparent; color: var(--fg-dim); }
#fsui .sc-seg button + button { border-left: 1px solid var(--line); }
#fsui .sc-seg button.sel { background: rgba(82,195,255,.18); color: var(--fg); }
#fsui .sc-empty { color: var(--fg-dim); font-size: 13px; padding: 24px; text-align: center; border: 1px dashed rgba(255,255,255,.15); border-radius: 12px; }

/* ---------------- Welcome ---------------- */
#fsui .sc-welcome { width: min(620px, calc(100vw - 32px)); padding: 30px 32px 26px; max-height: calc(100vh - 32px); overflow-y: auto; }
#fsui .sc-welcome h2 { margin: 0 0 6px; font-size: 24px; }
#fsui .sc-welcome > p { color: var(--fg-dim); margin: 0 0 20px; line-height: 1.5; font-size: 13.5px; }
#fsui .sc-choices { display: grid; gap: 10px; }
#fsui .sc-choice { display: grid; grid-template-columns: 1fr auto; gap: 2px 14px; text-align: left; padding: 14px 16px; }
#fsui .sc-choice b { font-size: 15px; }
#fsui .sc-choice span { grid-column: 1; color: var(--fg-dim); font-size: 12.5px; line-height: 1.4; }
#fsui .sc-choice .sc-kbd { grid-column: 2; grid-row: 1 / span 2; align-self: center; }
#fsui .sc-choice.primary span { color: rgba(4,18,28,.72); }
#fsui .sc-welcome .sc-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }

/* ---------------- Home ---------------- */
#fsui .sc-home-wrap { position: absolute; inset: 0; pointer-events: auto;
  background: linear-gradient(90deg, rgba(5,8,12,.62) 0%, rgba(5,8,12,.25) 420px, rgba(5,8,12,0) 70%); animation: fsui-fade .2s ease-out; }
#fsui .sc-home { position: absolute; left: 20px; top: 20px; max-height: calc(100% - 40px); width: 360px; padding: 16px 18px 14px; overflow-y: auto; }
#fsui .sc-home-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
#fsui .sc-home-brand svg { width: 30px; height: 30px; flex: none; }
#fsui .sc-home-brand b { display: block; font-size: 16px; letter-spacing: .01em; }
#fsui .sc-home-brand span { color: var(--fg-dim); font-size: 12px; }
#fsui .sc-continue { border-radius: 12px; padding: 12px 14px; background: linear-gradient(160deg, rgba(82,195,255,.16), rgba(82,195,255,.04));
  border: 1px solid rgba(82,195,255,.32); margin-bottom: 10px; }
#fsui .sc-continue .sc-kicker { margin-bottom: 6px; }
#fsui .sc-continue h3 { margin: 0 0 4px; font-size: 17px; line-height: 1.25; }
#fsui .sc-continue .sc-ref { color: var(--fg-dim); font-size: 12px; line-height: 1.4; }
#fsui .sc-continue .sc-meta { display: flex; justify-content: space-between; align-items: center; margin: 8px 0 10px; font-size: 12.5px; color: var(--fg-dim); }
#fsui .sc-continue button.primary { width: 100%; padding: 9px; font-size: 15px; display: flex; justify-content: center; align-items: center; }
#fsui .sc-track { margin: 2px 0 8px; }
#fsui .sc-stage { display: grid; grid-template-columns: 92px 1fr 40px; gap: 8px; align-items: center; font-size: 12px; padding: 2px 0; color: var(--fg-dim); }
#fsui .sc-stage .bar { height: 5px; }
#fsui .sc-stage .bar i { background: var(--sc-ok); }
#fsui .sc-stage b { color: var(--fg); font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
#fsui .sc-milestones { display: flex; justify-content: space-between; margin: 8px 2px 2px; position: relative; }
#fsui .sc-milestones::before { content: ""; position: absolute; left: 10px; right: 10px; top: 8px; height: 2px; background: rgba(255,255,255,.12); }
#fsui .sc-ms { position: relative; display: flex; flex-direction: column; align-items: center; gap: 5px; font-size: 11px; color: var(--fg-dim); width: 80px; text-align: center; }
#fsui .sc-ms i { width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255,255,255,.3); background: var(--panel-solid); }
#fsui .sc-ms.done i { background: var(--sc-ok); border-color: var(--sc-ok); box-shadow: 0 0 8px rgba(95,227,154,.6); }
#fsui .sc-ms.done { color: var(--fg); }
#fsui .sc-rank { text-align: center; font-size: 12px; color: var(--fg-dim); margin: 6px 0 2px; }
#fsui .sc-rank b { color: var(--fg); }
#fsui .sc-hours { font-size: 11.5px; color: var(--fg-dim); line-height: 1.4; margin: 6px 0 8px; padding: 7px 10px; border-radius: 9px; background: rgba(255,255,255,.04); }
#fsui .sc-hours b { color: var(--fg); font-weight: 600; }
#fsui .sc-nav { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
#fsui .sc-nav button { padding: 7px 10px; font-size: 13px; text-align: left; }
#fsui .sc-nav button.wide { grid-column: span 2; text-align: center; display: flex; justify-content: center; align-items: center; }
#fsui .sc-licence-mini { position: absolute; right: 20px; top: 20px; width: 270px; padding: 14px 16px; display: grid; grid-template-columns: 44px 1fr; gap: 4px 12px; align-items: center; }
#fsui .sc-licence-mini .sc-avatar { grid-row: span 2; }
#fsui .sc-licence-mini b { font-size: 13.5px; }
#fsui .sc-licence-mini span { font-size: 11.5px; color: var(--fg-dim); }
#fsui .sc-licence-mini .sc-mini-stats { grid-column: 1 / span 2; display: flex; justify-content: space-between; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--fg-dim); }
#fsui .sc-licence-mini .sc-mini-stats b { display: block; color: var(--fg); font-size: 14px; }
#fsui .sc-avatar { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; font-weight: 750; font-size: 16px; color: #04121c;
  background: linear-gradient(140deg, #8fdcff, #52c3ff 60%, #2f8fd0); }

/* ---------------- Syllabus and challenges ---------------- */
#fsui .sc-stage-row { margin-bottom: 18px; }
#fsui .sc-stage-row h4 { display: flex; justify-content: space-between; margin: 0 0 8px; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: var(--fg-dim); font-weight: 650; }
#fsui .sc-stage-row h4 span { letter-spacing: 0; text-transform: none; font-weight: 500; }
#fsui .sc-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(176px, 1fr)); gap: 8px; }
#fsui .sc-tile { position: relative; text-align: left; padding: 10px 12px 10px; min-height: 104px; display: flex; flex-direction: column; gap: 3px;
  border-radius: 11px; border: 1px solid var(--line); background: rgba(255,255,255,.04); }
#fsui .sc-tile .sc-num { font-size: 11px; font-weight: 700; letter-spacing: .08em; color: var(--fg-dim); }
#fsui .sc-tile b { font-size: 13.5px; line-height: 1.25; }
#fsui .sc-tile .sc-ref { font-size: 11px; color: var(--fg-dim); line-height: 1.3; }
#fsui .sc-tile .sc-tile-foot { margin-top: auto; display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; color: var(--fg-dim); padding-top: 6px; }
#fsui .sc-tile.available { border-color: rgba(82,195,255,.5); background: rgba(82,195,255,.09); }
#fsui .sc-tile.available .sc-num { color: var(--accent); }
#fsui .sc-tile.competent { border-color: rgba(95,227,154,.35); background: rgba(95,227,154,.06); }
#fsui .sc-tile.competent .sc-num { color: var(--sc-ok); }
#fsui .sc-tile.locked { opacity: .5; cursor: default; }
#fsui .sc-tile.locked:hover { background: rgba(255,255,255,.04); }
#fsui .sc-tile.next { box-shadow: 0 0 0 2px var(--accent), 0 0 18px rgba(82,195,255,.35); }
#fsui .sc-tile .sc-lock { width: 10px; height: 8px; border-radius: 2px; background: var(--fg-dim); position: relative; display: inline-block; margin-right: 4px; }
#fsui .sc-tile .sc-lock::before { content: ""; position: absolute; left: 2px; top: -5px; width: 6px; height: 6px; border: 1.5px solid var(--fg-dim); border-bottom: none; border-radius: 4px 4px 0 0; box-sizing: border-box; }
/* Gate tiles (progress check, skill test): an examiner's stamp drawn in CSS. */
#fsui .sc-tile.gate::after { content: "CHECK"; position: absolute; right: 9px; top: 9px; font-size: 8.5px; font-weight: 800; letter-spacing: .12em;
  padding: 3px 5px; border: 1.5px solid var(--sc-amber); color: var(--sc-amber); border-radius: 4px; transform: rotate(8deg); opacity: .85; }
#fsui .sc-tile.gate.test::after { content: "EXAMINER"; }
#fsui .sc-medal { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 5px; vertical-align: -1px; }
#fsui .sc-medal.gold { background: radial-gradient(circle at 35% 35%, #fff2b8, #e7b53c); }
#fsui .sc-medal.silver { background: radial-gradient(circle at 35% 35%, #ffffff, #a6b0bb); }
#fsui .sc-medal.bronze { background: radial-gradient(circle at 35% 35%, #ffd6b0, #b8733f); }

/* ---------------- Briefing ---------------- */
#fsui .sc-brief { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(0, 1fr); gap: 26px; }
#fsui .sc-aim { font-size: 15.5px; line-height: 1.45; margin: 0 0 4px; }
#fsui details.sc-more summary { cursor: pointer; color: var(--accent); font-size: 13px; margin-top: 10px; }
#fsui details.sc-more p { color: var(--fg-dim); font-size: 13px; line-height: 1.5; }
#fsui .sc-numbers { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
#fsui .sc-number { padding: 8px 10px; border-radius: 9px; background: rgba(255,255,255,.05); border: 1px solid var(--line); }
#fsui .sc-number span { display: block; font-size: 11px; color: var(--fg-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#fsui .sc-number b { font-size: 16px; font-variant-numeric: tabular-nums; }
#fsui .sc-diagram { border-radius: 10px; background: rgba(0,0,0,.22); border: 1px solid var(--line); padding: 6px; }
#fsui .sc-diagram svg { display: block; width: 100%; height: auto; }
#fsui .sc-keys { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; font-size: 12.5px; }
#fsui .sc-keys div { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 3px 0; border-bottom: 1px solid var(--line); }
#fsui .sc-keys span { color: var(--fg-dim); }
#fsui .sc-weather { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--fg-dim); }
#fsui .sc-weather b { color: var(--fg); font-weight: 600; }

/* ---------------- Debrief ---------------- */
#fsui .sc-outcome { font-size: 26px; font-weight: 750; letter-spacing: .01em; }
#fsui .sc-outcome.ok { color: var(--sc-ok); }
#fsui .sc-outcome.warn { color: var(--sc-amber); }
#fsui .sc-outcome.bad { color: var(--sc-g1); }
#fsui .sc-deb-top { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
#fsui .sc-debrief { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); gap: 22px; }
#fsui .sc-points { display: grid; gap: 8px; margin-bottom: 4px; }
#fsui .sc-point { display: grid; grid-template-columns: 82px 1fr; gap: 10px; font-size: 13.5px; line-height: 1.45; }
#fsui .sc-point span { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--fg-dim); font-weight: 650; padding-top: 2px; }
#fsui .sc-point.strength span { color: var(--sc-ok); }
#fsui .sc-point.main span { color: var(--sc-amber); }
#fsui .sc-point.next span { color: var(--accent); }
#fsui .sc-ex { border: 1px solid var(--line); border-radius: 10px; margin-bottom: 6px; background: rgba(255,255,255,.03); }
#fsui .sc-ex > button { width: 100%; display: grid; grid-template-columns: 1fr auto auto 14px; gap: 8px; align-items: center; text-align: left;
  border: none; border-radius: 10px; background: transparent; padding: 9px 12px; }
#fsui .sc-ex > button b { font-size: 13px; font-weight: 600; }
#fsui .sc-ex > button small { display: block; color: var(--fg-dim); font-size: 11.5px; font-weight: 400; margin-top: 2px; }
#fsui .sc-ex > button::after { content: "▸"; color: var(--fg-dim); font-size: 11px; transition: transform .15s; }
#fsui .sc-ex.open > button::after { transform: rotate(90deg); }
#fsui .sc-ex .sc-crit { display: none; padding: 0 12px 8px; }
#fsui .sc-ex.open .sc-crit { display: block; }
#fsui .sc-crit tr { cursor: pointer; }
#fsui .sc-crit tr:hover td { background: rgba(255,255,255,.04); }
#fsui .sc-crit tr.sel td { background: rgba(82,195,255,.12); }
#fsui .sc-crit td small { display: block; color: var(--fg-dim); font-size: 11px; }
#fsui .sc-crit .sc-fault { color: var(--sc-amber); font-size: 12px; padding: 4px 0 6px; line-height: 1.35; }
#fsui .sc-crit .sc-fault.bad { color: var(--sc-g1); }
#fsui .sc-crit .safety { color: var(--sc-g1); font-weight: 700; font-size: 10px; letter-spacing: .08em; }
#fsui .sc-graph { position: relative; }
#fsui .sc-graph canvas { display: block; width: 100%; }
#fsui .sc-graph-bar { display: flex; align-items: center; gap: 6px; margin: 6px 0 2px; font-size: 12px; color: var(--fg-dim); }
#fsui .sc-graph-bar button { padding: 4px 9px; font-size: 12px; }
#fsui .sc-graph-bar .sc-spacer { flex: 1; }
#fsui .sc-graph-bar label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
#fsui .sc-graph-tip { position: absolute; padding: 5px 8px; border-radius: 7px; background: rgba(10,14,20,.92); border: 1px solid var(--line);
  font-size: 11.5px; pointer-events: none; white-space: nowrap; transform: translate(-50%, -100%); margin-top: -8px; }
#fsui .sc-map canvas { display: block; width: 100%; border-radius: 10px; }
#fsui .sc-logline { margin-top: 12px; }
#fsui .sc-ceremony { width: min(520px, calc(100vw - 32px)); padding: 34px 34px 28px; text-align: center; }
#fsui .sc-ceremony .sc-seal { width: 96px; height: 96px; margin: 0 auto 16px; border-radius: 50%; display: grid; place-items: center;
  background: radial-gradient(circle at 35% 30%, #fff2b8, #e7b53c 60%, #a87a1d); color: #3a2a06; font-weight: 800; font-size: 13px; letter-spacing: .1em;
  box-shadow: 0 0 0 6px rgba(231,181,60,.18), 0 10px 40px rgba(231,181,60,.35); animation: sc-pop .5s cubic-bezier(.2,1.6,.4,1); }
@keyframes sc-pop { from { transform: scale(.4); opacity: 0; } }
#fsui .sc-ceremony h2 { margin: 0 0 8px; font-size: 26px; }
#fsui .sc-ceremony p { color: var(--fg-dim); margin: 0 0 22px; line-height: 1.5; }
#fsui .sc-retry-list { display: grid; gap: 6px; margin-top: 8px; }
#fsui .sc-retry-list button { text-align: left; padding: 8px 12px; font-size: 13px; }

/* ---------------- Logbook (paper) ---------------- */
#fsui .sc-paper { background: var(--sc-paper); color: var(--sc-ink); border-radius: 8px; padding: 14px 16px 10px;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.08), 0 6px 20px rgba(0,0,0,.35); }
#fsui .sc-paper table { width: 100%; border-collapse: collapse; font-size: 11.5px; font-variant-numeric: tabular-nums; }
#fsui .sc-paper th { font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--sc-ink-dim); font-weight: 700; text-align: left;
  border-bottom: 1.5px solid rgba(31,42,55,.45); padding: 4px 6px; vertical-align: bottom; }
#fsui .sc-paper td { padding: 4px 6px; border-bottom: 1px solid rgba(70,110,160,.22); vertical-align: middle; height: 30px; }
#fsui .sc-paper td + td, #fsui .sc-paper th + th { border-left: 1px solid rgba(31,42,55,.14); }
#fsui .sc-paper .r { text-align: right; }
#fsui .sc-paper tfoot td { font-weight: 700; border-bottom: none; border-top: 1.5px solid rgba(31,42,55,.45); background: rgba(31,42,55,.04); }
#fsui .sc-paper tfoot tr + tr td { border-top: 1px solid rgba(31,42,55,.18); }
#fsui .sc-paper .sc-sign { font-family: "Segoe Script", "Bradley Hand", "Snell Roundhand", cursive; color: #1d3f8a; font-size: 12.5px; white-space: nowrap; }
#fsui .sc-paper .sc-stamp { display: inline-block; font-size: 8.5px; font-weight: 800; letter-spacing: .1em; color: #b0322a; border: 1.5px solid #b0322a;
  border-radius: 3px; padding: 1px 4px; transform: rotate(-6deg); margin-left: 4px; opacity: .85; white-space: nowrap; }
#fsui .sc-paper input.sc-remark { width: 100%; border: none; background: transparent; font: inherit; color: var(--sc-ink); padding: 2px 0; border-bottom: 1px dashed transparent; user-select: text; }
#fsui .sc-paper input.sc-remark:hover { border-bottom-color: rgba(31,42,55,.3); }
#fsui .sc-paper input.sc-remark:focus { outline: none; border-bottom-color: #1d3f8a; }
#fsui .sc-paper button.sc-link { border: none; background: transparent; color: #1d5fb0; padding: 0; font-size: 11.5px; text-decoration: underline; }
#fsui .sc-paper .sc-ex-cell { max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#fsui .sc-pager { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--fg-dim); }
#fsui .sc-pager button { padding: 5px 10px; font-size: 12.5px; }

/* ---------------- Licence ---------------- */
#fsui .sc-licence { width: min(560px, 100%); margin: 6px auto 0; border-radius: 16px; padding: 20px 22px 18px; color: #0d1b2a; position: relative; overflow: hidden;
  background: linear-gradient(135deg, #e9f3fb 0%, #cfe3f3 45%, #b8d4ea 100%); box-shadow: 0 18px 50px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.6); }
#fsui .sc-licence::before { content: ""; position: absolute; right: -60px; top: -60px; width: 240px; height: 240px; border-radius: 50%;
  background: repeating-radial-gradient(circle, rgba(29,79,138,.07) 0 2px, transparent 2px 9px); }
#fsui .sc-licence.anim { animation: sc-pop .6s cubic-bezier(.2,1.4,.4,1); }
#fsui .sc-lic-head { display: flex; justify-content: space-between; align-items: flex-start; font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: #2a4a6e; font-weight: 700; }
#fsui .sc-lic-title { font-size: 21px; font-weight: 800; margin: 10px 0 14px; color: #0d2a4a; letter-spacing: .01em; }
#fsui .sc-lic-main { display: grid; grid-template-columns: 74px 1fr; gap: 16px; align-items: start; position: relative; }
#fsui .sc-lic-main .sc-avatar { width: 74px; height: 74px; font-size: 26px; border-radius: 12px; }
#fsui .sc-lic-grid { display: grid; grid-template-columns: auto 1fr; gap: 3px 14px; font-size: 12.5px; }
#fsui .sc-lic-grid span { color: #4a6584; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; padding-top: 2px; }
#fsui .sc-lic-grid b { font-weight: 650; }
#fsui .sc-lic-end { margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(13,42,74,.18); font-size: 12px; }
#fsui .sc-lic-end div { display: flex; justify-content: space-between; padding: 2px 0; }
#fsui .sc-lic-end span { color: #4a6584; }
#fsui .sc-lic-foot { margin-top: 12px; font-size: 10px; color: #4a6584; letter-spacing: .04em; }

/* ---------------- In flight: strip, card, captions, highlight, hood ---------------- */
#fsui .sc-strip { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 24px)); min-height: 52px;
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 8px 12px; border-radius: 12px;
  background: rgba(10,14,20,.72); backdrop-filter: blur(10px); border: 1px solid var(--line); box-shadow: 0 6px 24px rgba(0,0,0,.35); }
#fsui .sc-auth { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
#fsui .sc-auth .chip { font-size: 11px; padding: 4px 8px; white-space: nowrap; }
#fsui .sc-auth .chip.instructor, #fsui .sc-auth .chip.followMe { color: var(--accent); background: rgba(82,195,255,.12); }
#fsui .sc-auth .chip.offered { color: var(--sc-amber); background: rgba(255,178,36,.12); animation: fsui-blink 1s steps(2) infinite; }
#fsui .sc-auth .chip.student, #fsui .sc-auth .chip.solo { color: var(--sc-ok); background: rgba(95,227,154,.12); }
#fsui .sc-auth .chip.skillTest { color: var(--sc-slate); background: rgba(169,188,207,.12); }
#fsui .sc-auth .sc-hold { font-size: 10px; font-weight: 700; letter-spacing: .08em; color: var(--sc-amber); }
#fsui .sc-auth .sc-match { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--sc-amber); }
#fsui .sc-auth .sc-match .bar { width: 60px; height: 4px; }
#fsui .sc-auth .sc-match .bar i { background: var(--sc-amber); }
#fsui .sc-task { min-width: 0; text-align: center; }
#fsui .sc-task b { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 13.5px; font-weight: 600; line-height: 1.25; }
#fsui .sc-task span { display: block; font-size: 11px; color: var(--fg-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
#fsui .sc-task span.sc-prompt { color: var(--sc-amber); font-weight: 600; }
#fsui .sc-ck-keys { display: inline-flex; align-items: center; gap: 2px; margin-left: auto; white-space: nowrap; }
#fsui .sc-task .sc-ck-keys { margin-left: 4px; vertical-align: middle; }
#fsui .sc-ck-keys kbd { font-size: 10px; padding: 2px 5px; margin-left: 2px; color: var(--fg); }
#fsui .sc-tchips { display: flex; gap: 4px; }
#fsui .sc-tchip { font: 650 11px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; padding: 5px 6px; border-radius: 6px; white-space: nowrap;
  background: rgba(0,0,0,.35); border: 1px solid currentColor; }
#fsui .sc-tchip.green { color: var(--sc-ok); }
#fsui .sc-tchip.amber { color: var(--sc-amber); }
#fsui .sc-tchip.red { color: #fff; background: rgba(255,77,61,.85); border-color: var(--alert); }
#fsui .sc-assess { font-size: 10.5px; color: var(--fg-dim); letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; }
#fsui .sc-lcard { position: absolute; top: 72px; left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 24px)); padding: 12px 14px 12px;
  border-radius: 12px; background: rgba(10,14,20,.74); backdrop-filter: blur(10px); border: 1px solid var(--line); box-shadow: 0 6px 24px rgba(0,0,0,.35); }
#fsui .sc-lcard-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font-size: 11.5px; color: var(--fg-dim); }
#fsui .sc-lcard-head b { color: var(--fg); font-size: 13px; }
#fsui .sc-lcard h4 { margin: 4px 0 8px; font-size: 15px; font-weight: 600; }
#fsui .sc-target { display: grid; grid-template-columns: 52px 1fr 92px; gap: 10px; align-items: center; padding: 3px 0; font-size: 12px; }
#fsui .sc-target > span { color: var(--fg-dim); font-weight: 650; letter-spacing: .06em; }
#fsui .sc-target > b { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
#fsui .sc-target > b small { color: var(--fg-dim); font-weight: 400; }
#fsui .sc-dev { position: relative; height: 10px; border-radius: 5px;
  background: linear-gradient(to right, rgba(255,77,61,.35) 0 12.5%, rgba(255,178,36,.35) 12.5% 25%, rgba(95,227,154,.3) 25% 75%, rgba(255,178,36,.35) 75% 87.5%, rgba(255,77,61,.35) 87.5%); }
#fsui .sc-dev::after { content: ""; position: absolute; left: 50%; top: -3px; bottom: -3px; width: 1.5px; margin-left: -.75px; background: rgba(255,255,255,.75); }
#fsui .sc-dev i { position: absolute; top: -3px; width: 6px; height: 16px; margin-left: -3px; border-radius: 3px; background: #fff; box-shadow: 0 0 6px rgba(0,0,0,.6); transition: left .1s linear; }
#fsui .sc-dev.amber i { background: var(--sc-amber); }
#fsui .sc-dev.red i { background: var(--alert); }
#fsui .sc-nolive { padding: 10px; border-radius: 8px; text-align: center; font-size: 12px; color: var(--fg-dim); background: rgba(255,255,255,.04); letter-spacing: .04em; }
#fsui .sc-cklist { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); font-size: 12px; }
#fsui .sc-cklist b { display: block; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--fg-dim); margin-bottom: 4px; }
#fsui .sc-ck { display: flex; gap: 8px; align-items: center; padding: 2px 0; color: var(--fg-dim); }
#fsui .sc-ck i { width: 14px; height: 14px; border-radius: 4px; border: 1.5px solid rgba(255,255,255,.3); flex: none; display: grid; place-items: center; font-style: normal; font-size: 10px; }
#fsui .sc-ck.active { color: var(--fg); }
#fsui .sc-ck.active i { border-color: var(--accent); box-shadow: 0 0 6px rgba(82,195,255,.6); }
#fsui .sc-ck.done i { background: var(--sc-ok); border-color: var(--sc-ok); color: #04121c; }
#fsui .sc-ck.done i::before { content: "✓"; font-weight: 800; }
#fsui .sc-ck.missed { color: var(--sc-g1); }
#fsui .sc-ck.missed i { border-color: var(--sc-g1); }
#fsui .sc-ck.missed i::before { content: "✕"; font-weight: 800; color: var(--sc-g1); }
#fsui .sc-lcaps { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); display: grid; gap: 3px; font-size: 12px; line-height: 1.35; }
#fsui .sc-lcaps div { color: var(--fg-dim); }
#fsui .sc-lcaps div:last-child { color: var(--fg); }
#fsui .sc-lcaps em { font-style: normal; font-weight: 700; font-size: 10px; letter-spacing: .08em; margin-right: 6px; }
#fsui .sc-timer { font-variant-numeric: tabular-nums; }
#fsui .sc-captions { position: absolute; left: 50%; bottom: 120px; transform: translateX(-50%); width: min(760px, calc(100vw - 32px)); display: flex; justify-content: center; }
#fsui .sc-caption { display: flex; align-items: baseline; gap: 10px; padding: 9px 16px; border-radius: 12px; background: rgba(6,9,14,.78); backdrop-filter: blur(8px);
  border: 1px solid var(--line); font-size: 16px; line-height: 1.4; box-shadow: 0 6px 24px rgba(0,0,0,.4); transition: opacity .5s; text-shadow: 0 1px 2px rgba(0,0,0,.6); }
#fsui .sc-caption.out { opacity: 0; }
#fsui .sc-caption em { flex: none; font-style: normal; font-weight: 750; font-size: 11px; letter-spacing: .1em; padding: 2px 6px; border-radius: 5px; color: #04121c; background: var(--sc-teal); }
#fsui .sc-spk-instructor { color: var(--sc-teal); }
#fsui .sc-spk-examiner { color: var(--sc-slate); }
#fsui .sc-spk-student { color: #b9c3cd; }
#fsui .sc-spk-tower, #fsui .sc-spk-ground, #fsui .sc-spk-atis { color: var(--sc-amber); }
#fsui .sc-spk-system { color: var(--fg-dim); }
#fsui .sc-caption em.examiner { background: var(--sc-slate); }
#fsui .sc-caption em.student { background: #b9c3cd; }
#fsui .sc-caption em.tower, #fsui .sc-caption em.ground, #fsui .sc-caption em.atis { background: var(--sc-amber); }
#fsui .sc-caption em.system { background: var(--fg-dim); }
#fsui .sc-caption.safety { border-color: rgba(255,77,61,.7); background: rgba(60,8,6,.85); }
#fsui .sc-caption.safety em { background: var(--alert); color: #fff; }
#fsui .sc-caption.student-line { font-style: italic; color: #d6dde4; }
#fsui .sc-ring { position: absolute; left: 0; top: 0; border-radius: 50%; border: 3px solid var(--sc-amber); box-shadow: 0 0 14px rgba(255,178,36,.7), inset 0 0 10px rgba(255,178,36,.35);
  animation: sc-pulse 1.1s ease-in-out infinite; }
@keyframes sc-pulse { 50% { opacity: .35; } }
#fsui .sc-hood { position: absolute; left: 0; right: 0; top: 0; background: linear-gradient(to bottom, #07090c 0, #0b0e12 calc(100% - 26px), rgba(11,14,18,0) 100%); }
#fsui .sc-hood.blackout { background: #030406; bottom: 0; }
#fsui .sc-hood-label { position: absolute; left: 50%; bottom: 40px; transform: translateX(-50%); font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: rgba(255,255,255,.35); }
/* Control callouts (owner playtest: point at the control, its state and key) */
#fsui .sc-co { position: absolute; inset: 0; }
#fsui .sc-co-ring { position: absolute; left: 0; top: 0; width: 52px; height: 52px; border-radius: 50%; border: 3px solid var(--sc-amber);
  box-shadow: 0 0 16px rgba(255,178,36,.8), inset 0 0 10px rgba(255,178,36,.4); animation: sc-co-pulse 1s ease-in-out infinite; }
@keyframes sc-co-pulse { 0%, 100% { scale: 1; opacity: 1; } 50% { scale: 1.25; opacity: .55; } }
#fsui .sc-co.done .sc-co-ring { border-color: var(--sc-ok); box-shadow: 0 0 16px rgba(95,227,154,.8); animation: none; }
#fsui .sc-co-arrow { position: absolute; left: 0; top: 0; width: 44px; height: 44px; animation: sc-co-nudge .8s ease-in-out infinite alternate; }
#fsui .sc-co-arrow::before { content: ""; position: absolute; left: 6px; top: 8px; border-left: 30px solid var(--sc-amber); border-top: 14px solid transparent;
  border-bottom: 14px solid transparent; filter: drop-shadow(0 0 6px rgba(255,178,36,.9)); }
@keyframes sc-co-nudge { to { opacity: .55; } }
#fsui .sc-co-chip { position: absolute; left: 0; top: 0; max-width: 340px; padding: 7px 11px 8px; border-radius: 10px; background: rgba(10,14,20,.86);
  border: 1.5px solid var(--sc-amber); box-shadow: 0 6px 22px rgba(0,0,0,.45); backdrop-filter: blur(8px); }
#fsui .sc-co-chip.clickable { pointer-events: auto; cursor: pointer; }
#fsui .sc-co.done .sc-co-chip { border-color: var(--sc-ok); }
#fsui .sc-co.docked .sc-co-chip { max-width: 480px; }
#fsui .sc-co-top { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
#fsui .sc-co-top b { font-size: 14px; font-weight: 650; }
#fsui .sc-co-state { font: 750 13px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: var(--sc-amber); letter-spacing: .04em; }
#fsui .sc-co.done .sc-co-state { color: var(--sc-ok); }
#fsui .sc-co-key { font: 700 12px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; padding: 4px 7px; border-radius: 5px; margin-left: auto;
  background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.35); color: var(--fg); }
#fsui .sc-co-why { margin-top: 4px; font-size: 12px; line-height: 1.35; color: var(--fg-dim); white-space: normal; }
#fsui .sc-co-more { margin-top: 3px; font-size: 10.5px; color: var(--fg-dim); letter-spacing: .06em; }
/* Taxi guidance HUD */
#fsui .sc-taxi { position: absolute; right: 16px; top: 84px; width: 236px; padding: 9px 12px 10px; border-radius: 12px; background: rgba(10,14,20,.76);
  backdrop-filter: blur(10px); border: 1px solid var(--line); box-shadow: 0 6px 24px rgba(0,0,0,.35); }
#fsui .sc-taxi.hold { border-color: rgba(255,77,61,.8); background: rgba(48,8,6,.84); }
#fsui .sc-taxi-head { font-size: 10px; letter-spacing: .14em; color: var(--fg-dim); font-weight: 700; margin-bottom: 6px; }
#fsui .sc-taxi-main { display: flex; align-items: center; gap: 10px; }
#fsui .sc-taxi-icon svg { display: block; fill: none; stroke: #ffd400; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 0 4px rgba(255,212,0,.5)); }
#fsui .sc-taxi.hold .sc-taxi-icon svg { stroke: #ff5a4a; }
#fsui .sc-taxi-txt { flex: 1; min-width: 0; }
#fsui .sc-taxi-action { font-size: 15px; font-weight: 750; letter-spacing: .06em; }
#fsui .sc-taxi.hold .sc-taxi-action { color: #ff8070; }
#fsui .sc-taxi-onto { font-size: 13px; color: var(--fg); }
#fsui .sc-taxi-dist { font: 700 18px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
#fsui .sc-taxi-then { margin-top: 6px; font-size: 11.5px; color: var(--fg-dim); }
#fsui .sc-taxi-line { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 11px; color: var(--fg-dim); }
#fsui .sc-taxi-bar { position: relative; width: 84px; height: 10px; border-radius: 5px; background: rgba(255,255,255,.08); flex: none; }
#fsui .sc-taxi-centre { position: absolute; left: 50%; top: -2px; bottom: -2px; width: 2px; margin-left: -1px; background: #ffd400; }
#fsui .sc-taxi-dot { position: absolute; top: 1px; width: 8px; height: 8px; margin-left: -4px; border-radius: 50%; background: #fff; transition: left .1s linear; }
#fsui .sc-taxi-dot.off { background: var(--sc-amber); }
#fsui .sc-taxi.offtw { border-color: rgba(255,170,40,.85); }
#fsui .sc-taxi.offtw .sc-taxi-line span { color: var(--sc-amber); font-weight: 750; }
#fsui .sc-taxi-gs { position: absolute; right: 12px; top: 8px; font: 650 11px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: var(--fg-dim); }
#fsui .sc-taxi-gs.fast { color: var(--sc-amber); }
#fsui .sc-follow { position: absolute; left: 16px; top: 30px; font-size: 11px; font-weight: 750; letter-spacing: .1em; color: var(--accent); text-shadow: 0 1px 3px rgba(0,0,0,.8); }

/* ---------------- Menu School tab ---------------- */
#fsui .sc-menu-live { display: grid; gap: 6px; margin-bottom: 8px; }
#fsui .sc-menu-live .sc-target { grid-template-columns: 52px 1fr 110px; }
#fsui .sc-caplog { max-height: 220px; overflow-y: auto; font-size: 12.5px; line-height: 1.45; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; background: rgba(0,0,0,.15); user-select: text; }
#fsui .sc-caplog div { padding: 2px 0; }
#fsui .sc-caplog em { font-style: normal; font-weight: 700; font-size: 10px; letter-spacing: .08em; margin-right: 6px; }
#fsui .sc-confirm { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; margin: 10px 0; background: rgba(255,77,61,.1); border: 1px solid rgba(255,77,61,.4); font-size: 13px; }
#fsui .sc-confirm span { flex: 1; }
#fsui .sc-confirm button { padding: 6px 12px; font-size: 12.5px; }
#fsui button.danger { background: rgba(255,77,61,.85); border-color: transparent; color: #fff; font-weight: 650; }
#fsui button.danger:hover { background: #ff6b5b; }
`;
