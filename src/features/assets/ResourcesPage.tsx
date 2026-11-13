import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { useLoad } from '../../app/useLoad';
import { AssetThumb } from '../../components/AssetThumb';
import { Importer } from '../../components/Importer';
import { InlineRename } from '../../components/InlineRename';
import { useToast } from '../../components/Toast';
import { useDeleteAsset } from '../../components/useDeleteAsset';
import { variantsUsingAsset } from '../../data/repository';
import type { Asset } from '../../domain/types';
import { formatBytes } from './validation';

type Tab = 'images' | 'decors' | '3d';

const KIND_LABEL: Record<Asset['kind'], string> = {
  photo: 'Photo brute',
  cutout: 'Détourée',
  background: 'Décor',
  model3d: 'Modèle 3D',
};

export function ResourcesPage() {
  const { repo } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('images');
  const { data, loading, error, reload } = useLoad(
    () => Promise.all([repo.listAssets(), repo.listArtworks(), repo.listVariants()]),
    [repo],
  );
  const del = useDeleteAsset(reload);

  if (loading && !data) return <p className="page-state" role="status">Chargement des ressources…</p>;
  if (error)
    return (
      <section className="page">
        <p className="error-box" role="alert">{error}</p>
        <button type="button" className="button" onClick={reload}>Réessayer</button>
      </section>
    );
  const [assets, artworks, variants] = data!;
  const list = assets.filter((a) => (tab === 'decors' ? a.kind === 'background' : tab === 'images' ? a.kind === 'photo' || a.kind === 'cutout' : a.kind === 'model3d'));

  async function assign(a: Asset, artworkId: string) {
    try {
      await repo.updateAsset(a.id, { artworkId: artworkId || null });
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  }

  return (
    <section className="page">
      <h1>Ressources</h1>
      <div className="tabs" role="tablist" aria-label="Type de ressource">
        {([['images', 'Images'], ['decors', 'Décors'], ['3d', 'Modèles 3D']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === '3d' ? (
        <p className="empty">L’import de modèles .glb est prévu en V2. Il n’est pas disponible dans cette version.</p>
      ) : (
        <>
          <Importer
            key={tab}
            target={{ artworkId: null, kind: tab === 'decors' ? 'background' : 'artwork-photo' }}
            label={tab === 'decors' ? 'Importer des photos d’espaces' : 'Importer des images'}
            onImported={reload}
          />
          {list.length === 0 ? (
            <p className="empty">{tab === 'decors' ? 'Aucun décor. Importe la photo d’une salle, d’un mur ou d’un lieu.' : 'Aucune image de sculpture.'}</p>
          ) : (
            <div className="table-wrap">
              <table className="asset-table">
                <thead>
                  <tr>
                    <th scope="col"><span className="sr-only">Miniature</span></th>
                    <th scope="col">Nom</th>
                    <th scope="col">Type</th>
                    {tab === 'images' && <th scope="col">Œuvre</th>}
                    <th scope="col">Taille</th>
                    <th scope="col">Ajoutée le</th>
                    <th scope="col">Utilisée dans</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((a) => {
                    const used = variantsUsingAsset(variants, a.id).length;
                    return (
                      <tr key={a.id}>
                        <td><AssetThumb asset={a} className="table-thumb" /></td>
                        <td><InlineRename value={a.title} label="Renommer" onSave={async (t) => { await repo.updateAsset(a.id, { title: t }); reload(); }} /></td>
                        <td>{KIND_LABEL[a.kind]}{a.kind !== 'background' && a.transparency === false && a.kind === 'cutout' ? ' (?)' : ''}</td>
                        {tab === 'images' && (
                          <td>
                            <label className="small-field">
                              <span className="sr-only">Œuvre associée à {a.title}</span>
                              <select value={a.artworkId ?? ''} onChange={(e) => assign(a, e.target.value)}>
                                <option value="">Aucune</option>
                                {artworks.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
                              </select>
                            </label>
                          </td>
                        )}
                        <td className="nowrap">{a.width} × {a.height}, {formatBytes(a.bytes)}</td>
                        <td className="nowrap">{new Date(a.createdAt).toLocaleDateString('fr-BE')}</td>
                        <td>{used === 0 ? <span className="muted">aucune variante</span> : `${used} variante${used > 1 ? 's' : ''}`}</td>
                        <td><button type="button" className="link-button danger-text" onClick={() => del.request(a)}>Supprimer</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {tab === 'images' && list.some((a) => !a.artworkId) && (
            <p className="muted">Les images sans œuvre n’apparaissent pas dans le studio. Associe-les à une sculpture, ou <Link to="/atelier">crée l’œuvre</Link> d’abord.</p>
          )}
        </>
      )}
      {del.element}
    </section>
  );
}
