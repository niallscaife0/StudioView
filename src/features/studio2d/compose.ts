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

export interface DrawInput {
  background: CanvasImageSource | null;
  foreground: CanvasImageSource | null;
  foregroundSize: Size | null;
  transform: Transform2D;
}

export interface DrawOptions {
  /** Inscrit « Simulation 2D » dans l'angle (rappel que ce n'est pas une photographie documentaire). */
  label?: boolean;
  /** Contour et poignée de manipulation (aperçu interactif seulement, jamais à l'export). */
  selection?: { color: string; handleRadius: number } | null;
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

  if (input.foreground && input.foregroundSize) {
    const r = foregroundRect(frame, input.foregroundSize, input.transform);
    ctx.save();
    ctx.translate(r.cx, r.cy);
    ctx.rotate(r.rotationRad);
    ctx.drawImage(input.foreground, -r.w / 2, -r.h / 2, r.w, r.h);
    if (opts.selection) {
      ctx.strokeStyle = opts.selection.color;
      ctx.lineWidth = Math.max(1, frame.w / 900);
      ctx.setLineDash([6, 5]);
      ctx.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h);
    }
    ctx.restore();
    if (opts.selection) {
      const hp = handlePosition(r);
      ctx.save();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = opts.selection.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(hp.x - opts.selection.handleRadius / 2, hp.y - opts.selection.handleRadius / 2, opts.selection.handleRadius, opts.selection.handleRadius);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
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
