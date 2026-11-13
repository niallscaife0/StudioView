import { config } from '../config';
import { LocalAuth, SupabaseAuth, type AuthService } from './auth';
import { LocalRepository } from './local/localRepository';
import type { Repository } from './repository';

/** Le client Supabase n'est chargé qu'en mode hébergé (paquet séparé). */
export async function createServices(): Promise<{ repo: Repository; auth: AuthService }> {
  if (config.dataMode === 'supabase') {
    const [{ getSupabase }, { SupabaseRepository }] = await Promise.all([
      import('./supabase/client'),
      import('./supabase/supabaseRepository'),
    ]);
    const sb = getSupabase();
    return { repo: new SupabaseRepository(sb, config.storageBucket), auth: new SupabaseAuth(sb) };
  }
  return { repo: new LocalRepository(), auth: new LocalAuth() };
}
