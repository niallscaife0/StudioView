import type { Artwork, Asset, AssetKind, ImageMime, Presentation, Variant, VariantItem } from '../domain/types';

export interface NewAssetInput {
  artworkId: string | null;
  kind: AssetKind;
  title: string;
  mimeType: ImageMime;
  width: number;
  height: number;
  transparency: boolean | null;
  original: Blob;
  thumbnail: Blob;
}

export interface NewVariantInput {
  presentationId: string;
  name: string;
  backgroundAssetId: string | null;
  items: VariantItem[];
  note?: string | null;
}

/** `items`, s'il est fourni, REMPLACE toute la liste (ordre compris), de façon atomique. */
export type VariantPatch = Partial<Pick<Variant, 'name' | 'backgroundAssetId' | 'items' | 'note'>>;

export type AssetPatch = Partial<Pick<Asset, 'title' | 'artworkId' | 'kind'>>;

/** Couche de persistance. L'interface ne connaît ni IndexedDB ni Supabase. */
export interface Repository {
  readonly mode: 'local' | 'supabase';

  listArtworks(): Promise<Artwork[]>;
  getArtwork(id: string): Promise<Artwork | null>;
  createArtwork(title: string): Promise<Artwork>;
  renameArtwork(id: string, title: string): Promise<Artwork>;
  /** Supprime l'œuvre, ses présentations et variantes. Les photos restent dans Ressources, sans œuvre. */
  deleteArtwork(id: string): Promise<void>;

  listAssets(): Promise<Asset[]>;
  getAsset(id: string): Promise<Asset | null>;
  createAsset(input: NewAssetInput): Promise<Asset>;
  updateAsset(id: string, patch: AssetPatch): Promise<Asset>;
  /** Refuse (AssetInUseError) si l'image est utilisée, sauf withDependentVariants. */
  deleteAsset(id: string, opts?: { withDependentVariants?: boolean }): Promise<void>;
  getAssetBlob(asset: Asset, which: 'original' | 'thumbnail'): Promise<Blob>;

  listPresentations(): Promise<Presentation[]>;
  getPresentation(id: string): Promise<Presentation | null>;
  createPresentation(artworkId: string, title: string): Promise<Presentation>;
  renamePresentation(id: string, title: string): Promise<Presentation>;
  deletePresentation(id: string): Promise<void>;

  listVariants(): Promise<Variant[]>;
  getVariant(id: string): Promise<Variant | null>;
  createVariant(input: NewVariantInput): Promise<Variant>;
  updateVariant(id: string, patch: VariantPatch): Promise<Variant>;
  deleteVariant(id: string): Promise<void>;
}

export class AssetInUseError extends Error {
  constructor(public readonly variants: Variant[]) {
    super(`Cette image est utilisée dans ${variants.length} variante(s).`);
    this.name = 'AssetInUseError';
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} introuvable, ou accès non autorisé.`);
    this.name = 'NotFoundError';
  }
}

/** Erreur réseau ou serveur : l'opération peut être retentée sans perte. */
export class SyncError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'SyncError';
  }
}

export function variantsUsingAsset(variants: Variant[], assetId: string): Variant[] {
  return variants.filter((v) => v.backgroundAssetId === assetId || v.items.some((i) => i.assetId === assetId));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function cleanTitle(title: string, fallback: string): string {
  const t = title.trim().replace(/\s+/g, ' ').slice(0, 200);
  return t || fallback;
}
