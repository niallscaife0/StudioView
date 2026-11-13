/**
 * Recette E2E du parcours prioritaire (mode démo local), dans un vrai navigateur.
 * Prérequis : `npm run build && npx vite preview --port 4173` dans un autre terminal,
 * puis `npm install --no-save puppeteer-core` et CHROME_PATH=/chemin/vers/chrome.
 * Usage : CHROME_PATH=... node e2e/run.cjs
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const png = require('./mkpng.cjs');
const BASE = process.env.BASE_URL || 'http://localhost:4173';
const OUT = path.join(__dirname, 'resultats');
const FIX = path.join(__dirname, 'fixtures');
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('•', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickText(page, selector, text) {
  const els = await page.$$(selector);
  for (const el of els) {
    const t = await el.evaluate((e) => e.textContent.trim());
    if (t === text || t.includes(text)) { await el.click(); return; }
  }
  throw new Error(`Introuvable : ${selector} « ${text} »`);
}

function fixtures() {
  fs.mkdirSync(FIX, { recursive: true });
  fs.writeFileSync(path.join(FIX, 'sculpture-detouree.png'), png(300, 500, (x, y) => { const cx = 150 + Math.sin(y / 40) * 50; return Math.abs(x - cx) < 40 + ((y / 7) % 12) ? [120, 95, 70, 255] : [0, 0, 0, 0]; }));
  fs.writeFileSync(path.join(FIX, 'galerie-blanche.png'), png(900, 600, (x, y) => (y < 420 ? [236, 236, 232, 255] : [180, 176, 168, 255])));
  fs.writeFileSync(path.join(FIX, 'salle-sombre.png'), png(800, 600, (x, y) => (y < 420 ? [40, 42, 46, 255] : [20, 20, 20, 255])));
  fs.writeFileSync(path.join(FIX, 'faux.jpg'), '<html>pas une image</html>');
}

(async () => {
  if (!process.env.CHROME_PATH) throw new Error('Définis CHROME_PATH (chemin d’un Chrome ou Chromium).');
  fixtures();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH,
    args: ['--no-sandbox', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
    headless: true,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const dl = path.join(OUT, 'downloads');
  fs.mkdirSync(dl, { recursive: true });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });

  // 1. Atelier vide
  await page.goto(`${BASE}/atelier`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.empty');
  await page.screenshot({ path: `${OUT}/01-atelier-vide.png` });
  log('Atelier vide affiché');

  // 2. Créer une œuvre
  await clickText(page, 'button', 'Ajouter une œuvre');
  await page.type('#new-title', 'Figure linéaire');
  await clickText(page, 'button', 'Créer');
  await page.waitForFunction(() => location.pathname.startsWith('/oeuvres/'));
  log('Œuvre créée →', await page.evaluate(() => location.pathname));

  // 3. Import d'un faux fichier → erreur visible, rien enregistré
  await page.waitForSelector('.importer input[type=file]');
  const input = await page.$('.importer input[type=file]');
  await input.uploadFile(path.join(FIX, 'faux.jpg'));
  await page.waitForSelector('.error-box');
  log('Erreur faux fichier :', (await page.$eval('.error-box li', (e) => e.textContent)).slice(0, 90));

  // 4. Import de la photo détourée
  await (await page.$('.importer input[type=file]')).uploadFile(path.join(FIX, 'sculpture-detouree.png'));
  await page.waitForSelector('.photo-card');
  const kind = await page.$eval('.photo-card select', (s) => s.value);
  log('Photo importée, type détecté :', kind);

  // 5. Deux décors via Ressources
  await page.goto(`${BASE}/ressources`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[role=tab]');
  await clickText(page, '[role=tab]', 'Décors');
  await page.waitForSelector('.importer input[type=file]');
  await (await page.$('.importer input[type=file]')).uploadFile(path.join(FIX, 'galerie-blanche.png'), path.join(FIX, 'salle-sombre.png'));
  await page.waitForFunction(() => document.querySelectorAll('.asset-table tbody tr').length === 2);
  await sleep(300);
  await page.screenshot({ path: `${OUT}/02-ressources.png` });
  log('Deux décors importés');

  // 6. Créer une présentation
  await page.goto(`${BASE}/atelier`, { waitUntil: 'networkidle0' });
  await page.click('.artwork-card');
  await page.waitForSelector('.photo-card');
  await clickText(page, 'button', 'Créer une présentation');
  await page.waitForSelector('.modal');
  await clickText(page, '.modal button', 'Ouvrir dans le studio');
  await page.waitForSelector('.stage-canvas.is-interactive');
  await sleep(600);
  await page.screenshot({ path: `${OUT}/03-studio-A.png` });
  log('Studio ouvert, variante A');

  // 7. Manipuler : glisser la sculpture
  const box = await (await page.$('.stage-canvas')).boundingBox();
  const cx = box.x + box.width * 0.5, cy = box.y + box.height * 0.55;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - box.width * 0.2, cy, { steps: 8 });
  await page.mouse.up();
  const xA = await page.$eval('#sl-Horizontal', (e) => e.value);
  log('Après glissement, position horizontale =', xA);
  // échelle au clavier
  await page.focus('.stage-canvas');
  for (let i = 0; i < 6; i++) await page.keyboard.press('-');
  const state1 = await page.$eval('.save-state', (e) => e.textContent);
  log('État :', state1);
  await clickText(page, 'button', 'Enregistrer');
  await page.waitForFunction(() => document.querySelector('.save-state').textContent === 'Enregistré');
  const scaleA = await page.$eval('#sl-Hauteur-dans-le-cadre', (e) => e.value);
  log('Variante A enregistrée, échelle =', scaleA);

  // 7 bis. Plusieurs éléments (V2, F-25/F-26) : ajouter, sélectionner au clic, réordonner, masquer
  await page.click('.pick-add');
  await page.click('.pick-add');
  await page.waitForFunction(() => document.querySelectorAll('.item-row').length === 3);
  log('Trois éléments dans la composition');
  // Le dernier ajouté est sélectionné et au premier plan (premier de la liste)
  const topSelected = await page.$eval('.item-row', (r) => r.classList.contains('is-selected'));
  log('Dernier ajouté sélectionné et au premier plan :', topSelected);
  // Déplacer l'élément sélectionné à droite, sans bouger les autres
  await page.focus('.stage-canvas');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  // Clic dans l'aperçu sur le premier élément (resté à 30 %) : il devient la sélection
  const b2 = await (await page.$('.stage-canvas')).boundingBox();
  await page.mouse.click(b2.x + b2.width * 0.3, b2.y + b2.height * 0.55);
  const selByClick = await page.$$eval('.item-row', (rows) => rows.findIndex((r) => r.classList.contains('is-selected')));
  log('Sélection par clic dans l’aperçu → ligne', selByClick, '(2 = élément du fond)');
  // Le passer devant, puis masquer l'élément du milieu
  await clickText(page, 'button', 'Vers l’avant');
  await clickText(page, 'button', 'Vers l’avant');
  const afterMove = await page.$$eval('.item-row', (rows) => rows.findIndex((r) => r.classList.contains('is-selected')));
  log('Après deux « Vers l’avant » → ligne', afterMove, '(0 = premier plan)');
  const toggles = await page.$$('.item-row:nth-child(2) .icon-toggle');
  await toggles[0].click();
  await page.focus('.stage-canvas');
  await sleep(300);
  await page.screenshot({ path: `${OUT}/03b-studio-trois-elements.png` });
  await clickText(page, 'button', 'Enregistrer');
  await page.waitForFunction(() => document.querySelector('.save-state').textContent === 'Enregistré');
  const orderSaved = await page.$$eval('.item-row', (rows) => rows.map((r) => (r.classList.contains('is-hidden') ? 'masqué' : 'visible')).join(','));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.item-row');
  const orderReloaded = await page.$$eval('.item-row', (rows) => rows.map((r) => (r.classList.contains('is-hidden') ? 'masqué' : 'visible')).join(','));
  log('Éléments après rechargement :', orderReloaded, orderReloaded === orderSaved ? '(identique)' : '(DIFFÉRENT !)');
  // Re-sélectionner l'élément du premier plan pour la suite
  await page.click('.item-row .item-name');

  // 8. Dupliquer → B, changer de décor et de position
  await clickText(page, 'button', 'Dupliquer comme variante');
  await page.waitForFunction(() => [...document.querySelectorAll('.variant-tab')].length === 2 && document.querySelector('.variant-tab.is-active').textContent === 'B');
  await sleep(300);
  await clickText(page, '.studio-left [role=radio]', 'salle sombre');
  await page.focus('.stage-canvas');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await sleep(200);
  await page.screenshot({ path: `${OUT}/04-studio-B-modifie.png` });
  await clickText(page, 'button', 'Enregistrer');
  await page.waitForFunction(() => document.querySelector('.save-state').textContent === 'Enregistré');
  const xB = await page.$eval('#sl-Horizontal', (e) => e.value);
  log('Variante B enregistrée, position =', xB);

  // 9. Changer de variante avec des modifications non enregistrées → confirmation
  await page.focus('.stage-canvas');
  await page.keyboard.press('ArrowUp');
  await clickText(page, '.variant-tab', 'A');
  await page.waitForSelector('.modal');
  log('Confirmation affichée :', await page.$eval('.modal h2', (e) => e.textContent));
  await clickText(page, '.modal button', 'Abandonner');
  await page.waitForFunction(() => document.querySelector('.variant-tab.is-active').textContent === 'A');
  const xA2 = await page.$eval('#sl-Horizontal', (e) => e.value);
  log('Retour sur A, position =', xA2, xA2 === xA ? '(identique à l’enregistrement)' : '(DIFFÉRENT !)');

  // 10. Comparer
  await clickText(page, 'a', 'Comparer');
  await page.waitForSelector('.compare');
  await sleep(800);
  await page.screenshot({ path: `${OUT}/05-comparaison.png` });
  const facts = await page.$$eval('.facts', (f) => f.map((x) => x.textContent));
  log('Comparaison :', facts.join(' | '));

  // 11. Export PNG
  await clickText(page, '.compare-side:first-child button', 'Exporter');
  await page.waitForSelector('.modal');
  await clickText(page, '.modal button', 'Télécharger le PNG');
  await sleep(1500);
  const files = fs.readdirSync(dl);
  log('Fichier exporté :', files.join(', '));

  // 12. Rechargement complet : tout est retrouvé
  await page.goto(`${BASE}/variantes`, { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.variant-list li');
  const names = await page.$$eval('.variant-link', (l) => l.map((e) => e.textContent));
  log('Après rechargement complet, variantes :', names.join(', '));
  await page.screenshot({ path: `${OUT}/06-variantes.png` });

  // 12 bis. Reprise V1 (F-27) : une variante à l'ancien format, injectée dans le navigateur, reste lisible
  const legacyOk = await page.evaluate(async () => {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open('laboratoire-sculpture'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = (db, s) => new Promise((res) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); });
    const db = await open();
    const [pres] = await all(db, 'presentations');
    const assets = await all(db, 'assets');
    const photo = assets.find((a) => a.kind === 'cutout');
    await new Promise((res) => {
      const tx = db.transaction('variants', 'readwrite');
      tx.objectStore('variants').put({
        id: 'legacy-v1', presentationId: pres.id, name: 'Ancienne V1', backgroundAssetId: null, foregroundAssetId: photo.id,
        transform: { schemaVersion: 1, x: 0.25, y: 0.5, scale: 0.8, rotationDeg: 0 }, note: null,
        createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
      }, 'legacy-v1');
      tx.oncomplete = res;
    });
    db.close();
    return pres.id;
  });
  await page.goto(`${BASE}/studio/${legacyOk}?variant=legacy-v1`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.item-row');
  const legacyItems = await page.$$eval('.item-row', (r) => r.length);
  const legacyX = await page.$eval('#sl-Horizontal', (e) => e.value);
  log('Variante V1 reprise :', legacyItems, 'élément, position', legacyX, legacyX === '0.25' ? '(identique)' : '(DIFFÉRENT !)');

  await page.goto(`${BASE}/atelier`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.artwork-card img');
  await sleep(300);
  await page.screenshot({ path: `${OUT}/07-atelier.png` });

  // 13. Mobile
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${BASE}/variantes`, { waitUntil: 'networkidle0' });
  await page.click('.variant-link');
  await page.waitForSelector('.stage-canvas');
  await sleep(600);
  await page.screenshot({ path: `${OUT}/08-mobile-studio.png` });

  console.log('\nErreurs console :', errors.length ? errors : 'aucune');
  await browser.close();
})().catch((e) => { console.error('ÉCHEC E2E :', e.message); process.exit(1); });
