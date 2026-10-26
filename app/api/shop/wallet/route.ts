import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkWallet } from "@/lib/wallet-auth";

// Opens the wallet behind something the member actually knows: the email
// plus the phone number on file. Anyone can type another person's email
// into ID Finder, so the email alone never gets you a balance to spend.

export async function POST(request: NextRequest) {
  let body: { email?: unknown; phone?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email : "";
  const phone = typeof body.phone === "string" ? body.phone : "";

  const check = await checkWallet(email, phone);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const memberEmail = check.member.email;
  const { data: ledgerRows, error: ledgerError } = await supabase
    .from("ciscoins_ledger")
    .select("amount")
    .eq("email", memberEmail);

  // PGRST205 / 42P01 = the ledger table has not been created yet. Hand back a
  // null balance rather than failing a wallet that has already been checked.
  const ledgerMissing = ledgerError?.code === "PGRST205" || ledgerError?.code === "42P01";
  if (ledgerError && !ledgerMissing) {
    return NextResponse.json({ error: ledgerError.message }, { status: 500 });
  }

  const ciscoins = ledgerError
    ? null
    : (ledgerRows ?? []).reduce((total, row) => total + (row.amount ?? 0), 0);

  return NextResponse.json({
    ok: true,
    member: {
      first_name: check.member.first_name,
      last_name: check.member.last_name,
      email: memberEmail,
      ciscoins,
    },
  });
}
