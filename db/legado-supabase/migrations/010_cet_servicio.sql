-- LPS-GES · 010 · "Servicios / Entregables" y "CET" son lo mismo: una sola lista "CET / Servicio"
-- Se conserva la lista de servicios (sus valores y datos). La lista CET deja de mostrarse en el aplicativo;
-- sus valores no se borran porque actividades antiguas pueden referirlos.
update public.listas set nombre = 'CET / Servicio' where clave = 'servicios' and nombre = 'Servicios / Entregables';
update public.listas set grupo = 'Listas retiradas', descripcion = 'Fusionada con "CET / Servicio" (no se muestra).' where clave = 'cet';
