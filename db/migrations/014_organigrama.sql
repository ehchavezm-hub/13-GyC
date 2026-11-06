-- LPS-GES · 014 · Organigrama del equipo (Configuración → Usuarios y roles)
-- Nodos de tipo "unidad" (área, especialidad) o "persona" (vinculada a un usuario), con su jefe/padre y posición en el lienzo.
create table if not exists public.organigrama_nodos (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.areas(id),
  tipo        text not null default 'persona' check (tipo in ('unidad','persona')),
  titulo      text,
  usuario_id  uuid references public.profiles(id) on delete set null,
  padre_id    uuid references public.organigrama_nodos(id) on delete set null,
  x           numeric,
  y           numeric,
  orden       integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists organigrama_nodos_area on public.organigrama_nodos (area_id);
create trigger trg_organigrama_updated before update on public.organigrama_nodos
  for each row execute function public.tg_set_updated_at();

alter table public.organigrama_nodos enable row level security;
create policy organigrama_sel on public.organigrama_nodos for select to authenticated
  using (area_id = public.mi_area() and public.es_miembro());
create policy organigrama_ins on public.organigrama_nodos for insert to authenticated
  with check (area_id = public.mi_area() and public.puede('gestionar_usuarios'));
create policy organigrama_upd on public.organigrama_nodos for update to authenticated
  using (area_id = public.mi_area() and public.puede('gestionar_usuarios'))
  with check (area_id = public.mi_area() and public.puede('gestionar_usuarios'));
create policy organigrama_del on public.organigrama_nodos for delete to authenticated
  using (area_id = public.mi_area() and public.puede('gestionar_usuarios'));

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.organigrama_nodos;
  end if;
end $$;

-- El respaldo completo incluye el organigrama
create or replace function public.exportar_respaldo() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb := jsonb_build_object('generado', now(), 'version', 1);
  v_tmp jsonb;
  t text;
  v_area uuid := public.mi_area();
  v_filtrar boolean := auth.uid() is not null;
  v_tiene_area boolean;
  v_rol_jwt text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                             nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
begin
  if not v_filtrar and v_rol_jwt is not null and v_rol_jwt <> 'service_role' then
    raise exception 'No autorizado.';
  end if;
  if v_filtrar and not (public.es_admin() and public.puede('exportar_respaldo')) then
    raise exception 'Solo el administrador puede exportar el respaldo completo.';
  end if;
  foreach t in array array['areas','profiles','listas','lista_valores','parametros','permisos','proyectos',
    'proyecto_lideres','hitos','cartera','actividades','restricciones','cierres','pac_historico','plantillas',
    'plantilla_items','ubicaciones_dia','reuniones','acuerdos','comentarios','enlaces','columnas_personalizadas',
    'vistas','solicitudes_cambio','delegado_historial','organigrama_nodos']
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
revoke execute on function public.exportar_respaldo() from public, anon;
grant execute on function public.exportar_respaldo() to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.exportar_respaldo() to service_role;
  end if;
end $$;
