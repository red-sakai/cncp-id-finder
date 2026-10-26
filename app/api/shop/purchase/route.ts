import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkWallet } from "@/lib/wallet-auth";

// POST /api/shop/purchase — buy one item for the verified member.
// The phone number has to match first, so this endpoint cannot be used to
// spend somebody's balance from their email alone. The price, the balance
// check and the spend all happen inside the shop_purchase() Postgres
// function, in one transaction.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_EMAIL = 254;

type PurchaseResult = {
  ok: boolean;
  error?: string;
  balance?: number;
  price?: number;
  item?: string;
  duplicate?: boolean;
};

export async function POST(request: NextRequest) {
  let body: { email?: unknown; phone?: unknown; itemId?: unknown; requestId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) {
    return NextResponse.json({ error: "Member email is required" }, { status: 400 });
  }
  if (email.length > MAX_EMAIL) {
    return NextResponse.json({ error: "That email is too long." }, { status: 400 });
  }

  const phone = typeof body.phone === "string" ? body.phone : "";

  const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
  if (!itemId) {
    return NextResponse.json({ error: "Item id is required" }, { status: 400 });
  }

  // The client sends one id per tap and reuses it on a retry, which is what
  // makes a repeated request report the first result instead of charging twice.
  let requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  if (requestId && !UUID_RE.test(requestId)) {
    return NextResponse.json({ error: "Invalid request id" }, { status: 400 });
  }
  if (!requestId) requestId = crypto.randomUUID();

  // Same gate as opening the wallet: email + phone on file, or no spend.
  const check = await checkWallet(email, phone);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const { data, error } = await supabase.rpc("shop_purchase", {
    p_email: check.member.email,
    p_item_id: itemId,
    p_request_id: requestId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = (data ?? {}) as PurchaseResult;

  if (!result.ok) {
    const balance = typeof result.balance === "number" ? result.balance : 0;
    const price = typeof result.price === "number" ? result.price : 0;

    switch (result.error) {
      case "insufficient_balance":
        return NextResponse.json(
          {
            error: `Not enough Ciscoins. This costs ${price.toLocaleString("en-US")} and you have ${balance.toLocaleString("en-US")}.`,
            balance,
            price,
          },
          { status: 409 }
        );
      case "unknown_item":
        return NextResponse.json({ error: "That shop item does not exist." }, { status: 404 });
      case "item_unavailable":
        return NextResponse.json({ error: "This item is no longer available." }, { status: 410 });
      case "missing_email":
      case "missing_item":
      case "missing_request":
        return NextResponse.json({ error: "Missing purchase details." }, { status: 400 });
      default:
        return NextResponse.json({ error: "Purchase could not be completed." }, { status: 400 });
    }
  }

  return NextResponse.json({
    ok: true,
    balance: result.balance ?? 0,
    price: result.price ?? 0,
    item: result.item ?? "",
    duplicate: result.duplicate === true,
  });
}
