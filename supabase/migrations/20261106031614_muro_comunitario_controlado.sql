-- Un solo muro comunitario existente. Todos los usuarios autenticados pueden
-- descubrirlo y aportar notas propias; la propiedad y administracion no cambian.
alter table public.muro_salas
  add column if not exists es_comunitario boolean not null default false;

alter table public.muro_salas
  drop constraint if exists muro_salas_comunitario_autorizado_check;
alter table public.muro_salas
  add constraint muro_salas_comunitario_autorizado_check
  check (
    not es_comunitario
    or id = 'dd48c980-d72b-414f-89c7-6a0692b0982e'::uuid
  );

do $$
begin
  if not exists (
    select 1
    from public.muro_salas
    where id = 'dd48c980-d72b-414f-89c7-6a0692b0982e'::uuid
      and propietario_id = '9ffbb480-2f2c-4ddc-9d8a-7c5995373c6a'::uuid
  ) then
    raise exception 'muro_comunitario_no_verificado';
  end if;

  update public.muro_salas
  set es_comunitario = (id = 'dd48c980-d72b-414f-89c7-6a0692b0982e'::uuid)
  where es_comunitario
     or id = 'dd48c980-d72b-414f-89c7-6a0692b0982e'::uuid;
end;
$$;

drop policy if exists "salas_ver_como_miembro" on public.muro_salas;
create policy "salas_ver_como_miembro_o_comunidad"
  on public.muro_salas for select to authenticated
  using (
    es_comunitario
    or (select public.muro_rol_en_sala(id)) is not null
  );

drop policy if exists "notas_ver_como_miembro" on public.muro_notas;
create policy "notas_ver_como_miembro_o_comunidad"
  on public.muro_notas for select to authenticated
  using (
    (select public.muro_rol_en_sala(sala_id)) is not null
    or exists (
      select 1 from public.muro_salas s
      where s.id = sala_id and s.es_comunitario
    )
  );

drop policy if exists "notas_crear_como_editor" on public.muro_notas;
create policy "notas_crear_como_editor_o_participante"
  on public.muro_notas for insert to authenticated
  with check (
    autor_id = (select auth.uid())
    and (
      (select public.muro_rol_en_sala(sala_id)) in ('propietario', 'editor')
      or exists (
        select 1 from public.muro_salas s
        where s.id = sala_id and s.es_comunitario
      )
    )
  );

drop policy if exists "notas_actualizar_como_editor" on public.muro_notas;
create policy "notas_actualizar_como_editor_o_autor_comunitario"
  on public.muro_notas for update to authenticated
  using (
    (select public.muro_rol_en_sala(sala_id)) in ('propietario', 'editor')
    or (
      autor_id = (select auth.uid())
      and exists (
        select 1 from public.muro_salas s
        where s.id = sala_id and s.es_comunitario
      )
    )
  )
  with check (
    (select public.muro_rol_en_sala(sala_id)) in ('propietario', 'editor')
    or (
      autor_id = (select auth.uid())
      and exists (
        select 1 from public.muro_salas s
        where s.id = sala_id and s.es_comunitario
      )
    )
  );

drop policy if exists "notas_eliminar_como_editor" on public.muro_notas;
create policy "notas_eliminar_como_editor_o_autor_comunitario"
  on public.muro_notas for delete to authenticated
  using (
    (select public.muro_rol_en_sala(sala_id)) in ('propietario', 'editor')
    or (
      autor_id = (select auth.uid())
      and exists (
        select 1 from public.muro_salas s
        where s.id = sala_id and s.es_comunitario
      )
    )
  );
