import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { creditAndAward } from "@/lib/award-claim";

async function isMember(email: string) {
  for (const table of ["executives_personal_info", "registration_personal_info"]) {
    const { data } = await supabase.from(table).select("email").eq("email", email).limit(1);
    if (data?.length) return true;
  }
  return false;
}

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
  let requiresApproval = false;
  let requirement: string | null = null;
  let tracksClaims = false;
  if (token !== undefined && token !== null && token !== "") {
    if (typeof token !== "string") {
      return NextResponse.json({ error: "Invalid QR code." }, { status: 400 });
    }

    // "*" so claims keep working before qr_claim_limits.sql has been run.
    const { data: tokenRows, error: tokenError } = await supabase
      .from("badge_tokens")
      .select("*")
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
    requiresApproval = !!tokenRow.requires_approval;
    requirement = tokenRow.requirement ?? null;
    tracksClaims = requiresApproval || tokenRow.max_claims != null;
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

  const by = typeof awardedBy === "string" && awardedBy.trim() ? awardedBy.trim() : null;
  const waiting = { pending: true, requirement };

  // QRs with a limit or approval keep one qr_claims row per person: the unique
  // index stops a second claim and a database trigger enforces the limit.
  let claimId: string | null = null;
  if (tracksClaims && tokenId) {
    // These claims hold a limited slot, so a made-up email must not take one.
    if (!(await isMember(trimmedEmail))) {
      return NextResponse.json({ error: "Email not found." }, { status: 404 });
    }

    const { data: prior, error: priorError } = await supabase
      .from("qr_claims")
      .select("status")
      .eq("token_id", tokenId)
      .eq("email", trimmedEmail)
      .limit(1);

    if (priorError) {
      return NextResponse.json({ error: priorError.message }, { status: 500 });
    }
    if (prior?.[0]?.status === "pending") {
      return NextResponse.json(waiting);
    }

    // An approved row with no badge is an interrupted award: fall through and repair it.
    if (!prior?.length) {
      const { data: inserted, error: insertError } = await supabase
        .from("qr_claims")
        .insert({
          token_id: tokenId,
          email: trimmedEmail,
          status: requiresApproval ? "pending" : "approved",
          awarded_by: by,
        })
        .select("id");

      if (insertError?.code === "23505") {
        return NextResponse.json(requiresApproval ? waiting : { alreadyEarned: true });
      }
      if (insertError?.code === "QR001") {
        return NextResponse.json(
          { error: "This QR code has reached its claim limit." },
          { status: 409 }
        );
      }
      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
      if (requiresApproval) {
        return NextResponse.json(waiting);
      }
      claimId = inserted?.[0]?.id ?? null;
    }
  }

  // One-time QRs are consumed with UPDATE ... WHERE claimed_at IS NULL, so at
  // most one caller wins even when two people scan at the same moment.
  let consumed = false;
  if (singleUse && tokenId && !tracksClaims) {
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

  const { error, credited } = await creditAndAward({
    email: trimmedEmail,
    badgeId,
    tokenId,
    ciscoins: tokenCiscoins,
    awardedBy: by,
  });

  if (error) {
    if (consumed && tokenId) {
      await supabase
        .from("badge_tokens")
        .update({ claimed_at: null, claimed_by: null })
        .eq("id", tokenId);
    }
    if (claimId) {
      await supabase.from("qr_claims").delete().eq("id", claimId);
    }
    return NextResponse.json({ error }, { status: 500 });
  }

  return NextResponse.json({ awarded: true, ciscoins: credited });
}
