import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import type { Asset } from '../../domain/types';
import {
  AssetInUseError,
  NotFoundError,
  SyncError,
  cleanTitle,
  variantsUsingAsset,
  type AssetPatch,
  type NewAssetInput,
  type NewVariantInput,
  type Repository,
  type VariantPatch,
} from '../repository';
import {
  ARTWORK_COLS, ASSET_COLS, PRESENTATION_COLS, VARIANT_COLS,
  itemsToRpc, storagePaths, toArtwork, toAsset, toPresentation, toVariant,
  type ArtworkRow, type AssetRow, type PresentationRow, type VariantRow,
} from './mapping';

type StoredAsset = Asset & { storagePath: string; thumbPath: string };

function fail(err: PostgrestError | Error | null, what: string): never {
  const msg = err?.message ?? 'erreur inconnue';
  if (err && 'code' in err && err.code === 'PGRST116') throw new NotFoundError(what);
  if (/fetch|network|Failed to fetch|NetworkError/i.test(msg)) {
    throw new SyncError('Connexion au serveur impossible. Tes modifications restent à l’écran ; réessaie.', err);
  }
  if (err && 'code' in err && err.code === '42501') throw new NotFoundError(what);
  throw new SyncError(`${what} : ${msg}`, err);
}

/**
 * Persistance hébergée : Supabase Postgres + Storage privé.
 * Toutes les vérifications d'accès sont faites côté serveur (RLS, contraintes de propriété).
 */
export class SupabaseRepository implements Repository {
  readonly mode = 'supabase' as const;
  private assetCache = new Map<string, StoredAsset>();

  constructor(private sb: SupabaseClient, private bucket: string) {}

  private async uid(): Promise<string> {
    const { data, error } = await this.sb.auth.getUser();
    if (error || !data.user) throw new SyncError('Session expirée. Reconnecte-toi.', error);
    return data.user.id;
  }

  async listArtworks() {
    const { data, error } = await this.sb.from('artworks').select(ARTWORK_COLS).order('created_at');
    if (error) fail(error, 'Œuvres');
    return (data as ArtworkRow[]).map(toArtwork);
  }

  async getArtwork(id: string) {
    const { data, error } = await this.sb.from('artworks').select(ARTWORK_COLS).eq('id', id).maybeSingle();
    if (error) fail(error, 'Œuvre');
    return data ? toArtwork(data as ArtworkRow) : null;
  }

  async createArtwork(title: string) {
    const { data, error } = await this.sb
      .from('artworks').insert({ title: cleanTitle(title, 'Sans titre') }).select(ARTWORK_COLS).single();
    if (error) fail(error, 'Création de l’œuvre');
    return toArtwork(data as ArtworkRow);
  }

  async renameArtwork(id: string, title: string) {
    const { data, error } = await this.sb
      .from('artworks').update({ title: cleanTitle(title, 'Sans titre') }).eq('id', id).select(ARTWORK_COLS).single();
    if (error) fail(error, 'Œuvre');
    return toArtwork(data as ArtworkRow);
  }

  async deleteArtwork(id: string) {
    // Cascade SQL : présentations et variantes ; les assets passent artwork_id = null.
    const { error } = await this.sb.from('artworks').delete().eq('id', id);
    if (error) fail(error, 'Suppression de l’œuvre');
  }

  async listAssets() {
    const { data, error } = await this.sb.from('assets').select(ASSET_COLS).order('created_at');
    if (error) fail(error, 'Images');
    const assets = (data as AssetRow[]).map(toAsset);
    for (const a of assets) this.assetCache.set(a.id, a);
    return assets;
  }

  async getAsset(id: string) {
    const { data, error } = await this.sb.from('assets').select(ASSET_COLS).eq('id', id).maybeSingle();
    if (error) fail(error, 'Image');
    if (!data) return null;
    const a = toAsset(data as AssetRow);
    this.assetCache.set(a.id, a);
    return a;
  }

  async createAsset(input: NewAssetInput) {
    const ownerId = await this.uid();
    const id = crypto.randomUUID();
    const paths = storagePaths(ownerId, id, input.mimeType, input.thumbnail.type || 'image/png');
    const store = this.sb.storage.from(this.bucket);

    const up1 = await store.upload(paths.original, input.original, { contentType: input.mimeType, upsert: false });
    if (up1.error) fail(up1.error, 'Envoi de l’image');
    const up2 = await store.upload(paths.thumbnail, input.thumbnail, {
      contentType: input.thumbnail.type || 'image/png', upsert: false,
    });
    if (up2.error) {
      await store.remove([paths.original]);
      fail(up2.error, 'Envoi de la miniature');
    }

    const { data, error } = await this.sb
      .from('assets')
      .insert({
        id,
        artwork_id: input.artworkId,
        kind: input.kind,
        storage_path: paths.original,
        thumb_path: paths.thumbnail,
        mime_type: input.mimeType,
        bytes: input.original.size,
        width: input.width,
        height: input.height,
        transparency: input.transparency,
        title: cleanTitle(input.title, 'Image'),
      })
      .select(ASSET_COLS)
      .single();
    if (error) {
      // Nettoyage des fichiers orphelins : la métadonnée n'a pas pu être écrite.
      await store.remove([paths.original, paths.thumbnail]);
      fail(error, 'Enregistrement de l’image');
    }
    const a = toAsset(data as AssetRow);
    this.assetCache.set(a.id, a);
    return a;
  }

  async updateAsset(id: string, patch: AssetPatch) {
    const row: Record<string, unknown> = {};
    if (patch.title !== undefined) row.title = cleanTitle(patch.title, 'Image');
    if (patch.artworkId !== undefined) row.artwork_id = patch.artworkId;
    if (patch.kind !== undefined) row.kind = patch.kind;
    const { data, error } = await this.sb.from('assets').update(row).eq('id', id).select(ASSET_COLS).single();
    if (error) fail(error, 'Image');
    const a = toAsset(data as AssetRow);
    this.assetCache.set(a.id, a);
    return a;
  }

  async deleteAsset(id: string, opts?: { withDependentVariants?: boolean }) {
    const asset = await this.storedAsset(id);
    const using = variantsUsingAsset(await this.listVariants(), id);
    if (using.length > 0 && !opts?.withDependentVariants) throw new AssetInUseError(using);
    if (using.length > 0) {
      const { error } = await this.sb.from('variants').delete().in('id', using.map((v) => v.id));
      if (error) fail(error, 'Suppression des variantes liées');
    }
    const { error } = await this.sb.from('assets').delete().eq('id', id);
    if (error) fail(error, 'Suppression de l’image');
    this.assetCache.delete(id);
    // Ligne supprimée d'abord : un échec ici laisse au pire un fichier orphelin, jamais une image cassée.
    const rm = await this.sb.storage.from(this.bucket).remove([asset.storagePath, asset.thumbPath]);
    if (rm.error) console.warn('Fichiers orphelins à nettoyer :', asset.storagePath, rm.error.message);
  }

  private async storedAsset(id: string): Promise<StoredAsset> {
    const cached = this.assetCache.get(id);
    if (cached) return cached;
    const a = await this.getAsset(id);
    if (!a) throw new NotFoundError('Image');
    return a as StoredAsset;
  }

  /** Téléchargement authentifié en Blob (D-05) : jamais d'URL publique ni signée dans le composeur. */
  async getAssetBlob(asset: Asset, which: 'original' | 'thumbnail') {
    const s = await this.storedAsset(asset.id);
    const { data, error } = await this.sb.storage.from(this.bucket).download(which === 'original' ? s.storagePath : s.thumbPath);
    if (error || !data) fail(error ?? new Error('fichier vide'), 'Téléchargement de l’image');
    return data;
  }

  async listPresentations() {
    const { data, error } = await this.sb.from('presentations').select(PRESENTATION_COLS).order('updated_at', { ascending: false });
    if (error) fail(error, 'Présentations');
    return (data as PresentationRow[]).map(toPresentation);
  }

  async getPresentation(id: string) {
    const { data, error } = await this.sb.from('presentations').select(PRESENTATION_COLS).eq('id', id).maybeSingle();
    if (error) fail(error, 'Présentation');
    return data ? toPresentation(data as PresentationRow) : null;
  }

  async createPresentation(artworkId: string, title: string) {
    const { data, error } = await this.sb
      .from('presentations').insert({ artwork_id: artworkId, title: cleanTitle(title, 'Présentation') })
      .select(PRESENTATION_COLS).single();
    if (error) fail(error, 'Création de la présentation');
    return toPresentation(data as PresentationRow);
  }

  async renamePresentation(id: string, title: string) {
    const { data, error } = await this.sb
      .from('presentations').update({ title: cleanTitle(title, 'Présentation') }).eq('id', id)
      .select(PRESENTATION_COLS).single();
    if (error) fail(error, 'Présentation');
    return toPresentation(data as PresentationRow);
  }

  async deletePresentation(id: string) {
    const { error } = await this.sb.from('presentations').delete().eq('id', id);
    if (error) fail(error, 'Suppression de la présentation');
  }

  async listVariants() {
    const { data, error } = await this.sb.from('variants').select(VARIANT_COLS).order('created_at');
    if (error) fail(error, 'Variantes');
    return (data as unknown as VariantRow[]).map(toVariant);
  }

  async getVariant(id: string) {
    const { data, error } = await this.sb.from('variants').select(VARIANT_COLS).eq('id', id).maybeSingle();
    if (error) fail(error, 'Variante');
    return data ? toVariant(data as unknown as VariantRow) : null;
  }

  async createVariant(input: NewVariantInput) {
    const { data, error } = await this.sb
      .from('variants')
      .insert({ presentation_id: input.presentationId, name: cleanTitle(input.name, 'Variante'), background_asset_id: input.backgroundAssetId })
      .select('id').single();
    if (error) fail(error, 'Création de la variante');
    const id = (data as { id: string }).id;
    const rpc = await this.sb.rpc('save_variant', {
      p_variant_id: id,
      p_background_asset_id: input.backgroundAssetId,
      p_note: input.note ?? null,
      p_items: itemsToRpc(input.items),
    });
    if (rpc.error) {
      // Pas de variante à moitié créée.
      await this.sb.from('variants').delete().eq('id', id);
      fail(rpc.error, 'Création de la variante');
    }
    return this.requireVariant(id);
  }

  private async requireVariant(id: string) {
    const v = await this.getVariant(id);
    if (!v) throw new NotFoundError('Variante');
    return v;
  }

  async updateVariant(id: string, patch: VariantPatch) {
    if (patch.name !== undefined) {
      const { error } = await this.sb.from('variants').update({ name: cleanTitle(patch.name, 'Variante') }).eq('id', id).select('id').single();
      if (error) fail(error, 'Enregistrement de la variante');
    }
    if (patch.items !== undefined || patch.backgroundAssetId !== undefined || patch.note !== undefined) {
      // Décor, note et éléments sont écrits ensemble, dans une seule transaction SQL.
      const current = await this.requireVariant(id);
      const { error } = await this.sb.rpc('save_variant', {
        p_variant_id: id,
        p_background_asset_id: patch.backgroundAssetId !== undefined ? patch.backgroundAssetId : current.backgroundAssetId,
        p_note: patch.note !== undefined ? patch.note : current.note,
        p_items: itemsToRpc(patch.items ?? current.items),
      });
      if (error) fail(error, 'Enregistrement de la variante');
    }
    return this.requireVariant(id);
  }

  async deleteVariant(id: string) {
    const { error } = await this.sb.from('variants').delete().eq('id', id);
    if (error) fail(error, 'Suppression de la variante');
  }
}
