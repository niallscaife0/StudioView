import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { useLoad } from '../../app/useLoad';
import type { Artwork, Asset, Presentation, Variant } from '../../domain/types';
import { ExportDialog } from '../exports/ExportDialog';
import { StaticComposition } from './StaticComposition';

export function ComparePage() {
  const { repo } = useApp();
  const [params, setParams] = useSearchParams();
  const { data, loading, error, reload } = useLoad(
    () => Promise.all([repo.listVariants(), repo.listPresentations(), repo.listArtworks(), repo.listAssets()]),
    [repo],
  );
  const [exporting, setExporting] = useState<Variant | null>(null);

  if (loading && !data) return <p className="page-state" role="status">Chargement des variantes…</p>;
  if (error)
    return (
      <section className="page">
        <p className="error-box" role="alert">{error}</p>
        <button type="button" className="button" onClick={reload}>Réessayer</button>
      </section>
    );
  const [allVariants, allPresentations, artworks, assets] = data!;
  // La comparaison d'accrochages (points de vue) relève de la phase 4 : ici, variantes 2D seulement.
  const presentations = allPresentations.filter((p) => p.mode === '2d');
  const variants = allVariants.filter((v) => presentations.some((p) => p.id === v.presentationId));
  if (variants.length < 2)
    return (
      <section className="page">
        <h1>Comparer</h1>
        <p className="empty">Il faut au moins deux variantes enregistrées. Dans le studio, utilise « Dupliquer comme variante ».</p>
      </section>
    );

  const left = variants.find((v) => v.id === params.get('left')) ?? variants[0];
  const right = variants.find((v) => v.id === params.get('right')) ?? variants.find((v) => v.id !== left.id)!;
  const set = (side: 'left' | 'right', id: string) => {
    const next = new URLSearchParams(params);
    next.set('left', side === 'left' ? id : left.id);
    next.set('right', side === 'right' ? id : right.id);
    setParams(next, { replace: true });
  };

  const presOf = (v: Variant) => presentations.find((p) => p.id === v.presentationId);
  const artOf = (p?: Presentation) => artworks.find((a) => a.id === p?.artworkId);

  return (
    <section className="page page-wide">
      <h1>Comparer</h1>
      <div className="compare">
        {(['left', 'right'] as const).map((side) => {
          const v = side === 'left' ? left : right;
          const p = presOf(v);
          return (
            <article key={side} className="compare-side" aria-label={side === 'left' ? 'Variante de gauche' : 'Variante de droite'}>
              <label className="compare-select">
                <span className="sr-only">{side === 'left' ? 'Variante de gauche' : 'Variante de droite'}</span>
                <VariantSelect value={v.id} variants={variants} presentations={presentations} artworks={artworks} onChange={(id) => set(side, id)} />
              </label>
              <div className="compare-stage">
                <StaticComposition variant={v} assets={assets} />
              </div>
              <Facts variant={v} assets={assets} />
              <div className="button-row">
                {p && <Link className="button" to={`/studio/${p.id}?variant=${v.id}`}>Ouvrir dans le studio</Link>}
                <button type="button" className="button" onClick={() => setExporting(v)}>Exporter</button>
              </div>
            </article>
          );
        })}
      </div>
      <p className="muted small">Les deux vues reprennent l’état enregistré de chaque variante. Les modifications en cours dans le studio n’apparaissent qu’après enregistrement.</p>
      {exporting && (() => {
        const p = presOf(exporting);
        return (
          <ExportDialog
            background={assets.find((a) => a.id === exporting.backgroundAssetId) ?? null}
            items={exporting.items}
            assets={assets}
            fileBase={`${artOf(p)?.title ?? ''}-${p?.title ?? ''}-${exporting.name}`}
            onClose={() => setExporting(null)}
          />
        );
      })()}
    </section>
  );
}

function Facts({ variant, assets }: { variant: Variant; assets: Asset[] }) {
  const bg = assets.find((a) => a.id === variant.backgroundAssetId);
  return (
    <dl className="facts">
      <div><dt>Variante</dt><dd>{variant.name}</dd></div>
      <div><dt>Décor</dt><dd>{bg?.title ?? 'sans décor'}</dd></div>
      <div><dt>Éléments</dt><dd>{variant.items.filter((i) => !i.hidden).length}</dd></div>
    </dl>
  );
}

function VariantSelect({ value, variants, presentations, artworks, onChange }: {
  value: string; variants: Variant[]; presentations: Presentation[]; artworks: Artwork[]; onChange: (id: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {presentations.map((p) => {
        const vs = variants.filter((v) => v.presentationId === p.id);
        if (vs.length === 0) return null;
        const a = artworks.find((x) => x.id === p.artworkId);
        return (
          <optgroup key={p.id} label={`${a?.title ?? '?'}, ${p.title}`}>
            {vs.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </optgroup>
        );
      })}
    </select>
  );
}
