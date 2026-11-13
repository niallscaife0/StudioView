import { createBrowserRouter, Navigate, Link } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { AtelierPage } from '../features/artworks/AtelierPage';
import { ArtworkPage } from '../features/artworks/ArtworkPage';
import { ResourcesPage } from '../features/assets/ResourcesPage';
import { StudioPage } from '../features/studio2d/StudioPage';
import { ComparePage } from '../features/variants/ComparePage';
import { VariantsPage } from '../features/variants/VariantsPage';
import { Layout } from './Layout';
import { RequireAuth } from './RequireAuth';

export const routes = [
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [
      { path: '/', element: <Navigate to="/atelier" replace /> },
      { path: '/atelier', element: <AtelierPage /> },
      { path: '/oeuvres/:id', element: <ArtworkPage /> },
      { path: '/ressources', element: <ResourcesPage /> },
      { path: '/studio/:presentationId', element: <StudioPage /> },
      { path: '/comparaison', element: <ComparePage /> },
      { path: '/variantes', element: <VariantsPage /> },
      // Chargées à la demande : la salle 3D (Three.js) ne pèse pas sur le démarrage de l'application.
      { path: '/accrochages', lazy: async () => ({ Component: (await import('../features/hanging/HangingsPage')).HangingsPage }) },
      { path: '/accrochages/:presentationId', lazy: async () => ({ Component: (await import('../features/hanging/HangingPage')).HangingPage }) },
      {
        path: '*',
        element: (
          <section className="page">
            <h1>Page introuvable</h1>
            <p><Link to="/atelier">Retour à l’atelier</Link></p>
          </section>
        ),
      },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
