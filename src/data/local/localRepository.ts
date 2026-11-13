import type { Artwork, Asset, Presentation, Variant } from '../../domain/types';
import { parseTransform } from '../../domain/transform';
import {
  AssetInUseError,
  NotFoundError,
  cleanTitle,
  nowIso,
  variantsUsingAsset,
  type AssetPatch,
  type NewAssetInput,
  type NewVariantInput,
  type Repository,
  type VariantPatch,
} from '../repository';
import { get, getAll, openDatabase, write, type WriteOp } from './idb';

interface StoredBlob {
  type: string;
  data: ArrayBuffer;
}

function readBytes(b: Blob): Promise<ArrayBuffer> {
  if (typeof b.arrayBuffer === 'function') return b.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error('Lecture du fichier impossible'));
    r.readAsArrayBuffer(b);
  });
}

async function toStored(b: Blob): Promise<StoredBlob> {
  return { type: b.type, data: await readBytes(b) };
}

const byUpdatedDesc = <T extends { updatedAt: string }>(a: T, b: T) => b.updatedAt.localeCompare(a.updatedAt);
const byCreatedAsc = <T extends { createdAt: string }>(a: T, b: T) => a.createdAt.localeCompare(b.createdAt);

/**
 * Persistance locale IndexedDB : mode démo et prototypage.
 * Local à ce navigateur, NON synchronisé, jamais présenté comme sauvegarde pérenne.
 */
export class LocalRepository implements Repository {
  readonly mode = 'local' as const;
  private dbPromise: Promise<IDBDatabase>;

  constructor(dbName = 'laboratoire-sculpture') {
    this.dbPromise = openDatabase(dbName);
  }

  private db() {
    return this.dbPromise;
  }

  async listArtworks() {
    return (await getAll<Artwork>(await this.db(), 'artworks')).sort(byCreatedAsc);
  }

  async getArtwork(id: string) {
    return get<Artwork>(await this.db(), 'artworks', id);
  }

  async createArtwork(title: string) {
    const now = nowIso();
    const a: Artwork = { id: crypto.randomUUID(), title: cleanTitle(title, 'Sans titre'), createdAt: now, updatedAt: now };
    await write(await this.db(), [{ type: 'put', store: 'artworks', key: a.id, value: a }]);
    return a;
  }

  async renameArtwork(id: string, title: string) {
    const db = await this.db();
    const a = await get<Artwork>(db, 'artworks', id);
    if (!a) throw new NotFoundError('Œuvre');
    const next = { ...a, title: cleanTitle(title, a.title), updatedAt: nowIso() };
    await write(db, [{ type: 'put', store: 'artworks', key: id, value: next }]);
    return next;
  }

  async deleteArtwork(id: string) {
    const db = await this.db();
    const [presentations, variants, assets] = await Promise.all([
      getAll<Presentation>(db, 'presentations'),
      getAll<Variant>(db, 'variants'),
      getAll<Asset>(db, 'assets'),
    ]);
    const presIds = new Set(presentations.filter((p) => p.artworkId === id).map((p) => p.id));
    const ops: WriteOp[] = [{ type: 'delete', store: 'artworks', key: id }];
    for (const p of presIds) ops.push({ type: 'delete', store: 'presentations', key: p });
    for (const v of variants) if (presIds.has(v.presentationId)) ops.push({ type: 'delete', store: 'variants', key: v.id });
    for (const a of assets)
      if (a.artworkId === id) ops.push({ type: 'put', store: 'assets', key: a.id, value: { ...a, artworkId: null } });
    await write(db, ops);
  }

  async listAssets() {
    return (await getAll<Asset>(await this.db(), 'assets')).sort(byCreatedAsc);
  }

  async getAsset(id: string) {
    return get<Asset>(await this.db(), 'assets', id);
  }

  async createAsset(input: NewAssetInput) {
    if (input.artworkId && !(await this.getArtwork(input.artworkId))) throw new NotFoundError('Œuvre');
    const asset: Asset = {
      id: crypto.randomUUID(),
      artworkId: input.artworkId,
      kind: input.kind,
      mimeType: input.mimeType,
      bytes: input.original.size,
      width: input.width,
      height: input.height,
      transparency: input.transparency,
      title: cleanTitle(input.title, 'Image'),
      createdAt: nowIso(),
    };
    // Octets bruts + type plutôt que Blob : clonage IndexedDB fiable dans tous les navigateurs.
    const [original, thumbnail] = await Promise.all([toStored(input.original), toStored(input.thumbnail)]);
    await write(await this.db(), [
      { type: 'put', store: 'assets', key: asset.id, value: asset },
      { type: 'put', store: 'blobs', key: `${asset.id}:original`, value: original },
      { type: 'put', store: 'blobs', key: `${asset.id}:thumbnail`, value: thumbnail },
    ]);
    return asset;
  }

  async updateAsset(id: string, patch: AssetPatch) {
    const db = await this.db();
    const a = await get<Asset>(db, 'assets', id);
    if (!a) throw new NotFoundError('Image');
    if (patch.artworkId && !(await this.getArtwork(patch.artworkId))) throw new NotFoundError('Œuvre');
    const next: Asset = {
      ...a,
      ...patch,
      title: patch.title !== undefined ? cleanTitle(patch.title, a.title) : a.title,
    };
    await write(db, [{ type: 'put', store: 'assets', key: id, value: next }]);
    return next;
  }

  async deleteAsset(id: string, opts?: { withDependentVariants?: boolean }) {
    const db = await this.db();
    const using = variantsUsingAsset(await getAll<Variant>(db, 'variants'), id);
    if (using.length > 0 && !opts?.withDependentVariants) throw new AssetInUseError(using);
    const ops: WriteOp[] = [
      { type: 'delete', store: 'assets', key: id },
      { type: 'delete', store: 'blobs', key: `${id}:original` },
      { type: 'delete', store: 'blobs', key: `${id}:thumbnail` },
    ];
    for (const v of using) ops.push({ type: 'delete', store: 'variants', key: v.id });
    await write(db, ops);
  }

  async getAssetBlob(asset: Asset, which: 'original' | 'thumbnail') {
    const b = await get<StoredBlob>(await this.db(), 'blobs', `${asset.id}:${which}`);
    if (!b) throw new NotFoundError('Fichier image');
    return new Blob([b.data], { type: b.type });
  }

  async listPresentations() {
    return (await getAll<Presentation>(await this.db(), 'presentations')).sort(byUpdatedDesc);
  }

  async getPresentation(id: string) {
    return get<Presentation>(await this.db(), 'presentations', id);
  }

  async createPresentation(artworkId: string, title: string) {
    if (!(await this.getArtwork(artworkId))) throw new NotFoundError('Œuvre');
    const now = nowIso();
    const p: Presentation = {
      id: crypto.randomUUID(),
      artworkId,
      title: cleanTitle(title, 'Présentation'),
      createdAt: now,
      updatedAt: now,
    };
    await write(await this.db(), [{ type: 'put', store: 'presentations', key: p.id, value: p }]);
    return p;
  }

  async renamePresentation(id: string, title: string) {
    const db = await this.db();
    const p = await get<Presentation>(db, 'presentations', id);
    if (!p) throw new NotFoundError('Présentation');
    const next = { ...p, title: cleanTitle(title, p.title), updatedAt: nowIso() };
    await write(db, [{ type: 'put', store: 'presentations', key: id, value: next }]);
    return next;
  }

  async deletePresentation(id: string) {
    const db = await this.db();
    const variants = await getAll<Variant>(db, 'variants');
    const ops: WriteOp[] = [{ type: 'delete', store: 'presentations', key: id }];
    for (const v of variants) if (v.presentationId === id) ops.push({ type: 'delete', store: 'variants', key: v.id });
    await write(db, ops);
  }

  async listVariants() {
    return (await getAll<Variant>(await this.db(), 'variants')).sort(byCreatedAsc);
  }

  async getVariant(id: string) {
    return get<Variant>(await this.db(), 'variants', id);
  }

  private async checkVariantRefs(v: Pick<Variant, 'presentationId' | 'backgroundAssetId' | 'foregroundAssetId'>) {
    if (!(await this.getPresentation(v.presentationId))) throw new NotFoundError('Présentation');
    for (const id of [v.backgroundAssetId, v.foregroundAssetId]) {
      if (id && !(await this.getAsset(id))) throw new NotFoundError('Image');
    }
  }

  async createVariant(input: NewVariantInput) {
    await this.checkVariantRefs(input);
    const now = nowIso();
    const v: Variant = {
      id: crypto.randomUUID(),
      presentationId: input.presentationId,
      name: cleanTitle(input.name, 'Variante'),
      backgroundAssetId: input.backgroundAssetId,
      foregroundAssetId: input.foregroundAssetId,
      transform: parseTransform(input.transform),
      note: input.note ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.touchPresentation(v.presentationId, [{ type: 'put', store: 'variants', key: v.id, value: v }]);
    return v;
  }

  async updateVariant(id: string, patch: VariantPatch) {
    const v = await this.getVariant(id);
    if (!v) throw new NotFoundError('Variante');
    const next: Variant = {
      ...v,
      ...patch,
      name: patch.name !== undefined ? cleanTitle(patch.name, v.name) : v.name,
      transform: patch.transform ? parseTransform(patch.transform) : v.transform,
      updatedAt: nowIso(),
    };
    await this.checkVariantRefs(next);
    await this.touchPresentation(v.presentationId, [{ type: 'put', store: 'variants', key: id, value: next }]);
    return next;
  }

  async deleteVariant(id: string) {
    await write(await this.db(), [{ type: 'delete', store: 'variants', key: id }]);
  }

  private async touchPresentation(presentationId: string, ops: WriteOp[]) {
    const db = await this.db();
    const p = await get<Presentation>(db, 'presentations', presentationId);
    if (p) ops.push({ type: 'put', store: 'presentations', key: p.id, value: { ...p, updatedAt: nowIso() } });
    await write(db, ops);
  }
}
