import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

export const ADMIN_COOKIE = "cncp-qr-admin";

// Derived from the credentials, so changing the password signs every admin out.
export function adminSessionValue() {
  return createHmac("sha256", process.env.QR_PASSWORD ?? "")
    .update(process.env.QR_USERNAME ?? "")
    .digest("hex");
}

export function isAdmin(request: NextRequest) {
  if (!process.env.QR_PASSWORD) return false;
  const given = Buffer.from(request.cookies.get(ADMIN_COOKIE)?.value ?? "");
  const expected = Buffer.from(adminSessionValue());
  return given.length === expected.length && timingSafeEqual(given, expected);
}
