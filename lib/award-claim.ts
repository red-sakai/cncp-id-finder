import { supabase } from "@/lib/supabase";

type Award = {
  email: string;
  badgeId: string;
  tokenId: string | null;
  ciscoins: number | null;
  awardedBy: string | null;
};

// The credit goes in before the badge row: if the badge insert then fails,
// the coins are already banked and a retry repairs the badge without the
// ledger paying twice (the unique index on email + token_id absorbs it).
export async function creditAndAward({ email, badgeId, tokenId, ciscoins, awardedBy }: Award) {
  let credited: number | null = null;
  if (tokenId && ciscoins) {
    const { error: creditError } = await supabase.from("ciscoins_ledger").insert({
      email,
      amount: ciscoins,
      type: "badge_claim",
      badge_id: badgeId,
      token_id: tokenId,
    });

    if (creditError && creditError.code !== "23505") {
      return { error: creditError.message, credited: null };
    }

    credited = ciscoins;
  }

  const { data: existing, error: existingError } = await supabase
    .from("user_badges")
    .select("id")
    .eq("email", email)
    .eq("badge_id", badgeId)
    .limit(1);

  if (existingError) {
    return { error: existingError.message, credited: null };
  }

  if (!existing?.length) {
    const insertData: { email: string; badge_id: string; awarded_by?: string } = {
      email,
      badge_id: badgeId,
    };
    if (awardedBy) insertData.awarded_by = awardedBy;

    const { error } = await supabase.from("user_badges").insert(insertData);
    if (error) {
      return { error: error.message, credited: null };
    }
  }

  return { error: null, credited };
}
