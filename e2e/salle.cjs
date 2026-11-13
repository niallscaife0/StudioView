/**
 * Recette E2E de la salle 2,5D (V2 phase 3), mode démo local, vrai navigateur avec WebGL.
 * Prérequis : identiques à run.cjs. Usage : CHROME_PATH=... node e2e/salle.cjs
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const png = require('./mkpng.cjs');
const BASE = process.env.BASE_URL || 'http://localhost:4173';
const OUT = path.join(__dirname, 'resultats');
const FIX = path.join(__dirname, 'fixtures');
const log = (...a) => console.log('•', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickText(page, selector, text) {
  for (const el of await page.$$(selector)) {
    const t = await el.evaluate((e) => e.textContent.trim());
    if (t === text || t.includes(text)) { await el.click(); return; }
  }
  throw new Error(`Introuvable : ${selector} « ${text} »`);
}

async function createArtwork(page, title, file, height) {
  await page.goto(`${BASE}/atelier`, { waitUntil: 'networkidle0' });
  await clickText(page, 'button', 'Ajouter une œuvre');
  await page.type('#new-title', title);
  await clickText(page, 'button', 'Créer');
  await page.waitForFunction(() => location.pathname.startsWith('/oeuvres/'));
  await page.waitForSelector('.importer input[type=file]');
  await (await page.$('.importer input[type=file]')).uploadFile(file);
  await page.waitForSelector('.photo-card');
  await page.type('#artwork-height', String(height));
  await clickText(page, '.height-field button', 'Enregistrer');
  await page.waitForFunction(() => /Dimension déclarée/.test(document.querySelector('.height-field').textContent));
}

(async () => {
  if (!process.env.CHROME_PATH) throw new Error('Définis CHROME_PATH.');
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(FIX, { recursive: true });
  const tall = path.join(FIX, 'figure.png');
  const small = path.join(FIX, 'masse.png');
  fs.writeFileSync(tall, png(300, 600, (x, y) => { const cx = 150 + Math.sin(y / 45) * 55; return Math.abs(x - cx) < 38 ? [150, 118, 82, 255] : [0, 0, 0, 0]; }));
  fs.writeFileSync(small, png(400, 300, (x, y) => (Math.hypot((x - 200) / 190, (y - 160) / 135) < 1 ? [120, 96, 70, 255] : [0, 0, 0, 0])));

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH,
    args: ['--no-sandbox', '--window-size=1440,900', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    defaultViewport: { width: 1440, height: 900 },
    headless: true,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const dl = path.join(OUT, 'downloads-salle');
  fs.mkdirSync(dl, { recursive: true });
  await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });

  await createArtwork(page, 'Figure linéaire', tall, 175);
  await createArtwork(page, 'Figure condensée', small, 60);
  log('Deux œuvres créées, hauteurs déclarées 175 cm et 60 cm');

  // Salle et accrochage
  await page.goto(`${BASE}/accrochages`, { waitUntil: 'networkidle0' });
  await clickText(page, 'button', 'Nouvelle salle');
  await page.type('.room-form-title input', 'Galerie de quartier');
  await clickText(page, 'button', 'Créer la salle');
  await page.waitForSelector('.room-block');
  log('Salle créée :', (await page.$eval('.room-dims', (e) => e.textContent)).trim());
  await clickText(page, 'button', 'Nouvel accrochage');
  await page.waitForSelector('.plan-view svg');

  // Placer les deux œuvres en plan
  const placeButtons = await page.$$('.place-row .button');
  await placeButtons[0].click();
  await placeButtons[1].click();
  await page.waitForFunction(() => document.querySelectorAll('.plan-item').length === 2);
  // Déplacer la seconde au clavier (Maj+flèche = 50 cm)
  await page.evaluate(() => document.querySelectorAll('.plan-item')[1].focus());
  const before = await page.$eval('.num-grid input', (e) => e.value);
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  const after = await page.$eval('.num-grid input', (e) => e.value);
  log(`Déplacement clavier en plan : ${before} cm → ${after} cm depuis le mur gauche`);
  // Silhouette
  await page.click('.studio-left input[type=checkbox]');
  await sleep(200);
  await page.screenshot({ path: `${OUT}/20-accrochage-plan.png` });
  await clickText(page, 'button', 'Enregistrer');
  await page.waitForFunction(() => document.querySelector('.save-state').textContent === 'Enregistré');
  log('Accrochage enregistré');

  // Vue immersive
  await clickText(page, '.view-switch .tab', 'Salle');
  await page.waitForSelector('.room-canvas');
  await sleep(1500);
  const webgl = await page.evaluate(() => !!document.querySelector('.room-canvas') && !document.querySelector('.room-view .error-box'));
  log('Rendu WebGL actif :', webgl);
  await page.screenshot({ path: `${OUT}/21-salle-entree.png` });

  // Marcher vers le fond : la position doit changer, puis buter contre le mur
  await page.click('.room-view');
  await page.keyboard.down('KeyW');
  await sleep(1500);
  await page.keyboard.up('KeyW');
  await sleep(200);
  await page.screenshot({ path: `${OUT}/22-salle-avance.png` });
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await sleep(4000);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  // Retour au plan : le marqueur de position reflète la marche
  await clickText(page, '.view-switch .tab', 'Plan');
  await page.waitForSelector('.plan-camera');
  const cam = await page.$eval('.plan-camera', (g) => g.getAttribute('transform'));
  const z = Number(/translate\(([\d.]+) ([\d.]+)\)/.exec(cam)[2]);
  log(`Après la marche, position sur le plan : z = ${Math.round(z)} cm (mur du fond à 600 cm, corps de 25 cm) →`, Math.round(z) === 575 ? 'arrêt contre le mur' : 'INATTENDU');

  // Regarder vers l'arrière puis export
  await clickText(page, 'button', 'Revenir à l’entrée');
  await clickText(page, '.view-switch .tab', 'Salle');
  await page.waitForSelector('.room-canvas');
  await sleep(1200);
  await clickText(page, 'button', 'Exporter la vue (PNG)');
  await sleep(2500);
  const files = fs.readdirSync(dl);
  const buf = files[0] ? fs.readFileSync(path.join(dl, files[0])) : null;
  log('Export :', files.join(', ') || 'AUCUN', buf ? `${buf.readUInt32BE(16)} × ${buf.readUInt32BE(20)} px` : '');

  // Rechargement : l'accrochage est retrouvé
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.plan-item');
  log('Après rechargement, œuvres placées :', await page.$$eval('.plan-item', (i) => i.length));

  // Dupliquer en variante B
  await clickText(page, 'button', 'Dupliquer comme variante');
  await page.waitForFunction(() => document.querySelectorAll('.variant-tab').length === 2);
  log('Variantes :', (await page.$$eval('.variant-tab', (t) => t.map((e) => e.textContent))).join(', '));

  // Mobile
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.plan-view svg');
  await clickText(page, '.view-switch .tab', 'Salle');
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/23-salle-mobile.png` });

  console.log('\nErreurs console :', errors.length ? errors : 'aucune');
  await browser.close();
})().catch((e) => { console.error('ÉCHEC E2E :', e.message); process.exit(1); });
