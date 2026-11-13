import { describe, expect, it } from 'vitest';
import { storagePaths, toAsset, toVariant } from '../src/data/supabase/mapping';

describe('mapping Supabase', () => {
  it('construit des chemins dans le dossier du propriétaire', () => {
    const p = storagePaths('owner', 'asset', 'image/jpeg', 'image/webp');
    expect(p).toEqual({ original: 'owner/asset/original.jpg', thumbnail: 'owner/asset/thumb.webp' });
  });
  it('convertit une ligne de variante et valide le transform', () => {
    const v = toVariant({
      id: 'v', presentation_id: 'p', name: 'A', background_asset_id: null, foreground_asset_id: 'f',
      transform: { schemaVersion: 1, x: 0.1, y: 0.2, scale: 0.3, rotationDeg: 4 }, note: null,
      created_at: '2026-11-13T00:00:00Z', updated_at: '2026-11-13T00:00:00Z',
    });
    expect(v).toMatchObject({ presentationId: 'p', foregroundAssetId: 'f', transform: { x: 0.1, scale: 0.3 } });
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
