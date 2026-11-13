import type { SupabaseClient } from '@supabase/supabase-js';

export interface SessionInfo {
  email: string | null;
}

export interface AuthService {
  readonly requiresLogin: boolean;
  getSession(): Promise<SessionInfo | null>;
  onChange(cb: (s: SessionInfo | null) => void): () => void;
  /** Ne révèle jamais si l'adresse existe : même résultat dans les deux cas. */
  requestMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;
}

/** Mode démo : pas d'authentification, données locales à ce navigateur. */
export class LocalAuth implements AuthService {
  readonly requiresLogin = false;
  async getSession() {
    return { email: null };
  }
  onChange() {
    return () => {};
  }
  async requestMagicLink() {}
  async signOut() {}
}

export class SupabaseAuth implements AuthService {
  readonly requiresLogin = true;
  constructor(private sb: SupabaseClient) {}

  async getSession() {
    const { data } = await this.sb.auth.getSession();
    return data.session ? { email: data.session.user.email ?? null } : null;
  }

  onChange(cb: (s: SessionInfo | null) => void) {
    const { data } = this.sb.auth.onAuthStateChange((_event, session) => {
      cb(session ? { email: session.user.email ?? null } : null);
    });
    return () => data.subscription.unsubscribe();
  }

  async requestMagicLink(email: string) {
    const { error } = await this.sb.auth.signInWithOtp({
      email: email.trim(),
      options: {
        // D-03 : une adresse inconnue ne crée jamais de compte.
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/atelier`,
      },
    });
    // Adresse inconnue → Supabase renvoie une erreur ; on ne la révèle pas.
    // Seules les erreurs réseau ou de quota sont remontées.
    if (error && (error.status === 429 || /fetch|network/i.test(error.message))) {
      throw new Error(error.status === 429
        ? 'Trop de demandes rapprochées. Attends une minute avant de recommencer.'
        : 'Connexion au serveur impossible. Vérifie ta connexion et réessaie.');
    }
  }

  async signOut() {
    await this.sb.auth.signOut();
  }
}
