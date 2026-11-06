-- LPS-GES · 017_disparadores_sin_api.sql
-- Asesor de seguridad de Supabase (pedido 98): las funciones de disparador (tg_*) solo las usa la base;
-- no deben poder invocarse como API (/rest/v1/rpc/tg_...). Se retira EXECUTE a anon y authenticated.
-- Los disparadores siguen funcionando: Postgres no exige ese permiso a quien modifica la tabla.
-- Las funciones de apoyo de las políticas (puede, mi_area, mi_rol…) y las RPC de la app
-- (eliminar_usuario, exportar_respaldo…) conservan el permiso: lo necesitan y validan permisos por dentro.

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as firma from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.firma);
  end loop;
end $$;
