import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { FEATURED_SLOTS, resolveFeatured, type FeaturedSlots } from "@/lib/featured-badges";

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email");

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("digital_ids")
    .select("card_style, is_public")
    .eq("email", email.trim().toLowerCase())
    .limit(1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ card_style: "white", is_public: false });
  }

  return NextResponse.json({ card_style: data[0].card_style, is_public: data[0].is_public });
}

export async function PATCH(request: NextRequest) {
  const { email, is_public, featured_badges } = await request.json();

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  if (is_public === undefined && featured_badges === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  if (is_public !== undefined && typeof is_public !== "boolean") {
    return NextResponse.json({ error: "is_public must be a boolean" }, { status: 400 });
  }

  const trimmed = email.trim().toLowerCase();
  const changes: { is_public?: boolean; featured_badges?: FeaturedSlots } = {};
  if (is_public !== undefined) changes.is_public = is_public;

  if (featured_badges !== undefined) {
    if (
      !Array.isArray(featured_badges) ||
      featured_badges.length > FEATURED_SLOTS ||
      featured_badges.some((id) => id !== null && typeof id !== "string")
    ) {
      return NextResponse.json({ error: "Invalid featured badges" }, { status: 400 });
    }

    const { data: owned, error: ownedError } = await supabase
      .from("user_badges")
      .select("badge_id")
      .eq("email", trimmed);

    if (ownedError) {
      return NextResponse.json({ error: ownedError.message }, { status: 500 });
    }

    // Only badges this member actually earned, no duplicates.
    const slots = resolveFeatured(featured_badges, (owned ?? []).map((b) => b.badge_id));
    const kept = featured_badges.filter((id) => id !== null).length;
    if (slots.filter((id) => id !== null).length !== kept) {
      return NextResponse.json({ error: "You can only feature badges you've earned" }, { status: 400 });
    }
    changes.featured_badges = slots;
  }

  const { data: existing } = await supabase
    .from("digital_ids")
    .select("id")
    .eq("email", trimmed)
    .limit(1);

  if (existing && existing.length > 0) {
    const { error } = await supabase
      .from("digital_ids")
      .update(changes)
      .eq("email", trimmed);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    const { error } = await supabase
      .from("digital_ids")
      .insert({ email: trimmed, card_style: "white", is_public: false, ...changes });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, ...changes });
}
