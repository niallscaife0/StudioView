import type { Artwork, Asset, AssetKind, ImageMime, Presentation, Variant } from '../../domain/types';
import { parseTransform } from '../../domain/transform';

export interface ArtworkRow { id: string; title: string; created_at: string; updated_at: string }
export interface AssetRow {
  id: string; artwork_id: string | null; kind: AssetKind; storage_path: string; thumb_path: string;
  mime_type: string; bytes: number; width: number | null; height: number | null;
  transparency: boolean | null; title: string; created_at: string;
}
export interface PresentationRow { id: string; artwork_id: string; title: string; created_at: string; updated_at: string }
export interface VariantRow {
  id: string; presentation_id: string; name: string; background_asset_id: string | null;
  foreground_asset_id: string | null; transform: unknown; note: string | null; created_at: string; updated_at: string;
}

export const ARTWORK_COLS = 'id,title,created_at,updated_at';
export const ASSET_COLS = 'id,artwork_id,kind,storage_path,thumb_path,mime_type,bytes,width,height,transparency,title,created_at';
export const PRESENTATION_COLS = 'id,artwork_id,title,created_at,updated_at';
export const VARIANT_COLS = 'id,presentation_id,name,background_asset_id,foreground_asset_id,transform,note,created_at,updated_at';

export const toArtwork = (r: ArtworkRow): Artwork => ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at });

export const toAsset = (r: AssetRow): Asset & { storagePath: string; thumbPath: string } => ({
  id: r.id,
  artworkId: r.artwork_id,
  kind: r.kind,
  mimeType: r.mime_type as ImageMime,
  bytes: Number(r.bytes),
  width: r.width ?? 0,
  height: r.height ?? 0,
  transparency: r.transparency,
  title: r.title,
  createdAt: r.created_at,
  storagePath: r.storage_path,
  thumbPath: r.thumb_path,
});

export const toPresentation = (r: PresentationRow): Presentation => ({
  id: r.id, artworkId: r.artwork_id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at,
});

export const toVariant = (r: VariantRow): Variant => ({
  id: r.id,
  presentationId: r.presentation_id,
  name: r.name,
  backgroundAssetId: r.background_asset_id,
  foregroundAssetId: r.foreground_asset_id,
  transform: parseTransform(r.transform),
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function extensionFor(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

/** Chemin non devinable : owner_id/asset_id/<nom>. Doit respecter la contrainte SQL. */
export function storagePaths(ownerId: string, assetId: string, originalMime: string, thumbMime: string) {
  return {
    original: `${ownerId}/${assetId}/original.${extensionFor(originalMime)}`,
    thumbnail: `${ownerId}/${assetId}/thumb.${extensionFor(thumbMime)}`,
  };
}
