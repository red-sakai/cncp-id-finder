import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token || typeof token !== "string") {
    // "*" so this keeps working before qr_claim_limits.sql has been run. The
    // response below still picks its fields, which keeps claimed_by private.
    const { data, error } = await supabase
      .from("badge_tokens")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Counts only, no emails. An error here means the table doesn't exist yet: show 0.
    // shortcut: reads at most 1000 claims (the PostgREST default), move to a SQL view past that.
    const { data: claims } = await supabase.from("qr_claims").select("token_id, status");
    const countOf = (tokenId: string, status: string) =>
      (claims ?? []).filter((c) => c.token_id === tokenId && c.status === status).length;

    return NextResponse.json({
      tokens: (data ?? []).map((t) => ({
        id: t.id,
        token: t.token,
        badge_id: t.badge_id,
        awarded_by: t.awarded_by,
        created_at: t.created_at,
        expires_at: t.expires_at,
        ciscoins: t.ciscoins,
        single_use: t.single_use,
        claimed_at: t.claimed_at,
        max_claims: t.max_claims ?? null,
        requires_approval: !!t.requires_approval,
        requirement: t.requirement ?? null,
        claimed_count: countOf(t.id, "approved"),
        pending_count: countOf(t.id, "pending"),
      })),
    });
  }

  const { data, error } = await supabase
    .from("badge_tokens")
    .select("*")
    .eq("token", token.trim())
    .limit(1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Invalid QR code." }, { status: 404 });
  }

  const expiresAt = data[0].expires_at;
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    return NextResponse.json({ error: "This QR code has expired." }, { status: 410 });
  }

  if (data[0].single_use && data[0].claimed_at) {
    return NextResponse.json(
      { error: "This QR code has already been claimed." },
      { status: 410 }
    );
  }

  // Only approved claims close the QR here. Someone whose claim is still waiting
  // can rescan, and the claim route gives the final answer for everyone else.
  if (data[0].max_claims != null) {
    const { data: approved, error: approvedError } = await supabase
      .from("qr_claims")
      .select("id")
      .eq("token_id", data[0].id)
      .eq("status", "approved");

    if (approvedError) {
      return NextResponse.json({ error: approvedError.message }, { status: 500 });
    }
    if ((approved?.length ?? 0) >= data[0].max_claims) {
      return NextResponse.json(
        { error: "This QR code has reached its claim limit." },
        { status: 410 }
      );
    }
  }

  return NextResponse.json({
    valid: true,
    badgeId: data[0].badge_id,
    awardedBy: data[0].awarded_by,
    ciscoins: data[0].ciscoins ?? null,
    singleUse: data[0].single_use,
    requiresApproval: !!data[0].requires_approval,
    requirement: data[0].requirement ?? null,
  });
}

const MAX_CISCOINS = 100000;
const MAX_CLAIMS = 100000;
const MAX_REQUIREMENT = 200;

export async function POST(request: NextRequest) {
  const { badgeId, awardedBy, expiresAt, ciscoins, singleUse, maxClaims, requiresApproval, requirement } =
    await request.json();

  if (!badgeId || typeof badgeId !== "string") {
    return NextResponse.json({ error: "Invalid badge ID" }, { status: 400 });
  }

  let ciscoinsValue: number | null = null;
  if (ciscoins !== undefined && ciscoins !== null) {
    if (typeof ciscoins !== "number" || !Number.isInteger(ciscoins)) {
      return NextResponse.json(
        { error: "Ciscoins must be a whole number" },
        { status: 400 }
      );
    }
    if (ciscoins < 1 || ciscoins > MAX_CISCOINS) {
      return NextResponse.json(
        { error: `Ciscoins must be between 1 and ${MAX_CISCOINS.toLocaleString("en-US")}` },
        { status: 400 }
      );
    }
    ciscoinsValue = ciscoins;
  }

  let singleUseValue = false;
  if (ciscoinsValue !== null) {
    if (typeof singleUse !== "boolean") {
      return NextResponse.json(
        { error: "Choose whether this QR can be claimed once or always" },
        { status: 400 }
      );
    }
    singleUseValue = singleUse;
  } else if (singleUse === true) {
    return NextResponse.json(
      { error: "Claim mode applies only to QRs that award Ciscoins" },
      { status: 400 }
    );
  }

  let maxClaimsValue: number | null = null;
  if (maxClaims !== undefined && maxClaims !== null) {
    if (ciscoinsValue === null || singleUseValue) {
      return NextResponse.json(
        { error: "A claim limit applies only to limited QRs that award Ciscoins" },
        { status: 400 }
      );
    }
    if (!Number.isInteger(maxClaims) || maxClaims < 1 || maxClaims > MAX_CLAIMS) {
      return NextResponse.json(
        { error: `The claim limit must be between 1 and ${MAX_CLAIMS.toLocaleString("en-US")}` },
        { status: 400 }
      );
    }
    maxClaimsValue = maxClaims;
  }

  const approvalValue = requiresApproval === true;
  if (approvalValue && !singleUseValue && maxClaimsValue === null) {
    return NextResponse.json(
      { error: "Approval applies only to one time or limited QRs" },
      { status: 400 }
    );
  }

  let requirementValue: string | null = null;
  if (requirement !== undefined && requirement !== null && requirement !== "") {
    if (!approvalValue) {
      return NextResponse.json(
        { error: "A requirement only works when the admin approves each claim" },
        { status: 400 }
      );
    }
    if (typeof requirement !== "string" || requirement.trim().length > MAX_REQUIREMENT) {
      return NextResponse.json(
        { error: `The requirement must be ${MAX_REQUIREMENT} characters or fewer` },
        { status: 400 }
      );
    }
    requirementValue = requirement.trim() || null;
  }

  let expiresAtIso: string | null = null;
  if (expiresAt !== undefined && expiresAt !== null && expiresAt !== "") {
    if (typeof expiresAt !== "string") {
      return NextResponse.json({ error: "Invalid expiry date" }, { status: 400 });
    }
    const parsed = new Date(expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Invalid expiry date" }, { status: 400 });
    }
    if (parsed.getTime() <= Date.now()) {
      return NextResponse.json({ error: "Expiry date must be in the future" }, { status: 400 });
    }
    expiresAtIso = parsed.toISOString();
  }

  const token = crypto.randomUUID();

  const insertData: {
    token: string;
    badge_id: string;
    awarded_by?: string;
    expires_at?: string | null;
    ciscoins?: number | null;
    single_use?: boolean;
    max_claims?: number;
    requires_approval?: boolean;
    requirement?: string;
  } = {
    token,
    badge_id: badgeId,
    expires_at: expiresAtIso,
  };
  if (awardedBy && typeof awardedBy === "string" && awardedBy.trim()) {
    insertData.awarded_by = awardedBy.trim();
  }
  if (ciscoinsValue !== null) {
    insertData.ciscoins = ciscoinsValue;
    insertData.single_use = singleUseValue;
  }
  // Only sent when used, so plain QRs can still be made before qr_claim_limits.sql has run.
  if (maxClaimsValue !== null) {
    insertData.max_claims = maxClaimsValue;
  }
  if (approvalValue) {
    insertData.requires_approval = true;
    // A one-time QR with approval is a limit of 1, so a waiting claim holds the only slot.
    if (singleUseValue) insertData.max_claims = 1;
    if (requirementValue) insertData.requirement = requirementValue;
  }

  const { error } = await supabase.from("badge_tokens").insert(insertData);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    token,
    ciscoins: ciscoinsValue,
    singleUse: singleUseValue,
    maxClaims: maxClaimsValue,
    requiresApproval: approvalValue,
    requirement: requirementValue,
  });
}

export async function DELETE(request: NextRequest) {
  const { id } = await request.json();

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Invalid token ID" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("badge_tokens")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data?.length) {
    return NextResponse.json({ error: "QR code not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
