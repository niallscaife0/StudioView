import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { AssetThumb } from '../../components/AssetThumb';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { newItem } from '../../domain/transform';
import type { Artwork, Asset } from '../../domain/types';

interface Props {
  artwork: Artwork;
  photos: Asset[];
  backgrounds: Asset[];
  existingCount: number;
  onClose: () => void;
}

export function CreatePresentationDialog({ artwork, photos, backgrounds, existingCount, onClose }: Props) {
  const { repo } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [title, setTitle] = useState(`Présentation ${existingCount + 1}`);
  const [fg, setFg] = useState<string | null>((photos.find((p) => p.kind === 'cutout') ?? photos[0])?.id ?? null);
  const [bg, setBg] = useState<string | null>(backgrounds[0]?.id ?? null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const p = await repo.createPresentation(artwork.id, title);
      const v = await repo.createVariant({
        presentationId: p.id,
        name: 'A',
        backgroundAssetId: bg,
        items: fg ? [newItem(fg, 0)] : [],
      });
      navigate(`/studio/${p.id}?variant=${v.id}`);
    } catch (e) {
      toast('error', `Présentation non créée : ${(e as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Nouvelle présentation"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="button" onClick={onClose} disabled={busy}>Annuler</button>
          <button type="button" className="button button-primary" onClick={create} disabled={busy || !fg}>Ouvrir dans le studio</button>
        </>
      }
    >
      <label htmlFor="pres-title">Nom</label>
      <input id="pres-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <fieldset className="pick">
        <legend>Première photographie (tu pourras en ajouter d’autres dans le studio)</legend>
        <div className="pick-grid">
          {photos.map((p) => (
            <label key={p.id} className={`pick-item${fg === p.id ? ' is-picked' : ''}`}>
              <input type="radio" name="fg" checked={fg === p.id} onChange={() => setFg(p.id)} />
              <AssetThumb asset={p} />
              <span>{p.title}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="pick">
        <legend>Décor</legend>
        <div className="pick-grid">
          <label className={`pick-item${bg === null ? ' is-picked' : ''}`}>
            <input type="radio" name="bg" checked={bg === null} onChange={() => setBg(null)} />
            <div className="thumb thumb-none" aria-hidden="true" />
            <span>Sans décor</span>
          </label>
          {backgrounds.map((b) => (
            <label key={b.id} className={`pick-item${bg === b.id ? ' is-picked' : ''}`}>
              <input type="radio" name="bg" checked={bg === b.id} onChange={() => setBg(b.id)} />
              <AssetThumb asset={b} />
              <span>{b.title}</span>
            </label>
          ))}
        </div>
        {backgrounds.length === 0 && <p className="muted">Aucun décor encore. Tu pourras en ajouter depuis le studio.</p>}
      </fieldset>
    </Modal>
  );
}
