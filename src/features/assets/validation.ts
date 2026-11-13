import type { ImageMime } from '../../domain/types';

export const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
export const ACCEPT_ATTR = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';

/** Type réel lu dans les premiers octets (signature), indépendamment du nom et du MIME annoncé. */
export function sniffImageType(bytes: Uint8Array): ImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Indice d'en-tête : le format PEUT-il contenir de la transparence ?
 * PNG : type de couleur 4/6 (alpha) ou chunk tRNS ; WebP : VP8X avec drapeau alpha, ou VP8L.
 * Ce n'est qu'un indice : la transparence réelle est mesurée sur les pixels.
 */
export function headerMayHaveAlpha(bytes: Uint8Array, type: ImageMime): boolean {
  if (type === 'image/jpeg') return false;
  if (type === 'image/png') {
    if (bytes.length < 26) return false;
    const colorType = bytes[25];
    if (colorType === 4 || colorType === 6) return true;
    for (let i = 8; i < bytes.length - 4; i++) {
      if (bytes[i] === 0x74 && bytes[i + 1] === 0x52 && bytes[i + 2] === 0x4e && bytes[i + 3] === 0x53) return true;
    }
    return false;
  }
  if (bytes.length < 21) return false;
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === 'VP8X') return (bytes[20] & 0x10) !== 0;
  if (chunk === 'VP8L') return true;
  return false;
}

export interface ValidationOk {
  ok: true;
  mimeType: ImageMime;
  mayHaveAlpha: boolean;
  tooLarge: boolean;
}
export interface ValidationError {
  ok: false;
  message: string;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}

/**
 * Valide un fichier avant tout enregistrement.
 * Trop volumineux n'est pas une erreur bloquante : l'interface propose une version optimisée.
 */
export function validateImageFile(
  name: string,
  declaredMime: string,
  size: number,
  head: Uint8Array,
  maxBytes: number,
): ValidationOk | ValidationError {
  const lower = name.toLowerCase();
  const ext = ACCEPTED_EXTENSIONS.find((e) => lower.endsWith(e));
  if (!ext) {
    return { ok: false, message: `« ${name} » n’est pas accepté. Formats acceptés : JPG, PNG, WebP.` };
  }
  if (size === 0) return { ok: false, message: `« ${name} » est vide.` };
  const real = sniffImageType(head);
  if (!real) {
    return { ok: false, message: `« ${name} » porte une extension d’image, mais son contenu n’est pas un JPG, PNG ou WebP valide.` };
  }
  const extType: ImageMime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  if (extType !== real || (declaredMime !== '' && declaredMime !== real)) {
    return {
      ok: false,
      message: `« ${name} » : l’extension ou le type annoncé ne correspond pas au contenu réel (${real.replace('image/', '').toUpperCase()}). Renomme le fichier avec la bonne extension.`,
    };
  }
  return { ok: true, mimeType: real, mayHaveAlpha: headerMayHaveAlpha(head, real), tooLarge: size > maxBytes };
}

export function titleFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Image';
}
