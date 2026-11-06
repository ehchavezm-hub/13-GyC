import { verifyToken, createClerkClient } from '@clerk/backend';
import { query } from './db.js';

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export async function verificarAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) throw new AuthError('No autenticado');

  let payload;
  try {
    // verifyToken usa JWKS público del emisor del JWT (Clerk frontend API).
    // secretKey es opcional: si no está, igual funciona la verificación criptográfica.
    payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
  } catch (e) {
    console.error('[auth] verifyToken error:', e?.message ?? e);
    throw new AuthError('Token inválido');
  }

  const clerkId = payload.sub;
  if (!clerkId) throw new AuthError('Token sin subject');

  const rows = await query(
    `SELECT id, rol, area_id, activo FROM profiles WHERE id = $1`,
    [clerkId]
  );
  if (rows.length) return rows[0];

  // Auto-crear perfil con rol pendiente
  let nombre = clerkId;
  let email = null;
  if (process.env.CLERK_SECRET_KEY) {
    try {
      const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
      const user = await clerk.users.getUser(clerkId);
      nombre = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.emailAddresses[0]?.emailAddress || clerkId;
      email = user.emailAddresses[0]?.emailAddress || null;
    } catch (e) {
      console.error('[auth] getUser error:', e?.message ?? e);
    }
  }

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
