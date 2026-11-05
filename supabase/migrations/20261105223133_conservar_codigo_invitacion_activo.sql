-- Conserva el codigo de invitacion activo para que la persona propietaria
-- pueda volver a copiarlo despues de recargar. El hash sigue siendo la unica
-- informacion utilizada para aceptar la invitacion.
alter table public.muro_invitaciones
  add column if not exists codigo_visible text;

alter table public.muro_invitaciones
  drop constraint if exists muro_invitaciones_codigo_visible_check;
alter table public.muro_invitaciones
  add constraint muro_invitaciones_codigo_visible_check
  check (codigo_visible is null or codigo_visible ~ '^[A-Z0-9]{8}$');

create or replace function public.muro_crear_invitacion_codigo(
  sala_objetivo uuid,
  rol_objetivo text,
  token_hash_nuevo text,
  codigo_hash_nuevo text,
  codigo_visible_nuevo text,
  vence_en_nuevo timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  solicitante uuid := (select auth.uid());
  invitacion public.muro_invitaciones;
begin
  if solicitante is null then raise exception using errcode = '28000', message = 'sesion_requerida'; end if;
  if public.muro_rol_en_sala(sala_objetivo) <> 'propietario' then raise exception using errcode = '42501', message = 'solo_propietario'; end if;
  if rol_objetivo not in ('editor', 'lector') then raise exception using errcode = '22023', message = 'rol_invalido'; end if;
  if token_hash_nuevo !~ '^[0-9a-f]{64}$'
     or codigo_hash_nuevo !~ '^[0-9a-f]{64}$'
     or codigo_visible_nuevo !~ '^[A-Z0-9]{8}$' then
    raise exception using errcode = '22023', message = 'secreto_invalido';
  end if;
  if vence_en_nuevo <= now() + interval '5 minutes' or vence_en_nuevo > now() + interval '7 days' then
    raise exception using errcode = '22023', message = 'vigencia_invalida';
  end if;

  update public.muro_invitaciones
  set estado = case when vence_en <= now() then 'vencida' else 'cancelada' end,
      actualizado_en = now()
  where sala_id = sala_objetivo and estado = 'pendiente';

  insert into public.muro_invitaciones (
    sala_id, correo_destino, rol, token_hash, codigo_hash, codigo_visible, invitado_por, vence_en
  ) values (
    sala_objetivo, null, rol_objetivo, token_hash_nuevo, codigo_hash_nuevo,
    codigo_visible_nuevo, solicitante, vence_en_nuevo
  ) returning * into invitacion;

  return jsonb_build_object(
    'id', invitacion.id,
    'sala_id', invitacion.sala_id,
    'rol', invitacion.rol,
    'estado', invitacion.estado,
    'codigo', invitacion.codigo_visible,
    'vence_en', invitacion.vence_en
  );
end;
$$;

drop function if exists public.muro_listar_invitaciones();

create function public.muro_listar_invitaciones()
returns table (
  id uuid,
  sala_id uuid,
  sala_nombre text,
  correo text,
  rol text,
  estado text,
  es_propietario boolean,
  codigo text,
  vence_en timestamptz,
  creado_en timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  solicitante uuid := (select auth.uid());
  correo_solicitante text;
begin
  if solicitante is null then raise exception using errcode = '28000', message = 'sesion_requerida'; end if;
  select lower(u.correo) into correo_solicitante
  from public.muro_usuarios u
  where u.id = solicitante;

  update public.muro_invitaciones i
  set estado = 'vencida', actualizado_en = now()
  where i.estado = 'pendiente'
    and i.vence_en <= now()
    and (i.invitado_por = solicitante or lower(i.correo_destino) = correo_solicitante);

  return query
    select
      i.id,
      i.sala_id,
      s.nombre,
      i.correo_destino,
      i.rol,
      i.estado,
      i.invitado_por = solicitante,
      case
        when i.invitado_por = solicitante
         and i.estado = 'pendiente'
         and i.vence_en > now()
        then i.codigo_visible
        else null
      end,
      i.vence_en,
      i.creado_en
    from public.muro_invitaciones i
    join public.muro_salas s on s.id = i.sala_id
    where i.invitado_por = solicitante
       or lower(i.correo_destino) = correo_solicitante
    order by i.creado_en desc;
end;
$$;

create or replace function public.muro_reenviar_invitacion(
  invitacion_objetivo uuid,
  token_hash_nuevo text,
  codigo_hash_nuevo text,
  codigo_visible_nuevo text,
  vence_en_nuevo timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitacion public.muro_invitaciones;
begin
  if token_hash_nuevo !~ '^[0-9a-f]{64}$'
     or codigo_hash_nuevo !~ '^[0-9a-f]{64}$'
     or codigo_visible_nuevo !~ '^[A-Z0-9]{8}$'
     or vence_en_nuevo <= now() + interval '5 minutes'
     or vence_en_nuevo > now() + interval '7 days' then
    raise exception using errcode = '22023', message = 'reenvio_invalido';
  end if;

  select * into invitacion
  from public.muro_invitaciones
  where id = invitacion_objetivo
  for update;

  if invitacion.id is null
     or invitacion.invitado_por <> (select auth.uid())
     or invitacion.estado in ('aceptada', 'cancelada') then
    raise exception using errcode = '42501', message = 'invitacion_no_reenviable';
  end if;

  update public.muro_invitaciones
  set token_hash = token_hash_nuevo,
      codigo_hash = codigo_hash_nuevo,
      codigo_visible = codigo_visible_nuevo,
      estado = 'pendiente',
      vence_en = vence_en_nuevo,
      respondido_en = null,
      actualizado_en = now()
  where id = invitacion.id
  returning * into invitacion;

  return jsonb_build_object(
    'id', invitacion.id,
    'sala_id', invitacion.sala_id,
    'rol', invitacion.rol,
    'estado', invitacion.estado,
    'codigo', invitacion.codigo_visible,
    'vence_en', invitacion.vence_en
  );
end;
$$;

-- La gestion de miembros pasa por RPC para impedir que una llamada directa
-- cambie o elimine a la persona propietaria del muro.
drop policy if exists "miembros_actualizar_propietario" on public.muro_sala_miembros;
drop policy if exists "miembros_eliminar_propietario" on public.muro_sala_miembros;
revoke update, delete on public.muro_sala_miembros from authenticated;

create or replace function public.muro_cambiar_permiso_miembro(
  sala_objetivo uuid,
  usuario_objetivo uuid,
  rol_nuevo text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  solicitante uuid := (select auth.uid());
  propietario uuid;
begin
  if solicitante is null then raise exception using errcode = '28000', message = 'sesion_requerida'; end if;
  if rol_nuevo not in ('editor', 'lector') then raise exception using errcode = '22023', message = 'rol_invalido'; end if;

  select s.propietario_id into propietario
  from public.muro_salas s
  where s.id = sala_objetivo;

  if propietario is null then raise exception using errcode = 'P0002', message = 'sala_no_existe'; end if;
  if propietario <> solicitante then raise exception using errcode = '42501', message = 'solo_propietario'; end if;
  if usuario_objetivo = propietario then raise exception using errcode = '42501', message = 'propietario_protegido'; end if;

  update public.muro_sala_miembros
  set rol = rol_nuevo
  where sala_id = sala_objetivo
    and usuario_id = usuario_objetivo
    and rol <> 'propietario';

  if not found then raise exception using errcode = 'P0002', message = 'miembro_no_existe'; end if;
end;
$$;

create or replace function public.muro_revocar_miembro(
  sala_objetivo uuid,
  usuario_objetivo uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  solicitante uuid := (select auth.uid());
  propietario uuid;
begin
  if solicitante is null then raise exception using errcode = '28000', message = 'sesion_requerida'; end if;

  select s.propietario_id into propietario
  from public.muro_salas s
  where s.id = sala_objetivo;

  if propietario is null then raise exception using errcode = 'P0002', message = 'sala_no_existe'; end if;
  if propietario <> solicitante then raise exception using errcode = '42501', message = 'solo_propietario'; end if;
  if usuario_objetivo = propietario then raise exception using errcode = '42501', message = 'propietario_protegido'; end if;

  delete from public.muro_sala_miembros
  where sala_id = sala_objetivo
    and usuario_id = usuario_objetivo
    and rol <> 'propietario';

  if not found then raise exception using errcode = 'P0002', message = 'miembro_no_existe'; end if;
end;
$$;

revoke all on function public.muro_crear_invitacion_codigo(uuid, text, text, text, text, timestamptz) from public, anon;
revoke all on function public.muro_listar_invitaciones() from public, anon;
revoke all on function public.muro_reenviar_invitacion(uuid, text, text, text, timestamptz) from public, anon;
revoke all on function public.muro_cambiar_permiso_miembro(uuid, uuid, text) from public, anon;
revoke all on function public.muro_revocar_miembro(uuid, uuid) from public, anon;

grant execute on function public.muro_crear_invitacion_codigo(uuid, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.muro_listar_invitaciones() to authenticated;
grant execute on function public.muro_reenviar_invitacion(uuid, text, text, text, timestamptz) to authenticated;
grant execute on function public.muro_cambiar_permiso_miembro(uuid, uuid, text) to authenticated;
grant execute on function public.muro_revocar_miembro(uuid, uuid) to authenticated;

