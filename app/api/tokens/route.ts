import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token || typeof token !== "string") {
    const { data, error } = await supabase
      .from("badge_tokens")
      .select("id, token, badge_id, awarded_by, created_at, expires_at")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ tokens: data ?? [] });
  }

  const { data, error } = await supabase
    .from("badge_tokens")
    .select("badge_id, awarded_by, expires_at")
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

  return NextResponse.json({
    valid: true,
    badgeId: data[0].badge_id,
    awardedBy: data[0].awarded_by,
  });
}

export async function POST(request: NextRequest) {
  const { badgeId, awardedBy, expiresAt } = await request.json();

  if (!badgeId || typeof badgeId !== "string") {
    return NextResponse.json({ error: "Invalid badge ID" }, { status: 400 });
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

  const insertData: { token: string; badge_id: string; awarded_by?: string; expires_at?: string | null } = {
    token,
    badge_id: badgeId,
    expires_at: expiresAtIso,
  };
  if (awardedBy && typeof awardedBy === "string" && awardedBy.trim()) {
    insertData.awarded_by = awardedBy.trim();
  }

  const { error } = await supabase.from("badge_tokens").insert(insertData);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ token });
}

export async function DELETE(request: NextRequest) {
  const { id } = await request.json();

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Invalid token ID" }, { status: 400 });
  }

  const { error } = await supabase
    .from("badge_tokens")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
