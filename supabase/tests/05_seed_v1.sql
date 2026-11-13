-- Jeu de données au format V1, créé APRÈS la migration V1 et AVANT la migration V2,
-- pour vérifier la reprise (F-27). Propriétaire C.
\set ON_ERROR_STOP on
insert into auth.users values ('cccccccc-0000-0000-0000-000000000003', 'c@test');
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
insert into public.artworks (id, title) values ('c1000000-0000-0000-0000-000000000001', 'Œuvre V1');
insert into public.assets (id, artwork_id, kind, storage_path, thumb_path, mime_type, bytes, width, height, transparency, title)
values ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'photo',
        'cccccccc-0000-0000-0000-000000000003/c2000000-0000-0000-0000-000000000001/original.jpg',
        'cccccccc-0000-0000-0000-000000000003/c2000000-0000-0000-0000-000000000001/thumb.webp',
        'image/jpeg', 1000, 800, 1200, false, 'Photo V1');
insert into public.presentations (id, artwork_id, title) values ('c3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Présentation V1');
insert into public.variants (id, presentation_id, name, foreground_asset_id, transform)
values ('c4000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 'A',
        'c2000000-0000-0000-0000-000000000001', '{"schemaVersion":1,"x":0.31,"y":0.62,"scale":0.44,"rotationDeg":12.5}'),
       ('c4000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000001', 'vide', null,
        '{"schemaVersion":1,"x":0.5,"y":0.5,"scale":0.6,"rotationDeg":0}');
reset role;
reset request.jwt.claim.sub;
