import type { Artwork, Asset, Presentation, Room, Variant } from '../../domain/types';
import { clampRoom, isHexColor, parsePlacements, ROOM_DEFAULTS } from '../../features/hanging/geometry';
import { parseItems, upgradeLegacyVariant } from '../../domain/transform';
import {
  AssetInUseError,
  NotFoundError,
  RoomInUseError,
  cleanTitle,
  nowIso,
  variantsUsingAsset,
  type AssetPatch,
  type NewAssetInput,
  type NewVariantInput,
  type Repository,
  type RoomInput,
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

/** Lecture tolérante des enregistrements créés par une version antérieure. */
const normArtwork = (a: Artwork): Artwork => ({ ...a, heightCm: typeof a.heightCm === 'number' ? a.heightCm : null });
const normPresentation = (p: Presentation): Presentation => ({
  ...p,
  mode: p.mode === 'room' ? 'room' : '2d',
  artworkId: p.artworkId ?? null,
  roomId: p.roomId ?? null,
});
const normVariant = (v: Variant): Variant => ({ ...v, items: parseItems(v.items), placements: parsePlacements(v.placements) });

export function cleanRoomInput(input: RoomInput): RoomInput {
  const r = clampRoom(input);
  return {
    ...r,
    title: cleanTitle(input.title, 'Salle'),
    wallColor: isHexColor(input.wallColor) ? input.wallColor : ROOM_DEFAULTS.wallColor,
    floorColor: isHexColor(input.floorColor) ? input.floorColor : ROOM_DEFAULTS.floorColor,
    light: input.light === 'dark' || input.light === 'day' ? input.light : 'bright',
  };
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
    this.dbPromise = openDatabase(dbName).then(async (db) => {
      await migrateLegacyVariants(db);
      return db;
    });
  }

  private db() {
    return this.dbPromise;
  }

  async listArtworks() {
    return (await getAll<Artwork>(await this.db(), 'artworks')).map(normArtwork).sort(byCreatedAsc);
  }

  async getArtwork(id: string) {
    const a = await get<Artwork>(await this.db(), 'artworks', id);
    return a ? normArtwork(a) : null;
  }

  async setArtworkHeight(id: string, heightCm: number | null) {
    const db = await this.db();
    const a = await this.getArtwork(id);
    if (!a) throw new NotFoundError('Œuvre');
    const next = { ...a, heightCm, updatedAt: nowIso() };
    await write(db, [{ type: 'put', store: 'artworks', key: id, value: next }]);
    return next;
  }

  async createArtwork(title: string) {
    const now = nowIso();
    const a: Artwork = { id: crypto.randomUUID(), title: cleanTitle(title, 'Sans titre'), heightCm: null, createdAt: now, updatedAt: now };
    await write(await this.db(), [{ type: 'put', store: 'artworks', key: a.id, value: a }]);
    return a;
  }

  async renameArtwork(id: string, title: string) {
    const db = await this.db();
    const a = await this.getArtwork(id);
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
    for (const raw of variants) {
      const v = normVariant(raw);
      if (presIds.has(v.presentationId)) ops.push({ type: 'delete', store: 'variants', key: v.id });
      else if (v.placements.some((p) => p.artworkId === id))
        ops.push({ type: 'put', store: 'variants', key: v.id, value: { ...v, placements: v.placements.filter((p) => p.artworkId !== id) } });
    }
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
    const using = variantsUsingAsset((await getAll<Variant>(db, 'variants')).map(normVariant), id);
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
    return (await getAll<Presentation>(await this.db(), 'presentations')).map(normPresentation).sort(byUpdatedDesc);
  }

  async getPresentation(id: string) {
    const p = await get<Presentation>(await this.db(), 'presentations', id);
    return p ? normPresentation(p) : null;
  }

  async createHanging(roomId: string, title: string) {
    if (!(await this.getRoom(roomId))) throw new NotFoundError('Salle');
    const now = nowIso();
    const p: Presentation = { id: crypto.randomUUID(), mode: 'room', artworkId: null, roomId, title: cleanTitle(title, 'Accrochage'), createdAt: now, updatedAt: now };
    await write(await this.db(), [{ type: 'put', store: 'presentations', key: p.id, value: p }]);
    return p;
  }

  async listRooms() {
    return (await getAll<Room>(await this.db(), 'rooms')).sort(byCreatedAsc);
  }

  async getRoom(id: string) {
    return get<Room>(await this.db(), 'rooms', id);
  }

  async createRoom(input: RoomInput) {
    const now = nowIso();
    const r: Room = { id: crypto.randomUUID(), ...cleanRoomInput(input), createdAt: now, updatedAt: now };
    await write(await this.db(), [{ type: 'put', store: 'rooms', key: r.id, value: r }]);
    return r;
  }

  async updateRoom(id: string, input: RoomInput) {
    const r = await this.getRoom(id);
    if (!r) throw new NotFoundError('Salle');
    const next: Room = { ...r, ...cleanRoomInput(input), updatedAt: nowIso() };
    await write(await this.db(), [{ type: 'put', store: 'rooms', key: id, value: next }]);
    return next;
  }

  async deleteRoom(id: string) {
    const used = (await this.listPresentations()).filter((p) => p.roomId === id).length;
    if (used > 0) throw new RoomInUseError(used);
    await write(await this.db(), [{ type: 'delete', store: 'rooms', key: id }]);
  }

  async createPresentation(artworkId: string, title: string) {
    if (!(await this.getArtwork(artworkId))) throw new NotFoundError('Œuvre');
    const now = nowIso();
    const p: Presentation = {
      id: crypto.randomUUID(),
      mode: '2d',
      roomId: null,
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
    const p = await this.getPresentation(id);
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
    return (await getAll<Variant>(await this.db(), 'variants')).map(normVariant).sort(byCreatedAsc);
  }

  async getVariant(id: string) {
    const v = await get<Variant>(await this.db(), 'variants', id);
    return v ? normVariant(v) : null;
  }

  private async checkVariantRefs(v: Pick<Variant, 'presentationId' | 'backgroundAssetId' | 'items' | 'placements'>) {
    if (!(await this.getPresentation(v.presentationId))) throw new NotFoundError('Présentation');
    const ids = new Set([v.backgroundAssetId, ...v.items.map((i) => i.assetId), ...v.placements.map((p) => p.assetId)]);
    for (const id of ids) {
      if (id && !(await this.getAsset(id))) throw new NotFoundError('Image');
    }
    for (const id of new Set(v.placements.map((p) => p.artworkId))) {
      if (!(await this.getArtwork(id))) throw new NotFoundError('Œuvre');
    }
  }

  async createVariant(input: NewVariantInput) {
    await this.checkVariantRefs({ ...input, placements: input.placements ?? [] });
    const now = nowIso();
    const v: Variant = {
      id: crypto.randomUUID(),
      presentationId: input.presentationId,
      name: cleanTitle(input.name, 'Variante'),
      backgroundAssetId: input.backgroundAssetId,
      items: parseItems(input.items),
      placements: parsePlacements(input.placements ?? []),
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
      items: patch.items ? parseItems(patch.items) : v.items,
      placements: patch.placements ? parsePlacements(patch.placements) : v.placements,
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

/** Reprise V1 → V2 au premier lancement : chaque variante à photo unique devient une variante à un élément. */
async function migrateLegacyVariants(db: IDBDatabase): Promise<void> {
  const raws = await getAll<Record<string, unknown>>(db, 'variants');
  const ops: WriteOp[] = [];
  for (const raw of raws) {
    const { items, changed } = upgradeLegacyVariant(raw);
    if (!changed) continue;
    const next = { ...raw, items };
    delete (next as Record<string, unknown>).foregroundAssetId;
    delete (next as Record<string, unknown>).transform;
    ops.push({ type: 'put', store: 'variants', key: String(raw.id), value: next });
  }
  await write(db, ops);
}
