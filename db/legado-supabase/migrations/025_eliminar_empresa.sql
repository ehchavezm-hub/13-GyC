-- LPS-GES · 025_eliminar_empresa.sql
-- Pedido a9: eliminar una empresa recién creada fallaba a medias: sus listas tienen valores protegidos
-- (p. ej. «Completado») que la regla tg_proteger_valor no deja borrar, y el borrado se hacía por partes.
-- Ahora se elimina en UNA transacción (todo o nada) con eliminar_empresa(), que solo puede ejecutar el servidor
-- (Edge Function admin-usuarios, para los propietarios de la plataforma). Elimina cualquier empresa con todos sus
-- datos (proyectos, actividades, historial, usuarios); el aplicativo pide escribir el nombre de la empresa para confirmar.
-- Se puede ejecutar más de una vez.

set client_min_messages = warning;

-- La protección de valores no aplica mientras se elimina una empresa completa
create or replace function public.tg_proteger_valor() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('lpsgt.eliminando_empresa', true), '') = 'on' then
    return coalesce(old, new);
  end if;
  if tg_op = 'DELETE' then
    if old.protegido then
      raise exception 'El valor "%" está protegido: puede renombrarse, pero no eliminarse.', old.valor;
    end if;
    return old;
  end if;
  if old.protegido and (new.codigo is distinct from old.codigo or not new.protegido or not new.activo) then
    raise exception 'El valor "%" está protegido: solo puede cambiar su texto, orden o color.', old.valor;
  end if;
  return new;
end $$;

create or replace function public.eliminar_empresa(p_area uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.areas where id = p_area) then
    raise exception 'Empresa no encontrada.';
  end if;
  if exists (select 1 from public.profiles where area_id = p_area and es_plataforma) then
    raise exception 'Un propietario de la plataforma está trabajando en esa empresa. Que abra otra empresa primero.';
  end if;

  -- Durante el borrado de la empresa completa no aplican la protección de valores ni el bloqueo de semanas cerradas
  perform set_config('lpsgt.eliminando_empresa', 'on', true);
  perform set_config('lpsgt.cierre_en_curso', 'on', true);

  -- Trabajo del LPS (de lo que depende de otras tablas hacia lo independiente)
  delete from public.restricciones where area_id = p_area;
  delete from public.acuerdos where area_id = p_area;
  delete from public.reuniones where area_id = p_area;
  delete from public.hitos where area_id = p_area;
  delete from public.actividades where area_id = p_area;
  delete from public.cartera where area_id = p_area;
  delete from public.cierres where area_id = p_area;
  delete from public.pac_historico where area_id = p_area;
  delete from public.ubicaciones_dia where area_id = p_area;
  delete from public.comentarios where area_id = p_area;
  delete from public.enlaces where area_id = p_area;
  delete from public.solicitudes_cambio where area_id = p_area;
  delete from public.plantilla_items where plantilla_id in (select id from public.plantillas where area_id = p_area)
                                        or proyecto_id in (select id from public.proyectos where area_id = p_area);
  delete from public.plantillas where area_id = p_area;
  -- Estructura: sub-proyectos, proyectos, programas y portafolios
  delete from public.proyecto_lideres where proyecto_id in (select id from public.proyectos where area_id = p_area);
  delete from public.proyecto_favoritos where proyecto_id in (select id from public.proyectos where area_id = p_area);
  delete from public.proyectos where area_id = p_area and padre_id is not null;
  delete from public.proyectos where area_id = p_area;
  delete from public.programas where area_id = p_area;
  delete from public.portafolios where area_id = p_area;
  -- Configuración y usuarios (las cuentas de acceso las borra el servidor después)
  delete from public.vistas where area_id = p_area;
  delete from public.columnas_personalizadas where area_id = p_area;
  delete from public.organigrama_nodos where area_id = p_area;
  delete from public.delegado_historial where area_id = p_area;
  delete from public.permisos where area_id = p_area;
  delete from public.parametros where area_id = p_area;
  delete from public.notificaciones where usuario_id in (select id from public.profiles where area_id = p_area);
  delete from public.profiles where area_id = p_area;
  delete from public.lista_valores where lista_id in (select id from public.listas where area_id = p_area);
  delete from public.listas where area_id = p_area;
  delete from public.auditoria where area_id = p_area;
  delete from public.areas where id = p_area;

  perform set_config('lpsgt.cierre_en_curso', 'off', true);
  perform set_config('lpsgt.eliminando_empresa', 'off', true);
end $$;
revoke execute on function public.eliminar_empresa(uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.eliminar_empresa(uuid) to service_role;
  end if;
end $$;
