-- LPS-GES · 029 · Auditoría 2: reglas RLS sin duplicar y search_path de tg_proteger_valor
-- 1. tg_proteger_valor (reescrita en 025) quedó sin search_path fijo.
-- 2. En 11 tablas una regla «para todo» (FOR ALL) también permitía leer, y se evaluaba junto con la regla de lectura
--    (*_sel) en cada consulta. Se reemplaza por reglas de alta, cambio y baja con las MISMAS condiciones (se copian de
--    la base, no se reescriben a mano); la lectura queda a cargo de *_sel, que ya cubre a quien podía escribir.
--    Excepción revisada: en ubicaciones_dia cada persona sigue pudiendo leer las suyas.
-- 3. areas: las dos reglas de lectura (la propia empresa y los propietarios de la plataforma) en una sola.
-- Se puede ejecutar más de una vez.

alter function public.tg_proteger_valor() set search_path = public, pg_temp;

do $$
declare
  r record;
  base text;
begin
  for r in
    select tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public' and cmd = 'ALL'
       and policyname in ('col_all', 'hitos_all', 'pac_hist_all', 'plant_items_all', 'plant_all', 'portafolios_gestion',
                          'programas_gestion', 'proy_lideres_all', 'reun_all', 'ubic_all', 'vistas_all')
  loop
    base := regexp_replace(r.policyname, '_(all|gestion)$', '');
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', base || '_ins', r.tablename, coalesce(r.with_check, r.qual));
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', base || '_upd', r.tablename, r.qual, coalesce(r.with_check, r.qual));
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', base || '_del', r.tablename, r.qual);
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Ubicaciones: además del equipo (es_staff), cada persona lee las suyas (lo permitía la regla «para todo»)
alter policy ubic_sel on public.ubicaciones_dia
  using (area_id = (select public.mi_area()) and ((select public.es_staff()) or usuario_id = (select auth.uid())));

-- Empresas: una sola regla de lectura
do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'areas' and policyname = 'areas_sel_plataforma') then
    drop policy areas_sel_plataforma on public.areas;
    alter policy areas_sel on public.areas using (id = (select public.mi_area()) or (select public.es_plataforma()));
  end if;
end $$;
