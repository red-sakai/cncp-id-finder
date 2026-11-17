// Cards are 0..51: rank = c % 13 (0 = deuce .. 12 = ace), suit = floor(c / 13).
export type Card = number;

export const RANKS = "23456789TJQKA";
export const SUITS = ["s", "h", "d", "c"] as const;

export const rankOf = (c: Card) => c % 13;
export const suitOf = (c: Card) => Math.floor(c / 13);
export const cardLabel = (c: Card) => `${RANKS[rankOf(c)]}${SUITS[suitOf(c)]}`;

export const HAND_NAMES = [
  "High card",
  "Pair",
  "Two pair",
  "Three of a kind",
  "Straight",
  "Flush",
  "Full house",
  "Four of a kind",
  "Straight flush",
];

const BASE = 13 ** 5;

// Higher score wins. The category sits above five tie-break ranks in base 13.
// Runs thousands of times per bot decision, so it avoids allocating maps.
const COUNT = new Uint8Array(13);
const WHEEL = (1 << 12) | 0b1111; // A-2-3-4-5

export function score5(cs: Card[]): number {
  COUNT.fill(0);
  let bits = 0;
  let flush = true;
  const suit0 = suitOf(cs[0]);
  for (const c of cs) {
    const r = rankOf(c);
    COUNT[r]++;
    bits |= 1 << r;
    if (suitOf(c) !== suit0) flush = false;
  }
  let quad = -1, trip = -1, pair1 = -1, pair2 = -1;
  const singles: number[] = [];
  for (let r = 12; r >= 0; r--) {
    const n = COUNT[r];
    if (n === 4) quad = r;
    else if (n === 3) trip = r;
    else if (n === 2) {
      if (pair1 < 0) pair1 = r;
      else pair2 = r;
    } else if (n === 1) singles.push(r);
  }
  let straightHigh = -1;
  if (singles.length === 5) {
    if (singles[0] - singles[4] === 4) straightHigh = singles[0];
    else if (bits === WHEEL) straightHigh = 3;
  }

  let cat: number;
  let kick: number[];
  if (straightHigh >= 0 && flush) [cat, kick] = [8, [straightHigh]];
  else if (quad >= 0) [cat, kick] = [7, [quad, ...singles]];
  else if (trip >= 0 && pair1 >= 0) [cat, kick] = [6, [trip, pair1]];
  else if (flush) [cat, kick] = [5, singles];
  else if (straightHigh >= 0) [cat, kick] = [4, [straightHigh]];
  else if (trip >= 0) [cat, kick] = [3, [trip, ...singles]];
  else if (pair2 >= 0) [cat, kick] = [2, [pair1, pair2, ...singles]];
  else if (pair1 >= 0) [cat, kick] = [1, [pair1, ...singles]];
  else [cat, kick] = [0, singles];

  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 13 + (kick[i] ?? 0);
  return s;
}

export const categoryOf = (score: number) => Math.floor(score / BASE);

// Best five of five to seven cards.
export function bestScore(cards: Card[]): number {
  const n = cards.length;
  if (n <= 5) return score5(cards);
  let best = -1;
  const pick: Card[] = [];
  const walk = (start: number) => {
    if (pick.length === 5) {
      best = Math.max(best, score5(pick));
      return;
    }
    for (let i = start; i <= n - (5 - pick.length); i++) {
      pick.push(cards[i]);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return best;
}
