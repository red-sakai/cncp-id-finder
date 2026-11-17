import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { checkWallet } from "@/lib/wallet-auth";
import { BIG_BLIND, newHand, playerMove, publicView, type Move } from "@/lib/casino/holdem";
import { randomSeed } from "@/lib/casino/rng";
import { applyToLedger, balanceOf, CasinoError, seal, unseal } from "@/lib/casino/server";

// POST /api/casino/poker: real-deal Hold'em.
//   { op: "deal", buyIn, button }  starts a hand
//   { op: "act", token, move }     plays the member's turn
// Chips are charged as they go into the pot and the win is paid when the hand
// ends, each step signed into the ledger. The deck and the bots' cards stay
// inside the sealed token.

const MAX_BUY_IN = 1_000_000;

function parseMove(raw: unknown): Move | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as { type?: unknown; to?: unknown };
  if (m.type === "fold" || m.type === "check" || m.type === "call") return { type: m.type };
  if (m.type === "raise" && typeof m.to === "number" && Number.isInteger(m.to) && m.to > 0) return { type: "raise", to: m.to };
  return null;
}

export async function POST(request: NextRequest) {
  let body: { email?: unknown; phone?: unknown; op?: unknown; buyIn?: unknown; button?: unknown; token?: unknown; move?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const op = body.op;
  if (op !== "deal" && op !== "act") return NextResponse.json({ error: "Unknown table action." }, { status: 400 });

  let buyIn = 0;
  let button = 0;
  let move: Move | null = null;
  let token = "";
  if (op === "deal") {
    buyIn = typeof body.buyIn === "number" ? body.buyIn : NaN;
    if (!Number.isInteger(buyIn) || buyIn < BIG_BLIND || buyIn > MAX_BUY_IN)
      return NextResponse.json({ error: `Sit down with at least ${BIG_BLIND} Ciscoins.` }, { status: 400 });
    button = typeof body.button === "number" && Number.isInteger(body.button) ? body.button : 0;
  } else {
    token = typeof body.token === "string" ? body.token : "";
    move = parseMove(body.move);
    if (!token || !move) return NextResponse.json({ error: "Missing the hand or the move." }, { status: 400 });
  }

  const check = await checkWallet(
    typeof body.email === "string" ? body.email : "",
    typeof body.phone === "string" ? body.phone : ""
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const email = check.member.email;

  try {
    if (op === "deal") {
      const balance = await balanceOf(email);
      const stack = Math.min(buyIn, balance);
      if (stack < BIG_BLIND)
        throw new CasinoError(`You need at least ${BIG_BLIND} Ciscoins to sit in.`, 409, balance);

      const st = newHand({ handId: randomUUID(), rng: randomSeed(), stack, button });
      const committed = st.seats[0].committed;
      const newBalance = await applyToLedger({
        email, hand: st.handId, step: 0,
        amount: (st.done ? st.winnings[0] : 0) - committed,
        need: committed, final: st.done,
      });
      return NextResponse.json({ view: publicView(st), token: st.done ? null : seal({ ...st, email }), balance: newBalance });
    }

    const st = unseal(token);
    if (st.email !== email) throw new CasinoError("That hand belongs to someone else.", 403);
    const before = st.seats[0].committed;
    try {
      playerMove(st, move!);
    } catch (e) {
      throw new CasinoError(e instanceof Error ? e.message : "That move isn't allowed.", 400);
    }
    const added = st.seats[0].committed - before;
    const balance = await applyToLedger({
      email, hand: st.handId, step: st.step,
      amount: (st.done ? st.winnings[0] : 0) - added,
      need: added, final: st.done,
    });
    return NextResponse.json({ view: publicView(st), token: st.done ? null : seal(st), balance });
  } catch (e) {
    if (e instanceof CasinoError)
      return NextResponse.json({ error: e.message, balance: e.balance }, { status: e.status });
    throw e;
  }
}
