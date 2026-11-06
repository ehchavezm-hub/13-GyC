-- LPS-GES · 028 · Vista personal automática ("__auto__") sin duplicados (pedido 21: velocidad)
-- La grilla la volvía a escribir en cada carga de datos y, si se adelantaba a la lectura, creaba otra fila.
-- Se conserva la más reciente de cada persona y grilla, y un índice único impide que se repita.
delete from public.vistas v
 using public.vistas w
 where v.nombre = '__auto__' and w.nombre = '__auto__'
   and v.area_id = w.area_id and v.usuario_id = w.usuario_id and v.grilla = w.grilla
   and (v.updated_at, v.id) < (w.updated_at, w.id);
create unique index if not exists vistas_auto_unica on public.vistas (area_id, usuario_id, grilla) where nombre = '__auto__';
