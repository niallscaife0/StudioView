import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useApp } from './AppContext';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { auth, session, sessionLoading } = useApp();
  const location = useLocation();
  if (!auth.requiresLogin) return <>{children}</>;
  if (sessionLoading) return <p className="page-state" role="status">Vérification de la session…</p>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
