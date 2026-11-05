-- Ningun cliente autenticado puede saltarse la invitacion verificada creando
-- la membresia directamente. Las altas quedan reservadas a las RPC atomicas.
drop function if exists public.muro_invitar_miembro(uuid, text, text);
drop policy if exists "miembros_agregar_propietario" on public.muro_sala_miembros;
revoke insert on public.muro_sala_miembros from authenticated;
