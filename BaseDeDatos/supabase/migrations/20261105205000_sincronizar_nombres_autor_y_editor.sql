-- Mantiene actualizados los nombres visibles sin permitir que una edición cambie la identidad creadora.
create or replace function public.muro_proteger_autoria_nota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  author_name text;
  editor_name text;
begin
  if actor_id is not null then
    select usuario.nombre into actor_name
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

  -- Los clientes autenticados no tienen permiso de columna para alterar autor_id.
  -- Si una FK privilegiada lo cambia (por ejemplo, al eliminar una cuenta), se respeta.
  if new.autor_id is not distinct from old.autor_id then
    new.autor_id := old.autor_id;
  end if;
  select usuario.nombre into author_name
  from public.muro_usuarios as usuario
  where usuario.id = new.autor_id;
  new.nombre_autor := coalesce(author_name, old.nombre_autor);

  if new.titulo is distinct from old.titulo
     or new.contenido is distinct from old.contenido
     or new.color is distinct from old.color then
    new.editado_por_id := actor_id;
    new.nombre_editor := actor_name;
  elsif new.editado_por_id is distinct from old.editado_por_id then
    select usuario.nombre into editor_name
    from public.muro_usuarios as usuario
    where usuario.id = new.editado_por_id;
    new.nombre_editor := editor_name;
  else
    new.editado_por_id := old.editado_por_id;
    select usuario.nombre into editor_name
    from public.muro_usuarios as usuario
    where usuario.id = old.editado_por_id;
    new.nombre_editor := coalesce(editor_name, old.nombre_editor);
  end if;

  return new;
end;
$$;

create or replace function public.muro_sincronizar_nombre_autor_notas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.nombre is distinct from old.nombre then
    update public.muro_notas
    set nombre_autor = case when autor_id = new.id then new.nombre else nombre_autor end,
        nombre_editor = case when editado_por_id = new.id then new.nombre else nombre_editor end,
        actualizado_en = now()
    where (autor_id = new.id and nombre_autor is distinct from new.nombre)
       or (editado_por_id = new.id and nombre_editor is distinct from new.nombre);
  end if;

  return new;
end;
$$;

revoke all on function public.muro_sincronizar_nombre_autor_notas() from public, anon, authenticated;

update public.muro_notas as nota
set nombre_autor = autor.nombre
from public.muro_usuarios as autor
where nota.autor_id = autor.id
  and nota.nombre_autor is distinct from autor.nombre;

update public.muro_notas as nota
set nombre_editor = editor.nombre
from public.muro_usuarios as editor
where nota.editado_por_id = editor.id
  and nota.nombre_editor is distinct from editor.nombre;
