import { useState } from 'react';
import { useApp } from '../app/AppContext';
import { AssetInUseError } from '../data/repository';
import type { Asset, Variant } from '../domain/types';
import { forgetAsset } from '../features/assets/imageCache';
import { Modal } from './Modal';
import { useToast } from './Toast';

/** Suppression contrôlée d'une image : confirmation, et choix explicite si elle est utilisée. */
export function useDeleteAsset(onDeleted: () => void) {
  const { repo } = useApp();
  const toast = useToast();
  const [pending, setPending] = useState<{ asset: Asset; using: Variant[] | null } | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm(withDeps: boolean) {
    if (!pending) return;
    setBusy(true);
    try {
      await repo.deleteAsset(pending.asset.id, { withDependentVariants: withDeps });
      forgetAsset(pending.asset.id);
      toast('success', `« ${pending.asset.title} » supprimée.`);
      setPending(null);
      onDeleted();
    } catch (e) {
      if (e instanceof AssetInUseError) setPending({ asset: pending.asset, using: e.variants });
      else toast('error', `Suppression impossible : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const element = pending && (
    <Modal
      title={pending.using ? 'Image utilisée' : 'Supprimer cette image ?'}
      onClose={() => setPending(null)}
      actions={
        <>
          <button type="button" className="button" onClick={() => setPending(null)} disabled={busy}>Annuler</button>
          <button type="button" className="button button-danger" onClick={() => confirm(!!pending.using)} disabled={busy}>
            {pending.using ? `Supprimer l’image et ${pending.using.length} variante${pending.using.length > 1 ? 's' : ''}` : 'Supprimer'}
          </button>
        </>
      }
    >
      {pending.using ? (
        <>
          <p>« {pending.asset.title} » est utilisée dans :</p>
          <ul>{pending.using.map((v) => <li key={v.id}>{v.name}</li>)}</ul>
          <p>Ces variantes ne peuvent pas exister sans elle. Annule pour les garder.</p>
        </>
      ) : (
        <p>« {pending.asset.title} » sera retirée du laboratoire. Cette action est définitive.</p>
      )}
    </Modal>
  );

  return { request: (asset: Asset) => setPending({ asset, using: null }), element };
}
