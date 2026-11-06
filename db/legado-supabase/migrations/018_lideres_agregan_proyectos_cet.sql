-- LPS-GES · 018_lideres_agregan_proyectos_cet.sql
-- Pedido 100: los líderes pueden agregar proyectos y CET / Servicio sin pasar por el administrador.
-- Dos permisos nuevos en la matriz (editables por el administrador en Configuración → Permisos):
--   · agregar_proyecto: agrega proyectos activos al menú y edita los que agregó. No elimina ni desactiva
--     otros proyectos (eso sigue en "crear_proyecto").
--   · agregar_cet: agrega valores a la lista "CET / Servicio" (Proyecto, CET y Servicio). Editar o eliminar
--     valores sigue en "gestionar_listas".
-- Por defecto: Administrador, Delegado, Responsable del equipo, Líder de especialidad y Responsable de proceso.
-- Se puede ejecutar más de una vez (alter policy: modifica las reglas existentes).

set client_min_messages = warning;

insert into public.permisos (area_id, rol, accion, permitido)
select a.id, r.rol, x.accion, r.rol in ('admin', 'delegado', 'resp_equipo', 'lider', 'resp_proceso')
  from public.areas a
 cross join (values ('admin'), ('delegado'), ('resp_equipo'), ('lider'), ('resp_proceso'), ('resp_actividad'), ('consulta')) r(rol)
 cross join (values ('agregar_proyecto'), ('agregar_cet')) x(accion)
on conflict do nothing;

-- Proyectos: alta directa (activa) y edición de los propios
alter policy proyectos_ins on public.proyectos
  with check (area_id = (select public.mi_area()) and (
    (select public.puede('crear_proyecto'))
    or ((select public.puede('agregar_proyecto')) and estado = 'activo')
    or ((select public.puede('proponer_proyecto')) and estado = 'propuesto' and propuesto_por = (select auth.uid()))));

alter policy proyectos_upd on public.proyectos
  using (area_id = (select public.mi_area()) and (
    (select public.puede('crear_proyecto')) or (select public.puede('aprobar_proyecto'))
    or ((select public.puede('agregar_proyecto')) and created_by = (select auth.uid()))
    or (estado = 'propuesto' and propuesto_por = (select auth.uid()))))
  with check (area_id = (select public.mi_area()) and (
    (select public.puede('crear_proyecto')) or (select public.puede('aprobar_proyecto'))
    or ((select public.puede('agregar_proyecto')) and created_by = (select auth.uid()) and estado in ('activo', 'en_pausa'))
    or (estado = 'propuesto' and propuesto_por = (select auth.uid()))));

-- CET / Servicio: alta de valores
alter policy valores_ins on public.lista_valores
  with check (exists (select 1 from public.listas l where l.id = lista_id and l.area_id = (select public.mi_area())
                       and ((select public.puede('gestionar_listas'))
                            or ((select public.puede('agregar_cet')) and l.clave = 'servicios' and not lista_valores.protegido))));
