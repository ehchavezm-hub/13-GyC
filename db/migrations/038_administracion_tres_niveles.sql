-- GyC · 038_administracion_tres_niveles.sql
-- Tres niveles de administración:
--   1. Plataforma  — propietarios (profiles.es_plataforma): gestionan las empresas
--   2. Empresa     — super administrador / administrador de la empresa (profiles.rol): gestionan sus proyectos
--   3. Proyecto    — administrador de un proyecto (proyecto_lideres.rol = 'administrador'): gestiona ese proyecto
-- Ejecutar en el SQL Editor de Neon después de la 037. Se puede ejecutar más de una vez.

set client_min_messages = warning;

-- Rol de cada persona dentro de un proyecto
alter table public.proyecto_lideres
  add column if not exists rol text not null default 'miembro';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'proyecto_lideres_rol_check') then
    alter table public.proyecto_lideres add constraint proyecto_lideres_rol_check check (rol in ('miembro','administrador'));
  end if;
end $$;

-- ¿Administra esta persona el proyecto? (nivel 1, 2 o 3)
create or replace function public.administra_proyecto(p_usuario text, p_proyecto uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles u join public.proyectos p on p.id = p_proyecto
     where u.id = p_usuario and u.activo and not u.eliminado
       and (u.es_plataforma
            or (u.area_id = p.area_id and (u.rol in ('superadmin','admin','delegado') or u.es_admin_principal))
            or p.created_by = p_usuario                       -- quien propone o crea el proyecto
            or exists (select 1 from public.proyecto_lideres l
                        where l.usuario_id = p_usuario and l.rol = 'administrador'
                          and l.proyecto_id in (p.id, p.padre_id))))
$$;

-- Cuentas preasignadas: rol dentro de sus proyectos
alter table public.cuentas_preasignadas
  add column if not exists proyecto_rol text not null default 'miembro';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cuentas_preasignadas_proyecto_rol_check') then
    alter table public.cuentas_preasignadas add constraint cuentas_preasignadas_proyecto_rol_check check (proyecto_rol in ('miembro','administrador'));
  end if;
end $$;

create or replace function public.gyc_aplicar_preasignacion(p_id text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_p public.profiles;
  v_c public.cuentas_preasignadas;
begin
  select * into v_p from public.profiles where id = p_id;
  if not found or v_p.email is null then return; end if;
  select * into v_c from public.cuentas_preasignadas where email = lower(v_p.email);
  if not found then return; end if;
  update public.profiles
     set area_id = coalesce(v_c.area_id, v_p.area_id, (select id from public.areas where activa order by created_at limit 1)),
         rol = v_c.rol,
         activo = true,
         eliminado = false,
         nombre = case when coalesce(v_p.nombre, '') in ('', v_p.email, split_part(v_p.email, '@', 1)) and v_c.nombre is not null
                       then v_c.nombre else v_p.nombre end,
         es_plataforma = v_p.es_plataforma or v_c.es_plataforma,
         es_admin_principal = v_p.es_admin_principal or v_c.es_admin_principal
   where id = p_id;
  insert into public.proyecto_lideres (proyecto_id, usuario_id, rol)
  select x, p_id, v_c.proyecto_rol from unnest(v_c.proyecto_ids) x
   where exists (select 1 from public.proyectos where id = x)
  on conflict (proyecto_id, usuario_id) do update set rol = excluded.rol;
  update public.cuentas_preasignadas set aplicada_at = now() where email = v_c.email;
end $$;

drop trigger if exists trg_preasignacion_existente on public.cuentas_preasignadas;
create trigger trg_preasignacion_existente
  after insert or update of area_id, rol, es_admin_principal, es_plataforma, proyecto_ids, proyecto_rol, nombre on public.cuentas_preasignadas
  for each row execute function public.tg_preasignacion_existente();

do $$
begin
  assert exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'proyecto_lideres' and column_name = 'rol'),
    'Falta proyecto_lideres.rol';
  raise notice '✓ Migración 038_administracion_tres_niveles ejecutada correctamente.';
end $$;
