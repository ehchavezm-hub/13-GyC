-- LPS-GES · 011 · Eliminar proyectos
-- Solo quien puede crear proyectos, y solo si el proyecto no tiene historial: las actividades, la cartera,
-- las restricciones y las plantillas que lo usan lo impiden (clave foránea). Para esos casos se desactiva (estado "cerrado").
drop policy if exists proyectos_del on public.proyectos;
create policy proyectos_del on public.proyectos for delete to authenticated
  using (area_id = public.mi_area() and public.puede('crear_proyecto'));
