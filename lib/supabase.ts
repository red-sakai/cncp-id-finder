import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_SUPABASE_PUBLIC_URL!;
const supabaseKey = process.env.NEXT_SUPABASE_PUBLIC_PUBLISHABLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);
