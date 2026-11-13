import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useApp } from '../../app/AppContext';
import type { Artwork, Asset, Placement, Room } from '../../domain/types';
import { useBitmaps } from '../assets/imageCache';
import { assetForPlacement, look, panelSizeCm, walk, type CameraPose } from './geometry';

export interface RoomViewHandle {
  /** Rendu PNG de la vue courante, à la largeur demandée, avec la mention « Simulation 2,5D ». */
  capture(width: number): Promise<Blob>;
}

interface Props {
  room: Room;
  placements: Placement[];
  artworks: Artwork[];
  assets: Asset[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  silhouette: { xCm: number; zCm: number; heightCm: number } | null;
  /** Pose de la caméra, conservée par le parent pour survivre à la bascule plan / salle. */
  poseRef: MutableRefObject<CameraPose>;
  /** Change quand le parent modifie la pose (hauteur des yeux, retour à l'entrée) : déclenche un nouveau rendu. */
  poseStamp: unknown;
}

const M = 0.01; // centimètres → mètres
const LIGHT = {
  bright: { room: 1, panel: 1, tint: 0xffffff },
  day: { room: 0.97, panel: 1, tint: 0xfff4e6 },
  dark: { room: 0.3, panel: 0.82, tint: 0xfff0dc },
} as const;

function shade(hex: string, factor: number, tint = 0xffffff): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(factor).multiply(new THREE.Color(tint));
}

function bitmapTexture(bitmap: ImageBitmap, max = 2048): THREE.Texture {
  const s = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bitmap.width * s));
  c.height = Math.max(1, Math.round(bitmap.height * s));
  c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function shadowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.42)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** Silhouette humaine schématique (repère d'échelle), dessinée par programme. */
function silhouetteTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 480;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(70,74,78,0.78)';
  ctx.beginPath(); ctx.arc(80, 34, 26, 0, Math.PI * 2); ctx.fill(); // tête
  ctx.beginPath(); ctx.roundRect(38, 68, 84, 190, 30); ctx.fill(); // torse
  ctx.beginPath(); ctx.roundRect(14, 76, 24, 170, 12); ctx.fill(); // bras
  ctx.beginPath(); ctx.roundRect(122, 76, 24, 170, 12); ctx.fill();
  ctx.beginPath(); ctx.roundRect(44, 240, 32, 240, 14); ctx.fill(); // jambes
  ctx.beginPath(); ctx.roundRect(84, 240, 32, 240, 14); ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function disposeObject(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    m.geometry?.dispose?.();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) mat.dispose();
  });
}

/** Vue immersive à la première personne (Simulation 2,5D) : les photographies sont des panneaux à l'échelle déclarée. */
export const RoomView = forwardRef<RoomViewHandle, Props>(function RoomView(
  { room, placements, artworks, assets, selectedId, onSelect, silhouette, poseRef, poseStamp },
  ref,
) {
  const { repo } = useApp();
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    shell: THREE.Group; panels: THREE.Group; figure: THREE.Mesh | null; dirty: boolean;
    textures: Map<string, THREE.Texture>; shadow: THREE.Texture; figureTex: THREE.Texture;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const keys = useRef(new Set<string>());
  const stick = useRef({ f: 0, s: 0 });

  const used = useMemo(
    () => placements.map((p) => assetForPlacement(p, assets)).filter((a): a is Asset => !!a),
    [placements, assets],
  );
  const bitmaps = useBitmaps(repo, used);

  // ---- Initialisation du rendu (une fois) ----
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      setError('L’affichage 3D (WebGL) n’est pas disponible dans ce navigateur. La vue en plan reste utilisable.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.className = 'room-canvas';
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
    const shell = new THREE.Group();
    const panels = new THREE.Group();
    scene.add(shell, panels);
    const state = { renderer, scene, camera, shell, panels, figure: null as THREE.Mesh | null, dirty: true, textures: new Map<string, THREE.Texture>(), shadow: shadowTexture(), figureTex: silhouetteTexture() };
    three.current = state;

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width < 2 || height < 2) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      state.dirty = true;
    });
    ro.observe(el);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const k = keys.current;
      const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + stick.current.f;
      const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + stick.current.s;
      const turn = (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0);
      if (f !== 0 || s !== 0 || turn !== 0) {
        let pose = poseRef.current;
        if (turn !== 0) pose = look(pose, turn * 1.6 * dt, 0);
        pose = walk(pose, f, s, dt, roomRef.current, k.has('ShiftLeft') || k.has('ShiftRight'));
        poseRef.current = pose;
        state.dirty = true;
      }
      if (state.dirty) {
        const p = poseRef.current;
        camera.position.set(p.xCm * M, p.eyeCm * M, p.zCm * M);
        camera.lookAt(
          p.xCm * M + Math.sin(p.yaw) * Math.cos(p.pitch),
          p.eyeCm * M + Math.sin(p.pitch),
          p.zCm * M + Math.cos(p.yaw) * Math.cos(p.pitch),
        );
        if (state.figure) state.figure.rotation.y = Math.atan2(camera.position.x - state.figure.position.x, camera.position.z - state.figure.position.z);
        renderer.render(scene, camera);
        state.dirty = false;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      disposeObject(scene);
      for (const t of state.textures.values()) t.dispose();
      state.shadow.dispose();
      state.figureTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roomRef = useRef(room);
  roomRef.current = room;

  useEffect(() => {
    if (three.current) three.current.dirty = true;
  }, [poseStamp]);

  // ---- Coque de la salle : sol, murs, plafond ----
  useEffect(() => {
    const st = three.current;
    if (!st) return;
    disposeObject(st.shell);
    st.shell.clear();
    const L = room.lengthCm * M, W = room.widthCm * M, H = room.heightCm * M;
    const l = LIGHT[room.light];
    const mat = (hex: string, f: number) => new THREE.MeshBasicMaterial({ color: shade(hex, l.room * f, l.tint), side: THREE.BackSide });
    // Ordre des faces d'une boîte : +x, -x, +y (plafond), -y (sol), +z, -z. Teintes légèrement différentes pour lire les angles.
    const box = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), [
      mat(room.wallColor, 0.9), mat(room.wallColor, 0.94), mat('#ffffff', room.light === 'dark' ? 0.55 : 0.98),
      mat(room.floorColor, 1), mat(room.wallColor, 1), mat(room.wallColor, 0.86),
    ]);
    box.position.set(L / 2, H / 2, W / 2);
    st.shell.add(box);
    // Plinthe : fine bande au pied des murs, pour ancrer le sol.
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(L - 0.002, 0.08, W - 0.002), new THREE.MeshBasicMaterial({ color: shade(room.wallColor, l.room * 0.78, l.tint), side: THREE.BackSide }));
    skirt.position.set(L / 2, 0.04, W / 2);
    st.shell.add(skirt);
    st.scene.background = shade(room.wallColor, l.room * 0.8);
    st.dirty = true;
  }, [room.lengthCm, room.widthCm, room.heightCm, room.wallColor, room.floorColor, room.light]);

  // ---- Panneaux des œuvres, ombres de contact, silhouette ----
  useEffect(() => {
    const st = three.current;
    if (!st) return;
    disposeObject(st.panels);
    st.panels.clear();
    st.figure = null;
    const l = LIGHT[room.light];
    for (const p of placements) {
      const artwork = artworks.find((a) => a.id === p.artworkId);
      const asset = assetForPlacement(p, assets);
      const size = artwork ? panelSizeCm(artwork, asset) : null;
      if (!size) continue;
      const w = size.widthCm * M, h = size.heightCm * M;
      let map: THREE.Texture | null = null;
      const bm = asset ? bitmaps.bitmaps.get(asset.id) : undefined;
      if (asset && bm) {
        map = st.textures.get(asset.id) ?? bitmapTexture(bm);
        st.textures.set(asset.id, map);
      }
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map, color: map ? shade('#ffffff', l.panel, l.tint) : 0x9a9d9c, transparent: true, alphaTest: 0.02, side: THREE.DoubleSide }),
      );
      panel.position.set(p.xCm * M, (p.elevationCm + size.heightCm / 2) * M, p.zCm * M);
      panel.rotation.y = Math.PI + (p.rotationDeg * Math.PI) / 180;
      panel.userData.placementId = p.id;
      st.panels.add(panel);
      if (p.id === selectedId) {
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(panel.geometry), new THREE.LineBasicMaterial({ color: 0x3fa392 }));
        edge.position.copy(panel.position);
        edge.rotation.copy(panel.rotation);
        st.panels.add(edge);
      }
      const r = Math.max(w * 0.75, 0.25);
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 1.3), new THREE.MeshBasicMaterial({ map: st.shadow, transparent: true, depthWrite: false, opacity: p.elevationCm > 0 ? 0.45 : 1 }));
      sh.rotation.x = -Math.PI / 2;
      sh.rotation.z = -(p.rotationDeg * Math.PI) / 180;
      sh.position.set(p.xCm * M, 0.006, p.zCm * M);
      st.panels.add(sh);
    }
    if (silhouette) {
      const h = silhouette.heightCm * M;
      const fig = new THREE.Mesh(new THREE.PlaneGeometry(h / 3, h), new THREE.MeshBasicMaterial({ map: st.figureTex, transparent: true, alphaTest: 0.02, side: THREE.DoubleSide, color: shade('#ffffff', Math.max(0.6, l.room)) }));
      fig.position.set(silhouette.xCm * M, h / 2, silhouette.zCm * M);
      st.panels.add(fig);
      st.figure = fig;
    }
    st.dirty = true;
  }, [placements, artworks, assets, bitmaps.bitmaps, selectedId, silhouette, room.light]);

  useImperativeHandle(ref, () => ({
    async capture(width: number) {
      const st = three.current;
      if (!st) throw new Error('La vue 3D n’est pas disponible.');
      const el = st.renderer.domElement;
      const aspect = el.clientWidth / Math.max(1, el.clientHeight);
      const prevRatio = st.renderer.getPixelRatio();
      const w = Math.round(width), h = Math.round(width / aspect);
      st.renderer.setPixelRatio(1);
      st.renderer.setSize(w, h, false);
      st.renderer.render(st.scene, st.camera);
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const ctx = out.getContext('2d')!;
      ctx.drawImage(el, 0, 0, w, h);
      st.renderer.setPixelRatio(prevRatio);
      st.renderer.setSize(el.clientWidth, el.clientHeight, false);
      st.dirty = true;
      const size = Math.max(12, Math.round(w / 90));
      ctx.font = `500 ${size}px "Archivo Variable", system-ui, sans-serif`;
      const text = 'Simulation 2,5D';
      const pad = Math.round(size * 0.6);
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(w - tw - pad * 3, h - size - pad * 3, tw + pad * 2, size + pad * 1.6);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'top';
      ctx.fillText(text, w - tw - pad * 2, h - size - pad * 2.2);
      return new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Export impossible : réduis la largeur.'))), 'image/png'));
    },
  }), []);

  // ---- Interactions : regarder (glisser), marcher (clavier, joystick), sélectionner (clic) ----
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null);
  function onPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('.joystick')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, moved: 0 };
    host.current?.focus();
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    const st = three.current;
    if (!d || !st) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy);
    poseRef.current = look(poseRef.current, -dx * 0.0042, -dy * 0.0042);
    st.dirty = true;
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    const st = three.current;
    if (!d || !st || d.moved > 5) return;
    // Clic sans glisser : sélection de l'œuvre visée.
    const rect = st.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, st.camera);
    const hit = ray.intersectObjects(st.panels.children, false).find((h) => h.object.userData.placementId);
    onSelect(hit ? (hit.object.userData.placementId as string) : null);
  }

  function joystick(e: React.PointerEvent<HTMLDivElement>, on: boolean) {
    if (!on) { stick.current = { f: 0, s: 0 }; return; }
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1;
    const y = ((e.clientY - r.top) / r.height) * 2 - 1;
    stick.current = { f: Math.max(-1, Math.min(1, -y)), s: Math.max(-1, Math.min(1, x)) };
  }

  if (error) return <div className="room-view"><p className="error-box" role="alert">{error}</p></div>;

  return (
    <div
      className="room-view"
      ref={host}
      tabIndex={0}
      role="application"
      aria-roledescription="salle d’exposition simulée"
      aria-label={`${room.title}, ${placements.length} œuvre${placements.length > 1 ? 's' : ''} placée${placements.length > 1 ? 's' : ''}. Flèches haut et bas ou touches Z et S : avancer et reculer. Q et D : pas de côté. Flèches gauche et droite : tourner. Maj : plus vite.`}
      onFocus={() => setActive(true)}
      onBlur={() => { setActive(false); keys.current.clear(); }}
      onKeyDown={(e) => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
          if (e.code.startsWith('Arrow')) e.preventDefault();
          keys.current.add(e.code);
        }
      }}
      onKeyUp={(e) => keys.current.delete(e.code)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { drag.current = null; }}
    >
      <span className="stage-tag">Simulation 2,5D</span>
      {!active && <span className="room-hint">Clique dans la salle, puis flèches ou ZQSD pour te déplacer ; glisse pour regarder autour.</span>}
      {bitmaps.loading && <span className="stage-status" role="status">Chargement des images…</span>}
      {bitmaps.errors[0] && <span className="stage-status stage-error" role="alert">{bitmaps.errors[0]}</span>}
      <div
        className="joystick"
        aria-hidden="true"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); joystick(e, true); }}
        onPointerMove={(e) => e.buttons > 0 || e.pointerType === 'touch' ? joystick(e, true) : undefined}
        onPointerUp={(e) => joystick(e, false)}
        onPointerCancel={(e) => joystick(e, false)}
      ><span /></div>
    </div>
  );
});
