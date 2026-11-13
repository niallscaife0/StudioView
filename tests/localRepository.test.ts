import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository } from '../src/data/local/localRepository';
import { AssetInUseError, NotFoundError } from '../src/data/repository';
import { DEFAULT_TRANSFORM } from '../src/domain/transform';

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

  it('enregistre deux variantes distinctes qui restent distinctes', async () => {
    const { cutout, white, dark, pres } = await seed();
    const a = await repo.createVariant({ presentationId: pres.id, name: 'isolée', foregroundAssetId: cutout.id, backgroundAssetId: white.id, transform: { ...DEFAULT_TRANSFORM, scale: 0.3 } });
    const b = await repo.createVariant({ presentationId: pres.id, name: 'sombre', foregroundAssetId: cutout.id, backgroundAssetId: dark.id, transform: { ...DEFAULT_TRANSFORM, x: 0.7 } });
    await repo.updateVariant(b.id, { transform: { ...b.transform, scale: 0.9 } });

    const reopened = new LocalRepository(dbName);
    const ra = await reopened.getVariant(a.id);
    const rb = await reopened.getVariant(b.id);
    expect(ra).toMatchObject({ name: 'isolée', backgroundAssetId: white.id, transform: { scale: 0.3, x: 0.5 } });
    expect(rb).toMatchObject({ name: 'sombre', backgroundAssetId: dark.id, transform: { scale: 0.9, x: 0.7 } });
  });

  it('refuse de supprimer une image utilisée sans choix explicite', async () => {
    const { cutout, white, pres } = await seed();
    const v = await repo.createVariant({ presentationId: pres.id, name: 'A', foregroundAssetId: cutout.id, backgroundAssetId: white.id, transform: DEFAULT_TRANSFORM });
    await expect(repo.deleteAsset(white.id)).rejects.toBeInstanceOf(AssetInUseError);
    expect(await repo.getAsset(white.id)).not.toBeNull();
    await repo.deleteAsset(white.id, { withDependentVariants: true });
    expect(await repo.getAsset(white.id)).toBeNull();
    expect(await repo.getVariant(v.id)).toBeNull();
    await expect(repo.getAssetBlob(white, 'original')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('supprime une œuvre en cascade mais garde ses photos dans Ressources', async () => {
    const { artwork, cutout, white, pres } = await seed();
    await repo.createVariant({ presentationId: pres.id, name: 'A', foregroundAssetId: cutout.id, backgroundAssetId: white.id, transform: DEFAULT_TRANSFORM });
    await repo.deleteArtwork(artwork.id);
    expect(await repo.listPresentations()).toHaveLength(0);
    expect(await repo.listVariants()).toHaveLength(0);
    expect((await repo.getAsset(cutout.id))?.artworkId).toBeNull();
  });

  it('refuse une variante qui référence une image inexistante', async () => {
    const { pres } = await seed();
    await expect(
      repo.createVariant({ presentationId: pres.id, name: 'X', foregroundAssetId: 'inconnu', backgroundAssetId: null, transform: DEFAULT_TRANSFORM }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
