-- =============================================================================
-- Laboratoire de présentation — schéma V1 (P0)
-- PostgreSQL 15+ (Supabase). Toutes les tables métier sous RLS, accès refusé par défaut.
-- Isolation par propriétaire : owner_id = auth.uid() sur chaque ligne et chaque fichier.
-- =============================================================================

create type public.asset_kind as enum ('photo', 'cutout', 'background', 'model3d');

-- -----------------------------------------------------------------------------
-- Tables
-- La cohérence des relations croisées est imposée par des clés étrangères
-- COMPOSITES (id, owner_id) : impossible de rattacher à son projet une photo,
-- un décor ou une présentation appartenant à un autre compte, même en
-- contournant l'interface (la RLS seule ne suffit pas à l'empêcher).
-- -----------------------------------------------------------------------------

create table public.artworks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.assets (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  artwork_id    uuid null,
  kind          public.asset_kind not null,
  storage_path  text not null unique,
  thumb_path    text not null unique,
  mime_type     text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  bytes         bigint not null check (bytes > 0),
  width         integer check (width > 0),
  height        integer check (height > 0),
  transparency  boolean,
  title         text not null check (char_length(title) between 1 and 200),
  created_at    timestamptz not null default now(),
  unique (id, owner_id),
  -- Suppression de l'œuvre : la photo reste, sans œuvre (seule artwork_id passe à NULL).
  foreign key (artwork_id, owner_id) references public.artworks (id, owner_id) on delete set null (artwork_id),
  -- Chemins dans le dossier du propriétaire : owner_id/asset_id/...
  check (storage_path like owner_id::text || '/' || id::text || '/%'),
  check (thumb_path   like owner_id::text || '/' || id::text || '/%'),
  -- Un décor n'appartient pas à une œuvre.
  check (kind <> 'background' or artwork_id is null)
);

create table public.presentations (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  artwork_id  uuid not null,
  title       text not null check (char_length(title) between 1 and 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (artwork_id, owner_id) references public.artworks (id, owner_id) on delete cascade
);

create table public.variants (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  presentation_id      uuid not null,
  name                 text not null check (char_length(name) between 1 and 200),
  background_asset_id  uuid null,
  foreground_asset_id  uuid null,
  transform            jsonb not null,
  note                 text null check (note is null or char_length(note) <= 5000),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  foreign key (presentation_id, owner_id)     references public.presentations (id, owner_id) on delete cascade,
  -- Une image utilisée ne peut pas disparaître silencieusement : l'application demande un choix explicite.
  foreign key (background_asset_id, owner_id) references public.assets (id, owner_id) on delete restrict,
  foreign key (foreground_asset_id, owner_id) references public.assets (id, owner_id) on delete restrict,
  check (
    jsonb_typeof(transform) = 'object'
    and transform ->> 'schemaVersion' = '1'
    and jsonb_typeof(transform -> 'x') = 'number'
    and jsonb_typeof(transform -> 'y') = 'number'
    and jsonb_typeof(transform -> 'scale') = 'number'
    and jsonb_typeof(transform -> 'rotationDeg') = 'number'
  )
);

create index on public.assets (owner_id, artwork_id);
create index on public.presentations (owner_id, artwork_id);
create index on public.variants (owner_id, presentation_id);
create index on public.variants (background_asset_id);
create index on public.variants (foreground_asset_id);

-- -----------------------------------------------------------------------------
-- updated_at et propriété immuable
-- -----------------------------------------------------------------------------

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.keep_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id ne peut pas être modifié';
  end if;
  return new;
end $$;

create trigger artworks_touch      before update on public.artworks      for each row execute function public.touch_updated_at();
create trigger presentations_touch before update on public.presentations for each row execute function public.touch_updated_at();
create trigger variants_touch      before update on public.variants      for each row execute function public.touch_updated_at();

create trigger artworks_owner      before update on public.artworks      for each row execute function public.keep_owner();
create trigger assets_owner        before update on public.assets        for each row execute function public.keep_owner();
create trigger presentations_owner before update on public.presentations for each row execute function public.keep_owner();
create trigger variants_owner      before update on public.variants      for each row execute function public.keep_owner();

-- Les chemins de stockage d'un asset ne changent jamais après création.
create or replace function public.keep_asset_paths() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.storage_path is distinct from old.storage_path or new.thumb_path is distinct from old.thumb_path then
    raise exception 'les chemins de stockage ne peuvent pas être modifiés';
  end if;
  return new;
end $$;
create trigger assets_paths before update on public.assets for each row execute function public.keep_asset_paths();

-- Toucher la présentation quand une variante change (tri « Reprendre »).
create or replace function public.touch_presentation() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.presentations set updated_at = now() where id = new.presentation_id;
  return new;
end $$;
create trigger variants_touch_presentation after insert or update on public.variants
  for each row execute function public.touch_presentation();

-- -----------------------------------------------------------------------------
-- RLS : uniquement le propriétaire authentifié. Aucun accès pour anon.
-- -----------------------------------------------------------------------------

alter table public.artworks      enable row level security;
alter table public.assets        enable row level security;
alter table public.presentations enable row level security;
alter table public.variants      enable row level security;

alter table public.artworks      force row level security;
alter table public.assets        force row level security;
alter table public.presentations force row level security;
alter table public.variants      force row level security;

revoke all on public.artworks, public.assets, public.presentations, public.variants from anon;
grant select, insert, update, delete on public.artworks, public.assets, public.presentations, public.variants to authenticated;

do $$
declare t text;
begin
  foreach t in array array['artworks', 'assets', 'presentations', 'variants'] loop
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = (select auth.uid()))', t || '_delete_own', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Storage : bucket PRIVÉ, un dossier par propriétaire.
-- Pas de getPublicUrl. Lecture par téléchargement authentifié.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 52428800, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "media_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "media_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "media_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "media_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
