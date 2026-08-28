import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name");

  if (!name || typeof name !== "string") {
    return NextResponse.json({ valid: false });
  }

  const { data, error } = await supabase
    .from("valid_awarders")
    .select("name")
    .ilike("name", name.trim())
    .limit(1);

  if (error) {
    return NextResponse.json({ valid: false });
  }

  return NextResponse.json({ valid: data && data.length > 0 });
}
