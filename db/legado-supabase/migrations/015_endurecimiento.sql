-- LPS-GES · 015_endurecimiento.sql
-- Endurecimiento para producción (auditoría de seguridad y rendimiento, solicitud 54):
--   1. Referencias cruzadas entre áreas (BOLA): un registro solo puede apuntar a proyectos, personas,
--      actividades, reuniones y valores de lista de su misma área, aunque se manipulen los IDs.
--   2. Autoría no suplantable: created_by / autor_id siempre es el usuario que inserta y no se cambia.
--   3. Líderes y favoritos de proyecto limitados al área del usuario.
--   4. Menciones: solo notifican a personas de la misma área.
--   5. Funciones: search_path fijo (public, pg_temp) y sin EXECUTE para anon.
--   6. Rendimiento con muchos usuarios: las políticas evalúan auth.uid(), mi_area(), puede()... una vez
--      por consulta (patrón "(select f())" recomendado por Supabase) en lugar de una vez por fila.
--   7. Índices para claves foráneas usadas en uniones, borrados en cascada y políticas.

set client_min_messages = warning;

-- ============================================================
-- 1. Referencias de la misma área
-- Argumentos del disparador: 'columna:tabla'. Tabla '*' = según la columna "entidad".
-- ============================================================
create or replace function public.tg_misma_area() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  i int;
  v_col text;
  v_tab text;
  v_id uuid;
  v_ok boolean;
  v_nuevo jsonb := to_jsonb(new);
  v_viejo jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
begin
  if auth.uid() is null then return new; end if;           -- SQL directo, migraciones y servicio
  for i in 0 .. tg_nargs - 1 loop
    v_col := split_part(tg_argv[i], ':', 1);
    v_tab := split_part(tg_argv[i], ':', 2);
    v_id := nullif(v_nuevo ->> v_col, '')::uuid;
    continue when v_id is null;
    continue when tg_op = 'UPDATE' and v_viejo ->> v_col is not distinct from v_nuevo ->> v_col
                  and (v_tab <> '*' or v_viejo ->> 'entidad' is not distinct from v_nuevo ->> 'entidad');
    if v_tab = '*' then
      v_tab := case v_nuevo ->> 'entidad' when 'actividad' then 'actividades' when 'restriccion' then 'restricciones'
                                          when 'proyecto' then 'proyectos' when 'cartera' then 'cartera' end;
    end if;
    if v_tab = 'lista_valores' then
      select exists (select 1 from public.lista_valores v join public.listas l on l.id = v.lista_id
                      where v.id = v_id and (l.area_id is null or l.area_id = new.area_id)) into v_ok;
    elsif v_tab in ('proyectos','profiles','actividades','restricciones','cartera','reuniones','listas','organigrama_nodos') then
      execute format('select exists (select 1 from public.%I where id = $1 and area_id = $2)', v_tab)
        using v_id, new.area_id into v_ok;
    else
      raise exception 'tg_misma_area: tabla no prevista %', v_tab;
    end if;
    if not v_ok then
      raise exception 'Referencia no válida en "%": el registro no existe o pertenece a otra área.', v_col
        using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('actividades', 'proyecto_id:proyectos,responsable_id:profiles,cartera_id:cartera,servicio_id:lista_valores,gerencia_id:lista_valores,cnc_id:lista_valores,cet_id:lista_valores'),
    ('cartera', 'proyecto_id:proyectos,responsable_id:profiles,solicitante_id:profiles,servicio_id:lista_valores,gerencia_id:lista_valores,criticidad_id:lista_valores,tipo_id:lista_valores'),
    ('restricciones', 'actividad_id:actividades,proyecto_id:proyectos,responsable_id:profiles,tipo_id:lista_valores'),
    ('proyectos', 'gerencia_id:lista_valores,fase_id:lista_valores,pais_id:lista_valores,tipo_id:lista_valores,cet_id:lista_valores'),
    ('hitos', 'proyecto_id:proyectos'),
    ('cierres', 'responsable_id:profiles'),
    ('pac_historico', 'responsable_id:profiles'),
    ('acuerdos', 'reunion_id:reuniones,responsable_id:profiles,cnc_id:lista_valores'),
    ('ubicaciones_dia', 'usuario_id:profiles,ubicacion_id:lista_valores'),
    ('plantillas', 'propietario_id:profiles,servicio_id:lista_valores'),
    ('organigrama_nodos', 'padre_id:organigrama_nodos,usuario_id:profiles'),
    ('columnas_personalizadas', 'lista_id:listas'),
    ('comentarios', 'entidad_id:*'),
    ('enlaces', 'entidad_id:*'),
    ('profiles', 'cargo_id:lista_valores')
  ) as t(tabla, args) loop
    execute format('drop trigger if exists trg_%1$s_misma_area on public.%1$I', r.tabla);
    execute format('create trigger trg_%1$s_misma_area before insert or update on public.%1$I
                    for each row execute function public.tg_misma_area(%2$s)',
                   r.tabla, (select string_agg(quote_literal(a), ', ') from unnest(string_to_array(r.args, ',')) a));
  end loop;
end $$;

-- Ítems de plantilla: no tienen area_id propio; se validan contra el área de su plantilla
create or replace function public.tg_items_misma_area() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_area uuid;
begin
  if auth.uid() is null then return new; end if;
  select area_id into v_area from public.plantillas where id = new.plantilla_id;
  if (new.proyecto_id is not null and not exists (select 1 from public.proyectos where id = new.proyecto_id and area_id = v_area))
     or exists (select 1 from unnest(array[new.servicio_id, new.gerencia_id, new.cet_id]) x(id)
                 where x.id is not null and not exists (
                   select 1 from public.lista_valores v join public.listas l on l.id = v.lista_id
                    where v.id = x.id and (l.area_id is null or l.area_id = v_area))) then
    raise exception 'Referencia no válida en el ítem de plantilla: pertenece a otra área.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_plantilla_items_misma_area on public.plantilla_items;
create trigger trg_plantilla_items_misma_area before insert or update on public.plantilla_items
  for each row execute function public.tg_items_misma_area();

-- ============================================================
-- 2. Autoría: la fija la base de datos
-- ============================================================
create or replace function public.tg_fijar_autor() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_col text := tg_argv[0];
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new := jsonb_populate_record(new, jsonb_build_object(v_col, auth.uid()));
  else
    new := jsonb_populate_record(new, jsonb_build_object(v_col, to_jsonb(old) -> v_col));
  end if;
  return new;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('actividades', 'created_by'), ('acuerdos', 'created_by'), ('cartera', 'created_by'), ('proyectos', 'created_by'),
    ('restricciones', 'created_by'), ('reuniones', 'created_by'),
    ('comentarios', 'autor_id'), ('enlaces', 'autor_id'), ('solicitudes_cambio', 'autor_id')
  ) as t(tabla, col) loop
    execute format('drop trigger if exists trg_%1$s_autor on public.%1$I', r.tabla);
    execute format('create trigger trg_%1$s_autor before insert or update on public.%1$I
                    for each row execute function public.tg_fijar_autor(%2$L)', r.tabla, r.col);
  end loop;
end $$;

-- ============================================================
-- 3. Líderes y favoritos: solo proyectos y personas de mi área
-- ============================================================
drop policy if exists proy_lideres_sel on public.proyecto_lideres;
drop policy if exists proy_lideres_all on public.proyecto_lideres;
create policy proy_lideres_sel on public.proyecto_lideres for select to authenticated
  using (public.es_staff() and exists (select 1 from public.proyectos p where p.id = proyecto_id and p.area_id = public.mi_area()));
create policy proy_lideres_all on public.proyecto_lideres for all to authenticated
  using ((public.puede('crear_proyecto') or public.puede('aprobar_proyecto'))
         and exists (select 1 from public.proyectos p where p.id = proyecto_id and p.area_id = public.mi_area()))
  with check ((public.puede('crear_proyecto') or public.puede('aprobar_proyecto'))
         and exists (select 1 from public.proyectos p where p.id = proyecto_id and p.area_id = public.mi_area())
         and exists (select 1 from public.profiles u where u.id = usuario_id and u.area_id = public.mi_area()));

drop policy if exists favoritos_all on public.proyecto_favoritos;
create policy favoritos_all on public.proyecto_favoritos for all to authenticated
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid()
              and exists (select 1 from public.proyectos p where p.id = proyecto_id and p.area_id = public.mi_area()));

-- ============================================================
-- 4. Menciones: solo personas activas de la misma área
-- ============================================================
create or replace function public.tg_notificar_menciones() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_autor text;
begin
  select nombre into v_autor from public.profiles where id = new.autor_id;
  insert into public.notificaciones (usuario_id, tipo, texto, ruta)
  select p.id, 'mencion', coalesce(v_autor, 'Alguien') || ' te mencionó: ' || left(new.texto, 140),
         '#/' || new.entidad || '/' || new.entidad_id
    from public.profiles p
   where p.id = any (new.menciones) and p.id <> new.autor_id and p.area_id = new.area_id and p.activo;
  return new;
end $$;

-- ============================================================
-- 5. Funciones: search_path fijo y sin acceso anónimo
-- (se excluyen las funciones que pertenecen a extensiones, p. ej. pgcrypto)
-- ============================================================
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.firma);
    execute format('revoke execute on function %s from public, anon', f.firma);
    execute format('grant execute on function %s to authenticated', f.firma);
  end loop;
end $$;

-- Funciones internas: solo el servicio (cron y Edge Functions) o los disparadores
revoke execute on function public.cerrar_semanas_vencidas() from authenticated;
revoke execute on function public.sembrar_area(uuid) from authenticated;
revoke execute on function public.sembrar_lista(uuid, text, text, jsonb) from authenticated;
revoke execute on function public.notificar_gestores(uuid, text, text, text) from authenticated;

-- Funciones que se creen en el futuro: sin EXECUTE para anon por defecto
alter default privileges in schema public revoke execute on functions from public, anon;

-- ============================================================
-- 6. Políticas: funciones de contexto evaluadas una vez por consulta
-- ============================================================
do $$
declare
  p record;
  v_qual text;
  v_check text;
  v_sql text;
  -- auth.uid(), mi_area(), mi_rol(), es_*() y puede('accion'). mis_gerencias() queda igual: va dentro de "= any (...)".
  v_re constant text := '((auth\.uid|(public\.)?(mi_area|mi_rol|es_miembro|es_staff|es_gestor|es_admin|es_superadmin|es_admin_principal))\(\)|(public\.)?puede\(''[a-z_]+''(::text)?\))';
begin
  for p in select * from pg_policies where schemaname = 'public' loop
    v_qual := regexp_replace(p.qual, v_re, '(select \1)', 'g');
    v_check := regexp_replace(p.with_check, v_re, '(select \1)', 'g');
    continue when v_qual is not distinct from p.qual and v_check is not distinct from p.with_check;
    v_sql := format('alter policy %I on public.%I', p.policyname, p.tablename);
    if v_qual is not null then v_sql := v_sql || ' using (' || v_qual || ')'; end if;
    if v_check is not null then v_sql := v_sql || ' with check (' || v_check || ')'; end if;
    execute v_sql;
  end loop;
end $$;

-- ============================================================
-- 7. Índices
-- ============================================================
create index if not exists idx_restricciones_actividad on public.restricciones (actividad_id);
create index if not exists idx_restricciones_proyecto on public.restricciones (proyecto_id);
create index if not exists idx_actividades_cartera on public.actividades (cartera_id);
create index if not exists idx_cartera_proyecto on public.cartera (proyecto_id);
create index if not exists idx_cartera_responsable on public.cartera (responsable_id);
create index if not exists idx_hitos_proyecto on public.hitos (proyecto_id);
create index if not exists idx_acuerdos_reunion on public.acuerdos (reunion_id);
create index if not exists idx_plantilla_items_plantilla on public.plantilla_items (plantilla_id);
create index if not exists idx_proyecto_lideres_usuario on public.proyecto_lideres (usuario_id);
create index if not exists idx_proyecto_favoritos_proyecto on public.proyecto_favoritos (proyecto_id);
create index if not exists idx_comentarios_entidad on public.comentarios (entidad, entidad_id);
create index if not exists idx_enlaces_entidad on public.enlaces (entidad, entidad_id);
create index if not exists idx_profiles_area on public.profiles (area_id);
create index if not exists idx_lista_valores_lista on public.lista_valores (lista_id);
create index if not exists idx_cierres_area_semana on public.cierres (area_id, semana);
create index if not exists idx_ubicaciones_area_fecha on public.ubicaciones_dia (area_id, fecha);
create index if not exists idx_vistas_usuario on public.vistas (usuario_id, grilla);
create index if not exists idx_organigrama_padre on public.organigrama_nodos (padre_id);
