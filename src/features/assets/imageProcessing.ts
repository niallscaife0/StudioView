/** Traitements d'image dans le navigateur (Canvas). Non testés en jsdom : couverts par la recette manuelle. */

export interface Decoded {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

/** Décode en respectant l'orientation EXIF. */
export async function decodeImage(blob: Blob): Promise<Decoded> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    return { bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    throw new Error('Impossible de décoder cette image. Le fichier est peut-être endommagé.');
  }
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function canvasToBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Rendu de l’image impossible (mémoire insuffisante ?)'))), type, quality);
  });
}

/** Vraie transparence : au moins 0,5 % des pixels nettement transparents, mesuré sur une réduction. */
export function measureTransparency(d: Decoded): boolean {
  const s = Math.min(1, 256 / Math.max(d.width, d.height));
  const c = canvas(d.width * s, d.height * s);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(d.bitmap, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 240) transparent++;
  return transparent / (data.length / 4) > 0.005;
}

/** Miniature pour la bibliothèque : 480 px max, WebP (PNG si le navigateur n'encode pas le WebP). */
export async function makeThumbnail(d: Decoded): Promise<Blob> {
  const s = Math.min(1, 480 / Math.max(d.width, d.height));
  const c = canvas(d.width * s, d.height * s);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(d.bitmap, 0, 0, c.width, c.height);
  return canvasToBlob(c, 'image/webp', 0.82);
}

/**
 * Version optimisée, proposée explicitement pour un fichier trop lourd.
 * L'original n'est pas conservé dans le laboratoire : l'utilisateur en est informé avant.
 */
export async function makeOptimized(
  d: Decoded,
  hasAlpha: boolean,
): Promise<{ blob: Blob; width: number; height: number; mime: 'image/webp' | 'image/png' | 'image/jpeg' }> {
  const s = Math.min(1, 3000 / Math.max(d.width, d.height));
  const c = canvas(d.width * s, d.height * s);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(d.bitmap, 0, 0, c.width, c.height);
  let blob = await canvasToBlob(c, hasAlpha ? 'image/webp' : 'image/jpeg', 0.9);
  let mime = blob.type as 'image/webp' | 'image/png' | 'image/jpeg';
  if (hasAlpha && mime !== 'image/webp') {
    blob = await canvasToBlob(c, 'image/png');
    mime = 'image/png';
  }
  return { blob, width: c.width, height: c.height, mime };
}
