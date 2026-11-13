import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppProvider } from '../src/app/AppContext';
import { routes } from '../src/app/router';
import { ToastProvider } from '../src/components/Toast';
import { LocalAuth } from '../src/data/auth';
import { LocalRepository } from '../src/data/local/localRepository';

function renderAt(path: string, repo = new LocalRepository(`ui-${Math.random()}`)) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProvider repo={repo} auth={new LocalAuth()}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AppProvider>,
  );
  return { router, repo };
}

describe('Atelier', () => {
  it('affiche l’état vide, puis crée une œuvre et ouvre sa fiche', async () => {
    const { router, repo } = renderAt('/atelier');
    expect(await screen.findByText(/Aucune sculpture pour l’instant/)).toBeInTheDocument();
    expect(screen.getByText(/Mode démo local/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Ajouter une œuvre' }));
    await userEvent.type(screen.getByLabelText('Nom provisoire'), 'Figure linéaire');
    await userEvent.click(screen.getByRole('button', { name: 'Créer' }));

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/oeuvres\//));
    expect(await screen.findByRole('button', { name: /Renommer l’œuvre : Figure linéaire/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer une présentation' })).toBeDisabled();
    expect(await repo.listArtworks()).toHaveLength(1);
  });

  it('affiche une page neutre pour une œuvre inexistante', async () => {
    renderAt('/oeuvres/inexistante');
    expect(await screen.findByText('Œuvre introuvable')).toBeInTheDocument();
  });

  it('n’invente pas de comparaison sans deux variantes enregistrées', async () => {
    renderAt('/comparaison');
    expect(await screen.findByText(/au moins deux variantes enregistrées/)).toBeInTheDocument();
  });

  it('crée une salle depuis la page Accrochages et propose d’y accrocher', async () => {
    const { repo } = renderAt('/accrochages');
    expect(await screen.findByText(/Aucune salle/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Nouvelle salle' }));
    await userEvent.type(screen.getByLabelText('Nom de la salle'), 'Galerie de quartier');
    await userEvent.click(screen.getByRole('button', { name: 'Créer la salle' }));
    expect(await screen.findByText(/8,00 m × 6,00 m/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nouvel accrochage' })).toBeInTheDocument();
    expect(await repo.listRooms()).toHaveLength(1);
  });

  it('n’affiche pas de bouton d’import 3D inerte', async () => {
    renderAt('/ressources');
    await userEvent.click(await screen.findByRole('tab', { name: 'Modèles 3D' }));
    expect(screen.getByText(/prévu en V2/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /3D|glb/i })).toBeNull();
  });
});
