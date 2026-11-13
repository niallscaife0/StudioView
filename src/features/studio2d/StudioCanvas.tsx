import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useApp } from '../../app/AppContext';
import { clampTransform } from '../../domain/transform';
import type { Asset, Transform2D } from '../../domain/types';
import { useBitmap } from '../assets/imageCache';
import { drawComposition, foregroundRect, frameAspect, hitForeground, hitHandle, type Size } from './compose';

interface Props {
  background: Asset | null;
  foreground: Asset | null;
  transform: Transform2D;
  /** Absent : aperçu en lecture seule (comparateur). */
  onChange?: (t: Transform2D) => void;
  onCommit?: () => void;
  label: string;
}

type Gesture =
  | { kind: 'move'; startX: number; startY: number; t0: Transform2D }
  | { kind: 'resize'; dist0: number; t0: Transform2D }
  | { kind: 'pinch'; dist0: number; t0: Transform2D };

const HANDLE = 14;
const SELECTION_COLOR = '#2f7a6e';

/** Aperçu de composition. Dessine avec drawComposition, exactement comme l'export. */
export function StudioCanvas({ background, foreground, transform, onChange, onCommit, label }: Props) {
  const { repo } = useApp();
  const bg = useBitmap(repo, background);
  const fg = useBitmap(repo, foreground);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [boxSize, setBoxSize] = useState<Size>({ w: 0, h: 0 });
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const interactive = !!onChange;

  const aspect = frameAspect(background ? { w: background.width, h: background.height } : null);
  const display: Size =
    boxSize.w === 0 ? { w: 0, h: 0 } : boxSize.w / boxSize.h > aspect
      ? { w: Math.floor(boxSize.h * aspect), h: Math.floor(boxSize.h) }
      : { w: Math.floor(boxSize.w), h: Math.floor(boxSize.w / aspect) };
  const fgSize: Size | null = foreground ? { w: foreground.width, h: foreground.height } : null;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setBoxSize({ w: r.width, h: r.height });
    });
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
      { background: bg.bitmap, foreground: fg.bitmap, foregroundSize: fgSize, transform },
      { selection: interactive && fg.bitmap ? { color: SELECTION_COLOR, handleRadius: HANDLE } : null },
    );
  }, [display.w, display.h, bg.bitmap, fg.bitmap, fgSize?.w, fgSize?.h, transform, interactive]); // eslint-disable-line react-hooks/exhaustive-deps

  const point = (e: PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const emit = useCallback((t: Transform2D) => onChange?.(clampTransform(t)), [onChange]);

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (!interactive || !fgSize) return;
    const p = point(e);
    pointers.current.set(e.pointerId, p);
    canvas.current!.setPointerCapture(e.pointerId);
    const rect = foregroundRect(display, fgSize, transform);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', dist0: Math.hypot(a.x - b.x, a.y - b.y), t0: transform };
    } else if (hitHandle(p.x, p.y, rect, HANDLE)) {
      gesture.current = { kind: 'resize', dist0: Math.hypot(p.x - rect.cx, p.y - rect.cy), t0: transform };
    } else if (hitForeground(p.x, p.y, rect, 6)) {
      gesture.current = { kind: 'move', startX: p.x, startY: p.y, t0: transform };
    }
  }

  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!interactive || !fgSize) return;
    const p = point(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    const c = canvas.current!;
    if (!g) {
      const rect = foregroundRect(display, fgSize, transform);
      c.style.cursor = hitHandle(p.x, p.y, rect, HANDLE) ? 'nwse-resize' : hitForeground(p.x, p.y, rect, 6) ? 'grab' : 'default';
      return;
    }
    if (g.kind === 'move') {
      c.style.cursor = 'grabbing';
      emit({ ...g.t0, x: g.t0.x + (p.x - g.startX) / display.w, y: g.t0.y + (p.y - g.startY) / display.h });
    } else if (g.kind === 'resize') {
      const rect = foregroundRect(display, fgSize, g.t0);
      const d = Math.hypot(p.x - rect.cx, p.y - rect.cy);
      if (g.dist0 > 0) emit({ ...g.t0, scale: g.t0.scale * (d / g.dist0) });
    } else if (g.kind === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.dist0 > 0) emit({ ...g.t0, scale: g.t0.scale * (d / g.dist0) });
    }
  }

  function onPointerUp(e: PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(e.pointerId);
    if (gesture.current) onCommit?.();
    gesture.current = null;
    if (canvas.current) canvas.current.style.cursor = 'default';
  }

  // Molette : échelle. Écouteur non passif pour pouvoir empêcher le défilement de la page.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !interactive) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      emit({ ...transform, scale: transform.scale * Math.exp(-e.deltaY * 0.0015) });
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [interactive, transform, emit]);

  function onKeyDown(e: KeyboardEvent) {
    if (!interactive) return;
    const step = e.shiftKey ? 0.05 : 0.005;
    const t = transform;
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
      emit(next);
    }
  }

  const loading = bg.loading || fg.loading;
  const loadError = bg.error || fg.error;

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
              ? `${label}. Position ${Math.round(transform.x * 100)} %, ${Math.round(transform.y * 100)} % ; hauteur ${Math.round(transform.scale * 100)} % du cadre. Flèches : déplacer ; plus et moins : échelle ; crochets : rotation ; Maj pour des pas plus grands.`
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
        {loading && <span className="stage-status" role="status">Chargement de l’image…</span>}
        {loadError && <span className="stage-status stage-error" role="alert">{loadError}</span>}
        {!foreground && !loading && <span className="stage-status">Choisis une photographie de la sculpture.</span>}
      </div>
    </div>
  );
}
