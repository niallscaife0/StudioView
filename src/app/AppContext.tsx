import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthService, SessionInfo } from '../data/auth';
import type { Repository } from '../data/repository';

interface AppServices {
  repo: Repository;
  auth: AuthService;
  session: SessionInfo | null;
  sessionLoading: boolean;
}

const Ctx = createContext<AppServices | null>(null);

export function AppProvider({ repo, auth, children }: { repo: Repository; auth: AuthService; children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionLoading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    auth.getSession().then((s) => {
      if (alive) {
        setSession(s);
        setLoading(false);
      }
    });
    const off = auth.onChange((s) => setSession(s));
    return () => {
      alive = false;
      off();
    };
  }, [auth]);

  const value = useMemo(() => ({ repo, auth, session, sessionLoading }), [repo, auth, session, sessionLoading]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppServices {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp hors AppProvider');
  return v;
}
