import { useEffect, useState } from 'react';
import type { Repository } from '../../data/repository';
import type { Asset } from '../../domain/types';

/**
 * Cache mémoire des fichiers téléchargés (Blob) et des images décodées.
 * Les originaux ne sont chargés qu'à la demande (Studio, comparaison, export).
 * Les médias passent toujours par un Blob local (D-05) : le canvas n'est jamais bloqué par CORS.
 */
const blobCache = new Map<string, Promise<Blob>>();
const bitmapCache = new Map<string, Promise<ImageBitmap>>();
const MAX_BITMAPS = 12;

function key(asset: Asset, which: 'original' | 'thumbnail') {
  return `${asset.id}:${which}`;
}

export function loadBlob(repo: Repository, asset: Asset, which: 'original' | 'thumbnail'): Promise<Blob> {
  const k = key(asset, which);
  let p = blobCache.get(k);
  if (!p) {
    p = repo.getAssetBlob(asset, which);
    blobCache.set(k, p);
    p.catch(() => blobCache.delete(k));
  }
  return p;
}

export function loadBitmap(repo: Repository, asset: Asset): Promise<ImageBitmap> {
  const k = key(asset, 'original');
  let p = bitmapCache.get(k);
  if (!p) {
    p = loadBlob(repo, asset, 'original').then((b) => createImageBitmap(b, { imageOrientation: 'from-image' }));
    bitmapCache.set(k, p);
    p.catch(() => bitmapCache.delete(k));
    if (bitmapCache.size > MAX_BITMAPS) {
      const oldest = bitmapCache.keys().next().value as string;
      bitmapCache.delete(oldest);
    }
  }
  return p;
}

export function forgetAsset(assetId: string) {
  for (const m of [blobCache, bitmapCache] as Map<string, unknown>[]) {
    for (const k of [...m.keys()]) if (k.startsWith(`${assetId}:`)) m.delete(k);
  }
}

/** URL locale (blob:) d'une miniature ; libérée au démontage. */
export function useThumbnailUrl(repo: Repository, asset: Asset | null | undefined): { url: string | null; error: boolean } {
  const [state, setState] = useState<{ url: string | null; error: boolean }>({ url: null, error: false });
  useEffect(() => {
    if (!asset) {
      setState({ url: null, error: false });
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    loadBlob(repo, asset, 'thumbnail')
      .then((b) => {
        if (cancelled) return;
        url = URL.createObjectURL(b);
        setState({ url, error: false });
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, error: true });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [repo, asset]);
  return state;
}

export interface BitmapState {
  bitmap: ImageBitmap | null;
  loading: boolean;
  error: string | null;
}

export function useBitmap(repo: Repository, asset: Asset | null | undefined): BitmapState {
  const [state, setState] = useState<BitmapState>({ bitmap: null, loading: !!asset, error: null });
  useEffect(() => {
    if (!asset) {
      setState({ bitmap: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    loadBitmap(repo, asset)
      .then((bitmap) => {
        if (!cancelled) setState({ bitmap, loading: false, error: null });
      })
      .catch(() => {
        if (!cancelled) setState({ bitmap: null, loading: false, error: `Impossible de charger « ${asset.title} ».` });
      });
    return () => {
      cancelled = true;
    };
  }, [repo, asset]);
  return state;
}
