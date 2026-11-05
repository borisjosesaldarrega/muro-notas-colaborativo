-- Los reportes moderan cuentas concretas; el superadministrador no necesita
-- leer el contenido privado de salas o notas para tomar una decisión.
alter table public.muro_reportes
  add column if not exists reportado_id uuid references public.muro_usuarios(id) on delete set null;

alter table public.muro_reportes drop constraint if exists muro_reportes_motivo_check;
alter table public.muro_reportes add constraint muro_reportes_motivo_check
  check (motivo in ('fallo_aplicacion', 'contenido_ofensivo', 'spam', 'enlace_inseguro', 'acoso', 'otro'));

create index if not exists muro_reportes_reportado_id_idx
  on public.muro_reportes(reportado_id, creado_en desc);

create table if not exists public.muro_sanciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.muro_usuarios(id) on delete set null,
  reporte_id uuid references public.muro_reportes(id) on delete set null,
  tipo text not null check (tipo in ('advertencia', 'suspension', 'reactivacion', 'eliminacion')),
  mensaje text not null check (char_length(trim(mensaje)) between 3 and 1000),
  suspension_hasta timestamptz,
  creado_por uuid not null references public.muro_usuarios(id) on delete restrict,
  creado_en timestamptz not null default now()
);

create index if not exists muro_sanciones_usuario_id_idx
  on public.muro_sanciones(usuario_id, creado_en desc);

alter table public.muro_sanciones enable row level security;

drop policy if exists "sanciones_ver_propias" on public.muro_sanciones;
create policy "sanciones_ver_propias" on public.muro_sanciones
  for select to authenticated
  using (usuario_id = (select auth.uid()) or (select public.muro_es_superadmin()));

revoke insert, update, delete on public.muro_sanciones from authenticated;
grant select on public.muro_sanciones to authenticated;
grant select, insert, update, delete on public.muro_sanciones to service_role;

create or replace function public.muro_reportar_usuario(
  usuario_objetivo uuid,
  sala_objetivo uuid,
  motivo_nuevo text,
  detalle_nuevo text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  solicitante uuid := (select auth.uid());
  reporte public.muro_reportes;
begin
  if solicitante is null then
    raise exception using errcode = '28000', message = 'sesion_requerida';
  end if;
  if usuario_objetivo is null or usuario_objetivo = solicitante then
    raise exception using errcode = '22023', message = 'usuario_reportado_invalido';
  end if;
  if motivo_nuevo not in ('contenido_ofensivo', 'spam', 'enlace_inseguro', 'acoso', 'otro')
     or char_length(trim(detalle_nuevo)) < 10
     or char_length(trim(detalle_nuevo)) > 1000 then
    raise exception using errcode = '22023', message = 'reporte_invalido';
  end if;
  if sala_objetivo is null or not exists (
    select 1
    from public.muro_sala_miembros origen
    join public.muro_sala_miembros destino on destino.sala_id = origen.sala_id
    where origen.sala_id = sala_objetivo
      and origen.usuario_id = solicitante
      and destino.usuario_id = usuario_objetivo
  ) then
    raise exception using errcode = '42501', message = 'usuario_no_comparte_sala';
  end if;

  insert into public.muro_reportes
    (reportante_id, reportado_id, sala_id, motivo, detalle)
  values
    (solicitante, usuario_objetivo, sala_objetivo, motivo_nuevo, trim(detalle_nuevo))
  returning * into reporte;

  return jsonb_build_object(
    'id', reporte.id,
    'estado', reporte.estado,
    'reportado_id', reporte.reportado_id,
    'creado_en', reporte.creado_en
  );
end;
$$;

drop function if exists public.muro_reportes_administracion();
create function public.muro_reportes_administracion()
returns table (
  id uuid,
  reportante_id uuid,
  reportante_nombre text,
  reportado_id uuid,
  reportado_nombre text,
  reportado_correo text,
  motivo text,
  detalle text,
  estado text,
  decision text,
  revisado_por uuid,
  creado_en timestamptz,
  revisado_en timestamptz,
  respondido_en timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.muro_es_superadmin() then
    raise exception using errcode = '42501', message = 'solo_superadmin';
  end if;
  return query
  select r.id, r.reportante_id, reportante.nombre,
    r.reportado_id, reportado.nombre, reportado.correo,
    r.motivo, r.detalle, r.estado, r.decision, r.revisado_por,
    r.creado_en, r.revisado_en, r.respondido_en
  from public.muro_reportes r
  join public.muro_usuarios reportante on reportante.id = r.reportante_id
  left join public.muro_usuarios reportado on reportado.id = r.reportado_id
  order by case r.estado when 'pendiente' then 0 when 'en_revision' then 1 else 2 end,
    r.creado_en desc;
end;
$$;

revoke all on function public.muro_reportar_usuario(uuid, uuid, text, text) from public, anon;
revoke all on function public.muro_reportes_administracion() from public, anon;
grant execute on function public.muro_reportar_usuario(uuid, uuid, text, text) to authenticated;
grant execute on function public.muro_reportes_administracion() to authenticated;
