-- LPS-GES · 012 · Eliminar un proyecto con todo su historial (p. ej. proyectos de prueba)
-- Solo administradores con permiso de crear proyectos y de eliminar usuarios. Borra actividades (también de semanas
-- cerradas), restricciones, cartera, plantillas, hitos, comentarios y enlaces del proyecto. Queda en la auditoría.
create or replace function public.eliminar_proyecto_completo(p_proyecto uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_p public.proyectos;
  v_acts uuid[];
  v_rests uuid[];
  v_cart uuid[];
  v jsonb;
begin
  if auth.uid() is null or not public.es_admin() or not public.puede('crear_proyecto') or not public.puede('eliminar_usuarios') then
    raise exception 'Solo un administrador puede eliminar un proyecto con su historial.';
  end if;
  select * into v_p from public.proyectos where id = p_proyecto and area_id = public.mi_area();
  if not found then raise exception 'Proyecto no encontrado.'; end if;

  select coalesce(array_agg(id), '{}') into v_acts from public.actividades where proyecto_id = p_proyecto;
  select coalesce(array_agg(id), '{}') into v_rests from public.restricciones where proyecto_id = p_proyecto or actividad_id = any(v_acts);
  select coalesce(array_agg(id), '{}') into v_cart from public.cartera where proyecto_id = p_proyecto;
  v := jsonb_build_object('actividades', cardinality(v_acts), 'restricciones', cardinality(v_rests), 'cartera', cardinality(v_cart));

  perform set_config('lpsgt.cierre_en_curso', 'on', true);       -- permite borrar actividades de semanas cerradas
  delete from public.comentarios where (entidad = 'actividad' and entidad_id = any(v_acts)) or (entidad = 'restriccion' and entidad_id = any(v_rests))
    or (entidad = 'cartera' and entidad_id = any(v_cart)) or (entidad = 'proyecto' and entidad_id = p_proyecto);
  delete from public.enlaces where (entidad = 'actividad' and entidad_id = any(v_acts)) or (entidad = 'restriccion' and entidad_id = any(v_rests))
    or (entidad = 'cartera' and entidad_id = any(v_cart)) or (entidad = 'proyecto' and entidad_id = p_proyecto);
  delete from public.restricciones where id = any(v_rests);
  delete from public.actividades where id = any(v_acts);
  delete from public.cartera where id = any(v_cart);
  delete from public.plantilla_items where proyecto_id = p_proyecto;
  update public.lista_valores set extra = extra - 'proyecto_id' where extra ->> 'proyecto_id' = p_proyecto::text;
  delete from public.proyectos where id = p_proyecto;               -- hitos, líderes y favoritos se borran en cascada
  perform set_config('lpsgt.cierre_en_curso', 'off', true);
  return v;
end $$;

revoke execute on function public.eliminar_proyecto_completo(uuid) from public, anon;
grant execute on function public.eliminar_proyecto_completo(uuid) to authenticated;
