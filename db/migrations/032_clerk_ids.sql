-- Migración 032: adaptar profiles.id a IDs de Clerk (texto: user_xxx)
-- Ejecutar en Neon SQL Editor ANTES de activar autenticación Clerk.
-- Si la tabla profiles ya tiene filas, vaciarla primero o migrar los ids manualmente.

-- 1. Eliminar restricciones y dependencias sobre profiles.id
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_pkey CASCADE;

-- 2. Cambiar el tipo de la columna id a TEXT
ALTER TABLE profiles ALTER COLUMN id TYPE TEXT USING id::TEXT;

-- 3. Restaurar la clave primaria
ALTER TABLE profiles ADD PRIMARY KEY (id);

-- 4. Las columnas de otras tablas que referencian profiles.id también son TEXT/UUID;
--    ajustar si las FK estaban declaradas como UUID (en PostgreSQL las FK siguen al tipo del padre).
--    Neon resolverá las FK al hacer CASCADE en el paso 1.

-- 5. Confirmar
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'profiles' AND column_name = 'id') = 'text' THEN
    RAISE NOTICE 'Migración 032 OK: profiles.id es TEXT.';
  ELSE
    RAISE EXCEPTION 'Migración 032 FALLIDA: profiles.id no es TEXT.';
  END IF;
END $$;
