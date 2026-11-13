import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository } from '../src/data/local/localRepository';
import { AssetInUseError, NotFoundError } from '../src/data/repository';
import { DEFAULT_TRANSFORM, newItem } from '../src/domain/transform';
import { openDatabase, write } from '../src/data/local/idb';

let dbName: string;
let repo: LocalRepository;

beforeEach(() => {
  dbName = `test-${Math.random()}`;
  repo = new LocalRepository(dbName);
});

const png = (n: number) => new Blob([new Uint8Array(n)], { type: 'image/png' });

async function seed() {
  const artwork = await repo.createArtwork('  Figure   linéaire ');
  const cutout = await repo.createAsset({
    artworkId: artwork.id, kind: 'cutout', title: 'Vue', mimeType: 'image/png',
    width: 800, height: 1200, transparency: true, original: png(100), thumbnail: png(10),
  });
  const white = await repo.createAsset({
    artworkId: null, kind: 'background', title: 'Salle blanche', mimeType: 'image/png',
    width: 1920, height: 1280, transparency: false, original: png(200), thumbnail: png(20),
  });
  const dark = await repo.createAsset({
    artworkId: null, kind: 'background', title: 'Salle sombre', mimeType: 'image/png',
    width: 1920, height: 1080, transparency: false, original: png(300), thumbnail: png(30),
  });
  const pres = await repo.createPresentation(artwork.id, 'Essai');
  return { artwork, cutout, white, dark, pres };
}

describe('LocalRepository', () => {
  it('crée, nettoie le titre et retrouve une œuvre', async () => {
    const a = await repo.createArtwork('  Figure   linéaire ');
    expect(a.title).toBe('Figure linéaire');
    expect(await repo.listArtworks()).toHaveLength(1);
    expect((await repo.renameArtwork(a.id, '')).title).toBe('Figure linéaire');
  });

  it('conserve les fichiers et métadonnées après « rechargement » (nouvelle instance)', async () => {
    const { cutout } = await seed();
    const reopened = new LocalRepository(dbName);
    const assets = await reopened.listAssets();
    expect(assets.map((a) => a.title).sort()).toEqual(['Salle blanche', 'Salle sombre', 'Vue']);
    const blob = await reopened.getAssetBlob(cutout, 'original');
    expect(blob.size).toBe(100);
  });

  const item = (assetId: string, patch = {}) => ({ ...newItem(assetId, 0), ...patch });

  it('enregistre deux variantes distinctes qui restent distinctes', async () => {
    const { cutout, white, dark, pres } = await seed();
    const a = await repo.createVariant({ presentationId: pres.id, name: 'isolée', backgroundAssetId: white.id, items: [item(cutout.id, { transform: { ...DEFAULT_TRANSFORM, scale: 0.3 } })] });
    const b = await repo.createVariant({ presentationId: pres.id, name: 'sombre', backgroundAssetId: dark.id, items: [item(cutout.id, { transform: { ...DEFAULT_TRANSFORM, x: 0.7 } })] });
    await repo.updateVariant(b.id, { items: [{ ...b.items[0], transform: { ...b.items[0].transform, scale: 0.9 } }] });

    const reopened = new LocalRepository(dbName);
    const ra = await reopened.getVariant(a.id);
    const rb = await reopened.getVariant(b.id);
    expect(ra).toMatchObject({ name: 'isolée', backgroundAssetId: white.id });
    expect(ra!.items[0].transform).toMatchObject({ scale: 0.3, x: 0.5 });
    expect(rb).toMatchObject({ name: 'sombre', backgroundAssetId: dark.id });
    expect(rb!.items[0].transform).toMatchObject({ scale: 0.9, x: 0.7 });
  });

  it('garde plusieurs éléments, leur ordre et leurs réglages après rechargement (F-25, F-26)', async () => {
    const { cutout, white, pres } = await seed();
    const i1 = item(cutout.id, { name: 'fond' });
    const i2 = item(cutout.id, { transform: { ...DEFAULT_TRANSFORM, x: 0.2 }, hidden: true });
    const i3 = item(cutout.id, { name: 'devant', locked: true });
    const v = await repo.createVariant({ presentationId: pres.id, name: 'trio', backgroundAssetId: white.id, items: [i1, i2, i3] });
    // Réordonner : « devant » passe au fond.
    await repo.updateVariant(v.id, { items: [i3, i1, i2] });

    const r = await new LocalRepository(dbName).getVariant(v.id);
    expect(r!.items.map((i) => i.id)).toEqual([i3.id, i1.id, i2.id]);
    expect(r!.items[0]).toMatchObject({ name: 'devant', locked: true });
    expect(r!.items[2]).toMatchObject({ hidden: true, transform: { x: 0.2 } });
    // Renommer la variante ne touche pas aux éléments.
    const renamed = await repo.updateVariant(v.id, { name: 'trois' });
    expect(renamed.items).toHaveLength(3);
  });

  it('reprend au démarrage une variante enregistrée au format V1 (F-27)', async () => {
    const { cutout, white, pres } = await seed();
    const db = await openDatabase(dbName);
    await write(db, [{
      type: 'put', store: 'variants', key: 'legacy',
      value: {
        id: 'legacy', presentationId: pres.id, name: 'V1', backgroundAssetId: white.id, foregroundAssetId: cutout.id,
        transform: { schemaVersion: 1, x: 0.31, y: 0.62, scale: 0.44, rotationDeg: 12.5 }, note: 'gardée',
        createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
      },
    }]);
    db.close();

    const v = await new LocalRepository(dbName).getVariant('legacy');
    expect(v).toMatchObject({ name: 'V1', backgroundAssetId: white.id, note: 'gardée' });
    expect(v!.items).toHaveLength(1);
    expect(v!.items[0]).toMatchObject({ assetId: cutout.id, transform: { x: 0.31, y: 0.62, scale: 0.44, rotationDeg: 12.5 } });
    expect(v as unknown as Record<string, unknown>).not.toHaveProperty('foregroundAssetId');
  });

  it('refuse de supprimer une image utilisée par un élément sans choix explicite', async () => {
    const { cutout, white, pres } = await seed();
    const v = await repo.createVariant({ presentationId: pres.id, name: 'A', backgroundAssetId: white.id, items: [item(cutout.id)] });
    await expect(repo.deleteAsset(white.id)).rejects.toBeInstanceOf(AssetInUseError);
    await expect(repo.deleteAsset(cutout.id)).rejects.toBeInstanceOf(AssetInUseError);
    expect(await repo.getAsset(cutout.id)).not.toBeNull();
    await repo.deleteAsset(cutout.id, { withDependentVariants: true });
    expect(await repo.getAsset(cutout.id)).toBeNull();
    expect(await repo.getVariant(v.id)).toBeNull();
    await expect(repo.getAssetBlob(cutout, 'original')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('supprime une œuvre en cascade mais garde ses photos dans Ressources', async () => {
    const { artwork, cutout, white, pres } = await seed();
    await repo.createVariant({ presentationId: pres.id, name: 'A', backgroundAssetId: white.id, items: [item(cutout.id)] });
    await repo.deleteArtwork(artwork.id);
    expect(await repo.listPresentations()).toHaveLength(0);
    expect(await repo.listVariants()).toHaveLength(0);
    expect((await repo.getAsset(cutout.id))?.artworkId).toBeNull();
  });

  it('refuse une variante dont un élément référence une image inexistante', async () => {
    const { pres } = await seed();
    await expect(
      repo.createVariant({ presentationId: pres.id, name: 'X', backgroundAssetId: null, items: [item('inconnu')] }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
