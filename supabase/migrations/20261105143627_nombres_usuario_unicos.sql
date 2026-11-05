-- Cada nombre visible identifica a una sola cuenta, sin distinguir mayúsculas.
create unique index if not exists muro_usuarios_nombre_unico_idx
on public.muro_usuarios (lower(btrim(nombre)));

create or replace function public.muro_nombre_disponible(nombre_nuevo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    char_length(btrim(coalesce(nombre_nuevo, ''))) between 3 and 40
    and not exists (
      select 1
      from public.muro_usuarios usuario
      where lower(btrim(usuario.nombre)) = lower(btrim(nombre_nuevo))
        and usuario.id is distinct from (select auth.uid())
    );
$$;

revoke all on function public.muro_nombre_disponible(text) from public;
grant execute on function public.muro_nombre_disponible(text) to anon, authenticated;
