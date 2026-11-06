-- LPS-GES · 020_actualizar_politicas_permisos.sql
-- Actualiza funciones y políticas RLS que usaban nombres de acción anteriores
-- (gestionar_usuarios, crear_proyecto, etc.) a los nuevos nombres del PPT v5.

-- ============================================================
-- 1. Función tg_proteger_perfil: gestionar_usuarios → administrador (es_admin: superadmin o admin)
-- ============================================================
create or replace function public.tg_proteger_perfil() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_yo public.profiles;
  v_super boolean;
begin
  if new.rol = 'delegado' and old.rol <> 'delegado' then
    insert into public.delegado_historial (area_id, usuario_id, otorgado_por) values (new.area_id, new.id, auth.uid());
  elsif old.rol = 'delegado' and new.rol <> 'delegado' then
    update public.delegado_historial set hasta = now() where usuario_id = new.id and hasta is null;
  end if;

  if auth.uid() is null then return new; end if;            -- SQL directo / servicio
  select * into v_yo from public.profiles where id = auth.uid();
  v_super := v_yo.rol = 'superadmin' or v_yo.es_admin_principal;

  if new.es_admin_principal is distinct from old.es_admin_principal then
    raise exception 'El administrador principal solo se cambia desde la base de datos.';
  end if;
  if old.es_admin_principal and (new.rol is distinct from old.rol or not new.activo) then
    raise exception 'El administrador principal no puede perder su rol ni desactivarse.';
  end if;

  if (new.rol, new.activo, new.area_id, new.gerencia_ids)
     is distinct from (old.rol, old.activo, old.area_id, old.gerencia_ids) then
    if not public.es_admin() then
      raise exception 'No tiene permiso para cambiar roles, gerencias o el estado de usuarios.';
    end if;
    if old.rol in ('superadmin','admin') and not v_super and new.id <> v_yo.id then
      raise exception 'Solo el super administrador modifica a un administrador.';
    end if;
    if (old.rol in ('superadmin','admin','delegado') or new.rol in ('superadmin','admin','delegado'))
       and new.rol is distinct from old.rol and not v_super then
      raise exception 'Solo el super administrador asigna o retira los roles de super administrador, administrador y delegado.';
    end if;
  end if;
  return new;
end $$;

-- ============================================================
-- 2. Función tg_validar_cierre: reabrir_semana → esGestor (admin o delegado)
-- ============================================================
create or replace function public.tg_validar_cierre() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sin_estado int;
  v_sin_cnc int;
begin
  if tg_op = 'UPDATE' and new.cerrada = false and old.cerrada then
    if auth.uid() is not null and not public.es_gestor() then
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

-- ============================================================
-- 3. Políticas RLS con los nuevos nombres (alter policy: conserva el tipo de cada regla y se puede repetir)
-- ============================================================

-- profiles
alter policy profiles_upd on public.profiles
  using (id = auth.uid() or (area_id = public.mi_area() and public.es_admin()))
  with check (id = auth.uid() or (area_id = public.mi_area() and public.es_admin()));

-- listas
alter policy listas_ins on public.listas
  with check (area_id = public.mi_area() and public.es_gestor());
alter policy listas_upd on public.listas
  using (area_id = public.mi_area() and public.es_gestor());
alter policy listas_del on public.listas
  using (area_id = public.mi_area() and not sistema and public.es_gestor());

-- lista_valores
alter policy valores_ins on public.lista_valores
  with check (exists (select 1 from public.listas l where l.id = lista_id and l.area_id = public.mi_area())
              and public.es_gestor());
alter policy valores_upd on public.lista_valores
  using (exists (select 1 from public.listas l where l.id = lista_id and l.area_id = public.mi_area())
         and public.es_gestor());
alter policy valores_del on public.lista_valores
  using (exists (select 1 from public.listas l where l.id = lista_id and l.area_id = public.mi_area())
         and public.es_gestor());

-- parametros
alter policy parametros_ins on public.parametros
  with check (area_id = public.mi_area() and public.es_gestor());
alter policy parametros_upd on public.parametros
  using (area_id = public.mi_area() and public.es_gestor());

-- proyectos: crear_proyecto → esGestor; proponer_proyecto → puede('crear_cartera'); aprobar_proyecto → esGestor
alter policy proyectos_ins on public.proyectos
  with check (area_id = public.mi_area() and (
    public.es_gestor()
    or (public.puede('crear_cartera') and estado = 'propuesto' and propuesto_por = auth.uid())));
alter policy proyectos_upd on public.proyectos
  using (area_id = public.mi_area() and (
    public.es_gestor()
    or (estado = 'propuesto' and propuesto_por = auth.uid())))
  with check (area_id = public.mi_area() and (
    public.es_gestor()
    or (estado = 'propuesto' and propuesto_por = auth.uid())));

alter policy proy_lideres_all on public.proyecto_lideres
  using (public.es_gestor()
         and exists (select 1 from public.proyectos p where p.id = proyecto_id and p.area_id = public.mi_area()))
  with check (public.es_gestor()
         and exists (select 1 from public.proyectos p where p.id = proyecto_id and p.area_id = public.mi_area())
         and exists (select 1 from public.profiles u where u.id = usuario_id and u.area_id = public.mi_area()));

-- cartera: registrar_solicitud → crear_solicitud; aceptar_solicitudes → ver_solicitud
alter policy cartera_ins on public.cartera
  with check (area_id = public.mi_area() and (
    (public.es_staff() and origen = 'interna')
    or (public.puede('crear_solicitud') and origen = 'solicitud' and estado = 'nueva' and solicitante_id = auth.uid())));
alter policy cartera_upd on public.cartera
  using (area_id = public.mi_area() and (
    public.es_gestor() or responsable_id = auth.uid() or created_by = auth.uid()
    or (estado = 'nueva' and public.puede('ver_solicitud'))))
  with check (area_id = public.mi_area() and public.es_staff());

-- actividades: editar_actividades_otros → esGestor
alter policy act_ins on public.actividades
  with check (area_id = public.mi_area() and public.es_staff()
              and (responsable_id = auth.uid() or public.es_gestor()));
alter policy act_upd on public.actividades
  using (area_id = public.mi_area() and (responsable_id = auth.uid() or public.es_gestor()))
  with check (area_id = public.mi_area() and (responsable_id = auth.uid() or public.es_gestor()));
alter policy act_del on public.actividades
  using (area_id = public.mi_area() and (responsable_id = auth.uid() or public.es_gestor()));

-- cierres: cerrar_semana_otros → cerrar_semana; reabrir_semana → esGestor
alter policy cierres_ins on public.cierres
  with check (area_id = public.mi_area() and (responsable_id = auth.uid() or public.puede('cerrar_semana')));
alter policy cierres_upd on public.cierres
  using (area_id = public.mi_area() and (public.es_gestor()
         or ((responsable_id = auth.uid() or public.puede('cerrar_semana')) and not cerrada)));

-- pac_historico: importar_historico → importar_datos
alter policy pac_hist_all on public.pac_historico
  using (area_id = public.mi_area() and public.puede('importar_datos'))
  with check (area_id = public.mi_area() and public.puede('importar_datos'));

-- plantillas: gestionar_plantillas_servicio y editar_actividades_otros → esGestor
alter policy plant_all on public.plantillas
  using (area_id = public.mi_area() and ((tipo = 'recurrente' and propietario_id = auth.uid())
         or public.es_gestor()))
  with check (area_id = public.mi_area() and ((tipo = 'recurrente' and propietario_id = auth.uid())
         or public.es_gestor()));
alter policy plant_items_all on public.plantilla_items
  using (exists (select 1 from public.plantillas p where p.id = plantilla_id and p.area_id = public.mi_area()
         and ((p.tipo = 'recurrente' and p.propietario_id = auth.uid())
              or public.es_gestor())))
  with check (exists (select 1 from public.plantillas p where p.id = plantilla_id and p.area_id = public.mi_area()
         and ((p.tipo = 'recurrente' and p.propietario_id = auth.uid())
              or public.es_gestor())));

-- reuniones y acuerdos: gestionar_reuniones → esGestor
alter policy reun_all on public.reuniones
  using (area_id = public.mi_area() and public.es_gestor())
  with check (area_id = public.mi_area() and public.es_gestor());
alter policy acu_ins on public.acuerdos
  with check (area_id = public.mi_area() and public.es_gestor());
alter policy acu_upd on public.acuerdos
  using (area_id = public.mi_area() and (public.es_gestor() or responsable_id = auth.uid()));
alter policy acu_del on public.acuerdos
  using (area_id = public.mi_area() and public.es_gestor());

-- comentarios: comentar → esStaff (todos los miembros activos)
alter policy com_ins on public.comentarios
  with check (area_id = public.mi_area() and autor_id = auth.uid() and public.es_staff());
