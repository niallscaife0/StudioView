import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { useLoad } from '../../app/useLoad';
import { AssetThumb } from '../../components/AssetThumb';

/** Consultation : toutes les variantes, sans rien modifier (parcours alternatif A). */
export function VariantsPage() {
  const { repo } = useApp();
  const navigate = useNavigate();
  const [picked, setPicked] = useState<string[]>([]);
  const { data, loading, error, reload } = useLoad(
    () => Promise.all([repo.listArtworks(), repo.listPresentations(), repo.listVariants(), repo.listAssets()]),
    [repo],
  );

  if (loading && !data) return <p className="page-state" role="status">Chargement…</p>;
  if (error)
    return (
      <section className="page">
        <p className="error-box" role="alert">{error}</p>
        <button type="button" className="button" onClick={reload}>Réessayer</button>
      </section>
    );
  const [artworks, presentations, variants, assets] = data!;

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));

  return (
    <section className="page">
      <div className="page-head">
        <h1>Variantes</h1>
        <button
          type="button"
          className="button button-primary"
          disabled={picked.length !== 2}
          onClick={() => navigate(`/comparaison?left=${picked[0]}&right=${picked[1]}`)}
        >
          Comparer la sélection
        </button>
      </div>
      <p className="muted">Coche deux variantes pour les comparer, même si elles appartiennent à des sculptures différentes.</p>
      {variants.length === 0 && <p className="empty">Aucune variante enregistrée. Crée une présentation depuis la fiche d’une sculpture.</p>}
      {artworks.map((a) => {
        const pres = presentations.filter((p) => p.artworkId === a.id);
        if (pres.length === 0) return null;
        return (
          <section key={a.id} className="block">
            <h2>{a.title}</h2>
            {pres.map((p) => (
              <div key={p.id} className="variant-group">
                <h3><Link to={`/studio/${p.id}`}>{p.title}</Link></h3>
                <ul className="variant-list">
                  {variants.filter((v) => v.presentationId === p.id).map((v) => {
                    const bg = assets.find((x) => x.id === v.backgroundAssetId);
                    return (
                      <li key={v.id} className={picked.includes(v.id) ? 'is-picked' : ''}>
                        <label className="check">
                          <input type="checkbox" checked={picked.includes(v.id)} onChange={() => toggle(v.id)} />
                          <span className="sr-only">Sélectionner {v.name} pour comparer</span>
                        </label>
                        <AssetThumb asset={bg} className="variant-thumb" />
                        <Link to={`/studio/${p.id}?variant=${v.id}`} className="variant-link">{v.name}</Link>
                        <span className="muted small">{bg?.title ?? 'sans décor'}, modifiée le {new Date(v.updatedAt).toLocaleDateString('fr-BE')}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
    </section>
  );
}
