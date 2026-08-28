import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const { email } = await request.json();

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const trimmed = email.trim().toLowerCase();

  const { data, error } = await supabase
    .from("registration_personal_info")
    .select("first_name, last_name, email, course_year_section, membership_type")
    .eq("email", trimmed)
    .limit(1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: badges } = await supabase
    .from("user_badges")
    .select("badge_id, awarded_at, awarded_by")
    .eq("email", trimmed)
    .order("awarded_at", { ascending: true });

  const { data: digitalId } = await supabase
    .from("digital_ids")
    .select("card_style, is_public")
    .eq("email", trimmed)
    .limit(1);

  return NextResponse.json({
    ...data[0],
    badges: badges ?? [],
    card_style: digitalId && digitalId.length > 0 ? digitalId[0].card_style : "white",
    is_public: digitalId && digitalId.length > 0 ? digitalId[0].is_public : false,
  });
}
