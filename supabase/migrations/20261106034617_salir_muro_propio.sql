-- Permite que una persona abandone voluntariamente un muro sin concederle
-- capacidad para eliminar membresías ajenas ni alterar a la persona propietaria.
create or replace function public.muro_salir_sala(sala_objetivo uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  solicitante uuid := (select auth.uid());
  propietario uuid;
begin
  if solicitante is null then
    raise exception using errcode = '28000', message = 'sesion_requerida';
  end if;

  select s.propietario_id into propietario
  from public.muro_salas s
  where s.id = sala_objetivo;

  if propietario is null then
    raise exception using errcode = 'P0002', message = 'sala_no_existe';
  end if;
  if solicitante = propietario then
    raise exception using errcode = '42501', message = 'propietario_no_puede_salir';
  end if;

  delete from public.muro_sala_miembros
  where sala_id = sala_objetivo
    and usuario_id = solicitante
    and rol in ('editor', 'lector');

  if not found then
    raise exception using errcode = 'P0002', message = 'membresia_no_existe';
  end if;
end;
$$;

revoke all on function public.muro_salir_sala(uuid) from public, anon;
grant execute on function public.muro_salir_sala(uuid) to authenticated;
