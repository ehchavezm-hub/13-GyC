-- LPS-GES · 005 · Alta de usuarios y restablecimiento de contraseña por el administrador
-- La creación y el cambio de contraseña los hace la Edge Function "admin-usuarios"
-- (supabase/functions/admin-usuarios), que guarda la clave secreta en el servidor.

alter table public.profiles add column if not exists debe_cambiar_clave boolean not null default false;
comment on column public.profiles.debe_cambiar_clave is
  'true cuando el administrador definió o restableció la contraseña: se pide cambiarla al ingresar.';

-- Los usuarios creados por el administrador no generan el aviso "nuevo usuario por aprobar".
-- raw_app_meta_data solo puede escribirlo el servidor (no el usuario al registrarse).
create or replace function public.tg_nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_area uuid;
  v_hay_admin boolean;
  v_por_admin boolean := coalesce(new.raw_app_meta_data, '{}'::jsonb) ? 'creado_por';
begin
  v_area := nullif(new.raw_app_meta_data->>'area_id', '')::uuid;
  if v_area is null or not exists (select 1 from public.areas where id = v_area) then
    select id into v_area from public.areas where activa order by created_at limit 1;
  end if;
  select exists (select 1 from public.profiles where area_id = v_area and rol = 'admin') into v_hay_admin;
  insert into public.profiles (id, area_id, email, nombre, rol, es_admin_principal, debe_cambiar_clave)
  values (new.id, v_area, new.email,
          coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
          case when v_hay_admin then 'pendiente' else 'admin' end,
          not v_hay_admin, v_por_admin);
  if v_hay_admin and not v_por_admin then
    insert into public.notificaciones (usuario_id, tipo, texto, ruta)
    select p.id, 'usuario_nuevo', 'Nuevo usuario por aprobar: ' || coalesce(new.email, ''), '#/config/usuarios'
      from public.profiles p where p.area_id = v_area and p.rol in ('admin','delegado') and p.activo;
  end if;
  return new;
end $$;
