import { supabase } from "@/lib/supabase";

// The knowledge factor for the wallet: an email on its own is not enough,
// because anyone can type someone else's address into ID Finder. The phone
// number on file has to match before a balance can be read or spent.
// No new secret — this runs on the same publishable key as the rest of the API.
export type WalletMember = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
};

export type WalletCheck =
  | { ok: true; member: WalletMember }
  | { ok: false; status: number; error: string };

// Digits only, then the last ten: that tail lines up whether the member
// wrote 09692946559, 9692946559 or +63 969 294 6559.
const phoneTail = (raw: string) => raw.replace(/\D/g, "").slice(-10);

export async function checkWallet(rawEmail: string, rawPhone: string): Promise<WalletCheck> {
  const email = rawEmail.trim().toLowerCase();

  if (!email) {
    return { ok: false, status: 400, error: "Enter the email address on the account." };
  }
  if (rawPhone.replace(/\D/g, "").length < 7) {
    return { ok: false, status: 400, error: "Enter the phone number on the account." };
  }

  // Same member resolution as /api/lookup: executives first, then registration.
  const executives = await supabase
    .from("executives_personal_info")
    .select("first_name, last_name, email, phone")
    .eq("email", email)
    .limit(1);

  let members = executives.data;

  if (executives.error || !members || members.length === 0) {
    const registration = await supabase
      .from("registration_personal_info")
      .select("first_name, last_name, email, phone")
      .eq("email", email)
      .limit(1);

    if (registration.error) {
      return { ok: false, status: 500, error: registration.error.message };
    }
    members = registration.data;
  }

  if (!members || members.length === 0) {
    return { ok: false, status: 404, error: "No member found with that email address." };
  }

  const member = members[0];

  if (!member.phone || !member.phone.replace(/\D/g, "")) {
    return {
      ok: false,
      status: 409,
      error: "There is no phone number on file for this member. Ask a booth admin to add one.",
    };
  }

  if (phoneTail(member.phone) !== phoneTail(rawPhone)) {
    return { ok: false, status: 401, error: "That email address and phone number do not match." };
  }

  return { ok: true, member };
}
