alter table public.muro_notas add column titulo text;
update public.muro_notas
set titulo = left(contenido, 80)
where titulo is null;
alter table public.muro_notas alter column titulo set default 'Sin título';
alter table public.muro_notas alter column titulo set not null;
alter table public.muro_notas add constraint muro_notas_titulo_check
  check (char_length(trim(titulo)) between 1 and 80);

create table public.muro_reportes (
  id uuid primary key default gen_random_uuid(),
  reportante_id uuid references public.muro_usuarios(id) on delete set null,
  sala_id uuid references public.muro_salas(id) on delete cascade,
  nota_id uuid references public.muro_notas(id) on delete set null,
  motivo text not null check (motivo in ('fallo_aplicacion', 'contenido_ofensivo', 'spam', 'enlace_inseguro', 'otro')),
  detalle text not null default '' check (char_length(detalle) <= 1000),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_revision', 'resuelto', 'descartado')),
  decision text not null default '' check (char_length(decision) <= 1000),
  revisado_por uuid references public.muro_usuarios(id) on delete set null,
  creado_en timestamptz not null default now(),
  revisado_en timestamptz
);

create index muro_reportes_reportante_id_idx on public.muro_reportes(reportante_id);
create index muro_reportes_sala_id_idx on public.muro_reportes(sala_id);
create index muro_reportes_nota_id_idx on public.muro_reportes(nota_id);
create index muro_reportes_estado_idx on public.muro_reportes(estado, creado_en);

alter table public.muro_reportes enable row level security;

create policy "reportes_crear_propio" on public.muro_reportes
  for insert to authenticated
  with check (
    reportante_id = (select auth.uid())
    and (sala_id is null or (select public.muro_rol_en_sala(sala_id)) is not null)
  );

create policy "reportes_ver_propio_o_administrar" on public.muro_reportes
  for select to authenticated
  using (reportante_id = (select auth.uid()) or (select public.muro_es_superadmin()));

create policy "reportes_revisar_superadmin" on public.muro_reportes
  for update to authenticated
  using ((select public.muro_es_superadmin()))
  with check ((select public.muro_es_superadmin()));

grant select, insert, update on public.muro_reportes to authenticated;

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
    'notas', (select count(*) from public.muro_notas),
    'reportes_pendientes', (select count(*) from public.muro_reportes where estado in ('pendiente', 'en_revision'))
  );
end;
$$;
