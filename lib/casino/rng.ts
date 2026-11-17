// sfc32: small, fast, and its whole state is four numbers, so a hand's
// randomness can travel inside its sealed state and replay identically.
export type RngState = [number, number, number, number];

export function next(s: RngState): number {
  let [a, b, c, d] = s;
  a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  s[0] = a; s[1] = b; s[2] = c; s[3] = d;
  return (t >>> 0) / 4294967296;
}

export function seedFrom(words: ArrayLike<number>): RngState {
  const s: RngState = [words[0] >>> 0, words[1] >>> 0, words[2] >>> 0, words[3] >>> 0];
  for (let i = 0; i < 12; i++) next(s);
  return s;
}

export function randomSeed(): RngState {
  const w = new Uint32Array(4);
  crypto.getRandomValues(w);
  return seedFrom(w);
}

export function shuffle<T>(arr: T[], s: RngState): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next(s) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
