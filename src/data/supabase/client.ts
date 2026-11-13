import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../../config';

let client: SupabaseClient | null = null;

/** Client navigateur : clé publique uniquement. La sécurité repose sur la RLS. */
export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}
