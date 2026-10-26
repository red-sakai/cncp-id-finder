import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Shop item management. Prices live here rather than in a migration so the
// admin can change them from /qr without running SQL again.
const MAX_PRICE = 100_000;
const MAX_NAME = 60;
const MAX_DESC = 200;
const MAX_IMAGE = 200_000;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ITEM_COLUMNS = "id, name, description, image_url, price, active, sort_order, created_at";

type ItemBody = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  image_url?: unknown;
  price?: unknown;
  sort_order?: unknown;
  active?: unknown;
};

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : null);
const slugify = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Returns the price when it is a usable amount, null otherwise. Parsed into a
// real number rather than type-narrowed, so callers always get a typed value.
const readPrice = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_PRICE
    ? value
    : null;

function readBody(request: NextRequest): Promise<ItemBody> {
  return request.json();
}

// GET /api/shop — list items. ?all=1 includes inactive ones (admin view).
export async function GET(request: NextRequest) {
  const all = request.nextUrl.searchParams.get("all") === "1";

  let query = supabase.from("shop_items").select(ITEM_COLUMNS);
  if (!all) query = query.eq("active", true);

  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}

// POST /api/shop — create an item. The id doubles as the ledger's reference,
// so it is fixed at creation and never changed afterwards.
export async function POST(request: NextRequest) {
  let body: ItemBody;
  try {
    body = await readBody(request);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = asString(body.name);
  if (!name) {
    return NextResponse.json({ error: "Shop item name is required" }, { status: 400 });
  }
  if (name.length > MAX_NAME) {
    return NextResponse.json({ error: `Name must be at most ${MAX_NAME} characters.` }, { status: 400 });
  }

  const id = asString(body.id) ?? slugify(name);
  if (!id || !SLUG_RE.test(id)) {
    return NextResponse.json(
      { error: "Item id must be lowercase letters, numbers and hyphens." },
      { status: 400 }
    );
  }

  const description = asString(body.description);
  if (description && description.length > MAX_DESC) {
    return NextResponse.json({ error: `Description must be at most ${MAX_DESC} characters.` }, { status: 400 });
  }

  const imageUrl = asString(body.image_url);
  if (imageUrl && imageUrl.length > MAX_IMAGE) {
    return NextResponse.json({ error: "Image is too large." }, { status: 400 });
  }

  const price = readPrice(body.price);
  if (price === null) {
    return NextResponse.json(
      { error: `Enter a whole number of Ciscoins between 1 and ${MAX_PRICE.toLocaleString("en-US")}.` },
      { status: 400 }
    );
  }

  const active = typeof body.active === "boolean" ? body.active : true;

  const { data: existing, error: existingError } = await supabase
    .from("shop_items")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json({ error: "A shop item with that id already exists" }, { status: 409 });
  }

  let sortOrder: number;
  if (body.sort_order !== undefined) {
    if (
      typeof body.sort_order !== "number" ||
      !Number.isInteger(body.sort_order) ||
      body.sort_order < 0 ||
      body.sort_order > 9999
    ) {
      return NextResponse.json({ error: "Sort order must be a whole number from 0 to 9999." }, { status: 400 });
    }
    sortOrder = body.sort_order;
  } else {
    const { data: last } = await supabase
      .from("shop_items")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1);
    sortOrder = (last?.[0]?.sort_order ?? 0) + 1;
  }

  const { data, error } = await supabase
    .from("shop_items")
    .insert({
      id,
      name,
      description: description || null,
      image_url: imageUrl || null,
      price,
      active,
      sort_order: sortOrder,
    })
    .select(ITEM_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, item: data }, { status: 201 });
}

// PATCH /api/shop — update an item. Body carries the id to change; the id
// itself is not editable, because purchase history points at it.
export async function PATCH(request: NextRequest) {
  let body: ItemBody;
  try {
    body = await readBody(request);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const id = asString(body.id);
  if (!id) {
    return NextResponse.json({ error: "Item id is required" }, { status: 400 });
  }

  const fields: Record<string, string | number | boolean | null> = {};

  if (body.name !== undefined) {
    const name = asString(body.name);
    if (!name) return NextResponse.json({ error: "Shop item name is required" }, { status: 400 });
    if (name.length > MAX_NAME) {
      return NextResponse.json({ error: `Name must be at most ${MAX_NAME} characters.` }, { status: 400 });
    }
    fields.name = name;
  }

  if (body.description !== undefined) {
    const description = asString(body.description);
    if (description && description.length > MAX_DESC) {
      return NextResponse.json({ error: `Description must be at most ${MAX_DESC} characters.` }, { status: 400 });
    }
    fields.description = description || null;
  }

  if (body.image_url !== undefined) {
    const imageUrl = asString(body.image_url);
    if (imageUrl && imageUrl.length > MAX_IMAGE) {
      return NextResponse.json({ error: "Image is too large." }, { status: 400 });
    }
    fields.image_url = imageUrl || null;
  }

  if (body.price !== undefined) {
    const price = readPrice(body.price);
    if (price === null) {
      return NextResponse.json(
        { error: `Enter a whole number of Ciscoins between 1 and ${MAX_PRICE.toLocaleString("en-US")}.` },
        { status: 400 }
      );
    }
    fields.price = price;
  }

  if (body.sort_order !== undefined) {
    if (
      typeof body.sort_order !== "number" ||
      !Number.isInteger(body.sort_order) ||
      body.sort_order < 0 ||
      body.sort_order > 9999
    ) {
      return NextResponse.json({ error: "Sort order must be a whole number from 0 to 9999." }, { status: 400 });
    }
    fields.sort_order = body.sort_order;
  }

  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") {
      return NextResponse.json({ error: "Active must be true or false." }, { status: 400 });
    }
    fields.active = body.active;
  }

  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("shop_items")
    .update(fields)
    .eq("id", id)
    .select(ITEM_COLUMNS);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data?.length) {
    return NextResponse.json({ error: "Shop item not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, item: data[0] });
}

// DELETE /api/shop?id=... — remove an item. Purchase history keeps its
// shop_item_id, since the ledger has no foreign key on purpose.
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Invalid item id" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("shop_items")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data?.length) {
    return NextResponse.json({ error: "Shop item not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
