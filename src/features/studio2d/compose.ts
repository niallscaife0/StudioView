import type { Transform2D } from '../../domain/types';

/**
 * Composition 2D — module pur, sans React.
 * La même fonction dessine l'aperçu du Studio, la comparaison et l'export PNG (et, en P1, les rendus publiés).
 *
 * Espace de composition : le cadre a les proportions du décor (16:9 sans décor).
 * Coordonnées normalisées : voir Transform2D.
 */

export interface Size {
  w: number;
  h: number;
}

export const NO_BACKGROUND_ASPECT = 16 / 9;
export const EMPTY_FRAME_COLOR = '#8d918f';

export function frameAspect(bg: Size | null): number {
  if (!bg || bg.w <= 0 || bg.h <= 0) return NO_BACKGROUND_ASPECT;
  return bg.w / bg.h;
}

/** Dimensions de sortie pour une largeur donnée, arrondies au pixel. */
export function outputSize(width: number, aspect: number): Size {
  return { w: Math.round(width), h: Math.max(1, Math.round(width / aspect)) };
}

export interface ForegroundRect {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotationRad: number;
}

/** Rectangle de la sculpture dans un cadre de taille donnée (pixels). Proportions de la photo toujours conservées. */
export function foregroundRect(frame: Size, fg: Size, t: Transform2D): ForegroundRect {
  const h = t.scale * frame.h;
  const w = fg.h > 0 ? (h * fg.w) / fg.h : h;
  return { cx: t.x * frame.w, cy: t.y * frame.h, w, h, rotationRad: (t.rotationDeg * Math.PI) / 180 };
}

/** Point exprimé dans le repère local (non tourné) du rectangle, origine au centre. */
export function toLocal(px: number, py: number, r: ForegroundRect) {
  const dx = px - r.cx;
  const dy = py - r.cy;
  const c = Math.cos(-r.rotationRad);
  const s = Math.sin(-r.rotationRad);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

export function hitForeground(px: number, py: number, r: ForegroundRect, margin = 0): boolean {
  const p = toLocal(px, py, r);
  return Math.abs(p.x) <= r.w / 2 + margin && Math.abs(p.y) <= r.h / 2 + margin;
}

/** Poignée de redimensionnement : coin bas-droit du rectangle, en coordonnées cadre. */
export function handlePosition(r: ForegroundRect) {
  const lx = r.w / 2;
  const ly = r.h / 2;
  const c = Math.cos(r.rotationRad);
  const s = Math.sin(r.rotationRad);
  return { x: r.cx + lx * c - ly * s, y: r.cy + lx * s + ly * c };
}

export function hitHandle(px: number, py: number, r: ForegroundRect, radius: number): boolean {
  const h = handlePosition(r);
  return Math.hypot(px - h.x, py - h.y) <= radius;
}

/** Carte d'opacité réduite d'une image, pour la sélection au pixel près. */
export interface AlphaMask {
  w: number;
  h: number;
  data: Uint8Array;
}

/** Opacité (0..255) au point local (origine au centre du rectangle non tourné). Sans carte : opaque. */
export function alphaAtLocal(mask: AlphaMask | null | undefined, lx: number, ly: number, r: ForegroundRect): number {
  if (!mask) return 255;
  const u = lx / r.w + 0.5;
  const v = ly / r.h + 0.5;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
  return mask.data[Math.min(mask.h - 1, Math.floor(v * mask.h)) * mask.w + Math.min(mask.w - 1, Math.floor(u * mask.w))];
}

export interface PickCandidate {
  size: Size;
  transform: Transform2D;
  hidden: boolean;
  locked: boolean;
  alpha?: AlphaMask | null;
}

/**
 * Élément visé par un clic : le plus haut dans la pile dont le pixel n'est pas transparent.
 * Les éléments masqués ou verrouillés sont traversés. Retourne l'index dans la liste, ou -1.
 */
export function pickItem(px: number, py: number, frame: Size, items: PickCandidate[], alphaThreshold = 26): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.hidden || it.locked) continue;
    const r = foregroundRect(frame, it.size, it.transform);
    if (!hitForeground(px, py, r)) continue;
    const l = toLocal(px, py, r);
    if (alphaAtLocal(it.alpha, l.x, l.y, r) >= alphaThreshold) return i;
  }
  return -1;
}

export interface DrawItem {
  image: CanvasImageSource | null;
  size: Size;
  transform: Transform2D;
  hidden?: boolean;
}

export interface DrawInput {
  background: CanvasImageSource | null;
  /** Du fond vers le premier plan. */
  items: DrawItem[];
}

export interface DrawOptions {
  /** Inscrit « Simulation 2D » dans l'angle (rappel que ce n'est pas une photographie documentaire). */
  label?: boolean;
  /** Contour et poignée sur l'élément sélectionné (aperçu interactif seulement, jamais à l'export). */
  selection?: { index: number; color: string; handleRadius: number } | null;
}

export function drawComposition(ctx: CanvasRenderingContext2D, frame: Size, input: DrawInput, opts: DrawOptions = {}) {
  ctx.save();
  ctx.clearRect(0, 0, frame.w, frame.h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (input.background) {
    ctx.drawImage(input.background, 0, 0, frame.w, frame.h);
  } else {
    ctx.fillStyle = EMPTY_FRAME_COLOR;
    ctx.fillRect(0, 0, frame.w, frame.h);
  }

  for (const item of input.items) {
    if (item.hidden || !item.image) continue;
    const r = foregroundRect(frame, item.size, item.transform);
    ctx.save();
    ctx.translate(r.cx, r.cy);
    ctx.rotate(r.rotationRad);
    ctx.drawImage(item.image, -r.w / 2, -r.h / 2, r.w, r.h);
    ctx.restore();
  }

  const sel = opts.selection ? input.items[opts.selection.index] : undefined;
  if (opts.selection && sel && !sel.hidden) {
    const r = foregroundRect(frame, sel.size, sel.transform);
    ctx.save();
    ctx.translate(r.cx, r.cy);
    ctx.rotate(r.rotationRad);
    ctx.strokeStyle = opts.selection.color;
    ctx.lineWidth = Math.max(1.5, frame.w / 700);
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h);
    ctx.restore();
    const hp = handlePosition(r);
    const hr = opts.selection.handleRadius;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = opts.selection.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(hp.x - hr / 2, hp.y - hr / 2, hr, hr);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  if (opts.label) {
    const size = Math.max(11, Math.round(frame.w / 90));
    ctx.font = `500 ${size}px "Archivo Variable", system-ui, sans-serif`;
    const text = 'Simulation 2D';
    const pad = Math.round(size * 0.6);
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(frame.w - tw - pad * 3, frame.h - size - pad * 3, tw + pad * 2, size + pad * 1.6);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    ctx.fillText(text, frame.w - tw - pad * 2, frame.h - size - pad * 2.2);
  }
  ctx.restore();
}

/** Rendu hors écran à la taille demandée → Blob PNG. Mêmes paramètres que l'aperçu. */
export async function renderComposition(input: DrawInput, backgroundSize: Size | null, width: number, label: boolean): Promise<Blob> {
  const size = outputSize(width, frameAspect(backgroundSize));
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible dans ce navigateur.');
  drawComposition(ctx, size, input, { label });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Export impossible : image trop grande pour la mémoire de cet appareil. Choisis une largeur plus petite.'))),
      'image/png',
    ),
  );
}
