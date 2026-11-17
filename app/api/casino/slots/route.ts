import { randomInt, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { checkWallet } from "@/lib/wallet-auth";
import { spinWith } from "@/lib/casino/slots";
import { applyToLedger, CasinoError } from "@/lib/casino/server";

// POST /api/casino/slots: one real-deal spin. The reels stop here, on the
// server, and the bet and the win land in the ledger as one signed row.
const MAX_BET = 1_000_000;

export async function POST(request: NextRequest) {
  let body: { email?: unknown; phone?: unknown; bet?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bet = typeof body.bet === "number" ? body.bet : NaN;
  if (!Number.isInteger(bet) || bet < 1 || bet > MAX_BET) {
    return NextResponse.json({ error: "Bet a whole number of Ciscoins, at least 1." }, { status: 400 });
  }

  const check = await checkWallet(
    typeof body.email === "string" ? body.email : "",
    typeof body.phone === "string" ? body.phone : ""
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const spin = spinWith(() => randomInt(0, 2 ** 32) / 2 ** 32);
  const win = bet * spin.pays;

  try {
    const balance = await applyToLedger({
      email: check.member.email,
      hand: randomUUID(),
      step: 0,
      amount: win - bet,
      need: bet,
      final: true,
    });
    return NextResponse.json({ stops: spin.stops, pays: spin.pays, combo: spin.combo, win, balance });
  } catch (e) {
    if (e instanceof CasinoError)
      return NextResponse.json({ error: e.message, balance: e.balance }, { status: e.status });
    throw e;
  }
}
