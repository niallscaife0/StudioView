import type { Repository } from '../../data/repository';
import { canvasToBlob, decodeImage, makeThumbnail } from '../assets/imageProcessing';

/**
 * Données FICTIVES pour essayer l'outil en mode local : formes dessinées par programme,
 * aucune image d'œuvre réelle. Tous les titres portent la mention « fictif ».
 */

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  return { c, ctx };
}

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function drawRopeFigure(): HTMLCanvasElement {
  const { c, ctx } = makeCanvas(700, 1100);
  const rnd = seeded(7);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Faisceau de « cordes » : courbes entrelacées autour d'un axe vertical.
  for (let i = 0; i < 26; i++) {
    ctx.beginPath();
    let x = 350 + (rnd() - 0.5) * 80;
    ctx.moveTo(x, 60);
    for (let y = 60; y <= 1040; y += 70) {
      const sway = Math.sin(y / 130 + i) * (60 + 90 * Math.sin(y / 420));
      x = 350 + sway + (rnd() - 0.5) * 40;
      ctx.quadraticCurveTo(350 + sway * 1.4, y - 35, x, y);
    }
    ctx.strokeStyle = i % 5 === 0 ? '#b0703f' : `hsl(38, 22%, ${32 + rnd() * 26}%)`;
    ctx.lineWidth = i % 5 === 0 ? 5 : 9 + rnd() * 5;
    ctx.stroke();
  }
  // Nœuds
  for (let k = 0; k < 6; k++) {
    const y = 160 + k * 150;
    ctx.beginPath();
    ctx.ellipse(350 + Math.sin(k) * 50, y, 46, 30, k, 0, Math.PI * 2);
    ctx.strokeStyle = '#5f5242';
    ctx.lineWidth = 14;
    ctx.stroke();
  }
  return c;
}

function drawRoom(dark: boolean): HTMLCanvasElement {
  const { c, ctx } = makeCanvas(1920, 1280);
  const wall = ctx.createLinearGradient(0, 0, 0, 900);
  wall.addColorStop(0, dark ? '#2b2d30' : '#f2f2ef');
  wall.addColorStop(1, dark ? '#1a1b1d' : '#dededa');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, 1920, 900);
  const floor = ctx.createLinearGradient(0, 900, 0, 1280);
  floor.addColorStop(0, dark ? '#141414' : '#b9b5ac');
  floor.addColorStop(1, dark ? '#0c0c0c' : '#9d998f');
  ctx.fillStyle = floor;
  ctx.fillRect(0, 900, 1920, 380);
  ctx.fillStyle = dark ? '#000' : '#f8f8f6';
  ctx.fillRect(0, 888, 1920, 14); // plinthe
  if (dark) {
    const spot = ctx.createRadialGradient(960, 760, 40, 960, 760, 620);
    spot.addColorStop(0, 'rgba(255,240,215,0.28)');
    spot.addColorStop(1, 'rgba(255,240,215,0)');
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, 1920, 1280);
  }
  return c;
}

async function store(repo: Repository, canvas: HTMLCanvasElement, title: string, artworkId: string | null, kind: 'cutout' | 'background') {
  const blob = await canvasToBlob(canvas, 'image/png');
  const decoded = await decodeImage(blob);
  const thumbnail = await makeThumbnail(decoded);
  decoded.bitmap.close();
  return repo.createAsset({
    artworkId,
    kind,
    title,
    mimeType: 'image/png',
    width: canvas.width,
    height: canvas.height,
    transparency: kind === 'cutout',
    original: blob,
    thumbnail,
  });
}

export async function createDemoData(repo: Repository) {
  if (repo.mode !== 'local') throw new Error('Les données fictives ne sont disponibles qu’en mode local.');
  const artwork = await repo.createArtwork('Sculpture fictive (démo)');
  await store(repo, drawRopeFigure(), 'Vue détourée (fictif)', artwork.id, 'cutout');
  await store(repo, drawRoom(false), 'Salle blanche (fictif)', null, 'background');
  await store(repo, drawRoom(true), 'Salle sombre (fictif)', null, 'background');
  return artwork;
}
