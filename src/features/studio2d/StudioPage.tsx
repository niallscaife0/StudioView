import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { useLoad } from '../../app/useLoad';
import { AssetThumb } from '../../components/AssetThumb';
import { Importer } from '../../components/Importer';
import { InlineRename } from '../../components/InlineRename';
import { Modal } from '../../components/Modal';
import { SaveIndicator, type SaveState } from '../../components/SaveIndicator';
import { useToast } from '../../components/Toast';
import { DEFAULT_TRANSFORM, SCALE_MAX, SCALE_MIN, clampTransform, sameDraft } from '../../domain/transform';
import type { Asset, Variant, VariantDraft } from '../../domain/types';
import { ExportDialog } from '../exports/ExportDialog';
import { StudioCanvas } from './StudioCanvas';
import { useDraftHistory } from './useHistory';

export function nextVariantName(existing: string[]): string {
  for (let i = 0; i < 26; i++) {
    const n = String.fromCharCode(65 + i);
    if (!existing.includes(n)) return n;
  }
  return `Variante ${existing.length + 1}`;
}

const toDraft = (v: Variant): VariantDraft => ({
  backgroundAssetId: v.backgroundAssetId,
  foregroundAssetId: v.foregroundAssetId,
  transform: v.transform,
});

export function StudioPage() {
  const { presentationId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { repo } = useApp();
  const { data, loading, error, reload } = useLoad(async () => {
    const presentation = await repo.getPresentation(presentationId);
    if (!presentation) return null;
    const [artwork, assets, variants] = await Promise.all([
      repo.getArtwork(presentation.artworkId),
      repo.listAssets(),
      repo.listVariants(),
    ]);
    return { presentation, artwork, assets, variants: variants.filter((v) => v.presentationId === presentationId) };
  }, [repo, presentationId]);

  if (loading && !data) return <p className="page-state" role="status">Ouverture du studio…</p>;
  if (error)
    return (
      <section className="page">
        <p className="error-box" role="alert">Le studio n’a pas pu s’ouvrir : {error}</p>
        <button type="button" className="button" onClick={reload}>Réessayer</button>
      </section>
    );
  if (!data)
    return (
      <section className="page">
        <h1>Présentation introuvable</h1>
        <p><Link to="/atelier">Retour à l’atelier</Link></p>
      </section>
    );

  const requested = params.get('variant');
  // Variante juste créée : attendre le rechargement plutôt que d'afficher une autre variante.
  if (requested && loading && !data.variants.some((v) => v.id === requested)) {
    return <p className="page-state" role="status">Ouverture de la variante…</p>;
  }
  const active = data.variants.find((v) => v.id === requested) ?? data.variants[0] ?? null;

  if (!active)
    return <EmptyPresentation presentationId={presentationId} assets={data.assets} artworkId={data.presentation.artworkId} onCreated={(id) => { setParams({ variant: id }); reload(); }} />;

  return (
    <StudioEditor
      key={active.id}
      variant={active}
      variants={data.variants}
      assets={data.assets}
      presentationTitle={data.presentation.title}
      artworkTitle={data.artwork?.title ?? ''}
      artworkId={data.presentation.artworkId}
      presentationId={presentationId}
      reload={reload}
    />
  );
}

function EmptyPresentation({ presentationId, assets, artworkId, onCreated }: { presentationId: string; assets: Asset[]; artworkId: string; onCreated: (id: string) => void }) {
  const { repo } = useApp();
  const toast = useToast();
  const photo = assets.find((a) => a.artworkId === artworkId && a.kind === 'cutout') ?? assets.find((a) => a.artworkId === artworkId && a.kind === 'photo');
  return (
    <section className="page">
      <p className="breadcrumb"><Link to={`/oeuvres/${artworkId}`}>Retour à l’œuvre</Link></p>
      <p className="empty">Cette présentation n’a plus de variante.</p>
      <button
        type="button"
        className="button button-primary"
        onClick={async () => {
          try {
            const v = await repo.createVariant({ presentationId, name: 'A', foregroundAssetId: photo?.id ?? null, backgroundAssetId: null, transform: DEFAULT_TRANSFORM });
            onCreated(v.id);
          } catch (e) {
            toast('error', (e as Error).message);
          }
        }}
      >
        Créer la variante A
      </button>
    </section>
  );
}

interface EditorProps {
  variant: Variant;
  variants: Variant[];
  assets: Asset[];
  presentationTitle: string;
  artworkTitle: string;
  artworkId: string;
  presentationId: string;
  reload: () => void;
}

type PendingSwitch = { kind: 'variant'; id: string } | { kind: 'route' };

function StudioEditor(props: EditorProps) {
  const { variant, variants, assets, artworkId, presentationId, reload } = props;
  const { repo } = useApp();
  const toast = useToast();
  const [, setParams] = useSearchParams();

  const history = useDraftHistory(toDraft(variant));
  const { draft, update, undo, commit, canUndo } = history;
  const [saved, setSaved] = useState<VariantDraft>(toDraft(variant));
  const [note, setNote] = useState(variant.note ?? '');
  const [savedNote, setSavedNote] = useState(variant.note ?? '');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [exporting, setExporting] = useState(false);
  const [pending, setPending] = useState<PendingSwitch | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [extraAssets, setExtraAssets] = useState<Asset[]>([]);

  const allAssets = useMemo(() => [...assets, ...extraAssets.filter((e) => !assets.some((a) => a.id === e.id))], [assets, extraAssets]);
  const photos = allAssets.filter((a) => a.artworkId === artworkId && (a.kind === 'cutout' || a.kind === 'photo'));
  const backgrounds = allAssets.filter((a) => a.kind === 'background');
  const bg = allAssets.find((a) => a.id === draft.backgroundAssetId) ?? null;
  const fg = allAssets.find((a) => a.id === draft.foregroundAssetId) ?? null;

  const dirty = !sameDraft(draft, saved) || note !== savedNote;
  const effectiveState: SaveState = saveState === 'saving' || saveState === 'error' ? saveState : dirty ? 'dirty' : 'saved';

  const save = useCallback(async (): Promise<boolean> => {
    setSaveState('saving');
    try {
      const v = await repo.updateVariant(variant.id, { ...draft, note: note.trim() ? note : null });
      setSaved(toDraft(v));
      setSavedNote(v.note ?? '');
      setSaveState('saved');
      return true;
    } catch (e) {
      // L'état d'édition reste intact (F-12, D-04).
      setSaveState('error');
      toast('error', `Non enregistré : ${(e as Error).message}`);
      return false;
    }
  }, [repo, variant.id, draft, note, toast]);

  // Avertissement à la fermeture de l'onglet.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // Navigation interne avec modifications non enregistrées.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  const blockerState = blocker.state;
  useEffect(() => {
    if (blockerState === 'blocked') setPending({ kind: 'route' });
  }, [blockerState]);

  // Raccourcis : Ctrl/Cmd+S enregistrer, Ctrl/Cmd+Z annuler.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 's') {
        e.preventDefault();
        void saveRef.current();
      } else if (e.key === 'z' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [undo]);

  function goToVariant(id: string) {
    if (id === variant.id) return;
    if (dirty) setPending({ kind: 'variant', id });
    else setParams({ variant: id });
  }

  async function resolvePending(action: 'save' | 'discard' | 'cancel') {
    const p = pending;
    setPending(null);
    if (!p) return;
    if (action === 'cancel') {
      if (p.kind === 'route' && blocker.state === 'blocked') blocker.reset();
      return;
    }
    if (action === 'save' && !(await save())) {
      if (p.kind === 'route' && blocker.state === 'blocked') blocker.reset();
      return;
    }
    if (p.kind === 'route') {
      if (blocker.state === 'blocked') blocker.proceed();
    } else {
      setParams({ variant: p.id });
      reload();
    }
  }

  async function duplicate() {
    try {
      const v = await repo.createVariant({
        presentationId,
        name: nextVariantName(variants.map((x) => x.name)),
        ...draft,
      });
      toast(
        'success',
        dirty
          ? `Variante « ${v.name} » créée à partir de l’état affiché. « ${variant.name} » garde sa dernière version enregistrée.`
          : `Variante « ${v.name} » créée.`,
      );
      setSaved(draft); // évite la demande de confirmation pour l'état copié
      setNote(savedNote);
      setParams({ variant: v.id });
      reload();
    } catch (e) {
      toast('error', `Variante non créée : ${(e as Error).message}`);
    }
  }

  async function deleteVariant() {
    setConfirmDelete(false);
    try {
      await repo.deleteVariant(variant.id);
      toast('success', `Variante « ${variant.name} » supprimée.`);
      setSaved(draft);
      setNote(savedNote);
      const other = variants.find((v) => v.id !== variant.id);
      setParams(other ? { variant: other.id } : {});
      reload();
    } catch (e) {
      toast('error', `Suppression impossible : ${(e as Error).message}`);
    }
  }

  const setT = (patch: Partial<VariantDraft['transform']>) =>
    update((d) => ({ ...d, transform: clampTransform({ ...d.transform, ...patch }) }));

  const otherVariant = variants.find((v) => v.id !== variant.id);

  return (
    <div className="studio">
      <div className="studio-bar">
        <p className="breadcrumb">
          <Link to="/atelier">Atelier</Link> / <Link to={`/oeuvres/${artworkId}`}>{props.artworkTitle}</Link> /{' '}
          <InlineRename value={props.presentationTitle} label="Renommer la présentation" onSave={async (t) => { await repo.renamePresentation(presentationId, t); reload(); }} />
        </p>
        <div className="studio-actions">
          <SaveIndicator state={effectiveState} onRetry={() => void save()} />
          <button type="button" className="button button-primary" onClick={() => void save()} disabled={!dirty || saveState === 'saving'}>Enregistrer</button>
          <button type="button" className="button" onClick={duplicate}>Dupliquer comme variante</button>
        </div>
      </div>

      <div className="studio-body">
        <aside className="studio-panel studio-left" aria-label="Ressources de la présentation">
          <h2>Sculpture</h2>
          {photos.length === 0 && <p className="muted">Aucune photo pour cette œuvre.</p>}
          <div className="pick-grid pick-grid-tight" role="radiogroup" aria-label="Photographie de la sculpture">
            {photos.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={draft.foregroundAssetId === p.id} className={`pick-item${draft.foregroundAssetId === p.id ? ' is-picked' : ''}`} onClick={() => update((d) => ({ ...d, foregroundAssetId: p.id }), false)}>
                <AssetThumb asset={p} />
                <span>{p.title}</span>
              </button>
            ))}
          </div>
          {fg && fg.transparency === false && (
            <p className="warn-text" role="note">Fond non transparent : la photo s’affiche comme un rectangle posé sur le décor. L’insertion ne peut pas être réaliste.</p>
          )}

          <h2>Décor</h2>
          <div className="pick-grid pick-grid-tight" role="radiogroup" aria-label="Décor">
            <button type="button" role="radio" aria-checked={draft.backgroundAssetId === null} className={`pick-item${draft.backgroundAssetId === null ? ' is-picked' : ''}`} onClick={() => update((d) => ({ ...d, backgroundAssetId: null }), false)}>
              <div className="thumb thumb-none" aria-hidden="true" />
              <span>Sans décor</span>
            </button>
            {backgrounds.map((b) => (
              <button key={b.id} type="button" role="radio" aria-checked={draft.backgroundAssetId === b.id} className={`pick-item${draft.backgroundAssetId === b.id ? ' is-picked' : ''}`} onClick={() => update((d) => ({ ...d, backgroundAssetId: b.id }), false)}>
                <AssetThumb asset={b} />
                <span>{b.title}</span>
              </button>
            ))}
          </div>
          <Importer
            compact
            multiple={false}
            target={{ artworkId: null, kind: 'background' }}
            label="Ajouter un décor"
            onImported={(added) => {
              setExtraAssets((x) => [...x, ...added]);
              update((d) => ({ ...d, backgroundAssetId: added[0].id }), false);
            }}
          />
        </aside>

        <section className="studio-center" aria-label="Aperçu">
          <StudioCanvas
            background={bg}
            foreground={fg}
            transform={draft.transform}
            onChange={(t) => update((d) => ({ ...d, transform: t }))}
            onCommit={commit}
            label={`Composition de la variante ${variant.name}`}
          />
        </section>

        <aside className="studio-panel studio-right" aria-label="Paramètres">
          <h2>Placement</h2>
          <Slider label="Horizontal" value={draft.transform.x} min={-0.25} max={1.25} step={0.001} format={(v) => `${Math.round(v * 100)} %`} onChange={(x) => setT({ x })} onCommit={commit} />
          <Slider label="Vertical" value={draft.transform.y} min={-0.25} max={1.25} step={0.001} format={(v) => `${Math.round(v * 100)} %`} onChange={(y) => setT({ y })} onCommit={commit} />
          <Slider label="Hauteur dans le cadre" value={draft.transform.scale} min={SCALE_MIN} max={SCALE_MAX} step={0.005} format={(v) => `${Math.round(v * 100)} %`} onChange={(scale) => setT({ scale })} onCommit={commit} />
          <Slider label="Rotation" value={draft.transform.rotationDeg} min={-180} max={180} step={0.5} format={(v) => `${v.toFixed(1).replace('.', ',')}°`} onChange={(rotationDeg) => setT({ rotationDeg })} onCommit={commit} />
          <p className="muted small">Valeurs relatives au cadre, approximatives : elles ne disent rien de la taille réelle de la sculpture.</p>
          <div className="button-row">
            <button type="button" className="button" onClick={undo} disabled={!canUndo}>Annuler</button>
            <button type="button" className="button" onClick={() => update((d) => ({ ...d, transform: DEFAULT_TRANSFORM }), false)}>Réinitialiser la vue</button>
          </div>
          <details className="note">
            <summary>Note personnelle (facultative)</summary>
            <label htmlFor="note" className="sr-only">Note personnelle</label>
            <textarea id="note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} />
            <p className="muted small">Jamais incluse dans les exports.</p>
          </details>
        </aside>
      </div>

      <div className="variant-bar">
        <div className="variant-tabs" role="tablist" aria-label="Variantes de la présentation">
          {variants.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={v.id === variant.id} className={`variant-tab${v.id === variant.id ? ' is-active' : ''}`} onClick={() => goToVariant(v.id)}>
              {v.name}
            </button>
          ))}
        </div>
        <div className="variant-current">
          <span className="variant-current-label">Nom de la variante :</span>
          <InlineRename value={variant.name} label="Renommer la variante" onSave={async (t) => { await repo.updateVariant(variant.id, { name: t }); reload(); }} />
          <button type="button" className="link-button danger-text" onClick={() => setConfirmDelete(true)}>Supprimer</button>
        </div>
        <div className="variant-actions">
          {otherVariant ? (
            <Link className="button" to={`/comparaison?left=${variant.id}&right=${otherVariant.id}`}>Comparer</Link>
          ) : (
            <span className="muted small">Duplique pour pouvoir comparer.</span>
          )}
          <button type="button" className="button" onClick={() => setExporting(true)} disabled={!fg}>Exporter</button>
        </div>
      </div>

      {exporting && (
        <ExportDialog background={bg} foreground={fg} transform={draft.transform} fileBase={`${props.artworkTitle}-${props.presentationTitle}-${variant.name}`} onClose={() => setExporting(false)} />
      )}
      {pending && (
        <Modal
          title="Modifications non enregistrées"
          onClose={() => void resolvePending('cancel')}
          actions={
            <>
              <button type="button" className="button" onClick={() => void resolvePending('cancel')}>Rester ici</button>
              <button type="button" className="button button-danger" onClick={() => void resolvePending('discard')}>Abandonner les modifications</button>
              <button type="button" className="button button-primary" onClick={() => void resolvePending('save')}>Enregistrer puis continuer</button>
            </>
          }
        >
          <p>La variante « {variant.name} » a été modifiée depuis le dernier enregistrement.</p>
        </Modal>
      )}
      {confirmDelete && (
        <Modal
          title={`Supprimer la variante « ${variant.name} » ?`}
          onClose={() => setConfirmDelete(false)}
          actions={
            <>
              <button type="button" className="button" onClick={() => setConfirmDelete(false)}>Annuler</button>
              <button type="button" className="button button-danger" onClick={deleteVariant}>Supprimer la variante</button>
            </>
          }
        >
          <p>Les autres variantes de la présentation ne sont pas touchées.</p>
        </Modal>
      )}
    </div>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  onCommit: () => void;
}

function Slider({ label, value, min, max, step, format, onChange, onCommit }: SliderProps) {
  const id = `sl-${label.replace(/\W+/g, '-')}`;
  return (
    <div className="slider">
      <label htmlFor={id}>
        {label} <output htmlFor={id}>{format(value)}</output>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={format(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
    </div>
  );
}
