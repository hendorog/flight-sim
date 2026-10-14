// Field Guide store (WP7): which species the pilot has seen, persisted in localStorage like HintsCard's
// STORAGE_KEY. Pure and storage-injectable; every storage access is guarded, so a throwing or missing store
// leaves an in-memory guide that still works.

export interface GuideRecord {
  seen: true;
  /** ISO date-time of the first sighting. */
  firstSeen: string;
  /** Closest sighting distance, m. */
  closestM: number;
}

export type GuideData = Record<string, GuideRecord>;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export class FieldGuide {
  static readonly STORAGE_KEY = 'fs.fieldGuide.v1';
  private data: GuideData = {};

  constructor(private readonly storage?: StorageLike | null, private readonly now: () => Date = () => new Date()) {
    this.load();
  }

  private store(): StorageLike | null {
    if (this.storage !== undefined) return this.storage;
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  }

  private load(): void {
    try {
      const raw = this.store()?.getItem(FieldGuide.STORAGE_KEY);
      if (!raw) return;
      const j = JSON.parse(raw) as unknown;
      if (!j || typeof j !== 'object') return;
      for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
        const r = v as Partial<GuideRecord> | null;
        if (r && typeof r.firstSeen === 'string' && typeof r.closestM === 'number' && Number.isFinite(r.closestM)) {
          this.data[k] = { seen: true, firstSeen: r.firstSeen, closestM: r.closestM };
        }
      }
    } catch {
      this.data = {};
    }
  }

  private save(): void {
    try {
      this.store()?.setItem(FieldGuide.STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      /* private mode or quota: keep the in-memory guide */
    }
  }

  has(species: string): boolean {
    return !!this.data[species];
  }

  get(species: string): GuideRecord | undefined {
    return this.data[species];
  }

  get seenCount(): number {
    return Object.keys(this.data).length;
  }

  /** Record a sighting. Returns true on the species' first-ever sighting (the toast case). */
  record(species: string, distanceM: number): boolean {
    const d = Number.isFinite(distanceM) ? Math.max(0, distanceM) : 0;
    const r = this.data[species];
    if (r) {
      if (d < r.closestM) {
        r.closestM = d;
        this.save();
      }
      return false;
    }
    this.data[species] = { seen: true, firstSeen: this.now().toISOString(), closestM: d };
    this.save();
    return true;
  }
}
