import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isAdmin } from "@/lib/admin-auth";
import { creditAndAward } from "@/lib/award-claim";

// Unlike the other admin routes these check the login on the server: an approval
// anyone could call would not be an approval, and the list holds member emails.
const NOT_ADMIN = { error: "Please log in again." };

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json(NOT_ADMIN, { status: 401 });
  }

  const { data, error } = await supabase
    .from("qr_claims")
    .select("id, token_id, email, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  // PGRST205 / 42P01 = qr_claim_limits.sql has not been run, so nothing can be waiting.
  if (error && error.code !== "PGRST205" && error.code !== "42P01") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ claims: data ?? [] });
}

export async function PATCH(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json(NOT_ADMIN, { status: 401 });
  }

  const { id, action } = await request.json();

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Invalid claim" }, { status: 400 });
  }
  if (action !== "approve" && action !== "decline") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const alreadyHandled = NextResponse.json(
    { error: "This claim was already handled. Refresh the list." },
    { status: 409 }
  );

  if (action === "decline") {
    const { data, error } = await supabase
      .from("qr_claims")
      .delete()
      .eq("id", id)
      .eq("status", "pending")
      .select("id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return data?.length ? NextResponse.json({ declined: true }) : alreadyHandled;
  }

  const { data: claims, error: claimError } = await supabase
    .from("qr_claims")
    .select("id, token_id, email, awarded_by")
    .eq("id", id)
    .eq("status", "pending")
    .limit(1);

  if (claimError) {
    return NextResponse.json({ error: claimError.message }, { status: 500 });
  }
  const claim = claims?.[0];
  if (!claim) return alreadyHandled;

  const { data: tokens, error: tokenError } = await supabase
    .from("badge_tokens")
    .select("id, badge_id, ciscoins, single_use")
    .eq("id", claim.token_id)
    .limit(1);

  if (tokenError) {
    return NextResponse.json({ error: tokenError.message }, { status: 500 });
  }
  const token = tokens?.[0];
  if (!token) {
    return NextResponse.json({ error: "This QR code no longer exists." }, { status: 404 });
  }

  // UPDATE ... WHERE status = 'pending' lets only one approval through, so a
  // double click or two admins at once cannot run the award twice.
  const { data: won, error: approveError } = await supabase
    .from("qr_claims")
    .update({ status: "approved" })
    .eq("id", claim.id)
    .eq("status", "pending")
    .select("id");

  if (approveError) {
    return NextResponse.json({ error: approveError.message }, { status: 500 });
  }
  if (!won?.length) return alreadyHandled;

  const { error: awardError, credited } = await creditAndAward({
    email: claim.email,
    badgeId: token.badge_id,
    tokenId: token.id,
    ciscoins: token.ciscoins ?? null,
    awardedBy: claim.awarded_by ?? null,
  });

  if (awardError) {
    await supabase.from("qr_claims").update({ status: "pending" }).eq("id", claim.id);
    return NextResponse.json({ error: awardError }, { status: 500 });
  }

  if (token.single_use) {
    const { error: usedError } = await supabase
      .from("badge_tokens")
      .update({ claimed_at: new Date().toISOString(), claimed_by: claim.email })
      .eq("id", token.id);

    // The member is already paid and the claim row still holds the only slot,
    // so this QR stays closed. Report it rather than undo a real payment.
    if (usedError) {
      return NextResponse.json({ error: usedError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ approved: true, ciscoins: credited });
}
