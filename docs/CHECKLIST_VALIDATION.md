# Checklist de validation — V1 (P0)

Trois statuts, sans exagération :
- **Vérifié** : un test automatique ou le parcours navigateur l'a constaté pendant le développement.
- **Implémenté, non vérifié** : le code existe, mais aucun test ne l'a encore observé.
- **À faire** : demande tes comptes ou une action humaine.

## Résultats obtenus pendant le développement (13 novembre 2026)

| Contrôle | Résultat |
|---|---|
| `npm run lint`, `npm run typecheck`, `npm run build` | Passent |
| `npm test` | 37 tests passent (validation, composition, dépôt local, mapping Supabase, interface) |
| `scripts/test-sql-local.sh` sur PostgreSQL 16 avec stubs Supabase | Tous les tests SQL passent |
| Tests de mutation SQL (protection retirée volontairement) | Quatre mutations, quatre échecs détectés : RLS retirée, clé étrangère non composite, `set null` sur toutes les colonnes, politique Storage ouverte |
| `e2e/run.cjs` dans Chromium (mode local) | Parcours complet réussi, aucune erreur console |
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
- Pas de partage par lien (P1) ni de 3D (V2).
- Une même session Studio n'avertit pas si une autre machine a modifié la même variante entre-temps : le dernier enregistrement l'emporte.
