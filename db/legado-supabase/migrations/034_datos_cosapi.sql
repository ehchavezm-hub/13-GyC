-- 034_datos_cosapi.sql
-- Estructura inicial Cosapi: área, portafolio, programa, proyecto.
-- Los usuarios (profiles) se crean desde la interfaz de administración
-- una vez que tengan cuentas en Clerk.
-- Ejecutar en Neon SQL Editor con permisos de dueño de esquema.

DO $$
DECLARE
  v_area_id UUID;
  v_port_id UUID;
  v_prog_id UUID;
  v_proy_id UUID;
BEGIN

  -- ── Área (empresa) ────────────────────────────────────────────────────────
  INSERT INTO areas (nombre, activa)
  VALUES ('Cosapi', true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_area_id;

  IF v_area_id IS NULL THEN
    SELECT id INTO v_area_id FROM areas WHERE nombre = 'Cosapi' LIMIT 1;
  END IF;

  -- ── Portafolio ────────────────────────────────────────────────────────────
  INSERT INTO portafolios (nombre, area_id, activo)
  VALUES ('Obras Edificaciones', v_area_id, true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_port_id;

  IF v_port_id IS NULL THEN
    SELECT id INTO v_port_id FROM portafolios
    WHERE nombre = 'Obras Edificaciones' AND area_id = v_area_id LIMIT 1;
  END IF;

  -- ── Programa ──────────────────────────────────────────────────────────────
  INSERT INTO programas (nombre, portafolio_id, area_id, activo)
  VALUES ('Hospitales', v_port_id, v_area_id, true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_prog_id;

  IF v_prog_id IS NULL THEN
    SELECT id INTO v_prog_id FROM programas
    WHERE nombre = 'Hospitales' AND portafolio_id = v_port_id LIMIT 1;
  END IF;

  -- ── Proyecto ──────────────────────────────────────────────────────────────
  INSERT INTO proyectos (nombre, programa_id, portafolio_id, area_id, estado)
  VALUES ('Hospital Azángaro - Puno', v_prog_id, v_port_id, v_area_id, 'activo')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_proy_id;

  IF v_proy_id IS NULL THEN
    SELECT id INTO v_proy_id FROM proyectos
    WHERE nombre = 'Hospital Azángaro - Puno' AND area_id = v_area_id LIMIT 1;
  END IF;

  RAISE NOTICE 'Datos Cosapi creados:';
  RAISE NOTICE '  area_id    = %', v_area_id;
  RAISE NOTICE '  port_id    = %', v_port_id;
  RAISE NOTICE '  prog_id    = %', v_prog_id;
  RAISE NOTICE '  proy_id    = %', v_proy_id;
  RAISE NOTICE '';
  RAISE NOTICE 'SIGUIENTE PASO: crear usuarios desde la interfaz de administración.';
  RAISE NOTICE 'Usuarios necesarios (email → rol en la empresa):';
  RAISE NOTICE '  echavez@cosapi.com.pe   → superadmin';
  RAISE NOTICE '  nbolivar@cosapi.com.pe  → superadmin';
  RAISE NOTICE '  fmuro@cosapi.com.pe     → admin  (líder Hospital Azángaro)';
  RAISE NOTICE '  cmachuca@cosapi.com.pe  → lider  (Hospital Azángaro)';
  RAISE NOTICE '  jcruzp@cosapi.com.pe    → lider  (Hospital Azángaro)';
  RAISE NOTICE '  mavalos@cosapi.com.pe   → lider  (Hospital Azángaro)';
  RAISE NOTICE '  jsantana@cosapi.com.pe  → lider  (Hospital Azángaro)';
  RAISE NOTICE '  eespinoza@cosapi.com.pe → lider  (Hospital Azángaro)';

END $$;
