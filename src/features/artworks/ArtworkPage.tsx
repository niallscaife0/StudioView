import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { useLoad } from '../../app/useLoad';
import { AssetThumb } from '../../components/AssetThumb';
import { Importer } from '../../components/Importer';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { useDeleteAsset } from '../../components/useDeleteAsset';
import { InlineRename } from '../../components/InlineRename';
import type { Asset } from '../../domain/types';
import { formatCm, parseHeightCm } from '../hanging/geometry';
import { CreatePresentationDialog } from './CreatePresentationDialog';

export function ArtworkPage() {
  const { id = '' } = useParams();
  const { repo } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useLoad(
    () => Promise.all([repo.getArtwork(id), repo.listAssets(), repo.listPresentations(), repo.listVariants()]),
    [repo, id],
  );
  const del = useDeleteAsset(reload);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (loading && !data) return <p className="page-state" role="status">Chargement…</p>;
  if (error)
    return (
      <section className="page">
        <p className="error-box" role="alert">{error}</p>
        <button type="button" className="button" onClick={reload}>Réessayer</button>
      </section>
    );
  const [artwork, assets, presentations, variants] = data!;
  if (!artwork)
    return (
      <section className="page">
        <h1>Œuvre introuvable</h1>
        <p><Link to="/atelier">Retour à l’atelier</Link></p>
      </section>
    );

  const photos = assets.filter((a) => a.artworkId === artwork.id && (a.kind === 'photo' || a.kind === 'cutout'));
  const backgrounds = assets.filter((a) => a.kind === 'background');
  const ownPres = presentations.filter((p) => p.artworkId === artwork.id);
  const nVariants = variants.filter((v) => ownPres.some((p) => p.id === v.presentationId)).length;

  async function updateKind(a: Asset, kind: 'photo' | 'cutout') {
    try {
      await repo.updateAsset(a.id, { kind });
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  }

  async function deleteArtwork() {
    try {
      await repo.deleteArtwork(artwork!.id);
      toast('success', `« ${artwork!.title} » supprimée.`);
      navigate('/atelier');
    } catch (e) {
      toast('error', `Suppression impossible : ${(e as Error).message}`);
    }
  }

  return (
    <section className="page">
      <p className="breadcrumb"><Link to="/atelier">Atelier</Link></p>
      <div className="page-head">
        <InlineRename
          as="h1"
          value={artwork.title}
          label="Renommer l’œuvre"
          onSave={async (t) => { await repo.renameArtwork(artwork.id, t); reload(); }}
        />
        <button type="button" className="link-button danger-text" onClick={() => setConfirmDelete(true)}>Supprimer l’œuvre</button>
      </div>

      <HeightField
        value={artwork.heightCm}
        onSave={async (h) => {
          try {
            await repo.setArtworkHeight(artwork.id, h);
            reload();
          } catch (e) {
            toast('error', (e as Error).message);
          }
        }}
      />

      <section className="block">
        <div className="block-head">
          <h2>Photographies</h2>
          <Importer target={{ artworkId: artwork.id, kind: 'artwork-photo' }} label="Importer des photos" onImported={reload} compact />
        </div>
        {photos.length === 0 ? (
          <Importer target={{ artworkId: artwork.id, kind: 'artwork-photo' }} label="Choisir des fichiers" onImported={reload} />
        ) : (
          <ul className="photo-grid">
            {photos.map((p) => (
              <li key={p.id} className="photo-card">
                <AssetThumb asset={p} className="photo-thumb" />
                <InlineRename value={p.title} label="Renommer la photo" onSave={async (t) => { await repo.updateAsset(p.id, { title: t }); reload(); }} />
                <label className="small-field">
                  <span className="sr-only">Type de photo</span>
                  <select value={p.kind} onChange={(e) => updateKind(p, e.target.value as 'photo' | 'cutout')}>
                    <option value="cutout">Détourée (fond transparent)</option>
                    <option value="photo">Photo brute</option>
                  </select>
                </label>
                {p.kind === 'cutout' && p.transparency === false && (
                  <p className="warn-text">Marquée détourée, mais aucun pixel transparent n’a été détecté.</p>
                )}
                <button type="button" className="link-button danger-text" onClick={() => del.request(p)}>Supprimer</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="block">
        <div className="block-head">
          <h2>Présentations</h2>
          <button type="button" className="button button-primary" disabled={photos.length === 0} onClick={() => setCreating(true)}>
            Créer une présentation
          </button>
        </div>
        {photos.length === 0 && <p className="muted">Importe d’abord une photographie de la sculpture.</p>}
        {ownPres.length === 0 && photos.length > 0 && <p className="muted">Aucune présentation. Crée-en une pour placer la sculpture dans un décor.</p>}
        <ul className="pres-list">
          {ownPres.map((p) => {
            const vs = variants.filter((v) => v.presentationId === p.id);
            return (
              <li key={p.id}>
                <Link to={`/studio/${p.id}`}>{p.title}</Link>
                <span className="muted"> {vs.map((v) => v.name).join(', ') || 'aucune variante'}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {creating && (
        <CreatePresentationDialog artwork={artwork} photos={photos} backgrounds={backgrounds} existingCount={ownPres.length} onClose={() => setCreating(false)} />
      )}
      {confirmDelete && (
        <Modal
          title="Supprimer cette œuvre ?"
          onClose={() => setConfirmDelete(false)}
          actions={
            <>
              <button type="button" className="button" onClick={() => setConfirmDelete(false)}>Annuler</button>
              <button type="button" className="button button-danger" onClick={deleteArtwork}>Supprimer l’œuvre</button>
            </>
          }
        >
          <p>
            « {artwork.title} » et ses {ownPres.length} présentation{ownPres.length > 1 ? 's' : ''} ({nVariants} variante{nVariants > 1 ? 's' : ''}) seront supprimées.
          </p>
          <p>Ses {photos.length} photo{photos.length > 1 ? 's' : ''} restent dans Ressources, sans œuvre associée.</p>
        </Modal>
      )}
      {del.element}
    </section>
  );
}

/** Hauteur réelle déclarée (F-36) : nécessaire pour placer l'œuvre à l'échelle dans une salle. */
function HeightField({ value, onSave }: { value: number | null; onSave: (h: number | null) => Promise<void> }) {
  const [text, setText] = useState(value ? String(value).replace('.', ',') : '');
  const [bad, setBad] = useState(false);
  return (
    <form
      className="height-field"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim() === '') { setBad(false); void onSave(null); return; }
        const h = parseHeightCm(text);
        setBad(!h);
        if (h) void onSave(h);
      }}
    >
      <label htmlFor="artwork-height">Hauteur réelle (cm)</label>
      <input id="artwork-height" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder="ex. 175" aria-invalid={bad} />
      <button type="submit" className="button button-small">Enregistrer</button>
      <span className="muted small">
        {bad ? 'Indique une hauteur entre 1 et 2000 cm.' : value ? `Dimension déclarée : ${formatCm(value)}. Elle fixe la taille de l’œuvre dans les salles.` : 'Nécessaire pour placer l’œuvre à l’échelle dans une salle.'}
      </span>
    </form>
  );
}
