export type DataMode = 'local' | 'supabase';

const env = import.meta.env;

export const config = {
  dataMode: (env.VITE_DATA_MODE === 'supabase' ? 'supabase' : 'local') as DataMode,
  supabaseUrl: (env.VITE_SUPABASE_URL as string | undefined) ?? '',
  supabaseAnonKey: (env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '',
  storageBucket: (env.VITE_STORAGE_BUCKET as string | undefined) || 'media',
  maxUploadBytes: (Number(env.VITE_MAX_UPLOAD_MB) || 25) * 1024 * 1024,
};

export function configProblem(): string | null {
  if (config.dataMode !== 'supabase') return null;
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    return 'Mode supabase demandé, mais VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY est vide. Voir .env.example.';
  }
  return null;
}
