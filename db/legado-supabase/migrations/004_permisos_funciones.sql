-- LPS-GES · 004 · Permisos de ejecución de funciones sensibles
-- Supabase concede EXECUTE a anon y authenticated sobre toda función nueva de "public".
-- Las funciones de mantenimiento y respaldo no deben poder llamarse con la clave pública (anon).

-- Respaldo: solo usuarios autenticados (la función exige rol admin) y service_role (GitHub Actions).
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
  -- Sin usuario solo se permite a service_role o a una sesión directa de base de datos (sin JWT)
  if not v_filtrar and v_rol_jwt is not null and v_rol_jwt <> 'service_role' then
    raise exception 'No autorizado.';
  end if;
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

revoke execute on function public.exportar_respaldo() from public, anon;
grant execute on function public.exportar_respaldo() to authenticated;

-- Mantenimiento: solo service_role (pg_cron corre como postgres y no necesita permiso)
revoke execute on function public.cerrar_semanas_vencidas() from public, anon, authenticated;
revoke execute on function public.sembrar_area(uuid) from public, anon, authenticated;
revoke execute on function public.sembrar_lista(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.notificar_gestores(uuid, text, text, text) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.exportar_respaldo() to service_role;
    grant execute on function public.cerrar_semanas_vencidas() to service_role;
  end if;
end $$;
