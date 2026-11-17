import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "crypto";
import { supabase } from "@/lib/supabase";
import type { HoldemState } from "./holdem";

// Real-deal money moves only through casino_apply() in Postgres, and that
// function only accepts writes signed with CASINO_SECRET. See migration/casino.sql.

export class CasinoError extends Error {
  constructor(message: string, public status: number, public balance?: number) {
    super(message);
  }
}

function secret(): string {
  const s = process.env.CASINO_SECRET;
  if (!s) throw new CasinoError("Real-deal mode isn't set up on this server yet. Practice mode still works.", 503);
  return s;
}

const tokenKey = () => createHash("sha256").update(`cncp-casino-token:${secret()}`).digest();

// The hand travels to the browser sealed: the bots' cards and the deck are
// inside, and AES-GCM stops anyone reading or editing them.
export function seal(st: HoldemState & { email: string }): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(st), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

export function unseal(token: string): HoldemState & { email: string } {
  try {
    const raw = Buffer.from(token, "base64url");
    const d = createDecipheriv("aes-256-gcm", tokenKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
    return JSON.parse(json);
  } catch (e) {
    if (e instanceof CasinoError) throw e;
    throw new CasinoError("That hand can't be read. Deal a new one.", 400);
  }
}

type ApplyResult = { ok: boolean; error?: string; balance?: number };

export async function applyToLedger(p: {
  email: string;
  hand: string;
  step: number;
  amount: number;
  need: number;
  final: boolean;
}): Promise<number> {
  const message = [p.email, p.hand, p.step, p.amount, p.need, p.final ? "1" : "0"].join("|");
  const sig = createHmac("sha256", secret()).update(message).digest("hex");

  const { data, error } = await supabase.rpc("casino_apply", {
    p_email: p.email,
    p_hand: p.hand,
    p_step: p.step,
    p_amount: p.amount,
    p_need: p.need,
    p_final: p.final,
    p_sig: sig,
  });
  if (error) {
    // PGRST202: the function is missing, so the migration has not been run.
    if (error.code === "PGRST202") throw new CasinoError("Real-deal mode isn't set up yet. Ask an admin to run the casino migration.", 503);
    throw new CasinoError(error.message, 500);
  }

  const r = (data ?? {}) as ApplyResult;
  if (r.ok) return r.balance ?? 0;
  switch (r.error) {
    case "insufficient_balance":
      throw new CasinoError("Not enough Ciscoins for that.", 409, r.balance);
    case "stale":
      throw new CasinoError("This hand already moved on, maybe in another tab. Deal a new one.", 409);
    case "not_configured":
    case "bad_signature":
      throw new CasinoError("Real-deal mode isn't set up correctly. Ask an admin to check the casino secret.", 503);
    default:
      throw new CasinoError("The table couldn't settle that. Try again.", 400);
  }
}

export async function balanceOf(email: string): Promise<number> {
  const { data, error } = await supabase.from("ciscoins_ledger").select("amount").eq("email", email);
  if (error) throw new CasinoError(error.message, 500);
  return (data ?? []).reduce((t, r) => t + (r.amount ?? 0), 0);
}
