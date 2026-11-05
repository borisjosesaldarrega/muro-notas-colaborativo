create or replace function public.muro_invite_member(target_wall uuid, target_email text, target_role text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invited_id uuid;
begin
  if public.muro_wall_role(target_wall) <> 'propietario' then
    raise exception 'Solo el propietario puede invitar miembros';
  end if;
  if target_role not in ('editor', 'lector') then
    raise exception 'Permiso no válido';
  end if;
  select id into invited_id from public.muro_profiles where lower(email) = lower(trim(target_email));
  if invited_id is null then
    raise exception 'No existe una cuenta registrada con ese correo';
  end if;
  insert into public.muro_wall_members (wall_id, user_id, role)
  values (target_wall, invited_id, target_role)
  on conflict (wall_id, user_id) do update set role = excluded.role;
  return invited_id;
end;
$$;

revoke all on function public.muro_invite_member(uuid, text, text) from public, anon;
grant execute on function public.muro_invite_member(uuid, text, text) to authenticated;

create or replace function public.muro_delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then raise exception 'Debes iniciar sesión'; end if;
  delete from auth.users where id = caller;
end;
$$;

revoke all on function public.muro_delete_own_account() from public, anon;
grant execute on function public.muro_delete_own_account() to authenticated;

alter table public.muro_notes replica identity full;
alter table public.muro_walls replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.muro_notes;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.muro_walls;
exception when duplicate_object then null;
end $$;
