-- Tests d'autorisation de la migration (à exécuter après 00_supabase_stubs.sql et la migration).
-- Chaque bloc échoue (raise exception) si une règle d'accès est violée.
\set ON_ERROR_STOP on

insert into auth.users values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@test');

-- ---------- Données du propriétaire A ----------
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

insert into public.artworks (id, title) values ('a1000000-0000-0000-0000-000000000001', 'Figure linéaire');
insert into public.assets (id, artwork_id, kind, storage_path, thumb_path, mime_type, bytes, width, height, transparency, title)
values ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'cutout',
        'aaaaaaaa-0000-0000-0000-000000000001/a2000000-0000-0000-0000-000000000001/original.png',
        'aaaaaaaa-0000-0000-0000-000000000001/a2000000-0000-0000-0000-000000000001/thumb.webp',
        'image/png', 1000, 800, 1200, true, 'Vue détourée');
insert into public.presentations (id, artwork_id, title) values ('a3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Essai');
insert into public.variants (id, presentation_id, name, foreground_asset_id, transform)
values ('a4000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'A',
        'a2000000-0000-0000-0000-000000000001', '{"schemaVersion":1,"x":0.5,"y":0.5,"scale":0.6,"rotationDeg":0}');
insert into storage.objects (bucket_id, name) values ('media', 'aaaaaaaa-0000-0000-0000-000000000001/a2000000-0000-0000-0000-000000000001/original.png');

do $$ begin
  if (select count(*) from public.artworks) <> 1 then raise exception 'A doit voir sa propre œuvre'; end if;
  if (select count(*) from storage.objects) <> 1 then raise exception 'A doit voir son propre fichier'; end if;
end $$;

-- A ne peut pas écrire dans le dossier de B
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('media', 'bbbbbbbb-0000-0000-0000-000000000002/x/original.png');
    raise exception 'ÉCHEC : A a écrit dans le dossier de B';
  exception when insufficient_privilege then null; end;
end $$;

-- Un chemin hors du dossier du propriétaire est refusé par contrainte
do $$ begin
  begin
    insert into public.assets (kind, storage_path, thumb_path, mime_type, bytes, title)
    values ('photo', 'ailleurs/original.jpg', 'ailleurs/thumb.webp', 'image/jpeg', 10, 'x');
    raise exception 'ÉCHEC : chemin de stockage arbitraire accepté';
  exception when check_violation then null; end;
end $$;

-- Transform invalide refusé
do $$ begin
  begin
    update public.variants set transform = '{"schemaVersion":2}' where id = 'a4000000-0000-0000-0000-000000000001';
    raise exception 'ÉCHEC : transform invalide accepté';
  exception when check_violation then null; end;
end $$;

-- Image utilisée : suppression refusée sans choix explicite
do $$ begin
  begin
    delete from public.assets where id = 'a2000000-0000-0000-0000-000000000001';
    raise exception 'ÉCHEC : image utilisée supprimée silencieusement';
  exception when foreign_key_violation then null; end;
end $$;

-- ---------- Visiteur anonyme ----------
reset request.jwt.claim.sub;
set role anon;
do $$ begin
  begin
    perform count(*) from public.artworks;
    raise exception 'ÉCHEC : anon a pu interroger artworks';
  exception when insufficient_privilege then null; end;
  if (select count(*) from storage.objects) <> 0 then raise exception 'ÉCHEC : anon voit des fichiers privés'; end if;
end $$;

-- ---------- Autre compte B ----------
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';

do $$ begin
  if (select count(*) from public.artworks) <> 0 then raise exception 'ÉCHEC : B voit les œuvres de A'; end if;
  if (select count(*) from public.assets) <> 0 then raise exception 'ÉCHEC : B voit les images de A'; end if;
  if (select count(*) from public.variants) <> 0 then raise exception 'ÉCHEC : B voit les variantes de A'; end if;
  if (select count(*) from storage.objects) <> 0 then raise exception 'ÉCHEC : B voit les fichiers de A'; end if;
end $$;

-- B ne peut ni modifier ni supprimer les lignes de A (0 ligne touchée)
do $$ declare n int; begin
  update public.artworks set title = 'piraté' where id = 'a1000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC : B a modifié une œuvre de A'; end if;
  delete from public.variants where id = 'a4000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC : B a supprimé une variante de A'; end if;
  delete from storage.objects where name like 'aaaaaaaa-%';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC : B a supprimé un fichier de A'; end if;
end $$;

-- B ne peut pas s'attribuer une ligne au nom de A
do $$ begin
  begin
    insert into public.artworks (owner_id, title) values ('aaaaaaaa-0000-0000-0000-000000000001', 'usurpation');
    raise exception 'ÉCHEC : B a créé une ligne au nom de A';
  exception when insufficient_privilege then null; end;
end $$;

-- Relations croisées : B crée sa propre présentation et tente d'y utiliser l'image de A
insert into public.artworks (id, title) values ('b1000000-0000-0000-0000-000000000001', 'Œuvre de B');
insert into public.presentations (id, artwork_id, title) values ('b3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'P de B');
do $$ begin
  begin
    insert into public.variants (presentation_id, name, foreground_asset_id, transform)
    values ('b3000000-0000-0000-0000-000000000001', 'X', 'a2000000-0000-0000-0000-000000000001',
            '{"schemaVersion":1,"x":0.5,"y":0.5,"scale":0.6,"rotationDeg":0}');
    raise exception 'ÉCHEC : B a utilisé l''image de A';
  exception when foreign_key_violation then null; end;
end $$;

-- B tente de rattacher une présentation à l'œuvre de A
do $$ begin
  begin
    insert into public.presentations (artwork_id, title) values ('a1000000-0000-0000-0000-000000000001', 'intrusion');
    raise exception 'ÉCHEC : B a rattaché une présentation à l''œuvre de A';
  exception when foreign_key_violation then null; end;
end $$;

-- ---------- Retour à A : cascades ----------
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$ begin
  if (select title from public.artworks where id = 'a1000000-0000-0000-0000-000000000001') <> 'Figure linéaire' then
    raise exception 'ÉCHEC : le titre de A a changé';
  end if;
  begin
    update public.artworks set owner_id = 'bbbbbbbb-0000-0000-0000-000000000002' where id = 'a1000000-0000-0000-0000-000000000001';
    raise exception 'ÉCHEC : transfert de propriété accepté';
  exception when others then
    if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
end $$;

delete from public.artworks where id = 'a1000000-0000-0000-0000-000000000001';
do $$ begin
  if (select count(*) from public.presentations) <> 0 then raise exception 'ÉCHEC : présentations non supprimées en cascade'; end if;
  if (select count(*) from public.variants) <> 0 then raise exception 'ÉCHEC : variantes non supprimées en cascade'; end if;
  if (select count(*) from public.assets) <> 1 then raise exception 'ÉCHEC : la photo doit rester dans Ressources'; end if;
  if (select artwork_id from public.assets) is not null then raise exception 'ÉCHEC : la photo doit perdre son œuvre'; end if;
  if (select owner_id from public.assets) <> 'aaaaaaaa-0000-0000-0000-000000000001' then raise exception 'ÉCHEC : owner_id effacé par la cascade'; end if;
end $$;

reset role;
select 'TOUS LES TESTS SQL PASSENT' as resultat;
