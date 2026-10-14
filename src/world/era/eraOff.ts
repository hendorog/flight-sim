// Deep Time, increment 2 (WP0a): the dev A/B switch of the era's world layers, `?eraoff=plume,lava,speckle,
// understorey` (or `all`). Read once per page from the URL (main thread and dev pages; never in workers, which build
// no shaders or layers) and consulted at construction time: a switched-off layer is not built at all (an effect not
// created, a shader slot left empty, a uniform held at 0), so an A/B is a reload. Has no effect in the present day,
// where none of these layers exist. Pure apart from the one read of location.search (absent in node: nothing off).

/** The era layers the switch knows. */
export const ERA_LAYER_NAMES = ['plume', 'lava', 'speckle', 'understorey'] as const;
export type EraLayerName = (typeof ERA_LAYER_NAMES)[number];

/** The layers a query string switches off. */
export function parseEraOff(search: string): Set<EraLayerName> {
  const v = new URLSearchParams(search).get('eraoff');
  const out = new Set<EraLayerName>();
  if (!v) return out;
  for (const part of v.split(',').map((x) => x.trim().toLowerCase())) {
    if (part === 'all') ERA_LAYER_NAMES.forEach((n) => out.add(n));
    else if ((ERA_LAYER_NAMES as readonly string[]).includes(part)) out.add(part as EraLayerName);
  }
  return out;
}

let OFF: Set<EraLayerName> | null = null;

/** True when ?eraoff= switches this era layer off (this page). */
export function eraOff(name: EraLayerName): boolean {
  if (!OFF) OFF = parseEraOff((globalThis as { location?: { search?: string } }).location?.search ?? '');
  return OFF.has(name);
}

/** Tests: set the switched-off layers directly (null: read the URL again on the next query). */
export function setEraOff(names: Iterable<EraLayerName> | null): void {
  OFF = names ? new Set(names) : null;
}
