import { useEffect, useState } from 'react';
import type { Repository } from '../../data/repository';
import type { Asset } from '../../domain/types';
import type { AlphaMask } from '../studio2d/compose';

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
  alphaCache.delete(assetId);
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

const alphaCache = new Map<string, AlphaMask | null>();

/** Carte d'opacité réduite (160 px max), calculée une fois par image ; null si l'image est opaque. */
export function alphaMaskFor(asset: Asset, bitmap: ImageBitmap): AlphaMask | null {
  const cached = alphaCache.get(asset.id);
  if (cached !== undefined) return cached;
  let mask: AlphaMask | null = null;
  if (asset.mimeType !== 'image/jpeg' && asset.transparency !== false) {
    const s = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bitmap.width * s));
    c.height = Math.max(1, Math.round(bitmap.height * s));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
      const data = new Uint8Array(c.width * c.height);
      for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3];
      mask = { w: c.width, h: c.height, data };
    }
  }
  alphaCache.set(asset.id, mask);
  return mask;
}

export interface BitmapsState {
  bitmaps: Map<string, ImageBitmap>;
  loading: boolean;
  errors: string[];
}

/** Charge les images de plusieurs ressources (éléments d'une composition). */
export function useBitmaps(repo: Repository, assets: Asset[]): BitmapsState {
  const [state, setState] = useState<BitmapsState>({ bitmaps: new Map(), loading: assets.length > 0, errors: [] });
  const ids = [...new Set(assets.map((a) => a.id))].sort().join(',');
  useEffect(() => {
    let cancelled = false;
    const unique = [...new Map(assets.map((a) => [a.id, a])).values()];
    if (unique.length === 0) {
      setState({ bitmaps: new Map(), loading: false, errors: [] });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    Promise.allSettled(unique.map((a) => loadBitmap(repo, a))).then((results) => {
      if (cancelled) return;
      const bitmaps = new Map<string, ImageBitmap>();
      const errors: string[] = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') bitmaps.set(unique[i].id, r.value);
        else errors.push(`Impossible de charger « ${unique[i].title} ».`);
      });
      setState({ bitmaps, loading: false, errors });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, ids]);
  return state;
}
