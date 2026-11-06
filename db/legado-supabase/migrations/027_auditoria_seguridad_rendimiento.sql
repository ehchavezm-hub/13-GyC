-- LPS-GES · 027 · Auditoría: seguridad y rendimiento de la base de datos
-- 1. get_propietarios() (creada fuera de las migraciones) es SECURITY DEFINER y la podía ejecutar
--    cualquiera sin iniciar sesión (anon): exponía los perfiles completos de los propietarios.
--    La aplicación no la usa (los propietarios se leen por la Edge Function admin-usuarios).
-- 2. search_path fijo en funciones que no lo tenían.
-- 3. Políticas RLS: auth.uid() y funciones auxiliares envueltas en (select …) para que Postgres
--    las evalúe una sola vez por consulta y no una vez por fila (misma regla, menos costo).
-- 4. Índices para las llaves foráneas sin índice y retiro de dos índices duplicados.

-- 1 y 2 ---------------------------------------------------------------------------------
do $$ begin
  if to_regprocedure('public.get_propietarios()') is not null then
    revoke execute on function public.get_propietarios() from public, anon, authenticated;
    alter function public.get_propietarios() set search_path = public, pg_temp;
  end if;
  if to_regprocedure('public.set_updated_at()') is not null then
    alter function public.set_updated_at() set search_path = public, pg_temp;
  end if;
end $$;
alter function public.tg_set_updated_at() set search_path = public, pg_temp;

-- 3 -------------------------------------------------------------------------------------
alter policy profiles_upd on public.profiles
  using (id = (select auth.uid()) or (area_id = (select public.mi_area()) and (select public.es_admin())))
  with check (id = (select auth.uid()) or (area_id = (select public.mi_area()) and (select public.es_admin())));

alter policy proyectos_ins on public.proyectos
  with check (area_id = (select public.mi_area()) and (
    (select public.es_gestor())
    or ((select public.puede('crear_cartera')) and estado = 'propuesto' and propuesto_por = (select auth.uid()))));
alter policy proyectos_upd on public.proyectos
  using (area_id = (select public.mi_area()) and (
    (select public.es_gestor()) or (estado = 'propuesto' and propuesto_por = (select auth.uid()))))
  with check (area_id = (select public.mi_area()) and (
    (select public.es_gestor()) or (estado = 'propuesto' and propuesto_por = (select auth.uid()))));

alter policy cartera_ins on public.cartera
  with check (area_id = (select public.mi_area()) and (
    ((select public.es_staff()) and origen = 'interna')
    or ((select public.puede('crear_solicitud')) and origen = 'solicitud' and estado = 'nueva'
        and solicitante_id = (select auth.uid()))));
alter policy cartera_upd on public.cartera
  using (area_id = (select public.mi_area()) and (
    (select public.es_gestor()) or responsable_id = (select auth.uid()) or created_by = (select auth.uid())
    or (estado = 'nueva' and (select public.puede('ver_solicitud')))))
  with check (area_id = (select public.mi_area()) and (select public.es_staff()));

alter policy act_ins on public.actividades
  with check (area_id = (select public.mi_area()) and (select public.es_staff())
              and (responsable_id = (select auth.uid()) or (select public.es_gestor())));
alter policy act_upd on public.actividades
  using (area_id = (select public.mi_area()) and (responsable_id = (select auth.uid()) or (select public.es_gestor())))
  with check (area_id = (select public.mi_area()) and (responsable_id = (select auth.uid()) or (select public.es_gestor())));
alter policy act_del on public.actividades
  using (area_id = (select public.mi_area()) and (responsable_id = (select auth.uid()) or (select public.es_gestor())));

alter policy cierres_ins on public.cierres
  with check (area_id = (select public.mi_area())
              and (responsable_id = (select auth.uid()) or (select public.puede('cerrar_semana'))));
alter policy cierres_upd on public.cierres
  using (area_id = (select public.mi_area()) and ((select public.es_gestor())
         or ((responsable_id = (select auth.uid()) or (select public.puede('cerrar_semana'))) and not cerrada)));

alter policy plant_all on public.plantillas
  using (area_id = (select public.mi_area()) and ((tipo = 'recurrente' and propietario_id = (select auth.uid()))
         or (select public.es_gestor())))
  with check (area_id = (select public.mi_area()) and ((tipo = 'recurrente' and propietario_id = (select auth.uid()))
         or (select public.es_gestor())));
alter policy plant_items_all on public.plantilla_items
  using (exists (select 1 from public.plantillas p where p.id = plantilla_id and p.area_id = (select public.mi_area())
         and ((p.tipo = 'recurrente' and p.propietario_id = (select auth.uid())) or (select public.es_gestor()))))
  with check (exists (select 1 from public.plantillas p where p.id = plantilla_id and p.area_id = (select public.mi_area())
         and ((p.tipo = 'recurrente' and p.propietario_id = (select auth.uid())) or (select public.es_gestor()))));

alter policy acu_upd on public.acuerdos
  using (area_id = (select public.mi_area()) and ((select public.es_gestor()) or responsable_id = (select auth.uid())));

alter policy com_ins on public.comentarios
  with check (area_id = (select public.mi_area()) and autor_id = (select auth.uid()) and (select public.es_staff()));

-- 4 -------------------------------------------------------------------------------------
-- Índice para cada llave foránea de public que no tenga uno que empiece por sus columnas.
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tabla, c.conname,
           string_agg(quote_ident(a.attname), ', ' order by k.n) as cols
      from pg_constraint c
      join pg_namespace ns on ns.oid = c.connamespace and ns.nspname = 'public'
      cross join lateral unnest(c.conkey) with ordinality k(attnum, n)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
     where c.contype = 'f'
       and not exists (select 1 from pg_index i
                        where i.indrelid = c.conrelid
                          and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey)
     group by c.conrelid, c.conname
  loop
    execute format('create index if not exists %I on %s (%s)', left('fk_' || r.conname, 63), r.tabla, r.cols);
  end loop;
end $$;

drop index if exists public.idx_comentarios_entidad;
drop index if exists public.idx_enlaces_entidad;
