-- LPS-GES · 006 · Eliminación de usuarios por el administrador
-- Sin historial: se borra la cuenta y el perfil.
-- Con historial (actividades, cierres, comentarios…): la cuenta se bloquea para siempre, el correo
-- queda libre para volver a crear a la persona y el perfil se conserva solo como nombre en el histórico.

alter table public.profiles add column if not exists eliminado boolean not null default false;

create or replace function public.eliminar_usuario(p_usuario uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_obj public.profiles;
begin
  if auth.uid() is null or public.mi_rol() <> 'admin' then
    raise exception 'Solo el administrador puede eliminar usuarios.';
  end if;
  select * into v_obj from public.profiles where id = p_usuario and area_id = public.mi_area();
  if not found then raise exception 'Usuario no encontrado.'; end if;
  if v_obj.id = auth.uid() then raise exception 'No puede eliminarse a sí mismo.'; end if;
  if v_obj.es_admin_principal then raise exception 'El administrador principal no se puede eliminar.'; end if;

  begin
    delete from auth.users where id = p_usuario;          -- borra también el perfil (on delete cascade)
    return 'eliminado';
  exception when foreign_key_violation then
    null;                                                  -- tiene historial: se conserva el perfil
  end;

  update auth.users
     set email = 'eliminado+' || p_usuario || '@lpsgt.invalid', banned_until = 'infinity'
   where id = p_usuario;
  update public.profiles
     set eliminado = true, activo = false, email = null,
         rol = case when rol in ('admin', 'delegado') then 'lider' else rol end
   where id = p_usuario;
  delete from public.proyecto_lideres where usuario_id = p_usuario;
  return 'desactivado';
end $$;

revoke execute on function public.eliminar_usuario(uuid) from public, anon;
grant execute on function public.eliminar_usuario(uuid) to authenticated;
