import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import type { Asset, Transform2D } from '../../domain/types';
import { loadBitmap } from '../assets/imageCache';
import { frameAspect, outputSize, renderComposition } from '../studio2d/compose';

const WIDTHS = [1600, 2400, 3200];

interface Props {
  background: Asset | null;
  foreground: Asset | null;
  transform: Transform2D;
  fileBase: string;
  onClose: () => void;
}

export function safeFilename(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80) || 'composition';
}

/** Export PNG du composite tel qu'il est affiché (W6). Les notes ne sont jamais incluses. */
export function ExportDialog({ background, foreground, transform, fileBase, onClose }: Props) {
  const { repo } = useApp();
  const toast = useToast();
  const [width, setWidth] = useState(1600);
  const [label, setLabel] = useState(true);
  const [busy, setBusy] = useState(false);
  const aspect = frameAspect(background ? { w: background.width, h: background.height } : null);

  async function run() {
    setBusy(true);
    try {
      const [bg, fg] = await Promise.all([
        background ? loadBitmap(repo, background) : Promise.resolve(null),
        foreground ? loadBitmap(repo, foreground) : Promise.resolve(null),
      ]);
      const blob = await renderComposition(
        { background: bg, foreground: fg, foregroundSize: foreground ? { w: foreground.width, h: foreground.height } : null, transform },
        background ? { w: background.width, h: background.height } : null,
        width,
        label,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeFilename(fileBase)}-${width}px.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('success', 'PNG exporté.');
      onClose();
    } catch (e) {
      toast('error', `Export impossible : ${(e as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Exporter en PNG"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="button" onClick={onClose} disabled={busy}>Annuler</button>
          <button type="button" className="button button-primary" onClick={run} disabled={busy || !foreground}>
            {busy ? 'Rendu…' : 'Télécharger le PNG'}
          </button>
        </>
      }
    >
      <fieldset className="radio-row">
        <legend>Largeur</legend>
        {WIDTHS.map((w) => {
          const s = outputSize(w, aspect);
          return (
            <label key={w}>
              <input type="radio" name="w" checked={width === w} onChange={() => setWidth(w)} /> {s.w} × {s.h} px
            </label>
          );
        })}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={label} onChange={(e) => setLabel(e.target.checked)} /> Inscrire « Simulation 2D » dans l’angle
      </label>
      <p className="muted">L’image reprend exactement l’état affiché dans le studio, y compris les modifications non enregistrées. La note personnelle n’est pas incluse.</p>
    </Modal>
  );
}
