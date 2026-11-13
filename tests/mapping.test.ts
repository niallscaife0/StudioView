import { describe, expect, it } from 'vitest';
import { itemsToRpc, storagePaths, toAsset, toVariant } from '../src/data/supabase/mapping';

describe('mapping Supabase', () => {
  it('construit des chemins dans le dossier du propriétaire', () => {
    const p = storagePaths('owner', 'asset', 'image/jpeg', 'image/webp');
    expect(p).toEqual({ original: 'owner/asset/original.jpg', thumbnail: 'owner/asset/thumb.webp' });
  });
  it('convertit une variante et ordonne ses éléments par z_index', () => {
    const tr = (x: number) => ({ schemaVersion: 1, x, y: 0.2, scale: 0.3, rotationDeg: 4 });
    const v = toVariant({
      id: 'v', presentation_id: 'p', name: 'A', background_asset_id: null, note: null,
      created_at: '2026-11-13T00:00:00Z', updated_at: '2026-11-13T00:00:00Z',
      variant_items: [
        { id: 'haut', asset_id: 'f2', name: 'devant', z_index: 1, transform: tr(0.9), hidden: false, locked: true },
        { id: 'bas', asset_id: 'f1', name: null, z_index: 0, transform: tr(0.1), hidden: true, locked: false },
      ],
    });
    expect(v.items.map((i) => i.id)).toEqual(['bas', 'haut']);
    expect(v.items[0]).toMatchObject({ assetId: 'f1', hidden: true, transform: { x: 0.1, scale: 0.3 } });
    expect(itemsToRpc(v.items)[1]).toEqual({ id: 'haut', assetId: 'f2', name: 'devant', transform: v.items[1].transform, hidden: false, locked: true });
  });
  it('accepte une variante sans élément', () => {
    const v = toVariant({ id: 'v', presentation_id: 'p', name: 'A', background_asset_id: null, note: null, created_at: '', updated_at: '', variant_items: null });
    expect(v.items).toEqual([]);
  });
  it('convertit une ligne d’asset (bytes en bigint texte)', () => {
    const a = toAsset({
      id: 'a', artwork_id: null, kind: 'background', storage_path: 'o/a/original.png', thumb_path: 'o/a/thumb.webp',
      mime_type: 'image/png', bytes: '1234' as unknown as number, width: 10, height: 20, transparency: false,
      title: 'Salle', created_at: '2026-11-13T00:00:00Z',
    });
    expect(a.bytes).toBe(1234);
    expect(a.storagePath).toBe('o/a/original.png');
  });
});
