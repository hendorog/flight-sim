// Night panel lighting for every type: the panel lamps run off each type's own bus (14 or 28 V), every aeroplane's
// flood lights at the night dimmer default, and the helicopters (no flood) hold the eye's adaptation with their
// instruments' own glow. Agent choices, panel-lighting work; see render/aircraft/cockpit.ts and cabinLight.ts.
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AIRCRAFT_IDS, type AircraftId } from '../../src/core/types';
import { loadAircraft, loadAirframeVisual } from '../../src/aircraft/registry';
import { NIGHT_PANEL_LIGHT } from '../../src/sim/SimPhysics';
import { AircraftVisual } from '../../src/render/aircraft/AircraftVisual';
import { cabinLamps, cockpitAdaptation } from '../../src/render/aircraft/cabinLight';
import { compassLight, panelPower } from '../../src/render/aircraft/cockpit';
import type { PanelDef } from '../../src/instruments/panelDef';
import { C172S_PANEL } from '../../src/aircraft/c172s/panel';
import { C152_PANEL } from '../../src/aircraft/c152/panel';
import { PA38_PANEL } from '../../src/aircraft/pa38/panel';
import { DA20_PANEL } from '../../src/aircraft/da20/panel';
import { PA34_PANEL } from '../../src/aircraft/pa34/panel';
import { C208_PANEL } from '../../src/aircraft/c208/panel';
import { R22_PANEL } from '../../src/aircraft/r22/panel';
import { R44_PANEL } from '../../src/aircraft/r44/panel';
import { S269_PANEL } from '../../src/aircraft/s269/panel';
import { blankDocument, fakeContext } from '../aircraft/meshChecks';

const PANELS: Record<AircraftId, PanelDef> = {
  c172s: C172S_PANEL, c152: C152_PANEL, pa38: PA38_PANEL, da20: DA20_PANEL, pa34: PA34_PANEL, da42: C172S_PANEL,
  c208: C208_PANEL, r22: R22_PANEL, r44: R44_PANEL, s269: S269_PANEL,
};
const lum = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

describe('panel power and compass curves', () => {
  it('a 14 V bus powers the panel as a 28 V one does', () => {
    expect(panelPower(28.4)).toBe(1);
    expect(panelPower(14.1, 14)).toBe(1);
    expect(panelPower(14.1)).toBe(0);
    expect(panelPower(10.5, 14)).toBeCloseTo(panelPower(21, 28), 12);
  });
  it('the helicopter compass keeps its day curve and takes the aeroplanes\' at night', () => {
    for (const level of [0.6, 0.8, 1]) expect(compassLight(level, false)).toBeCloseTo(level, 12);
    for (const level of [0, 0.1, NIGHT_PANEL_LIGHT, 0.45]) expect(compassLight(level, false)).toBeCloseTo(compassLight(level), 12);
  });
});

describe('every type lights its panel at night', () => {
  beforeAll(() => vi.stubGlobal('document', blankDocument()));
  afterAll(() => vi.unstubAllGlobals());

  for (const id of AIRCRAFT_IDS) {
    it(`${id}: the visual's bus voltage is the powerplant's, and the panel lights at the night dimmer`, async () => {
      const [def, airframe] = await Promise.all([loadAircraft(id), loadAirframeVisual(id)]);
      const nominal = def.powerplant.electrical.nominalVolts;
      const visualVolts = airframe.rotorcraftVisual ? (airframe.rotorcraftVisual.nominalVoltage ?? 14) : (airframe.nominalVoltage ?? 28);
      expect(visualVolts).toBe(nominal);

      // A lit flood left behind by another aircraft must not carry over.
      cabinLamps.floodColor.value.setRGB(1, 1, 1);
      cockpitAdaptation.panelGlow = 1;
      const ctx = fakeContext(airframe.props.length || 1);
      const visual = new AircraftVisual({ asyncBake: false, airframe, panelDef: PANELS[id] });
      visual.setPanelEmissiveTexture(new THREE.Texture());
      visual.init(ctx);
      expect(lum(cabinLamps.floodColor.value)).toBe(0);
      expect(cockpitAdaptation.panelGlow).toBe(0);

      ctx.cameraMode = 'cockpit';
      ctx.controls.lights.panel = NIGHT_PANEL_LIGHT;
      ctx.state.electrical.busVoltage = nominal + 0.1;
      visual.update(1 / 60, ctx);
      if (airframe.rotorcraft) {
        // No flood: the console's own glow holds the adaptation.
        expect(lum(cabinLamps.floodColor.value)).toBe(0);
        expect(cockpitAdaptation.panelGlow).toBeGreaterThan(0);
        // NAV interlock (R44): with NAV off the dial markings are dark, so only the displays' share of glow stays.
        // Checked at the night dimmer and at full, where the markings carry most of the glow.
        for (const level of [NIGHT_PANEL_LIGHT, 1]) {
          ctx.controls.lights.panel = level;
          ctx.controls.lights.nav = true;
          visual.update(1 / 60, ctx);
          const navOn = cockpitAdaptation.panelGlow;
          ctx.controls.lights.nav = false;
          visual.update(1 / 60, ctx);
          const navOff = cockpitAdaptation.panelGlow;
          if (PANELS[id].lightingRequiresNav) {
            expect(navOff).toBeGreaterThan(0);
            expect(navOff).toBeLessThan(level === 1 ? 0.2 * navOn : navOn);
          } else expect(navOff).toBe(navOn);
        }
      } else {
        const flood = cabinLamps.floodColor.value;
        expect(lum(flood)).toBeGreaterThan(0);
        if (airframe.cockpit.lamps.flood.colour === 'red') expect(flood.r).toBeGreaterThan(10 * flood.g);
        // Weighted for the eye as the Cessna 172S's flood at the same setting: the same light on the panel.
        expect(lum(flood) * cockpitAdaptation.floodExposure).toBeCloseTo(airframe.cockpit.lamps.flood.colour === 'red' ? 0.02 * lumRed() : 0.02, 6);
        expect(cockpitAdaptation.panelGlow).toBe(0);
        // A dead bus: dark.
        ctx.state.electrical.busVoltage = 0;
        visual.update(1 / 60, ctx);
        expect(lum(cabinLamps.floodColor.value)).toBe(0);
      }
      visual.dispose();
      expect(lum(cabinLamps.floodColor.value)).toBe(0);
    }, 30_000);
  }
});

/** Luminance of the red flood relative to the white one (cockpit.ts LAMP_RED: the white lamp behind a red filter). */
function lumRed(): number {
  const w = new THREE.Color(1.0, 0.8, 0.6).multiplyScalar(1 / (0.2126 + 0.7152 * 0.8 + 0.0722 * 0.6));
  return lum(new THREE.Color(w.r, w.g * 0.1, w.b * 0.033));
}

describe('the Piper floods keep the compass deviation card out of their beam core (look review, agent choice)', () => {
  // The card hangs 0.068 m under the compass pivot (compass.ts) facing aft. Lit in the beam's core it clipped at full
  // dimmer (PA38 61 %, PA34 52 % of its pixels): the PA38 lamp now sits just aft of and above the compass, so the card
  // takes it at a grazing angle; the PA34 lamp sits over the pilot's side, the card at its soft edge.
  for (const id of ['pa38', 'pa34'] as const) {
    it(`${id}: the card is outside the full-intensity cone or nearly edge-on to the lamp`, async () => {
      const airframe = await loadAirframeVisual(id);
      const { flood } = airframe.cockpit.lamps;
      const compass = airframe.cockpit.compass!.pos;
      const card = new THREE.Vector3(compass[0], compass[1], compass[2] + 0.068);
      const pos = new THREE.Vector3(...flood.pos);
      const axis = new THREE.Vector3(...flood.aim).sub(pos).normalize();
      const toCard = card.clone().sub(pos);
      const dist = toCard.length();
      toCard.normalize();
      const offAxis = (Math.acos(axis.dot(toCard)) * 180) / Math.PI;
      const inner = (flood.cone ?? [44, 24])[1];
      // Cosine of incidence on the aft-facing card (FRD: aft is -x).
      const incidence = Math.max(0, toCard.x);
      const relativeLux = ((flood.cd ?? 5) * (offAxis > inner ? 0.5 : 1) * incidence) / (dist * dist);
      // The Cessna 172S's card (no clip at full): ~29 relative units by the same estimate.
      expect(offAxis > inner || incidence < 0.3).toBe(true);
      expect(relativeLux).toBeLessThan(29);
    });
  }
});
