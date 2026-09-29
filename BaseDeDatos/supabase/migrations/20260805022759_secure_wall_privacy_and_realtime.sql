-- La estructura propia de Muro queda completamente en español. Las tablas
-- internas auth.users y realtime.messages pertenecen a Supabase.
alter table public.muro_profiles rename to muro_usuarios;
alter table public.muro_user_settings rename to muro_configuraciones_usuario;
alter table public.muro_walls rename to muro_salas;
alter table public.muro_wall_members rename to muro_sala_miembros;
alter table public.muro_notes rename to muro_notas;

alter table public.muro_usuarios rename column name to nombre;
alter table public.muro_usuarios rename column email to correo;
alter table public.muro_usuarios rename column role to rol;
alter table public.muro_usuarios rename column created_at to creado_en;
alter table public.muro_usuarios rename column updated_at to actualizado_en;

alter table public.muro_configuraciones_usuario rename column user_id to usuario_id;
alter table public.muro_configuraciones_usuario rename column theme to tema;
alter table public.muro_configuraciones_usuario rename column confirm_delete to confirmar_eliminacion;
alter table public.muro_configuraciones_usuario rename column compact_notes to notas_compactas;
alter table public.muro_configuraciones_usuario rename column notifications to notificaciones;
alter table public.muro_configuraciones_usuario rename column updated_at to actualizado_en;

alter table public.muro_salas rename column name to nombre;
alter table public.muro_salas rename column description to descripcion;
alter table public.muro_salas rename column owner_id to propietario_id;
alter table public.muro_salas rename column created_at to creado_en;
alter table public.muro_salas rename column updated_at to actualizado_en;

alter table public.muro_sala_miembros rename column wall_id to sala_id;
alter table public.muro_sala_miembros rename column user_id to usuario_id;
alter table public.muro_sala_miembros rename column role to rol;
alter table public.muro_sala_miembros rename column created_at to unido_en;

alter table public.muro_notas rename column wall_id to sala_id;
alter table public.muro_notas rename column text to contenido;
alter table public.muro_notas rename column x to posicion_x;
alter table public.muro_notas rename column y to posicion_y;
alter table public.muro_notas rename column author_id to autor_id;
alter table public.muro_notas rename column author_name to nombre_autor;
alter table public.muro_notas rename column created_at to creado_en;
alter table public.muro_notas rename column updated_at to actualizado_en;

alter index if exists public.muro_wall_members_user_id_idx rename to muro_sala_miembros_usuario_id_idx;
alter index if exists public.muro_notes_wall_id_idx rename to muro_notas_sala_id_idx;
alter index if exists public.muro_walls_owner_id_idx rename to muro_salas_propietario_id_idx;

alter function public.muro_is_superadmin() rename to muro_es_superadmin;
alter function public.muro_wall_role(uuid) rename to muro_rol_en_sala;
alter function public.muro_can_view_profile(uuid) rename to muro_puede_ver_usuario;
alter function public.muro_handle_new_user() rename to muro_crear_usuario;
alter function public.muro_invite_member(uuid, text, text) rename to muro_invitar_miembro;
alter function public.muro_delete_own_account() rename to muro_eliminar_cuenta_propia;

-- PostgreSQL conserva los nombres originales de parámetros al renombrar una
-- función. Se recrean estas funciones para que también queden en español.
drop function public.muro_invitar_miembro(uuid, text, text);
drop function public.muro_puede_ver_usuario(uuid) cascade;
drop function public.muro_rol_en_sala(uuid) cascade;

create or replace function public.muro_es_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.muro_usuarios
    where id = (select auth.uid()) and rol = 'superadmin'
  );
$$;

-- Un superadmin administra la plataforma, pero no hereda acceso a salas.
create or replace function public.muro_rol_en_sala(sala_objetivo uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.muro_salas
      where id = sala_objetivo and propietario_id = (select auth.uid())
    ) then 'propietario'
    else (
      select rol from public.muro_sala_miembros
      where sala_id = sala_objetivo and usuario_id = (select auth.uid())
    )
  end;
$$;

create or replace function public.muro_puede_ver_usuario(usuario_objetivo uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select usuario_objetivo = (select auth.uid())
    or exists (
      select 1
      from public.muro_sala_miembros propia
      join public.muro_sala_miembros ajena on ajena.sala_id = propia.sala_id
      where propia.usuario_id = (select auth.uid())
        and ajena.usuario_id = usuario_objetivo
    );
$$;

create or replace function public.muro_crear_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  nombre_seguro text;
begin
  nombre_seguro := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1), 'Usuario'), 40);

  insert into public.muro_usuarios (id, nombre, correo, rol)
  values (new.id, nombre_seguro, coalesce(new.email, new.id::text || '@usuario.local'), 'usuario')
  on conflict (id) do nothing;

  insert into public.muro_configuraciones_usuario (usuario_id)
  values (new.id)
  on conflict (usuario_id) do nothing;

  return new;
end;
$$;

create or replace function public.muro_invitar_miembro(sala_objetivo uuid, correo_objetivo text, rol_objetivo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  usuario_invitado uuid;
begin
  if public.muro_rol_en_sala(sala_objetivo) <> 'propietario' then
    raise exception 'Solo el propietario puede invitar miembros';
  end if;
  if rol_objetivo not in ('editor', 'lector') then
    raise exception 'Permiso no válido';
  end if;
  select id into usuario_invitado
  from public.muro_usuarios
  where lower(correo) = lower(trim(correo_objetivo));
  if usuario_invitado is null then
    raise exception 'No existe una cuenta registrada con ese correo';
  end if;
  insert into public.muro_sala_miembros (sala_id, usuario_id, rol)
  values (sala_objetivo, usuario_invitado, rol_objetivo)
  on conflict (sala_id, usuario_id) do update set rol = excluded.rol;
  return usuario_invitado;
end;
$$;

create or replace function public.muro_eliminar_cuenta_propia()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  solicitante uuid := (select auth.uid());
begin
  if solicitante is null then raise exception 'Debes iniciar sesión'; end if;
  delete from auth.users where id = solicitante;
end;
$$;

-- El panel administrativo obtiene únicamente totales. No expone nombres de
-- salas, integrantes, preferencias ni contenido de notas ajenas.
create or replace function public.muro_resumen_administrativo()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.muro_es_superadmin() then
    raise exception 'Acceso reservado al superadministrador';
  end if;
  return jsonb_build_object(
    'usuarios', (select count(*) from public.muro_usuarios),
    'salas', (select count(*) from public.muro_salas),
    'notas', (select count(*) from public.muro_notas)
  );
end;
$$;

drop policy if exists "muro_profiles_select_collaborators" on public.muro_usuarios;
drop policy if exists "muro_profiles_update_self" on public.muro_usuarios;
drop policy if exists "muro_settings_select_self" on public.muro_configuraciones_usuario;
drop policy if exists "muro_settings_update_self" on public.muro_configuraciones_usuario;
drop policy if exists "muro_walls_select_members" on public.muro_salas;
drop policy if exists "muro_walls_insert_owner" on public.muro_salas;
drop policy if exists "muro_walls_update_owner" on public.muro_salas;
drop policy if exists "muro_walls_delete_owner" on public.muro_salas;
drop policy if exists "muro_members_select_wall" on public.muro_sala_miembros;
drop policy if exists "muro_members_insert_owner" on public.muro_sala_miembros;
drop policy if exists "muro_members_update_owner" on public.muro_sala_miembros;
drop policy if exists "muro_members_delete_owner" on public.muro_sala_miembros;
drop policy if exists "muro_notes_select_members" on public.muro_notas;
drop policy if exists "muro_notes_insert_editors" on public.muro_notas;
drop policy if exists "muro_notes_update_editors" on public.muro_notas;
drop policy if exists "muro_notes_delete_editors" on public.muro_notas;

create policy "usuarios_ver_colaboradores" on public.muro_usuarios
  for select to authenticated using ((select public.muro_puede_ver_usuario(id)));
create policy "usuarios_actualizar_perfil_propio" on public.muro_usuarios
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "configuracion_ver_propia" on public.muro_configuraciones_usuario
  for select to authenticated using (usuario_id = (select auth.uid()));
create policy "configuracion_actualizar_propia" on public.muro_configuraciones_usuario
  for update to authenticated
  using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()));

create policy "salas_ver_como_miembro" on public.muro_salas
  for select to authenticated using ((select public.muro_rol_en_sala(id)) is not null);
create policy "salas_crear_como_propietario" on public.muro_salas
  for insert to authenticated with check (propietario_id = (select auth.uid()));
create policy "salas_actualizar_como_propietario" on public.muro_salas
  for update to authenticated
  using ((select public.muro_rol_en_sala(id)) = 'propietario')
  with check ((select public.muro_rol_en_sala(id)) = 'propietario');
create policy "salas_eliminar_como_propietario" on public.muro_salas
  for delete to authenticated using ((select public.muro_rol_en_sala(id)) = 'propietario');

create policy "miembros_ver_sala" on public.muro_sala_miembros
  for select to authenticated using ((select public.muro_rol_en_sala(sala_id)) is not null);
create policy "miembros_agregar_propietario" on public.muro_sala_miembros
  for insert to authenticated with check ((select public.muro_rol_en_sala(sala_id)) = 'propietario');
create policy "miembros_actualizar_propietario" on public.muro_sala_miembros
  for update to authenticated
  using ((select public.muro_rol_en_sala(sala_id)) = 'propietario')
  with check ((select public.muro_rol_en_sala(sala_id)) = 'propietario');
create policy "miembros_eliminar_propietario" on public.muro_sala_miembros
  for delete to authenticated using ((select public.muro_rol_en_sala(sala_id)) = 'propietario');

create policy "notas_ver_como_miembro" on public.muro_notas
  for select to authenticated using ((select public.muro_rol_en_sala(sala_id)) is not null);
create policy "notas_crear_como_editor" on public.muro_notas
  for insert to authenticated
  with check ((select public.muro_rol_en_sala(sala_id)) in ('propietario', 'editor') and autor_id = (select auth.uid()));
create policy "notas_actualizar_como_editor" on public.muro_notas
  for update to authenticated
  using ((select public.muro_rol_en_sala(sala_id)) in ('propietario', 'editor'))
  with check ((select public.muro_rol_en_sala(sala_id)) in ('propietario', 'editor'));
create policy "notas_eliminar_como_editor" on public.muro_notas
  for delete to authenticated using ((select public.muro_rol_en_sala(sala_id)) in ('propietario', 'editor'));

revoke all on function public.muro_es_superadmin() from public, anon;
revoke all on function public.muro_rol_en_sala(uuid) from public, anon;
revoke all on function public.muro_puede_ver_usuario(uuid) from public, anon;
revoke all on function public.muro_invitar_miembro(uuid, text, text) from public, anon;
revoke all on function public.muro_eliminar_cuenta_propia() from public, anon;
revoke all on function public.muro_resumen_administrativo() from public, anon;
grant execute on function public.muro_es_superadmin() to authenticated;
grant execute on function public.muro_rol_en_sala(uuid) to authenticated;
grant execute on function public.muro_puede_ver_usuario(uuid) to authenticated;
grant execute on function public.muro_invitar_miembro(uuid, text, text) to authenticated;
grant execute on function public.muro_eliminar_cuenta_propia() to authenticated;
grant execute on function public.muro_resumen_administrativo() to authenticated;

revoke update on public.muro_usuarios from authenticated;
grant update (nombre, avatar, actualizado_en) on public.muro_usuarios to authenticated;
grant select on public.muro_usuarios, public.muro_configuraciones_usuario, public.muro_salas, public.muro_sala_miembros, public.muro_notas to authenticated;
grant insert, update, delete on public.muro_configuraciones_usuario, public.muro_salas, public.muro_sala_miembros, public.muro_notas to authenticated;

alter table public.muro_sala_miembros replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.muro_sala_miembros;
exception when duplicate_object then null;
end $$;
