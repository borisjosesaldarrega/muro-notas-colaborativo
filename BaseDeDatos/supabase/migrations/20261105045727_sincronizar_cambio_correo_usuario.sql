-- Mantiene el correo público del perfil alineado con Supabase Auth.
create or replace function public.muro_sincronizar_correo_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.muro_usuarios
    set correo = lower(new.email), actualizado_en = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.muro_sincronizar_correo_usuario() from public, anon, authenticated;

drop trigger if exists muro_auth_correo_actualizado on auth.users;
create trigger muro_auth_correo_actualizado
after update of email on auth.users
for each row execute function public.muro_sincronizar_correo_usuario();
