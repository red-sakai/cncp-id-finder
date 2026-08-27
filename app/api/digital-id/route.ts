import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

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
  const { email, is_public } = await request.json();

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  if (typeof is_public !== "boolean") {
    return NextResponse.json({ error: "is_public must be a boolean" }, { status: 400 });
  }

  const trimmed = email.trim().toLowerCase();

  const { data: existing } = await supabase
    .from("digital_ids")
    .select("id")
    .eq("email", trimmed)
    .limit(1);

  if (existing && existing.length > 0) {
    const { error } = await supabase
      .from("digital_ids")
      .update({ is_public })
      .eq("email", trimmed);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    const { error } = await supabase
      .from("digital_ids")
      .insert({ email: trimmed, card_style: "white", is_public });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, is_public });
}
