import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, adminSessionValue } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  const { username, password } = await request.json();

  if (
    username === process.env.QR_USERNAME &&
    password === process.env.QR_PASSWORD
  ) {
    const response = NextResponse.json({ ok: true });
    response.cookies.set(ADMIN_COOKIE, adminSessionValue(), {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    return response;
  }

  return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(ADMIN_COOKIE);
  return response;
}
