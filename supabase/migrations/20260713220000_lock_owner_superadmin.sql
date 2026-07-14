-- Reserva el rol global superadmin a la cuenta propietaria existente.
update public.muro_profiles
set
  role = case
    when lower(email) = 'saldavargasboris@gmail.com' then 'superadmin'
    else 'usuario'
  end,
  updated_at = now();

-- Todos los registros nuevos nacen como usuario. El rol administrativo nunca
-- se toma de formularios, metadata ni del orden en que se crea una cuenta.
create or replace function public.muro_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  general_id constant uuid := '00000000-0000-0000-0000-000000000001';
  safe_name text;
begin
  safe_name := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1), 'Usuario'), 40);

  insert into public.muro_profiles (id, name, email, role)
  values (new.id, safe_name, coalesce(new.email, new.id::text || '@usuario.local'), 'usuario')
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
