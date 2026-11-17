import { next, type RngState } from "./rng";

export type SlotSymbol = "axie" | "seven" | "cncp" | "coin" | "bar" | "blank";

// One strip, shared by all three reels. 22 stops; the counts set the odds.
export const STRIP: SlotSymbol[] = [
  "bar", "coin", "blank", "cncp", "bar", "seven", "blank", "coin",
  "bar", "axie", "blank", "bar", "coin", "cncp", "blank", "bar",
  "coin", "seven", "blank", "bar", "cncp", "blank",
];

// Pays on the middle line, as a multiple of the bet (the bet is included).
// rtp() below works these out to a 96.2% return and a win on 21% of spins.
export const PAYTABLE: { combo: string; symbols: SlotSymbol[]; pays: number }[] = [
  { combo: "Three Axies", symbols: ["axie", "axie", "axie"], pays: 800 },
  { combo: "Three sevens", symbols: ["seven", "seven", "seven"], pays: 150 },
  { combo: "Three CNCP", symbols: ["cncp", "cncp", "cncp"], pays: 50 },
  { combo: "Three Ciscoins", symbols: ["coin", "coin", "coin"], pays: 20 },
  { combo: "Three bars", symbols: ["bar", "bar", "bar"], pays: 8 },
];

export const TWO_COIN_PAYS = 2;
export const MIXED_PAYS = 2;
const MIXED = new Set<SlotSymbol>(["bar", "seven", "cncp"]);

export function payoutMultiplier(line: SlotSymbol[]): { pays: number; combo: string | null } {
  for (const p of PAYTABLE) if (p.symbols.every((s, i) => line[i] === s)) return { pays: p.pays, combo: p.combo };
  if (line.filter((s) => s === "coin").length === 2) return { pays: TWO_COIN_PAYS, combo: "Two Ciscoins" };
  if (line.every((s) => MIXED.has(s))) return { pays: MIXED_PAYS, combo: "Any bar, seven or CNCP" };
  return { pays: 0, combo: null };
}

export type SpinResult = { stops: [number, number, number]; line: SlotSymbol[]; pays: number; combo: string | null };

export function spinWith(rand: () => number): SpinResult {
  const stops = [0, 1, 2].map(() => Math.floor(rand() * STRIP.length)) as [number, number, number];
  const line = stops.map((s) => STRIP[s]);
  return { stops, line, ...payoutMultiplier(line) };
}

export const spinSeeded = (s: RngState) => spinWith(() => next(s));

// Exact return to player over every stop combination.
export function rtp(): number {
  let total = 0;
  const n = STRIP.length;
  for (const a of STRIP) for (const b of STRIP) for (const c of STRIP) total += payoutMultiplier([a, b, c]).pays;
  return total / n ** 3;
}
