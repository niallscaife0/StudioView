import { describe, expect, it } from 'vitest';
import { foregroundRect, frameAspect, handlePosition, hitForeground, hitHandle, outputSize, pickItem, type AlphaMask } from '../src/features/studio2d/compose';
import { DEFAULT_TRANSFORM, clampTransform, newItem, parseItems, parseTransform, sameDraft, upgradeLegacyVariant } from '../src/domain/transform';
import type { Transform2D, VariantItem } from '../src/domain/types';

const t = (p: Partial<Transform2D>): Transform2D => ({ ...DEFAULT_TRANSFORM, ...p });

describe('cadre de composition', () => {
  it('prend les proportions du décor, 16:9 sans décor', () => {
    expect(frameAspect({ w: 3000, h: 2000 })).toBeCloseTo(1.5);
    expect(frameAspect(null)).toBeCloseTo(16 / 9);
    expect(frameAspect({ w: 0, h: 0 })).toBeCloseTo(16 / 9);
  });
  it('calcule la taille d’export', () => {
    expect(outputSize(1600, 16 / 9)).toEqual({ w: 1600, h: 900 });
    expect(outputSize(1600, 1.5)).toEqual({ w: 1600, h: 1067 });
  });
});

describe('foregroundRect', () => {
  it('positionne au centre normalisé et conserve les proportions de la photo', () => {
    const r = foregroundRect({ w: 1600, h: 900 }, { w: 800, h: 1200 }, t({ x: 0.5, y: 0.5, scale: 0.6, rotationDeg: 0 }));
    expect(r.cx).toBe(800);
    expect(r.cy).toBe(450);
    expect(r.h).toBeCloseTo(540);
    expect(r.w / r.h).toBeCloseTo(800 / 1200);
  });
  it('donne le même cadrage relatif quelle que soit la taille d’écran (aperçu = export)', () => {
    const tr = t({ x: 0.3, y: 0.7, scale: 0.4 });
    const small = foregroundRect({ w: 800, h: 450 }, { w: 1, h: 2 }, tr);
    const big = foregroundRect({ w: 3200, h: 1800 }, { w: 1, h: 2 }, tr);
    expect(big.cx / 3200).toBeCloseTo(small.cx / 800);
    expect(big.h / 1800).toBeCloseTo(small.h / 450);
  });
});

describe('manipulation', () => {
  const frame = { w: 1000, h: 1000 };
  const fg = { w: 100, h: 200 };
  it('détecte un clic sur la sculpture, y compris tournée', () => {
    const r = foregroundRect(frame, fg, t({ x: 0.5, y: 0.5, scale: 0.4, rotationDeg: 90 }));
    // rectangle 200 x 400 tourné de 90° : s'étend horizontalement
    expect(hitForeground(500 + 180, 500, r)).toBe(true);
    expect(hitForeground(500, 500 + 180, r)).toBe(false);
  });
  it('place la poignée au coin bas-droit', () => {
    const r = foregroundRect(frame, fg, t({ x: 0.5, y: 0.5, scale: 0.4, rotationDeg: 0 }));
    const h = handlePosition(r);
    expect(h.x).toBeCloseTo(600);
    expect(h.y).toBeCloseTo(700);
    expect(hitHandle(602, 698, r, 10)).toBe(true);
  });
});

describe('transformation', () => {
  it('borne les valeurs', () => {
    const c = clampTransform(t({ x: 9, y: -9, scale: 99, rotationDeg: 370 }));
    expect(c).toMatchObject({ x: 1.25, y: -0.25, scale: 2, rotationDeg: 10 });
  });
  it('lit un JSON stocké de façon défensive', () => {
    expect(parseTransform(null)).toEqual(DEFAULT_TRANSFORM);
    expect(parseTransform({ schemaVersion: 1, x: 0.2, y: 'oops' })).toMatchObject({ x: 0.2, y: DEFAULT_TRANSFORM.y });
  });
  it('refuse une version future plutôt que de la mal interpréter', () => {
    expect(() => parseTransform({ schemaVersion: 2, x: 0 })).toThrow(/Version/);
  });
  it('compare deux états : décor, ordre et contenu des éléments', () => {
    const i1: VariantItem = { id: 'i1', assetId: 'f', name: null, transform: DEFAULT_TRANSFORM, hidden: false, locked: false };
    const i2: VariantItem = { ...i1, id: 'i2', assetId: 'g' };
    const a = { backgroundAssetId: 'b', items: [i1, i2] };
    expect(sameDraft(a, { backgroundAssetId: 'b', items: [{ ...i1 }, { ...i2 }] })).toBe(true);
    expect(sameDraft(a, { ...a, items: [i2, i1] })).toBe(false);
    expect(sameDraft(a, { ...a, items: [i1] })).toBe(false);
    expect(sameDraft(a, { ...a, items: [i1, { ...i2, hidden: true }] })).toBe(false);
    expect(sameDraft(a, { ...a, items: [i1, { ...i2, transform: t({ x: 0.51 }) }] })).toBe(false);
    expect(sameDraft(a, { ...a, backgroundAssetId: null })).toBe(false);
  });
});

describe('sélection parmi plusieurs éléments', () => {
  const frame = { w: 1000, h: 1000 };
  const size = { w: 100, h: 100 };
  const base = { size, hidden: false, locked: false };
  // Deux carrés de 400 px qui se recouvrent au centre.
  const bottom = { ...base, transform: t({ x: 0.4, y: 0.5, scale: 0.4 }) };
  const top = { ...base, transform: t({ x: 0.6, y: 0.5, scale: 0.4 }) };

  it('choisit l’élément le plus haut dans la pile', () => {
    expect(pickItem(500, 500, frame, [bottom, top])).toBe(1);
    expect(pickItem(250, 500, frame, [bottom, top])).toBe(0);
    expect(pickItem(950, 950, frame, [bottom, top])).toBe(-1);
  });
  it('traverse les éléments masqués ou verrouillés', () => {
    expect(pickItem(500, 500, frame, [bottom, { ...top, hidden: true }])).toBe(0);
    expect(pickItem(500, 500, frame, [bottom, { ...top, locked: true }])).toBe(0);
  });
  it('ignore les pixels transparents de l’élément du dessus', () => {
    // Masque 2×2 : moitié gauche transparente, moitié droite opaque.
    const alpha: AlphaMask = { w: 2, h: 2, data: new Uint8Array([0, 255, 0, 255]) };
    const cut = { ...top, alpha };
    expect(pickItem(500, 500, frame, [bottom, cut])).toBe(0); // zone transparente du dessus → celui du dessous
    expect(pickItem(700, 500, frame, [bottom, cut])).toBe(1); // zone opaque
    expect(pickItem(450, 500, frame, [cut])).toBe(-1); // transparent et rien dessous
  });
});

describe('éléments', () => {
  it('décale légèrement chaque nouvel élément', () => {
    const a = newItem('x', 0);
    const b = newItem('x', 1);
    expect(a.id).not.toBe(b.id);
    expect(b.transform.x).toBeGreaterThan(a.transform.x);
  });
  it('lit une liste stockée de façon défensive', () => {
    const items = parseItems([{ assetId: 'a', transform: { x: 0.2 } }, { pasUnElement: true }, null, { id: 'k', assetId: 'b', hidden: true, name: '  ' }]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ assetId: 'a', hidden: false, locked: false, transform: { x: 0.2, scale: DEFAULT_TRANSFORM.scale } });
    expect(items[1]).toMatchObject({ id: 'k', hidden: true, name: null });
    expect(parseItems('non')).toEqual([]);
  });
  it('reprend une variante V1 à photo unique en un élément identique (F-27)', () => {
    const legacy = { id: 'v', foregroundAssetId: 'photo', transform: { schemaVersion: 1, x: 0.31, y: 0.62, scale: 0.44, rotationDeg: 12.5 } };
    const { items, changed } = upgradeLegacyVariant(legacy);
    expect(changed).toBe(true);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ assetId: 'photo', transform: { x: 0.31, y: 0.62, scale: 0.44, rotationDeg: 12.5 }, hidden: false });
  });
  it('ne touche pas une variante déjà au format V2, et gère une variante V1 sans photo', () => {
    expect(upgradeLegacyVariant({ items: [] })).toEqual({ items: [], changed: false });
    expect(upgradeLegacyVariant({ foregroundAssetId: null, transform: {} })).toEqual({ items: [], changed: true });
  });
});
