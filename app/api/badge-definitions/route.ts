import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isAdmin } from "@/lib/admin-auth";

// GET /api/badge-definitions — List all badges
export async function GET() {
  // "*" so this keeps working before badge_disabled.sql has been run.
  const { data, error } = await supabase
    .from("badge_definitions")
    .select("*")
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

// PATCH /api/badge-definitions — Disable or reactivate a badge
export async function PATCH(request: NextRequest) {
  // Checks the login so a member can't reopen a badge an admin disabled.
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Please log in again." }, { status: 401 });
  }

  try {
    const { id, disabled } = await request.json();

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Invalid badge id" }, { status: 400 });
    }
    if (typeof disabled !== "boolean") {
      return NextResponse.json({ error: "Invalid badge status" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("badge_definitions")
      .update({ disabled })
      .eq("id", id)
      .select("id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data?.length) {
      return NextResponse.json({ error: "Badge not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, disabled });
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

  const { data, error } = await supabase
    .from("badge_definitions")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data?.length) {
    return NextResponse.json({ error: "Badge not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
