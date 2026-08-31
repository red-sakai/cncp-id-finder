import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token || typeof token !== "string") {
    const { data, error } = await supabase
      .from("badge_tokens")
      .select("id, token, badge_id, awarded_by, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ tokens: data ?? [] });
  }

  const { data, error } = await supabase
    .from("badge_tokens")
    .select("badge_id, awarded_by")
    .eq("token", token.trim())
    .limit(1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Invalid QR code." }, { status: 404 });
  }

  return NextResponse.json({
    valid: true,
    badgeId: data[0].badge_id,
    awardedBy: data[0].awarded_by,
  });
}

export async function POST(request: NextRequest) {
  const { badgeId, awardedBy } = await request.json();

  if (!badgeId || typeof badgeId !== "string") {
    return NextResponse.json({ error: "Invalid badge ID" }, { status: 400 });
  }

  const token = crypto.randomUUID();

  const insertData: { token: string; badge_id: string; awarded_by?: string } = {
    token,
    badge_id: badgeId,
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
