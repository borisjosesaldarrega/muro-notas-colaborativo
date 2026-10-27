-- Esta función se usa exclusivamente mediante el trigger de auth.users.
-- No debe poder invocarse como RPC desde el navegador.
revoke all on function public.muro_crear_usuario() from public, anon, authenticated;
