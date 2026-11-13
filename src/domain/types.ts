/**
 * Modèle de domaine. Indépendant de la persistance (IndexedDB ou Supabase).
 * owner_id n'apparaît pas côté client : il est imposé par la base (RLS + défaut auth.uid()).
 */

export type AssetKind = 'photo' | 'cutout' | 'background' | 'model3d';

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface Artwork {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Asset {
  id: string;
  /** Œuvre associée ; null pour un décor ou une photo pas encore rattachée. */
  artworkId: string | null;
  kind: AssetKind;
  mimeType: ImageMime;
  bytes: number;
  width: number;
  height: number;
  /** true : transparence réelle mesurée ; false : fond opaque ; null : inconnu. */
  transparency: boolean | null;
  title: string;
  createdAt: string;
}

export interface Presentation {
  id: string;
  artworkId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Transformation 2D, schemaVersion 1.
 * - x, y : centre de la sculpture, normalisé à la composition (0 = gauche/haut, 1 = droite/bas).
 * - scale : hauteur de la sculpture rapportée à la hauteur de la composition (0.6 = 60 %).
 * - rotationDeg : rotation dans le plan, en degrés, sens horaire.
 * Valeurs relatives et approximatives : elles ne disent rien de la taille physique.
 * Ne pas réutiliser cette structure pour des coordonnées 3D (V2).
 */
export interface Transform2D {
  schemaVersion: 1;
  x: number;
  y: number;
  scale: number;
  rotationDeg: number;
}

export interface Variant {
  id: string;
  presentationId: string;
  name: string;
  backgroundAssetId: string | null;
  foregroundAssetId: string | null;
  transform: Transform2D;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Ce que l'utilisateur modifie dans le Studio (l'état « éditable » d'une variante). */
export interface VariantDraft {
  backgroundAssetId: string | null;
  foregroundAssetId: string | null;
  transform: Transform2D;
}
