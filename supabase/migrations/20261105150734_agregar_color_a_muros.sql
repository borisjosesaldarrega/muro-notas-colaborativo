-- Cada muro conserva su color sin depender del tema claro u oscuro.
alter table public.muro_salas
  add column color text not null default 'amarillo';

alter table public.muro_salas
  add constraint muro_salas_color_check
  check (color in ('amarillo', 'rosa', 'azul', 'verde', 'lila'));

-- Sustituye la firma anterior para mantener atómica la creación de sala,
-- membresía propietaria y color elegido.
revoke all on function public.muro_crear_sala(text, text) from public, anon, authenticated;
drop function public.muro_crear_sala(text, text);

create function public.muro_crear_sala(
  nombre_nuevo text,
  descripcion_nueva text default '',
  color_nuevo text default 'amarillo'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  solicitante uuid := (select auth.uid());
  sala_creada uuid;
  nombre_seguro text := trim(coalesce(nombre_nuevo, ''));
  descripcion_segura text := trim(coalesce(descripcion_nueva, ''));
  color_seguro text := lower(trim(coalesce(color_nuevo, 'amarillo')));
begin
  if solicitante is null then
    raise exception using errcode = '28000', message = 'Se requiere una sesion autenticada';
  end if;

  if char_length(nombre_seguro) not between 1 and 60 then
    raise exception using errcode = '22023', message = 'El nombre debe tener entre 1 y 60 caracteres';
  end if;

  if char_length(descripcion_segura) > 160 then
    raise exception using errcode = '22023', message = 'La descripcion no puede superar 160 caracteres';
  end if;

  if color_seguro not in ('amarillo', 'rosa', 'azul', 'verde', 'lila') then
    raise exception using errcode = '22023', message = 'El color del muro no es valido';
  end if;

  insert into public.muro_salas (nombre, descripcion, color, propietario_id)
  values (nombre_seguro, descripcion_segura, color_seguro, solicitante)
  returning id into sala_creada;

  insert into public.muro_sala_miembros (sala_id, usuario_id, rol)
  values (sala_creada, solicitante, 'propietario');

  return sala_creada;
end;
$$;

revoke all on function public.muro_crear_sala(text, text, text) from public, anon;
grant execute on function public.muro_crear_sala(text, text, text) to authenticated;
