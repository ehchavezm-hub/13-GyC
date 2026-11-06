-- LPS-GES · 019_nueva_matriz_permisos.sql
-- Reemplaza la matriz de permisos antigua por la nueva (20 acciones × 4 roles).
-- Aplica solo a áreas que ya tienen permisos con los nombres anteriores.

do $$
declare
  v_area uuid;
begin
  for v_area in select distinct area_id from public.permisos
                 where accion in ('gestionar_usuarios','ver_tablero','exportar','importar_historico')
  loop
    -- Eliminar permisos con nombres viejos
    delete from public.permisos where area_id = v_area;

    -- Insertar nueva matriz: delegado=true por defecto, lider y consulta parten en false
    insert into public.permisos (area_id, rol, accion, permitido)
    select v_area, r.rol, a.accion,
           (r.rol = 'delegado')
      from (values ('delegado'),('lider'),('consulta')) r(rol)
      cross join (values
        ('ver_semana'),('crear_semana'),('editar_semana'),('cerrar_semana'),
        ('ver_compromiso'),('crear_compromiso'),('editar_compromiso'),('cerrar_compromiso'),
        ('ver_restriccion'),('crear_restriccion'),('editar_restriccion'),('resolver_restriccion'),
        ('ver_cartera'),('crear_cartera'),('editar_cartera'),('exportar_pdf'),
        ('ver_indicadores'),('importar_datos'),('ver_solicitud'),('crear_solicitud')
      ) a(accion);

    -- lider: 6 acciones activas por defecto
    update public.permisos set permitido = true
     where area_id = v_area and rol = 'lider'
       and accion in ('ver_semana','crear_semana','editar_semana','ver_compromiso','crear_compromiso','editar_compromiso');

    -- consulta: 3 acciones activas por defecto
    update public.permisos set permitido = true
     where area_id = v_area and rol = 'consulta'
       and accion in ('ver_semana','ver_compromiso','ver_indicadores');

    raise notice 'Área % actualizada a nueva matriz de permisos.', v_area;
  end loop;
end $$;
