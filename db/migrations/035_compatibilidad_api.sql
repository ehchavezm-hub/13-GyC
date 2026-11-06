-- GyC · 035_compatibilidad_api.sql
-- Complementa 000_gyc_neon_completo.sql para que la base coincida con lo que piden el aplicativo (app/) y el
-- API (api/datos.js y api/admin-usuarios.js). Ejecutar en el SQL Editor de Neon DESPUÉS de la 000.
-- Se puede ejecutar más de una vez sin dañar nada.
--
--   1. Tabla supervisiones (Grupos LPS: quién ve y edita las actividades de otra persona)
--   2. reuniones.asistentes como text[] (los ids de Clerk son texto)
--   3. Funciones que llama el API: gyc_rechazar, puede, gyc_alta_usuario, registro_abierto,
--      eliminar_proyecto_completo, eliminar_proyecto_plataforma, exportar_respaldo_area
--   4. Reglas de negocio que en Supabase eran disparadores: semana cerrada, validación del cierre,
--      valores protegidos, auditoría con cambios y notificaciones automáticas

set client_min_messages = warning;

-- ============================================================
-- 1. Supervisiones por Grupo LPS
-- ============================================================
create table if not exists public.supervisiones (
  id             uuid primary key default gen_random_uuid(),
  area_id        uuid not null references public.areas(id) on delete cascade,
  proyecto_id    uuid not null references public.proyectos(id) on delete cascade,
  supervisor_id  text not null,          -- profiles.id (TEXT, sin FK)
  subordinado_id text not null,          -- profiles.id (TEXT, sin FK)
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (proyecto_id, supervisor_id, subordinado_id)
);
create index if not exists supervisiones_area_idx on public.supervisiones (area_id);

-- ============================================================
-- 2. reuniones.asistentes: uuid[] → text[]
-- ============================================================
do $$ begin
  if (select udt_name from information_schema.columns
       where table_schema = 'public' and table_name = 'reuniones' and column_name = 'asistentes') = '_uuid' then
    alter table public.reuniones alter column asistentes drop default;
    alter table public.reuniones alter column asistentes type text[] using asistentes::text[];
    alter table public.reuniones alter column asistentes set default '{}';
  end if;
end $$;

-- ============================================================
-- 3. Funciones que usa el API
-- ============================================================

-- Corta la sentencia en curso con un mensaje (el API la usa para rechazar escrituras fuera de la empresa)
create or replace function public.gyc_rechazar(p_mensaje text) returns boolean
language plpgsql as $$
begin
  raise exception '%', p_mensaje;
end $$;

-- Matriz de permisos por rol. Super administrador y administrador siempre pueden.
create or replace function public.puede(p_usuario text, p_accion text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case
      when p.rol in ('superadmin','admin') or p.es_admin_principal then true
      when p.rol in ('delegado','lider','consulta') then coalesce(
        (select x.permitido from public.permisos x
          where x.area_id = p.area_id and x.rol = p.rol and x.accion = p_accion), false)
      else false end
      from public.profiles p
     where p.id = p_usuario and p.activo and not p.eliminado), false)
$$;

-- ¿Se ofrece crear cuenta? (una sola empresa activa)
create or replace function public.registro_abierto() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select (select count(*) from public.areas where activa) <= 1
$$;

-- Alta del perfil la primera vez que una persona ingresa con Clerk.
-- La primera persona de la base queda como super administrador principal y propietaria de la plataforma;
-- las siguientes quedan "pendiente" en la primera empresa activa hasta que un gestor les asigne rol.
create or replace function public.gyc_alta_usuario(p_id text, p_nombre text, p_email text)
returns setof public.profiles
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_area uuid;
  v_primero boolean;
begin
  perform pg_advisory_xact_lock(hashtext('gyc_alta_usuario'));
  if exists (select 1 from public.profiles where id = p_id) then
    return query select * from public.profiles where id = p_id;
    return;
  end if;
  select id into v_area from public.areas where activa order by created_at limit 1;
  select not exists (select 1 from public.profiles where not eliminado) into v_primero;
  insert into public.profiles (id, area_id, email, nombre, rol, es_admin_principal, es_plataforma, activo)
  values (p_id, v_area, lower(nullif(p_email, '')), coalesce(nullif(p_nombre, ''), split_part(p_email, '@', 1), p_id),
          case when v_primero then 'superadmin' else 'pendiente' end, v_primero, v_primero, true);
  if not v_primero and v_area is not null then
    insert into public.notificaciones (usuario_id, tipo, texto, ruta)
    select p.id, 'usuario_nuevo', 'Nuevo usuario por aprobar: ' || coalesce(p_email, p_nombre, p_id), '#/config/usuarios'
      from public.profiles p
     where p.area_id = v_area and p.rol in ('superadmin','admin','delegado') and p.activo and not p.eliminado;
  end if;
  return query select * from public.profiles where id = p_id;
end $$;

-- Elimina un proyecto con todo su historial (lo llama el API tras verificar que es administrador de la empresa)
create or replace function public.eliminar_proyecto_completo(p_proyecto uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_acts uuid[];
  v_rests uuid[];
  v_cart uuid[];
  v jsonb;
begin
  if not exists (select 1 from public.proyectos where id = p_proyecto) then raise exception 'Proyecto no encontrado.'; end if;
  if exists (select 1 from public.proyectos where padre_id = p_proyecto) then
    raise exception 'El proyecto tiene Grupos LPS: elimínelos o muévalos primero.';
  end if;
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
  update public.actividades set cartera_id = null where cartera_id = any(v_cart);
  delete from public.actividades where id = any(v_acts);
  delete from public.cartera where id = any(v_cart);
  delete from public.plantilla_items where proyecto_id = p_proyecto;
  update public.lista_valores set extra = extra - 'proyecto_id' where extra ->> 'proyecto_id' = p_proyecto::text;
  delete from public.proyectos where id = p_proyecto;               -- hitos, líderes, favoritos y arranque en cascada
  perform set_config('lpsgt.cierre_en_curso', 'off', true);
  return v;
end $$;

-- Igual, con sus Grupos LPS (consola de la plataforma)
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

  perform set_config('lpsgt.cierre_en_curso', 'on', true);
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
  delete from public.proyectos where padre_id = p_proyecto;
  delete from public.proyectos where id = p_proyecto;
  perform set_config('lpsgt.cierre_en_curso', 'off', true);
  return v;
end $$;

-- Respaldo de UNA empresa (exportar_respaldo de la 000 exporta todas: queda solo para el dueño en el SQL Editor)
create or replace function public.exportar_respaldo_area(p_area uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v jsonb := jsonb_build_object('generado', now(), 'version', 2, 'area_id', p_area);
  v_tmp jsonb;
  t text;
begin
  foreach t in array array[
    'listas','parametros','permisos','proyectos','portafolios','programas','hitos','cartera','actividades',
    'restricciones','cierres','pac_historico','plantillas','ubicaciones_dia','reuniones','acuerdos','comentarios',
    'enlaces','columnas_personalizadas','vistas','solicitudes_cambio','delegado_historial','organigrama_nodos',
    'supervisiones']
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x where x.area_id = $1', t)
      into v_tmp using p_area;
    v := v || jsonb_build_object(t, v_tmp);
  end loop;
  v := v || jsonb_build_object(
    'areas', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.areas a where a.id = p_area),
    'profiles', (select coalesce(jsonb_agg(to_jsonb(p)), '[]') from public.profiles p
                  where p.area_id = p_area or p.id in (select usuario_id from public.empresa_miembros where area_id = p_area)),
    'lista_valores', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.lista_valores x
                       where x.lista_id in (select id from public.listas where area_id = p_area)),
    'proyecto_lideres', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.proyecto_lideres x
                          where x.proyecto_id in (select id from public.proyectos where area_id = p_area)),
    'plantilla_items', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.plantilla_items x
                         where x.plantilla_id in (select id from public.plantillas where area_id = p_area)));
  return v;
end $$;

-- ============================================================
-- 4. Reglas de negocio (disparadores)
-- ============================================================

create or replace function public.semana_cerrada(p_responsable text, p_semana date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.cierres where responsable_id = p_responsable and semana = p_semana and cerrada)
$$;

-- Semana cerrada: nadie edita sus actividades (salvo los procesos internos de cierre y eliminación)
create or replace function public.tg_bloqueo_semana() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('lpsgt.cierre_en_curso', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op in ('UPDATE','DELETE') and public.semana_cerrada(old.responsable_id, old.semana) then
    raise exception 'La semana del % está cerrada. Solo un administrador puede reabrirla.', to_char(old.semana, 'DD/MM/YYYY');
  end if;
  if tg_op in ('INSERT','UPDATE') and public.semana_cerrada(new.responsable_id, new.semana) then
    raise exception 'La semana del % está cerrada. Solo un administrador puede reabrirla.', to_char(new.semana, 'DD/MM/YYYY');
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_bloqueo_semana on public.actividades;
create trigger trg_bloqueo_semana before insert or update or delete on public.actividades
  for each row execute function public.tg_bloqueo_semana();

-- Cierre: sin compromisos sin estado ni no cumplidos sin CNC; reabrir solo gestores
create or replace function public.tg_validar_cierre() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sin_estado int;
  v_sin_cnc int;
begin
  if tg_op = 'UPDATE' and new.cerrada = false and old.cerrada then
    if public.mi_uid() is not null and not exists (
        select 1 from public.profiles where id = public.mi_uid() and rol in ('superadmin','admin','delegado') and activo) then
      raise exception 'Solo el administrador o el delegado pueden reabrir una semana.';
    end if;
    new.reabierto_at := now();
    new.reabierto_por := public.mi_uid();
    return new;
  end if;
  if new.cerrada and not new.automatico then
    select count(*) filter (where estado = 'programado'),
           count(*) filter (where estado = 'no_completado' and cnc_id is null)
      into v_sin_estado, v_sin_cnc
      from public.actividades
     where responsable_id = new.responsable_id and semana = new.semana and comprometida;
    if v_sin_estado > 0 then
      raise exception 'Hay % compromiso(s) sin estado final (Completado / No completado / Cancelado).', v_sin_estado;
    end if;
    if v_sin_cnc > 0 then
      raise exception 'Hay % compromiso(s) no completado(s) sin causa de no cumplimiento (CNC).', v_sin_cnc;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_validar_cierre on public.cierres;
create trigger trg_validar_cierre before insert or update on public.cierres
  for each row execute function public.tg_validar_cierre();

-- Valores protegidos de las listas
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
drop trigger if exists trg_proteger_valor on public.lista_valores;
create trigger trg_proteger_valor before update or delete on public.lista_valores
  for each row execute function public.tg_proteger_valor();

-- Historial de delegados
create or replace function public.tg_historial_delegado() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.rol = 'delegado' and old.rol is distinct from 'delegado' and new.area_id is not null then
    insert into public.delegado_historial (area_id, usuario_id, otorgado_por) values (new.area_id, new.id, public.mi_uid());
  elsif old.rol = 'delegado' and new.rol is distinct from 'delegado' then
    update public.delegado_historial set hasta = now() where usuario_id = new.id and hasta is null;
  end if;
  return new;
end $$;
drop trigger if exists trg_historial_delegado on public.profiles;
create trigger trg_historial_delegado after update of rol on public.profiles
  for each row execute function public.tg_historial_delegado();

-- Auditoría con el detalle de los cambios y el usuario que fija el API (mi_uid)
create or replace function public.tg_auditoria() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cambios jsonb;
  v_id uuid;
  v_area uuid;
  k text;
begin
  if tg_op = 'UPDATE' then
    v_cambios := '{}'::jsonb;
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      if k <> 'updated_at' and (to_jsonb(new)->k) is distinct from (to_jsonb(old)->k) then
        v_cambios := v_cambios || jsonb_build_object(k, jsonb_build_array(to_jsonb(old)->k, to_jsonb(new)->k));
      end if;
    end loop;
    if v_cambios = '{}'::jsonb then return new; end if;
  elsif tg_op = 'INSERT' then
    v_cambios := to_jsonb(new);
  else
    v_cambios := to_jsonb(old);
  end if;
  begin v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id')::uuid; exception when others then v_id := null; end;
  begin v_area := coalesce(to_jsonb(new)->>'area_id', to_jsonb(old)->>'area_id')::uuid; exception when others then v_area := null; end;
  insert into public.auditoria (area_id, tabla, registro_id, accion, usuario_id, cambios)
  values (v_area, tg_table_name, v_id, lower(tg_op), public.mi_uid(), v_cambios);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['actividades','restricciones','proyectos','cartera','cierres','profiles',
    'permisos','parametros','lista_valores','acuerdos','portafolios','programas']
  loop
    execute format('drop trigger if exists trg_%1$s_auditoria on public.%1$I', t);
    execute format('create trigger trg_%1$s_auditoria after insert or update or delete on public.%1$I
                    for each row execute function public.tg_auditoria()', t);
  end loop;
end $$;

-- Notificaciones automáticas
create or replace function public.notificar_gestores(p_area uuid, p_tipo text, p_texto text, p_ruta text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notificaciones (usuario_id, tipo, texto, ruta)
  select id, p_tipo, p_texto, p_ruta from public.profiles
   where area_id = p_area and rol in ('superadmin','admin','delegado') and activo and not eliminado
     and id is distinct from public.mi_uid()
$$;

create or replace function public.tg_notificar_menciones() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_autor text;
begin
  select nombre into v_autor from public.profiles where id = new.autor_id;
  insert into public.notificaciones (usuario_id, tipo, texto, ruta)
  select p.id, 'mencion', coalesce(v_autor, 'Alguien') || ' te mencionó: ' || left(new.texto, 140),
         '#/' || new.entidad || '/' || new.entidad_id
    from public.profiles p
   where p.id = any (new.menciones) and p.id <> new.autor_id and p.activo
     and public.pertenece(p.id, new.area_id);
  return new;
end $$;
drop trigger if exists trg_notificar_menciones on public.comentarios;
create trigger trg_notificar_menciones after insert on public.comentarios
  for each row execute function public.tg_notificar_menciones();

create or replace function public.tg_notificar_proyecto() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' and new.estado = 'propuesto' then
    perform public.notificar_gestores(new.area_id, 'proyecto_propuesto',
      'Proyecto propuesto por aprobar: ' || new.codigo || ' ' || new.nombre_corto, '#/proyectos/' || new.id);
  elsif tg_op = 'UPDATE' and old.estado = 'propuesto' and new.estado in ('activo','rechazado')
        and new.propuesto_por is not null then
    insert into public.notificaciones (usuario_id, tipo, texto, ruta)
    values (new.propuesto_por, 'proyecto_' || new.estado,
            'Tu proyecto ' || new.nombre_corto || case when new.estado = 'activo' then ' fue aprobado.'
            else ' fue rechazado: ' || coalesce(new.motivo_rechazo, '') end, '#/proyectos/' || new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_notificar_proyecto on public.proyectos;
create trigger trg_notificar_proyecto after insert or update on public.proyectos
  for each row execute function public.tg_notificar_proyecto();

create or replace function public.tg_notificar_solicitud() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' and new.origen = 'solicitud' then
    perform public.notificar_gestores(new.area_id, 'solicitud_nueva',
      'Nueva solicitud de servicio: ' || left(new.descripcion, 120), '#/cartera/' || new.id);
    if new.responsable_id is not null then
      insert into public.notificaciones (usuario_id, tipo, texto, ruta)
      values (new.responsable_id, 'solicitud_nueva', 'Solicitud de servicio dirigida a ti: ' || left(new.descripcion, 120), '#/cartera/' || new.id);
    end if;
  elsif tg_op = 'UPDATE' and new.origen = 'solicitud' and old.estado = 'nueva'
        and new.estado <> 'nueva' and new.solicitante_id is not null then
    insert into public.notificaciones (usuario_id, tipo, texto, ruta)
    values (new.solicitante_id, 'solicitud_' || new.estado,
            'Tu solicitud "' || left(new.descripcion, 80) || '" fue ' ||
            case when new.estado = 'rechazada' then 'rechazada: ' || coalesce(new.motivo_rechazo, '') else 'aceptada.' end,
            '#/cartera/' || new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_notificar_solicitud on public.cartera;
create trigger trg_notificar_solicitud after insert or update on public.cartera
  for each row execute function public.tg_notificar_solicitud();

-- ============================================================
-- Verificación
-- ============================================================
do $$
begin
  assert exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'supervisiones'),
    'Falta la tabla supervisiones';
  assert (select udt_name from information_schema.columns
           where table_schema = 'public' and table_name = 'reuniones' and column_name = 'asistentes') = '_text',
    'reuniones.asistentes debe ser text[]';
  assert exists (select 1 from pg_proc where proname = 'puede' and pronargs = 2), 'Falta puede(usuario, accion)';
  assert exists (select 1 from pg_proc where proname = 'gyc_alta_usuario'), 'Falta gyc_alta_usuario';
  raise notice '✓ Migración 035_compatibilidad_api ejecutada correctamente.';
end $$;
