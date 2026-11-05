-- Conserva la persona creadora de cada nota y registra a quien realizó la última edición.
alter table public.muro_notas
  add column if not exists editado_por_id uuid references public.muro_usuarios(id) on delete set null,
  add column if not exists nombre_editor text;

create or replace function public.muro_proteger_autoria_nota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
begin
  if actor_id is not null then
    select usuario.nombre
    into actor_name
    from public.muro_usuarios as usuario
    where usuario.id = actor_id;
  end if;

  if tg_op = 'INSERT' then
    if actor_id is not null then
      new.autor_id := actor_id;
      new.nombre_autor := coalesce(actor_name, new.nombre_autor);
    end if;
    new.editado_por_id := null;
    new.nombre_editor := null;
    return new;
  end if;

  -- La autoría no cambia cuando otra persona edita la nota.
  new.autor_id := old.autor_id;
  new.nombre_autor := old.nombre_autor;

  if new.titulo is distinct from old.titulo
     or new.contenido is distinct from old.contenido
     or new.color is distinct from old.color then
    new.editado_por_id := actor_id;
    new.nombre_editor := actor_name;
  else
    new.editado_por_id := old.editado_por_id;
    new.nombre_editor := old.nombre_editor;
  end if;

  return new;
end;
$$;

revoke all on function public.muro_proteger_autoria_nota() from public, anon, authenticated;

drop trigger if exists muro_notas_proteger_autoria on public.muro_notas;
create trigger muro_notas_proteger_autoria
before insert or update on public.muro_notas
for each row
execute function public.muro_proteger_autoria_nota();

-- Los clientes solo pueden modificar los campos propios del contenido y la posición.
revoke update on public.muro_notas from authenticated;
grant update (titulo, contenido, color, posicion_x, posicion_y, actualizado_en)
on public.muro_notas to authenticated;

-- Repara notas cuyo nombre visible fue sustituido durante una edición anterior.
update public.muro_notas as nota
set nombre_autor = usuario.nombre
from public.muro_usuarios as usuario
where nota.autor_id = usuario.id
  and nota.nombre_autor is distinct from usuario.nombre;

comment on column public.muro_notas.editado_por_id is 'Usuario que realizó la última edición de contenido o color.';
comment on column public.muro_notas.nombre_editor is 'Nombre visible de quien realizó la última edición.';
