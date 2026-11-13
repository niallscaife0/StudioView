import { describe, expect, it } from 'vitest';
import { headerMayHaveAlpha, sniffImageType, titleFromFilename, validateImageFile } from '../src/features/assets/validation';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
function pngHeader(colorType: number) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  b[25] = colorType;
  return b;
}
function webp(chunk: 'VP8 ' | 'VP8L' | 'VP8X', flags = 0) {
  const b = new Uint8Array(30);
  b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  b.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
  b.set([...chunk].map((c) => c.charCodeAt(0)), 12);
  b[20] = flags;
  return b;
}
const MAX = 10 * 1024 * 1024;

describe('sniffImageType', () => {
  it('reconnaît les signatures réelles', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(pngHeader(6))).toBe('image/png');
    expect(sniffImageType(webp('VP8 '))).toBe('image/webp');
  });
  it('refuse un contenu inconnu', () => {
    expect(sniffImageType(new TextEncoder().encode('GIF89a......'))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe('headerMayHaveAlpha', () => {
  it('JPEG : jamais', () => expect(headerMayHaveAlpha(JPEG, 'image/jpeg')).toBe(false));
  it('PNG : selon le type de couleur', () => {
    expect(headerMayHaveAlpha(pngHeader(6), 'image/png')).toBe(true);
    expect(headerMayHaveAlpha(pngHeader(4), 'image/png')).toBe(true);
    expect(headerMayHaveAlpha(pngHeader(2), 'image/png')).toBe(false);
  });
  it('PNG palette avec tRNS : possible', () => {
    const b = new Uint8Array(60);
    b.set(pngHeader(3), 0);
    b.set([0x74, 0x52, 0x4e, 0x53], 40);
    expect(headerMayHaveAlpha(b, 'image/png')).toBe(true);
  });
  it('WebP : drapeau alpha VP8X ou VP8L', () => {
    expect(headerMayHaveAlpha(webp('VP8X', 0x10), 'image/webp')).toBe(true);
    expect(headerMayHaveAlpha(webp('VP8X', 0), 'image/webp')).toBe(false);
    expect(headerMayHaveAlpha(webp('VP8L'), 'image/webp')).toBe(true);
    expect(headerMayHaveAlpha(webp('VP8 '), 'image/webp')).toBe(false);
  });
});

describe('validateImageFile', () => {
  it('accepte un JPG cohérent', () => {
    const r = validateImageFile('DSC09521.JPG', 'image/jpeg', 5000, JPEG, MAX);
    expect(r).toMatchObject({ ok: true, mimeType: 'image/jpeg', tooLarge: false });
  });
  it('refuse une extension non prise en charge', () => {
    const r = validateImageFile('modele.glb', '', 5000, JPEG, MAX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/JPG, PNG, WebP/);
  });
  it('refuse un fichier dont le contenu ne correspond pas à l’extension', () => {
    const r = validateImageFile('photo.png', 'image/png', 5000, JPEG, MAX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/contenu réel/);
  });
  it('refuse un faux fichier image', () => {
    const r = validateImageFile('photo.jpg', 'image/jpeg', 12, new TextEncoder().encode('<html></html>'), MAX);
    expect(r.ok).toBe(false);
  });
  it('refuse un fichier vide', () => {
    expect(validateImageFile('vide.jpg', 'image/jpeg', 0, new Uint8Array(), MAX).ok).toBe(false);
  });
  it('signale un fichier trop lourd sans le refuser (version optimisée proposée)', () => {
    const r = validateImageFile('grand.jpg', 'image/jpeg', MAX + 1, JPEG, MAX);
    expect(r).toMatchObject({ ok: true, tooLarge: true });
  });
  it('accepte un MIME annoncé vide (certains navigateurs)', () => {
    expect(validateImageFile('a.webp', '', 100, webp('VP8 '), MAX).ok).toBe(true);
  });
});

describe('titleFromFilename', () => {
  it('nettoie le nom', () => {
    expect(titleFromFilename('vue_de-face.png')).toBe('vue de face');
    expect(titleFromFilename('.png')).toBe('Image');
  });
});
