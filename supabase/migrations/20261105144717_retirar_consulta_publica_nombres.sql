-- La unicidad la garantiza el índice; no se expone una consulta enumeradora.
revoke all on function public.muro_nombre_disponible(text) from public, anon, authenticated;
drop function if exists public.muro_nombre_disponible(text);
