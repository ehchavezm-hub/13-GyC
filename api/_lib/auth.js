import { createClerkClient } from '@clerk/backend';
import { query } from './db.js';

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

let _clerk = null;
function getClerk() {
  if (!_clerk) {
    if (!process.env.CLERK_SECRET_KEY) throw new AuthError('CLERK_SECRET_KEY no configurada', 500);
    _clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  }
  return _clerk;
}

/**
 * Verifica el JWT de Clerk en la cabecera Authorization y devuelve el perfil del usuario.
 * Si el perfil no existe lo crea con rol 'pendiente'.
 * @param {Request} req  objeto Request de Vercel (Node http.IncomingMessage)
 * @returns {Promise<{id: string, rol: string, area_id: string|null, activo: boolean}>}
 * @throws {AuthError}
 */
export async function verificarAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) throw new AuthError('No autenticado');

  let payload;
  try {
    const clerk = getClerk();
    const result = await clerk.verifyToken(token);
    payload = result;
  } catch {
    throw new AuthError('Token inválido');
  }

  const clerkId = payload.sub;
  if (!clerkId) throw new AuthError('Token sin subject');

  // Buscar perfil existente
  const rows = await query(
    `SELECT id, rol, area_id, activo FROM profiles WHERE id = $1`,
    [clerkId]
  );

  if (rows.length) return rows[0];

  // Auto-crear perfil con rol pendiente (el admin le asignará rol y área)
  const clerk = getClerk();
  const user = await clerk.users.getUser(clerkId);
  const nombre = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.emailAddresses[0]?.emailAddress || clerkId;
  const email = user.emailAddresses[0]?.emailAddress || null;

  await query(
    `INSERT INTO profiles (id, nombre, email, rol, activo)
     VALUES ($1, $2, $3, 'pendiente', true)
     ON CONFLICT (id) DO NOTHING`,
    [clerkId, nombre, email]
  );

  const nuevo = await query(
    `SELECT id, rol, area_id, activo FROM profiles WHERE id = $1`,
    [clerkId]
  );
  if (!nuevo.length) throw new AuthError('No se pudo crear el perfil', 500);
  return nuevo[0];
}
