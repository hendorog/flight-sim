// The Career stylesheet (CAREER_CSS, injected once as `<style id="fsui-career-style">`): every rule under
// `#fsui .cr-*`, on the shell's tokens (--fg, --fg-dim, --accent, --panel, --line) and the school's (--sc-ok,
// --sc-amber, --sc-g1, --sc-paper, --sc-ink), so the Career reads as part of the Flight School: the same glass
// cards, modal header and foot, badges, tables with tabular figures and the logbook paper. Its own additions: the
// hub card in the company's amber, the offer table and map, the load sheet columns with mass and CG bars, the
// warnings, the rank ladder, the debrief scores and the in-flight job strip.
//
// Layout rule (scripts/career-shots.mjs checks it at 1280x720 and 1600x900): no element under .cr-root may scroll
// sideways, so long text wraps (never an ellipsis) and number columns are nowrap but narrow.

/** The Career's stylesheet, scoped under #fsui (see the header). */
export const CAREER_CSS = /* css */ `
#fsui { --cr-gold: #ffc65c; --cr-red: #ff6b5b; --cr-green: #5fe39a; }
#fsui .cr-layer { position: absolute; inset: 0; pointer-events: none; }
#fsui .cr-layer > .cr-root { pointer-events: auto; }
#fsui .cr-root .num, #fsui .cr-strip .num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
#fsui .cr-root :is(b, td, span, small).ok { color: var(--sc-ok); }
#fsui .cr-root :is(b, td, span, small).warn { color: var(--sc-amber); }
#fsui .cr-root :is(b, td, span, small).bad { color: var(--cr-red); }
#fsui .cr-root :is(b, td, span).dim { color: var(--fg-dim); }
#fsui .cr-root b.strong { font-weight: 700; color: var(--fg); }
#fsui .cr-root .sc-body { overflow-x: hidden; }
#fsui .cr-root .sc-section { margin: 16px 0 8px; }
#fsui .cr-root .sc-section:first-child { margin-top: 0; }
#fsui .cr-root button:disabled { opacity: .42; cursor: default; }
#fsui .cr-root button:disabled:hover { background: rgba(255,255,255,.06); }
#fsui .cr-root button.primary:disabled:hover { background: var(--accent); }
#fsui .cr-root button.cr-danger { border-color: rgba(255,107,91,.45); color: #ffb3aa; }
#fsui .cr-root button.cr-danger:hover { background: rgba(255,107,91,.14); }
#fsui .cr-root button.cr-armed { border-color: var(--sc-amber); color: #ffd994; background: rgba(255,178,36,.14); }
#fsui .cr-root button.cr-small-btn { padding: 5px 10px; font-size: 12px; border-radius: 8px; }
#fsui .cr-root .sc-foot .sc-note.bad { color: #ffb3aa; }
#fsui .cr-root .sc-foot .sc-note { text-align: right; max-width: 52%; line-height: 1.35; }
#fsui .cr-icao { font: 650 10.5px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: .06em; padding: 3px 5px; border-radius: 4px;
  color: var(--fg-dim); border: 1px solid var(--line); background: rgba(255,255,255,.04); }
#fsui .cr-fine { color: var(--fg-dim); font-size: 12px; line-height: 1.45; margin-top: 10px; }
#fsui .cr-toasts { position: absolute; left: 50%; bottom: 40px; transform: translateX(-50%); display: flex; flex-direction: column; gap: 6px; align-items: center; pointer-events: none; }
#fsui .cr-toast { padding: 8px 14px; border-radius: 10px; background: rgba(10,14,20,.9); border: 1px solid var(--line); font-size: 13px; }

/* Bars */
#fsui .cr-bar { position: relative; display: block; height: 6px; border-radius: 3px; background: rgba(255,255,255,.1); overflow: hidden; }
#fsui .cr-bar > i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; background: var(--sc-ok); }
#fsui .cr-bar.bad > i { background: var(--cr-red); }
#fsui .cr-rep { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; }
#fsui .cr-rep .cr-bar > i { background: linear-gradient(90deg, #d99a2b, var(--cr-gold)); }
#fsui .cr-rep b { font-size: 15px; min-width: 26px; text-align: right; }

/* Label-value rows */
#fsui .cr-kv { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; padding: 4px 0; font-size: 13px; border-bottom: 1px solid var(--line); }
#fsui .cr-kv:last-child { border-bottom: none; }
#fsui .cr-kv > span { color: var(--fg-dim); min-width: 0; }
#fsui .cr-kv > b { font-weight: 600; white-space: nowrap; text-align: right; }
#fsui .cr-kv.cr-total { border-top: 1.5px solid rgba(255,255,255,.22); border-bottom: none; margin-top: 2px; padding-top: 7px; }
#fsui .cr-kv.cr-total > span { color: var(--fg); font-weight: 650; }
#fsui .cr-kv.cr-total > b { font-size: 15.5px; font-weight: 750; }
#fsui .cr-sheet { padding: 2px 12px; border-radius: 10px; background: rgba(255,255,255,.035); border: 1px solid var(--line); }
#fsui .cr-facts { margin: 4px 0 12px; padding: 2px 12px; border-radius: 10px; background: rgba(255,255,255,.04); border: 1px solid var(--line); }

/* Small cards: locked, seed, bankrupt */
#fsui .cr-small { width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto; padding: 26px 30px 22px; }
#fsui .cr-small.wide { width: min(620px, calc(100vw - 32px)); }
#fsui .cr-small h2 { margin: 0 0 8px; font-size: 23px; font-weight: 650; }
#fsui .cr-small > p { color: var(--fg-dim); margin: 0 0 14px; line-height: 1.5; font-size: 13.5px; }
#fsui .cr-seal { width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center; margin-bottom: 14px; color: var(--sc-amber);
  background: rgba(255,178,36,.12); border: 1px solid rgba(255,178,36,.35); }
#fsui .cr-seal svg { width: 34px; height: 34px; }
#fsui .cr-seal.world { color: var(--accent); background: rgba(82,195,255,.12); border-color: rgba(82,195,255,.35); }
#fsui .cr-seal.bad { color: var(--cr-red); background: rgba(255,107,91,.12); border-color: rgba(255,107,91,.4); }
#fsui .cr-need { display: grid; gap: 3px; padding: 11px 14px; border-radius: 11px; background: linear-gradient(160deg, rgba(255,178,36,.14), rgba(255,178,36,.04));
  border: 1px solid rgba(255,178,36,.35); margin-bottom: 16px; }
#fsui .cr-need b { font-size: 14.5px; }
#fsui .cr-need span { color: var(--fg-dim); font-size: 12.5px; }
#fsui .cr-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
#fsui .cr-actions.stack { flex-direction: column; align-items: stretch; }
#fsui .cr-actions.stack button { display: flex; justify-content: center; align-items: center; }

/* Hub */
#fsui .cr-hub-wrap { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(5,8,12,.64) 0%, rgba(5,8,12,.25) 430px, rgba(5,8,12,0) 70%);
  animation: fsui-fade .2s ease-out; }
#fsui .cr-hub { position: absolute; left: 20px; top: 20px; max-height: calc(100% - 40px); width: 372px; padding: 16px 18px 14px; overflow-y: auto; overflow-x: hidden; }
#fsui .cr-brand b { font-size: 16.5px; }
#fsui .cr-hub .sc-banner button { flex: none; }
#fsui .cr-root .sc-banner.bad { background: rgba(255,77,61,.12); border-color: rgba(255,77,61,.45); color: #ffc2bb; }
#fsui .cr-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 4px 0 10px; }
#fsui .cr-stat { padding: 9px 11px 10px; border-radius: 11px; background: rgba(255,255,255,.045); border: 1px solid var(--line); display: grid; gap: 4px; min-width: 0; }
#fsui .cr-stat.wide { grid-column: span 2; }
#fsui .cr-stat > span { font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--fg-dim); font-weight: 650; }
#fsui .cr-stat > b { font-size: 18px; font-weight: 700; white-space: nowrap; }
#fsui .cr-aircraft { padding: 11px 13px; border-radius: 12px; margin-bottom: 10px; background: linear-gradient(160deg, rgba(255,198,92,.14), rgba(255,198,92,.03));
  border: 1px solid rgba(255,198,92,.32); }
#fsui .cr-aircraft-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
#fsui .cr-aircraft-top b { font-size: 15px; }
#fsui .cr-aircraft-where { color: var(--fg-dim); font-size: 12.5px; line-height: 1.45; margin-top: 4px; }
#fsui .cr-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
#fsui .cr-root button.cr-chip { padding: 3px 9px; border-radius: 999px; font: 600 11.5px/1.4 ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
#fsui .cr-root button.cr-chip.sel { border-color: var(--cr-gold); color: var(--cr-gold); background: rgba(255,198,92,.12); }
#fsui .cr-nav { margin-top: 2px; }
#fsui .cr-nav button.primary { font-size: 14.5px; padding: 9px; }
#fsui .cr-mini { position: absolute; right: 20px; top: 20px; width: 290px; padding: 14px 16px 12px; display: grid; gap: 6px; }
#fsui .cr-mini-title { font-size: 14.5px; line-height: 1.3; }
#fsui .cr-mini-sub { font-size: 12px; color: var(--fg-dim); line-height: 1.4; }
#fsui .cr-mini-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 650; }
#fsui .cr-root button.cr-mini-btn { padding: 5px 10px; font-size: 12px; justify-self: start; }
#fsui .cr-mini-next { display: flex; justify-content: space-between; gap: 10px; font-size: 11.5px; color: var(--fg-dim); padding-top: 6px; border-top: 1px solid var(--line); }
#fsui .cr-mini-next b { color: var(--fg); font-weight: 600; text-align: right; }

/* Board and reposition */
#fsui .cr-board-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 360px); gap: 20px; align-items: start; }
#fsui .cr-offers { min-width: 0; }
#fsui .cr-offer-table th, #fsui .cr-offer-table td { white-space: nowrap; }
#fsui .cr-offer-table td { padding: 7px 10px 7px 0; vertical-align: middle; }
#fsui .cr-offer-table th:last-child, #fsui .cr-offer-table td:last-child { padding-right: 4px; }
#fsui .cr-offer-table td.cr-offer-job { white-space: normal; width: 100%; min-width: 180px; }
#fsui .cr-offer { cursor: pointer; }
#fsui .cr-offer:hover td { background: rgba(255,255,255,.035); }
#fsui .cr-offer.sel td { background: rgba(82,195,255,.11); }
#fsui .cr-offer.sel td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
#fsui .cr-offer.locked td { color: var(--fg-dim); }
#fsui .cr-offer.locked .cr-offer-top b { color: var(--fg-dim); }
#fsui .cr-offer.locked td.cr-pay { color: var(--fg-dim); }
#fsui .cr-offer-job { padding-left: 8px !important; }
#fsui .cr-offer-top { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 7px; }
#fsui .cr-offer-top b { font-size: 13.5px; font-weight: 600; }
#fsui .cr-offer-sub { color: var(--fg-dim); font-size: 11.5px; margin-top: 2px; line-height: 1.35; }
#fsui .cr-offer-why { color: var(--sc-amber); font-size: 11.5px; margin-top: 2px; font-weight: 600; }
#fsui .cr-kind { font-size: 9.5px; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; padding: 2px 6px; border-radius: 5px;
  color: #04121c; background: var(--fg-dim); white-space: nowrap; }
#fsui .cr-kind.charter { background: #52c3ff; }
#fsui .cr-kind.freight { background: #c9a36b; }
#fsui .cr-kind.mail { background: #ff8fa3; }
#fsui .cr-kind.scenic { background: #7be3b0; }
#fsui .cr-kind.positioning { background: #a9bccf; }
#fsui .cr-kind.medevac { background: #ff6b5b; color: #fff; }
#fsui .cr-kind.utility { background: #ffd36b; }
#fsui .cr-kind.premium { background: transparent; color: var(--cr-gold); border: 1px solid var(--cr-gold); }
#fsui .cr-kind.home { background: var(--cr-gold); }
#fsui .cr-kind.sealed { background: #a9bccf; }
#fsui .cr-kind.grass { background: #7fcf7a; }
#fsui .cr-offer.locked .cr-kind { opacity: .55; }
#fsui .cr-wx { line-height: 1.25; }
#fsui .cr-wx span { display: block; }
#fsui .cr-wx span.num { color: var(--fg-dim); font-size: 11.5px; }
#fsui .cr-wx-name.gusty, #fsui .cr-wx-name.rain { color: var(--sc-amber); }
#fsui .cr-wx-name.drizzle, #fsui .cr-wx-name.overcast { color: var(--sc-slate); }
#fsui td.cr-pay { font-weight: 700; font-size: 14px; color: var(--sc-ok); }
#fsui td.cr-pay.bad { color: var(--cr-red); }
#fsui .cr-board-side { display: grid; gap: 12px; position: sticky; top: 0; }
#fsui .cr-map svg { display: block; width: 100%; height: auto; }
#fsui .cr-map-bg { fill: rgba(8,12,18,.55); stroke: var(--line); }
#fsui .cr-map-grid { stroke: rgba(255,255,255,.05); stroke-width: 1; }
#fsui .cr-map-rwy { stroke: #c7d2dd; stroke-width: 3; stroke-linecap: round; opacity: .75; }
#fsui .cr-map-rwy.grass { stroke: #7fcf7a; }
#fsui .cr-map-rwy.home { stroke: var(--cr-gold); stroke-width: 4; }
#fsui .cr-map-dot { fill: #eef3f8; stroke: #0b1118; stroke-width: 1.5; }
#fsui .cr-map-dot.grass { fill: #9fe39a; }
#fsui .cr-map-dot.home { fill: var(--cr-gold); }
#fsui .cr-map-dot.dest { fill: var(--accent); }
#fsui .cr-map-here { fill: rgba(255,198,92,.16); stroke: var(--cr-gold); stroke-width: 1.5; }
#fsui .cr-map-code { fill: #c7d2dd; font: 600 11px ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: .04em; }
#fsui .cr-map-code.here { fill: var(--cr-gold); }
#fsui .cr-map-code.dest { fill: var(--accent); font-weight: 750; }
#fsui .cr-map-route { fill: none; stroke: var(--accent); stroke-width: 2.4; stroke-dasharray: 7 5; stroke-linejoin: round; }
#fsui .cr-map-arrowhead { fill: var(--accent); }
#fsui .cr-map-wp { fill: #0b1118; stroke: #7be3b0; stroke-width: 1.6; }
#fsui .cr-map-wpring { fill: rgba(123,227,176,.08); stroke: rgba(123,227,176,.35); stroke-dasharray: 3 3; }
#fsui .cr-map-wpnum { fill: #7be3b0; font: 750 10px Inter, system-ui, sans-serif; text-anchor: middle; }
#fsui .cr-map-north path { fill: var(--fg-dim); }
#fsui .cr-map-north text { fill: var(--fg-dim); font: 700 10px Inter, system-ui, sans-serif; text-anchor: middle; }
#fsui .cr-map-scale path { fill: none; stroke: var(--fg-dim); stroke-width: 1.5; }
#fsui .cr-map-scale text { fill: var(--fg-dim); font: 600 10.5px Inter, system-ui, sans-serif; }
#fsui .cr-map-wind circle { fill: rgba(255,255,255,.04); stroke: var(--line); }
#fsui .cr-map-wind line { stroke: var(--accent); stroke-width: 2; }
#fsui .cr-map-wind text { fill: var(--fg-dim); font: 600 10.5px Inter, system-ui, sans-serif; }
#fsui .cr-detail { padding: 11px 13px; border-radius: 11px; background: rgba(255,255,255,.04); border: 1px solid var(--line); }
#fsui .cr-detail-title { display: block; font-size: 14px; margin-bottom: 8px; }
#fsui .cr-detail-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
#fsui .cr-detail-facts div { display: grid; gap: 1px; min-width: 0; }
#fsui .cr-detail-facts span { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--fg-dim); font-weight: 650; }
#fsui .cr-detail-facts b { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
#fsui .cr-detail-wps { margin-top: 8px; font-size: 12px; color: var(--fg-dim); line-height: 1.45; }

/* Dispatch */
#fsui .cr-dispatch-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr); gap: 20px; align-items: start; }
#fsui .cr-col { min-width: 0; }
#fsui .cr-fleetpick { display: grid; gap: 6px; }
#fsui .cr-root button.cr-pick { text-align: left; padding: 8px 11px; display: grid; gap: 3px; border-radius: 10px; }
#fsui .cr-root button.cr-pick.sel { border-color: var(--accent); background: rgba(82,195,255,.13); box-shadow: inset 3px 0 0 var(--accent); }
#fsui .cr-pick-top { display: flex; align-items: center; gap: 8px; }
#fsui .cr-pick-top b { font-size: 13.5px; }
#fsui .cr-pick-sub { font-size: 11.5px; color: var(--fg-dim); }
#fsui .cr-note-box { margin-top: 8px; padding: 7px 10px; border-radius: 9px; font-size: 12px; line-height: 1.4; color: #bfe8ff;
  background: rgba(82,195,255,.1); border: 1px solid rgba(82,195,255,.3); }
#fsui .cr-note-box.bad { color: #ffc2bb; background: rgba(255,107,91,.1); border-color: rgba(255,107,91,.4); }
#fsui .cr-fuel { padding: 11px 13px 9px; border-radius: 11px; background: rgba(255,255,255,.035); border: 1px solid var(--line); }
#fsui .cr-fuel-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 10px; }
#fsui .cr-fuel-head b { font-size: 19px; font-weight: 700; }
#fsui .cr-fuel-head span { font-size: 11.5px; color: var(--fg-dim); }
#fsui .cr-root input.cr-slider { margin: 8px 0 6px; display: block; }
#fsui .cr-fuel-quick { display: flex; flex-wrap: wrap; gap: 5px; }
#fsui .cr-fuel-quick button { padding: 4px 8px; font-size: 11.5px; border-radius: 7px; }
#fsui .cr-fuel-money { margin-top: 6px; }
#fsui .cr-payload .sc-table td, #fsui .cr-payload .sc-table th { padding-right: 6px; }
#fsui .cr-payload tr.cr-dim td { color: var(--fg-dim); }
#fsui .cr-payload tr.cr-bad td { color: var(--cr-red); }
#fsui .cr-massbar { height: 5px; border-radius: 3px; background: rgba(255,255,255,.1); margin: 0 0 5px; position: relative; overflow: hidden; }
#fsui .cr-massbar i { position: absolute; left: 0; top: 0; bottom: 0; background: linear-gradient(90deg, #3fa9e0, var(--accent)); border-radius: 3px; }
#fsui .cr-massbar.over i { background: var(--cr-red); }
#fsui .cr-cg { padding: 2px 0 6px; }
#fsui .cr-cg .cr-kv { border-bottom: none; }
#fsui .cr-cgbar { position: relative; height: 12px; border-radius: 6px; background: rgba(255,255,255,.07); margin: 2px 0 3px; }
#fsui .cr-cgbar i.band { position: absolute; top: 0; bottom: 0; background: rgba(95,227,154,.25); border-left: 1.5px solid var(--sc-ok); border-right: 1.5px solid var(--sc-ok); }
#fsui .cr-cgbar i.mark { position: absolute; top: -3px; bottom: -3px; width: 4px; margin-left: -2px; border-radius: 2px; background: #fff; box-shadow: 0 0 6px rgba(0,0,0,.6); }
#fsui .cr-cgbar i.mark.out { background: var(--sc-amber); }
#fsui .cr-cg-ends { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--fg-dim); font-variant-numeric: tabular-nums; }
#fsui .cr-warnings { display: grid; gap: 5px; margin-top: 12px; }
#fsui .cr-warn { position: relative; padding: 6px 10px 6px 26px; border-radius: 8px; font-size: 12px; line-height: 1.38; }
#fsui .cr-warn::before { position: absolute; left: 9px; top: 6px; font-weight: 800; }
#fsui .cr-warn.block { color: #ffc2bb; background: rgba(255,77,61,.14); border: 1px solid rgba(255,77,61,.45); }
#fsui .cr-warn.block::before { content: "✕"; color: var(--alert); }
#fsui .cr-warn.warn { color: #ffd994; background: rgba(255,178,36,.1); border: 1px solid rgba(255,178,36,.38); }
#fsui .cr-warn.warn::before { content: "!"; color: var(--sc-amber); left: 11px; }
#fsui .cr-warn.ok { color: #b6f2cf; background: rgba(95,227,154,.08); border: 1px solid rgba(95,227,154,.3); }
#fsui .cr-warn.ok::before { content: "✓"; color: var(--sc-ok); }

/* Stop */
#fsui .cr-stop-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 22px; align-items: start; }

/* Fleet, market */
#fsui .cr-tabs { margin-bottom: 12px; }
#fsui .cr-fleet-table th, #fsui .cr-fleet-table td, #fsui .cr-market-table th, #fsui .cr-market-table td { white-space: nowrap; vertical-align: middle; }
#fsui .cr-fleet-table td.cr-offer-job, #fsui .cr-market-table td.cr-offer-job { white-space: normal; width: 100%; min-width: 170px; }
#fsui .cr-acts { display: flex; gap: 5px; justify-content: flex-end; }
#fsui td.cr-acts { display: table-cell; }
#fsui td.cr-acts button + button { margin-left: 5px; }
#fsui tr.cr-selrow td { background: rgba(255,198,92,.07); }
#fsui tr.cr-selrow td:first-child { box-shadow: inset 3px 0 0 var(--cr-gold); }
#fsui tr.cr-group td { padding-top: 12px; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); font-weight: 700; border-bottom-color: rgba(82,195,255,.25); }
#fsui tr.cr-dimrow td { color: var(--fg-dim); }
#fsui tr.cr-dimrow .cr-offer-top b { color: var(--fg-dim); }
#fsui td.cr-dim { color: var(--fg-dim); }
#fsui .cr-defuel { display: flex; align-items: center; gap: 12px; padding: 4px 6px; font-size: 12.5px; color: var(--fg-dim); }
#fsui .cr-defuel input.cr-slider { flex: 1; margin: 0; min-width: 120px; }
#fsui .cr-defuel b { color: var(--fg); white-space: nowrap; }
#fsui tr.cr-defuel-row td { background: rgba(255,255,255,.03); }

/* Pilot */
#fsui .cr-pilot-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, .9fr) minmax(0, 1.1fr); gap: 22px; align-items: start; }
#fsui .cr-ladder { display: grid; gap: 0; position: relative; }
#fsui .cr-rung { position: relative; display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 2px 10px; align-items: start; padding: 7px 0 9px; }
#fsui .cr-rung::before { content: ""; position: absolute; left: 10px; top: 24px; bottom: -6px; width: 2px; background: rgba(255,255,255,.1); }
#fsui .cr-rung:last-child::before { display: none; }
#fsui .cr-rung > i { width: 16px; height: 16px; margin: 2px 0 0 3px; border-radius: 50%; border: 2px solid rgba(255,255,255,.28); background: var(--panel-solid); position: relative; z-index: 1; }
#fsui .cr-rung.done > i { background: var(--sc-ok); border-color: var(--sc-ok); }
#fsui .cr-rung.current > i { background: var(--cr-gold); border-color: var(--cr-gold); box-shadow: 0 0 10px rgba(255,198,92,.6); }
#fsui .cr-rung.next > i { border-color: var(--accent); }
#fsui .cr-rung-text { display: grid; gap: 1px; min-width: 0; }
#fsui .cr-rung-text b { font-size: 13.5px; }
#fsui .cr-rung.current .cr-rung-text b { color: var(--cr-gold); }
#fsui .cr-rung:not(.done):not(.current) .cr-rung-text b { color: var(--fg-dim); }
#fsui .cr-rung-text span { font-size: 11.5px; color: var(--fg-dim); }
#fsui .cr-rung-pay { font-size: 12px; color: var(--sc-ok); font-weight: 650; white-space: nowrap; }
#fsui .cr-rung-prog { grid-column: 2 / span 2; display: grid; gap: 4px; margin-top: 6px; }
#fsui .cr-prog { display: grid; grid-template-columns: 74px minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: 11.5px; color: var(--fg-dim); }
#fsui .cr-prog > i.cr-bar > i { background: var(--accent); }
#fsui .cr-prog b { color: var(--fg); font-weight: 600; white-space: nowrap; }
#fsui .cr-minifacts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 10px; }
#fsui .cr-minifacts div { padding: 7px 9px; border-radius: 9px; background: rgba(255,255,255,.045); border: 1px solid var(--line); display: grid; gap: 1px; }
#fsui .cr-minifacts b { font-size: 15px; }
#fsui .cr-minifacts span { font-size: 10.5px; color: var(--fg-dim); }
#fsui tr.cr-totalrow td { font-weight: 700; border-top: 1.5px solid rgba(255,255,255,.22); }
#fsui .cr-ratings { display: grid; gap: 6px; }
#fsui .cr-rating { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 8px 11px; border-radius: 10px; background: rgba(255,255,255,.035); border: 1px solid var(--line); }
#fsui .cr-rating > div { display: grid; gap: 2px; min-width: 0; }
#fsui .cr-rating b { font-size: 13px; }
#fsui .cr-rating span { font-size: 11.5px; color: var(--fg-dim); line-height: 1.35; }
#fsui .cr-rating.held { border-color: rgba(95,227,154,.3); background: rgba(95,227,154,.05); }
#fsui .cr-rating button { flex: none; }
#fsui .cr-companyform { display: grid; gap: 7px; }
#fsui .cr-inrow { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 10px; align-items: center; font-size: 12.5px; color: var(--fg-dim); }
#fsui .cr-root input[type=text] { padding: 6px 9px; font-size: 13px; }
#fsui .cr-toggle { padding: 2px 0; font-size: 12.5px; line-height: 1.35; }
#fsui .cr-companyform > button { justify-self: start; }
#fsui .cr-io { display: grid; gap: 7px; }
#fsui .cr-io > button { justify-self: start; }
#fsui .cr-import { font: 12px/1.35 ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: var(--fg); background: rgba(255,255,255,.06); border: 1px solid var(--line);
  border-radius: 8px; padding: 6px 9px; resize: vertical; user-select: text; width: 100%; }

/* Logbook */
#fsui .cr-logbar { margin-bottom: 12px; }
#fsui .cr-paper table { table-layout: auto; }
#fsui .cr-paper td, #fsui .cr-paper th { white-space: nowrap; }
#fsui .cr-paper td.cr-remark { white-space: normal; font-size: 11px; color: var(--sc-ink-dim); min-width: 140px; }
#fsui .cr-paper tr.cr-business td { color: var(--sc-ink-dim); font-style: italic; }
#fsui .sc-paper .cr-ink.ok { color: #1d7a46; font-weight: 650; }
#fsui .sc-paper .cr-ink.bad { color: #b0322a; font-weight: 650; }
#fsui .sc-paper .cr-ink.warn { color: #9a6200; font-weight: 650; }
#fsui .cr-paper.cr-logline td { height: auto; }

/* Debrief */
#fsui .cr-deb-top { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 18px; align-items: center; margin-bottom: 14px; }
#fsui .cr-deb-head .sc-outcome { font-size: 30px; line-height: 1.1; }
#fsui .cr-deb-sum { margin-top: 6px; font-size: 14px; line-height: 1.5; color: #d5dee7; border-left: 3px solid var(--sc-teal); padding-left: 11px; }
#fsui .cr-deb-net { display: grid; justify-items: end; padding: 10px 16px; border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid var(--line); }
#fsui .cr-deb-net span { font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--fg-dim); font-weight: 650; }
#fsui .cr-deb-net b { font-size: 30px; font-weight: 750; line-height: 1.1; }
#fsui .cr-deb-net small { color: var(--fg-dim); font-size: 12px; }
#fsui .sc-banner.cr-promo { background: rgba(255,198,92,.13); border-color: rgba(255,198,92,.5); color: var(--cr-gold); font-weight: 650; }
#fsui .cr-deb-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr) minmax(0, 1fr); gap: 20px; align-items: start; }
#fsui .cr-lines .cr-kv > span { color: var(--fg); }
#fsui .cr-repafter { display: grid; gap: 4px; margin-top: 10px; font-size: 11.5px; color: var(--fg-dim); }
#fsui .cr-score { margin-bottom: 10px; }
#fsui .cr-score-top { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; color: var(--fg-dim); margin-bottom: 4px; }
#fsui .cr-score-top b { font-size: 20px; color: var(--fg); }
#fsui .cr-score .cr-bar > i { background: var(--accent); }
#fsui .cr-score .cr-bar.ok > i { background: var(--sc-ok); }
#fsui .cr-score .cr-bar.bad > i { background: var(--cr-red); }
#fsui .cr-score-note { font-size: 11.5px; color: var(--fg-dim); margin-top: 4px; line-height: 1.4; }
#fsui .cr-logline { margin-top: 2px; }

/* Create */
#fsui .cr-create-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 26px; align-items: start; }
#fsui .cr-formrow { grid-template-columns: 120px minmax(0, 1fr); align-items: start; }
#fsui .cr-formrow > label { padding-top: 7px; }
#fsui .cr-inputbox { display: grid; gap: 4px; min-width: 0; }
#fsui .cr-hint { font-size: 11.5px; color: var(--fg-dim); }
#fsui .cr-starts { display: grid; gap: 8px; }
#fsui .cr-root button.cr-start { text-align: left; display: grid; gap: 6px; padding: 12px 14px; border-radius: 12px; }
#fsui .cr-root button.cr-start.sel { border-color: var(--cr-gold); background: rgba(255,198,92,.1); box-shadow: inset 3px 0 0 var(--cr-gold); }
#fsui .cr-start-top { display: flex; align-items: center; gap: 8px; }
#fsui .cr-start-top b { font-size: 15px; }
#fsui .cr-start-blurb { font-size: 12.5px; color: var(--fg-dim); line-height: 1.4; }
#fsui .cr-start-figs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
#fsui .cr-start-figs div { display: grid; gap: 1px; }
#fsui .cr-start-figs span { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--fg-dim); font-weight: 650; }
#fsui .cr-start-figs b { font-size: 13px; }

/* In-flight job strip */
#fsui .cr-strip { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); width: min(620px, calc(100vw - 24px)); min-height: 54px;
  display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 7px 12px; padding: 8px 10px 8px 12px; border-radius: 12px;
  background: rgba(10,14,20,.74); backdrop-filter: blur(10px); border: 1px solid var(--line); box-shadow: 0 6px 24px rgba(0,0,0,.35); pointer-events: none; }
#fsui .cr-strip-left { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
#fsui .cr-phase { font-size: 10px; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; padding: 4px 7px; border-radius: 6px; white-space: nowrap;
  color: var(--accent); background: rgba(82,195,255,.13); }
#fsui .cr-phase.airborne { color: var(--sc-ok); background: rgba(95,227,154,.13); }
#fsui .cr-phase.stopped, #fsui .cr-phase.landed { color: var(--sc-amber); background: rgba(255,178,36,.13); }
#fsui .cr-strip button.cr-abandon { pointer-events: auto; padding: 3px 8px; font-size: 11px; border-radius: 6px; color: #ffb3aa; border-color: rgba(255,107,91,.45); }
#fsui .cr-strip-mid { min-width: 0; display: grid; gap: 1px; }
#fsui .cr-strip-mid b { font-size: 13.5px; font-weight: 600; line-height: 1.25; }
#fsui .cr-strip-target { font-size: 12px; color: #cfe6f7; }
#fsui .cr-strip-hint { font-size: 11.5px; color: var(--sc-amber); font-weight: 600; }
#fsui .cr-strip-chips { grid-column: 1 / -1; display: flex; flex-wrap: wrap; justify-content: center; gap: 5px; padding-top: 7px; border-top: 1px solid var(--line); }
#fsui .cr-chip2 { display: grid; gap: 1px; align-content: center; padding: 4px 8px; border-radius: 8px; background: rgba(0,0,0,.32); border: 1px solid var(--line); white-space: nowrap; font-size: 11px; }
#fsui .cr-chip2 b { font-size: 12.5px; font-weight: 700; }
#fsui .cr-chip2 span { font-size: 10px; color: var(--fg-dim); }
#fsui .cr-chip2.green { border-color: rgba(95,227,154,.45); }
#fsui .cr-chip2.green b { color: var(--sc-ok); }
#fsui .cr-chip2.amber { border-color: rgba(255,178,36,.55); }
#fsui .cr-chip2.amber b { color: var(--sc-amber); }
#fsui .cr-chip2.red { border-color: var(--alert); background: rgba(90,10,6,.6); }
#fsui .cr-chip2.red b { color: #ffb3aa; }
#fsui .cr-chip2.wind { font: 650 12px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: #cfe6f7; }
#fsui .cr-chip2.comfort { grid-template-columns: auto 34px auto; align-items: center; gap: 6px; }
#fsui .cr-chip2.comfort .cr-bar { height: 5px; }
#fsui .cr-chip2.comfort.green .cr-bar > i { background: var(--sc-ok); }
#fsui .cr-chip2.comfort.amber .cr-bar > i { background: var(--sc-amber); }
#fsui .cr-chip2.comfort.red .cr-bar > i { background: var(--alert); }
#fsui .cr-chip2.spot { color: var(--accent); font-weight: 700; font-size: 12px; }

@media (max-width: 1100px) {
  #fsui .cr-dispatch-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  #fsui .cr-dispatch-grid > .cr-col:first-child { grid-row: span 2; }
  #fsui .cr-pilot-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  #fsui .cr-pilot-grid > .cr-col:last-child { grid-column: span 2; }
  #fsui .cr-deb-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  #fsui .cr-deb-grid > .cr-col:last-child { grid-column: span 2; }
  #fsui .cr-board-grid { grid-template-columns: minmax(0, 1fr) 280px; }
}
`;
