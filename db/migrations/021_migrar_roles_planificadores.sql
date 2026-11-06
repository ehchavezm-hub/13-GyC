-- LPS-GES · 021_migrar_roles_planificadores.sql
-- Consolida los roles eliminados (resp_equipo, resp_proceso, resp_actividad) en "lider".
-- La nueva matriz de permisos (PPT v5) define cuatro roles: admin, delegado, lider, consulta.
-- Los tres roles anteriores equivalen funcionalmente a "lider" en el nuevo esquema.

-- Migrar usuarios con roles obsoletos
update public.profiles
  set rol = 'lider'
  where rol in ('resp_equipo', 'resp_proceso', 'resp_actividad');

-- Actualizar la función pública que valida si un rol puede planificar
create or replace function public.rol_planifica(p_rol text) returns boolean
  language sql immutable set search_path = public, pg_temp as $$
  select p_rol = 'lider'
$$;
