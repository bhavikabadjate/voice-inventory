// The shop's Supabase project. The publishable key is meant to ship inside the
// app: what it can reach is limited by the access rules in supabase/migrations.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://pmtejfsuceusgzrgvmvp.supabase.co';
export const SUPABASE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_KEY ?? 'sb_publishable_1j9ZLYnvf0rWWNoqmHSdTw_tXKXpDZR';
