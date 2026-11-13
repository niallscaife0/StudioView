import type { Transform2D, VariantDraft } from './types';

export const SCALE_MIN = 0.05;
export const SCALE_MAX = 2;

export const DEFAULT_TRANSFORM: Transform2D = {
  schemaVersion: 1,
  x: 0.5,
  y: 0.55,
  scale: 0.6,
  rotationDeg: 0,
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Garde les valeurs dans des bornes raisonnables ; la sculpture peut déborder un peu du cadre. */
export function clampTransform(t: Transform2D): Transform2D {
  let rot = ((t.rotationDeg % 360) + 360) % 360;
  if (rot > 180) rot -= 360;
  return {
    schemaVersion: 1,
    x: clamp(t.x, -0.25, 1.25),
    y: clamp(t.y, -0.25, 1.25),
    scale: clamp(t.scale, SCALE_MIN, SCALE_MAX),
    rotationDeg: Math.round(rot * 10) / 10,
  };
}

/** Lecture défensive d'un JSON stocké. Un contenu invalide revient aux valeurs par défaut. */
export function parseTransform(raw: unknown): Transform2D {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_TRANSFORM };
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  if (r.schemaVersion !== undefined && r.schemaVersion !== 1) {
    throw new Error(`Version de transformation non prise en charge : ${String(r.schemaVersion)}`);
  }
  return clampTransform({
    schemaVersion: 1,
    x: num(r.x, DEFAULT_TRANSFORM.x),
    y: num(r.y, DEFAULT_TRANSFORM.y),
    scale: num(r.scale, DEFAULT_TRANSFORM.scale),
    rotationDeg: num(r.rotationDeg, DEFAULT_TRANSFORM.rotationDeg),
  });
}

export function sameDraft(a: VariantDraft, b: VariantDraft): boolean {
  return (
    a.backgroundAssetId === b.backgroundAssetId &&
    a.foregroundAssetId === b.foregroundAssetId &&
    a.transform.x === b.transform.x &&
    a.transform.y === b.transform.y &&
    a.transform.scale === b.transform.scale &&
    a.transform.rotationDeg === b.transform.rotationDeg
  );
}
