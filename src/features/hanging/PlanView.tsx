import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { Artwork, Asset, Placement, Room } from '../../domain/types';
import { assetForPlacement, clampPlacement, clampToRoom, formatCm, panelSizeCm, wallDistances, type CameraPose } from './geometry';

interface Props {
  room: Room;
  placements: Placement[];
  artworks: Artwork[];
  assets: Asset[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<Placement>) => void;
  onRemove: (id: string) => void;
  silhouette: { xCm: number; zCm: number } | null;
  onMoveSilhouette: (xCm: number, zCm: number) => void;
  pose: CameraPose;
  onMoveCamera: (xCm: number, zCm: number) => void;
}

type Drag = { kind: 'placement'; id: string; dx: number; dz: number } | { kind: 'silhouette' } | { kind: 'camera' };

/** Vue en plan (dessus) : disposer les œuvres comme sur un plan d'accrochage. x vers la droite, z vers le bas. */
export function PlanView({ room, placements, artworks, assets, selectedId, onSelect, onChange, onRemove, silhouette, onMoveSilhouette, pose, onMoveCamera }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const L = room.lengthCm, W = room.widthCm;
  const pad = Math.max(L, W) * 0.09;
  const font = Math.max(L, W) / 46;
  const selected = placements.find((p) => p.id === selectedId) ?? null;

  function toRoom(e: PointerEvent) {
    const el = svg.current!;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = el.getScreenCTM();
    if (!m) return { x: 0, z: 0 };
    const r = pt.matrixTransform(m.inverse());
    return { x: r.x, z: r.y };
  }

  function onMove(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = toRoom(e);
    if (d.kind === 'placement') {
      const src = placements.find((x) => x.id === d.id);
      if (src) {
        const c = clampPlacement({ ...src, xCm: p.x - d.dx, zCm: p.z - d.dz }, room);
        onChange(d.id, { xCm: c.xCm, zCm: c.zCm });
      }
    } else {
      const c = clampToRoom(p.x, p.z, room, 25);
      if (d.kind === 'silhouette') onMoveSilhouette(Math.round(c.x), Math.round(c.z));
      else onMoveCamera(Math.round(c.x), Math.round(c.z));
    }
  }

  function start(e: PointerEvent, d: Drag) {
    e.stopPropagation();
    svg.current?.setPointerCapture(e.pointerId);
    drag.current = d;
  }

  function onKey(e: KeyboardEvent, p: Placement) {
    const step = e.shiftKey ? 50 : 5;
    const moves: Record<string, Partial<Placement>> = {
      ArrowLeft: { xCm: p.xCm - step }, ArrowRight: { xCm: p.xCm + step },
      ArrowUp: { zCm: p.zCm - step }, ArrowDown: { zCm: p.zCm + step },
      '[': { rotationDeg: p.rotationDeg - (e.shiftKey ? 15 : 5) }, ']': { rotationDeg: p.rotationDeg + (e.shiftKey ? 15 : 5) },
    };
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onRemove(p.id); return; }
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      const c = clampPlacement({ ...p, ...m }, room);
      onChange(p.id, { xCm: c.xCm, zCm: c.zCm, rotationDeg: c.rotationDeg });
    }
  }

  const wd = selected ? wallDistances(selected, room) : null;

  return (
    <div className="plan-view">
      <svg
        ref={svg}
        viewBox={`${-pad} ${-pad} ${L + pad * 2} ${W + pad * 2}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={`Plan de ${room.title}, ${formatCm(L)} sur ${formatCm(W)}`}
        onPointerMove={onMove}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onPointerDown={() => onSelect(null)}
      >
        <rect x={0} y={0} width={L} height={W} className="plan-floor" style={{ fill: room.floorColor }} />
        <rect x={0} y={0} width={L} height={W} className="plan-walls" strokeWidth={font * 0.35} />
        <text x={L / 2} y={-pad * 0.35} fontSize={font} textAnchor="middle" className="plan-dim">{formatCm(L)}</text>
        <text x={-pad * 0.35} y={W / 2} fontSize={font} textAnchor="middle" className="plan-dim" transform={`rotate(-90 ${-pad * 0.35} ${W / 2})`}>{formatCm(W)}</text>
        <text x={L / 2} y={font * 1.3} fontSize={font * 0.8} textAnchor="middle" className="plan-note">mur d’entrée</text>

        {selected && wd && (
          <g className="plan-cotes" strokeWidth={font * 0.08} fontSize={font * 0.85}>
            <line x1={0} y1={selected.zCm} x2={selected.xCm} y2={selected.zCm} />
            <line x1={selected.xCm} y1={selected.zCm} x2={L} y2={selected.zCm} />
            <line x1={selected.xCm} y1={0} x2={selected.xCm} y2={selected.zCm} />
            <line x1={selected.xCm} y1={selected.zCm} x2={selected.xCm} y2={W} />
            <text x={selected.xCm / 2} y={selected.zCm - font * 0.4} textAnchor="middle">{formatCm(wd.left)}</text>
            <text x={(selected.xCm + L) / 2} y={selected.zCm - font * 0.4} textAnchor="middle">{formatCm(wd.right)}</text>
            <text x={selected.xCm + font * 0.4} y={selected.zCm / 2}>{formatCm(wd.front)}</text>
            <text x={selected.xCm + font * 0.4} y={(selected.zCm + W) / 2}>{formatCm(wd.back)}</text>
          </g>
        )}

        {placements.map((p) => {
          const artwork = artworks.find((a) => a.id === p.artworkId);
          const size = artwork ? panelSizeCm(artwork, assetForPlacement(p, assets)) : null;
          const w = size?.widthCm ?? 60;
          const sel = p.id === selectedId;
          return (
            <g
              key={p.id}
              transform={`translate(${p.xCm} ${p.zCm})`}
              className={`plan-item${sel ? ' is-selected' : ''}`}
              tabIndex={0}
              role="button"
              aria-pressed={sel}
              aria-label={`${artwork?.title ?? 'Œuvre'}, à ${formatCm(p.xCm)} du mur gauche et ${formatCm(p.zCm)} du mur d’entrée, orientation ${p.rotationDeg}°. Flèches : déplacer ; crochets : tourner ; Suppr : retirer.`}
              onFocus={() => onSelect(p.id)}
              onKeyDown={(e) => onKey(e, p)}
              onPointerDown={(e) => {
                const r = toRoom(e);
                onSelect(p.id);
                start(e, { kind: 'placement', id: p.id, dx: r.x - p.xCm, dz: r.z - p.zCm });
              }}
            >
              <circle r={Math.max(w / 2, 22)} className="plan-hit" />
              {/* Le panneau vu de dessus : un trait de la largeur de l'œuvre ; le petit trait indique la face. */}
              <g transform={`rotate(${-p.rotationDeg})`}>
                <line x1={-w / 2} y1={0} x2={w / 2} y2={0} className="plan-panel" strokeWidth={font * 0.45} />
                <line x1={0} y1={0} x2={0} y2={-font * 1.1} className="plan-face" strokeWidth={font * 0.18} />
              </g>
              <text y={font * 1.6} fontSize={font * 0.85} textAnchor="middle" className="plan-label">
                {artwork?.title ?? '?'}{artwork?.heightCm ? `, ${formatCm(artwork.heightCm)}` : ''}
              </text>
            </g>
          );
        })}

        {silhouette && (
          <g transform={`translate(${silhouette.xCm} ${silhouette.zCm})`} className="plan-silhouette" onPointerDown={(e) => start(e, { kind: 'silhouette' })}>
            <circle r={24} />
            <text y={font * 1.5} fontSize={font * 0.75} textAnchor="middle">silhouette</text>
          </g>
        )}

        <g transform={`translate(${pose.xCm} ${pose.zCm}) rotate(${(-pose.yaw * 180) / Math.PI})`} className="plan-camera" onPointerDown={(e) => start(e, { kind: 'camera' })}>
          <path d={`M 0 ${font * 1.4} L ${font * 0.8} ${-font * 0.6} L ${-font * 0.8} ${-font * 0.6} Z`} />
          <title>Ta position dans la salle (glisse pour la déplacer)</title>
        </g>
      </svg>
      <span className="stage-tag">Vue en plan</span>
    </div>
  );
}
