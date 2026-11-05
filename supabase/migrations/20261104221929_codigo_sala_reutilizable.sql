-- Un muro mantiene un solo código activo. El código puede ser utilizado por
-- varias cuentas y cada aceptación crea una membresía distinta.
with ordenadas as (
  select id, row_number() over (partition by sala_id order by creado_en desc) as posicion
  from public.muro_invitaciones
  where estado = 'pendiente'
)
update public.muro_invitaciones i
set estado = 'cancelada', actualizado_en = now()
from ordenadas o
where i.id = o.id and o.posicion > 1;

drop index if exists public.muro_invitaciones_pendiente_unica_idx;
create unique index muro_invitaciones_codigo_activo_por_sala_idx
  on public.muro_invitaciones (sala_id)
  where estado = 'pendiente';

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

  update public.muro_invitaciones
  set estado = case when vence_en <= now() then 'vencida' else 'cancelada' end,
      actualizado_en = now()
  where sala_id = sala_objetivo and estado = 'pendiente';

  insert into public.muro_invitaciones (
    sala_id, correo_destino, rol, token_hash, codigo_hash, invitado_por, vence_en
  ) values (
    sala_objetivo, null, rol_objetivo, token_hash_nuevo, codigo_hash_nuevo, solicitante, vence_en_nuevo
  ) returning * into invitacion;

  return jsonb_build_object('id', invitacion.id, 'sala_id', invitacion.sala_id,
    'rol', invitacion.rol, 'estado', invitacion.estado, 'vence_en', invitacion.vence_en);
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
  if respuesta <> 'aceptar' or secreto_hash !~ '^[0-9a-f]{64}$' then raise exception using errcode = '22023', message = 'invitacion_invalida'; end if;
  select * into invitacion from public.muro_invitaciones
    where token_hash = secreto_hash or codigo_hash = secreto_hash
    for update;
  if invitacion.id is null or invitacion.estado <> 'pendiente' then raise exception using errcode = 'P0002', message = 'invitacion_invalida'; end if;
  if invitacion.vence_en <= now() then
    update public.muro_invitaciones set estado = 'vencida', actualizado_en = now() where id = invitacion.id;
    raise exception using errcode = '22023', message = 'invitacion_vencida';
  end if;
  if exists (select 1 from public.muro_sala_miembros where sala_id = invitacion.sala_id and usuario_id = solicitante) then
    raise exception using errcode = '23505', message = 'ya_es_miembro';
  end if;

  insert into public.muro_sala_miembros (sala_id, usuario_id, rol)
    values (invitacion.sala_id, solicitante, invitacion.rol);

  select nombre into nombre_sala from public.muro_salas where id = invitacion.sala_id;
  select nombre into nombre_invitante from public.muro_usuarios where id = invitacion.invitado_por;
  return jsonb_build_object(
    'id', invitacion.id,
    'sala_id', invitacion.sala_id,
    'sala_nombre', nombre_sala,
    'invitado_por_nombre', nombre_invitante,
    'estado', 'aceptada'
  );
end;
$$;
