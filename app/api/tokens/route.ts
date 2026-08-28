import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("badge_tokens")
    .select("id, badge_id, awarded_by, used")
    .eq("token", token.trim())
    .limit(1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }

  const record = data[0];

  if (record.used) {
    return NextResponse.json({ error: "Token already used" }, { status: 410 });
  }

  return NextResponse.json({
    valid: true,
    badgeId: record.badge_id,
    awardedBy: record.awarded_by,
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

export async function PATCH(request: NextRequest) {
  const { token, email } = await request.json();

  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  const { error } = await supabase
    .from("badge_tokens")
    .update({ used: true, used_by_email: email ?? null })
    .eq("token", token.trim());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ marked: true });
}
