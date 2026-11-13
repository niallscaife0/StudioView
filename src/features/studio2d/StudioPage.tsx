import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useBlocker, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { useLoad } from '../../app/useLoad';
import { AssetThumb } from '../../components/AssetThumb';
import { Importer } from '../../components/Importer';
import { InlineRename } from '../../components/InlineRename';
import { Modal } from '../../components/Modal';
import { SaveIndicator, type SaveState } from '../../components/SaveIndicator';
import { useToast } from '../../components/Toast';
import { DEFAULT_TRANSFORM, MAX_ITEMS, SCALE_MAX, SCALE_MIN, clampTransform, newItem, sameDraft } from '../../domain/transform';
import type { Artwork, Asset, Transform2D, Variant, VariantDraft, VariantItem } from '../../domain/types';
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

const toDraft = (v: Variant): VariantDraft => ({ backgroundAssetId: v.backgroundAssetId, items: v.items });

export function StudioPage() {
  const { presentationId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { repo } = useApp();
  const { data, loading, error, reload } = useLoad(async () => {
    const presentation = await repo.getPresentation(presentationId);
    if (!presentation) return null;
    const [artworks, assets, variants] = await Promise.all([repo.listArtworks(), repo.listAssets(), repo.listVariants()]);
    return {
      presentation,
      artworks,
      artwork: artworks.find((a) => a.id === presentation.artworkId) ?? null,
      assets,
      variants: variants.filter((v) => v.presentationId === presentationId),
    };
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

  // Un accrochage s'ouvre dans son propre écran.
  if (data.presentation.mode === 'room' || !data.presentation.artworkId) return <Navigate to={`/accrochages/${presentationId}`} replace />;
  const artworkId = data.presentation.artworkId;

  const requested = params.get('variant');
  // Variante juste créée : attendre le rechargement plutôt que d'afficher une autre variante.
  if (requested && loading && !data.variants.some((v) => v.id === requested)) {
    return <p className="page-state" role="status">Ouverture de la variante…</p>;
  }
  const active = data.variants.find((v) => v.id === requested) ?? data.variants[0] ?? null;

  if (!active)
    return <EmptyPresentation presentationId={presentationId} assets={data.assets} artworkId={artworkId} onCreated={(id) => { setParams({ variant: id }); reload(); }} />;

  return (
    <StudioEditor
      key={active.id}
      variant={active}
      variants={data.variants}
      assets={data.assets}
      artworks={data.artworks}
      presentationTitle={data.presentation.title}
      artworkTitle={data.artwork?.title ?? ''}
      artworkId={artworkId}
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
            const v = await repo.createVariant({ presentationId, name: 'A', backgroundAssetId: null, items: photo ? [newItem(photo.id, 0)] : [] });
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
  artworks: Artwork[];
  presentationTitle: string;
  artworkTitle: string;
  artworkId: string;
  presentationId: string;
  reload: () => void;
}

type PendingSwitch = { kind: 'variant'; id: string } | { kind: 'route' };

function StudioEditor(props: EditorProps) {
  const { variant, variants, assets, artworks, artworkId, presentationId, reload } = props;
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
  const [selectedId, setSelectedId] = useState<string | null>(variant.items[variant.items.length - 1]?.id ?? null);
  const [sourceArtwork, setSourceArtwork] = useState(artworkId);

  const allAssets = useMemo(() => [...assets, ...extraAssets.filter((e) => !assets.some((a) => a.id === e.id))], [assets, extraAssets]);
  const assetById = useMemo(() => new Map(allAssets.map((a) => [a.id, a])), [allAssets]);
  const photos = allAssets.filter((a) => a.artworkId === sourceArtwork && (a.kind === 'cutout' || a.kind === 'photo'));
  const backgrounds = allAssets.filter((a) => a.kind === 'background');
  const bg = draft.backgroundAssetId ? assetById.get(draft.backgroundAssetId) ?? null : null;
  const selected = draft.items.find((i) => i.id === selectedId) ?? null;
  const selectedAsset = selected ? assetById.get(selected.assetId) ?? null : null;
  const itemLabel = (it: VariantItem) => it.name ?? assetById.get(it.assetId)?.title ?? 'Image supprimée';

  const dirty = !sameDraft(draft, saved) || note !== savedNote;
  const effectiveState: SaveState = saveState === 'saving' || saveState === 'error' ? saveState : dirty ? 'dirty' : 'saved';

  const save = useCallback(async (): Promise<boolean> => {
    setSaveState('saving');
    try {
      const v = await repo.updateVariant(variant.id, { backgroundAssetId: draft.backgroundAssetId, items: draft.items, note: note.trim() ? note : null });
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

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  const blockerState = blocker.state;
  useEffect(() => {
    if (blockerState === 'blocked') setPending({ kind: 'route' });
  }, [blockerState]);

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

  // ---- Éléments -----------------------------------------------------------
  const setItems = (fn: (items: VariantItem[]) => VariantItem[], coalesce = false) =>
    update((d) => ({ ...d, items: fn(d.items) }), coalesce);

  function addItem(asset: Asset) {
    if (draft.items.length >= MAX_ITEMS) {
      toast('error', `Une composition contient au maximum ${MAX_ITEMS} éléments.`);
      return;
    }
    const it = newItem(asset.id, draft.items.length);
    setItems((items) => [...items, it]);
    setSelectedId(it.id);
  }
  const patchItem = (id: string, patch: Partial<VariantItem>, coalesce = false) =>
    setItems((items) => items.map((i) => (i.id === id ? { ...i, ...patch } : i)), coalesce);
  const setTransform = (id: string, t: Transform2D) => patchItem(id, { transform: t }, true);
  function removeItem(id: string) {
    setItems((items) => items.filter((i) => i.id !== id));
    if (selectedId === id) setSelectedId(null);
  }
  function duplicateItem(id: string) {
    const src = draft.items.find((i) => i.id === id);
    if (!src || draft.items.length >= MAX_ITEMS) return;
    const copy: VariantItem = {
      ...src,
      id: crypto.randomUUID(),
      locked: false,
      transform: clampTransform({ ...src.transform, x: src.transform.x + 0.05, y: src.transform.y + 0.02 }),
    };
    setItems((items) => {
      const idx = items.findIndex((i) => i.id === id);
      return [...items.slice(0, idx + 1), copy, ...items.slice(idx + 1)];
    });
    setSelectedId(copy.id);
  }
  /** dir = +1 : vers le premier plan ; -1 : vers le fond. */
  function moveItem(id: string, dir: 1 | -1) {
    setItems((items) => {
      const idx = items.findIndex((i) => i.id === id);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= items.length) return items;
      const next = [...items];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
  }
  const setT = (patch: Partial<Transform2D>) => {
    if (selected) setTransform(selected.id, clampTransform({ ...selected.transform, ...patch }));
  };

  // ---- Variantes ----------------------------------------------------------
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
        backgroundAssetId: draft.backgroundAssetId,
        // Nouveaux identifiants : les éléments de la copie sont indépendants de l'original.
        items: draft.items.map((i) => ({ ...i, id: crypto.randomUUID() })),
      });
      toast(
        'success',
        dirty
          ? `Variante « ${v.name} » créée à partir de l’état affiché. « ${variant.name} » garde sa dernière version enregistrée.`
          : `Variante « ${v.name} » créée.`,
      );
      setSaved(draft);
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

  const otherVariant = variants.find((v) => v.id !== variant.id);
  const selIndex = selected ? draft.items.findIndex((i) => i.id === selected.id) : -1;
  const hasVisible = draft.items.some((i) => !i.hidden);

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
        <aside className="studio-panel studio-left" aria-label="Images à ajouter">
          <h2>Ajouter une image</h2>
          {artworks.length > 1 && (
            <label className="small-field">
              <span className="sr-only">Œuvre dont afficher les photographies</span>
              <select value={sourceArtwork} onChange={(e) => setSourceArtwork(e.target.value)}>
                {artworks.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
            </label>
          )}
          {photos.length === 0 && <p className="muted small">Aucune photo pour cette œuvre.</p>}
          <div className="pick-grid pick-grid-tight">
            {photos.map((p) => (
              <button key={p.id} type="button" className="pick-item pick-add" onClick={() => addItem(p)} aria-label={`Ajouter ${p.title} à la composition`}>
                <AssetThumb asset={p} />
                <span>{p.title}</span>
              </button>
            ))}
          </div>

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
            items={draft.items}
            assets={allAssets}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChangeItem={setTransform}
            onCommit={commit}
            onRemoveSelected={() => selected && removeItem(selected.id)}
            label={`Composition de la variante ${variant.name}`}
          />
        </section>

        <aside className="studio-panel studio-right" aria-label="Éléments et réglages">
          <h2>Éléments ({draft.items.length})</h2>
          {draft.items.length === 0 && <p className="muted small">Clique une photographie à gauche pour la poser sur le décor.</p>}
          <ul className="item-list" aria-label="Éléments, du premier plan vers le fond">
            {[...draft.items].reverse().map((it) => (
              <li key={it.id} className={`item-row${it.id === selectedId ? ' is-selected' : ''}${it.hidden ? ' is-hidden' : ''}`}>
                <button type="button" className="item-name" aria-pressed={it.id === selectedId} onClick={() => setSelectedId(it.id)}>
                  <AssetThumb asset={assetById.get(it.assetId)} className="item-thumb" />
                  <span>{itemLabel(it)}</span>
                </button>
                <button type="button" className="icon-toggle" aria-pressed={!it.hidden} aria-label={`${it.hidden ? 'Afficher' : 'Masquer'} ${itemLabel(it)}`} title={it.hidden ? 'Afficher' : 'Masquer'} onClick={() => patchItem(it.id, { hidden: !it.hidden })}>
                  {it.hidden ? 'masqué' : 'visible'}
                </button>
                <button type="button" className={`icon-toggle${it.locked ? ' is-on' : ''}`} aria-pressed={it.locked} aria-label={`${it.locked ? 'Déverrouiller' : 'Verrouiller'} ${itemLabel(it)}`} title={it.locked ? 'Déverrouiller' : 'Verrouiller'} onClick={() => patchItem(it.id, { locked: !it.locked })}>
                  {it.locked ? 'verrouillé' : 'libre'}
                </button>
              </li>
            ))}
          </ul>

          {selected && (
            <>
              <div className="button-row">
                <button type="button" className="button button-small" onClick={() => moveItem(selected.id, 1)} disabled={selIndex === draft.items.length - 1}>Vers l’avant</button>
                <button type="button" className="button button-small" onClick={() => moveItem(selected.id, -1)} disabled={selIndex === 0}>Vers le fond</button>
                <button type="button" className="button button-small" onClick={() => duplicateItem(selected.id)} disabled={draft.items.length >= MAX_ITEMS}>Dupliquer</button>
                <button type="button" className="button button-small danger-text" onClick={() => removeItem(selected.id)}>Retirer</button>
              </div>
              <h2>Élément choisi</h2>
              <InlineRename value={itemLabel(selected)} label="Renommer l’élément" onSave={async (t) => patchItem(selected.id, { name: t.trim() || null })} />
              {selectedAsset && selectedAsset.transparency === false && (
                <p className="warn-text" role="note">Fond non transparent : cette photo s’affiche comme un rectangle posé sur le décor.</p>
              )}
              <fieldset disabled={selected.locked} className="sliders">
                <legend className="sr-only">Placement de l’élément choisi</legend>
                <Slider label="Horizontal" value={selected.transform.x} min={-0.25} max={1.25} step={0.001} format={(v) => `${Math.round(v * 100)} %`} onChange={(x) => setT({ x })} onCommit={commit} />
                <Slider label="Vertical" value={selected.transform.y} min={-0.25} max={1.25} step={0.001} format={(v) => `${Math.round(v * 100)} %`} onChange={(y) => setT({ y })} onCommit={commit} />
                <Slider label="Hauteur dans le cadre" value={selected.transform.scale} min={SCALE_MIN} max={SCALE_MAX} step={0.005} format={(v) => `${Math.round(v * 100)} %`} onChange={(scale) => setT({ scale })} onCommit={commit} />
                <Slider label="Rotation" value={selected.transform.rotationDeg} min={-180} max={180} step={0.5} format={(v) => `${v.toFixed(1).replace('.', ',')}°`} onChange={(rotationDeg) => setT({ rotationDeg })} onCommit={commit} />
              </fieldset>
              {selected.locked && <p className="muted small">Élément verrouillé : déverrouille-le pour le déplacer.</p>}
              <p className="muted small">Valeurs relatives au cadre, approximatives : elles ne disent rien de la taille réelle.</p>
            </>
          )}
          <div className="button-row">
            <button type="button" className="button button-small" onClick={undo} disabled={!canUndo}>Annuler</button>
            {selected && !selected.locked && (
              <button type="button" className="button button-small" onClick={() => setTransform(selected.id, DEFAULT_TRANSFORM)}>Réinitialiser la position</button>
            )}
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
          <button type="button" className="button" onClick={() => setExporting(true)} disabled={!hasVisible}>Exporter</button>
        </div>
      </div>

      {exporting && (
        <ExportDialog background={bg} items={draft.items} assets={allAssets} fileBase={`${props.artworkTitle}-${props.presentationTitle}-${variant.name}`} onClose={() => setExporting(false)} />
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
