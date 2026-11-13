-- =============================================================================
-- V2, phase 1 — Éléments multiples par variante (F-25, F-26, F-27)
-- Migration ADDITIVE : crée variant_items, reprend les variantes V1, ajoute save_variant().
-- Les colonnes héritées variants.foreground_asset_id et variants.transform sont conservées
-- (plus écrites par l'application) ; elles seront supprimées dans une migration ultérieure,
-- après validation en production.
-- =============================================================================

create table public.variant_items (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  variant_id  uuid not null,
  asset_id    uuid not null,
  name        text null check (name is null or char_length(name) between 1 and 200),
  z_index     integer not null check (z_index >= 0),
  transform   jsonb not null,
  hidden      boolean not null default false,
  locked      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (variant_id, z_index) deferrable initially deferred,
  check (
    jsonb_typeof(transform) = 'object'
    and transform ->> 'schemaVersion' = '1'
    and jsonb_typeof(transform -> 'x') = 'number'
    and jsonb_typeof(transform -> 'y') = 'number'
    and jsonb_typeof(transform -> 'scale') = 'number'
    and jsonb_typeof(transform -> 'rotationDeg') = 'number'
  )
);

-- variants n'avait pas encore de clé (id, owner_id) : nécessaire pour la clé étrangère composite.
alter table public.variants add constraint variants_id_owner_key unique (id, owner_id);

alter table public.variant_items
  add foreign key (variant_id, owner_id) references public.variants (id, owner_id) on delete cascade,
  -- Une image utilisée par un élément ne disparaît pas silencieusement.
  add foreign key (asset_id, owner_id)   references public.assets (id, owner_id)   on delete restrict;

create index on public.variant_items (owner_id, variant_id);
create index on public.variant_items (asset_id);

create trigger variant_items_touch before update on public.variant_items for each row execute function public.touch_updated_at();
create trigger variant_items_owner before update on public.variant_items for each row execute function public.keep_owner();

alter table public.variant_items enable row level security;
alter table public.variant_items force row level security;
revoke all on public.variant_items from anon;
grant select, insert, update, delete on public.variant_items to authenticated;

create policy variant_items_select_own on public.variant_items for select to authenticated using (owner_id = (select auth.uid()));
create policy variant_items_insert_own on public.variant_items for insert to authenticated with check (owner_id = (select auth.uid()));
create policy variant_items_update_own on public.variant_items for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy variant_items_delete_own on public.variant_items for delete to authenticated using (owner_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Reprise des données V1 (F-27) : la photo unique devient le premier élément.
-- Exécuté par le rôle de migration (contourne la RLS) ; owner_id est recopié de la variante.
-- -----------------------------------------------------------------------------
insert into public.variant_items (owner_id, variant_id, asset_id, z_index, transform)
select v.owner_id, v.id, v.foreground_asset_id, 0, v.transform
from public.variants v
where v.foreground_asset_id is not null
  and not exists (select 1 from public.variant_items i where i.variant_id = v.id);

-- L'application V2 n'écrit plus ces colonnes.
alter table public.variants alter column transform drop not null;

-- -----------------------------------------------------------------------------
-- Enregistrement ATOMIQUE d'une variante et de sa liste d'éléments.
-- security invoker : la RLS et les clés étrangères composites s'appliquent à l'appelant.
-- p_items : tableau JSON ordonné du fond vers le premier plan,
--           [{ "id": uuid, "assetId": uuid, "name": text|null, "transform": {...}, "hidden": bool, "locked": bool }]
-- -----------------------------------------------------------------------------
create or replace function public.save_variant(
  p_variant_id uuid,
  p_background_asset_id uuid,
  p_note text,
  p_items jsonb
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  n integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items doit être un tableau JSON';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'trop d''éléments (30 au maximum)';
  end if;

  update public.variants
     set background_asset_id = p_background_asset_id,
         note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_variant_id;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'variante introuvable ou accès non autorisé' using errcode = '42501';
  end if;

  delete from public.variant_items where variant_id = p_variant_id;

  insert into public.variant_items (id, variant_id, asset_id, name, z_index, transform, hidden, locked)
  select coalesce((e.item ->> 'id')::uuid, gen_random_uuid()),
         p_variant_id,
         (e.item ->> 'assetId')::uuid,
         nullif(btrim(coalesce(e.item ->> 'name', '')), ''),
         (e.ord - 1)::integer,
         e.item -> 'transform',
         coalesce((e.item ->> 'hidden')::boolean, false),
         coalesce((e.item ->> 'locked')::boolean, false)
  from jsonb_array_elements(p_items) with ordinality as e(item, ord);
end $$;

revoke all on function public.save_variant(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.save_variant(uuid, uuid, text, jsonb) to authenticated;
