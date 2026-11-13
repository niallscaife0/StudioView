import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository } from '../src/data/local/localRepository';
import { NotFoundError, RoomInUseError } from '../src/data/repository';
import {
  BODY_RADIUS, ROOM_DEFAULTS, SILHOUETTE_HEIGHT_DEFAULT, WALK_SPEED, assetForPlacement, clampPlacement, clampRoom, distanceCm,
  entrancePose, formatCm, look, newPlacement, panelSizeCm, parseHeightCm, parsePlacements, samePlacements, walk, wallDistances,
} from '../src/features/hanging/geometry';
import type { Asset } from '../src/domain/types';

const room = { lengthCm: 800, widthCm: 600, heightCm: 350 };

describe('échelle réelle (F-36, critère 5)', () => {
  it('la hauteur du panneau est la hauteur déclarée ; la largeur suit les proportions de la photo', () => {
    const s = panelSizeCm({ heightCm: 175 }, { width: 4000, height: 6000 });
    expect(s).toEqual({ heightCm: 175, widthCm: 175 * (4000 / 6000) });
  });
  it('une œuvre de 175 cm et la silhouette de 170 cm gardent leur rapport, quelle que soit la photo', () => {
    const a = panelSizeCm({ heightCm: 175 }, { width: 1000, height: 3000 })!;
    const b = panelSizeCm({ heightCm: 175 }, { width: 3000, height: 1000 })!;
    expect(a.heightCm / SILHOUETTE_HEIGHT_DEFAULT).toBeCloseTo(175 / 170, 10);
    expect(b.heightCm).toBe(a.heightCm);
  });
  it('sans hauteur déclarée, aucune taille n’est inventée', () => {
    expect(panelSizeCm({ heightCm: null }, { width: 100, height: 100 })).toBeNull();
  });
  it('valide la saisie de hauteur', () => {
    expect(parseHeightCm('175')).toBe(175);
    expect(parseHeightCm('62,5')).toBe(62.5);
    expect(parseHeightCm('0')).toBeNull();
    expect(parseHeightCm('abc')).toBeNull();
    expect(parseHeightCm(5000)).toBeNull();
  });
});

describe('salle et placements', () => {
  it('borne les dimensions de la salle', () => {
    expect(clampRoom({ lengthCm: 5, widthCm: 99999, heightCm: 0 })).toEqual({ lengthCm: 100, widthCm: 10000, heightCm: ROOM_DEFAULTS.heightCm });
  });
  it('garde un placement dans la salle et normalise l’orientation', () => {
    const p = clampPlacement({ id: 'p', artworkId: 'a', assetId: null, xCm: -40, zCm: 9999, rotationDeg: 370, elevationCm: -5 }, room);
    expect(p).toMatchObject({ xCm: 5, zCm: 595, rotationDeg: 10, elevationCm: 0 });
  });
  it('écarte les nouvelles œuvres les unes des autres', () => {
    const a = newPlacement('a', room, 0);
    const b = newPlacement('a', room, 1);
    const c = newPlacement('a', room, 2);
    expect(a.xCm).toBe(400);
    expect(new Set([a.xCm, b.xCm, c.xCm]).size).toBe(3);
    expect(distanceCm(a, b)).toBeGreaterThanOrEqual(100);
  });
  it('mesure les distances aux murs et entre œuvres', () => {
    expect(wallDistances({ xCm: 200, zCm: 150 }, room)).toEqual({ left: 200, right: 600, front: 150, back: 450 });
    expect(distanceCm({ xCm: 0, zCm: 0 }, { xCm: 300, zCm: 400 })).toBe(500);
    expect(formatCm(240)).toBe('2,40 m');
    expect(formatCm(62)).toBe('62 cm');
  });
  it('lit une liste stockée de façon défensive', () => {
    const ps = parsePlacements([{ artworkId: 'a', xCm: 10, zCm: 20 }, { xCm: 1 }, null, { id: 'k', artworkId: 'b', assetId: 'img', rotationDeg: 190 }]);
    expect(ps).toHaveLength(2);
    expect(ps[0]).toMatchObject({ artworkId: 'a', assetId: null, xCm: 10, zCm: 20, rotationDeg: 0, elevationCm: 0 });
    expect(ps[1]).toMatchObject({ id: 'k', assetId: 'img', rotationDeg: -170 });
    expect(parsePlacements(undefined)).toEqual([]);
    expect(samePlacements(ps, ps.map((p) => ({ ...p })))).toBe(true);
    expect(samePlacements(ps, [ps[0], { ...ps[1], xCm: 1 }])).toBe(false);
  });
  it('choisit la photo du panneau : celle demandée, sinon la détourée, sinon la première', () => {
    const mk = (id: string, kind: Asset['kind'], artworkId: string | null): Asset => ({
      id, artworkId, kind, mimeType: 'image/png', bytes: 1, width: 1, height: 1, transparency: null, title: id, createdAt: '',
    });
    const assets = [mk('brute', 'photo', 'a'), mk('det', 'cutout', 'a'), mk('autre', 'photo', 'b'), mk('decor', 'background', null)];
    expect(assetForPlacement({ artworkId: 'a', assetId: 'brute' }, assets)?.id).toBe('brute');
    expect(assetForPlacement({ artworkId: 'a', assetId: null }, assets)?.id).toBe('det');
    expect(assetForPlacement({ artworkId: 'a', assetId: 'autre' }, assets)?.id).toBe('det'); // photo d'une autre œuvre : ignorée
    expect(assetForPlacement({ artworkId: 'c', assetId: null }, assets)).toBeNull();
  });
});

describe('déplacement à la première personne (F-39, critère 6)', () => {
  it('entre par le milieu du mur d’entrée, regard vers le fond', () => {
    expect(entrancePose(room)).toMatchObject({ xCm: 400, zCm: 60, yaw: 0, eyeCm: 160 });
  });
  it('avance dans la direction du regard, à vitesse de marche', () => {
    const p = walk(entrancePose(room), 1, 0, 1, room);
    expect(p.zCm).toBeCloseTo(60 + WALK_SPEED);
    expect(p.xCm).toBeCloseTo(400);
    expect(walk(entrancePose(room), 1, 0, 1, room, true).zCm).toBeCloseTo(60 + 2 * WALK_SPEED);
  });
  it('le pas de côté vers la droite va vers −x quand on regarde le fond de la salle', () => {
    expect(walk(entrancePose(room), 0, 1, 1, room).xCm).toBeCloseTo(400 - WALK_SPEED);
  });
  it('ne traverse pas les murs', () => {
    let p = entrancePose(room);
    for (let i = 0; i < 100; i++) p = walk(p, 1, 0, 0.1, room);
    expect(p.zCm).toBe(room.widthCm - BODY_RADIUS);
    for (let i = 0; i < 100; i++) p = walk(p, 0, 1, 0.1, room);
    expect(p.xCm).toBe(BODY_RADIUS);
    for (let i = 0; i < 100; i++) p = walk(p, -1, 0, 0.1, room);
    expect(p.zCm).toBe(BODY_RADIUS);
  });
  it('tourner change la direction de marche ; le regard vertical est borné', () => {
    const turned = look(entrancePose(room), Math.PI / 2, 0); // regard vers +x
    const p = walk(turned, 1, 0, 1, room);
    expect(p.xCm).toBeCloseTo(400 + WALK_SPEED);
    expect(p.zCm).toBeCloseTo(60);
    expect(look(entrancePose(room), 0, 10).pitch).toBeLessThan(Math.PI / 2);
  });
  it('la hauteur des yeux fait partie de la pose', () => {
    expect(entrancePose(room, 120).eyeCm).toBe(120);
  });
});

describe('LocalRepository — salles et accrochages', () => {
  let dbName: string;
  let repo: LocalRepository;
  beforeEach(() => {
    dbName = `hang-${Math.random()}`;
    repo = new LocalRepository(dbName);
  });
  const roomInput = { title: ' Galerie ', ...ROOM_DEFAULTS };
  const png = new Blob([new Uint8Array(8)], { type: 'image/png' });

  it('enregistre la hauteur déclarée d’une œuvre', async () => {
    const a = await repo.createArtwork('Figure');
    expect(a.heightCm).toBeNull();
    await repo.setArtworkHeight(a.id, 175);
    expect((await new LocalRepository(dbName).getArtwork(a.id))?.heightCm).toBe(175);
  });

  it('crée une salle (valeurs bornées), un accrochage et deux variantes distinctes qui persistent (F-37, F-43, critère 7)', async () => {
    const r = await repo.createRoom({ ...roomInput, lengthCm: 5, wallColor: 'rouge' });
    expect(r).toMatchObject({ title: 'Galerie', lengthCm: 100, wallColor: ROOM_DEFAULTS.wallColor });
    const a = await repo.createArtwork('Figure');
    const photo = await repo.createAsset({ artworkId: a.id, kind: 'photo', title: 'vue', mimeType: 'image/png', width: 10, height: 20, transparency: false, original: png, thumbnail: png });
    const h = await repo.createHanging(r.id, 'Essai');
    expect(h).toMatchObject({ mode: 'room', roomId: r.id, artworkId: null });

    const p1 = newPlacement(a.id, r, 0);
    const vA = await repo.createVariant({ presentationId: h.id, name: 'A', backgroundAssetId: null, items: [], placements: [{ ...p1, assetId: photo.id }] });
    const vB = await repo.createVariant({ presentationId: h.id, name: 'B', backgroundAssetId: null, items: [], placements: [{ ...p1, id: crypto.randomUUID(), xCm: 20, rotationDeg: 90 }] });
    await repo.updateVariant(vB.id, { placements: [...vB.placements, newPlacement(a.id, r, 1)] });

    const again = new LocalRepository(dbName);
    expect((await again.getVariant(vA.id))!.placements).toHaveLength(1);
    expect((await again.getVariant(vA.id))!.placements[0]).toMatchObject({ assetId: photo.id, xCm: p1.xCm });
    const b = (await again.getVariant(vB.id))!;
    expect(b.placements).toHaveLength(2);
    expect(b.placements[0]).toMatchObject({ xCm: 20, rotationDeg: 90 });
    // Une photo utilisée comme panneau est protégée comme en 2D.
    await expect(again.deleteAsset(photo.id)).rejects.toThrow(/utilisée/);
  });

  it('refuse de supprimer une salle utilisée, et un placement d’une œuvre inexistante', async () => {
    const r = await repo.createRoom(roomInput);
    const h = await repo.createHanging(r.id, 'Essai');
    await expect(repo.deleteRoom(r.id)).rejects.toBeInstanceOf(RoomInUseError);
    await expect(
      repo.createVariant({ presentationId: h.id, name: 'A', backgroundAssetId: null, items: [], placements: [newPlacement('fantome', r, 0)] }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await repo.deletePresentation(h.id);
    await repo.deleteRoom(r.id);
    expect(await repo.listRooms()).toHaveLength(0);
    await expect(repo.createHanging('inconnue', 'x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('supprimer une œuvre la retire des accrochages sans supprimer l’accrochage', async () => {
    const r = await repo.createRoom(roomInput);
    const a = await repo.createArtwork('À retirer');
    const b = await repo.createArtwork('À garder');
    const h = await repo.createHanging(r.id, 'Essai');
    const v = await repo.createVariant({ presentationId: h.id, name: 'A', backgroundAssetId: null, items: [], placements: [newPlacement(a.id, r, 0), newPlacement(b.id, r, 1)] });
    await repo.deleteArtwork(a.id);
    const after = (await repo.getVariant(v.id))!;
    expect(after.placements.map((p) => p.artworkId)).toEqual([b.id]);
    expect(await repo.getPresentation(h.id)).not.toBeNull();
  });

  it('lit les données créées avant la phase 3 (œuvre sans hauteur, présentation sans mode)', async () => {
    const a = await repo.createArtwork('Ancienne');
    const p = await repo.createPresentation(a.id, 'P');
    expect((await repo.getPresentation(p.id))).toMatchObject({ mode: '2d', roomId: null, artworkId: a.id });
    const v = await repo.createVariant({ presentationId: p.id, name: 'A', backgroundAssetId: null, items: [] });
    expect(v.placements).toEqual([]);
  });
});
