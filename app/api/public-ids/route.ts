import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("digital_ids")
    .select("email, card_style")
    .eq("is_public", true)
    .order("card_style", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const emails = (data ?? []).map((d) => d.email);

  if (emails.length === 0) {
    return NextResponse.json({ ids: [] });
  }

  const { data: users } = await supabase
    .from("registration_personal_info")
    .select("first_name, last_name, email, course_year_section, membership_type")
    .in("email", emails);

  const { data: allBadges } = await supabase
    .from("user_badges")
    .select("email, badge_id")
    .in("email", emails)
    .order("awarded_at", { ascending: true });

  const userMap = new Map((users ?? []).map((u) => [u.email, u]));
  const badgeMap = new Map<string, string[]>();
  (allBadges ?? []).forEach((b) => {
    if (!badgeMap.has(b.email)) badgeMap.set(b.email, []);
    badgeMap.get(b.email)!.push(b.badge_id);
  });

  const ids = (data ?? []).map((d) => {
    const user = userMap.get(d.email);
    return {
      ...user,
      card_style: d.card_style,
      badges: badgeMap.get(d.email) ?? [],
    };
  }).filter((item) => item.first_name);

  return NextResponse.json({ ids });
}
