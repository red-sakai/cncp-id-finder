import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const VALID_BADGES = ["welcome-to-cisco", "golden-alumni"];

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
  const { email, badgeId, awardedBy } = await request.json();

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  if (!badgeId || !VALID_BADGES.includes(badgeId)) {
    return NextResponse.json({ error: "Invalid badge" }, { status: 400 });
  }

  const trimmedEmail = email.trim().toLowerCase();

  const { data: existing } = await supabase
    .from("user_badges")
    .select("id")
    .eq("email", trimmedEmail)
    .eq("badge_id", badgeId)
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json({ alreadyEarned: true });
  }

  const insertData: { email: string; badge_id: string; awarded_by?: string } = {
    email: trimmedEmail,
    badge_id: badgeId,
  };
  if (awardedBy && typeof awardedBy === "string" && awardedBy.trim()) {
    insertData.awarded_by = awardedBy.trim();
  }

  const { error } = await supabase
    .from("user_badges")
    .insert(insertData);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ awarded: true });
}
