-- LPS-GES · 008 · Grupos de listas (para ordenarlas en Configuración → Listas). Editable desde el aplicativo.
alter table public.listas add column if not exists grupo text;

update public.listas set grupo = case
  when clave in ('gerencias','servicios','categorias_servicio','cet','tipos_proyecto','fases','paises')
    then 'Gerencias, proyectos y servicios'
  when clave in ('cnc','tipos_restriccion','criticidad','tipos_cartera','ubicaciones')
    then 'Detalle de actividades y seguimiento'
  when clave in ('estados_compromiso','tipos_actividad','estados_la','estados_proyecto','estados_restriccion','estados_cartera')
    then 'Configuración general del aplicativo'
  else 'Otras listas' end
where grupo is null;
