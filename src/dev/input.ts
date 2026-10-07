// Input dev page: live readout of ctx.controls, the yoke indicator (as the UI would draw it), connected
// controllers with their conditioned axes, and the KEY_BINDINGS help table.
//
//   dev/input.html            fly the keys and watch the controls respond (the keyboard yoke and rudder hold
//                             position; 5 / Num 5 centres them); press Y for the mouse yoke
//   dev/input.html?ias=60     indicated airspeed for the keyboard authority limit, m/s (default 30)
//   dev/input.html?type=pa34  the keys, levers and switches of another type from the registry (c152, pa38, da20,
//                             pa34, da42): its help table, one line per engine, the engine selection (8 / 9 / 0)
//                             and the messages of the input system. With agl=0 the aircraft is on its wheels
//                             (in the air a twin's shut-down keys want one engine selected).

import { isAircraftId, loadAircraft } from '../aircraft/registry';
import type { SimContext } from '../core/context';
import { copyControls, defaultControls, engineControl } from '../core/types';
import { InputSystem, KEY_BINDINGS, keyBindingsFor } from '../input';
import { runHarness } from './harness';

const params = new URLSearchParams(location.search);
const ias = Number(params.get('ias') ?? 30);
const type = params.get('type');
// Without `type` the page is what it always was: the Cessna 172S.
const def = type && isAircraftId(type) ? await loadAircraft(type) : null;
let message = '';
const input = def ? new InputSystem({ profile: def.input, shell: { toast: (t) => void (message = t) } }) : new InputSystem();

const panel = document.createElement('div');
panel.style.cssText =
  'position:fixed;inset:0;display:grid;grid-template-columns:420px 1fr;gap:24px;padding:20px;font:13px/1.5 system-ui,sans-serif;color:#e8e8e8;background:#15181c;overflow:auto';
const left = document.createElement('div');
const right = document.createElement('div');
panel.append(left, right);

const yoke = document.createElement('canvas');
yoke.width = yoke.height = 180;
yoke.style.cssText = 'background:#0c0e11;border:1px solid #333;margin:8px 0';
const bars = document.createElement('div');
const status = document.createElement('pre');
status.style.cssText = 'margin:8px 0;white-space:pre-wrap';
const devices = document.createElement('pre');
devices.style.cssText = 'margin:8px 0;white-space:pre-wrap;color:#9fc3ff';
left.append(yoke, bars, status, devices);

const table = document.createElement('table');
table.style.cssText = 'border-collapse:collapse';
let lastCategory = '';
for (const b of def ? keyBindingsFor(def.input) : KEY_BINDINGS) {
  const tr = table.insertRow();
  if (b.category !== lastCategory) {
    const h = table.insertRow(tr.rowIndex);
    h.innerHTML = `<td colspan="2" style="padding:10px 0 2px;font-weight:600;color:#9fc3ff">${b.category}</td>`;
    lastCategory = b.category;
  }
  tr.innerHTML = `<td style="padding:1px 16px 1px 0;font-family:monospace">${b.keys}</td><td>${b.action}</td>`;
}
right.appendChild(table);

const bar = (name: string, v: number, lo: number, hi: number): string => {
  const f = (v - lo) / (hi - lo);
  const zero = (0 - lo) / (hi - lo);
  const a = Math.min(f, zero) * 100;
  const w = Math.abs(f - zero) * 100;
  return `<div style="display:flex;align-items:center;gap:8px"><span style="width:90px">${name}</span>
    <span style="position:relative;width:220px;height:10px;background:#262a30">
    <span style="position:absolute;left:${a}%;width:${Math.max(w, 0.5)}%;top:0;bottom:0;background:#5fa8ff"></span></span>
    <span style="font-family:monospace">${v.toFixed(3)}</span></div>`;
};

function draw(ctx: SimContext): void {
  const c = ctx.controls;
  const y = input.getYokeIndicator();
  const g = yoke.getContext('2d')!;
  g.clearRect(0, 0, 180, 180);
  g.strokeStyle = '#444';
  g.strokeRect(10, 10, 160, 160);
  g.beginPath();
  g.moveTo(90, 10);
  g.lineTo(90, 170);
  g.moveTo(10, 90);
  g.lineTo(170, 90);
  g.stroke();
  g.fillStyle = y.mouseYoke ? '#ffb13b' : '#5fa8ff';
  g.beginPath();
  g.arc(90 + y.aileron * 80, 90 + y.elevator * 80, 6, 0, Math.PI * 2);
  g.fill();
  g.fillRect(90 + y.rudder * 80 - 2, 172, 4, 6);

  bars.innerHTML = [
    bar('aileron', c.aileron, -1, 1),
    bar('elevator', c.elevator, -1, 1),
    bar('rudder', c.rudder, -1, 1),
    bar('trim', c.elevatorTrim, -1, 1),
    bar('throttle', c.throttle, 0, 1),
    bar('mixture', c.mixture, 0, 1),
    bar('flaps', c.flaps, 0, 1),
    bar('brake L', c.brakeLeft, 0, 1),
    bar('brake R', c.brakeRight, 0, 1),
  ].join('');
  const l = c.lights;
  status.textContent =
    `source ${y.source}${y.mouseYoke ? ' (mouse yoke)' : ''}   ias ${ias} m/s   keyboard ${y.keyboardOffCentre ? 'off centre (5 centres)' : 'centred'}\n` +
    `parking brake ${c.parkingBrake ? 'SET' : 'off'}   magnetos ${['OFF', 'R', 'L', 'BOTH'][c.magnetos]}   starter ${c.starter ? 'ENGAGED' : 'off'}\n` +
    `lights: nav ${+l.nav} beacon ${+l.beacon} strobe ${+l.strobe} landing ${+l.landing} taxi ${+l.taxi} panel ${l.panel}\n` +
    `master ${+c.masterBattery} alt ${+c.alternator} avionics ${+c.avionics} pump ${+c.fuelPump} pitot ${+c.pitotHeat} fuel ${c.fuelSelector}\n` +
    `bug ${c.headingBugDeg.toFixed(0)}  obs ${c.obsDeg.toFixed(0)}  kollsman ${c.kollsmanHpa.toFixed(0)} hPa  dgAlign ${+c.dgAlign}\n` +
    `camera ${ctx.cameraMode}   paused ${ctx.paused}`;
  if (def) {
    const sel = input.engineSelection;
    const engines = c.engines.map((_, i) => {
      const e = <K extends Parameters<typeof engineControl>[2]>(k: K) => engineControl(c, i, k);
      return (
        `${sel === 'all' || sel === i ? '>' : ' '} engine ${i + 1}: throttle ${e('throttle').toFixed(2)} prop ${e('propeller').toFixed(2)} mixture ${e('mixture').toFixed(2)}` +
        ` magnetos ${['OFF', 'R', 'L', 'BOTH'][e('magnetos')]} master ${+e('engineMaster')} starter ${+e('starter')} pump ${+e('fuelPump')}` +
        ` fuel ${e('fuelSelector')} carb heat ${e('carbHeat')} alt air ${+e('alternateAir')} cowl ${e('cowlFlaps')}`
      );
    });
    status.textContent +=
      `\n\n${def.shortName}   selected: ${sel === 'all' ? 'all engines' : sel === 0 ? 'left engine' : 'right engine'}\n${engines.join('\n')}\n` +
      `gear lever ${c.gearLever}${c.gearEmergency ? ' (emergency extension pulled)' : ''}   rudder trim ${c.rudderTrim.toFixed(2)}\n${message}`;
  }
  const list = input.gamepads.list();
  devices.textContent = list.length
    ? list
        .map((d) => `#${d.index} ${d.kind}: ${d.id}\n` + d.axes.map((a, i) => `  axis ${i} ${a.control.padEnd(12)} raw ${a.raw.toFixed(2)} -> ${a.value.toFixed(2)}`).join('\n'))
        .join('\n')
    : 'No game controllers detected (press a button on one to wake it).';
}

void runHarness({
  subsystems: [input, { init() {}, update: (_dt, ctx) => draw(ctx) }],
  setup(ctx) {
    ctx.state.ias = ias;
    if (def) {
      // The levers and engines of the type (a twin: two of each).
      copyControls(ctx.controls, defaultControls(def));
      while (ctx.state.engines.length < def.engineCount) ctx.state.engines.push({ ...ctx.state.engine });
    }
    document.body.appendChild(panel);
  },
});
