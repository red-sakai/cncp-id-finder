import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/shop/purchases — recent spend rows for the /qr log.
// The ledger has no foreign key to shop_items, so the name is mapped here
// and falls back to the raw id if the item was deleted since.
export async function GET(request: NextRequest) {
  const parsed = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 200) : 50;

  const [ledger, items] = await Promise.all([
    supabase
      .from("ciscoins_ledger")
      .select("email, amount, shop_item_id, created_at")
      .eq("type", "shop_purchase")
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase.from("shop_items").select("id, name, price, active"),
  ]);

  if (ledger.error) {
    return NextResponse.json({ error: ledger.error.message }, { status: 500 });
  }
  if (items.error) {
    return NextResponse.json({ error: items.error.message }, { status: 500 });
  }

  const names = new Map((items.data ?? []).map((item) => [item.id, item.name]));

  const purchases = (ledger.data ?? []).map((row) => ({
    email: row.email,
    amount: row.amount,
    item_id: row.shop_item_id,
    item_name: (row.shop_item_id && names.get(row.shop_item_id)) || row.shop_item_id || "Unknown item",
    created_at: row.created_at,
  }));

  return NextResponse.json({ purchases });
}
