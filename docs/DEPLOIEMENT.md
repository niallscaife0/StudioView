# Déploiement — Supabase, GitHub, Cloudflare Workers et Access

Ces étapes demandent tes comptes : elles n'ont **pas** été exécutées pendant le développement. Les interfaces des fournisseurs évoluent ; vérifie les intitulés dans leur documentation au moment de le faire (liens dans le dossier, fichier 07).

Utilise deux projets Supabase : **recette** (tests, utilisateurs fictifs) et **production** (tes œuvres). Ne lance jamais les tests sur la production.

## 1. Supabase

1. Crée le projet. La migration exige PostgreSQL 15 ou plus (clause `on delete set null (colonne)`), ce qui est le cas des projets Supabase actuels.
2. Applique **dans l'ordre** les fichiers de `supabase/migrations/` (`…0001_init.sql`, puis `…0002_v2_variant_items.sql`), soit dans l'éditeur SQL, soit avec la CLI (`supabase link` puis `supabase db push`). La seconde migration reprend automatiquement d'éventuelles variantes V1.
3. Vérifie dans Storage que le bucket `media` existe et qu'il est **privé**.
4. **Authentication, réglages** :
   - désactive les inscriptions (« Allow new users to sign up ») ;
   - « Site URL » : l'URL de production de l'atelier ;
   - « Redirect URLs » : seulement les domaines réels de l'atelier, avec `/atelier`.
5. **Crée ton compte** : Authentication > Users > ajouter un utilisateur (invitation ou création manuelle) avec ton adresse.
6. Pour le projet de recette uniquement : crée deux utilisateurs de test **avec mot de passe** (A et B).
7. Lance les vérifications sur la recette :
   ```bash
   cat > .env.recette << 'X'
   SUPABASE_URL=https://<recette>.supabase.co
   SUPABASE_ANON_KEY=<clé publique de recette>
   TEST_A_EMAIL=a@exemple.test
   TEST_A_PASSWORD=...
   TEST_B_EMAIL=b@exemple.test
   TEST_B_PASSWORD=...
   X
   node --env-file=.env.recette scripts/check-rls.mjs
   ```
   Le script vérifie l'accès anonyme, l'isolation entre A et B (tables et fichiers), les relations croisées, l'URL publique refusée et l'inscription fermée. Il doit finir par « Toutes les vérifications passent ».

## 2. GitHub

1. Dépôt **privé**.
2. Vérifie avant le premier envoi : aucun `.env.local`, aucune photo d'œuvre, aucune clé `service_role`. Le `.gitignore` exclut déjà `.env*`, les JPG et `/medias/`.

## 3. Cloudflare Workers

Le site est servi par un Worker avec assets statiques. La configuration est dans `wrangler.jsonc`, à la racine :

```jsonc
{ "name": "studioview", "compatibility_date": "2026-11-10",
  "assets": { "directory": "./dist", "not_found_handling": "single-page-application" } }
```

1. Workers & Pages > projet `studioview` > Settings > Build :
   - « Build command » : `npm run build` ;
   - « Deploy command » : `npx wrangler deploy`.
2. **Variables de build** (pas des variables d'exécution du Worker : Vite les lit à la construction) : `VITE_DATA_MODE=supabase`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_STORAGE_BUCKET=media`. **Jamais** la clé `service_role`. Sans ces variables, le site démarre en mode démo local.
3. `public/_headers` envoie `noindex`, la CSP et les en-têtes de sécurité.
4. **Ne recrée pas `public/_redirects`** : il entre en conflit avec `not_found_handling` et fait échouer le déploiement (« Infinite loop detected », code 100324).
5. Domaine personnalisé conseillé : `atelier.<ton-domaine>`. Ajoute-le aux « Redirect URLs » de Supabase.

## 4. Cloudflare Access

Access est une barrière d'entrée supplémentaire. Il ne remplace pas la RLS : il ne donne aucun droit sur Supabase.

1. Zero Trust > Access > Applications : application « self-hosted » couvrant **toutes** les adresses de l'atelier :
   - `studioview.<ton-compte>.workers.dev` ;
   - le domaine personnalisé éventuel ;
   - les URL de prévisualisation des versions du Worker, si elles sont activées (sinon, désactive-les).
2. Politique : autoriser uniquement ton adresse e-mail.

Le parcours de connexion est donc double : Access (code e-mail Cloudflare), puis lien magique Supabase. C'est voulu.

## 5. Vérifications après déploiement (obligatoires)

Fais-les dans une fenêtre de navigation privée, sans session.

| Test | Attendu |
|---|---|
| URL de production | Écran Cloudflare Access |
| `studioview.<compte>.workers.dev` | Écran Cloudflare Access |
| URL de prévisualisation d'une version | Écran Cloudflare Access, ou désactivée |
| Après Access, sans session Supabase | Écran de connexion du laboratoire |
| Lien magique pour une adresse inconnue | Message neutre, aucun compte créé (Authentication > Users) |
| Chemin d'un fichier du bucket, sans session | Refus |
| Déconnexion puis bouton « retour » | Plus aucune donnée privée |
| Second appareil connecté au même compte | Œuvres et variantes retrouvées |

## 6. Exploitation

- **Sauvegarde.** Les sauvegardes automatiques dépendent de l'offre Supabase. L'export structuré de l'atelier (F-15) relève du P1 et n'est pas encore implémenté. D'ici là, tes originaux doivent rester aussi ailleurs que dans le laboratoire.
- **Fichiers orphelins.** Si la suppression d'un fichier échoue après celle de sa ligne, le fichier reste dans le bucket (signalé dans la console). Ils peuvent être listés et nettoyés depuis le tableau de bord Storage.
- **Quotas.** Surveille le stockage, la bande passante et les limites d'envoi d'e-mails d'authentification. Les offres gratuites changent.
- **Dépendances.** `npm outdated` puis `npm run check` avant chaque mise à jour en production.
