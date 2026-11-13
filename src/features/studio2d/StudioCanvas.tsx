import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useApp } from '../../app/AppContext';
import { clampTransform } from '../../domain/transform';
import type { Asset, Transform2D, VariantItem } from '../../domain/types';
import { alphaMaskFor, useBitmap, useBitmaps } from '../assets/imageCache';
import { drawComposition, foregroundRect, frameAspect, hitHandle, pickItem, type Size } from './compose';

interface Props {
  background: Asset | null;
  /** Du fond vers le premier plan. */
  items: VariantItem[];
  assets: Asset[];
  label: string;
  /** Absents : aperçu en lecture seule (comparateur). */
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onChangeItem?: (id: string, t: Transform2D) => void;
  onCommit?: () => void;
  onRemoveSelected?: () => void;
}

type Gesture =
  | { kind: 'move'; startX: number; startY: number; t0: Transform2D; id: string }
  | { kind: 'resize'; dist0: number; t0: Transform2D; id: string }
  | { kind: 'pinch'; dist0: number; t0: Transform2D; id: string };

const HANDLE = 14;
const SELECTION_COLOR = '#2f7a6e';

/** Aperçu de composition à plusieurs éléments. Dessine avec drawComposition, exactement comme l'export. */
export function StudioCanvas({ background, items, assets, label, selectedId = null, onSelect, onChangeItem, onCommit, onRemoveSelected }: Props) {
  const { repo } = useApp();
  const interactive = !!onChangeItem;
  const bg = useBitmap(repo, background);
  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const itemAssets = useMemo(
    () => items.map((i) => byId.get(i.assetId)).filter((a): a is Asset => !!a),
    [items, byId],
  );
  const fg = useBitmaps(repo, itemAssets);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [boxSize, setBoxSize] = useState<Size>({ w: 0, h: 0 });
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  const aspect = frameAspect(background ? { w: background.width, h: background.height } : null);
  const display: Size =
    boxSize.w === 0 ? { w: 0, h: 0 } : boxSize.w / boxSize.h > aspect
      ? { w: Math.floor(boxSize.h * aspect), h: Math.floor(boxSize.h) }
      : { w: Math.floor(boxSize.w), h: Math.floor(boxSize.w / aspect) };

  const sizeOf = useCallback((it: VariantItem): Size => {
    const a = byId.get(it.assetId);
    return a ? { w: a.width, h: a.height } : { w: 1, h: 1 };
  }, [byId]);
  const selectedIndex = items.findIndex((i) => i.id === selectedId);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : null;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBoxSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || display.w === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(display.w * dpr);
    c.height = Math.round(display.h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawComposition(
      ctx,
      display,
      {
        background: bg.bitmap,
        items: items.map((it) => ({ image: fg.bitmaps.get(it.assetId) ?? null, size: sizeOf(it), transform: it.transform, hidden: it.hidden })),
      },
      { selection: interactive && selectedIndex >= 0 ? { index: selectedIndex, color: SELECTION_COLOR, handleRadius: HANDLE } : null },
    );
  }, [display.w, display.h, bg.bitmap, fg.bitmaps, items, selectedIndex, interactive, sizeOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const point = (e: PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const pick = (x: number, y: number) =>
    pickItem(
      x, y, display,
      items.map((it) => {
        const a = byId.get(it.assetId);
        const bm = fg.bitmaps.get(it.assetId);
        return { size: sizeOf(it), transform: it.transform, hidden: it.hidden, locked: it.locked, alpha: a && bm ? alphaMaskFor(a, bm) : null };
      }),
    );

  const emit = (id: string, t: Transform2D) => onChangeItem?.(id, clampTransform(t));

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (!interactive) return;
    const p = point(e);
    pointers.current.set(e.pointerId, p);
    canvas.current!.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2 && selected && !selected.locked) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', dist0: Math.hypot(a.x - b.x, a.y - b.y), t0: selected.transform, id: selected.id };
      return;
    }
    // La poignée de l'élément déjà sélectionné a priorité.
    if (selected && !selected.locked && !selected.hidden) {
      const rect = foregroundRect(display, sizeOf(selected), selected.transform);
      if (hitHandle(p.x, p.y, rect, HANDLE)) {
        gesture.current = { kind: 'resize', dist0: Math.hypot(p.x - rect.cx, p.y - rect.cy), t0: selected.transform, id: selected.id };
        return;
      }
    }
    const idx = pick(p.x, p.y);
    if (idx < 0) {
      onSelect?.(null);
      return;
    }
    const it = items[idx];
    if (it.id !== selectedId) onSelect?.(it.id);
    gesture.current = { kind: 'move', startX: p.x, startY: p.y, t0: it.transform, id: it.id };
  }

  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!interactive) return;
    const p = point(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    const c = canvas.current!;
    if (!g) {
      let cursor = 'default';
      if (selected && !selected.locked && hitHandle(p.x, p.y, foregroundRect(display, sizeOf(selected), selected.transform), HANDLE)) cursor = 'nwse-resize';
      else if (pick(p.x, p.y) >= 0) cursor = 'grab';
      c.style.cursor = cursor;
      return;
    }
    const it = items.find((i) => i.id === g.id);
    if (!it) return;
    if (g.kind === 'move') {
      c.style.cursor = 'grabbing';
      emit(g.id, { ...g.t0, x: g.t0.x + (p.x - g.startX) / display.w, y: g.t0.y + (p.y - g.startY) / display.h });
    } else if (g.kind === 'resize') {
      const rect = foregroundRect(display, sizeOf(it), g.t0);
      const d = Math.hypot(p.x - rect.cx, p.y - rect.cy);
      if (g.dist0 > 0) emit(g.id, { ...g.t0, scale: g.t0.scale * (d / g.dist0) });
    } else if (g.kind === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.dist0 > 0) emit(g.id, { ...g.t0, scale: g.t0.scale * (d / g.dist0) });
    }
  }

  function onPointerUp(e: PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(e.pointerId);
    if (gesture.current) onCommit?.();
    gesture.current = null;
    if (canvas.current) canvas.current.style.cursor = 'default';
  }

  // Molette : échelle de l'élément sélectionné. Écouteur non passif pour empêcher le défilement de la page.
  const wheelTarget = selected && !selected.locked ? selected : null;
  useEffect(() => {
    const c = canvas.current;
    if (!c || !interactive || !wheelTarget) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      onChangeItem?.(wheelTarget.id, clampTransform({ ...wheelTarget.transform, scale: wheelTarget.transform.scale * Math.exp(-e.deltaY * 0.0015) }));
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [interactive, wheelTarget, onChangeItem]);

  function onKeyDown(e: KeyboardEvent) {
    if (!interactive) return;
    // Tab dans l'aperçu : passer à l'élément suivant (Maj+Tab : précédent), puis sortir de l'aperçu.
    if (e.key === 'Tab' && items.length > 0) {
      const next = selectedIndex + (e.shiftKey ? -1 : 1);
      if (selectedIndex === -1 && !e.shiftKey) { e.preventDefault(); onSelect?.(items[0].id); return; }
      if (next >= 0 && next < items.length) { e.preventDefault(); onSelect?.(items[next].id); return; }
      return;
    }
    if (!selected || selected.locked) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onRemoveSelected?.(); return; }
    const step = e.shiftKey ? 0.05 : 0.005;
    const t = selected.transform;
    const map: Record<string, Transform2D> = {
      ArrowLeft: { ...t, x: t.x - step },
      ArrowRight: { ...t, x: t.x + step },
      ArrowUp: { ...t, y: t.y - step },
      ArrowDown: { ...t, y: t.y + step },
      '+': { ...t, scale: t.scale * (e.shiftKey ? 1.1 : 1.02) },
      '=': { ...t, scale: t.scale * 1.02 },
      '-': { ...t, scale: t.scale / (e.shiftKey ? 1.1 : 1.02) },
      '[': { ...t, rotationDeg: t.rotationDeg - (e.shiftKey ? 15 : 1) },
      ']': { ...t, rotationDeg: t.rotationDeg + (e.shiftKey ? 15 : 1) },
    };
    const next = map[e.key];
    if (next) {
      e.preventDefault();
      emit(selected.id, next);
    }
  }

  const loading = bg.loading || fg.loading;
  const loadError = bg.error || fg.errors[0] || null;
  const selName = selected ? selected.name ?? byId.get(selected.assetId)?.title ?? 'élément' : null;

  return (
    <div className="stage" ref={box}>
      <div className="stage-frame" style={{ width: display.w, height: display.h }}>
        <canvas
          ref={canvas}
          style={{ width: display.w, height: display.h }}
          tabIndex={interactive ? 0 : -1}
          role={interactive ? 'application' : 'img'}
          aria-roledescription={interactive ? 'zone de composition' : undefined}
          aria-label={
            interactive
              ? `${label}. ${items.length} élément${items.length > 1 ? 's' : ''}. ${
                  selected
                    ? `Sélection : ${selName}, position ${Math.round(selected.transform.x * 100)} %, ${Math.round(selected.transform.y * 100)} %, hauteur ${Math.round(selected.transform.scale * 100)} % du cadre.`
                    : 'Aucun élément sélectionné.'
                } Tab : élément suivant ; flèches : déplacer ; plus et moins : échelle ; crochets : rotation ; Suppr : retirer.`
              : label
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          onKeyUp={() => interactive && onCommit?.()}
          className={interactive ? 'stage-canvas is-interactive' : 'stage-canvas'}
        />
        <span className="stage-tag">Simulation 2D</span>
        {loading && <span className="stage-status" role="status">Chargement des images…</span>}
        {loadError && <span className="stage-status stage-error" role="alert">{loadError}</span>}
        {items.length === 0 && !loading && <span className="stage-status">{interactive ? 'Ajoute une photographie depuis le panneau de gauche.' : 'Aucun élément dans cette variante.'}</span>}
      </div>
    </div>
  );
}
