import { verifyToken, createClerkClient } from '@clerk/backend';
import { query } from './db.js';

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export const GESTORES = ['superadmin', 'admin', 'delegado'];
export const esGestor = p => GESTORES.includes(p?.rol);
export const esAdmin = p => ['superadmin', 'admin'].includes(p?.rol) || !!p?.es_admin_principal;
export const esSuper = p => p?.rol === 'superadmin' || !!p?.es_admin_principal;

/** Perfil activo con rol asignado (no pendiente, no eliminado). */
export const habilitado = p => !!p && p.activo && !p.eliminado && p.rol !== 'pendiente';

export function clerk() {
  if (!process.env.CLERK_SECRET_KEY) throw new AuthError('CLERK_SECRET_KEY no configurada', 500);
  return createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
}

// Solo pruebas: reemplaza la verificación del JWT de Clerk
let _verificar = null;
export function usarVerificador(fn) { _verificar = fn; }

async function sujetoDelToken(token) {
  if (_verificar) return _verificar(token);
  if (!process.env.CLERK_SECRET_KEY && !process.env.CLERK_JWT_KEY) {
    throw new AuthError('Falta CLERK_SECRET_KEY (o CLERK_JWT_KEY) en las variables de entorno de Vercel.', 500);
  }
  // Con CLERK_JWT_KEY (clave PEM del JWKS) la verificación no hace llamadas de red; si no, usa CLERK_SECRET_KEY.
  const payload = await verifyToken(token, {
    secretKey: process.env.CLERK_SECRET_KEY,
    jwtKey: process.env.CLERK_JWT_KEY,
  });
  return payload.sub;
}

/** Verifica el JWT de Clerk y devuelve el perfil completo (lo crea la primera vez). */
export async function verificarAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) throw new AuthError('No autenticado');

  let clerkId;
  try {
    clerkId = await sujetoDelToken(token);
  } catch (e) {
    if (e instanceof AuthError) throw e;
    console.error('[auth] verifyToken error:', e?.message ?? e);
    throw new AuthError('Token inválido');
  }
  if (!clerkId) throw new AuthError('Token sin subject');

  const rows = await query(`SELECT * FROM profiles WHERE id = $1`, [clerkId]);
  if (rows.length) return rows[0];

  // Primera vez: nombre y correo desde Clerk; el alta (rol, empresa) la decide la base (gyc_alta_usuario)
  let nombre = '';
  let email = null;
  if (process.env.CLERK_SECRET_KEY && !_verificar) {
    try {
      const user = await clerk().users.getUser(clerkId);
      email = user.primaryEmailAddress?.emailAddress || user.emailAddresses[0]?.emailAddress || null;
      nombre = [user.firstName, user.lastName].filter(Boolean).join(' ') || email || '';
    } catch (e) {
      console.error('[auth] getUser error:', e?.message ?? e);
    }
  }
  const [nuevo] = await query(`SELECT * FROM gyc_alta_usuario($1, $2, $3)`, [clerkId, nombre, email], clerkId);
  if (!nuevo) throw new AuthError('No se pudo crear el perfil', 500);
  return nuevo;
}

/** Lee el cuerpo JSON de la petición (Vercel ya lo trae en req.body si el Content-Type es JSON). */
export async function leerCuerpo(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
