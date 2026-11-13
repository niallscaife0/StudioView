#!/usr/bin/env node
/**
 * Vérifie les autorisations sur un VRAI projet Supabase de RECETTE (jamais la production).
 * Prérequis : migration appliquée, deux utilisateurs de test avec mot de passe créés dans
 * Authentication > Users (A et B). Ce script crée puis supprime ses propres données.
 *
 * Variables : SUPABASE_URL, SUPABASE_ANON_KEY, TEST_A_EMAIL, TEST_A_PASSWORD,
 *             TEST_B_EMAIL, TEST_B_PASSWORD, [STORAGE_BUCKET=media]
 * Usage : node --env-file=.env.recette scripts/check-rls.mjs
 */
import { createClient } from '@supabase/supabase-js';

const env = process.env;
const need = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'TEST_A_EMAIL', 'TEST_A_PASSWORD', 'TEST_B_EMAIL', 'TEST_B_PASSWORD'];
const missing = need.filter((k) => !env[k]);
if (missing.length) {
  console.error(`Variables manquantes : ${missing.join(', ')}`);
  process.exit(2);
}
const BUCKET = env.STORAGE_BUCKET || 'media';
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const client = () => createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, opts);

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const ko = (msg) => { failures++; console.log(`  ✗ ${msg}`); };
const expect = (cond, msg) => (cond ? ok(msg) : ko(msg));

async function signIn(email, password) {
  const c = client();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Connexion ${email} impossible : ${error.message}`);
  return { c, uid: data.user.id };
}

// PNG 1×1 transparent
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

const A = await signIn(env.TEST_A_EMAIL, env.TEST_A_PASSWORD);
const B = await signIn(env.TEST_B_EMAIL, env.TEST_B_PASSWORD);
const anon = client();
const cleanup = [];

try {
  console.log('Préparation : données de A');
  const { data: art, error: e1 } = await A.c.from('artworks').insert({ title: 'RLS test A' }).select().single();
  if (e1) throw e1;
  cleanup.push(() => A.c.from('artworks').delete().eq('id', art.id));
  const assetId = crypto.randomUUID();
  const path = `${A.uid}/${assetId}/original.png`;
  const thumb = `${A.uid}/${assetId}/thumb.png`;
  for (const p of [path, thumb]) {
    const { error } = await A.c.storage.from(BUCKET).upload(p, PNG, { contentType: 'image/png' });
    if (error) throw error;
  }
  cleanup.push(() => A.c.storage.from(BUCKET).remove([path, thumb]));
  const { error: e2 } = await A.c.from('assets').insert({
    id: assetId, artwork_id: art.id, kind: 'cutout', storage_path: path, thumb_path: thumb,
    mime_type: 'image/png', bytes: PNG.length, width: 1, height: 1, transparency: true, title: 'test',
  });
  if (e2) throw e2;
  cleanup.unshift(() => A.c.from('assets').delete().eq('id', assetId));
  const { data: pres } = await A.c.from('presentations').insert({ artwork_id: art.id, title: 'P' }).select().single();
  const { data: variant } = await A.c.from('variants').insert({
    presentation_id: pres.id, name: 'A', foreground_asset_id: assetId,
    transform: { schemaVersion: 1, x: 0.5, y: 0.5, scale: 0.6, rotationDeg: 0 },
  }).select().single();
  cleanup.unshift(() => A.c.from('variants').delete().eq('id', variant.id));
  ok('données de A créées');

  console.log('Visiteur anonyme');
  for (const t of ['artworks', 'assets', 'presentations', 'variants']) {
    const { data } = await anon.from(t).select('id');
    expect(!data || data.length === 0, `anon ne lit rien dans ${t}`);
  }
  {
    const { data } = await anon.storage.from(BUCKET).download(path);
    expect(!data, 'anon ne télécharge pas le fichier privé');
    const pub = anon.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const r = await fetch(pub);
    expect(r.status >= 400, `URL publique du fichier refusée (HTTP ${r.status})`);
  }

  console.log('Autre compte B');
  for (const t of ['artworks', 'assets', 'presentations', 'variants']) {
    const { data } = await B.c.from(t).select('id').in('id', [art.id, assetId, pres.id, variant.id]);
    expect((data ?? []).length === 0, `B ne lit aucune ligne de A dans ${t}`);
  }
  {
    const { data } = await B.c.storage.from(BUCKET).download(path);
    expect(!data, 'B ne télécharge pas le fichier de A');
    const { data: signed } = await B.c.storage.from(BUCKET).createSignedUrl(path, 60);
    expect(!signed?.signedUrl, 'B ne peut pas signer une URL vers le fichier de A');
    const { error } = await B.c.storage.from(BUCKET).upload(`${A.uid}/intrus.png`, PNG, { contentType: 'image/png' });
    expect(!!error, 'B ne peut pas écrire dans le dossier de A');
    const { data: removed } = await B.c.storage.from(BUCKET).remove([path]);
    expect((removed ?? []).length === 0, 'B ne peut pas supprimer le fichier de A');
  }
  {
    const { data } = await B.c.from('artworks').update({ title: 'piraté' }).eq('id', art.id).select();
    expect((data ?? []).length === 0, 'B ne modifie pas l’œuvre de A');
    const { data: d2 } = await B.c.from('variants').delete().eq('id', variant.id).select();
    expect((d2 ?? []).length === 0, 'B ne supprime pas la variante de A');
    const { error } = await B.c.from('artworks').insert({ owner_id: A.uid, title: 'usurpation' });
    expect(!!error, 'B ne crée pas de ligne au nom de A');
  }
  {
    const { data: bArt } = await B.c.from('artworks').insert({ title: 'RLS test B' }).select().single();
    cleanup.push(() => B.c.from('artworks').delete().eq('id', bArt.id));
    const { data: bPres } = await B.c.from('presentations').insert({ artwork_id: bArt.id, title: 'P' }).select().single();
    const { error } = await B.c.from('variants').insert({
      presentation_id: bPres.id, name: 'X', foreground_asset_id: assetId,
      transform: { schemaVersion: 1, x: 0.5, y: 0.5, scale: 0.6, rotationDeg: 0 },
    });
    expect(!!error, 'B ne peut pas utiliser l’image de A dans sa variante');
    const { error: e3 } = await B.c.from('presentations').insert({ artwork_id: art.id, title: 'intrusion' });
    expect(!!e3, 'B ne peut pas rattacher une présentation à l’œuvre de A');
  }

  console.log('Inscription fermée');
  {
    const { data, error } = await anon.auth.signUp({ email: `inconnu-${Date.now()}@example.com`, password: crypto.randomUUID() });
    expect(!!error || !data.user, 'l’inscription publique est refusée');
    const r = await anon.auth.signInWithOtp({ email: `inconnu-${Date.now()}@example.com`, options: { shouldCreateUser: false } });
    expect(!!r.error, 'un lien magique pour une adresse inconnue ne crée pas de compte');
  }
} catch (e) {
  ko(`Erreur inattendue : ${e.message ?? e}`);
} finally {
  for (const f of cleanup) await f().catch(() => {});
  console.log(failures ? `\n${failures} échec(s).` : '\nToutes les vérifications passent.');
  process.exit(failures ? 1 : 0);
}
