create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  email text not null unique,
  role text not null default 'usuario' check (role in ('usuario', 'superadmin')),
  avatar text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme text not null default 'light' check (theme in ('light', 'dark', 'system')),
  confirm_delete boolean not null default true,
  compact_notes boolean not null default false,
  notifications boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.walls (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 160),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wall_members (
  wall_id uuid not null references public.walls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('propietario', 'editor', 'lector')),
  created_at timestamptz not null default now(),
  primary key (wall_id, user_id)
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  wall_id uuid not null references public.walls(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 280),
  color text not null check (color in ('amarillo', 'rosa', 'azul', 'verde', 'lila')),
  x numeric not null default 50 check (x between 0 and 4000),
  y numeric not null default 80 check (y between 0 and 4000),
  author_id uuid references public.profiles(id) on delete set null,
  author_name text not null check (char_length(author_name) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wall_members_user_id_idx on public.wall_members(user_id);
create index if not exists notes_wall_id_idx on public.notes(wall_id);
create index if not exists walls_owner_id_idx on public.walls(owner_id);

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'superadmin'
  );
$$;

create or replace function public.wall_role(target_wall uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_superadmin() then 'propietario'
    when exists (
      select 1 from public.walls
      where id = target_wall and owner_id = (select auth.uid())
    ) then 'propietario'
    else (
      select role from public.wall_members
      where wall_id = target_wall and user_id = (select auth.uid())
    )
  end;
$$;

create or replace function public.can_view_profile(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user = (select auth.uid())
    or public.is_superadmin()
    or exists (
      select 1
      from public.wall_members mine
      join public.wall_members theirs on theirs.wall_id = mine.wall_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = target_user
    );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  general_id constant uuid := '00000000-0000-0000-0000-000000000001';
  assigned_role text;
begin
  perform pg_advisory_xact_lock(hashtext('muro-first-superadmin'));
  assigned_role := case when exists (select 1 from public.profiles) then 'usuario' else 'superadmin' end;

  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
    new.email,
    assigned_role
  );
  insert into public.user_settings (user_id) values (new.id);

  insert into public.walls (id, name, description, owner_id)
  values (general_id, 'Muro de ideas', 'Un espacio compartido para las ideas del equipo.', new.id)
  on conflict (id) do nothing;

  insert into public.wall_members (wall_id, user_id, role)
  values (
    general_id,
    new.id,
    case when (select owner_id from public.walls where id = general_id) = new.id then 'propietario' else 'editor' end
  )
  on conflict (wall_id, user_id) do nothing;

  if (select owner_id from public.walls where id = general_id) = new.id then
    insert into public.notes (wall_id, text, color, x, y, author_id, author_name)
    values (general_id, '¡Bienvenidos! Crea una nota y muévela por el muro.', 'amarillo', 80, 100, new.id, 'Equipo');
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.walls enable row level security;
alter table public.wall_members enable row level security;
alter table public.notes enable row level security;

create policy "profiles_select_collaborators" on public.profiles
  for select to authenticated using (public.can_view_profile(id));
create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "settings_select_self" on public.user_settings
  for select to authenticated using (user_id = (select auth.uid()) or public.is_superadmin());
create policy "settings_update_self" on public.user_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "walls_select_members" on public.walls
  for select to authenticated using (public.wall_role(id) is not null);
create policy "walls_insert_owner" on public.walls
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "walls_update_owner" on public.walls
  for update to authenticated
  using (public.wall_role(id) = 'propietario')
  with check (public.wall_role(id) = 'propietario');
create policy "walls_delete_owner" on public.walls
  for delete to authenticated using (public.wall_role(id) = 'propietario');

create policy "members_select_wall" on public.wall_members
  for select to authenticated using (public.wall_role(wall_id) is not null);
create policy "members_insert_owner" on public.wall_members
  for insert to authenticated with check (public.wall_role(wall_id) = 'propietario');
create policy "members_update_owner" on public.wall_members
  for update to authenticated
  using (public.wall_role(wall_id) = 'propietario')
  with check (public.wall_role(wall_id) = 'propietario');
create policy "members_delete_owner" on public.wall_members
  for delete to authenticated using (public.wall_role(wall_id) = 'propietario');

create policy "notes_select_members" on public.notes
  for select to authenticated using (public.wall_role(wall_id) is not null);
create policy "notes_insert_editors" on public.notes
  for insert to authenticated
  with check (public.wall_role(wall_id) in ('propietario', 'editor') and author_id = (select auth.uid()));
create policy "notes_update_editors" on public.notes
  for update to authenticated
  using (public.wall_role(wall_id) in ('propietario', 'editor'))
  with check (public.wall_role(wall_id) in ('propietario', 'editor'));
create policy "notes_delete_editors" on public.notes
  for delete to authenticated using (public.wall_role(wall_id) in ('propietario', 'editor'));

revoke update on public.profiles from authenticated;
grant update (name, avatar, updated_at) on public.profiles to authenticated;
grant select on public.profiles, public.user_settings, public.walls, public.wall_members, public.notes to authenticated;
grant insert, update, delete on public.user_settings, public.walls, public.wall_members, public.notes to authenticated;
grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.wall_role(uuid) to authenticated;
grant execute on function public.can_view_profile(uuid) to authenticated;
