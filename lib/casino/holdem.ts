import { bestScore, categoryOf, HAND_NAMES, type Card } from "./cards";
import { next, shuffle, type RngState } from "./rng";

// Texas Hold'em, four seats: the player in seat 0 and three bots. The whole
// hand is plain data, so the browser can run it for practice coins and the
// server can seal it into a token for real Ciscoins.

export const SMALL_BLIND = 5;
export const BIG_BLIND = 10;
export const BOT_NAMES = ["Router", "Switch", "Firewall"];
const SEATS = 4;
const SIMS = 90;

// tight raises the bar to continue; aggro raises how often a strong hand bets.
const BOT_STYLE = [
  { tight: 0.05, aggro: 0.55 },
  { tight: 0.15, aggro: 0.25 },
  { tight: -0.05, aggro: 0.4 },
];

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";
export type Act = "fold" | "check" | "call" | "bet" | "raise" | "allin" | "sb" | "bb";
export type Move = { type: "fold" } | { type: "check" } | { type: "call" } | { type: "raise"; to: number };

export type Seat = {
  name: string;
  stack: number;
  bet: number;
  committed: number;
  hole: Card[];
  folded: boolean;
  allIn: boolean;
  acted: boolean;
  last: Act | null;
};

export type HoldemEvent =
  | { t: "act"; seat: number; act: Act; to: number }
  | { t: "street"; street: Street; board: Card[] }
  | { t: "win"; seat: number; amount: number; hand: string | null };

export type HoldemState = {
  v: 1;
  handId: string;
  step: number;
  seats: Seat[];
  button: number;
  deck: Card[];
  board: Card[];
  street: Street;
  toAct: number;
  currentBet: number;
  minRaise: number;
  rng: RngState;
  events: HoldemEvent[];
  done: boolean;
  winnings: number[];
};

const canAct = (s: Seat) => !s.folded && !s.allIn;
const needsAction = (st: HoldemState, s: Seat) => canAct(s) && (!s.acted || s.bet < st.currentBet);
const pot = (st: HoldemState) => st.seats.reduce((t, s) => t + s.committed, 0);

function nextToAct(st: HoldemState, from: number): number {
  for (let i = 1; i <= SEATS; i++) {
    const idx = (from + i) % SEATS;
    if (needsAction(st, st.seats[idx])) return idx;
  }
  return -1;
}

function pay(st: HoldemState, i: number, amount: number) {
  const s = st.seats[i];
  const paid = Math.min(amount, s.stack);
  s.stack -= paid;
  s.bet += paid;
  s.committed += paid;
  if (s.stack === 0) s.allIn = true;
  return paid;
}

export function newHand(opts: { handId: string; rng: RngState; stack: number; button: number }): HoldemState {
  const st: HoldemState = {
    v: 1,
    handId: opts.handId,
    step: 0,
    seats: ["You", ...BOT_NAMES].map((name) => ({
      name, stack: opts.stack, bet: 0, committed: 0, hole: [], folded: false, allIn: false, acted: false, last: null,
    })),
    button: ((opts.button % SEATS) + SEATS) % SEATS,
    deck: shuffle([...Array(52).keys()], opts.rng),
    board: [],
    street: "preflop",
    toAct: -1,
    currentBet: BIG_BLIND,
    minRaise: BIG_BLIND,
    rng: opts.rng,
    events: [],
    done: false,
    winnings: [0, 0, 0, 0],
  };
  for (let r = 0; r < 2; r++)
    for (let i = 0; i < SEATS; i++) st.seats[(st.button + 1 + i) % SEATS].hole.push(st.deck.pop()!);

  const sb = (st.button + 1) % SEATS;
  const bb = (st.button + 2) % SEATS;
  pay(st, sb, SMALL_BLIND);
  st.seats[sb].last = "sb";
  st.events.push({ t: "act", seat: sb, act: "sb", to: st.seats[sb].bet });
  pay(st, bb, BIG_BLIND);
  st.seats[bb].last = "bb";
  st.events.push({ t: "act", seat: bb, act: "bb", to: st.seats[bb].bet });

  st.toAct = nextToAct(st, bb);
  run(st);
  return st;
}

function apply(st: HoldemState, i: number, move: Move) {
  const s = st.seats[i];
  const toCall = st.currentBet - s.bet;
  let act: Act;
  if (move.type === "fold") {
    s.folded = true;
    act = "fold";
  } else if (move.type === "check") {
    if (toCall !== 0) throw new Error("You can't check, there is a bet to call.");
    act = "check";
  } else if (move.type === "call") {
    if (toCall <= 0) throw new Error("There is nothing to call.");
    pay(st, i, toCall);
    act = s.allIn ? "allin" : "call";
  } else {
    const max = s.bet + s.stack;
    const to = Math.floor(move.to);
    if (!Number.isFinite(to) || to <= st.currentBet) throw new Error("A raise has to go above the current bet.");
    if (to > max) throw new Error("That raise is more than your stack.");
    if (to < st.currentBet + st.minRaise && to !== max)
      throw new Error(`The smallest raise is to ${st.currentBet + st.minRaise}.`);
    const wasBet = st.currentBet === 0;
    const raiseBy = to - st.currentBet;
    pay(st, i, to - s.bet);
    st.currentBet = to;
    if (raiseBy >= st.minRaise) {
      st.minRaise = raiseBy;
      for (const o of st.seats) if (o !== s && canAct(o)) o.acted = false;
    }
    act = s.allIn ? "allin" : wasBet ? "bet" : "raise";
  }
  s.acted = true;
  s.last = act;
  st.events.push({ t: "act", seat: i, act, to: s.bet });
}

function roundComplete(st: HoldemState) {
  const open = st.seats.filter(canAct);
  if (open.length <= 1) return open.every((s) => s.bet >= st.currentBet);
  return open.every((s) => s.acted && s.bet === st.currentBet);
}

function dealStreet(st: HoldemState) {
  for (const s of st.seats) {
    s.bet = 0;
    if (canAct(s)) s.acted = false;
  }
  st.currentBet = 0;
  st.minRaise = BIG_BLIND;
  st.deck.pop(); // burn
  if (st.street === "preflop") {
    st.board.push(st.deck.pop()!, st.deck.pop()!, st.deck.pop()!);
    st.street = "flop";
  } else {
    st.board.push(st.deck.pop()!);
    st.street = st.street === "flop" ? "turn" : "river";
  }
  st.events.push({ t: "street", street: st.street, board: [...st.board] });
  st.toAct = nextToAct(st, st.button);
}

function finish(st: HoldemState) {
  const live = st.seats.map((s, i) => i).filter((i) => !st.seats[i].folded);
  if (live.length === 1) {
    st.winnings[live[0]] = pot(st);
    st.events.push({ t: "win", seat: live[0], amount: pot(st), hand: null });
  } else {
    st.street = "showdown";
    const scores = st.seats.map((s) => (s.folded ? -1 : bestScore([...s.hole, ...st.board])));
    const levels = [...new Set(st.seats.map((s) => s.committed).filter((c) => c > 0))].sort((a, b) => a - b);
    let prev = 0;
    for (const lvl of levels) {
      const slice = (lvl - prev) * st.seats.filter((s) => s.committed >= lvl).length;
      let eligible = live.filter((i) => st.seats[i].committed >= lvl);
      if (eligible.length === 0) eligible = live; // a folded seat put in more than anyone left
      const best = Math.max(...eligible.map((i) => scores[i]));
      const winners = eligible.filter((i) => scores[i] === best);
      const share = Math.floor(slice / winners.length);
      winners.forEach((w, k) => (st.winnings[w] += share + (k < slice - share * winners.length ? 1 : 0)));
      prev = lvl;
    }
    st.winnings.forEach((amount, i) => {
      if (amount > 0) st.events.push({ t: "win", seat: i, amount, hand: HAND_NAMES[categoryOf(scores[i])] });
    });
  }
  st.seats.forEach((s, i) => (s.stack += st.winnings[i]));
  st.toAct = -1;
  st.done = true;
}

function run(st: HoldemState) {
  for (let guard = 0; !st.done; guard++) {
    if (guard > 200) throw new Error("Hand stalled.");
    if (st.seats.filter((s) => !s.folded).length === 1) return finish(st);
    if (roundComplete(st)) {
      if (st.street === "river") return finish(st);
      dealStreet(st);
      continue;
    }
    if (st.toAct === 0) return; // the player's turn
    botAct(st, st.toAct);
    st.toAct = nextToAct(st, st.toAct);
  }
}

// Share of the pot this hand wins against the live opponents, by simulation.
// Bots only see their own cards and the board.
function equity(st: HoldemState, i: number): number {
  const me = st.seats[i];
  const opponents = st.seats.filter((s, j) => j !== i && !s.folded).length;
  const known = new Set([...me.hole, ...st.board]);
  const unknown = [...Array(52).keys()].filter((c) => !known.has(c));
  let won = 0;
  for (let n = 0; n < SIMS; n++) {
    const deck = shuffle([...unknown], st.rng);
    const board = [...st.board];
    while (board.length < 5) board.push(deck.pop()!);
    const mine = bestScore([...me.hole, ...board]);
    let best = 0;
    let ties = 1;
    for (let o = 0; o < opponents; o++) {
      const theirs = bestScore([deck.pop()!, deck.pop()!, ...board]);
      if (theirs > mine) { best = 1; break; }
      if (theirs === mine) ties++;
    }
    if (!best) won += 1 / ties;
  }
  return won / SIMS;
}

function botAct(st: HoldemState, i: number) {
  const s = st.seats[i];
  const style = BOT_STYLE[(i - 1) % BOT_STYLE.length];
  const toCall = st.currentBet - s.bet;
  const total = pot(st);
  const odds = toCall / (total + toCall);
  const eq = equity(st, i);
  const r = next(st.rng);
  const othersOpen = st.seats.some((o, j) => j !== i && canAct(o));

  const strong = eq > 0.55 + style.tight;
  const bluff = toCall === 0 && r < style.aggro * 0.12;
  if (othersOpen && s.stack > toCall && ((strong && r < 0.45 + style.aggro * 0.4) || bluff)) {
    const size = Math.max(st.minRaise, Math.round((total * (0.45 + next(st.rng) * 0.55)) / 5) * 5);
    return apply(st, i, { type: "raise", to: Math.min(st.currentBet + size, s.bet + s.stack) });
  }
  if (toCall === 0) return apply(st, i, { type: "check" });
  if (eq >= odds + style.tight * 0.4 || (toCall <= BIG_BLIND && eq > 0.18)) return apply(st, i, { type: "call" });
  return apply(st, i, { type: "fold" });
}

export function playerMove(st: HoldemState, move: Move): HoldemState {
  if (st.done) throw new Error("This hand is over.");
  if (st.toAct !== 0) throw new Error("It's not your turn.");
  st.events = [];
  st.step += 1;
  apply(st, 0, move);
  st.toAct = nextToAct(st, 0);
  run(st);
  return st;
}

export type PlayerOptions = {
  toCall: number;
  canCheck: boolean;
  canRaise: boolean;
  minTo: number;
  maxTo: number;
};

export function playerOptions(st: HoldemState): PlayerOptions | null {
  if (st.done || st.toAct !== 0) return null;
  const s = st.seats[0];
  const toCall = Math.min(st.currentBet - s.bet, s.stack);
  const maxTo = s.bet + s.stack;
  const othersOpen = st.seats.some((o, j) => j !== 0 && canAct(o));
  return {
    toCall,
    canCheck: toCall === 0,
    canRaise: othersOpen && maxTo > st.currentBet,
    minTo: Math.min(st.currentBet + st.minRaise, maxTo),
    maxTo,
  };
}

export type PublicSeat = Omit<Seat, "hole" | "acted"> & { hole: (Card | null)[] };

export type PublicView = {
  handId: string;
  street: Street;
  board: Card[];
  pot: number;
  currentBet: number;
  button: number;
  toAct: number;
  done: boolean;
  seats: PublicSeat[];
  options: PlayerOptions | null;
  events: HoldemEvent[];
  winnings: number[];
  yourHand: string | null;
  // Chips the player has put in this hand; the ledger charges them as they go.
  yourCommitted: number;
};

// What the player is allowed to see: their own cards always, the bots' only
// at a showdown they reached.
export function publicView(st: HoldemState): PublicView {
  const reveal = st.done && st.street === "showdown";
  const me = st.seats[0];
  return {
    handId: st.handId,
    street: st.street,
    board: [...st.board],
    pot: pot(st),
    currentBet: st.currentBet,
    button: st.button,
    toAct: st.toAct,
    done: st.done,
    seats: st.seats.map((s, i) => ({
      name: s.name, stack: s.stack, bet: s.bet, committed: s.committed, folded: s.folded, allIn: s.allIn, last: s.last,
      hole: i === 0 || (reveal && !s.folded) ? [...s.hole] : s.hole.map(() => null),
    })),
    options: playerOptions(st),
    events: [...st.events],
    winnings: [...st.winnings],
    yourHand: st.board.length >= 3 ? HAND_NAMES[categoryOf(bestScore([...me.hole, ...st.board]))] : null,
    yourCommitted: me.committed,
  };
}
