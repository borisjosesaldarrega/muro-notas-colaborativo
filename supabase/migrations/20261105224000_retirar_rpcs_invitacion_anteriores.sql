-- Retira las firmas anteriores para que ningun cliente pueda crear o renovar
-- una invitacion sin guardar tambien su codigo recuperable.
drop function if exists public.muro_crear_invitacion_codigo(
  uuid,
  text,
  text,
  text,
  timestamptz
);

drop function if exists public.muro_reenviar_invitacion(
  uuid,
  text,
  text,
  timestamptz
);
