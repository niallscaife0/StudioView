import { config } from '../../config';
import type { Repository } from '../../data/repository';
import type { Asset, AssetKind, ImageMime } from '../../domain/types';
import { decodeImage, makeOptimized, makeThumbnail, measureTransparency, type Decoded } from './imageProcessing';
import { formatBytes, titleFromFilename, validateImageFile } from './validation';

export type ImportTarget = { artworkId: string | null; kind: 'artwork-photo' | 'background' };

export type ImportOutcome =
  | { status: 'imported'; asset: Asset }
  | { status: 'rejected'; message: string }
  | { status: 'too-large'; file: File; message: string };

/** Analyse, valide et enregistre un fichier. Rien n'est enregistré si la validation échoue. */
export async function importImageFile(
  repo: Repository,
  file: File,
  target: ImportTarget,
  opts: { optimize?: boolean } = {},
): Promise<ImportOutcome> {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const v = validateImageFile(file.name, file.type, file.size, head, config.maxUploadBytes);
  if (!v.ok) return { status: 'rejected', message: v.message };
  if (v.tooLarge && !opts.optimize) {
    return {
      status: 'too-large',
      file,
      message: `« ${file.name} » pèse ${formatBytes(file.size)} (maximum ${formatBytes(config.maxUploadBytes)}).`,
    };
  }

  let decoded: Decoded;
  try {
    decoded = await decodeImage(file);
  } catch (e) {
    return { status: 'rejected', message: (e as Error).message };
  }

  try {
    const transparency = v.mayHaveAlpha ? measureTransparency(decoded) : false;
    const kind: AssetKind = target.kind === 'background' ? 'background' : transparency ? 'cutout' : 'photo';
    let original: Blob = file;
    let mimeType: ImageMime = v.mimeType;
    let width = decoded.width;
    let height = decoded.height;
    if (opts.optimize) {
      const o = await makeOptimized(decoded, transparency);
      original = o.blob;
      mimeType = o.mime;
      width = o.width;
      height = o.height;
    }
    const thumbnail = await makeThumbnail(decoded);
    const asset = await repo.createAsset({
      artworkId: target.kind === 'background' ? null : target.artworkId,
      kind,
      title: titleFromFilename(file.name),
      mimeType,
      width,
      height,
      transparency,
      original,
      thumbnail,
    });
    return { status: 'imported', asset };
  } finally {
    decoded.bitmap.close();
  }
}
