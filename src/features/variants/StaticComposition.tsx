import type { Asset, Variant } from '../../domain/types';
import { StudioCanvas } from '../studio2d/StudioCanvas';

/** Rendu en lecture seule d'une variante ENREGISTRÉE, à partir de ses paramètres stockés. */
export function StaticComposition({ variant, assets }: { variant: Variant; assets: Asset[] }) {
  const bg = assets.find((a) => a.id === variant.backgroundAssetId) ?? null;
  const fg = assets.find((a) => a.id === variant.foregroundAssetId) ?? null;
  return <StudioCanvas background={bg} foreground={fg} transform={variant.transform} label={`Variante ${variant.name}`} />;
}
