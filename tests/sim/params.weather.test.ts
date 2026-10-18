// URL weather parameters for the optional fields (src/sim/params.ts): top=, wx=, ctype=, mid=, precip=, fog=
// and cb=, their clamps, and the order wx= < the other weather parameters.

import { describe, expect, it } from 'vitest';
import { parseParams } from '../../src/sim/params';
import { NEUTRAL_EXTRAS, NO_STORMS } from '../../src/core/weatherFields';
import { CB_DEFAULT_INTENSITY, CB_DEFAULT_RADIUS_M, CB_DEFAULT_TOP_M, weatherPresetById } from '../../src/sim/weatherPresets';

const wx = (search: string) => parseParams(search).weather;

describe('URL weather parameters for the optional fields', () => {
  it('sets none of the fields when the parameters are absent', () => {
    const w = wx('?cover=0.5&base=1200');
    expect(w).toEqual({ cloudCover: 0.5, cloudBaseM: 1200 });
  });

  it('top= sets the cloud top, at least 100 m above a base given with it', () => {
    expect(wx('?top=3000').cloudTopM).toBe(3000);
    expect(wx('?base=1000&top=3000')).toMatchObject({ cloudBaseM: 1000, cloudTopM: 3000 });
    expect(wx('?base=1000&top=900').cloudTopM).toBe(1100);
    expect(wx('?wx=fair&top=1000').cloudTopM).toBe(1600); // the preset's base is 1500
  });

  it('ctype= takes the known cloud types only', () => {
    expect(wx('?ctype=stratus').cloudType).toBe('stratus');
    expect(wx('?ctype=towering').cloudType).toBe('towering');
    expect('cloudType' in wx('?ctype=lenticular')).toBe(false);
  });

  it('mid= reads the kind, the cover (clamped 0..1) and an optional altitude', () => {
    expect(wx('?mid=as,0.8')).toEqual({ midType: 'altostratus', midCover: 0.8 });
    expect(wx('?mid=ac,1.5,5200')).toEqual({ midType: 'altocumulus', midCover: 1, midAltM: 5200 });
    expect(wx('?mid=as,0.5,99999').midAltM).toBe(15_000);
    expect(wx('?mid=cs,0.5')).toEqual({});
    expect(wx('?mid=as')).toEqual({});
    expect(wx('?mid=as,x')).toEqual({});
  });

  it('precip= reads the type and the rate (clamped 0..50 mm/h)', () => {
    expect(wx('?precip=rain,4')).toEqual({ precipType: 'rain', precipRateMmH: 4 });
    expect(wx('?precip=snow,80')).toEqual({ precipType: 'snow', precipRateMmH: 50 });
    expect(wx('?precip=drizzle,-1')).toEqual({ precipType: 'drizzle', precipRateMmH: 0 });
    expect(wx('?precip=none')).toEqual({ precipType: 'none', precipRateMmH: 0 });
    expect(wx('?precip=hail,4')).toEqual({});
    expect(wx('?precip=rain')).toEqual({});
  });

  it('fog= reads the depth (0..300 m) and an optional visibility inside it (50..1000 m)', () => {
    expect(wx('?fog=60')).toEqual({ fogTopM: 60 });
    expect(wx('?fog=60,200')).toEqual({ fogTopM: 60, fogVisibilityM: 200 });
    expect(wx('?fog=500,10')).toEqual({ fogTopM: 300, fogVisibilityM: 50 });
    expect(wx('?fog=60,5000').fogVisibilityM).toBe(1000);
    expect(wx('?fog=a')).toEqual({});
  });

  it('cb= builds cells in km with defaults and clamps, repeatable up to 4', () => {
    const one = wx('?cb=-12,3').storms!;
    expect(one).toEqual([{ northM: -12_000, eastM: 3000, radiusM: CB_DEFAULT_RADIUS_M, topM: CB_DEFAULT_TOP_M, intensity: CB_DEFAULT_INTENSITY, motionDeg: 0, motionKt: 0 }]);
    const full = wx('?cb=1,2,12,0.5,2,270,15').storms!;
    expect(full).toEqual([{ northM: 1000, eastM: 2000, radiusM: 2000, topM: 12_000, intensity: 0.5, motionDeg: 270, motionKt: 15 }]);
    const clamped = wx('?cb=0,0,20,3,9,-90,-5').storms![0];
    expect(clamped).toMatchObject({ topM: 14_000, intensity: 1, radiusM: 5000, motionDeg: 270, motionKt: 0 });
    expect(wx('?cb=0,0,4').storms![0].topM).toBe(6000);
    const many = wx('?cb=0,0&cb=1,1&cb=2,2&cb=3,3&cb=4,4').storms!;
    expect(many).toHaveLength(4);
    expect(many.map((c) => c.northM)).toEqual([0, 1000, 2000, 3000]);
    // Malformed entries are skipped (a motion needs both values); none left: no storms key.
    expect(wx('?cb=1&cb=0,0,11,0.5,3,270').storms).toBeUndefined();
    expect(wx('?cb=x,1&cb=5,5').storms).toHaveLength(1);
  });

  it('wx= applies a preset first and the other parameters override it', () => {
    const fog = weatherPresetById('fog')!;
    expect(wx('?wx=fog')).toEqual({ ...fog.settings });
    expect(wx('?wx=fog')).toMatchObject({ ...NEUTRAL_EXTRAS, fogTopM: 60, fogVisibilityM: 200, visibilityM: 8000 });
    expect(wx('?wx=fog&vis=3000').visibilityM).toBe(3000);
    expect(wx('?vis=3000&wx=fog').visibilityM).toBe(3000); // parameter order in the URL does not matter
    expect(wx('?wx=fog&fog=120').fogTopM).toBe(120);
    expect(wx('?wx=thunderstorm').storms).toHaveLength(2);
    expect(wx('?wx=thunderstorm&cb=none').storms).toBe(NO_STORMS);
    expect(wx('?wx=thunderstorm&cb=0,0').storms).toHaveLength(1);
    expect(wx('?wx=nonesuch')).toEqual({});
  });

  it('base= over a preset keeps the preset layer depth', () => {
    // Thunderstorm: base 1400, top 3200.
    expect(wx('?wx=thunderstorm&base=2000')).toMatchObject({ cloudBaseM: 2000, cloudTopM: 3800 });
    expect(wx('?wx=thunderstorm&base=2000&top=2500')).toMatchObject({ cloudBaseM: 2000, cloudTopM: 2500 });
  });

  it('does not share the preset objects with the parsed weather', () => {
    const a = wx('?wx=rain');
    a.precipRateMmH = 20;
    expect(weatherPresetById('rain')!.settings.precipRateMmH).toBe(4);
  });
});
