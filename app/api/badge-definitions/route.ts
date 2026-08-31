import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/badge-definitions — List all badges
export async function GET() {
  const { data, error } = await supabase
    .from("badge_definitions")
    .select("id, name, description, image_url, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ badges: data ?? [] });
}

// POST /api/badge-definitions — Create a new badge
export async function POST(request: NextRequest) {
  try {
    const { name, description, imageData } = await request.json();

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Badge name is required" }, { status: 400 });
    }
    if (!description || typeof description !== "string" || !description.trim()) {
      return NextResponse.json({ error: "Badge description is required" }, { status: 400 });
    }
    if (!imageData || typeof imageData !== "string") {
      return NextResponse.json({ error: "Badge image is required" }, { status: 400 });
    }

    // Generate slug from name
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    // Check if slug already exists
    const { data: existing } = await supabase
      .from("badge_definitions")
      .select("id")
      .eq("id", slug)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({ error: "A badge with a similar name already exists" }, { status: 400 });
    }

    const { error } = await supabase
      .from("badge_definitions")
      .insert({
        id: slug,
        name: name.trim(),
        description: description.trim(),
        image_url: imageData,
      });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id: slug });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

// DELETE /api/badge-definitions?id=... — Delete a badge
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Invalid badge id" }, { status: 400 });
  }

  const { error } = await supabase
    .from("badge_definitions")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
