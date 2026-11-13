# Checklist de validation — V1, V2 phase 1 et phase 3

Trois statuts, sans exagération :
- **Vérifié** : un test automatique ou le parcours navigateur l'a constaté pendant le développement.
- **Implémenté, non vérifié** : le code existe, mais aucun test ne l'a encore observé.
- **À faire** : demande tes comptes ou une action humaine.

## Résultats obtenus pendant le développement (13 novembre 2026)

| Contrôle | Résultat |
|---|---|
| `npm run lint`, `npm run typecheck`, `npm run build` | Passent |
| `npm test` | 69 tests passent (validation, composition à éléments, sélection au pixel, dépôt local, reprise V1, géométrie de la salle, salles et accrochages, mapping Supabase, interface) |
| `scripts/test-sql-local.sh` sur PostgreSQL 16 avec stubs Supabase | Tous les tests SQL passent, y compris la reprise d'un jeu de données V1 créé avant la migration V2 |
| Tests de mutation SQL (protection retirée volontairement) | Quatre mutations, quatre échecs détectés : RLS retirée, clé étrangère non composite, `set null` sur toutes les colonnes, politique Storage ouverte |
| `e2e/run.cjs` dans Chromium (mode local) | Parcours complet réussi (V1 + éléments multiples + reprise V1), aucune erreur console |
| `e2e/salle.cjs` dans Chromium avec WebGL (mode local) | Parcours de la salle réussi, aucune erreur console |
| `npm run test:rls` contre un vrai Supabase | **À faire** (pas d'accès aux comptes) |

Les stubs SQL imitent `auth.uid()` et `storage.objects` ; ils ne sont pas Supabase. Le test réel `test:rls` reste indispensable.

## Critères d'acceptation essentiels (cahier des charges, section 8)

| # | Critère | Statut |
|---|---|---|
| 1 | Un non-connecté ne charge ni fichiers privés ni lignes | Vérifié en SQL local ; **à confirmer** avec `test:rls` et après déploiement |
| 2 | Une photo importée apparaît et subsiste après rechargement | Vérifié en mode local (E2E) ; à confirmer en mode Supabase |
| 3 | Photo transparente sur deux décors, positionnée et redimensionnée | Vérifié (E2E : glissement souris, échelle clavier, deux décors) |
| 4 | Deux variantes distinctes après fermeture | Vérifié (E2E après rechargement, test unitaire avec nouvelle instance) |
| 5 | La comparaison affiche les deux états enregistrés | Vérifié (E2E : décors et positions différents lus depuis l'enregistrement) |
| 6 | Le PNG exporté reflète le composite | Implémenté avec la même fonction de dessin que l'aperçu ; PNG 1600 × 1067 produit en E2E. Pas de comparaison pixel à pixel automatisée |
| 7 | Un autre appareil retrouve œuvres et variantes | **À faire** après déploiement |
| 8 | Erreurs d'import et de sauvegarde visibles | Import : vérifié (E2E, faux fichier). Sauvegarde : implémenté, non vérifié |
| 9 | URL directe vers un objet privé sans autorisation : rien | Vérifié en SQL local ; `test:rls` teste aussi l'URL publique : **à faire** |
| 10 | Test réel des URL de production et de preview | **À faire** (docs/DEPLOIEMENT.md, section 5) |
| 11 | Adresse non autorisée : aucun compte créé | Implémenté (`shouldCreateUser: false`) ; testé par `test:rls` : **à faire** |
| 12 | Coupure réseau pendant une sauvegarde : édition conservée, « Réessayer » | Implémenté, non vérifié |

## Fonctionnalités P0

| ID | Statut | Où |
|---|---|---|
| F-01 Authentification | Implémenté ; garde de route vérifiée en mode local seulement | `data/auth.ts`, `app/RequireAuth.tsx` |
| F-02 Import JPG/PNG/WebP, sélection et glisser-déposer | Vérifié (sélection) ; glisser-déposer implémenté | `components/Importer.tsx` |
| F-03 Validation (extension, type réel, taille), renommage | Vérifié (tests + E2E) | `features/assets/validation.ts` |
| F-04 Bibliothèque, miniatures, suppression contrôlée | Vérifié (tests) | `ResourcesPage`, `useDeleteAsset` |
| F-05 Décors depuis l'interface (Ressources et Studio) | Vérifié (Ressources) | |
| F-06 Studio 2D : fond, calque, déplacement, échelle | Vérifié | `studio2d/` |
| F-07 Avertissement « fond non transparent » | Implémenté, non vérifié en E2E | `StudioPage` |
| F-08 Créer, nommer, enregistrer, dupliquer, rouvrir | Vérifié | |
| F-09 Comparaison côte à côte | Vérifié | `variants/ComparePage` |
| F-10 Export PNG, résolution affichée | Vérifié | `exports/ExportDialog` |
| F-11 Synchronisation entre appareils | Implémenté (Supabase) ; **à vérifier** | `data/supabase/` |
| F-12 États (chargement, vide, erreur, non synchronisé) | Implémenté ; états vides et erreurs d'import vérifiés | |

## V2 — Phase 0 (préalable, demande tes comptes)

| Contrôle | Statut |
|---|---|
| Supabase recette et production créés, migrations 0001 et 0002 appliquées | **À faire** |
| `npm run test:rls` réussi sur la recette | **À faire**. Le script couvre les tables V1 ; son extension à `variant_items` et `save_variant` reste **à implémenter** |
| Cloudflare Access sur toutes les adresses du Worker | **À faire** |
| Synchronisation constatée sur un second appareil | **À faire** |

La phase 1 a été construite sans attendre la phase 0, parce qu'elle se vérifie entièrement en local. Elle ne doit pas être utilisée avec des données réelles en ligne tant que la phase 0 n'est pas faite.

## V2 — Phase 1 : éléments multiples

| ID | Exigence | Statut |
|---|---|---|
| F-25 | Une variante contient une liste d'éléments, chacun avec sa transformation | Vérifié (tests, E2E : trois éléments, déplacement indépendant) |
| F-26 | Sélection (liste et clic au pixel), ordre, dupliquer, retirer, masquer, verrouiller, renommer | Vérifié pour sélection, ordre, masquage, rechargement. Dupliquer, retirer, verrouiller, renommer : implémentés, non vérifiés en E2E. Réordonnancement par boutons, pas par glisser-déposer |
| F-27 | Reprise des variantes V1 | Vérifié en SQL (jeu V1 avant migration), en test unitaire et en E2E (variante V1 injectée dans IndexedDB : un élément, position identique) |

| # | Critère V2 | Statut |
|---|---|---|
| 1 | Trois éléments indépendants ; ordre retrouvé après rechargement | Vérifié en mode local |
| 2 | Variante V1 affichée identiquement après migration | Transformation reprise à l'identique (vérifié). La comparaison pixel à pixel des exports avant / après n'est **pas** automatisée |
| 12 | B ne peut ni lire ni référencer les éléments de A | Vérifié en SQL local (lecture, insertion, suppression, `save_variant` sur la variante de A, image de A) ; **à confirmer** sur un vrai Supabase |

Vérifié aussi en SQL : `save_variant` est atomique (un élément invalide annule tout l'enregistrement) et inaccessible à un visiteur anonyme.

## V2 — Phase 3 : échelle, salles, accrochages

Construite avant la phase 2 (détourage) : dans la salle, une photo non détourée est un panneau rectangulaire.

| ID | Exigence | Statut |
|---|---|---|
| F-36 | Hauteur réelle déclarée (cm) | Vérifié (tests, E2E). Largeur et profondeur : **à implémenter** |
| F-37 | Salles paramétrables : dimensions, couleurs, lumière | Vérifié pour la création et les dimensions (tests, E2E). Lumière : trois préréglages ; intensité et température réglables : **à implémenter**. Modification et suppression : implémentées, non vérifiées en E2E |
| F-38 | Placer plusieurs œuvres : position, orientation, élévation, choix de la photo | Vérifié pour le placement et le déplacement ; orientation, élévation, choix de photo : implémentés, non vérifiés en E2E |
| F-39 | Navigation à la première personne, clavier et souris ; collisions avec les murs | Vérifié sur ordinateur (E2E : marche, arrêt à 25 cm du mur du fond). Joystick tactile : implémenté, **non vérifié sur un vrai téléphone**. Collision avec les socles : sans objet (pas de socles) |
| F-40 | Vue en plan : déplacer, tourner, cotes aux murs, distances entre œuvres | Vérifié (déplacement clavier, cotes). Aimantation aux murs : **à implémenter** |
| F-41 | Silhouette humaine à l'échelle, taille réglable, déplaçable en plan | Vérifié à l'écran. Sa position n'est pas enregistrée avec l'accrochage |
| F-42 | Socles et supports | **À implémenter** (seule l'élévation de la base existe) |
| F-43 | Accrochages = variantes : enregistrer, dupliquer, renommer, rouvrir | Vérifié (enregistrement, rechargement, duplication). Comparaison d'accrochages : phase 4 |
| F-53 | Export PNG de la vue courante, mention « Simulation 2,5D » | Vérifié (fichier 1920 px produit). Choix de la résolution : **à implémenter** |

| # | Critère V2 | Statut |
|---|---|---|
| 5 | Œuvre de 175 cm et silhouette de 170 cm de hauteurs cohérentes | Vérifié par le calcul (tests : rapport exact, indépendant de la photo) et constaté sur capture. La mesure à l'écran à 3 % près n'est **pas** automatisée |
| 6 | Pas de traversée des murs ; la hauteur des yeux change le point de vue | Collision vérifiée (tests + E2E). Hauteur des yeux : implémentée, non vérifiée en E2E |
| 7 | Deux accrochages distincts après fermeture | Persistance vérifiée (tests, E2E). Comparaison côte à côte : phase 4 |
| 12 | B ne peut ni lire ni référencer les salles et placements de A | Vérifié en SQL local (lecture, modification, `save_placements`, accrochage dans la salle d'autrui, œuvre ou image d'autrui) ; trois mutations détectées. **À confirmer** sur un vrai Supabase |
| 13 | Retrouvé sur un second appareil | **À faire** (phase 0) |

Non mesuré : la fluidité (≥ 30 images/s avec 10 œuvres) et la mémoire sur mobile. Pas d'annulation (Ctrl+Z) dans l'accrochage.

## Recette utilisateur à faire toi-même après déploiement

1. Ouvrir l'atelier : Access, puis lien magique.
2. Créer une sculpture, importer une vraie photo détourée et deux photos d'espaces.
3. Créer une présentation, placer la sculpture, enregistrer A.
4. Dupliquer, changer de décor et de taille, enregistrer B.
5. Comparer A et B, exporter A.
6. Fermer le navigateur. Se reconnecter depuis le téléphone ou un autre ordinateur : A et B sont là.
7. Dans une fenêtre privée sans session : l'atelier est bloqué par Access sur toutes ses adresses.

## Limites connues de la V1

- Les dimensions sont relatives au cadre et approximatives. Aucune ombre ni perspective n'est calculée.
- Pas de détourage automatique : préparer les PNG/WebP transparents dans un outil externe.
- Pas de brouillon hors ligne persistant (D-04) : une coupure garde l'édition dans l'onglet seulement.
- Pas d'export/import d'archive de l'atelier (F-15, P1).
- Pas de partage par lien ni d'archive (repris en V2 phase 6).
- V2 : phases 1 et 3 faites. Pas encore de détourage, de points de vue enregistrés, de comparaison d'accrochages ni de volumes.
- Dans la salle, une photographie est un panneau plat : de profil, elle devient un trait. Les photos non détourées sont des rectangles.
- Une même session Studio n'avertit pas si une autre machine a modifié la même variante entre-temps : le dernier enregistrement l'emporte.
