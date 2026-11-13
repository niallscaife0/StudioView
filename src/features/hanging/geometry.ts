import type { Artwork, Asset, Placement, Room } from '../../domain/types';

/** Géométrie de la salle 2,5D — module pur, sans Three.js ni React. Unité : centimètre. */

export const EYE_HEIGHT_DEFAULT = 160;
export const SILHOUETTE_HEIGHT_DEFAULT = 170;
export const BODY_RADIUS = 25;
export const WALK_SPEED = 120; // cm/s
export const ROOM_LIMITS = { min: 100, max: 10000 };
export const HEIGHT_LIMITS = { min: 1, max: 2000 };
export const MAX_PLACEMENTS = 40;

export const ROOM_DEFAULTS = { lengthCm: 800, widthCm: 600, heightCm: 350, wallColor: '#f1f0ec', floorColor: '#b9b4a9', light: 'bright' as const };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function clampRoom<T extends { lengthCm: number; widthCm: number; heightCm: number }>(r: T): T {
  return {
    ...r,
    lengthCm: Math.round(clamp(r.lengthCm || ROOM_DEFAULTS.lengthCm, ROOM_LIMITS.min, ROOM_LIMITS.max)),
    widthCm: Math.round(clamp(r.widthCm || ROOM_DEFAULTS.widthCm, ROOM_LIMITS.min, ROOM_LIMITS.max)),
    heightCm: Math.round(clamp(r.heightCm || ROOM_DEFAULTS.heightCm, ROOM_LIMITS.min, 2000)),
  };
}

export function isHexColor(s: unknown): s is string {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}

/** Hauteur valide ou null. Accepte une saisie texte avec virgule. */
export function parseHeightCm(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.replace(',', '.')) : NaN;
  if (!Number.isFinite(n) || n < HEIGHT_LIMITS.min || n > HEIGHT_LIMITS.max) return null;
  return Math.round(n * 10) / 10;
}

/** Garde un point à l'intérieur de la salle, à `margin` cm des murs. */
export function clampToRoom(x: number, z: number, room: Pick<Room, 'lengthCm' | 'widthCm'>, margin = 0) {
  return {
    x: clamp(x, margin, Math.max(margin, room.lengthCm - margin)),
    z: clamp(z, margin, Math.max(margin, room.widthCm - margin)),
  };
}

/**
 * Dimensions du panneau : la hauteur est la hauteur DÉCLARÉE de l'œuvre ; la largeur suit les
 * proportions de la photo. Sans hauteur déclarée, l'œuvre ne peut pas être placée (null).
 */
export function panelSizeCm(artwork: Pick<Artwork, 'heightCm'>, asset: Pick<Asset, 'width' | 'height'> | null) {
  if (!artwork.heightCm) return null;
  const aspect = asset && asset.height > 0 ? asset.width / asset.height : 0.5;
  return { heightCm: artwork.heightCm, widthCm: artwork.heightCm * aspect };
}

/** Photo utilisée pour un placement : celle choisie, sinon la première détourée, sinon la première photo. */
export function assetForPlacement(p: Pick<Placement, 'assetId' | 'artworkId'>, assets: Asset[]): Asset | null {
  const own = assets.filter((a) => a.artworkId === p.artworkId && (a.kind === 'cutout' || a.kind === 'photo'));
  return own.find((a) => a.id === p.assetId) ?? own.find((a) => a.kind === 'cutout') ?? own[0] ?? null;
}

export function normalizeDeg(d: number): number {
  let r = ((d % 360) + 360) % 360;
  if (r > 180) r -= 360;
  return Math.round(r * 10) / 10;
}

export function clampPlacement(p: Placement, room: Pick<Room, 'lengthCm' | 'widthCm' | 'heightCm'>): Placement {
  const c = clampToRoom(p.xCm, p.zCm, room, 5);
  return {
    ...p,
    xCm: Math.round(c.x),
    zCm: Math.round(c.z),
    rotationDeg: normalizeDeg(p.rotationDeg),
    elevationCm: Math.round(clamp(p.elevationCm || 0, 0, room.heightCm)),
  };
}

/** Nouveau placement : au centre, décalé à chaque ajout pour ne pas superposer les pièces. */
export function newPlacement(artworkId: string, room: Pick<Room, 'lengthCm' | 'widthCm' | 'heightCm'>, count: number): Placement {
  const step = 120;
  const offset = (Math.floor((count + 1) / 2) * step) * (count % 2 === 0 ? 1 : -1);
  return clampPlacement(
    { id: crypto.randomUUID(), artworkId, assetId: null, xCm: room.lengthCm / 2 + offset, zCm: room.widthCm / 2, rotationDeg: 0, elevationCm: 0 },
    room,
  );
}

/** Lecture défensive d'une liste de placements stockée. */
export function parsePlacements(raw: unknown): Placement[] {
  if (!Array.isArray(raw)) return [];
  const out: Placement[] = [];
  const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.artworkId !== 'string') continue;
    out.push({
      id: typeof o.id === 'string' ? o.id : crypto.randomUUID(),
      artworkId: o.artworkId,
      assetId: typeof o.assetId === 'string' ? o.assetId : null,
      xCm: num(o.xCm),
      zCm: num(o.zCm),
      rotationDeg: normalizeDeg(num(o.rotationDeg)),
      elevationCm: Math.max(0, num(o.elevationCm)),
    });
  }
  return out.slice(0, MAX_PLACEMENTS);
}

export function samePlacements(a: Placement[], b: Placement[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => {
      const q = b[i];
      return p.id === q.id && p.artworkId === q.artworkId && p.assetId === q.assetId && p.xCm === q.xCm && p.zCm === q.zCm && p.rotationDeg === q.rotationDeg && p.elevationCm === q.elevationCm;
    })
  );
}

export interface CameraPose {
  xCm: number;
  zCm: number;
  /** Lacet en radians : 0 = regard vers +z ; positif = vers +x. */
  yaw: number;
  /** Tangage en radians, borné. */
  pitch: number;
  eyeCm: number;
}

/** Pose d'entrée : au milieu du mur z = 0, à 60 cm de celui-ci, regard vers le fond de la salle. */
export function entrancePose(room: Pick<Room, 'lengthCm' | 'widthCm'>, eyeCm = EYE_HEIGHT_DEFAULT): CameraPose {
  return { xCm: room.lengthCm / 2, zCm: Math.min(60, room.widthCm / 2), yaw: 0, pitch: -0.1, eyeCm };
}

/**
 * Déplacement à la première personne. forward / strafe dans [-1, 1].
 * Le visiteur ne traverse pas les murs (cylindre de rayon BODY_RADIUS).
 */
export function walk(pose: CameraPose, forward: number, strafe: number, dtSeconds: number, room: Pick<Room, 'lengthCm' | 'widthCm'>, fast = false): CameraPose {
  const len = Math.hypot(forward, strafe);
  if (len === 0) return pose;
  const speed = WALK_SPEED * (fast ? 2 : 1) * Math.min(1, len);
  const f = forward / len;
  const s = strafe / len;
  // Avant = (sin yaw, cos yaw). Avec y vers le haut et le regard vers +z, la droite du visiteur est -x.
  const dx = (Math.sin(pose.yaw) * f - Math.cos(pose.yaw) * s) * speed * dtSeconds;
  const dz = (Math.cos(pose.yaw) * f + Math.sin(pose.yaw) * s) * speed * dtSeconds;
  const c = clampToRoom(pose.xCm + dx, pose.zCm + dz, room, BODY_RADIUS);
  return { ...pose, xCm: c.x, zCm: c.z };
}

export function look(pose: CameraPose, dYaw: number, dPitch: number): CameraPose {
  const limit = Math.PI / 2 - 0.15;
  return { ...pose, yaw: pose.yaw + dYaw, pitch: clamp(pose.pitch + dPitch, -limit, limit) };
}

/** Distances utiles en vue en plan : aux quatre murs. */
export function wallDistances(p: Pick<Placement, 'xCm' | 'zCm'>, room: Pick<Room, 'lengthCm' | 'widthCm'>) {
  return { left: Math.round(p.xCm), right: Math.round(room.lengthCm - p.xCm), front: Math.round(p.zCm), back: Math.round(room.widthCm - p.zCm) };
}

export function distanceCm(a: Pick<Placement, 'xCm' | 'zCm'>, b: Pick<Placement, 'xCm' | 'zCm'>): number {
  return Math.round(Math.hypot(a.xCm - b.xCm, a.zCm - b.zCm));
}

export function formatCm(cm: number): string {
  return cm >= 100 ? `${(cm / 100).toFixed(2).replace('.', ',')} m` : `${Math.round(cm)} cm`;
}
