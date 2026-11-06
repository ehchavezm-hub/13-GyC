-- LPS-GES · 003_datos_iniciales.sql
-- Valores iniciales de listas, parámetros y matriz de permisos (todo editable luego desde el aplicativo).
-- sembrar_area() también sirve para habilitar nuevas áreas en el futuro.
-- No contiene datos de proyectos ni de personas: esos se cargan desde el aplicativo.

create or replace function public.sembrar_lista(p_area uuid, p_clave text, p_nombre text, p_valores jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_lista uuid;
  v jsonb;
  i int := 0;
begin
  insert into public.listas (area_id, clave, nombre, sistema) values (p_area, p_clave, p_nombre, true)
  on conflict (area_id, clave) do update set nombre = excluded.nombre
  returning id into v_lista;
  for v in select * from jsonb_array_elements(p_valores) loop
    i := i + 1;
    insert into public.lista_valores (lista_id, codigo, valor, orden, color, protegido, extra)
    values (v_lista, v->>'codigo', v->>'valor', i * 10, v->>'color',
            coalesce((v->>'protegido')::boolean, false), coalesce(v->'extra', '{}'::jsonb));
  end loop;
  return v_lista;
end $$;

create or replace function public.sembrar_area(p_area uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.listas where area_id = p_area) then
    raise notice 'El área ya tiene listas; no se vuelve a sembrar.';
    return;
  end if;

  perform public.sembrar_lista(p_area, 'gerencias', 'Gerencias (clientes internos)', '[
    {"codigo":"GI","valor":"Gerencia de Ingeniería"},
    {"codigo":"GOI","valor":"Gerencia de Obras Industriales"},
    {"codigo":"GOC","valor":"Gerencia de Obras Civiles"},
    {"codigo":"GOF","valor":"Gerencia de Obras de Infraestructura"},
    {"codigo":"PyL","valor":"Propuestas y Licitaciones"},
    {"codigo":"GOI_CH","valor":"Gerencia de Obras Industriales Chile"},
    {"codigo":"GOC_CH","valor":"Gerencia de Obras Civiles Chile"},
    {"codigo":"GIPT","valor":"Gerencia de Innovación"}]');

  perform public.sembrar_lista(p_area, 'cet', 'CET (códigos de proyectos internos)', '[]');
  perform public.sembrar_lista(p_area, 'servicios', 'Servicios / Entregables', '[
    {"valor":"Seguimiento implementación BIM"},
    {"valor":"Envío y recepción de documentos técnicos"},
    {"valor":"Monitoreo y control de RFI"},
    {"valor":"Gestión de las comunicaciones"},
    {"valor":"Consultas técnicas"},
    {"valor":"Metrados"},
    {"valor":"Mejora de procesos"},
    {"valor":"Gestión del conocimiento"},
    {"valor":"Planificación, monitoreo y control del área"},
    {"valor":"Propuestas y licitaciones"}]');
  perform public.sembrar_lista(p_area, 'categorias_servicio', 'Categorías de servicio', '[
    {"valor":"Proyecto"},{"valor":"Mejora de procesos"},{"valor":"Gestión del conocimiento"},{"valor":"Gestión del área"}]');
  perform public.sembrar_lista(p_area, 'tipos_proyecto', 'Tipos de proyecto', '[
    {"valor":"Proyecto"},{"valor":"Proceso interno"},{"valor":"Gestión del área"},{"valor":"Capacitación / conocimiento"}]');
  perform public.sembrar_lista(p_area, 'fases', 'Fases de proyecto', '[
    {"valor":"Diseño"},{"valor":"Preconstrucción"},{"valor":"Construcción"},{"valor":"Cierre"},{"valor":"Permanente"}]');
  perform public.sembrar_lista(p_area, 'paises', 'Países', '[
    {"valor":"Perú"},{"valor":"Chile"},{"valor":"Colombia"},{"valor":"Bolivia"}]');

  -- Listas cuyos códigos usa la lógica (valores protegidos: renombrables, no eliminables)
  perform public.sembrar_lista(p_area, 'estados_proyecto', 'Estados de proyecto', '[
    {"codigo":"propuesto","valor":"Propuesto","color":"#EDC948","protegido":true},
    {"codigo":"activo","valor":"Activo","color":"#59A14F","protegido":true},
    {"codigo":"en_pausa","valor":"En pausa","color":"#BAB0AC","protegido":true},
    {"codigo":"cerrado","valor":"Cerrado","color":"#4E79A7","protegido":true},
    {"codigo":"rechazado","valor":"Rechazado","color":"#E15759","protegido":true}]');
  perform public.sembrar_lista(p_area, 'tipos_actividad', 'Tipos de compromiso', '[
    {"codigo":"programada","valor":"Programada","protegido":true},
    {"codigo":"no_programada","valor":"No programada","protegido":true}]');
  perform public.sembrar_lista(p_area, 'estados_la', 'Estados de Look Ahead', '[
    {"codigo":"pendiente","valor":"Pendiente","color":"#BAB0AC","protegido":true},
    {"codigo":"con_restriccion","valor":"Con restricción","color":"#E15759","protegido":true},
    {"codigo":"lista","valor":"Lista","color":"#59A14F","protegido":true},
    {"codigo":"trasladada","valor":"Trasladada al plan","color":"#4E79A7","protegido":true},
    {"codigo":"cancelada","valor":"Cancelada","color":"#9E9E9E","protegido":true}]');
  perform public.sembrar_lista(p_area, 'estados_compromiso', 'Estados de compromiso', '[
    {"codigo":"programado","valor":"Programado","color":"#EDC948","protegido":true},
    {"codigo":"completado","valor":"Completado","color":"#59A14F","protegido":true},
    {"codigo":"no_completado","valor":"No completado","color":"#E15759","protegido":true},
    {"codigo":"cancelado","valor":"Cancelado","color":"#BAB0AC","protegido":true}]');
  perform public.sembrar_lista(p_area, 'cnc', 'Causas de no cumplimiento (CNC)', '[
    {"valor":"Mala planificación / subestimación de HH"},
    {"valor":"Trabajo previo no terminado (pre-requisito)"},
    {"valor":"Sin información del cliente / información faltante"},
    {"valor":"Indefinición técnica / problema de diseño o planos"},
    {"valor":"Aprobación pendiente (interna o del cliente)"},
    {"valor":"Decisión de cliente"},
    {"valor":"Cambio de prioridad"},
    {"valor":"Dependencia externa / de otra área"},
    {"valor":"Falta de recursos (personal no disponible)"},
    {"valor":"Herramientas, software o accesos no disponibles"},
    {"valor":"Contratos / órdenes de cambio"},
    {"valor":"Permisos / autorizaciones faltantes"},
    {"valor":"Condición no prevista"},
    {"valor":"Fuerza mayor (incluye clima)"},
    {"valor":"Me olvidé"},
    {"valor":"Otra causa (especificar en comentario)"},
    {"codigo":"no_reportado","valor":"No reportado al cierre","protegido":true}]');
  perform public.sembrar_lista(p_area, 'tipos_restriccion', 'Tipos de restricción', '[
    {"valor":"Información del cliente"},{"valor":"Aprobación"},{"valor":"Recursos"},
    {"valor":"Dependencia de otra área"},{"valor":"Accesos / software"},{"valor":"Contractual"},{"valor":"Otro"}]');
  perform public.sembrar_lista(p_area, 'estados_restriccion', 'Estados de restricción', '[
    {"codigo":"pendiente","valor":"Pendiente","color":"#E15759","protegido":true},
    {"codigo":"en_gestion","valor":"En gestión","color":"#EDC948","protegido":true},
    {"codigo":"levantada","valor":"Levantada","color":"#59A14F","protegido":true}]');
  perform public.sembrar_lista(p_area, 'criticidad', 'Criticidad', '[
    {"valor":"Alta","color":"#E15759"},{"valor":"Media","color":"#EDC948"},{"valor":"Baja","color":"#59A14F"}]');
  perform public.sembrar_lista(p_area, 'tipos_cartera', 'Tipos de cartera', '[{"valor":"Proyecto"},{"valor":"Permanente"}]');
  perform public.sembrar_lista(p_area, 'estados_cartera', 'Estados de cartera', '[
    {"codigo":"nueva","valor":"Solicitud nueva","color":"#F28E2B","protegido":true},
    {"codigo":"abierta","valor":"Abierto","color":"#4E79A7","protegido":true},
    {"codigo":"en_proceso","valor":"En proceso","color":"#EDC948","protegido":true},
    {"codigo":"cerrada","valor":"Cerrado","color":"#59A14F","protegido":true},
    {"codigo":"rechazada","valor":"Rechazado","color":"#E15759","protegido":true}]');
  perform public.sembrar_lista(p_area, 'ubicaciones', 'Ubicaciones', '[
    {"codigo":"oficina","valor":"Oficina","color":"#4E79A7","extra":{"cuenta_capacidad":true}},
    {"codigo":"proyecto","valor":"Proyecto (obra)","color":"#F28E2B","extra":{"cuenta_capacidad":true}},
    {"codigo":"remoto","valor":"Remoto","color":"#76B7B2","extra":{"cuenta_capacidad":true}},
    {"codigo":"vacaciones","valor":"Vacaciones / licencia","color":"#BAB0AC","extra":{"cuenta_capacidad":false}},
    {"codigo":"feriado","valor":"Feriado","color":"#B07AA1","extra":{"cuenta_capacidad":false}}]');

  insert into public.parametros (area_id, clave, valor, descripcion) values
    (p_area, 'meta_pac',            '0.80',                 'Meta de PAC (0 a 1)'),
    (p_area, 'umbral_ambar',        '0.60',                 'Desde este PAC el semáforo es ámbar'),
    (p_area, 'semanas_lookahead',   '3',                    'Semanas del Look Ahead'),
    (p_area, 'horas_dia',           '8',                    'Horas disponibles por día laborable (capacidad por defecto)'),
    (p_area, 'dias_laborables',     '[1,2,3,4,5]',          'Días laborables (1 = lunes … 7 = domingo)'),
    (p_area, 'cierre',              '{"dia":5,"hora":"17:00"}', 'Cierre semanal (día ISO y hora)'),
    (p_area, 'reunion',             '{"dia":5,"hora":"08:00"}', 'Reunión semanal (día ISO y hora)'),
    (p_area, 'cierre_automatico',   'true',                 'Cerrar automáticamente las semanas vencidas'),
    (p_area, 'alerta_dias',         '3',                    'Días de anticipación para alertas de restricciones'),
    (p_area, 'arrastre_alerta',     '2',                    'Semanas pendientes desde las que se alerta un arrastre'),
    (p_area, 'zona_horaria',        '"America/Lima"',       'Zona horaria del área'),
    (p_area, 'version_app',         '"LPS_GES V1.00.01"',    'Texto del encabezado de los PDF'),
    (p_area, 'firma_pdf',           '"By EHCM"',            'Texto del pie de los PDF'),
    (p_area, 'reunion_minutos',     '{"cierre":10,"avance":10,"restricciones":10,"compromisos":20,"lookahead":10}', 'Minutos por paso del modo reunión'),
    (p_area, 'reconocimientos',     '{"mejor_pac":true,"mayor_mejora":true}', 'Reconocimientos mensuales del tablero');

  -- Matriz de permisos inicial 20 acciones × 4 roles (admin siempre puede todo).
  -- delegado=true por defecto; lider y consulta parten en false, luego se activan los permitidos.
  insert into public.permisos (area_id, rol, accion, permitido)
  select p_area, r.rol, a.accion,
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
   where area_id = p_area and rol = 'lider'
     and accion in ('ver_semana','crear_semana','editar_semana','ver_compromiso','crear_compromiso','editar_compromiso');
  -- consulta: 3 acciones activas por defecto
  update public.permisos set permitido = true
   where area_id = p_area and rol = 'consulta'
     and accion in ('ver_semana','ver_compromiso','ver_indicadores');
end $$;

-- ============================================================
-- Cierre automático de semanas vencidas (RN-08). Los compromisos sin estado pasan a
-- "No completado" con CNC "No reportado al cierre". Programar con pg_cron (ver README).
-- ============================================================
create or replace function public.cerrar_semanas_vencidas() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_cnc uuid;
  v_n int := 0;
  v_cierre jsonb;
  v_tz text;
  v_limite timestamptz;
begin
  perform set_config('lpsgt.cierre_en_curso', 'on', true);
  for r in
    select distinct a.area_id, a.responsable_id, a.semana
      from public.actividades a
     where a.comprometida
       and a.semana < date_trunc('week', now())::date + 7
       and not exists (select 1 from public.cierres c where c.responsable_id = a.responsable_id and c.semana = a.semana)
  loop
    select valor into v_cierre from public.parametros where area_id = r.area_id and clave = 'cierre';
    select valor #>> '{}' into v_tz from public.parametros where area_id = r.area_id and clave = 'zona_horaria';
    if coalesce((select valor::text from public.parametros where area_id = r.area_id and clave = 'cierre_automatico'), 'true') <> 'true' then
      continue;
    end if;
    v_limite := ((r.semana + (coalesce((v_cierre->>'dia')::int, 5) - 1))::text || ' ' ||
                 coalesce(v_cierre->>'hora', '17:00'))::timestamp at time zone coalesce(v_tz, 'America/Lima');
    if now() < v_limite then continue; end if;

    select lv.id into v_cnc from public.lista_valores lv join public.listas l on l.id = lv.lista_id
     where l.area_id = r.area_id and l.clave = 'cnc' and lv.codigo = 'no_reportado';
    update public.actividades
       set estado = 'no_completado', cnc_id = coalesce(cnc_id, v_cnc)
     where responsable_id = r.responsable_id and semana = r.semana and comprometida
       and (estado = 'programado' or (estado = 'no_completado' and cnc_id is null));
    insert into public.cierres (area_id, responsable_id, semana, cerrada, automatico, cerrado_por)
    values (r.area_id, r.responsable_id, r.semana, true, true, null);
    insert into public.notificaciones (usuario_id, tipo, texto, ruta)
    values (r.responsable_id, 'cierre_automatico',
            'Tu semana del ' || to_char(r.semana, 'DD/MM/YYYY') || ' se cerró automáticamente. Los compromisos sin estado quedaron como No completados.',
            '#/plan?semana=' || r.semana);
    v_n := v_n + 1;
  end loop;
  perform set_config('lpsgt.cierre_en_curso', 'off', true);
  return v_n;
end $$;

-- Exportación completa para el respaldo (la usa el respaldo automático semanal y el botón
-- "Descargar respaldo"). Con usuario: solo administrador y solo su área.
create or replace function public.exportar_respaldo() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb := jsonb_build_object('generado', now(), 'version', 1);
  v_tmp jsonb;
  t text;
  v_area uuid := public.mi_area();
  v_filtrar boolean := auth.uid() is not null;
  v_tiene_area boolean;
begin
  if v_filtrar and public.mi_rol() <> 'admin' then
    raise exception 'Solo el administrador puede exportar el respaldo completo.';
  end if;
  foreach t in array array['areas','profiles','listas','lista_valores','parametros','permisos','proyectos',
    'proyecto_lideres','hitos','cartera','actividades','restricciones','cierres','pac_historico','plantillas',
    'plantilla_items','ubicaciones_dia','reuniones','acuerdos','comentarios','enlaces','columnas_personalizadas',
    'vistas','solicitudes_cambio','delegado_historial']
  loop
    select exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = t and column_name = 'area_id')
      into v_tiene_area;
    if v_filtrar and v_tiene_area then
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x
                       where x.area_id = $1 or x.area_id is null', t) into v_tmp using v_area;
    elsif v_filtrar and t = 'areas' then
      execute 'select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.areas x where x.id = $1'
        into v_tmp using v_area;
    else
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into v_tmp;
    end if;
    v := v || jsonb_build_object(t, v_tmp);
  end loop;
  return v;
end $$;

-- ============================================================
-- Área inicial
-- ============================================================
do $$
declare v_area uuid;
begin
  if not exists (select 1 from public.areas) then
    insert into public.areas (nombre, descripcion) values ('Gerencia Técnica', 'Área inicial de LPS-GES')
    returning id into v_area;
    perform public.sembrar_area(v_area);
  end if;
end $$;
