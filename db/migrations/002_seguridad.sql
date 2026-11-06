-- LPS-GES · 002_seguridad.sql
-- Funciones de permisos, reglas de negocio protegidas en la base de datos, auditoría,
-- notificaciones y políticas de seguridad por fila (RLS).

-- ============================================================
-- Funciones de contexto del usuario (security definer: leen profiles sin pasar por RLS)
-- ============================================================
create or replace function public.mi_perfil() returns public.profiles
language sql stable security definer set search_path = public as $$
  select * from public.profiles where id = auth.uid()
$$;

create or replace function public.mi_area() returns uuid
language sql stable security definer set search_path = public as $$
  select area_id from public.profiles where id = auth.uid() and activo
$$;

create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select rol from public.profiles where id = auth.uid() and activo), 'anonimo')
$$;

create or replace function public.mis_gerencias() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce((select gerencia_ids from public.profiles where id = auth.uid()), '{}')
$$;

create or replace function public.es_miembro() returns boolean
language sql stable as $$ select public.mi_rol() in ('admin','delegado','lider','consulta') $$;

create or replace function public.es_staff() returns boolean
language sql stable as $$ select public.mi_rol() in ('admin','delegado','lider') $$;

create or replace function public.es_gestor() returns boolean
language sql stable as $$ select public.mi_rol() in ('admin','delegado') $$;

create or replace function public.es_admin_principal() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select es_admin_principal from public.profiles where id = auth.uid() and activo), false)
$$;

-- Permiso configurable por rol (matriz de permisos). El administrador siempre puede.
create or replace function public.puede(p_accion text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.mi_rol() = 'admin' then true
    when public.mi_rol() in ('delegado','lider','consulta') then coalesce(
      (select permitido from public.permisos
        where area_id = public.mi_area() and rol = public.mi_rol() and accion = p_accion), false)
    else false end
$$;

create or replace function public.semana_cerrada(p_responsable uuid, p_semana date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cierres
                  where responsable_id = p_responsable and semana = p_semana and cerrada)
$$;

-- ============================================================
-- Alta de usuarios: el primero de un área es administrador principal; el resto queda
-- "pendiente" hasta que un gestor le asigne rol.
-- ============================================================
create or replace function public.tg_nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_area uuid;
  v_hay_admin boolean;
begin
  select id into v_area from public.areas where activa order by created_at limit 1;
  select exists (select 1 from public.profiles where area_id = v_area and rol = 'admin') into v_hay_admin;
  insert into public.profiles (id, area_id, email, nombre, rol, es_admin_principal)
  values (new.id, v_area, new.email,
          coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
          case when v_hay_admin then 'pendiente' else 'admin' end,
          not v_hay_admin);
  if v_hay_admin then
    insert into public.notificaciones (usuario_id, tipo, texto, ruta)
    select p.id, 'usuario_nuevo', 'Nuevo usuario por aprobar: ' || coalesce(new.email, ''), '#/config/usuarios'
      from public.profiles p where p.area_id = v_area and p.rol in ('admin','delegado') and p.activo;
  end if;
  return new;
end $$;

create trigger trg_auth_nuevo_usuario after insert on auth.users
  for each row execute function public.tg_nuevo_usuario();

-- Protección de perfiles: límites del administrador delegado y del propio usuario
create or replace function public.tg_proteger_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_yo public.profiles;
begin
  if new.rol = 'delegado' and old.rol <> 'delegado' then
    insert into public.delegado_historial (area_id, usuario_id, otorgado_por) values (new.area_id, new.id, auth.uid());
  elsif old.rol = 'delegado' and new.rol <> 'delegado' then
    update public.delegado_historial set hasta = now() where usuario_id = new.id and hasta is null;
  end if;

  if auth.uid() is null then return new; end if;            -- SQL directo / servicio
  select * into v_yo from public.profiles where id = auth.uid();

  if new.es_admin_principal is distinct from old.es_admin_principal then
    raise exception 'El administrador principal solo se cambia desde la base de datos.';
  end if;

  if (new.rol, new.activo, new.area_id, new.gerencia_ids)
     is distinct from (old.rol, old.activo, old.area_id, old.gerencia_ids) then
    if not public.puede('gestionar_usuarios') then
      raise exception 'No tiene permiso para cambiar roles, gerencias o el estado de usuarios.';
    end if;
    if old.es_admin_principal and not v_yo.es_admin_principal then
      raise exception 'Solo el administrador principal puede modificar su propio rol o estado.';
    end if;
    if (old.rol in ('admin','delegado') or new.rol in ('admin','delegado'))
       and new.rol is distinct from old.rol and not v_yo.es_admin_principal then
      raise exception 'Solo el administrador principal asigna o retira los roles de administrador y delegado.';
    end if;
  end if;

  return new;
end $$;

create trigger trg_proteger_perfil before update on public.profiles
  for each row execute function public.tg_proteger_perfil();

-- ============================================================
-- Listas: los valores protegidos (P5) no se eliminan ni cambian de código
-- ============================================================
create or replace function public.tg_proteger_valor() returns trigger
language plpgsql as $$
begin
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

create trigger trg_proteger_valor before update or delete on public.lista_valores
  for each row execute function public.tg_proteger_valor();

-- ============================================================
-- Semana cerrada: nadie edita actividades de una semana cerrada (RN-08)
-- ============================================================
create or replace function public.tg_bloqueo_semana() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('lpsgt.cierre_en_curso', true) = 'on' then
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

create trigger trg_bloqueo_semana before insert or update or delete on public.actividades
  for each row execute function public.tg_bloqueo_semana();

-- Validación del cierre (RN-05): sin compromisos pendientes de estado y con CNC en los no cumplidos
create or replace function public.tg_validar_cierre() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_sin_estado int;
  v_sin_cnc int;
begin
  if tg_op = 'UPDATE' and new.cerrada = false and old.cerrada then
    if auth.uid() is not null and not public.puede('reabrir_semana') then
      raise exception 'Solo el administrador o el delegado pueden reabrir una semana.';
    end if;
    new.reabierto_at := now();
    new.reabierto_por := auth.uid();
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

create trigger trg_validar_cierre before insert or update on public.cierres
  for each row execute function public.tg_validar_cierre();

-- ============================================================
-- Auditoría (6.15)
-- ============================================================
create or replace function public.tg_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cambios jsonb;
  v_id uuid;
  v_area uuid;
  k text;
begin
  if tg_op = 'UPDATE' then
    v_cambios := '{}'::jsonb;
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      if k not in ('updated_at') and (to_jsonb(new)->k) is distinct from (to_jsonb(old)->k) then
        v_cambios := v_cambios || jsonb_build_object(k, jsonb_build_array(to_jsonb(old)->k, to_jsonb(new)->k));
      end if;
    end loop;
    if v_cambios = '{}'::jsonb then return new; end if;
  elsif tg_op = 'INSERT' then
    v_cambios := to_jsonb(new);
  else
    v_cambios := to_jsonb(old);
  end if;
  v_id := coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id'))::uuid;
  v_area := coalesce((to_jsonb(new)->>'area_id'), (to_jsonb(old)->>'area_id'))::uuid;
  insert into public.auditoria (area_id, tabla, registro_id, accion, usuario_id, cambios)
  values (v_area, tg_table_name, v_id, lower(tg_op), auth.uid(), v_cambios);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['actividades','restricciones','proyectos','cartera','cierres','profiles',
    'permisos','parametros','lista_valores','acuerdos']
  loop
    execute format('create trigger trg_%1$s_auditoria after insert or update or delete on public.%1$s
                    for each row execute function public.tg_auditoria()', t);
  end loop;
end $$;

-- ============================================================
-- Notificaciones automáticas
-- ============================================================
create or replace function public.notificar_gestores(p_area uuid, p_tipo text, p_texto text, p_ruta text)
returns void language sql security definer set search_path = public as $$
  insert into public.notificaciones (usuario_id, tipo, texto, ruta)
  select id, p_tipo, p_texto, p_ruta from public.profiles
   where area_id = p_area and rol in ('admin','delegado') and activo and id is distinct from auth.uid()
$$;

create or replace function public.tg_notificar_menciones() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_autor text;
begin
  select nombre into v_autor from public.profiles where id = new.autor_id;
  insert into public.notificaciones (usuario_id, tipo, texto, ruta)
  select m, 'mencion', coalesce(v_autor, 'Alguien') || ' te mencionó: ' || left(new.texto, 140),
         '#/' || new.entidad || '/' || new.entidad_id
    from unnest(new.menciones) m where m <> new.autor_id;
  return new;
end $$;

create trigger trg_notificar_menciones after insert on public.comentarios
  for each row execute function public.tg_notificar_menciones();

create or replace function public.tg_notificar_proyecto() returns trigger
language plpgsql security definer set search_path = public as $$
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

create trigger trg_notificar_proyecto after insert or update on public.proyectos
  for each row execute function public.tg_notificar_proyecto();

create or replace function public.tg_notificar_solicitud() returns trigger
language plpgsql security definer set search_path = public as $$
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

create trigger trg_notificar_solicitud after insert or update on public.cartera
  for each row execute function public.tg_notificar_solicitud();

-- ============================================================
-- RLS
-- ============================================================
alter table public.areas                   enable row level security;
alter table public.profiles                enable row level security;
alter table public.delegado_historial      enable row level security;
alter table public.listas                  enable row level security;
alter table public.lista_valores           enable row level security;
alter table public.parametros              enable row level security;
alter table public.permisos                enable row level security;
alter table public.proyectos               enable row level security;
alter table public.proyecto_lideres        enable row level security;
alter table public.proyecto_favoritos      enable row level security;
alter table public.hitos                   enable row level security;
alter table public.cartera                 enable row level security;
alter table public.actividades             enable row level security;
alter table public.restricciones           enable row level security;
alter table public.cierres                 enable row level security;
alter table public.pac_historico           enable row level security;
alter table public.plantillas              enable row level security;
alter table public.plantilla_items         enable row level security;
alter table public.ubicaciones_dia         enable row level security;
alter table public.reuniones               enable row level security;
alter table public.acuerdos                enable row level security;
alter table public.comentarios             enable row level security;
alter table public.enlaces                 enable row level security;
alter table public.notificaciones          enable row level security;
alter table public.columnas_personalizadas enable row level security;
alter table public.vistas                  enable row level security;
alter table public.solicitudes_cambio      enable row level security;
alter table public.auditoria               enable row level security;

-- Áreas
create policy areas_sel on public.areas for select to authenticated using (id = public.mi_area());
create policy areas_upd on public.areas for update to authenticated using (id = public.mi_area() and public.mi_rol() = 'admin');

-- Perfiles: todos los miembros del área se ven (para listas de responsables); cada uno ve el suyo aunque esté pendiente
create policy profiles_sel on public.profiles for select to authenticated
  using (id = auth.uid() or (area_id = public.mi_area() and public.es_miembro()));
create policy profiles_upd on public.profiles for update to authenticated
  using (id = auth.uid() or (area_id = public.mi_area() and public.puede('gestionar_usuarios')))
  with check (id = auth.uid() or (area_id = public.mi_area() and public.puede('gestionar_usuarios')));
create policy profiles_del on public.profiles for delete to authenticated
  using (area_id = public.mi_area() and public.mi_rol() = 'admin' and not es_admin_principal);

create policy delegado_hist_sel on public.delegado_historial for select to authenticated
  using (area_id = public.mi_area() and public.es_gestor());

-- Listas y valores: lectura para miembros; edición según permiso
create policy listas_sel on public.listas for select to authenticated
  using (public.es_miembro() and (area_id is null or area_id = public.mi_area()));
create policy listas_ins on public.listas for insert to authenticated
  with check (area_id = public.mi_area() and public.puede('gestionar_listas'));
create policy listas_upd on public.listas for update to authenticated
  using (area_id = public.mi_area() and public.puede('gestionar_listas'));
create policy listas_del on public.listas for delete to authenticated
  using (area_id = public.mi_area() and not sistema and public.puede('gestionar_listas'));

create policy valores_sel on public.lista_valores for select to authenticated
  using (exists (select 1 from public.listas l where l.id = lista_id
                  and (l.area_id is null or l.area_id = public.mi_area())) and public.es_miembro());
create policy valores_ins on public.lista_valores for insert to authenticated
  with check (exists (select 1 from public.listas l where l.id = lista_id and l.area_id = public.mi_area())
              and public.puede('gestionar_listas'));
create policy valores_upd on public.lista_valores for update to authenticated
  using (exists (select 1 from public.listas l where l.id = lista_id and l.area_id = public.mi_area())
         and public.puede('gestionar_listas'));
create policy valores_del on public.lista_valores for delete to authenticated
  using (exists (select 1 from public.listas l where l.id = lista_id and l.area_id = public.mi_area())
         and public.puede('gestionar_listas'));

create policy parametros_sel on public.parametros for select to authenticated
  using (area_id = public.mi_area() and public.es_miembro());
create policy parametros_ins on public.parametros for insert to authenticated
  with check (area_id = public.mi_area() and public.puede('gestionar_parametros'));
create policy parametros_upd on public.parametros for update to authenticated
  using (area_id = public.mi_area() and public.puede('gestionar_parametros'));

-- Permisos: solo el administrador modifica la matriz (el delegado la ve)
create policy permisos_sel on public.permisos for select to authenticated
  using (area_id = public.mi_area() and public.es_miembro());
create policy permisos_ins on public.permisos for insert to authenticated
  with check (area_id = public.mi_area() and public.mi_rol() = 'admin');
create policy permisos_upd on public.permisos for update to authenticated
  using (area_id = public.mi_area() and public.mi_rol() = 'admin');

-- Proyectos
create policy proyectos_sel on public.proyectos for select to authenticated
  using (area_id = public.mi_area() and (
    public.es_staff() or (public.mi_rol() = 'consulta' and estado = 'activo' and gerencia_id = any(public.mis_gerencias()))));
create policy proyectos_ins on public.proyectos for insert to authenticated
  with check (area_id = public.mi_area() and (
    public.puede('crear_proyecto')
    or (public.puede('proponer_proyecto') and estado = 'propuesto' and propuesto_por = auth.uid())));
create policy proyectos_upd on public.proyectos for update to authenticated
  using (area_id = public.mi_area() and (
    public.puede('crear_proyecto') or public.puede('aprobar_proyecto')
    or (estado = 'propuesto' and propuesto_por = auth.uid())))
  with check (area_id = public.mi_area() and (
    public.puede('crear_proyecto') or public.puede('aprobar_proyecto')
    or (estado = 'propuesto' and propuesto_por = auth.uid())));

create policy proy_lideres_sel on public.proyecto_lideres for select to authenticated using (public.es_staff());
create policy proy_lideres_all on public.proyecto_lideres for all to authenticated
  using (public.puede('crear_proyecto') or public.puede('aprobar_proyecto'))
  with check (public.puede('crear_proyecto') or public.puede('aprobar_proyecto'));

create policy favoritos_all on public.proyecto_favoritos for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

create policy hitos_sel on public.hitos for select to authenticated using (area_id = public.mi_area() and public.es_staff());
create policy hitos_all on public.hitos for all to authenticated
  using (area_id = public.mi_area() and public.es_staff()) with check (area_id = public.mi_area() and public.es_staff());

-- Cartera y solicitudes
create policy cartera_sel on public.cartera for select to authenticated
  using (area_id = public.mi_area() and (public.es_staff() or solicitante_id = auth.uid()));
create policy cartera_ins on public.cartera for insert to authenticated
  with check (area_id = public.mi_area() and (
    (public.es_staff() and origen = 'interna')
    or (public.puede('registrar_solicitud') and origen = 'solicitud' and estado = 'nueva' and solicitante_id = auth.uid())));
create policy cartera_upd on public.cartera for update to authenticated
  using (area_id = public.mi_area() and (
    public.es_gestor() or responsable_id = auth.uid() or created_by = auth.uid()
    or (estado = 'nueva' and public.puede('aceptar_solicitudes'))))
  with check (area_id = public.mi_area() and public.es_staff());
create policy cartera_del on public.cartera for delete to authenticated
  using (area_id = public.mi_area() and (public.es_gestor() or (created_by = auth.uid() and origen = 'interna')));

-- Actividades
create policy act_sel on public.actividades for select to authenticated
  using (area_id = public.mi_area() and (
    public.es_staff()
    or (public.mi_rol() = 'consulta' and exists (select 1 from public.proyectos p
          where p.id = proyecto_id and p.gerencia_id = any(public.mis_gerencias())))));
create policy act_ins on public.actividades for insert to authenticated
  with check (area_id = public.mi_area() and public.es_staff()
              and (responsable_id = auth.uid() or public.puede('editar_actividades_otros')));
create policy act_upd on public.actividades for update to authenticated
  using (area_id = public.mi_area() and (responsable_id = auth.uid() or public.puede('editar_actividades_otros')))
  with check (area_id = public.mi_area() and (responsable_id = auth.uid() or public.puede('editar_actividades_otros')));
create policy act_del on public.actividades for delete to authenticated
  using (area_id = public.mi_area() and (responsable_id = auth.uid() or public.puede('editar_actividades_otros')));

-- Restricciones: cualquier miembro del equipo registra y levanta
create policy rest_sel on public.restricciones for select to authenticated using (area_id = public.mi_area() and public.es_staff());
create policy rest_ins on public.restricciones for insert to authenticated with check (area_id = public.mi_area() and public.es_staff());
create policy rest_upd on public.restricciones for update to authenticated
  using (area_id = public.mi_area() and public.es_staff()) with check (area_id = public.mi_area() and public.es_staff());
create policy rest_del on public.restricciones for delete to authenticated
  using (area_id = public.mi_area() and (public.es_gestor() or created_by = auth.uid()));

-- Cierres
create policy cierres_sel on public.cierres for select to authenticated using (area_id = public.mi_area() and public.es_miembro());
create policy cierres_ins on public.cierres for insert to authenticated
  with check (area_id = public.mi_area() and (responsable_id = auth.uid() or public.puede('cerrar_semana_otros')));
create policy cierres_upd on public.cierres for update to authenticated
  using (area_id = public.mi_area() and (public.puede('reabrir_semana')
         or ((responsable_id = auth.uid() or public.puede('cerrar_semana_otros')) and not cerrada)));

create policy pac_hist_sel on public.pac_historico for select to authenticated using (area_id = public.mi_area() and public.es_miembro());
create policy pac_hist_all on public.pac_historico for all to authenticated
  using (area_id = public.mi_area() and public.puede('importar_historico'))
  with check (area_id = public.mi_area() and public.puede('importar_historico'));

-- Plantillas: recurrentes del propio líder; de servicio, gestores
create policy plant_sel on public.plantillas for select to authenticated using (area_id = public.mi_area() and public.es_staff());
create policy plant_all on public.plantillas for all to authenticated
  using (area_id = public.mi_area() and ((tipo = 'recurrente' and propietario_id = auth.uid())
         or public.puede('gestionar_plantillas_servicio') or public.puede('editar_actividades_otros')))
  with check (area_id = public.mi_area() and ((tipo = 'recurrente' and propietario_id = auth.uid())
         or public.puede('gestionar_plantillas_servicio') or public.puede('editar_actividades_otros')));
create policy plant_items_sel on public.plantilla_items for select to authenticated
  using (exists (select 1 from public.plantillas p where p.id = plantilla_id and p.area_id = public.mi_area()) and public.es_staff());
create policy plant_items_all on public.plantilla_items for all to authenticated
  using (exists (select 1 from public.plantillas p where p.id = plantilla_id and p.area_id = public.mi_area()
         and ((p.tipo = 'recurrente' and p.propietario_id = auth.uid())
              or public.puede('gestionar_plantillas_servicio') or public.puede('editar_actividades_otros'))))
  with check (exists (select 1 from public.plantillas p where p.id = plantilla_id and p.area_id = public.mi_area()
         and ((p.tipo = 'recurrente' and p.propietario_id = auth.uid())
              or public.puede('gestionar_plantillas_servicio') or public.puede('editar_actividades_otros'))));

-- Ubicación diaria
create policy ubic_sel on public.ubicaciones_dia for select to authenticated using (area_id = public.mi_area() and public.es_staff());
create policy ubic_all on public.ubicaciones_dia for all to authenticated
  using (area_id = public.mi_area() and (usuario_id = auth.uid() or public.es_gestor()))
  with check (area_id = public.mi_area() and (usuario_id = auth.uid() or public.es_gestor()));

-- Reuniones y acuerdos
create policy reun_sel on public.reuniones for select to authenticated using (area_id = public.mi_area() and public.es_staff());
create policy reun_all on public.reuniones for all to authenticated
  using (area_id = public.mi_area() and public.puede('gestionar_reuniones'))
  with check (area_id = public.mi_area() and public.puede('gestionar_reuniones'));
create policy acu_sel on public.acuerdos for select to authenticated using (area_id = public.mi_area() and public.es_staff());
create policy acu_ins on public.acuerdos for insert to authenticated
  with check (area_id = public.mi_area() and public.puede('gestionar_reuniones'));
create policy acu_upd on public.acuerdos for update to authenticated
  using (area_id = public.mi_area() and (public.puede('gestionar_reuniones') or responsable_id = auth.uid()));
create policy acu_del on public.acuerdos for delete to authenticated
  using (area_id = public.mi_area() and public.puede('gestionar_reuniones'));

-- Comentarios y enlaces
create policy com_sel on public.comentarios for select to authenticated using (area_id = public.mi_area() and public.es_staff());
create policy com_ins on public.comentarios for insert to authenticated
  with check (area_id = public.mi_area() and autor_id = auth.uid() and public.puede('comentar'));
create policy com_del on public.comentarios for delete to authenticated
  using (area_id = public.mi_area() and (autor_id = auth.uid() or public.es_gestor()));
create policy enl_sel on public.enlaces for select to authenticated using (area_id = public.mi_area() and public.es_staff());
create policy enl_ins on public.enlaces for insert to authenticated with check (area_id = public.mi_area() and public.es_staff());
create policy enl_del on public.enlaces for delete to authenticated
  using (area_id = public.mi_area() and (autor_id = auth.uid() or public.es_gestor()));

-- Notificaciones: cada uno las suyas
create policy notif_sel on public.notificaciones for select to authenticated using (usuario_id = auth.uid());
create policy notif_upd on public.notificaciones for update to authenticated using (usuario_id = auth.uid());
create policy notif_del on public.notificaciones for delete to authenticated using (usuario_id = auth.uid());

-- Columnas personalizadas y vistas
create policy col_sel on public.columnas_personalizadas for select to authenticated using (area_id = public.mi_area() and public.es_miembro());
create policy col_all on public.columnas_personalizadas for all to authenticated
  using (area_id = public.mi_area() and public.puede('crear_columnas'))
  with check (area_id = public.mi_area() and public.puede('crear_columnas'));
create policy vistas_sel on public.vistas for select to authenticated
  using (area_id = public.mi_area() and (usuario_id = auth.uid() or usuario_id is null));
create policy vistas_all on public.vistas for all to authenticated
  using (area_id = public.mi_area() and (usuario_id = auth.uid() or (usuario_id is null and public.es_gestor())))
  with check (area_id = public.mi_area() and (usuario_id = auth.uid() or (usuario_id is null and public.es_gestor())));

-- Solicitudes de cambio
create policy sc_sel on public.solicitudes_cambio for select to authenticated using (area_id = public.mi_area() and public.es_miembro());
create policy sc_ins on public.solicitudes_cambio for insert to authenticated
  with check (area_id = public.mi_area() and public.es_miembro() and autor_id = auth.uid());
create policy sc_upd on public.solicitudes_cambio for update to authenticated
  using (area_id = public.mi_area() and public.puede('gestionar_solicitudes_cambio'));

-- Auditoría
create policy aud_sel on public.auditoria for select to authenticated
  using (area_id = public.mi_area() and public.puede('ver_auditoria'));

-- ============================================================
-- Tiempo real (Supabase): publicar las tablas que se sincronizan en pantalla
-- ============================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.actividades, public.restricciones, public.proyectos, public.cartera,
      public.cierres, public.notificaciones, public.comentarios, public.lista_valores;
  end if;
end $$;
