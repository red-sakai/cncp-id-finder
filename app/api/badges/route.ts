import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email");

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("user_badges")
    .select("badge_id, awarded_at, awarded_by")
    .eq("email", email.trim().toLowerCase());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ badges: data ?? [] });
}

export async function POST(request: NextRequest) {
  const { email, badgeId, awardedBy, token } = await request.json();

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  if (!badgeId || typeof badgeId !== "string") {
    return NextResponse.json({ error: "Invalid badge" }, { status: 400 });
  }

  const { data: definition, error: defError } = await supabase
    .from("badge_definitions")
    .select("id")
    .eq("id", badgeId)
    .limit(1);

  if (defError) {
    return NextResponse.json({ error: defError.message }, { status: 500 });
  }
  if (!definition || definition.length === 0) {
    return NextResponse.json({ error: "Invalid badge" }, { status: 400 });
  }

  const trimmedEmail = email.trim().toLowerCase();

  // Everything that can reject a claim is checked before the QR is consumed,
  // so a rejected claim never burns a one-time code.
  let tokenId: string | null = null;
  let singleUse = false;
  let tokenCiscoins: number | null = null;
  if (token !== undefined && token !== null && token !== "") {
    if (typeof token !== "string") {
      return NextResponse.json({ error: "Invalid QR code." }, { status: 400 });
    }

    const { data: tokenRows, error: tokenError } = await supabase
      .from("badge_tokens")
      .select("id, badge_id, expires_at, ciscoins, single_use, claimed_at")
      .eq("token", token.trim())
      .limit(1);

    if (tokenError) {
      return NextResponse.json({ error: tokenError.message }, { status: 500 });
    }

    const tokenRow = tokenRows?.[0];
    if (!tokenRow) {
      return NextResponse.json({ error: "Invalid QR code." }, { status: 404 });
    }
    if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: "This QR code has expired." }, { status: 410 });
    }
    if (tokenRow.badge_id !== badgeId) {
      return NextResponse.json({ error: "This QR code is for a different badge." }, { status: 400 });
    }
    if (tokenRow.single_use && tokenRow.claimed_at) {
      return NextResponse.json(
        { error: "This QR code has already been claimed." },
        { status: 409 }
      );
    }

    tokenId = tokenRow.id;
    singleUse = tokenRow.single_use;
    tokenCiscoins = tokenRow.ciscoins ?? null;
  }

  const { data: existing } = await supabase
    .from("user_badges")
    .select("id")
    .eq("email", trimmedEmail)
    .eq("badge_id", badgeId)
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json({ alreadyEarned: true });
  }

  // One-time QRs are consumed with UPDATE ... WHERE claimed_at IS NULL, so at
  // most one caller wins even when two people scan at the same moment.
  let consumed = false;
  if (singleUse && tokenId) {
    const { data: claimed, error: claimError } = await supabase
      .from("badge_tokens")
      .update({ claimed_at: new Date().toISOString(), claimed_by: trimmedEmail })
      .eq("id", tokenId)
      .is("claimed_at", null)
      .select("id");

    if (claimError) {
      return NextResponse.json({ error: claimError.message }, { status: 500 });
    }
    if (!claimed || claimed.length === 0) {
      return NextResponse.json(
        { error: "This QR code has already been claimed." },
        { status: 409 }
      );
    }
    consumed = true;
  }

  // The credit goes in before the badge row: if the badge insert then fails,
  // the coins are already banked and a rescan repairs the badge without the
  // ledger paying twice (the unique index on email + token_id absorbs it).
  let credited: number | null = null;
  if (tokenId && tokenCiscoins) {
    const { error: creditError } = await supabase.from("ciscoins_ledger").insert({
      email: trimmedEmail,
      amount: tokenCiscoins,
      type: "badge_claim",
      badge_id: badgeId,
      token_id: tokenId,
    });

    if (creditError && creditError.code !== "23505") {
      if (consumed) {
        await supabase
          .from("badge_tokens")
          .update({ claimed_at: null, claimed_by: null })
          .eq("id", tokenId);
      }
      return NextResponse.json({ error: creditError.message }, { status: 500 });
    }

    credited = tokenCiscoins;
  }

  const insertData: { email: string; badge_id: string; awarded_by?: string } = {
    email: trimmedEmail,
    badge_id: badgeId,
  };
  if (awardedBy && typeof awardedBy === "string" && awardedBy.trim()) {
    insertData.awarded_by = awardedBy.trim();
  }

  const { error } = await supabase.from("user_badges").insert(insertData);

  if (error) {
    if (consumed && tokenId) {
      await supabase
        .from("badge_tokens")
        .update({ claimed_at: null, claimed_by: null })
        .eq("id", tokenId);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ awarded: true, ciscoins: credited });
}
