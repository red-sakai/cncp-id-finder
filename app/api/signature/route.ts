import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// POST /api/signature — Upload a signature image (base64 PNG)
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

    // Strip data URL prefix if present (e.g. "data:image/png;base64,...")
    const base64Clean = imageData.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Clean, "base64");

    const filePath = `signatures/${trimmed}.png`;

    // Upsert (overwrite if exists)
    const { error: uploadError } = await supabase.storage
      .from("signatures")
      .upload(filePath, buffer, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("signatures")
      .getPublicUrl(filePath);

    const signatureUrl = urlData.publicUrl;

    // Save URL to digital_ids table
    const { data: existing } = await supabase
      .from("digital_ids")
      .select("id")
      .eq("email", trimmed)
      .limit(1);

    if (existing && existing.length > 0) {
      await supabase
        .from("digital_ids")
        .update({ signature_url: signatureUrl })
        .eq("email", trimmed);
    } else {
      await supabase
        .from("digital_ids")
        .insert({ email: trimmed, card_style: "white", is_public: false, signature_url: signatureUrl });
    }

    return NextResponse.json({ ok: true, signatureUrl });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

// GET /api/signature?email=... — Get saved signature URL
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
  const filePath = `signatures/${trimmed}.png`;

  await supabase.storage.from("signatures").remove([filePath]);
  await supabase
    .from("digital_ids")
    .update({ signature_url: null })
    .eq("email", trimmed);

  return NextResponse.json({ ok: true });
}
