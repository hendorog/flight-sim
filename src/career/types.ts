// Career contract (docs/career.md): the types and small constant tables every Career package shares.
//
// The Career is the post-licence flying business beside the Flight School: a job board at the field the
// player's aircraft stands at, a dispatch load sheet, the flight itself (tracked by the job runtime), a debrief
// that settles money and reputation, and progression (ranks, ratings, a fleet of the sim's real types). It is a
// separate thing from src/training/career/, which is the Flight School's own pilot record (logbook, progress,
// store); nothing here imports from or writes to that store, and the save lives under its own key
// (CAREER_KEY, 'fs.career.v1').
//
// This file is pure: types plus `as const` tables of numbers, no functions, no DOM, no three.js, and only
// `import type` from elsewhere, so every Career module (pure core, job runtime, sim hooks, UI) and every test can
// import it without pulling a chunk. The numbers here are game data in the sense of docs/career.md: changing one
// is a one-line data edit, reviewed against that document (which explains each value), never a silent tweak.
// Fields marked "(contract addition)" were added after the first version and must stay optional.
//
// Units: SI inside (m, s, kg) with the house suffixes where a pilot unit is meant (Kt, Nm, Ft, Fpm, Deg, Min);
// money in whole dollars (the Career's only currency, shown as "$"). Positions are the world's NED metres
// (x north, y east), as in src/world/airfields.ts.

import type { AircraftId, WeatherSettings } from '../core/types';
import type { LoadingRequest } from '../physics/interfaces';

// --------------------------------------------------------------------------------------------- storage

/** localStorage key of the Career save (CareerSave JSON), behind the KeyValueStore interface (src/sim/resume.ts). */
export const CAREER_KEY = 'fs.career.v1';
/** The previous good copy, written before every save when the old value validates (TrainingStore idiom). */
export const CAREER_PREV_KEY = 'fs.career.v1.prev';
/** Pre-migration backup of schema n: `${CAREER_BACKUP_PREFIX}${n}`. */
export const CAREER_BACKUP_PREFIX = 'fs.career.v1.backup.s';
/** Schema of CareerSave this build writes. A bump needs a migration (src/career/store.ts). */
export const CAREER_SCHEMA = 1;
/** Debounce of CareerStore.saveSoon, ms. Accept, abandon, give up and settle never use it: they save at once. */
export const CAREER_SAVE_DEBOUNCE_MS = 500;
/** The `lessonId` the Career passes to commands.startFrom: `${CAREER_RESET_PREFIX}${jobId}` (or `...hub` for a placement without a job). A 'reset' whose lessonId does not start with it ends an active job. */
export const CAREER_RESET_PREFIX = 'career:';

/** Where the Career save is kept: `cstore=` (default 'local'). Only 'local' ever writes a resume block. */
export type CareerStoreKind = 'local' | 'mem' | 'session';

// --------------------------------------------------------------------------------------------- aircraft

/** The types the Career flies: every AircraftId but the da42 (a C172S placeholder) and the ah56 (military; maybe a late display flight). */
export type CareerAircraftId = Exclude<AircraftId, 'da42' | 'ah56'>;

/** Career types in market order (fixed wing by size, then helicopters by size). */
export const CAREER_AIRCRAFT_IDS = [
  'c152', 'pa38', 'da20', 'c172s', 'pa34', 'c208', 'pc12', 'r22', 's269', 'r44', 'md500', 'bo105',
] as const satisfies readonly CareerAircraftId[];

/**
 * The Career's aircraft classes. A job names the least class that may fly it (and that sets its pay); a type
 * belongs to exactly one. trainer: two-seat piston singles; tourer: four-seat piston singles; twin: piston twins;
 * turbine: turboprop singles; heli: piston helicopters; heliTurbine: turbine helicopters.
 */
export type AircraftClass = 'trainer' | 'tourer' | 'twin' | 'turbine' | 'heli' | 'heliTurbine';

/** Fixed-wing classes in increasing order (a job's minClass is met by its class or any later one that also fits the load). */
export const FIXED_WING_CLASS_ORDER = ['trainer', 'tourer', 'twin', 'turbine'] as const satisfies readonly AircraftClass[];
/** Helicopter classes in increasing order. Helicopter jobs are met only by helicopters, fixed-wing jobs only by aeroplanes. */
export const ROTORCRAFT_CLASS_ORDER = ['heli', 'heliTurbine'] as const satisfies readonly AircraftClass[];

/** Per-class numbers (docs/career.md "Job generation"). */
export interface ClassRule {
  /** Pilot-facing name. */
  label: string;
  /** True airspeed a deadline is planned at for a job of this minimum class (the slowest type of the class), kt. */
  refTasKt: number;
  /** Start-up, taxi, departure, arrival, taxi in and shutdown allowance in the deadline, min. */
  taxiMin: number;
  /** Pay multiplier on a job of this minimum class. */
  payMult: number;
  /** Least reputation to take a job of this minimum class (before the kind's addition). */
  rep: number;
  /** Generation weight of this class among a board's drawn offers (normalised over the classes possible at both ends). */
  weight: number;
}

export const CLASS_RULES: Readonly<Record<AircraftClass, ClassRule>> = {
  trainer: { label: 'Two-seat trainer', refTasKt: 95, taxiMin: 25, payMult: 1.0, rep: 0, weight: 0.32 },
  tourer: { label: 'Four-seat single', refTasKt: 110, taxiMin: 25, payMult: 1.3, rep: 5, weight: 0.3 },
  twin: { label: 'Piston twin', refTasKt: 150, taxiMin: 25, payMult: 2.0, rep: 25, weight: 0.12 },
  turbine: { label: 'Turboprop', refTasKt: 155, taxiMin: 30, payMult: 3.2, rep: 40, weight: 0.1 },
  heli: { label: 'Piston helicopter', refTasKt: 72, taxiMin: 25, payMult: 2.0, rep: 15, weight: 0.1 },
  heliTurbine: { label: 'Turbine helicopter', refTasKt: 100, taxiMin: 25, payMult: 3.0, rep: 35, weight: 0.06 },
};

/** Fuel grades. Density kg/L from src/physics/propulsion/defs.ts (AVGAS_100LL 719, JET_A1 800 kg/m3). */
export type FuelGrade = 'avgas' | 'jetA1';

/**
 * The Career's performance and business table for one type (src/career/perf.ts holds the values as literal
 * numbers, one row per CareerAircraftId, and never imports an aircraft module: each type is a lazy chunk;
 * tests/career/perf.test.ts proves the mass, fuel, station and CG columns equal the type's definition).
 */
export interface CareerPerf {
  id: CareerAircraftId;
  cls: AircraftClass;
  /** ICAO type designator (= def.icaoType), for the radio and traffic identity. */
  icaoType: string;
  /** Ratings needed to fly it (every aeroplane needs 'sep'; the helicopters need 'heli'). */
  ratings: readonly RatingId[];
  /** Passenger seats besides the pilot's. */
  paxSeats: number;
  /**
   * Most mass each station takes, kg, cited per type from the POH in perf.ts (a seat station: the seat limit
   * times its free seats). Absent: the type has no such station. Replaces the first version's single cargoMaxKg.
   */
  stationMaxKg: Partial<Readonly<Record<Station, number>>>;
  /** = def.mass.empty, kg. */
  emptyKg: number;
  /** = def.mass.maxTakeoff, kg. */
  mtowKg: number;
  /** = def.mass.maxLanding, kg. */
  mlwKg: number;
  /** Sum of the definition's tank capacities, kg. */
  usableFuelKg: number;
  /** Fuel a newly leased or bought aircraft is delivered with, kg (half the usable fuel: the definitions' loadings carry no fuel). */
  deliveryFuelKg: number;
  fuel: FuelGrade;
  /** Planning cruise true airspeed at the 2,000 ft planning height, kt (below Vno there; calibrated against the sim). */
  cruiseTasKt: number;
  /** Planning cruise fuel flow (all engines) at that height, kg/h (calibrated to 10 % against the sim's burn). */
  fuelFlowKgH: number;
  /** Most demonstrated crosswind, kt; null for helicopters (no load-sheet crosswind check). */
  maxDemoCrosswindKt: number | null;
  /** Longitudinal CG figures for the load sheet, body x m (the definition's frame): empty CG, and the CGs of the type's own forward and aft loadings (example loadings, not the POH envelope: the 'cg' code only warns). */
  cg: { emptyX: number; fwdX: number; aftX: number };
  /** Shortest runway it may be dispatched to or from, m (0: helicopters, any field). */
  minRunwayM: number;
  /** May use grass strips. */
  grassOk: boolean;
  /** Pressurised cabin (no descent-rate comfort deduction). */
  pressurised: boolean;
  /** List price, $: shown in the market and the base of the insurance excess (game flavour; real-world order). */
  listPrice: number;
  /** What buying costs in the Career, $: a game-scaled buy-in (deposit on finance) set so owning breaks even in 30-50 block hours. */
  buyIn: number;
  /** Owner's cost per block hour (maintenance reserve, insurance, finance), $, fuel excluded. */
  ownedHourly: number;
  /** Dry lease per block hour, $, fuel excluded. */
  leaseHourly: number;
  /** Least reputation the lessor wants. */
  leaseRep: number;
}

// --------------------------------------------------------------------------------------------- loading

/**
 * Mass of one person (the pilot or a passenger), kg: the sim's standard occupant. Definitions' empty masses exclude
 * the crew (the C208's `CREW = 154` in c208/systems.ts is two such occupants carried as payload on top of empty),
 * so a Career loading adds exactly one pilot.
 */
export const OCCUPANT_KG = 77;
/** Planning reserve at the destination, min of cruise fuel flow: aeroplanes and helicopters (VFR day). */
export const RESERVE_MIN = 30;
export const RESERVE_MIN_HELI = 20;
/** Start, taxi, run-up and taxi in, as minutes of cruise fuel flow (added to the trip fuel). */
export const TAXI_FUEL_MIN = 6;
/** Required fuel = tripFactor x trip + climbMin of flow + taxi + reserve (the climb is at full power, often full rich). */
export const FUEL_PLAN_RULES = { tripFactor: 1.1, climbMin: 5 } as const;

/** What a payload item is. */
export type PayloadKind = 'passenger' | 'baggage' | 'freight' | 'mail' | 'patient' | 'equipment';

/**
 * Where an item sits. 'front': the pilot's row beside the pilot (the right-hand seat, or the left-hand one in a
 * type flown from the right such as the R44 and S269); 'rear': the second row of a four-seater; 'cabin': the
 * cabin of a C208 / PC-12 / PA-34 / MD 500 / Bo 105; 'baggage': the baggage bay or under-seat lockers; 'cargo':
 * a cargo pod or aft cargo area (C208 pod, PC-12 aft area, Bo 105 clamshell). Freight may also sit on a free seat
 * ('front', 'rear', 'cabin') up to the seat limit. src/career/stations.ts holds the body-axis positions per type.
 */
export type Station = 'front' | 'rear' | 'cabin' | 'baggage' | 'cargo';

/** An item of a job's payload as offered: no station yet (the dispatch assigns them for the chosen type). */
export interface OfferItem {
  kind: PayloadKind;
  /** Shown on the load sheet ("Passenger 2", "Mail bags", "Engine parts"). */
  label: string;
  kg: number;
}

/** An item as loaded into a chosen aircraft (src/career/stations.ts assignStations). */
export interface PayloadItem extends OfferItem {
  station: Station;
}

// --------------------------------------------------------------------------------------------- places, jobs

/** A job end: an airfield by code (src/world/airfields.ts), or (wave 4) an off-field helicopter site. */
export type JobPlace =
  | { kind: 'field'; code: string }
  | { kind: 'site'; id: string; name: string; north: number; east: number; elevation: number };

/** A scenic-flight turning point: overflown when within radiusM horizontally. Wave 1 points are at least 2 NM from every field. */
export interface Waypoint {
  name: string;
  north: number;
  east: number;
  /** Capture radius, m. */
  radiusM: number;
  /** Most height above ground to count (a scenic flight shows the passengers the landmark), ft. Absent: any. */
  maxAglFt?: number;
}

/**
 * Job kinds. 'positioning': fly the company's empty aircraft to where a client wants it (the first version's
 * 'ferry'; a real ferry flies the client's aircraft, which this model cannot do). 'medevac' and 'utility' are wave 4.
 */
export type JobKind = 'charter' | 'freight' | 'mail' | 'scenic' | 'positioning' | 'medevac' | 'utility';

/** Weather presets jobs are drawn from (src/sim/weatherPresets.ts ids). VFR only until an instrument rating exists. */
export type CareerWeatherId = 'clear' | 'fair' | 'overcast' | 'gusty' | 'drizzle' | 'rain';

/** One offer on a job board. Pure data, a function of (world seed, career day, field) only. */
export interface JobOffer {
  /** Base stream: `${day}-${originCode}-${index}`; wave-4 stream: `${day}-${originCode}-w${index}`; the player's own positioning: `${day}-${originCode}-own${n}`. */
  id: string;
  kind: JobKind;
  /** Board it came from (the origin field code and career day). */
  day: number;
  origin: string;
  destination: JobPlace;
  /** Scenic flights: the turning points in order (the destination is then the origin). */
  waypoints?: readonly Waypoint[];
  /** Client name shown on the board ("Elmley Garden Centre"). */
  client: string;
  /** One-line headline ("2 passengers to Holthurst"). */
  title: string;
  pax: number;
  /** Everything but the pilot; stations are assigned at dispatch for the chosen type. */
  payload: readonly OfferItem[];
  /** Sum of payload kg. */
  payloadKg: number;
  /** Route length (origin to destination, or round the waypoints), NM. */
  distanceNm: number;
  /** Base pay before bonuses and penalties, $ (never below the cost floor, PAY_FLOOR). */
  pay: number;
  /** Time allowed from the job's start (the curtain lifting at the origin) to completion, sim minutes. */
  deadlineMin: number;
  /** Least class: sets the pay and the reputation needed; a type of this class or a later one may fly it if the load fits. */
  minClass: AircraftClass;
  /** The smallest type of minClass the load fits (src/career/fit.ts fitOffer: seats, stations, MTOW with required fuel, runways): the pay floor's and the generator test's reference. */
  refType: CareerAircraftId;
  repRequired: number;
  /** A regular client's job: higher reputation needed (PREMIUM_RULES), better pay. */
  premium: boolean;
  weather: CareerWeatherId;
  /** The job's surface wind (overrides the preset's): from, deg true, and speed, kt. */
  windDirDeg: number;
  windKt: number;
}

/**
 * Where a job stands. 'dispatched': accepted, the player not yet placed (or placed, engines not yet started).
 * 'stopped': shut down at another field (a precautionary stop): on hold until Continue or Give up.
 */
export type JobPhase = 'dispatched' | 'ground' | 'airborne' | 'landed' | 'stopped' | 'done';

/** The job being flown, kept in the save (survives reloads and type switches). */
export interface ActiveJob {
  offer: JobOffer;
  aircraftUid: string;
  /** The aircraft's type (= the fleet entry's; kept so the boot can decide without the fleet). */
  type: CareerAircraftId;
  /** Fuel on board at the (latest) placement, kg (after the dispatch uplift or defuel). */
  fuelKg: number;
  /**
   * The payload placed in the mass model, built for the booted type at placement (src/career/loading.ts), so a
   * resumed leg rebuilds the same mass. Null until placed (a type switch reloads first). The only copy of it: the
   * resume block does not carry one.
   */
  loading: LoadingRequest | null;
  /** The pilot plus payload items with their stations for this type (load sheet order). */
  items: readonly PayloadItem[];
  phase: JobPhase;
  /** False until the player has been placed at the origin (a type switch reloads first). */
  placed: boolean;
  /** Career clock at acceptance, min. */
  acceptedAtMin: number;
  /** Job sim seconds before the latest placement (a refuel at a stop re-places the aircraft and restarts physics.time). */
  elapsedBaseS: number;
  /** Job sim seconds (elapsedBaseS + physics.time since the placement), copied from the runtime every 5 s: the fallback if no snapshot resumes. */
  elapsedS: number;
  /** Last known position, NED m, for a job that cannot be resumed (aircraft goes to the nearest field). */
  lastKnown: { north: number; east: number; onGround: boolean };
  /** True once the aircraft has left the ground on this job. */
  everAirborne: boolean;
  /** Phase 'stopped': the field code the job is held at. */
  stoppedAt?: string;
  /** The player's own weather before the job, restored on Free flight or at the job's end. */
  playerWeather: WeatherSettings;
  /** Set when the runtime has ended the job (crash, outlanding) and settlement waits for the player's Debrief or Hub choice. */
  pendingReport?: JobFlightReport;
}

// --------------------------------------------------------------------------------------------- load sheet

export type LoadSheetCode =
  | 'notHere' | 'grounded' | 'rating' | 'class' | 'reputation' | 'seats' | 'stationLimit' | 'cg'
  | 'overMtow' | 'overMlw' | 'fuelShort' | 'fuelOverCapacity' | 'fuelTruck'
  | 'runwayShort' | 'grass' | 'heliOnly' | 'fixedWingOnly' | 'deadlineTight' | 'lateInDay' | 'weather' | 'crosswind'
  | 'cash' | 'losesMoney';

export interface LoadSheetWarning {
  code: LoadSheetCode;
  /** 'block': Accept is disabled; 'warn': shown, Accept allowed. */
  severity: 'block' | 'warn';
  text: string;
}

/** The dispatch load sheet for one offer, aircraft and fuel choice (src/career/loadsheet.ts). */
export interface LoadSheet {
  offerId: string;
  aircraftUid: string;
  type: CareerAircraftId;
  emptyKg: number;
  pilotKg: number;
  payloadKg: number;
  /** empty + pilot + payload. */
  zeroFuelKg: number;
  fuelKg: number;
  takeoffKg: number;
  /** Take-off mass less trip and taxi fuel. */
  landingKg: number;
  mtowKg: number;
  mlwKg: number;
  /** Take-off CG, body x m, and the type's limits (CareerPerf.cg). */
  cgX: number;
  cgFwdX: number;
  cgAftX: number;
  /** Most fuel this load allows: min(usable, MTOW - zero fuel), kg. */
  maxFuelKg: number;
  tripFuelKg: number;
  /** Climb allowance (FUEL_PLAN_RULES.climbMin of flow), kg. */
  climbFuelKg: number;
  taxiFuelKg: number;
  reserveFuelKg: number;
  /** tripFactor x trip + climb + taxi + reserve, kg. */
  requiredFuelKg: number;
  /** Fuel to buy (fuelKg less what is in the tanks, not below 0), kg and $ (a fuel truck's surcharge included). */
  upliftKg: number;
  fuelCost: number;
  /** Fuel drained (what is in the tanks less fuelKg, not below 0), kg, and its credit ($, DEFUEL_RULES). */
  defuelKg: number;
  defuelCredit: number;
  /** Headwind (negative: tailwind) and largest crosswind component at either end, kt, from the offer's wind. */
  headwindKt: number;
  crosswindKt: number;
  /** Planned airborne time at cruise ground speed plus 10 min for departure and arrival, min. */
  flightTimeMin: number;
  /** flightTime + the class's taxi allowance, h (the hours cost and the pay floor use it). */
  blockHoursEst: number;
  /** Fuel on board at cruise flow, min. */
  enduranceMin: number;
  /** deadline less (flightTime + the taxi allowance), min. */
  deadlineMarginMin: number;
  /** Estimated costs and net if completed on time with no bonus or penalty, $. */
  landingFeeEst: number;
  hoursCostEst: number;
  netEst: number;
  items: readonly PayloadItem[];
  warnings: readonly LoadSheetWarning[];
  /** No 'block' warning. */
  ok: boolean;
}

// --------------------------------------------------------------------------------------------- flight report

/** How a job ended, from the job runtime (or, for 'diverted', from the player's Give up at a stop). */
export type JobOutcome =
  | 'completed'   // shut down at the destination after flying (a scenic flight: back at the origin)
  | 'diverted'    // given up while stopped at another field (or still stopped at the day's end)
  | 'outlanded'   // shut down away from any field (fixed wing) or off a site (helicopter)
  | 'crashed'
  | 'abandoned'   // cancelled by the player, or ended by a non-Career reset
  | 'lost';       // the flight could not be resumed after a reload (no valid snapshot)

/** The settled outcome: a scenic flight completed with no turning point overflown settles as 'routeMissed' (a failure). */
export type SettledOutcome = JobOutcome | 'routeMissed';

/** The landing the debrief grades (the last full-stop landing before completion). */
export interface LandingSummary {
  /** 0..100 (src/career/runtime/landingScore.ts). */
  score: number;
  sinkFpm: number;
  bounces: number;
  firstWheel: 'nose' | 'left' | 'right';
  helicopter: boolean;
  /** Fixed wing: on the destination's runway; helicopter: within the spot radius. */
  onTarget: boolean;
  /** Fixed wing: distance past the aim point, ft (negative short). Absent for helicopters. */
  distAimFt?: number;
  /** Fixed wing: from the centreline, m. */
  centrelineM?: number;
  /** Helicopter: from the landing spot, m. */
  spotDistM?: number;
}

/** Comfort deductions are kept per factor so the debrief can name the worst. 'stall': the stall warning (low rotor RPM horn on helicopters). */
export type ComfortFactor = 'vertical' | 'lateral' | 'bank' | 'pitch' | 'descent' | 'stall' | 'landing';

export interface ComfortSummary {
  /** 100 less the deductions, clamped 0..100. */
  score: number;
  deductions: Readonly<Record<ComfortFactor, number>>;
}

/** What the job runtime hands to the settlement (src/career/economy.ts settleJob). */
export interface JobFlightReport {
  outcome: JobOutcome;
  /** Where the aircraft came to rest (the field code it is now at), null if nowhere (crash or outlanding: nearest field is chosen by the settlement). */
  atField: string | null;
  /** Last position, NED m (for nearest-field relocation). */
  position: { north: number; east: number };
  /** Sim minutes from the job's start to completion. */
  elapsedMin: number;
  /** Engines running (or rotor turning), s. */
  blockS: number;
  airborneS: number;
  nightS: number;
  landingsDay: number;
  landingsNight: number;
  takeoffs: number;
  landing: LandingSummary | null;
  comfort: ComfortSummary;
  /** Extremes of the normal load factor while airborne. */
  maxG: number;
  minG: number;
  /** Seconds above Vne. */
  overspeedS: number;
  /** Counted only above COMFORT_RULES.stallMinAglFt and outside the landing flare. */
  stallWarningS: number;
  fuelAtEndKg: number;
  /** Stopped inside the apron area / beside the hangar / on the spot: a logbook remark only, no money or reputation effect. */
  onApron: boolean;
  /** Stopped on the runway. */
  onRunway: boolean;
  /** Scenic: waypoints overflown, in order, of waypointsTotal (0 of 0 on other kinds). */
  waypointsDone: number;
  waypointsTotal: number;
  crashReason?: string;
  /** Ended through the test arrival hook (__sim.career.testArrive): logged with a "(test)" remark. */
  test?: boolean;
}

// --------------------------------------------------------------------------------------------- settlement

export type MoneyLineId =
  | 'base' | 'route' | 'onTime' | 'early' | 'late' | 'landing' | 'heavyLanding' | 'comfort'
  | 'overspeed' | 'highG' | 'lowReserve' | 'runwayStop' | 'rankBonus'
  | 'fuel' | 'defuel' | 'landingFee' | 'aircraftHours' | 'leaseIdle' | 'repair' | 'recovery';

export interface MoneyLine {
  id: MoneyLineId;
  label: string;
  /** Signed $ (costs negative). */
  amount: number;
}

export interface RepLine {
  reason: string;
  delta: number;
}

/** A Career logbook line (never written into the Flight School's logbook, whose from/to are pinned to KFBL). */
export interface CareerLogEntry {
  id: string;
  /** Career day and clock at the job's start. */
  day: number;
  clockMin: number;
  /** 'job' lines carry the job fields; the others are business lines. */
  kind: 'job' | 'rating' | 'purchase' | 'lease' | 'sale' | 'return' | 'leaseIdle' | 'refuel' | 'bankruptcy';
  type?: CareerAircraftId;
  cls?: AircraftClass;
  registration?: string;
  from?: string;
  to?: string;
  jobKind?: JobKind;
  jobId?: string;
  outcome?: SettledOutcome;
  blockS: number;
  airborneS: number;
  nightS: number;
  landingsDay: number;
  landingsNight: number;
  /** Net $ of the line. */
  net: number;
  repDelta: number;
  remarks: string;
}

/** The result of settling a job (pure; economy.ts), also the debrief card's model. */
export interface Settlement {
  offerId: string;
  outcome: SettledOutcome;
  lines: readonly MoneyLine[];
  net: number;
  repLines: readonly RepLine[];
  repDelta: number;
  cashAfter: number;
  repAfter: number;
  rankBefore: RankId;
  rankAfter: RankId;
  /** The field the aircraft is now at. */
  aircraftAt: string;
  /** Career day the aircraft is back in service (crash repairs), absent if serviceable. */
  groundedUntilDay?: number;
  report: JobFlightReport;
  logEntry: CareerLogEntry;
  /** <= 60 spoken words in the instructor-debrief voice: safety first, one strength, one main point. */
  summary: string;
}

// --------------------------------------------------------------------------------------------- progression

export type RatingId = 'sep' | 'mep' | 'turbine' | 'heli';

export interface RatingRule {
  label: string;
  /** Training cost, $ (0: held from the start). */
  cost: number;
  /** Career block hours before it can be bought. */
  minHours: number;
  minRep: number;
}

/** Ratings: a first new type in session 2-3, a twin or helicopter by session 5-8 (about 1.5 jobs, 0.6 block h, an hour of play). */
export const RATINGS: Readonly<Record<RatingId, RatingRule>> = {
  sep: { label: 'Single-engine piston (land)', cost: 0, minHours: 0, minRep: 0 },
  mep: { label: 'Multi-engine piston', cost: 4500, minHours: 3, minRep: 20 },
  turbine: { label: 'Turbine and high performance', cost: 12000, minHours: 8, minRep: 35 },
  heli: { label: 'Helicopter', cost: 9000, minHours: 2, minRep: 15 },
};

export type RankId = 'junior' | 'line' | 'senior' | 'captain' | 'chief';

export interface RankRule {
  id: RankId;
  label: string;
  /** Career block hours and reputation both needed. */
  minHours: number;
  minRep: number;
  /** Added to the base pay of every completed job, fraction. */
  payBonus: number;
}

/** Ranks in order; the rank is the last one whose block hours and reputation are both met. */
export const RANKS: readonly RankRule[] = [
  { id: 'junior', label: 'Junior pilot', minHours: 0, minRep: 0, payBonus: 0 },
  { id: 'line', label: 'Line pilot', minHours: 2, minRep: 30, payBonus: 0.03 },
  { id: 'senior', label: 'Senior pilot', minHours: 8, minRep: 45, payBonus: 0.06 },
  { id: 'captain', label: 'Captain', minHours: 20, minRep: 60, payBonus: 0.1 },
  { id: 'chief', label: 'Chief pilot', minHours: 40, minRep: 75, payBonus: 0.15 },
];

export type Tenure = 'owned' | 'leased';

export interface FleetAircraft {
  /** Stable id ('a1', 'a2', ...). */
  uid: string;
  type: CareerAircraftId;
  tenure: Tenure;
  /** Per airframe (src/career/registration.ts registrationFor(uid, authority)). */
  registration: string;
  /** Field code it stands at. */
  field: string;
  /** Fuel in its tanks, kg. */
  fuelKg: number;
  /** Block hours flown in the Career. */
  hours: number;
  acquiredDay: number;
  /** Out of service (crash repair) until this career day. */
  groundedUntilDay?: number;
}

/** How the player came to hold a licence for the Career. */
export type LicenceSource = 'school' | 'declared' | 'unlock';

export interface CareerSettings {
  /** Use the company callsign on the radio (wave 4 ATC hook). Off: the airframe's registration. */
  companyCallsign: boolean;
}

/** The whole Career save under CAREER_KEY. */
export interface CareerSave {
  format: 'fs-career';
  schema: 1;
  createdAt: number;
  updatedAt: number;
  /** World seed the Career lives in (src/world/worldSeed.ts). Another seed: the board is refused until the player switches world or starts again. */
  seed: number;
  pilot: { name: string; licence: LicenceSource };
  company: { name: string; /** Radio callsign word ("Fable"), used with a flight number. */ callsign: string };
  cash: number;
  reputation: number;
  /** Career clock, min since day 0 00:00. Day = floor(clockMin / 1440). */
  clockMin: number;
  ratings: RatingId[];
  fleet: FleetAircraft[];
  /** The aircraft the player is with (its field is "here"); null with an empty fleet. */
  selectedUid: string | null;
  /** True while the player is in Career mode (a reload puts them back at the selected aircraft); false after Free flight with no job. */
  inCareer: boolean;
  /** Offers taken from today's boards (ids); cleared when the day changes. */
  taken: string[];
  active: ActiveJob | null;
  /** The last settlement, for the debrief card after a reload. */
  lastSettlement: Settlement | null;
  logbook: CareerLogEntry[];
  /** Next flight number for the radio callsign. */
  flightNo: number;
  /** Next number for the player's own positioning offers today (`-own${n}` ids). */
  ownNo: number;
  settings: CareerSettings;
}

// --------------------------------------------------------------------------------------------- resume block, boot

/**
 * The Career's block in the resume snapshot (FlightSnapshot.career, opaque in src/sim/resume.ts, validated by
 * src/career/block.ts validateCareerBlock). Written only when the career store is 'local', a job is active and
 * placed, and its type is the booted type. At boot the Simulator loads the career store first and deletes the
 * block unless `jobId === store.active.offer.id && store.active.placed` (src/career/boot.ts careerBootPlan). The
 * payload comes from `store.active.loading`, never from the block.
 */
export interface CareerResumeBlock {
  v: 1;
  jobId: string;
  aircraftUid: string;
  /** The job runtime's own state (JobMonitor.exportState), validated by its owner; malformed resumes the flight with a fresh monitor. */
  monitor: unknown;
}

/** What the Career does once the boot has resumed or started a flight (src/career/boot.ts). */
export type CareerBootAction =
  | 'none'            // no Career at this boot (the default path)
  | 'resume'          // a placed job of this type with a matching block: expect a resume; if none happened, fall back below
  | 'place'           // an unplaced job of this type: place it (startFrom) after training.afterBoot
  | 'placeSelected'   // in Career with no job: place cold at the selected aircraft's field (unless the boot resumed)
  | 'hub';            // the Career should open its hub (career=1, or a job waiting for another type)

/** The Career's boot plan, decided before decideBoot from the career store, the snapshot and the URL. */
export interface CareerBootPlan {
  /** Delete snap.career before decideBoot (no job behind it). */
  deleteBlock: boolean;
  /** Override for decideBoot's `param`: true resumes a placed job even with the preference off; false ignores a stale snapshot of a type with an unplaced job; null leaves the URL's. */
  resumeParam: boolean | null;
  /** Pass `explicitScenario: true` to training.afterBoot (the Career takes the boot: no school home or welcome card). */
  trainingExplicit: boolean;
  action: CareerBootAction;
}

// --------------------------------------------------------------------------------------------- UI contract

export type CareerPage =
  | 'locked' | 'create' | 'seed' | 'hub' | 'board' | 'dispatch' | 'fleet' | 'pilot' | 'logbook' | 'debrief' | 'stop' | 'bankrupt';

/** Commands from the Career UI (and __sim.career.command) to the CareerSystem. */
export type CareerCommand =
  | { kind: 'open'; page?: CareerPage }
  | { kind: 'close' }
  | { kind: 'declareLicence' }
  | { kind: 'create'; pilotName: string; companyName: string; callsign: string; start: 'c152' | 'c172s' }
  | { kind: 'select'; uid: string }
  | { kind: 'dispatch'; offerId: string }
  /** fuelKg below what is aboard defuels (credit DEFUEL_RULES). */
  | { kind: 'accept'; offerId: string; uid: string; fuelKg: number }
  /** Reload into the type of a job waiting for another type. */
  | { kind: 'switchTo' }
  | { kind: 'abandon' }
  /** At a stop: re-place at this field's stand with fuel added (a fuel truck where the grade is not sold), the deadline still running. */
  | { kind: 'refuel'; fuelKg: number }
  /** Fleet page, an aircraft not on a job: drain fuel to fuelKg (credit DEFUEL_RULES). */
  | { kind: 'defuel'; uid: string; fuelKg: number }
  /** At a stop: carry on from here (the job continues, phase back to 'ground'). */
  | { kind: 'continueJob' }
  /** At a stop: give up (settles 'diverted'). */
  | { kind: 'giveUp' }
  /** Self-dispatch an unpaid positioning flight of the selected aircraft to a field (a board-less offer, `-own${n}`). */
  | { kind: 'reposition'; to: string }
  | { kind: 'rest' }
  | { kind: 'buyRating'; rating: RatingId }
  | { kind: 'lease'; type: CareerAircraftId }
  | { kind: 'buy'; type: CareerAircraftId }
  | { kind: 'sell'; uid: string }
  | { kind: 'returnLease'; uid: string }
  | { kind: 'settings'; settings: Partial<CareerSettings>; companyName?: string; callsign?: string }
  | { kind: 'switchWorld' }
  | { kind: 'exportSave' }
  | { kind: 'importSave'; json: string }
  /** Below the overdraft: the bank sells every owned aircraft (sale value), or the career starts again. */
  | { kind: 'bankruptcy'; choice: 'sellOwned' | 'restart' }
  /** After a crash or outlanding: settle the pending report and show the debrief (or the hub). */
  | { kind: 'settlePending'; then: 'debrief' | 'hub' }
  | { kind: 'reset' }
  /** Close the Career pages. With a job active, the job carries on (the strip stays); with none, leave Career mode. */
  | { kind: 'freeFlight' };

/** The in-flight job strip's model, refreshed each frame by the CareerSystem. */
export interface JobStripModel {
  title: string;
  /** "KELM Elmley Aerodrome" (or the next waypoint on a scenic flight). */
  target: string;
  distanceNm: number;
  bearingDeg: number;
  /** At the present ground speed (cruise TAS when slow), min. */
  etaMin: number;
  /** deadline less elapsed, min (negative: late). */
  remainingMin: number;
  enduranceMin: number;
  /** Fuel left on arrival at the present burn and ETA, min of cruise flow. */
  projectedReserveMin: number;
  /** Scenic: the next turning point's index (0-based) and the total; null on other kinds. */
  waypointIndex: number | null;
  waypointsTotal: number | null;
  /** The job's surface wind. */
  windDirDeg: number;
  windKt: number;
  /** Helicopters near the destination: distance to the landing spot, m (null otherwise). */
  spotDistM: number | null;
  /** 0..100, null on a job where comfort does not count. */
  comfort: number | null;
  phase: JobPhase;
  /** One line of what to do next ("Set the parking brake (or wait) to finish"). */
  hint: string;
}

/** The Career's link to the Escape menu (MenuHost.career, optional: absent, no button and no confirm). */
export interface CareerMenuLink {
  available(): boolean;
  open(): void;
  /** A placed job is in progress (the menu confirms before anything that would end it, as for lessons). */
  jobActive(): boolean;
  /** End the active job as abandoned (the menu's confirm said yes). */
  abandon(): void;
}

/** The Career's link to UISystem (attachCareer): a Career page open makes the UI modal (radio keys, checklist, HUD, cues off). */
export interface CareerModalLink {
  screenOpen(): boolean;
}

// --------------------------------------------------------------------------------------------- rule tables

/** Pay = round to $5 of max((base + perNm d + perPax pax + perKg cargoKg) x class payMult x weather mult x premium, floor x floorPremium). */
export const PAY_RULES: Readonly<Record<JobKind, { base: number; perNm: number; perPax: number; perKg: number; deadlineSlack: number; weight: number; rep: number; comfortWeight: number; floorPremium: number }>> = {
  charter: { base: 90, perNm: 8, perPax: 30, perKg: 0, deadlineSlack: 1.5, weight: 0.3, rep: 0, comfortWeight: 0.15, floorPremium: 1.15 },
  freight: { base: 70, perNm: 6, perPax: 0, perKg: 0.8, deadlineSlack: 1.8, weight: 0.25, rep: 0, comfortWeight: 0, floorPremium: 1.1 },
  mail: { base: 80, perNm: 7, perPax: 0, perKg: 1.5, deadlineSlack: 1.25, weight: 0.15, rep: 0, comfortWeight: 0, floorPremium: 1.1 },
  scenic: { base: 120, perNm: 6, perPax: 45, perKg: 0, deadlineSlack: 1.6, weight: 0.15, rep: 5, comfortWeight: 0.3, floorPremium: 1.2 },
  positioning: { base: 50, perNm: 4, perPax: 0, perKg: 0, deadlineSlack: 2.5, weight: 0.15, rep: 0, comfortWeight: 0, floorPremium: 1.0 },
  medevac: { base: 400, perNm: 15, perPax: 0, perKg: 0, deadlineSlack: 1.3, weight: 0, rep: 10, comfortWeight: 0.1, floorPremium: 1.4 },
  utility: { base: 250, perNm: 10, perPax: 0, perKg: 1.0, deadlineSlack: 1.8, weight: 0, rep: 0, comfortWeight: 0, floorPremium: 1.2 },
};

/** Pay floor = costFactor x (refType block hours est x refType leaseHourly + refType trip and taxi fuel cost). */
export const PAY_FLOOR = { costFactor: 1.3 } as const;

/** Premium (regular-client) offers: a share of the drawn slots, more reputation needed, more pay. */
export const PREMIUM_RULES = { share: 0.2, repRequired: [60, 80], payMult: [1.15, 1.3] } as const;

export const WEATHER_PAY: Readonly<Record<CareerWeatherId, { mult: number; weight: number; windKt: readonly [number, number] }>> = {
  clear: { mult: 1.0, weight: 0.3, windKt: [0, 6] },
  fair: { mult: 1.0, weight: 0.3, windKt: [4, 12] },
  overcast: { mult: 1.1, weight: 0.15, windKt: [6, 16] },
  gusty: { mult: 1.25, weight: 0.1, windKt: [12, 20] },
  drizzle: { mult: 1.15, weight: 0.08, windKt: [5, 14] },
  rain: { mult: 1.25, weight: 0.07, windKt: [8, 18] },
};

/**
 * Deadline = round up to 5 min of (CLASS_RULES.taxiMin + 60 d / gs x slack + marginMin), gs = refTas less the
 * headwind component along the route (A to B), or refTas - windKt x loopWindFactor (a scenic loop), at least
 * minGsFraction x refTas.
 */
export const DEADLINE_RULES = { marginMin: 5, roundToMin: 5, loopWindFactor: 0.5, minGsFraction: 0.5 } as const;

/** Board layout: the first slots of every board are fixed classes (the cheapest class able to use the field where one cannot). */
export const BOARD_RULES = {
  fixedSlots: ['trainer', 'trainer', 'tourer'] as const satisfies readonly AircraftClass[],
  /** Scenic loop length, NM; turning points at least this far from every field, m (2 NM: clear of ATZs). */
  scenicMinNm: 15, scenicMaxNm: 35, scenicFieldClearM: 3704, scenicRadiusM: 1500, scenicMaxAglFt: 2500,
  /** Wave-4 kinds come from their own stream (FNV-1a of `${seed}|${day}|${origin}|w4`) appended after the base offers. */
  wave4Salt: '|w4',
} as const;

/** The career clock and boards. */
export const CLOCK_RULES = {
  /** A new career starts on day 1 at this minute of the day (08:00). */
  startMin: 1440 + 8 * 60,
  /** No departures before / after these minutes of the day (07:00, 18:00). */
  firstDepartureMin: 7 * 60,
  lastDepartureMin: 18 * 60,
  /** Rest until tomorrow sets the clock to this minute of the next day (07:30). */
  restToMin: 7 * 60 + 30,
  /** Added after every job (paperwork, turnaround), min. */
  turnaroundMin: 30,
  /** Day of year flown on career day n: day0Doy + (n mod seasonDays): held to summer (June to August) so 18:00 departures land in daylight. */
  day0Doy: 152,
  seasonDays: 90,
  /** Offers on one board: minOffers + floor(rng * (extraOffers + 1)). */
  minOffers: 6,
  extraOffers: 3,
} as const;

/** Starting state of a new career, and the business rules. */
export const START_RULES = {
  cash: 5000, reputation: 20, maxFleet: 6, leaseSignOnHours: 5, saleFraction: 0.75, overdraftLimit: -5000,
  /** Each leased aircraft costs at least this many block hours of lease a day (charged at the day change, less hours flown that day). */
  leaseIdleHoursPerDay: 1,
} as const;

/** Fuel prices, $ per litre; grass strips sell avgas only, at a surcharge; elsewhere a fuel truck brings any grade at its surcharge. */
export const FUEL_RULES = {
  pricePerL: { avgas: 2.6, jetA1: 1.95 },
  densityKgL: { avgas: 0.719, jetA1: 0.8 },
  grassSurcharge: 0.1,
  truckSurcharge: 0.5,
} as const;

/** Defuelling: the drained fuel is credited at this fraction of its price. */
export const DEFUEL_RULES = { creditFraction: 0.5 } as const;

/** Landing fee = flat + perTonne x MTOW t, by field kind. */
export const LANDING_FEES = {
  home: { flat: 20, perTonne: 8 },
  sealed: { flat: 12, perTonne: 5 },
  grass: { flat: 5, perTonne: 0 },
  site: { flat: 0, perTonne: 0 },
} as const;

/** Bonuses and penalties at settlement, as fractions of base pay unless named $. */
export const SCORING_RULES = {
  onTime: 0.1,
  /** Extra when completed within earlyFraction of the deadline. */
  early: 0.05, earlyFraction: 0.8,
  /** Per minute late, capped. */
  latePerMin: 0.02, lateCap: 0.6,
  /** Landing bonus = landingMax x (score - landingFrom) / (100 - landingFrom), from landingFrom up. */
  landingMax: 0.1, landingFrom: 60,
  /** Hard landing (sink, fpm): reputation only (REP_RULES.hardLanding), no pay line. Heavy landing: inspection $ x class payMult. */
  hardSinkFpm: 600, hardSinkHeliFpm: 400,
  heavySinkFpm: 900, heavySinkHeliFpm: 600, heavyInspection: 500,
  /** Comfort: bonus weight x (score - comfortFrom)/(100 - comfortFrom) above, penalty weight x (comfortFrom - score)/comfortFrom below. */
  comfortFrom: 70,
  /** Overspeed: $ per second above Vne x class payMult, capped. */
  overspeedPerS: 40, overspeedCap: 2000,
  /** High g: load factor above gHigh (pax jobs gHighPax) or below gLow -> inspection $ x class payMult. */
  gHigh: 3.5, gHighPax: 3.0, gLow: 0, gInspection: 300,
  /** Fuel at shutdown below the planning reserve less lowReserveMarginMin: fraction off; below criticalReserveFraction of the reserve: more. */
  lowReserveMarginMin: 10, lowReservePenalty: 0.1, criticalReserveFraction: 1 / 3, criticalReservePenalty: 0.25,
  /** Stopped on the runway: fraction off. */
  runwayStop: 0.05,
  // Scenic: base pay x done / total ('route' line); every turning point missed costs REP_RULES.waypointMissed.
  /** Crash (owned or leased): insurance excess = excessFraction x list price, clamped to [excessMin, excessMax]; days out of service. */
  excessFraction: 0.05, excessMin: 2000, excessMax: 25000, groundedDays: 2,
  /** Outlanding / lost: recovery $ x class payMult. */
  recovery: 1500, lostRecovery: 300,
} as const;

/** Reputation changes (clamped to 0..100 after summing). */
export const REP_RULES = {
  completed: 2, completedPositioning: 1, completedMedevac: 4,
  lateSmall: -1, lateLarge: -3, lateLargeMin: 10,
  goodLanding: 1, goodLandingScore: 85, hardLanding: -2,
  comfortHigh: 1, comfortHighScore: 90, comfortLow: -2, comfortLowScore: 50,
  overspeed: -3, highG: -3, lowReserve: -2, criticalReserve: -5, runwayStop: -1,
  waypointMissed: -1, routeMissed: -4,
  diverted: -4, outlanded: -8, crashed: -20, abandonedGround: -2, abandonedAir: -5, lost: -5,
} as const;

/** Comfort deductions, points per second unless stated (src/career/runtime/comfort.ts). */
export const COMFORT_RULES = {
  /** Low-pass time constant of the load factors, s. */
  filterS: 1,
  /** |nz - 1| above: points/s; vertical deductions are divided by (1 + turbulenceRelief x weather.turbulence). */
  verticalG: [[0.25, 1.5], [0.5, 5]], turbulenceRelief: 2,
  lateralG: [[0.12, 1], [0.25, 3]],
  bankDeg: [[30, 0.5], [45, 3]],
  /** Pitch outside [pitchDownDeg, pitchUpDeg]. */
  pitchUpDeg: 15, pitchDownDeg: -10, pitchRate: 1,
  /** Descent faster than descentFpm for longer than descentHoldS (unpressurised only). */
  descentFpm: 1000, descentHoldS: 5, descentRate: 0.3,
  /** Stall warning (helicopters: low rotor RPM horn where the type has one, else none), only above stallMinAglFt and not in the landing flare. */
  stallRate: 3, stallMinAglFt: 50,
  /** Touchdown sink above landingSinkFpm: (sink - landingSinkFpm) / landingSinkPerPoint points; each bounce bouncePoints. */
  landingSinkFpm: 360, landingSinkPerPoint: 15, bouncePoints: 5,
  /** Counted only airborne or above this ground speed, kt (taxi turns do not count). */
  minGroundKt: 30,
} as const;

/** Landing score (src/career/runtime/landingScore.ts), points out of 100. */
export const LANDING_SCORE_RULES = {
  /** Aeroplanes: centreline (0 at centrelineZeroM), sink (full to sinkFullFpm, 0 at sinkZeroFpm), zone, drift (0 at driftZeroDeg), bounce (0 above 1 ft). */
  centreline: 25, centrelineZeroM: 10,
  sink: 35, sinkFullFpm: 300, sinkZeroFpm: 700,
  zone: 20, zoneFullFt: 400, zoneZeroFt: 200,
  drift: 10, driftZeroDeg: 10,
  bounce: 10,
  /** Aim point: min(aimMaxM, aimFraction x length). */
  aimMaxM: 150, aimFraction: 0.15,
  /** Grass or shorter than this: full zone points from threshold + shortZoneStartM to the end of the first third, 0 at the threshold and at half length. */
  shortFieldM: 900, shortZoneStartM: 15,
  /** Helicopters: sink (full to, 0 at), bank at contact (0 at), ground speed at contact (full to, 0 at), spot distance (full within, 0 at). */
  heliSink: 50, heliSinkFullFpm: 200, heliSinkZeroFpm: 500,
  heliBank: 15, heliBankZeroDeg: 10,
  heliGs: 15, heliGsFullKt: 2, heliGsZeroKt: 10,
  heliSpot: 20, heliSpotFullM: 15, heliSpotZeroM: 100,
} as const;

/** Completion and field geometry (src/career/runtime/completion.ts). Nothing completes, diverts or outlands until the job has been airborne and is in phase 'landed'. */
export const COMPLETION_RULES = {
  /** Inside a field: |along| <= length/2 + alongMarginM and |across| <= acrossM (field frame). */
  alongMarginM: 200, acrossM: 250,
  /** Stopped: ground speed below this, m/s; engines off and the parking brake set for stoppedS, or engines off with no brake for chocksS ("chocks in"). */
  stoppedMs: 0.5, stoppedS: 3, chocksS: 12,
  /** Engines off and stopped this long with no brake: the strip hints "Set the parking brake (or wait) to finish", s. */
  brakeHintS: 5,
  /** Shut down away from any field this long: outlanded, s. */
  outlandS: 10,
  /** Helicopter site: within siteRadiusM of the spot; on the ground siteHoldS. */
  siteRadiusM: 60, siteHoldS: 30,
  /** Sealed apron: |along - apronAlong| <= 40 and across in [w + 20, w + 65]; grass: within 60 m of the parking spot; home: inside APRON_RECT or within homeStandM of a PARKING_SPOTS stand. */
  apronAlongM: 40, apronAcrossMin: 20, apronAcrossMax: 65, grassSpotM: 60, homeStandM: 40,
} as const;
