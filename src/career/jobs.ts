// Job boards (docs/career.md "Job generation"): the offers at one field on one career day, a pure function of
// (world seed, career day, origin field, the world's fields). Generation never looks at the player (reputation,
// fleet, cash): an offer the player cannot take is shown locked by the board, and the dispatch load sheet decides
// eligibility. Every number comes from the rule tables in types.ts and the arithmetic in costs.ts and fit.ts, so the
// board, the load sheet and the settlement agree.
//
// THE STREAM. One careerRng (rng.ts) per board, keyed `${seed}|${day}|${origin}`; never Math.random, never the
// world's siting stream. tests/career/boards.golden.json pins its draws, so the ORDER BELOW IS FROZEN: a change re-
// rolls every board (and the meaning of the ids in a save's `taken`). Wave-4 kinds (medevac, utility, landmark
// scenics) come from a second stream salted BOARD_RULES.wave4Salt and are appended after these with `-w` ids.
//
//   1. count = minOffers + floor(r x (extraOffers + 1))                                     (one draw)
//   per slot i (id `${day}-${origin}-${i}`):
//   2. kind by PAY_RULES weight over charter, freight, mail, scenic, positioning (mail 0 once a board has one)
//   3. scenic only: the turning points (scenicRoute: count, then per attempt length, start bearing, spread and one
//      radius factor per point; up to SCENIC_ATTEMPTS attempts; none clear of the fields -> the slot is a charter)
//   4. slots 0-2: the fixed class (BOARD_RULES.fixedSlots, or the cheapest class able to use the origin and some
//      other field; never a twin for a scenic), then the destination among the fields that class can reach;
//      later slots: the destination among every other field, then the class by CLASS_RULES weight over the classes
//      some type of which can use both ends (no twin for a scenic). Scenic: the destination is the origin (no draw).
//      Positioning picks among the fields POSITIONING_PREFER_NM or more away when there are any.
//   5. later slots only: premium (PREMIUM_RULES.share), then its tier (one draw, 50/50) when premium
//   6. weather by WEATHER_PAY weight, wind direction 0..359 deg, wind speed in the preset's range (whole kt)
//   7. payload: passengers (count), then each one's bag; or the cargo kg (and the freight's goods name)
//   8. client: the town (origin or destination, one draw; scenic: the origin, no draw) and the business name
// Then, with no draws: the reference type (the first type of the class, in CAREER_AIRCRAFT_IDS order, that fitOffer
// accepts), trimming the payload while none does (a passenger and their bag at a time down to one passenger, cargo
// 10 kg at a time down to 10 kg; still none: the slot becomes a positioning flight), the pay and the deadline.
//
// Payload: passengers are OCCUPANT_KG each with a bag (trainers 0-10 kg, a 0 kg bag is no item; others 5-15 kg),
// scenic passengers included. Cargo is split into pieces that fill the class's smallest type in assignStations's
// order (its baggage bay, its cargo hold, then one piece per free seat up to the seat's share of the station limit),
// so trainer freight sits in the baggage bay and on the right seat and tourer freight over the baggage limit on the
// rear seats; a bigger type of the class takes the same pieces with its own stowage.
//
// Rounding: the route length to 0.1 NM, every mass to a whole kg, the pay to $5 (costs.ts offerPay) and the deadline
// up to 5 min, so a board is stable in JSON and the tests can recompute pay and deadline from the offer alone.
// repRequired is the class's plus the kind's, or for a premium offer the larger of that and its tier's figure.

import { NM } from '../core/math';
import type { Airfield } from '../world/airfields';
import { groundSpeedKt, offerPay, payFloor, payFormula } from './costs';
import { fitOffer, offerGroundSpeedKt, routeWindOf } from './fit';
import { compassName, distanceM, distanceNm, placeName, requireField } from './geo';
import { CAREER_PERF } from './perf';
import { boardRng, type CareerRng } from './rng';
import { CAREER_STATIONS } from './stations';
import {
  BOARD_RULES, CAREER_AIRCRAFT_IDS, CLASS_RULES, CLOCK_RULES, DEADLINE_RULES, OCCUPANT_KG, PAY_RULES, PREMIUM_RULES,
  WEATHER_PAY, type AircraftClass, type CareerAircraftId, type CareerWeatherId, type JobKind, type JobOffer,
  type OfferItem, type Station, type Waypoint,
} from './types';

/** The kinds of the base stream, in draw order. */
export const BASE_JOB_KINDS = ['charter', 'freight', 'mail', 'scenic', 'positioning'] as const satisfies readonly JobKind[];
/** Every class, in the order the drawn slots weigh them. */
export const CLASS_DRAW_ORDER = ['trainer', 'tourer', 'twin', 'turbine', 'heli', 'heliTurbine'] as const satisfies readonly AircraftClass[];
/** Weather presets in draw order. */
export const WEATHER_IDS = ['clear', 'fair', 'overcast', 'gusty', 'drizzle', 'rain'] as const satisfies readonly CareerWeatherId[];

/** A positioning flight prefers destinations at least this far away, NM (when there are any). */
export const POSITIONING_PREFER_NM = 25;
/** Attempts at a scenic loop clear of every field before the slot becomes a charter. */
export const SCENIC_ATTEMPTS = 24;

type BaseKind = (typeof BASE_JOB_KINDS)[number];

/** Payload ranges by kind and class (docs/career.md): passengers [lo, hi] or cargo kg [lo, hi]; null: not offered. */
export const PAYLOAD_RULES: Readonly<Record<'charter' | 'freight' | 'mail' | 'scenic', Readonly<Record<AircraftClass, readonly [number, number] | null>>>> = {
  charter: { trainer: [1, 1], tourer: [1, 3], twin: [2, 5], turbine: [4, 9], heli: [1, 3], heliTurbine: [2, 4] },
  freight: { trainer: [20, 70], tourer: [60, 200], twin: [150, 400], turbine: [300, 900], heli: [30, 90], heliTurbine: [80, 300] },
  mail: { trainer: [15, 45], tourer: [30, 90], twin: [60, 180], turbine: [100, 300], heli: [15, 45], heliTurbine: [30, 120] },
  scenic: { trainer: [1, 1], tourer: [1, 3], twin: null, turbine: [4, 9], heli: [1, 2], heliTurbine: [2, 4] },
};

/** A passenger's bag, kg [lo, hi]: trainers carry little (0: no bag), the others 5-15 kg. */
export const BAG_KG: Readonly<Record<'trainer' | 'other', readonly [number, number]>> = { trainer: [0, 10], other: [5, 15] };

/** Scenic loop shape: turning points 2 or 3, spread of their bearings from the origin, deg, and the radius factor range. */
export const SCENIC_SHAPE = { pointsMin: 2, pointsMax: 3, spreadDeg: [60, 140], radiusFactor: [0.8, 1.2] } as const;

const CHARTER_CLIENTS = ['Estates', 'Travel', 'Law Partners', 'Golf Club', 'Rugby Club', 'Consulting', 'Auctioneers'];
const FREIGHT_CLIENTS = ['Joinery', 'Engineering', 'Garden Centre', 'Print Works', 'Farm Supplies', 'Motor Spares', 'Dairy'];
const MAIL_CLIENTS = ['Post Office', 'Sorting Office', 'Courier Depot'];
const SCENIC_CLIENTS = ['Tours', 'Visitor Centre', 'Photography Club', 'Country Hotel', 'Walking Club'];
const POSITIONING_CLIENTS = ['Flying Group', 'Aero Club', 'Air Services', 'Aviation'];
const FREIGHT_GOODS = ['Engine parts', 'Spare wheels', 'Seed potatoes', 'Printed matter', 'Laboratory samples', 'Cut flowers', 'Hand tools'];

// --------------------------------------------------------------------------------------------- types and fields

/** The Career types of a class, in CAREER_AIRCRAFT_IDS (market, smallest first) order. */
export function classTypes(cls: AircraftClass): CareerAircraftId[] {
  return CAREER_AIRCRAFT_IDS.filter((t) => CAREER_PERF[t].cls === cls);
}

/** True when a type may use a field's runway (length >= minRunwayM; a grass strip only if grassOk), as fitOffer's runway rule. */
export function typeUsesField(type: CareerAircraftId, f: Airfield): boolean {
  const p = CAREER_PERF[type];
  return f.length >= p.minRunwayM && (f.kind !== 'grass' || p.grassOk);
}

/** True when some one type of the class can use both fields. */
export function classUsesBoth(cls: AircraftClass, a: Airfield, b: Airfield): boolean {
  return classTypes(cls).some((t) => typeUsesField(t, a) && typeUsesField(t, b));
}

/** Classes from the cheapest to fly (the least lease rate of its types) to the dearest; the fixed slots fall back along it. */
export const CLASS_COST_ORDER: readonly AircraftClass[] = [...CLASS_DRAW_ORDER].sort(
  (a, b) => Math.min(...classTypes(a).map((t) => CAREER_PERF[t].leaseHourly)) - Math.min(...classTypes(b).map((t) => CAREER_PERF[t].leaseHourly)),
);

// --------------------------------------------------------------------------------------------- pay, deadline

/** The deadline of an offer, min: round up to 5 min of (taxiMin + 60 d / gs x slack + marginMin), gs on the least class's refTas in the offer's wind. */
export function offerDeadlineMin(offer: JobOffer, fields: readonly Airfield[]): number {
  const gs = groundSpeedKt(CLASS_RULES[offer.minClass].refTasKt, routeWindOf(offer, fields), offer.windDirDeg, offer.windKt);
  const raw = CLASS_RULES[offer.minClass].taxiMin + ((60 * offer.distanceNm) / gs) * PAY_RULES[offer.kind].deadlineSlack + DEADLINE_RULES.marginMin;
  const step = DEADLINE_RULES.roundToMin;
  return Math.ceil(raw / step - 1e-9) * step;
}

/** Freight and mail kg of an offer (passengers and their bags excluded): the perKg term of the pay. */
export function offerCargoKg(offer: Pick<JobOffer, 'payload'>): number {
  return offer.payload.reduce((s, it) => s + (it.kind === 'freight' || it.kind === 'mail' ? it.kg : 0), 0);
}

/**
 * The pay of an offer, whole $: costs.ts offerPay of the formula (with `premiumMult`) and the floor of its refType
 * (payFloor at the refType's ground speed on the route, with the kind's floorPremium).
 */
export function offerPayUsd(offer: JobOffer, fields: readonly Airfield[], premiumMult: number): number {
  const formula = payFormula(offer.kind, offer.distanceNm, offer.pax, offerCargoKg(offer), offer.minClass, offer.weather, premiumMult);
  const ref = CAREER_PERF[offer.refType];
  const floor = payFloor(ref, offer.distanceNm, offerGroundSpeedKt(offer, offer.refType, fields), PAY_RULES[offer.kind].floorPremium);
  return offerPay(formula, floor);
}

/** The first type of the offer's class whose fitOffer accepts it, or null. */
export function referenceType(offer: JobOffer, fields: readonly Airfield[]): CareerAircraftId | null {
  return classTypes(offer.minClass).find((t) => fitOffer(offer, t, fields) === null) ?? null;
}

// --------------------------------------------------------------------------------------------- scenic loops

/**
 * Turning points of a scenic loop from the origin (2 or 3, BOARD_RULES): a fan of points around a start bearing,
 * scaled so the loop origin -> points -> origin is 15-35 NM, each point at least scenicFieldClearM from every field.
 * Null when SCENIC_ATTEMPTS draws find none clear.
 */
function scenicRoute(rng: CareerRng, origin: Airfield, fields: readonly Airfield[]): { points: Waypoint[]; lengthNm: number } | null {
  const R = BOARD_RULES;
  const n = rng.int(SCENIC_SHAPE.pointsMin, SCENIC_SHAPE.pointsMax);
  for (let attempt = 0; attempt < SCENIC_ATTEMPTS; attempt++) {
    const lengthNm = Math.round(rng.range(R.scenicMinNm, R.scenicMaxNm) * 10) / 10;
    const start = rng.range(0, 360);
    const spread = rng.range(SCENIC_SHAPE.spreadDeg[0], SCENIC_SHAPE.spreadDeg[1]);
    const unit: { north: number; east: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = ((start - spread / 2 + (spread * i) / (n - 1)) * Math.PI) / 180;
      const k = rng.range(SCENIC_SHAPE.radiusFactor[0], SCENIC_SHAPE.radiusFactor[1]);
      unit.push({ north: k * Math.cos(a), east: k * Math.sin(a) });
    }
    const o = { north: 0, east: 0 };
    let len = distanceM(o, unit[0]) + distanceM(unit[n - 1], o);
    for (let i = 1; i < n; i++) len += distanceM(unit[i - 1], unit[i]);
    const scale = (lengthNm * NM) / len;
    const pts = unit.map((u) => ({ north: origin.north + u.north * scale, east: origin.east + u.east * scale }));
    if (!pts.every((p) => fields.every((f) => distanceM(f, p) >= R.scenicFieldClearM))) continue;
    const points = pts.map((p, i): Waypoint => {
      const nm = Math.round(distanceNm(origin, p));
      const brg = (Math.atan2(p.east - origin.east, p.north - origin.north) * 180) / Math.PI;
      return {
        name: `Point ${String.fromCharCode(65 + i)}, ${nm} NM ${compassName(brg)}`,
        north: p.north, east: p.east, radiusM: R.scenicRadiusM, maxAglFt: R.scenicMaxAglFt,
      };
    });
    return { points, lengthNm };
  }
  return null;
}

// --------------------------------------------------------------------------------------------- payload

/** Cargo kg split into pieces that fill the class's smallest type: its holds, then a piece per free seat. */
function cargoPieces(kg: number, cls: AircraftClass): number[] {
  const type = classTypes(cls)[0];
  const limits = CAREER_PERF[type].stationMaxKg;
  const seats = CAREER_STATIONS[type].seats;
  const pieces: number[] = [];
  let left = kg;
  const take = (cap: number) => {
    if (left <= 0 || cap <= 0) return;
    const p = Math.min(left, cap);
    pieces.push(p);
    left -= p;
  };
  for (const hold of ['baggage', 'cargo'] as const) take(limits[hold] ?? 0);
  for (const seat of ['rear', 'cabin', 'front'] as const satisfies readonly Station[]) {
    const n = seats[seat] ?? 0;
    const cap = n > 0 ? Math.floor((limits[seat] ?? 0) / n) : 0;
    for (let i = 0; i < n; i++) take(cap);
  }
  if (left > 0) pieces.push(left);
  return pieces;
}

/** What step 7 drew: passengers and their bags, or a cargo mass (with the freight's goods). */
type Load = { kind: 'people'; bags: number[] } | { kind: 'cargo'; kg: number; goods: string } | { kind: 'none' };

/** The offer's items for a drawn load. */
function itemsOf(load: Load, jobKind: JobKind, cls: AircraftClass): OfferItem[] {
  if (load.kind === 'none') return [];
  if (load.kind === 'people') {
    const people = load.bags.map((_, i): OfferItem => ({ kind: 'passenger', label: `Passenger ${i + 1}`, kg: OCCUPANT_KG }));
    const bags = load.bags.flatMap((kg, i): OfferItem[] => (kg > 0 ? [{ kind: 'baggage', label: `Bag, passenger ${i + 1}`, kg }] : []));
    return [...people, ...bags];
  }
  const pieces = cargoPieces(load.kg, cls);
  const kind = jobKind === 'mail' ? 'mail' : 'freight';
  const name = jobKind === 'mail' ? 'Mail bags' : load.goods;
  return pieces.map((kg, i): OfferItem => ({ kind, label: pieces.length > 1 ? `${name} (${i + 1} of ${pieces.length})` : name, kg }));
}

/** One step smaller, or null at the smallest (one passenger; 10 kg of cargo). */
function trimmed(load: Load): Load | null {
  if (load.kind === 'people') return load.bags.length > 1 ? { kind: 'people', bags: load.bags.slice(0, -1) } : null;
  if (load.kind === 'cargo') return load.kg > 10 ? { ...load, kg: Math.max(10, load.kg - 10) } : null;
  return null;
}

// --------------------------------------------------------------------------------------------- the board

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The draws and choices of one slot, before the reference type, pay and deadline. */
interface Slot {
  kind: BaseKind;
  cls: AircraftClass;
  dest: Airfield;
  waypoints?: Waypoint[];
  loopNm?: number;
  premiumTier: number;
  weather: CareerWeatherId;
  windDirDeg: number;
  windKt: number;
  load: Load;
  town: string;
  business: string;
}

/** Step 4's fixed-slot class: the slot's class, or the cheapest able to use the origin and reach some other field. */
function fixedClass(want: AircraftClass, kind: BaseKind, origin: Airfield, others: readonly Airfield[]): AircraftClass {
  const ok = (c: AircraftClass) =>
    !(kind === 'scenic' && c === 'twin') && (kind === 'scenic' ? classUsesBoth(c, origin, origin) : others.some((f) => classUsesBoth(c, origin, f)));
  if (ok(want)) return want;
  const c = CLASS_COST_ORDER.find(ok);
  if (!c) throw new Error(`jobs: no class can use ${origin.code}`);
  return c;
}

/** A destination by step 4's rule (positioning prefers the far fields). */
function pickDestination(rng: CareerRng, kind: BaseKind, origin: Airfield, candidates: readonly Airfield[]): Airfield {
  if (candidates.length === 0) throw new Error(`jobs: no destination from ${origin.code}`);
  if (kind === 'positioning') {
    const far = candidates.filter((f) => distanceNm(origin, f) >= POSITIONING_PREFER_NM);
    if (far.length > 0) return rng.pick(far);
  }
  return rng.pick(candidates);
}

/** Steps 2 to 8 for slot `index`. */
function drawSlot(rng: CareerRng, index: number, origin: Airfield, fields: readonly Airfield[], mailUsed: boolean): Slot {
  // 2. kind
  let kind: BaseKind = rng.weighted(BASE_JOB_KINDS, (k) => (k === 'mail' && mailUsed ? 0 : PAY_RULES[k].weight));
  // 3. scenic loop
  let route: { points: Waypoint[]; lengthNm: number } | null = null;
  if (kind === 'scenic') {
    route = scenicRoute(rng, origin, fields);
    if (!route) kind = 'charter';
  }
  // 4. class and destination
  const others = fields.filter((f) => f.code !== origin.code);
  let cls: AircraftClass;
  let dest: Airfield;
  if (index < BOARD_RULES.fixedSlots.length) {
    cls = fixedClass(BOARD_RULES.fixedSlots[index], kind, origin, others);
    dest = kind === 'scenic' ? origin : pickDestination(rng, kind, origin, others.filter((f) => classUsesBoth(cls, origin, f)));
  } else {
    dest = kind === 'scenic' ? origin : pickDestination(rng, kind, origin, others);
    cls = rng.weighted(CLASS_DRAW_ORDER, (c) => (kind === 'scenic' && c === 'twin') || !classUsesBoth(c, origin, dest) ? 0 : CLASS_RULES[c].weight);
  }
  // 5. premium
  let premiumTier = -1;
  if (index >= BOARD_RULES.fixedSlots.length && rng.chance(PREMIUM_RULES.share)) premiumTier = rng.chance(0.5) ? 1 : 0;
  // 6. weather and wind
  const weather = rng.weighted(WEATHER_IDS, (w) => WEATHER_PAY[w].weight);
  const windDirDeg = rng.int(0, 359);
  const windKt = rng.int(WEATHER_PAY[weather].windKt[0], WEATHER_PAY[weather].windKt[1]);
  // 7. payload
  let load: Load = { kind: 'none' };
  if (kind === 'charter' || kind === 'scenic') {
    const range = PAYLOAD_RULES[kind][cls];
    if (!range) throw new Error(`jobs: no ${kind} payload for ${cls}`);
    const pax = rng.int(range[0], range[1]);
    const bagRange = cls === 'trainer' ? BAG_KG.trainer : BAG_KG.other;
    const bags: number[] = [];
    for (let i = 0; i < pax; i++) bags.push(rng.int(bagRange[0], bagRange[1]));
    load = { kind: 'people', bags };
  } else if (kind === 'freight' || kind === 'mail') {
    const range = PAYLOAD_RULES[kind][cls]!;
    const kg = rng.int(range[0], range[1]);
    load = { kind: 'cargo', kg, goods: kind === 'freight' ? rng.pick(FREIGHT_GOODS) : 'Mail bags' };
  }
  // 8. client
  const town = kind === 'scenic' ? placeName(origin) : placeName(rng.chance(0.5) ? origin : dest);
  const business = rng.pick(
    kind === 'charter' ? CHARTER_CLIENTS : kind === 'freight' ? FREIGHT_CLIENTS : kind === 'mail' ? MAIL_CLIENTS : kind === 'scenic' ? SCENIC_CLIENTS : POSITIONING_CLIENTS,
  );
  return {
    kind, cls, dest, waypoints: route?.points, loopNm: route?.lengthNm, premiumTier, weather, windDirDeg, windKt, load, town, business,
  };
}

/** The offer of a slot with a given load and kind (refType, pay and deadline still to fill). */
function draftOffer(id: string, day: number, origin: Airfield, s: Slot, kind: BaseKind, load: Load): JobOffer {
  const payload = itemsOf(load, kind, s.cls);
  const pax = payload.filter((p) => p.kind === 'passenger').length;
  const payloadKg = payload.reduce((t, p) => t + p.kg, 0);
  const destTown = placeName(s.dest);
  const cargoKg = payload.reduce((t, p) => t + (p.kind === 'freight' || p.kind === 'mail' ? p.kg : 0), 0);
  const scenic = kind === 'scenic' && s.waypoints;
  const title =
    kind === 'charter' ? `${plural(pax, 'passenger')} to ${destTown}`
      : kind === 'freight' && load.kind === 'cargo' ? `${load.goods}, ${cargoKg} kg to ${destTown}`
        : kind === 'mail' ? `Mail, ${cargoKg} kg to ${destTown}`
          : scenic ? `Scenic flight, ${plural(pax, 'passenger')}, ${s.waypoints!.length} turning points`
            : `Positioning to ${destTown}`;
  const business = kind === s.kind ? s.business : POSITIONING_CLIENTS[0];
  const offer: JobOffer = {
    id, kind, day, origin: origin.code,
    destination: { kind: 'field', code: scenic ? origin.code : s.dest.code },
    client: `${s.town} ${business}`, title, pax, payload, payloadKg,
    distanceNm: scenic ? s.loopNm! : Math.round(distanceNm(origin, s.dest) * 10) / 10,
    pay: 0, deadlineMin: 0, minClass: s.cls, refType: classTypes(s.cls)[0],
    repRequired: 0, premium: s.premiumTier >= 0, weather: s.weather, windDirDeg: s.windDirDeg, windKt: s.windKt,
  };
  if (scenic) offer.waypoints = s.waypoints;
  return offer;
}

/** A slot's finished offer: the reference type (trimming the load while none fits), pay, deadline, reputation. */
function finishOffer(id: string, day: number, origin: Airfield, s: Slot, fields: readonly Airfield[]): JobOffer {
  let kind: BaseKind = s.kind;
  let load: Load | null = s.load;
  let offer = draftOffer(id, day, origin, s, kind, load);
  let ref = referenceType(offer, fields);
  while (!ref) {
    load = trimmed(load ?? { kind: 'none' });
    if (!load) {
      if (kind === 'positioning') throw new Error(`jobs: no ${s.cls} type can fly ${id}`);
      // Nothing of the class takes even the smallest load: the client wants the aircraft positioned instead.
      kind = 'positioning';
      load = { kind: 'none' };
      if (s.kind === 'scenic') throw new Error(`jobs: scenic ${id} fits no ${s.cls} type`);
    }
    offer = draftOffer(id, day, origin, s, kind, load);
    ref = referenceType(offer, fields);
  }
  offer.refType = ref;
  const premiumMult = s.premiumTier >= 0 ? PREMIUM_RULES.payMult[s.premiumTier] : 1;
  offer.pay = offerPayUsd(offer, fields, premiumMult);
  offer.deadlineMin = offerDeadlineMin(offer, fields);
  const rep = CLASS_RULES[s.cls].rep + PAY_RULES[kind].rep;
  offer.repRequired = s.premiumTier >= 0 ? Math.max(rep, PREMIUM_RULES.repRequired[s.premiumTier]) : rep;
  return offer;
}

/**
 * The base offers of a board (the stream above): `${day}-${origin}-${i}` for i from 0. `fields` is the world's
 * airfields (airfields(), the home field first); throws if `origin` is not among them.
 */
export function baseBoardFor(seed: number, day: number, origin: string, fields: readonly Airfield[]): JobOffer[] {
  const o = requireField(origin, fields);
  const rng = boardRng(seed, day, origin);
  const count = CLOCK_RULES.minOffers + Math.floor(rng.next() * (CLOCK_RULES.extraOffers + 1));
  const offers: JobOffer[] = [];
  let mailUsed = false;
  for (let i = 0; i < count; i++) {
    const slot = drawSlot(rng, i, o, fields, mailUsed);
    const offer = finishOffer(`${day}-${origin}-${i}`, day, o, slot, fields);
    if (offer.kind === 'mail') mailUsed = true;
    offers.push(offer);
  }
  return offers;
}

/**
 * The job board at `origin` on career `day` in world `seed` (docs/career.md "Job generation"), deterministic: the
 * base offers (baseBoardFor), to which wave 4 appends its own kinds from the `|w4` stream with `-w` ids. Generation
 * does not depend on the player; the board shows what the player cannot take locked.
 */
export function boardFor(seed: number, day: number, origin: string, fields: readonly Airfield[]): JobOffer[] {
  return baseBoardFor(seed, day, origin, fields);
}
