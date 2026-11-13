import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useBlocker, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { useLoad } from '../../app/useLoad';
import { AssetThumb } from '../../components/AssetThumb';
import { InlineRename } from '../../components/InlineRename';
import { Modal } from '../../components/Modal';
import { SaveIndicator, type SaveState } from '../../components/SaveIndicator';
import { useToast } from '../../components/Toast';
import type { Artwork, Asset, Placement, Room, Variant } from '../../domain/types';
import { safeFilename } from '../exports/ExportDialog';
import { nextVariantName } from '../studio2d/StudioPage';
import {
  EYE_HEIGHT_DEFAULT, MAX_PLACEMENTS, SILHOUETTE_HEIGHT_DEFAULT, assetForPlacement, clampPlacement, distanceCm, entrancePose,
  formatCm, newPlacement, parseHeightCm, samePlacements, type CameraPose,
} from './geometry';
import { PlanView } from './PlanView';
import { RoomView, type RoomViewHandle } from './RoomView';

export function HangingPage() {
  const { presentationId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { repo } = useApp();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(async () => {
    const presentation = await repo.getPresentation(presentationId);
    if (!presentation) return null;
    const [room, artworks, assets, variants] = await Promise.all([
      presentation.roomId ? repo.getRoom(presentation.roomId) : Promise.resolve(null),
      repo.listArtworks(),
      repo.listAssets(),
      repo.listVariants(),
    ]);
    return { presentation, room, artworks, assets, variants: variants.filter((v) => v.presentationId === presentationId) };
  }, [repo, presentationId]);

  if (loading && !data) return <p className="page-state" role="status">Ouverture de l’accrochage…</p>;
  if (error)
    return (
      <section className="page">
        <p className="error-box" role="alert">L’accrochage n’a pas pu s’ouvrir : {error}</p>
        <button type="button" className="button" onClick={reload}>Réessayer</button>
      </section>
    );
  if (!data)
    return (
      <section className="page">
        <h1>Accrochage introuvable</h1>
        <p><Link to="/accrochages">Retour aux accrochages</Link></p>
      </section>
    );
  if (data.presentation.mode !== 'room') return <Navigate to={`/studio/${presentationId}`} replace />;
  if (!data.room)
    return (
      <section className="page">
        <h1>Salle introuvable</h1>
        <p><Link to="/accrochages">Retour aux accrochages</Link></p>
      </section>
    );

  const requested = params.get('variant');
  if (requested && loading && !data.variants.some((v) => v.id === requested)) {
    return <p className="page-state" role="status">Ouverture de la variante…</p>;
  }
  const active = data.variants.find((v) => v.id === requested) ?? data.variants[0] ?? null;
  if (!active)
    return (
      <section className="page">
        <p className="empty">Cet accrochage n’a plus de variante.</p>
        <button
          type="button"
          className="button button-primary"
          onClick={async () => {
            try {
              const v = await repo.createVariant({ presentationId, name: 'A', backgroundAssetId: null, items: [], placements: [] });
              setParams({ variant: v.id });
              reload();
            } catch (e) {
              toast('error', (e as Error).message);
            }
          }}
        >
          Créer la variante A
        </button>
      </section>
    );

  return (
    <HangingEditor
      key={active.id}
      variant={active}
      variants={data.variants}
      room={data.room}
      artworks={data.artworks}
      assets={data.assets}
      title={data.presentation.title}
      presentationId={presentationId}
      reload={reload}
    />
  );
}

interface EditorProps {
  variant: Variant;
  variants: Variant[];
  room: Room;
  artworks: Artwork[];
  assets: Asset[];
  title: string;
  presentationId: string;
  reload: () => void;
}

function HangingEditor({ variant, variants, room, artworks, assets, title, presentationId, reload }: EditorProps) {
  const { repo } = useApp();
  const toast = useToast();
  const [, setParams] = useSearchParams();
  const [placements, setPlacements] = useState<Placement[]>(variant.placements);
  const [saved, setSaved] = useState<Placement[]>(variant.placements);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'plan' | 'room'>('plan');
  const [showFigure, setShowFigure] = useState(false);
  const [figure, setFigure] = useState({ xCm: Math.round(room.lengthCm / 2 - 150), zCm: Math.round(room.widthCm / 2), heightCm: SILHOUETTE_HEIGHT_DEFAULT });
  const poseRef = useRef<CameraPose>(entrancePose(room));
  const [pose, setPose] = useState<CameraPose>(poseRef.current);
  const [pendingLeave, setPendingLeave] = useState<{ kind: 'variant'; id: string } | { kind: 'route' } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const roomView = useRef<RoomViewHandle>(null);

  const dirty = !samePlacements(placements, saved);
  const effective: SaveState = saveState === 'saving' || saveState === 'error' ? saveState : dirty ? 'dirty' : 'saved';
  const selected = placements.find((p) => p.id === selectedId) ?? null;
  const selectedArtwork = selected ? artworks.find((a) => a.id === selected.artworkId) ?? null : null;

  const save = useCallback(async (): Promise<boolean> => {
    setSaveState('saving');
    try {
      const v = await repo.updateVariant(variant.id, { placements });
      setSaved(v.placements);
      setPlacements(v.placements);
      setSaveState('saved');
      return true;
    } catch (e) {
      setSaveState('error');
      toast('error', `Non enregistré : ${(e as Error).message}`);
      return false;
    }
  }, [repo, variant.id, placements, toast]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  const blockerState = blocker.state;
  useEffect(() => {
    if (blockerState === 'blocked') setPendingLeave({ kind: 'route' });
  }, [blockerState]);

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void saveRef.current(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const patch = (id: string, p: Partial<Placement>) =>
    setPlacements((list) => list.map((x) => (x.id === id ? clampPlacement({ ...x, ...p }, room) : x)));
  const remove = (id: string) => {
    setPlacements((list) => list.filter((x) => x.id !== id));
    if (selectedId === id) setSelectedId(null);
  };
  function place(a: Artwork) {
    if (placements.length >= MAX_PLACEMENTS) {
      toast('error', `Un accrochage contient au maximum ${MAX_PLACEMENTS} œuvres.`);
      return;
    }
    const p = newPlacement(a.id, room, placements.length);
    setPlacements((list) => [...list, p]);
    setSelectedId(p.id);
  }

  function switchView(next: 'plan' | 'room') {
    setPose({ ...poseRef.current }); // la position atteinte en marchant est reportée sur le plan
    setView(next);
  }

  async function resolveLeave(action: 'save' | 'discard' | 'cancel') {
    const p = pendingLeave;
    setPendingLeave(null);
    if (!p) return;
    const resetBlock = () => { if (p.kind === 'route' && blocker.state === 'blocked') blocker.reset(); };
    if (action === 'cancel') return resetBlock();
    if (action === 'save' && !(await save())) return resetBlock();
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
        backgroundAssetId: null,
        items: [],
        placements: placements.map((p) => ({ ...p, id: crypto.randomUUID() })),
      });
      toast('success', dirty ? `Variante « ${v.name} » créée à partir de l’état affiché. « ${variant.name} » garde sa dernière version enregistrée.` : `Variante « ${v.name} » créée.`);
      setSaved(placements);
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
      setSaved(placements);
      const other = variants.find((v) => v.id !== variant.id);
      setParams(other ? { variant: other.id } : {});
      reload();
    } catch (e) {
      toast('error', `Suppression impossible : ${(e as Error).message}`);
    }
  }

  async function exportView() {
    if (!roomView.current) return;
    setExporting(true);
    try {
      const blob = await roomView.current.capture(1920);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeFilename(`${title}-${variant.name}`)}-vue.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('success', 'Vue exportée en PNG.');
    } catch (e) {
      toast('error', `Export impossible : ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  const silhouette = showFigure ? figure : null;
  const photosOf = (artworkId: string) => assets.filter((a) => a.artworkId === artworkId && (a.kind === 'cutout' || a.kind === 'photo'));

  return (
    <div className="studio">
      <div className="studio-bar">
        <p className="breadcrumb">
          <Link to="/accrochages">Accrochages</Link> / {room.title} /{' '}
          <InlineRename value={title} label="Renommer l’accrochage" onSave={async (t) => { await repo.renamePresentation(presentationId, t); reload(); }} />
        </p>
        <div className="view-switch" role="tablist" aria-label="Type de vue">
          <button type="button" role="tab" aria-selected={view === 'plan'} className={`tab${view === 'plan' ? ' is-active' : ''}`} onClick={() => switchView('plan')}>Plan</button>
          <button type="button" role="tab" aria-selected={view === 'room'} className={`tab${view === 'room' ? ' is-active' : ''}`} onClick={() => switchView('room')}>Salle</button>
        </div>
        <div className="studio-actions">
          <SaveIndicator state={effective} onRetry={() => void save()} />
          <button type="button" className="button button-primary" onClick={() => void save()} disabled={!dirty || saveState === 'saving'}>Enregistrer</button>
          <button type="button" className="button" onClick={duplicate}>Dupliquer comme variante</button>
        </div>
      </div>

      <div className="studio-body">
        <aside className="studio-panel studio-left" aria-label="Œuvres à placer">
          <h2>Œuvres</h2>
          {artworks.length === 0 && <p className="muted small">Aucune œuvre. Crée-en une depuis l’atelier.</p>}
          <ul className="place-list">
            {artworks.map((a) => (
              <ArtworkRow key={a.id} artwork={a} cover={assetForPlacement({ artworkId: a.id, assetId: null }, assets)} onPlace={() => place(a)} onHeightSaved={reload} />
            ))}
          </ul>

          <h2>Repères</h2>
          <label className="check"><input type="checkbox" checked={showFigure} onChange={(e) => setShowFigure(e.target.checked)} /> Silhouette humaine</label>
          {showFigure && (
            <label className="small-number">Taille (cm)
              <input type="number" min={100} max={220} value={figure.heightCm} onChange={(e) => setFigure({ ...figure, heightCm: Math.min(220, Math.max(100, Number(e.target.value) || SILHOUETTE_HEIGHT_DEFAULT)) })} />
            </label>
          )}
          <label className="small-number">Hauteur des yeux (cm)
            <input
              type="number" min={80} max={220} value={pose.eyeCm}
              onChange={(e) => {
                const eyeCm = Math.min(220, Math.max(80, Number(e.target.value) || EYE_HEIGHT_DEFAULT));
                poseRef.current = { ...poseRef.current, eyeCm };
                setPose({ ...poseRef.current });
              }}
            />
          </label>
          <button type="button" className="button button-small" onClick={() => { poseRef.current = entrancePose(room, pose.eyeCm); setPose({ ...poseRef.current }); }}>
            Revenir à l’entrée
          </button>
        </aside>

        <section className="studio-center" aria-label={view === 'plan' ? 'Vue en plan' : 'Vue de la salle'}>
          {view === 'plan' ? (
            <PlanView
              room={room} placements={placements} artworks={artworks} assets={assets}
              selectedId={selectedId} onSelect={setSelectedId} onChange={patch} onRemove={remove}
              silhouette={silhouette} onMoveSilhouette={(xCm, zCm) => setFigure((f) => ({ ...f, xCm, zCm }))}
              pose={pose} onMoveCamera={(xCm, zCm) => { poseRef.current = { ...poseRef.current, xCm, zCm }; setPose({ ...poseRef.current }); }}
            />
          ) : (
            <RoomView
              ref={roomView} poseStamp={pose} room={room} placements={placements} artworks={artworks} assets={assets}
              selectedId={selectedId} onSelect={setSelectedId} silhouette={silhouette} poseRef={poseRef}
            />
          )}
        </section>

        <aside className="studio-panel studio-right" aria-label="Œuvres placées et réglages">
          <h2>Placées ({placements.length})</h2>
          {placements.length === 0 && <p className="muted small">Clique « Placer » à côté d’une œuvre. Elle arrive au centre de la salle.</p>}
          <ul className="item-list">
            {placements.map((p) => {
              const a = artworks.find((x) => x.id === p.artworkId);
              return (
                <li key={p.id} className={`item-row${p.id === selectedId ? ' is-selected' : ''}`}>
                  <button type="button" className="item-name" aria-pressed={p.id === selectedId} onClick={() => setSelectedId(p.id)}>
                    <AssetThumb asset={assetForPlacement(p, assets)} className="item-thumb" />
                    <span>{a?.title ?? 'Œuvre supprimée'}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {selected && selectedArtwork && (
            <>
              <h2>{selectedArtwork.title}</h2>
              <p className="muted small">Hauteur déclarée : {selectedArtwork.heightCm ? formatCm(selectedArtwork.heightCm) : 'non renseignée'}</p>
              {photosOf(selected.artworkId).length > 1 && (
                <label className="small-field">Photographie
                  <select value={assetForPlacement(selected, assets)?.id ?? ''} onChange={(e) => patch(selected.id, { assetId: e.target.value })}>
                    {photosOf(selected.artworkId).map((ph) => <option key={ph.id} value={ph.id}>{ph.title}</option>)}
                  </select>
                </label>
              )}
              {assetForPlacement(selected, assets)?.transparency === false && (
                <p className="warn-text" role="note">Photo non détourée : elle apparaît comme un panneau rectangulaire dans la salle.</p>
              )}
              <div className="num-grid">
                <label>Depuis le mur gauche (cm)<input type="number" step={5} value={selected.xCm} onChange={(e) => patch(selected.id, { xCm: Number(e.target.value) })} /></label>
                <label>Depuis le mur d’entrée (cm)<input type="number" step={5} value={selected.zCm} onChange={(e) => patch(selected.id, { zCm: Number(e.target.value) })} /></label>
                <label>Base au-dessus du sol (cm)<input type="number" step={5} min={0} value={selected.elevationCm} onChange={(e) => patch(selected.id, { elevationCm: Number(e.target.value) })} /></label>
              </div>
              <div className="slider">
                <label htmlFor="rot">Orientation <output htmlFor="rot">{selected.rotationDeg}°</output></label>
                <input id="rot" type="range" min={-180} max={180} step={5} value={selected.rotationDeg} onChange={(e) => patch(selected.id, { rotationDeg: Number(e.target.value) })} />
              </div>
              {placements.length > 1 && (
                <ul className="distances" aria-label="Distances aux autres œuvres">
                  {placements.filter((p) => p.id !== selected.id).map((p) => (
                    <li key={p.id}>{formatCm(distanceCm(selected, p))} de {artworks.find((a) => a.id === p.artworkId)?.title ?? 'une œuvre'}</li>
                  ))}
                </ul>
              )}
              <button type="button" className="button button-small danger-text" onClick={() => remove(selected.id)}>Retirer de la salle</button>
            </>
          )}
          <p className="muted small">Dimensions déclarées par toi. La photo n’a pas d’épaisseur : de profil, un panneau devient un trait.</p>
        </aside>
      </div>

      <div className="variant-bar">
        <div className="variant-tabs" role="tablist" aria-label="Variantes de l’accrochage">
          {variants.map((v) => (
            <button
              key={v.id} type="button" role="tab" aria-selected={v.id === variant.id}
              className={`variant-tab${v.id === variant.id ? ' is-active' : ''}`}
              onClick={() => { if (v.id === variant.id) return; if (dirty) setPendingLeave({ kind: 'variant', id: v.id }); else setParams({ variant: v.id }); }}
            >
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
          {view === 'room' ? (
            <button type="button" className="button" onClick={exportView} disabled={exporting}>{exporting ? 'Rendu…' : 'Exporter la vue (PNG)'}</button>
          ) : (
            <span className="muted small">Passe en vue « Salle » pour exporter une image.</span>
          )}
        </div>
      </div>

      {pendingLeave && (
        <Modal
          title="Modifications non enregistrées"
          onClose={() => void resolveLeave('cancel')}
          actions={
            <>
              <button type="button" className="button" onClick={() => void resolveLeave('cancel')}>Rester ici</button>
              <button type="button" className="button button-danger" onClick={() => void resolveLeave('discard')}>Abandonner les modifications</button>
              <button type="button" className="button button-primary" onClick={() => void resolveLeave('save')}>Enregistrer puis continuer</button>
            </>
          }
        >
          <p>L’accrochage « {variant.name} » a été modifié depuis le dernier enregistrement.</p>
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
          <p>Les autres variantes de l’accrochage ne sont pas touchées.</p>
        </Modal>
      )}
    </div>
  );
}

function ArtworkRow({ artwork, cover, onPlace, onHeightSaved }: { artwork: Artwork; cover: Asset | null; onPlace: () => void; onHeightSaved: () => void }) {
  const { repo } = useApp();
  const toast = useToast();
  const [height, setHeight] = useState('');
  const canPlace = !!artwork.heightCm && !!cover;
  return (
    <li className="place-row">
      <AssetThumb asset={cover} className="item-thumb" />
      <div className="place-info">
        <span className="place-title">{artwork.title}</span>
        {artwork.heightCm ? (
          <span className="muted small">{formatCm(artwork.heightCm)}</span>
        ) : (
          <form
            className="height-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const h = parseHeightCm(height);
              if (!h) { toast('error', 'Indique une hauteur entre 1 et 2000 cm.'); return; }
              try { await repo.setArtworkHeight(artwork.id, h); onHeightSaved(); } catch (err) { toast('error', (err as Error).message); }
            }}
          >
            <label className="sr-only" htmlFor={`h-${artwork.id}`}>Hauteur réelle de {artwork.title} en centimètres</label>
            <input id={`h-${artwork.id}`} inputMode="decimal" placeholder="Hauteur (cm)" value={height} onChange={(e) => setHeight(e.target.value)} />
            <button type="submit" className="button button-small">OK</button>
          </form>
        )}
        {!cover && <span className="warn-text">Aucune photo importée.</span>}
      </div>
      <button type="button" className="button button-small" onClick={onPlace} disabled={!canPlace} aria-label={`Placer ${artwork.title} dans la salle`}>Placer</button>
    </li>
  );
}
