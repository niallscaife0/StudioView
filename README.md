# Laboratoire de présentation — sculptures

Site privé pour éprouver comment les conditions de présentation changent la perception d'une sculpture. On importe des photographies, on place la sculpture dans des décors, on enregistre des variantes, on les compare, on exporte une image.

Ce dépôt implémente la **V1 (P0)** du dossier de spécification v1.2. Le partage par lien (P1) et la 3D (V2) ne sont **pas** implémentés.

## Démarrage rapide (mode démo local)

```bash
npm install
cp .env.example .env.local      # VITE_DATA_MODE=local par défaut
npm run dev                      # http://localhost:5173
```

En mode local, tout reste dans le navigateur (IndexedDB). Rien n'est synchronisé et rien n'est sauvegardé ailleurs : l'interface l'affiche en permanence. Sur un atelier vide, un lien permet de générer une sculpture et deux décors **fictifs** pour essayer l'outil.

## Mode hébergé (Supabase)

```bash
# .env.local
VITE_DATA_MODE=supabase
VITE_SUPABASE_URL=https://<projet>.supabase.co
VITE_SUPABASE_ANON_KEY=<clé publique anon / publishable>
```

Procédure complète, Cloudflare Access compris : [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md).

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Vérification des types + build de production dans `dist/` |
| `npm run lint` / `npm run typecheck` | Qualité du code |
| `npm test` | Tests unitaires et d'intégration (Vitest, jsdom, IndexedDB simulée) |
| `npm run check` | Les quatre à la suite |
| `scripts/test-sql-local.sh` | Migration + tests d'autorisation sur un PostgreSQL 15+ local jetable |
| `npm run test:rls` | Tests d'autorisation contre un **projet Supabase de recette** réel |
| `node e2e/run.cjs` | Parcours de recette complet dans un vrai Chrome (voir l'en-tête du fichier) |

## Structure

```text
src/
  app/          routes, mise en page, garde d'authentification, contexte
  components/   UI partagée (import, modales, miniatures, messages)
  domain/       types et règles de transformation (sans React ni persistance)
  data/         interface Repository + adaptateurs local (IndexedDB) et Supabase
  features/
    artworks/   atelier, fiche de sculpture, création de présentation
    assets/     validation, traitement d'image, import, ressources
    studio2d/   composeur pur (compose.ts), canvas interactif, studio
    variants/   comparaison, liste des variantes
    exports/    export PNG
    auth/       connexion par lien magique
    demo/       données fictives (mode local uniquement)
supabase/
  migrations/   schéma, contraintes de propriété, RLS, bucket privé
  tests/        stubs Supabase + tests SQL d'autorisation
scripts/        tests SQL locaux, vérification RLS sur Supabase
e2e/            recette navigateur
docs/           déploiement, validation, manuel
public/         _headers (sécurité, noindex) et _redirects (SPA) pour Cloudflare Pages
```

## Choix techniques

- **Persistance isolée de l'interface.** Les écrans ne connaissent que l'interface `Repository`. Deux implémentations : `LocalRepository` (démo) et `SupabaseRepository` (hébergé).
- **Un seul composeur.** `features/studio2d/compose.ts` dessine l'aperçu, la comparaison et l'export avec les mêmes paramètres. Il est prêt à servir aux rendus publiés en P1 (décision D-01).
- **Médias chargés en blob** (D-05). Le Storage est téléchargé de façon authentifiée, puis affiché par URL locale : pas d'URL publique, pas d'URL signée dans le composeur, pas de canvas bloqué par CORS.
- **Coordonnées normalisées.** `x`, `y` sont le centre de la sculpture dans le cadre (0 à 1) ; `scale` est sa hauteur rapportée à celle du cadre. Le cadre prend les proportions du décor (16:9 sans décor). Le schéma est versionné (`schemaVersion: 1`) et ne doit pas être réutilisé pour la 3D.
- **Cohérence imposée par la base.** Des clés étrangères composites `(id, owner_id)` empêchent de rattacher l'image ou la présentation d'un autre compte, même hors de l'interface.
- **Supabase chargé à la demande.** Le mode démo ne télécharge pas le client Supabase.

## Écarts par rapport au dossier

- Pas de `react-konva` : Canvas 2D natif, plus léger, et le composeur reste une fonction pure testable.
- L'historique d'annulation (F-16, P1) existe déjà en version simple dans le Studio (session uniquement), parce que la maquette W3 prévoit un bouton « Annuler ».
- Les tests E2E utilisent `puppeteer-core` plutôt que Playwright : le navigateur est fourni par la machine (`CHROME_PATH`).

État détaillé et critères d'acceptation : [`docs/CHECKLIST_VALIDATION.md`](docs/CHECKLIST_VALIDATION.md).
