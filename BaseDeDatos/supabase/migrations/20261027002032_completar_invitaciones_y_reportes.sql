-- Invitaciones verificables: el secreto se entrega al destinatario y en la
-- base solo queda su SHA-256. La membresia nace exclusivamente al aceptar.
create table public.muro_invitaciones (
  id uuid primary key default gen_random_uuid(),
  sala_id uuid not null references public.muro_salas(id) on delete cascade,
  correo_destino text not null check (char_length(correo_destino) between 3 and 120),
  rol text not null check (rol in ('editor', 'lector')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  codigo_hash text not null unique check (codigo_hash ~ '^[0-9a-f]{64}$'),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aceptada', 'rechazada', 'cancelada', 'vencida')),
  invitado_por uuid not null references public.muro_usuarios(id) on delete cascade,
  vence_en timestamptz not null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  respondido_en timestamptz,
  constraint muro_invitaciones_vigencia_check check (vence_en > creado_en)
);

create unique index muro_invitaciones_pendiente_unica_idx
  on public.muro_invitaciones (sala_id, lower(correo_destino))
  where estado = 'pendiente';
create index muro_invitaciones_correo_idx on public.muro_invitaciones (lower(correo_destino), creado_en desc);
create index muro_invitaciones_propietario_idx on public.muro_invitaciones (invitado_por, creado_en desc);

alter table public.muro_invitaciones enable row level security;

create policy "invitaciones_ver_destinatario_o_propietario"
  on public.muro_invitaciones for select to authenticated
  using (
    invitado_por = (select auth.uid())
    or lower(correo_destino) = lower(coalesce((select correo from public.muro_usuarios where id = (select auth.uid())), ''))
  );

grant select on public.muro_invitaciones to authenticated;
grant select, insert, update, delete on public.muro_invitaciones to service_role;

create or replace function public.muro_crear_invitacion(
  sala_objetivo uuid,
  correo_objetivo text,
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
  correo_normalizado text := lower(trim(correo_objetivo));
  destinatario uuid;
  invitacion public.muro_invitaciones;
begin
  if solicitante is null then raise exception using errcode = '28000', message = 'sesion_requerida'; end if;
  if public.muro_rol_en_sala(sala_objetivo) <> 'propietario' then
    raise exception using errcode = '42501', message = 'solo_propietario';
  end if;
  if rol_objetivo not in ('editor', 'lector') then
    raise exception using errcode = '22023', message = 'rol_invalido';
  end if;
  if correo_normalizado !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'correo_invalido';
  end if;
  if token_hash_nuevo !~ '^[0-9a-f]{64}$' or codigo_hash_nuevo !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'secreto_invalido';
  end if;
  if vence_en_nuevo <= now() + interval '5 minutes' or vence_en_nuevo > now() + interval '7 days' then
    raise exception using errcode = '22023', message = 'vigencia_invalida';
  end if;

  select id into destinatario from public.muro_usuarios where lower(correo) = correo_normalizado;
  if destinatario is null then raise exception using errcode = 'P0002', message = 'destinatario_no_existe'; end if;
  if destinatario = solicitante then raise exception using errcode = '22023', message = 'auto_invitacion'; end if;
  if exists (select 1 from public.muro_sala_miembros where sala_id = sala_objetivo and usuario_id = destinatario) then
    raise exception using errcode = '23505', message = 'ya_es_miembro';
  end if;

  update public.muro_invitaciones
  set estado = 'vencida', actualizado_en = now()
  where sala_id = sala_objetivo and lower(correo_destino) = correo_normalizado
    and estado = 'pendiente' and vence_en <= now();

  insert into public.muro_invitaciones (
    sala_id, correo_destino, rol, token_hash, codigo_hash, invitado_por, vence_en
  ) values (
    sala_objetivo, correo_normalizado, rol_objetivo, token_hash_nuevo, codigo_hash_nuevo, solicitante, vence_en_nuevo
  ) returning * into invitacion;

  return jsonb_build_object('id', invitacion.id, 'sala_id', invitacion.sala_id,
    'correo', invitacion.correo_destino, 'rol', invitacion.rol,
    'estado', invitacion.estado, 'vence_en', invitacion.vence_en);
end;
$$;

create or replace function public.muro_listar_invitaciones()
returns table (
  id uuid, sala_id uuid, sala_nombre text, correo text, rol text, estado text,
  es_propietario boolean, vence_en timestamptz, creado_en timestamptz
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
  select lower(u.correo) into correo_solicitante from public.muro_usuarios u where u.id = solicitante;
  update public.muro_invitaciones i set estado = 'vencida', actualizado_en = now()
    where i.estado = 'pendiente' and i.vence_en <= now()
      and (i.invitado_por = solicitante or lower(i.correo_destino) = correo_solicitante);
  return query
    select i.id, i.sala_id, s.nombre, i.correo_destino, i.rol, i.estado,
      i.invitado_por = solicitante, i.vence_en, i.creado_en
    from public.muro_invitaciones i
    join public.muro_salas s on s.id = i.sala_id
    where i.invitado_por = solicitante or lower(i.correo_destino) = correo_solicitante
    order by i.creado_en desc;
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
  correo_solicitante text;
  invitacion public.muro_invitaciones;
begin
  if solicitante is null then raise exception using errcode = '28000', message = 'sesion_requerida'; end if;
  if respuesta not in ('aceptar', 'rechazar') or secreto_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invitacion_invalida';
  end if;
  select lower(correo) into correo_solicitante from public.muro_usuarios where id = solicitante;
  select * into invitacion from public.muro_invitaciones
    where token_hash = secreto_hash or codigo_hash = secreto_hash
    for update;
  if invitacion.id is null then raise exception using errcode = 'P0002', message = 'invitacion_invalida'; end if;
  if lower(invitacion.correo_destino) <> correo_solicitante then
    raise exception using errcode = '42501', message = 'destinatario_incorrecto';
  end if;
  if invitacion.estado <> 'pendiente' then raise exception using errcode = '55000', message = 'invitacion_utilizada'; end if;
  if invitacion.vence_en <= now() then
    update public.muro_invitaciones set estado = 'vencida', actualizado_en = now() where id = invitacion.id;
    raise exception using errcode = '22023', message = 'invitacion_vencida';
  end if;

  if respuesta = 'aceptar' then
    if exists (select 1 from public.muro_sala_miembros where sala_id = invitacion.sala_id and usuario_id = solicitante) then
      raise exception using errcode = '23505', message = 'ya_es_miembro';
    end if;
    insert into public.muro_sala_miembros (sala_id, usuario_id, rol)
      values (invitacion.sala_id, solicitante, invitacion.rol);
    update public.muro_invitaciones set estado = 'aceptada', respondido_en = now(), actualizado_en = now()
      where id = invitacion.id;
  else
    update public.muro_invitaciones set estado = 'rechazada', respondido_en = now(), actualizado_en = now()
      where id = invitacion.id;
  end if;
  return jsonb_build_object('id', invitacion.id, 'sala_id', invitacion.sala_id,
    'estado', case when respuesta = 'aceptar' then 'aceptada' else 'rechazada' end);
end;
$$;

create or replace function public.muro_cancelar_invitacion(invitacion_objetivo uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.muro_invitaciones set estado = 'cancelada', respondido_en = now(), actualizado_en = now()
  where id = invitacion_objetivo and invitado_por = (select auth.uid()) and estado = 'pendiente';
  if not found then raise exception using errcode = '42501', message = 'invitacion_no_cancelable'; end if;
end;
$$;

create or replace function public.muro_reenviar_invitacion(
  invitacion_objetivo uuid, token_hash_nuevo text, codigo_hash_nuevo text, vence_en_nuevo timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare invitacion public.muro_invitaciones;
begin
  if token_hash_nuevo !~ '^[0-9a-f]{64}$' or codigo_hash_nuevo !~ '^[0-9a-f]{64}$'
     or vence_en_nuevo <= now() + interval '5 minutes' or vence_en_nuevo > now() + interval '7 days' then
    raise exception using errcode = '22023', message = 'reenvio_invalido';
  end if;
  select * into invitacion from public.muro_invitaciones where id = invitacion_objetivo for update;
  if invitacion.id is null or invitacion.invitado_por <> (select auth.uid())
     or invitacion.estado in ('aceptada', 'cancelada') then
    raise exception using errcode = '42501', message = 'invitacion_no_reenviable';
  end if;
  if exists (select 1 from public.muro_usuarios u join public.muro_sala_miembros m on m.usuario_id = u.id
    where m.sala_id = invitacion.sala_id and lower(u.correo) = lower(invitacion.correo_destino)) then
    raise exception using errcode = '23505', message = 'ya_es_miembro';
  end if;
  update public.muro_invitaciones set token_hash = token_hash_nuevo, codigo_hash = codigo_hash_nuevo,
    estado = 'pendiente', vence_en = vence_en_nuevo, respondido_en = null, actualizado_en = now()
  where id = invitacion.id returning * into invitacion;
  return jsonb_build_object('id', invitacion.id, 'sala_id', invitacion.sala_id,
    'correo', invitacion.correo_destino, 'rol', invitacion.rol,
    'estado', invitacion.estado, 'vence_en', invitacion.vence_en);
end;
$$;

-- El autor y los cambios de estado se derivan siempre de la sesion/RPC.
alter table public.muro_reportes drop constraint if exists muro_reportes_estado_check;
update public.muro_reportes set estado = 'rechazado' where estado = 'descartado';
alter table public.muro_reportes add constraint muro_reportes_estado_check
  check (estado in ('pendiente', 'en_revision', 'resuelto', 'rechazado'));
delete from public.muro_reportes where reportante_id is null;
alter table public.muro_reportes drop constraint if exists muro_reportes_reportante_id_fkey;
alter table public.muro_reportes add constraint muro_reportes_reportante_id_fkey
  foreign key (reportante_id) references public.muro_usuarios(id) on delete cascade;
alter table public.muro_reportes alter column reportante_id set not null;
alter table public.muro_reportes add column if not exists respondido_en timestamptz;

drop policy if exists "reportes_crear_propio" on public.muro_reportes;
revoke insert, update, delete on public.muro_reportes from authenticated;
grant select on public.muro_reportes to authenticated;
grant select, insert, update, delete on public.muro_reportes to service_role;

create or replace function public.muro_crear_reporte(
  motivo_nuevo text, detalle_nuevo text, sala_objetivo uuid default null, nota_objetivo uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare solicitante uuid := (select auth.uid()); reporte public.muro_reportes;
begin
  if solicitante is null then raise exception using errcode = '28000', message = 'sesion_requerida'; end if;
  if motivo_nuevo not in ('fallo_aplicacion', 'contenido_ofensivo', 'spam', 'enlace_inseguro', 'otro')
     or char_length(trim(detalle_nuevo)) < 10 or char_length(trim(detalle_nuevo)) > 1000 then
    raise exception using errcode = '22023', message = 'reporte_invalido';
  end if;
  if sala_objetivo is not null and public.muro_rol_en_sala(sala_objetivo) is null then
    raise exception using errcode = '42501', message = 'sala_no_autorizada';
  end if;
  if nota_objetivo is not null and not exists (
    select 1 from public.muro_notas n where n.id = nota_objetivo
      and (sala_objetivo is null or n.sala_id = sala_objetivo)
      and public.muro_rol_en_sala(n.sala_id) is not null
  ) then raise exception using errcode = '42501', message = 'nota_no_autorizada'; end if;
  insert into public.muro_reportes (reportante_id, sala_id, nota_id, motivo, detalle)
    values (solicitante, sala_objetivo, nota_objetivo, motivo_nuevo, trim(detalle_nuevo))
    returning * into reporte;
  return jsonb_build_object('id', reporte.id, 'estado', reporte.estado, 'creado_en', reporte.creado_en);
end;
$$;

create or replace function public.muro_mis_reportes()
returns table (id uuid, motivo text, detalle text, estado text, decision text, creado_en timestamptz, revisado_en timestamptz, respondido_en timestamptz)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.motivo, r.detalle, r.estado, r.decision, r.creado_en, r.revisado_en, r.respondido_en
  from public.muro_reportes r where r.reportante_id = (select auth.uid()) order by r.creado_en desc
$$;

create or replace function public.muro_reportes_administracion()
returns table (id uuid, reportante_id uuid, reportante_nombre text, motivo text, detalle text, estado text, decision text, revisado_por uuid, creado_en timestamptz, revisado_en timestamptz, respondido_en timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.muro_es_superadmin() then raise exception using errcode = '42501', message = 'solo_superadmin'; end if;
  return query select r.id, r.reportante_id, u.nombre, r.motivo, r.detalle, r.estado, r.decision,
    r.revisado_por, r.creado_en, r.revisado_en, r.respondido_en
  from public.muro_reportes r join public.muro_usuarios u on u.id = r.reportante_id
  order by case r.estado when 'pendiente' then 0 when 'en_revision' then 1 else 2 end, r.creado_en desc;
end;
$$;

create or replace function public.muro_tomar_reporte(reporte_objetivo uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.muro_es_superadmin() then raise exception using errcode = '42501', message = 'solo_superadmin'; end if;
  update public.muro_reportes set estado = 'en_revision', revisado_por = (select auth.uid()), revisado_en = now()
    where id = reporte_objetivo and estado = 'pendiente';
  if not found then raise exception using errcode = '55000', message = 'reporte_no_disponible'; end if;
end;
$$;

create or replace function public.muro_responder_reporte(reporte_objetivo uuid, estado_nuevo text, respuesta_nueva text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare autor uuid;
begin
  if not public.muro_es_superadmin() then raise exception using errcode = '42501', message = 'solo_superadmin'; end if;
  if estado_nuevo not in ('resuelto', 'rechazado') or char_length(trim(respuesta_nueva)) not between 3 and 1000 then
    raise exception using errcode = '22023', message = 'respuesta_invalida';
  end if;
  update public.muro_reportes set estado = estado_nuevo, decision = trim(respuesta_nueva),
    revisado_por = (select auth.uid()), revisado_en = coalesce(revisado_en, now()), respondido_en = now()
    where id = reporte_objetivo and estado in ('pendiente', 'en_revision') returning reportante_id into autor;
  if not found then raise exception using errcode = '55000', message = 'reporte_no_disponible'; end if;
  return autor;
end;
$$;

-- Las funciones privilegiadas son APIs cerradas: identidad y autorizacion se
-- validan dentro de cada cuerpo y solo authenticated puede ejecutarlas.
revoke all on function public.muro_crear_invitacion(uuid, text, text, text, text, timestamptz) from public, anon;
revoke all on function public.muro_listar_invitaciones() from public, anon;
revoke all on function public.muro_responder_invitacion(text, text) from public, anon;
revoke all on function public.muro_cancelar_invitacion(uuid) from public, anon;
revoke all on function public.muro_reenviar_invitacion(uuid, text, text, timestamptz) from public, anon;
revoke all on function public.muro_crear_reporte(text, text, uuid, uuid) from public, anon;
revoke all on function public.muro_mis_reportes() from public, anon;
revoke all on function public.muro_reportes_administracion() from public, anon;
revoke all on function public.muro_tomar_reporte(uuid) from public, anon;
revoke all on function public.muro_responder_reporte(uuid, text, text) from public, anon;
grant execute on function public.muro_crear_invitacion(uuid, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.muro_listar_invitaciones() to authenticated;
grant execute on function public.muro_responder_invitacion(text, text) to authenticated;
grant execute on function public.muro_cancelar_invitacion(uuid) to authenticated;
grant execute on function public.muro_reenviar_invitacion(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.muro_crear_reporte(text, text, uuid, uuid) to authenticated;
grant execute on function public.muro_mis_reportes() to authenticated;
grant execute on function public.muro_reportes_administracion() to authenticated;
grant execute on function public.muro_tomar_reporte(uuid) to authenticated;
grant execute on function public.muro_responder_reporte(uuid, text, text) to authenticated;

alter table public.muro_reportes replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.muro_reportes;
exception when duplicate_object then null; end $$;
