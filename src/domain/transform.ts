import type { Transform2D, VariantDraft, VariantItem } from './types';

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

export function sameTransform(a: Transform2D, b: Transform2D): boolean {
  return a.x === b.x && a.y === b.y && a.scale === b.scale && a.rotationDeg === b.rotationDeg;
}

export function sameItem(a: VariantItem, b: VariantItem): boolean {
  return (
    a.id === b.id &&
    a.assetId === b.assetId &&
    a.name === b.name &&
    a.hidden === b.hidden &&
    a.locked === b.locked &&
    sameTransform(a.transform, b.transform)
  );
}

/** Deux états sont identiques si le décor, l'ordre des éléments et chaque élément le sont. */
export function sameDraft(a: VariantDraft, b: VariantDraft): boolean {
  if (a.backgroundAssetId !== b.backgroundAssetId || a.items.length !== b.items.length) return false;
  return a.items.every((it, i) => sameItem(it, b.items[i]));
}

export const MAX_ITEMS = 30;

/** Nouvel élément, légèrement décalé à chaque ajout pour ne pas recouvrir exactement le précédent. */
export function newItem(assetId: string, existingCount: number): VariantItem {
  const shift = (existingCount % 6) * 0.04;
  return {
    id: crypto.randomUUID(),
    assetId,
    name: null,
    transform: clampTransform({ ...DEFAULT_TRANSFORM, x: DEFAULT_TRANSFORM.x + shift, y: DEFAULT_TRANSFORM.y }),
    hidden: false,
    locked: false,
  };
}

/** Lecture défensive d'une liste d'éléments stockée (JSON). */
export function parseItems(raw: unknown): VariantItem[] {
  if (!Array.isArray(raw)) return [];
  const out: VariantItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.assetId !== 'string') continue;
    out.push({
      id: typeof o.id === 'string' ? o.id : crypto.randomUUID(),
      assetId: o.assetId,
      name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 200) : null,
      transform: parseTransform(o.transform),
      hidden: o.hidden === true,
      locked: o.locked === true,
    });
  }
  return out.slice(0, MAX_ITEMS);
}

/**
 * Reprise V1 → V2 (F-27) : une variante V1 portait une seule photo (foregroundAssetId + transform).
 * Elle devient une variante à un élément, visuellement identique.
 */
export function upgradeLegacyVariant<T extends Record<string, unknown>>(raw: T): { items: VariantItem[]; changed: boolean } {
  if (Array.isArray(raw.items)) return { items: parseItems(raw.items), changed: false };
  const fg = raw.foregroundAssetId;
  if (typeof fg !== 'string') return { items: [], changed: true };
  return {
    items: [{ id: crypto.randomUUID(), assetId: fg, name: null, transform: parseTransform(raw.transform), hidden: false, locked: false }],
    changed: true,
  };
}
