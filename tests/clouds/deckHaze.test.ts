// The march's uDeckHaze weight (CloudsEffect deckHaze): 0 for the 'auto' type without precipitation at any cover,
// so the march runs as before the cloud types and precipitation existed; the deck's closure times the type's deck
// weight or the precipitation's share of the visibility loss otherwise.
import { describe, expect, it } from 'vitest';
import { defaultWeather, type CloudType, type WeatherSettings } from '../../src/core/types';
import { CLOUD_TYPE_PROFILES, effectiveVisibilityM } from '../../src/core/weatherFields';
import { deckHaze } from '../../src/render/clouds/CloudsEffect';

const weather = (extra: Partial<WeatherSettings>): WeatherSettings => ({ ...defaultWeather(), ...extra }) as WeatherSettings;

describe('deckHaze', () => {
  it('is 0 without a cloud type or precipitation, at every cover', () => {
    for (const cloudCover of [0, 0.35, 0.8, 0.95, 1]) {
      expect(deckHaze(weather({ cloudCover }))).toBe(0);
      expect(deckHaze(weather({ cloudCover, cloudType: 'auto' }))).toBe(0);
      expect(deckHaze(weather({ cloudCover, cloudType: 'cumulus' }))).toBe(0);
      expect(deckHaze(weather({ cloudCover, cloudType: 'towering' }))).toBe(0);
    }
  });

  it('is the closure of the deck for the stratiform types', () => {
    for (const type of Object.keys(CLOUD_TYPE_PROFILES) as CloudType[]) {
      const p = CLOUD_TYPE_PROFILES[type];
      const deckType = p.deckOverride * p.deckWeight;
      expect(deckHaze(weather({ cloudType: type, cloudCover: 1 }))).toBe(deckType);
      expect(deckHaze(weather({ cloudType: type, cloudCover: 0.8 }))).toBe(0);
      expect(deckHaze(weather({ cloudType: type, cloudCover: 0.5 }))).toBe(0);
    }
  });

  it('takes the precipitation share of the visibility loss under a closed deck of any type', () => {
    const w = weather({ cloudCover: 1, precipType: 'rain', precipRateMmH: 4 });
    const share = 1 - effectiveVisibilityM(w) / w.visibilityM;
    expect(share).toBeGreaterThan(0.5);
    expect(deckHaze(w)).toBeCloseTo(share, 12);
    expect(deckHaze({ ...w, cloudCover: 0.6 })).toBe(0);
    expect(deckHaze({ ...w, precipRateMmH: 0 })).toBe(0);
  });
});
