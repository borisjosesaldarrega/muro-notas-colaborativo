-- Las notas muestran siempre el nombre visible actual de su autor.
create or replace function public.muro_sincronizar_nombre_autor_notas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.nombre is distinct from old.nombre then
    update public.muro_notas
    set nombre_autor = new.nombre,
        actualizado_en = now()
    where autor_id = new.id
      and nombre_autor is distinct from new.nombre;
  end if;

  return new;
end;
$$;

revoke all on function public.muro_sincronizar_nombre_autor_notas() from public, anon, authenticated;

drop trigger if exists muro_usuarios_sincronizar_nombre_notas on public.muro_usuarios;
create trigger muro_usuarios_sincronizar_nombre_notas
after update of nombre on public.muro_usuarios
for each row
execute function public.muro_sincronizar_nombre_autor_notas();

-- Corrige también las notas que conservaron un nombre anterior.
update public.muro_notas as nota
set nombre_autor = usuario.nombre,
    actualizado_en = now()
from public.muro_usuarios as usuario
where nota.autor_id = usuario.id
  and nota.nombre_autor is distinct from usuario.nombre;
