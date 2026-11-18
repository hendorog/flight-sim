// The menu's winds-aloft table (src/ui/windsAloftTable.ts and its rows in src/ui/menu.ts): derived placeholders,
// rows to levels, levels at other altitudes kept, back to derived when no row is set.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SimContext } from '../../src/core/context';
import { makeMockEnvironment, makeMockState } from '../../src/core/mockState';
import C172S_DEFINITION from '../../src/aircraft/c172s/index';
import { FT } from '../../src/core/math';
import { defaultControls, defaultWeather } from '../../src/core/types';
import { windAloftAt, windFromDeg, windKt } from '../../src/physics/weather/windsAloft';
import { PauseMenu, type MenuHost, type SchoolMenuLink } from '../../src/ui/menu';
import { MENU_ALOFT_LEVELS_FT, aloftEdit, aloftRows, derivedTable, levelTemperatureC, tableFromRows } from '../../src/ui/windsAloftTable';
import { MAX_ALOFT_LEVELS, parseAloftParams, windsAloftOf } from '../../src/core/weatherFields';
import { FakeElement, installFakeDom } from './fakeDom';

beforeAll(installFakeDom);
afterAll(() => vi.unstubAllGlobals());

describe('winds-aloft table', () => {
  it('rows show the derived values; a row with a value becomes a level, its empty fields derived', () => {
    const w = defaultWeather();
    const rows = aloftRows(w);
    expect(rows.map((r) => r.altFt)).toEqual([...MENU_ALOFT_LEVELS_FT]);
    expect(rows.every((r) => r.manual === undefined)).toBe(true);
    const r18 = rows[4];
    const f = windAloftAt(w, 18000 * FT, { north: 0, east: 0 });
    expect(r18.derivedKt).toBe(Math.round(windKt(f)));
    expect(Math.abs(((r18.derivedDir - windFromDeg(f) + 540) % 360) - 180)).toBeLessThanOrEqual(5);
    const table = tableFromRows(w, [{ altFt: 18000, kt: 50 }, { altFt: 30000, dirDeg: 270, kt: 80, tempC: -40 }])!;
    expect(table).toEqual([
      { altFt: 18000, dirDeg: r18.derivedDir % 360, kt: 50 },
      { altFt: 30000, dirDeg: 270, kt: 80, tempC: -40 },
    ]);
    expect(Object.isFrozen(table)).toBe(true);
    const live = { ...w, windsAloft: table };
    expect(windKt(windAloftAt(live, 30000 * FT, { north: 0, east: 0 }))).toBeCloseTo(80, 9);
    expect(levelTemperatureC(live, 30000)).toBeCloseTo(-40, 6);
    expect(aloftRows(live)[6].manual).toEqual(table[1]);
  });

  it('no row set reads as derived; levels at other altitudes are kept; fill from derived sets all nine', () => {
    const w = { ...defaultWeather(), windsAloft: Object.freeze([{ altFt: 15000, dirDeg: 200, kt: 30 }]) };
    expect(tableFromRows(defaultWeather(), [{ altFt: 3000 }])).toBeUndefined();
    expect(tableFromRows(w, [])).toEqual([{ altFt: 15000, dirDeg: 200, kt: 30 }]);
    const all = derivedTable(defaultWeather());
    expect(all.map((l) => l.altFt)).toEqual([...MENU_ALOFT_LEVELS_FT]);
  });

  it('an edit past MAX_ALOFT_LEVELS is refused with a reason; every edit it accepts is a table windsAloftOf reads', () => {
    // 12 URL levels at altitudes the table does not show, then one row set: 13 levels, refused.
    const url = parseAloftParams(Array.from({ length: 12 }, (_, i) => `${4100 + i * 3500},270,${20 + i}`))!;
    expect(url).toHaveLength(12);
    const full = { ...defaultWeather(), windsAloft: url };
    const refused = aloftEdit(full, [{ altFt: 18000, kt: 50 }]);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain(`at most ${MAX_ALOFT_LEVELS} levels`);
    // Removing the row edit (no row set) keeps the URL table.
    const kept = aloftEdit(full, []);
    expect(kept.ok && kept.table).toEqual(url);
    // 3 URL levels plus all nine rows: 12, accepted and read back as stored.
    for (const n of [0, 3, 4]) {
      const w = { ...defaultWeather(), windsAloft: parseAloftParams(Array.from({ length: n }, (_, i) => `${4000 + i * 3500},270,30`)) };
      const r = aloftEdit(w, MENU_ALOFT_LEVELS_FT.map((altFt) => ({ altFt, kt: 40 })));
      if (n + MENU_ALOFT_LEVELS_FT.length <= MAX_ALOFT_LEVELS) {
        expect(r.ok).toBe(true);
        if (r.ok) expect(windsAloftOf({ ...w, windsAloft: r.table })).toBe(r.table);
      } else expect(r.ok).toBe(false);
    }
  });

  it('the Weather page holds the table: nine rows of three inputs and the mountain-wave slider', () => {
    const ctx = {
      era: 'present',
      state: makeMockState({ heightAGL: 0, tas: 0 }),
      env: makeMockEnvironment(),
      controls: defaultControls(C172S_DEFINITION),
      weather: defaultWeather(),
      simTime: 0,
      timeScale: 1,
      cameraMode: 'chase',
      quality: 'high',
      commands: {},
    } as unknown as SimContext;
    const school: SchoolMenuLink = { lessonActive: false, renderMenuPage() {}, command() {} };
    const host = { ctx, close() {}, toast() {}, weatherEdited() {}, hudEnabled: true, fpsVisible: false, autopilot: null, showHints() {}, school } as MenuHost;
    const parent = new FakeElement('div');
    const menu = new PauseMenu(parent as unknown as HTMLElement, [], host);
    menu.open('weather');
    const grids = parent.findAll('aloft');
    expect(grids).toHaveLength(1);
    const inputs = grids[0].children.filter((c) => c.tagName === 'input') as unknown as HTMLInputElement[];
    expect(inputs).toHaveLength(27);
    expect(inputs[0].placeholder).toBe(String(aloftRows(ctx.weather)[0].derivedDir).padStart(3, '0'));
    expect(parent.textContent).toContain('Mountain waves');
  });
});
