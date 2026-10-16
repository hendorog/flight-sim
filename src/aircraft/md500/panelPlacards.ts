// RFM Fig 2-6 Vne placard, 250-C20B (RFM 2-15/2-16): KIAS by OAT (rows, C) and pressure altitude (columns, x 1000 ft), one
// card per weight band, transcribed in research-md500.md section 3 (P). A dash is NO FLIGHT. The cards hang in a holder on
// the real panel and the pilot selects one (RFM 4-2 "VNE card SELECT"); the panel face shows all three at once.
// Reproduced cell for cell here; T2's flight-model placard must read the same numbers (tests/aircraft/md500Setup.test.ts
// holds the check values).
import type { PanelDef } from '../../instruments/panelDef';

export const MD500_VNE_ALTITUDES_KFT = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18] as const;
export const MD500_VNE_OAT_C = [-30, -20, -10, 0, 10, 20, 30, 40, 45] as const;
/** [weight band label, rows of 10 columns]; 0 = dash. */
export const MD500_VNE_CARDS: readonly { label: string; /** Autorotation: chart Vne minus 22 kt, never below this (P) */ autoMin: number; kias: readonly (readonly number[])[] }[] = [
  { label: 'UP TO 2000 LB', autoMin: 85, kias: [
    [141, 136, 131, 127, 122, 118, 113, 109, 104, 0], [149, 144, 139, 134, 129, 124, 119, 115, 101, 0],
    [152, 151, 145, 140, 135, 130, 125, 110, 0, 0], [152, 152, 152, 146, 141, 136, 121, 102, 0, 0],
    [152, 152, 152, 152, 146, 137, 111, 0, 0, 0], [152, 152, 152, 151, 143, 123, 104, 0, 0, 0],
    [152, 152, 152, 148, 140, 114, 0, 0, 0, 0], [152, 152, 152, 144, 127, 106, 0, 0, 0, 0],
    [152, 152, 150, 143, 122, 103, 0, 0, 0, 0]] },
  { label: '2001 - 2500 LB', autoMin: 90, kias: [
    [141, 136, 131, 127, 122, 118, 113, 104, 90, 0], [149, 144, 139, 134, 129, 124, 113, 96, 84, 0],
    [152, 151, 145, 140, 135, 123, 104, 90, 0, 0], [152, 152, 152, 146, 138, 113, 97, 85, 0, 0],
    [152, 152, 152, 152, 124, 105, 91, 0, 0, 0], [152, 152, 152, 143, 115, 98, 86, 0, 0, 0],
    [152, 152, 152, 127, 107, 93, 0, 0, 0, 0], [152, 152, 152, 117, 100, 88, 0, 0, 0, 0],
    [152, 152, 137, 113, 98, 85, 0, 0, 0, 0]] },
  { label: '2501 - 3000 LB', autoMin: 95, kias: [
    [141, 136, 131, 127, 122, 115, 100, 85, 73, 0], [149, 144, 139, 134, 125, 106, 92, 79, 67, 0],
    [152, 151, 145, 139, 115, 99, 85, 73, 0, 0], [152, 152, 152, 125, 107, 93, 80, 68, 0, 0],
    [152, 152, 140, 116, 100, 86, 74, 0, 0, 0], [152, 152, 126, 108, 94, 81, 69, 0, 0, 0],
    [152, 144, 117, 102, 88, 76, 0, 0, 0, 0], [152, 129, 110, 95, 82, 71, 0, 0, 0, 0],
    [152, 124, 106, 93, 80, 69, 0, 0, 0, 0]] },
];

/** The three cards as painted placards: a header, then the OAT column and one column per altitude. */
export function md500VnePlacards(x0: number, y: number, cardW: number, gap: number): PanelDef['background']['placards'] {
  const out: { x: number; y: number; lines: readonly string[]; size?: number }[] = [];
  const pitch = (cardW - 26) / MD500_VNE_ALTITUDES_KFT.length;
  MD500_VNE_CARDS.forEach((card, k) => {
    const x = x0 + k * (cardW + gap);
    out.push({ x: x + cardW / 2, y, size: 7.5, lines: [`VNE KIAS · ${card.label}`,
      `AUTOROTATION −22K (${card.autoMin}K MIN) · MAX 130 BELOW 35 LB FUEL`] });
    out.push({ x: x + 13, y: y + 36, size: 7, lines: ['°C', ...MD500_VNE_OAT_C.map(String)] });
    MD500_VNE_ALTITUDES_KFT.forEach((alt, j) => out.push({ x: x + 26 + pitch * (j + 0.5), y: y + 36, size: 7,
      lines: [String(alt), ...card.kias.map(row => row[j] === 0 ? '—' : String(row[j]))] }));
  });
  return out;
}
