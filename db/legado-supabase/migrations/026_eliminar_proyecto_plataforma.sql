-- LPS-GES · 026_eliminar_proyecto_plataforma.sql
-- Pedido 18: los propietarios de la plataforma eliminan un proyecto de cualquier empresa, también con su historial
-- (actividades, también de semanas cerradas, restricciones, cartera, plantillas, hitos, comentarios y enlaces) y con
-- sus sub-proyectos. Lo ejecuta solo el servidor (Edge Function admin-usuarios); el aplicativo pide escribir el
-- nombre del proyecto para confirmar. Todo en una transacción. Queda en la auditoría.
-- Se puede ejecutar más de una vez.

set client_min_messages = warning;

create or replace function public.eliminar_proyecto_plataforma(p_proyecto uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ids uuid[];
  v_acts uuid[];
  v_rests uuid[];
  v_cart uuid[];
  v jsonb;
begin
  if not exists (select 1 from public.proyectos where id = p_proyecto) then raise exception 'Proyecto no encontrado.'; end if;
  select array_agg(id) into v_ids from public.proyectos where id = p_proyecto or padre_id = p_proyecto;
  select coalesce(array_agg(id), '{}') into v_acts from public.actividades where proyecto_id = any(v_ids);
  select coalesce(array_agg(id), '{}') into v_rests from public.restricciones where proyecto_id = any(v_ids) or actividad_id = any(v_acts);
  select coalesce(array_agg(id), '{}') into v_cart from public.cartera where proyecto_id = any(v_ids);
  v := jsonb_build_object('subproyectos', cardinality(v_ids) - 1, 'actividades', cardinality(v_acts),
                          'restricciones', cardinality(v_rests), 'cartera', cardinality(v_cart));

  perform set_config('lpsgt.cierre_en_curso', 'on', true);       -- permite borrar actividades de semanas cerradas
  delete from public.comentarios where (entidad = 'actividad' and entidad_id = any(v_acts)) or (entidad = 'restriccion' and entidad_id = any(v_rests))
    or (entidad = 'cartera' and entidad_id = any(v_cart)) or (entidad = 'proyecto' and entidad_id = any(v_ids));
  delete from public.enlaces where (entidad = 'actividad' and entidad_id = any(v_acts)) or (entidad = 'restriccion' and entidad_id = any(v_rests))
    or (entidad = 'cartera' and entidad_id = any(v_cart)) or (entidad = 'proyecto' and entidad_id = any(v_ids));
  delete from public.restricciones where id = any(v_rests);
  update public.actividades set cartera_id = null where cartera_id = any(v_cart);
  delete from public.actividades where id = any(v_acts);
  delete from public.cartera where id = any(v_cart);
  delete from public.plantilla_items where proyecto_id = any(v_ids);
  update public.lista_valores set extra = extra - 'proyecto_id' where extra ->> 'proyecto_id' = any(array(select unnest(v_ids)::text));
  delete from public.proyectos where padre_id = p_proyecto;          -- sub-proyectos (hitos, líderes y favoritos en cascada)
  delete from public.proyectos where id = p_proyecto;
  perform set_config('lpsgt.cierre_en_curso', 'off', true);
  return v;
end $$;
revoke execute on function public.eliminar_proyecto_plataforma(uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.eliminar_proyecto_plataforma(uuid) to service_role;
  end if;
end $$;
