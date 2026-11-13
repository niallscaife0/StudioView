/**
 * Modèle de domaine. Indépendant de la persistance (IndexedDB ou Supabase).
 * owner_id n'apparaît pas côté client : il est imposé par la base (RLS + défaut auth.uid()).
 */

export type AssetKind = 'photo' | 'cutout' | 'background' | 'model3d';

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface Artwork {
  id: string;
  title: string;
  /** Hauteur réelle DÉCLARÉE par l'artiste, en centimètres. Jamais déduite d'une photo. */
  heightCm: number | null;
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

export type LightPreset = 'bright' | 'dark' | 'day';

/** Salle paramétrable (F-37). Dimensions intérieures en centimètres. */
export interface Room {
  id: string;
  title: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  wallColor: string;
  floorColor: string;
  light: LightPreset;
  createdAt: string;
  updatedAt: string;
}

/**
 * Présentation. mode '2d' : mise en situation photographique d'une œuvre (Studio).
 * mode 'room' : accrochage de plusieurs œuvres dans une salle (artworkId nul, roomId requis).
 */
export interface Presentation {
  id: string;
  mode: '2d' | 'room';
  artworkId: string | null;
  roomId: string | null;
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

/** Un élément posé sur le décor : une image avec sa propre transformation. */
export interface VariantItem {
  /** Identifiant stable, généré côté client (sert aussi de clé d'édition). */
  id: string;
  assetId: string;
  /** Nom facultatif ; à défaut, le titre de l'image est affiché. */
  name: string | null;
  transform: Transform2D;
  hidden: boolean;
  locked: boolean;
}

/**
 * Œuvre placée dans une salle (F-38). Repère : origine au coin de la salle, x le long de la
 * longueur, z le long de la largeur, en centimètres. rotationDeg : 0 = face tournée vers le mur d'entrée (z = 0).
 */
export interface Placement {
  id: string;
  artworkId: string;
  /** Photographie utilisée comme panneau ; null : première photo disponible de l'œuvre. */
  assetId: string | null;
  xCm: number;
  zCm: number;
  rotationDeg: number;
  /** Hauteur de la base au-dessus du sol (0 = posée au sol). */
  elevationCm: number;
}

/**
 * Variante 2D (V2) : un décor facultatif et une LISTE d'éléments.
 * L'ordre du tableau est l'ordre de superposition : index 0 au fond, dernier au premier plan.
 */
export interface Variant {
  id: string;
  presentationId: string;
  name: string;
  backgroundAssetId: string | null;
  items: VariantItem[];
  /** Accrochage (présentations de mode 'room') ; vide pour une variante 2D. */
  placements: Placement[];
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Ce que l'utilisateur modifie dans le Studio (l'état « éditable » d'une variante). */
export interface VariantDraft {
  backgroundAssetId: string | null;
  items: VariantItem[];
}
