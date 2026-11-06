-- LPS-GES · 007 · Nuevos roles de planificación
--   lider          → se muestra como "Líder de especialidad" (antes "Líder de proceso"; el código no cambia)
--   resp_equipo    → Responsable del equipo
--   resp_proceso   → Responsable de proceso
--   resp_actividad → Responsable de actividad
-- Todos planifican como un líder (plan semanal, Look Ahead, PAC). Sus permisos se ajustan en la matriz.

-- Roles que planifican (tienen actividades y PAC)
create or replace function public.rol_planifica(p_rol text) returns boolean
language sql immutable as $$ select p_rol in ('lider','resp_equipo','resp_proceso','resp_actividad') $$;

do $$
declare c record;
begin
  for c in select conrelid::regclass as tabla, conname from pg_constraint
            where contype = 'c' and conrelid in ('public.profiles'::regclass, 'public.permisos'::regclass)
              and pg_get_constraintdef(oid) like '%rol%' and pg_get_constraintdef(oid) like '%lider%'
  loop
    execute format('alter table %s drop constraint %I', c.tabla, c.conname);
  end loop;
end $$;

alter table public.profiles add constraint profiles_rol_check
  check (rol in ('admin','delegado','consulta','pendiente') or public.rol_planifica(rol));
alter table public.permisos add constraint permisos_rol_check
  check (rol in ('delegado','consulta') or public.rol_planifica(rol));

create or replace function public.es_miembro() returns boolean
language sql stable as $$ select public.mi_rol() in ('admin','delegado','consulta') or public.rol_planifica(public.mi_rol()) $$;

create or replace function public.es_staff() returns boolean
language sql stable as $$ select public.mi_rol() in ('admin','delegado') or public.rol_planifica(public.mi_rol()) $$;

-- Un rol nuevo sin fila propia en la matriz usa los permisos de "lider"
create or replace function public.puede(p_accion text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.mi_rol() = 'admin' then true
    when public.mi_rol() in ('delegado','consulta') or public.rol_planifica(public.mi_rol()) then coalesce(
      (select permitido from public.permisos
        where area_id = public.mi_area() and rol = public.mi_rol() and accion = p_accion),
      (select permitido from public.permisos
        where area_id = public.mi_area() and rol = 'lider' and accion = p_accion
          and public.rol_planifica(public.mi_rol())),
      false)
    else false end
$$;

-- Permisos iniciales de los roles nuevos (copiados de "lider" y ajustados; editables en la matriz)
insert into public.permisos (area_id, rol, accion, permitido)
select p.area_id, r.rol, p.accion,
       case
         when r.rol = 'resp_equipo' and p.accion in ('editar_actividades_otros','cerrar_semana_otros',
              'gestionar_reuniones','gestionar_plantillas_servicio') then true
         when r.rol = 'resp_actividad' and p.accion in ('proponer_proyecto','aceptar_solicitudes') then false
         else p.permitido
       end
  from public.permisos p
 cross join (values ('resp_equipo'), ('resp_proceso'), ('resp_actividad')) r(rol)
 where p.rol = 'lider'
on conflict do nothing;
