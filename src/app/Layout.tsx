import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Banners } from '../components/Banners';
import { useApp } from './AppContext';

export function Layout() {
  const { auth, session } = useApp();
  const navigate = useNavigate();
  return (
    <div className="shell">
      <a className="skip-link" href="#contenu">Aller au contenu</a>
      <header className="topbar">
        <NavLink to="/atelier" className="brand">Laboratoire</NavLink>
        <nav aria-label="Navigation principale" className="topnav">
          <NavLink to="/atelier">Atelier</NavLink>
          <NavLink to="/variantes">Variantes</NavLink>
          <NavLink to="/ressources">Ressources</NavLink>
        </nav>
        {auth.requiresLogin && session && (
          <div className="account">
            <span className="account-email">{session.email}</span>
            <button
              type="button"
              className="link-button"
              onClick={async () => {
                await auth.signOut();
                navigate('/login', { replace: true });
              }}
            >
              Se déconnecter
            </button>
          </div>
        )}
      </header>
      <Banners />
      <main id="contenu" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
