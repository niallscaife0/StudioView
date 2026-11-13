-- =============================================================================
-- V2, phase 3 — Échelle réelle, salles et accrochages (F-36, F-37, F-38, F-43)
-- Migration ADDITIVE. Unité : centimètre.
-- =============================================================================

-- Hauteur réelle DÉCLARÉE des œuvres (jamais déduite d'une photo).
alter table public.artworks
  add column height_cm numeric null check (height_cm is null or (height_cm >= 1 and height_cm <= 2000));

create type public.light_preset as enum ('bright', 'dark', 'day');
create type public.presentation_mode as enum ('2d', 'room');

create table public.rooms (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 200),
  length_cm    integer not null check (length_cm between 100 and 10000),
  width_cm     integer not null check (width_cm between 100 and 10000),
  height_cm    integer not null check (height_cm between 100 and 2000),
  wall_color   text not null check (wall_color ~ '^#[0-9a-fA-F]{6}$'),
  floor_color  text not null check (floor_color ~ '^#[0-9a-fA-F]{6}$'),
  light        public.light_preset not null default 'bright',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, owner_id)
);

-- Une présentation est soit une mise en situation 2D d'UNE œuvre, soit un accrochage dans UNE salle.
alter table public.presentations
  add column mode public.presentation_mode not null default '2d',
  add column room_id uuid null,
  alter column artwork_id drop not null,
  add foreign key (room_id, owner_id) references public.rooms (id, owner_id) on delete restrict,
  add constraint presentations_mode_shape check (
    (mode = '2d'   and artwork_id is not null and room_id is null) or
    (mode = 'room' and artwork_id is null     and room_id is not null)
  );

create table public.placements (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  variant_id    uuid not null,
  artwork_id    uuid not null,
  asset_id      uuid null,
  ordinal       integer not null check (ordinal >= 0),
  x_cm          numeric not null check (x_cm between 0 and 10000),
  z_cm          numeric not null check (z_cm between 0 and 10000),
  rotation_deg  numeric not null default 0 check (rotation_deg between -360 and 360),
  elevation_cm  numeric not null default 0 check (elevation_cm between 0 and 2000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (variant_id, owner_id) references public.variants (id, owner_id) on delete cascade,
  -- Supprimer une œuvre la retire des accrochages.
  foreign key (artwork_id, owner_id) references public.artworks (id, owner_id) on delete cascade,
  -- Supprimer une image utilisée comme panneau demande un choix explicite (comme en 2D).
  foreign key (asset_id, owner_id)   references public.assets (id, owner_id)   on delete restrict
);

create index on public.rooms (owner_id);
create index on public.presentations (room_id);
create index on public.placements (owner_id, variant_id);
create index on public.placements (artwork_id);
create index on public.placements (asset_id);

create trigger rooms_touch      before update on public.rooms      for each row execute function public.touch_updated_at();
create trigger rooms_owner      before update on public.rooms      for each row execute function public.keep_owner();
create trigger placements_touch before update on public.placements for each row execute function public.touch_updated_at();
create trigger placements_owner before update on public.placements for each row execute function public.keep_owner();

do $$
declare t text;
begin
  foreach t in array array['rooms', 'placements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = (select auth.uid()))', t || '_delete_own', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Enregistrement ATOMIQUE des placements d'un accrochage (même principe que save_variant).
-- p_placements : [{ "id", "artworkId", "assetId"|null, "xCm", "zCm", "rotationDeg", "elevationCm" }]
-- -----------------------------------------------------------------------------
create or replace function public.save_placements(p_variant_id uuid, p_note text, p_placements jsonb)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  n integer;
begin
  if jsonb_typeof(p_placements) is distinct from 'array' then
    raise exception 'p_placements doit être un tableau JSON';
  end if;
  if jsonb_array_length(p_placements) > 40 then
    raise exception 'trop d''œuvres placées (40 au maximum)';
  end if;

  update public.variants set note = nullif(btrim(coalesce(p_note, '')), '') where id = p_variant_id;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'variante introuvable ou accès non autorisé' using errcode = '42501';
  end if;

  delete from public.placements where variant_id = p_variant_id;

  insert into public.placements (id, variant_id, artwork_id, asset_id, ordinal, x_cm, z_cm, rotation_deg, elevation_cm)
  select coalesce((e.item ->> 'id')::uuid, gen_random_uuid()),
         p_variant_id,
         (e.item ->> 'artworkId')::uuid,
         nullif(e.item ->> 'assetId', '')::uuid,
         (e.ord - 1)::integer,
         (e.item ->> 'xCm')::numeric,
         (e.item ->> 'zCm')::numeric,
         coalesce((e.item ->> 'rotationDeg')::numeric, 0),
         coalesce((e.item ->> 'elevationCm')::numeric, 0)
  from jsonb_array_elements(p_placements) with ordinality as e(item, ord);
end $$;

revoke all on function public.save_placements(uuid, text, jsonb) from public, anon;
grant execute on function public.save_placements(uuid, text, jsonb) to authenticated;
