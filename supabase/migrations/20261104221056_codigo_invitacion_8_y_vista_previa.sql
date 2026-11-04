-- Permite comprobar de forma segura a qué muro corresponde un código antes
-- de aceptarlo. Solo una cuenta autenticada recibe el nombre del muro y de
-- la persona que invitó; nunca se expone el hash ni contenido privado.
alter table public.muro_invitaciones alter column correo_destino drop not null;

revoke all on function public.muro_crear_invitacion(uuid, text, text, text, text, timestamptz) from authenticated;
drop function public.muro_crear_invitacion(uuid, text, text, text, text, timestamptz);

create or replace function public.muro_crear_invitacion_codigo(
  sala_objetivo uuid,
  rol_objetivo text,
  token_hash_nuevo text,
  codigo_hash_nuevo text,
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
  if token_hash_nuevo !~ '^[0-9a-f]{64}$' or codigo_hash_nuevo !~ '^[0-9a-f]{64}$' then raise exception using errcode = '22023', message = 'secreto_invalido'; end if;
  if vence_en_nuevo <= now() + interval '5 minutes' or vence_en_nuevo > now() + interval '7 days' then raise exception using errcode = '22023', message = 'vigencia_invalida'; end if;

  insert into public.muro_invitaciones (
    sala_id, correo_destino, rol, token_hash, codigo_hash, invitado_por, vence_en
  ) values (
    sala_objetivo, null, rol_objetivo, token_hash_nuevo, codigo_hash_nuevo, solicitante, vence_en_nuevo
  ) returning * into invitacion;

  return jsonb_build_object('id', invitacion.id, 'sala_id', invitacion.sala_id,
    'rol', invitacion.rol, 'estado', invitacion.estado, 'vence_en', invitacion.vence_en);
end;
$$;

create or replace function public.muro_inspeccionar_invitacion(secreto_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  solicitante uuid := (select auth.uid());
  resultado jsonb;
begin
  if solicitante is null then raise exception using errcode = '28000', message = 'sesion_requerida'; end if;
  if secreto_hash !~ '^[0-9a-f]{64}$' then raise exception using errcode = '22023', message = 'invitacion_invalida'; end if;
  update public.muro_invitaciones i
  set estado = 'vencida', actualizado_en = now()
  where (i.token_hash = secreto_hash or i.codigo_hash = secreto_hash)
    and i.estado = 'pendiente' and i.vence_en <= now();

  select jsonb_build_object(
    'sala_id', i.sala_id,
    'sala_nombre', s.nombre,
    'invitado_por_nombre', u.nombre,
    'rol', i.rol,
    'vence_en', i.vence_en
  ) into resultado
  from public.muro_invitaciones i
  join public.muro_salas s on s.id = i.sala_id
  join public.muro_usuarios u on u.id = i.invitado_por
  where (i.token_hash = secreto_hash or i.codigo_hash = secreto_hash)
    and i.estado = 'pendiente' and i.vence_en > now();

  if resultado is null then raise exception using errcode = 'P0002', message = 'invitacion_invalida'; end if;
  return resultado;
end;
$$;

create or replace function public.muro_responder_invitacion(secreto_hash text, respuesta text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  solicitante uuid := (select auth.uid());
  invitacion public.muro_invitaciones;
  nombre_sala text;
  nombre_invitante text;
begin
  if solicitante is null then raise exception using errcode = '28000', message = 'sesion_requerida'; end if;
  if respuesta not in ('aceptar', 'rechazar') or secreto_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invitacion_invalida';
  end if;
  select * into invitacion from public.muro_invitaciones
    where token_hash = secreto_hash or codigo_hash = secreto_hash
    for update;
  if invitacion.id is null then raise exception using errcode = 'P0002', message = 'invitacion_invalida'; end if;
  if invitacion.estado <> 'pendiente' then raise exception using errcode = '55000', message = 'invitacion_utilizada'; end if;
  if invitacion.vence_en <= now() then
    update public.muro_invitaciones set estado = 'vencida', actualizado_en = now() where id = invitacion.id;
    raise exception using errcode = '22023', message = 'invitacion_vencida';
  end if;

  if respuesta = 'aceptar' then
    if exists (select 1 from public.muro_sala_miembros where sala_id = invitacion.sala_id and usuario_id = solicitante) then
      raise exception using errcode = '23505', message = 'ya_es_miembro';
    end if;
    insert into public.muro_sala_miembros (sala_id, usuario_id, rol) values (invitacion.sala_id, solicitante, invitacion.rol);
    update public.muro_invitaciones set estado = 'aceptada', respondido_en = now(), actualizado_en = now() where id = invitacion.id;
  else
    update public.muro_invitaciones set estado = 'rechazada', respondido_en = now(), actualizado_en = now() where id = invitacion.id;
  end if;

  select nombre into nombre_sala from public.muro_salas where id = invitacion.sala_id;
  select nombre into nombre_invitante from public.muro_usuarios where id = invitacion.invitado_por;
  return jsonb_build_object(
    'id', invitacion.id,
    'sala_id', invitacion.sala_id,
    'sala_nombre', nombre_sala,
    'invitado_por_nombre', nombre_invitante,
    'estado', case when respuesta = 'aceptar' then 'aceptada' else 'rechazada' end
  );
end;
$$;

revoke all on function public.muro_inspeccionar_invitacion(text) from public, anon;
revoke all on function public.muro_crear_invitacion_codigo(uuid, text, text, text, timestamptz) from public, anon;
revoke all on function public.muro_responder_invitacion(text, text) from public, anon;
grant execute on function public.muro_crear_invitacion_codigo(uuid, text, text, text, timestamptz) to authenticated;
grant execute on function public.muro_inspeccionar_invitacion(text) to authenticated;
grant execute on function public.muro_responder_invitacion(text, text) to authenticated;
