import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { useLoad } from '../../app/useLoad';
import { AssetThumb } from '../../components/AssetThumb';
import { useToast } from '../../components/Toast';
import type { Artwork, Asset, Presentation, Variant } from '../../domain/types';
import { createDemoData } from '../demo/demoData';

export function coverFor(artwork: Artwork, assets: Asset[]): Asset | undefined {
  const own = assets.filter((a) => a.artworkId === artwork.id);
  return own.find((a) => a.kind === 'cutout') ?? own.find((a) => a.kind === 'photo');
}

export function AtelierPage() {
  const { repo } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useLoad(
    () => Promise.all([repo.listArtworks(), repo.listAssets(), repo.listPresentations(), repo.listVariants()]),
    [repo],
  );
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const a = await repo.createArtwork(title);
      toast('success', `« ${a.title} » ajoutée.`);
      navigate(`/oeuvres/${a.id}`);
    } catch (err) {
      toast('error', `Œuvre non créée : ${(err as Error).message}`);
      setBusy(false);
    }
  }

  async function demo() {
    setBusy(true);
    try {
      await createDemoData(repo);
      toast('success', 'Données fictives créées. Ce ne sont pas tes œuvres.');
      reload();
    } catch (err) {
      toast('error', `Données fictives non créées : ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <p className="page-state" role="status">Chargement de l’atelier…</p>;
  if (error)
    return (
      <section className="page">
        <p className="error-box" role="alert">L’atelier n’a pas pu être chargé : {error}</p>
        <button type="button" className="button" onClick={reload}>Réessayer</button>
      </section>
    );
  const [artworks, assets, presentations, variants] = data!;
  const recent = recentVariants(presentations, variants, artworks);

  return (
    <section className="page">
      <div className="page-head">
        <h1>Mes sculptures</h1>
        {!adding && (
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>Ajouter une œuvre</button>
        )}
      </div>

      {adding && (
        <form className="inline-form" onSubmit={create}>
          <label htmlFor="new-title">Nom provisoire</label>
          <input id="new-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sans titre" autoFocus disabled={busy} />
          <button type="submit" className="button button-primary" disabled={busy}>Créer</button>
          <button type="button" className="button" onClick={() => setAdding(false)} disabled={busy}>Annuler</button>
        </form>
      )}

      {artworks.length === 0 ? (
        <div className="empty">
          <p>Aucune sculpture pour l’instant. Ajoute la première avec un nom provisoire, puis importe ses photographies.</p>
          {repo.mode === 'local' && (
            <p>
              Pour essayer l’outil sans tes photos :{' '}
              <button type="button" className="link-button" onClick={demo} disabled={busy}>générer une sculpture et deux décors fictifs</button>.
            </p>
          )}
        </div>
      ) : (
        <ul className="artwork-grid">
          {artworks.map((a) => {
            const cover = coverFor(a, assets);
            const nPres = presentations.filter((p) => p.artworkId === a.id).length;
            const nPhotos = assets.filter((x) => x.artworkId === a.id).length;
            return (
              <li key={a.id}>
                <Link to={`/oeuvres/${a.id}`} className="artwork-card">
                  <AssetThumb asset={cover} className="artwork-cover" />
                  <span className="artwork-title">{a.title}</span>
                  <span className="artwork-meta">
                    {nPhotos} photo{nPhotos > 1 ? 's' : ''}, {nPres} présentation{nPres > 1 ? 's' : ''}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {recent.length > 0 && (
        <section className="resume">
          <h2>Reprendre</h2>
          <ul className="resume-list">
            {recent.map(({ v, p, a }) => (
              <li key={v.id}>
                <Link to={`/studio/${p.id}?variant=${v.id}`}>
                  <span>{v.name}</span> <span className="muted">{p.title}, {a?.title ?? 'œuvre supprimée'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function recentVariants(presentations: Presentation[], variants: Variant[], artworks: Artwork[]) {
  return [...variants]
    .sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))
    .slice(0, 4)
    .map((v) => {
      const p = presentations.find((q) => q.id === v.presentationId)!;
      return { v, p, a: p ? artworks.find((x) => x.id === p.artworkId) : undefined };
    })
    .filter((r) => r.p);
}
