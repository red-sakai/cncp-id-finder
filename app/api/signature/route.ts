import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// POST /api/signature — Save a signature (base64 data URL)
export async function POST(request: NextRequest) {
  try {
    const { email, imageData } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }
    if (!imageData || typeof imageData !== "string") {
      return NextResponse.json({ error: "imageData (base64) is required" }, { status: 400 });
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
        .update({ signature_url: imageData })
        .eq("email", trimmed);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      const { error } = await supabase
        .from("digital_ids")
        .insert({ email: trimmed, card_style: "white", is_public: false, signature_url: imageData });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, signatureUrl: imageData });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

// GET /api/signature?email=... — Get saved signature
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email");

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const trimmed = email.trim().toLowerCase();

  const { data, error } = await supabase
    .from("digital_ids")
    .select("signature_url")
    .eq("email", trimmed)
    .limit(1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || data.length === 0 || !data[0].signature_url) {
    return NextResponse.json({ signatureUrl: null });
  }

  return NextResponse.json({ signatureUrl: data[0].signature_url });
}

// DELETE /api/signature?email=... — Remove saved signature
export async function DELETE(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email");

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const trimmed = email.trim().toLowerCase();

  const { error } = await supabase
    .from("digital_ids")
    .update({ signature_url: null })
    .eq("email", trimmed);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
