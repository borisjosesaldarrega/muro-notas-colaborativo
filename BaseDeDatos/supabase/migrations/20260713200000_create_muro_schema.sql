create extension if not exists pgcrypto;

-- El prefijo muro_ mantiene este proyecto aislado de otras aplicaciones que
-- comparten la misma instancia de Supabase.
create table if not exists public.muro_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  email text not null unique,
  role text not null default 'usuario' check (role in ('usuario', 'superadmin')),
  avatar text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.muro_user_settings (
  user_id uuid primary key references public.muro_profiles(id) on delete cascade,
  theme text not null default 'light' check (theme in ('light', 'dark', 'system')),
  confirm_delete boolean not null default true,
  compact_notes boolean not null default false,
  notifications boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.muro_walls (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 160),
  owner_id uuid not null references public.muro_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.muro_wall_members (
  wall_id uuid not null references public.muro_walls(id) on delete cascade,
  user_id uuid not null references public.muro_profiles(id) on delete cascade,
  role text not null check (role in ('propietario', 'editor', 'lector')),
  created_at timestamptz not null default now(),
  primary key (wall_id, user_id)
);

create table if not exists public.muro_notes (
  id uuid primary key default gen_random_uuid(),
  wall_id uuid not null references public.muro_walls(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 280),
  color text not null check (color in ('amarillo', 'rosa', 'azul', 'verde', 'lila')),
  x numeric not null default 50 check (x between 0 and 4000),
  y numeric not null default 80 check (y between 0 and 4000),
  author_id uuid references public.muro_profiles(id) on delete set null,
  author_name text not null check (char_length(author_name) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists muro_wall_members_user_id_idx on public.muro_wall_members(user_id);
create index if not exists muro_notes_wall_id_idx on public.muro_notes(wall_id);
create index if not exists muro_walls_owner_id_idx on public.muro_walls(owner_id);

create or replace function public.muro_is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.muro_profiles
    where id = (select auth.uid()) and role = 'superadmin'
  );
$$;

create or replace function public.muro_wall_role(target_wall uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.muro_is_superadmin() then 'propietario'
    when exists (
      select 1 from public.muro_walls
      where id = target_wall and owner_id = (select auth.uid())
    ) then 'propietario'
    else (
      select role from public.muro_wall_members
      where wall_id = target_wall and user_id = (select auth.uid())
    )
  end;
$$;

create or replace function public.muro_can_view_profile(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user = (select auth.uid())
    or public.muro_is_superadmin()
    or exists (
      select 1
      from public.muro_wall_members mine
      join public.muro_wall_members theirs on theirs.wall_id = mine.wall_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = target_user
    );
$$;

create or replace function public.muro_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  general_id constant uuid := '00000000-0000-0000-0000-000000000001';
  assigned_role text;
  safe_name text;
begin
  perform pg_advisory_xact_lock(hashtext('muro-first-superadmin'));
  assigned_role := case when exists (select 1 from public.muro_profiles) then 'usuario' else 'superadmin' end;
  safe_name := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1), 'Usuario'), 40);

  insert into public.muro_profiles (id, name, email, role)
  values (new.id, safe_name, coalesce(new.email, new.id::text || '@usuario.local'), assigned_role)
  on conflict (id) do nothing;

  insert into public.muro_user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;

  insert into public.muro_walls (id, name, description, owner_id)
  values (general_id, 'Muro de ideas', 'Un espacio compartido para las ideas del equipo.', new.id)
  on conflict (id) do nothing;

  insert into public.muro_wall_members (wall_id, user_id, role)
  values (
    general_id,
    new.id,
    case when (select owner_id from public.muro_walls where id = general_id) = new.id then 'propietario' else 'editor' end
  )
  on conflict (wall_id, user_id) do nothing;

  if (select owner_id from public.muro_walls where id = general_id) = new.id
    and not exists (select 1 from public.muro_notes where wall_id = general_id)
  then
    insert into public.muro_notes (wall_id, text, color, x, y, author_id, author_name)
    values (general_id, '¡Bienvenidos! Crea una nota y muévela por el muro.', 'amarillo', 80, 100, new.id, 'Equipo');
  end if;
  return new;
end;
$$;

-- Incorpora usuarios existentes sin tocar los perfiles del otro sistema.
with existing_users as (
  select
    id,
    left(coalesce(nullif(trim(raw_user_meta_data ->> 'name'), ''), split_part(email, '@', 1), 'Usuario'), 40) as name,
    coalesce(email, id::text || '@usuario.local') as email,
    created_at,
    row_number() over (order by created_at, id) as position
  from auth.users
)
insert into public.muro_profiles (id, name, email, role, created_at)
select id, name, email, case when position = 1 then 'superadmin' else 'usuario' end, created_at
from existing_users
on conflict (id) do nothing;

insert into public.muro_user_settings (user_id)
select id from public.muro_profiles
on conflict (user_id) do nothing;

insert into public.muro_walls (id, name, description, owner_id)
select
  '00000000-0000-0000-0000-000000000001',
  'Muro de ideas',
  'Un espacio compartido para las ideas del equipo.',
  id
from public.muro_profiles
order by created_at, id
limit 1
on conflict (id) do nothing;

insert into public.muro_wall_members (wall_id, user_id, role)
select
  '00000000-0000-0000-0000-000000000001',
  profile.id,
  case when wall.owner_id = profile.id then 'propietario' else 'editor' end
from public.muro_profiles profile
join public.muro_walls wall on wall.id = '00000000-0000-0000-0000-000000000001'
on conflict (wall_id, user_id) do nothing;

insert into public.muro_notes (wall_id, text, color, x, y, author_id, author_name)
select wall.id, '¡Bienvenidos! Crea una nota y muévela por el muro.', 'amarillo', 80, 100, wall.owner_id, 'Equipo'
from public.muro_walls wall
where wall.id = '00000000-0000-0000-0000-000000000001'
  and not exists (select 1 from public.muro_notes note where note.wall_id = wall.id);

drop trigger if exists on_auth_user_created_muro on auth.users;
create trigger on_auth_user_created_muro
  after insert on auth.users
  for each row execute procedure public.muro_handle_new_user();

alter table public.muro_profiles enable row level security;
alter table public.muro_user_settings enable row level security;
alter table public.muro_walls enable row level security;
alter table public.muro_wall_members enable row level security;
alter table public.muro_notes enable row level security;

create policy "muro_profiles_select_collaborators" on public.muro_profiles
  for select to authenticated using (public.muro_can_view_profile(id));
create policy "muro_profiles_update_self" on public.muro_profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "muro_settings_select_self" on public.muro_user_settings
  for select to authenticated using (user_id = (select auth.uid()) or public.muro_is_superadmin());
create policy "muro_settings_update_self" on public.muro_user_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "muro_walls_select_members" on public.muro_walls
  for select to authenticated using (public.muro_wall_role(id) is not null);
create policy "muro_walls_insert_owner" on public.muro_walls
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "muro_walls_update_owner" on public.muro_walls
  for update to authenticated
  using (public.muro_wall_role(id) = 'propietario')
  with check (public.muro_wall_role(id) = 'propietario');
create policy "muro_walls_delete_owner" on public.muro_walls
  for delete to authenticated using (public.muro_wall_role(id) = 'propietario');

create policy "muro_members_select_wall" on public.muro_wall_members
  for select to authenticated using (public.muro_wall_role(wall_id) is not null);
create policy "muro_members_insert_owner" on public.muro_wall_members
  for insert to authenticated with check (public.muro_wall_role(wall_id) = 'propietario');
create policy "muro_members_update_owner" on public.muro_wall_members
  for update to authenticated
  using (public.muro_wall_role(wall_id) = 'propietario')
  with check (public.muro_wall_role(wall_id) = 'propietario');
create policy "muro_members_delete_owner" on public.muro_wall_members
  for delete to authenticated using (public.muro_wall_role(wall_id) = 'propietario');

create policy "muro_notes_select_members" on public.muro_notes
  for select to authenticated using (public.muro_wall_role(wall_id) is not null);
create policy "muro_notes_insert_editors" on public.muro_notes
  for insert to authenticated
  with check (public.muro_wall_role(wall_id) in ('propietario', 'editor') and author_id = (select auth.uid()));
create policy "muro_notes_update_editors" on public.muro_notes
  for update to authenticated
  using (public.muro_wall_role(wall_id) in ('propietario', 'editor'))
  with check (public.muro_wall_role(wall_id) in ('propietario', 'editor'));
create policy "muro_notes_delete_editors" on public.muro_notes
  for delete to authenticated using (public.muro_wall_role(wall_id) in ('propietario', 'editor'));

revoke update on public.muro_profiles from authenticated;
grant update (name, avatar, updated_at) on public.muro_profiles to authenticated;
grant select on public.muro_profiles, public.muro_user_settings, public.muro_walls, public.muro_wall_members, public.muro_notes to authenticated;
grant insert, update, delete on public.muro_user_settings, public.muro_walls, public.muro_wall_members, public.muro_notes to authenticated;
grant execute on function public.muro_is_superadmin() to authenticated;
grant execute on function public.muro_wall_role(uuid) to authenticated;
grant execute on function public.muro_can_view_profile(uuid) to authenticated;
