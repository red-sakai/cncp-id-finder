import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token || typeof token !== "string") {
    const { data, error } = await supabase
      .from("badge_tokens")
      .select(
        "id, token, badge_id, awarded_by, created_at, expires_at, ciscoins, single_use, claimed_at"
      )
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ tokens: data ?? [] });
  }

  const { data, error } = await supabase
    .from("badge_tokens")
    .select("badge_id, awarded_by, expires_at, ciscoins, single_use, claimed_at")
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

  return NextResponse.json({
    valid: true,
    badgeId: data[0].badge_id,
    awardedBy: data[0].awarded_by,
    ciscoins: data[0].ciscoins ?? null,
    singleUse: data[0].single_use,
  });
}

const MAX_CISCOINS = 100000;

export async function POST(request: NextRequest) {
  const { badgeId, awardedBy, expiresAt, ciscoins, singleUse } = await request.json();

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

  const { error } = await supabase.from("badge_tokens").insert(insertData);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    token,
    ciscoins: ciscoinsValue,
    singleUse: singleUseValue,
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
