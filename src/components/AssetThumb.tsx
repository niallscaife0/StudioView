import { useApp } from '../app/AppContext';
import type { Asset } from '../domain/types';
import { useThumbnailUrl } from '../features/assets/imageCache';

export function AssetThumb({ asset, className = '' }: { asset: Asset | null | undefined; className?: string }) {
  const { repo } = useApp();
  const { url, error } = useThumbnailUrl(repo, asset);
  const checker = asset?.transparency ? ' is-transparent' : '';
  if (!asset) return <div className={`thumb thumb-empty ${className}`} aria-hidden="true" />;
  if (error) return <div className={`thumb thumb-error ${className}`} role="img" aria-label={`Miniature indisponible : ${asset.title}`}>!</div>;
  if (!url) return <div className={`thumb thumb-loading${checker} ${className}`} aria-busy="true" aria-label={`Chargement : ${asset.title}`} />;
  return <img className={`thumb${checker} ${className}`} src={url} alt={asset.title} loading="lazy" draggable={false} />;
}
