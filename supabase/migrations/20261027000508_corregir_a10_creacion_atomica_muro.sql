-- A10: la sala y su membresia propietaria se confirman o se revierten juntas.
-- SECURITY DEFINER es necesario porque se revoca el INSERT directo sobre salas;
-- la funcion valida la identidad de Auth y no acepta propietario desde el cliente.
create or replace function public.muro_crear_sala(
  nombre_nuevo text,
  descripcion_nueva text default ''
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

  insert into public.muro_salas (nombre, descripcion, propietario_id)
  values (nombre_seguro, descripcion_segura, solicitante)
  returning id into sala_creada;

  insert into public.muro_sala_miembros (sala_id, usuario_id, rol)
  values (sala_creada, solicitante, 'propietario');

  return sala_creada;
end;
$$;

revoke all on function public.muro_crear_sala(text, text) from public, anon;
grant execute on function public.muro_crear_sala(text, text) to authenticated;

-- Obliga a los clientes autenticados a usar la unica operacion atomica.
revoke insert on table public.muro_salas from public, anon, authenticated;
