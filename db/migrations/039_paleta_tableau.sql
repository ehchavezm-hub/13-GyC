-- GyC · 039_paleta_tableau.sql
-- Colores de las listas (estados, prioridades, ubicaciones…) según la paleta Tableau Professional Analytics
-- (PALETAS_tableau.pptx). Todo color que no sea de la paleta pasa al color de la paleta más parecido.
-- Ejecutar en el SQL Editor de Neon después de la 038. Se puede ejecutar más de una vez.

set client_min_messages = warning;

create or replace function public.gyc_color_paleta(p_color text) returns text
language plpgsql immutable as $$
declare
  v_paleta text[] := array['#E8762B','#4E79A7','#F28E2B','#E15759','#76B7B2','#59A14F','#EDC948','#B07AA1',
                           '#FF9DA7','#BAB0AC','#003366','#1F77B4','#2ECC71','#E74C3C','#1A1A2E'];
  v_c text := upper(trim(p_color));
  v_mejor text; v_d int; v_min int := 1e9; p text;
  r int; g int; b int;
begin
  if v_c is null or v_c = '' then return null; end if;
  if v_c = any(v_paleta) then return v_c; end if;
  if v_c ~ '^#[0-9A-F]{3}$' then v_c := '#' || repeat(substr(v_c,2,1),2) || repeat(substr(v_c,3,1),2) || repeat(substr(v_c,4,1),2); end if;
  if v_c !~ '^#[0-9A-F]{6}$' then return '#BAB0AC'; end if;
  r := ('x' || substr(v_c,2,2))::bit(8)::int; g := ('x' || substr(v_c,4,2))::bit(8)::int; b := ('x' || substr(v_c,6,2))::bit(8)::int;
  foreach p in array v_paleta loop
    v_d := (r - ('x' || substr(p,2,2))::bit(8)::int)^2 + (g - ('x' || substr(p,4,2))::bit(8)::int)^2 + (b - ('x' || substr(p,6,2))::bit(8)::int)^2;
    if v_d < v_min then v_min := v_d; v_mejor := p; end if;
  end loop;
  return v_mejor;
end $$;

-- Grises neutros: Silver (#BAB0AC) es el neutro de la paleta para datos
update public.lista_valores set color = '#BAB0AC' where upper(color) in ('#9E9E9E','#999999','#888888','#AAAAAA','#CCCCCC','#808080');
update public.lista_valores set color = public.gyc_color_paleta(color)
 where color is not null and color <> public.gyc_color_paleta(color);

do $$
begin
  assert not exists (select 1 from public.lista_valores where color is not null and color <> public.gyc_color_paleta(color)),
    'Quedaron colores fuera de la paleta';
  raise notice '✓ Migración 039_paleta_tableau ejecutada correctamente.';
end $$;
