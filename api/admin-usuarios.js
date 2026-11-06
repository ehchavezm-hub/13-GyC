import { createClerkClient } from '@clerk/backend';
import { query } from './_lib/db.js';
import { verificarAuth, AuthError } from './_lib/auth.js';

const ROLES = ['lider', 'consulta', 'delegado', 'admin', 'superadmin', 'pendiente'];
const GESTORES = ['superadmin', 'admin', 'delegado'];

function getClerk() {
  if (!process.env.CLERK_SECRET_KEY) throw new AuthError('CLERK_SECRET_KEY no configurada', 500);
  return createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

  let perfil;
  try { perfil = await verificarAuth(req); }
  catch (e) { return res.status(e instanceof AuthError ? e.status : 401).json({ error: e.message }); }

  let d = {};
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    d = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  } catch { return res.status(400).json({ error: 'JSON inválido' }); }

  try {
    const result = await atender(perfil, d);
    res.status(200).json(result);
  } catch (e) {
    const st = e instanceof AuthError ? e.status : 400;
    res.status(st).json({ error: e.message });
  }
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

async function atender(yo, d) {
  const { accion } = d;

  // Mejoras: cualquier usuario activo
  if (accion === 'mejoras' || accion === 'gestionar_mejora') {
    if (!yo.activo || yo.rol === 'pendiente') throw new AuthError('No autorizado.', 403);
    return accionMejoras(yo, d);
  }

  // Varias empresas
  if (accion === 'mis_empresas') return accionMisEmpresas(yo);
  if (accion === 'cambiar_empresa') return accionCambiarEmpresa(yo, d);

  // Creación de cuenta desde traer-demo (no requiere permiso de gestión, llega del superadmin que importa)
  if (accion === 'crear_cuenta') {
    if (!yo.activo || !['superadmin', 'admin'].includes(yo.rol)) throw new AuthError('No autorizado.', 403);
    return accionCrearCuenta(yo, d);
  }

  // Resto requiere permiso gestionar_usuarios
  const [permRow] = await query(
    `SELECT puede($1, 'gestionar_usuarios') AS ok`, [yo.id]
  ).catch(() => [{ ok: false }]);
  if (!yo.activo || !permRow?.ok) throw new AuthError('No tiene permiso para gestionar usuarios.', 403);

  if (accion === 'crear') return accionCrear(yo, d);
  if (accion === 'clave') return accionClave(yo, d);

  throw new Error('Acción no válida.');
}

// ── Acciones ─────────────────────────────────────────────────────────────────

async function accionCrearCuenta(yo, { email, nombre, clave }) {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Correo no válido.');
  if (!nombre) throw new Error('Indique el nombre.');
  if (!clave || clave.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');

  const clerk = getClerk();
  const partes = nombre.trim().split(/\s+/);
  const firstName = partes[0] || '';
  const lastName = partes.slice(1).join(' ') || '';

  let clerkUser;
  try {
    clerkUser = await clerk.users.createUser({
      emailAddress: [email.trim().toLowerCase()],
      password: clave,
      firstName, lastName,
    });
  } catch (e) {
    const msg = e?.errors?.[0]?.message || e.message || String(e);
    throw new Error(msg);
  }

  const id = clerkUser.id;
  await query(
    `INSERT INTO profiles (id, nombre, email, rol, area_id, activo, debe_cambiar_clave)
     VALUES ($1, $2, $3, 'pendiente', $4, true, true)
     ON CONFLICT (id) DO UPDATE SET nombre=$2, email=$3`,
    [id, nombre.trim(), email.trim().toLowerCase(), yo.area_id]
  );

  return { id };
}

async function accionCrear(yo, { email, nombre, rol, clave, codigo, cargo_id, gerencia_ids, horas_dia, area_id: areaDestParam }) {
  email = String(email ?? '').trim().toLowerCase();
  nombre = String(nombre ?? '').trim();
  rol = String(rol ?? 'lider');
  clave = String(clave ?? '');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Correo no válido.');
  if (!nombre) throw new Error('Indique el nombre.');
  if (!ROLES.includes(rol)) throw new Error('Rol no válido.');
  if (clave.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');

  const soySuper = yo.rol === 'superadmin' || yo.es_admin_principal;
  if (GESTORES.includes(rol) && !soySuper) throw new AuthError('Solo el super administrador asigna roles de gestión.', 403);

  const areaDestino = yo.es_plataforma && areaDestParam ? String(areaDestParam) : yo.area_id;
  const clerk = getClerk();
  const partes = nombre.split(/\s+/);

  let clerkUser;
  try {
    clerkUser = await clerk.users.createUser({
      emailAddress: [email],
      password: clave,
      firstName: partes[0] || '',
      lastName: partes.slice(1).join(' ') || '',
    });
  } catch (e) {
    const msg = e?.errors?.[0]?.message || e.message || String(e);
    if (!/already|registered|exists/i.test(msg)) throw new Error(msg);
    // Usuario ya existe en Clerk: buscar en profiles
    const [existente] = await query(`SELECT id, area_id FROM profiles WHERE email = $1`, [email]);
    if (!existente) throw new Error('Ya existe una cuenta con ese correo, pero no está disponible.');
    throw new Error('Ya existe un usuario con ese correo. Use la acción de asignar empresa.');
  }

  const id = clerkUser.id;
  const datosExtra = { nombre, rol, area_id: areaDestino, debe_cambiar_clave: true };
  if (codigo) datosExtra.codigo = String(codigo).trim();
  if (cargo_id) datosExtra.cargo_id = String(cargo_id);
  if (Array.isArray(gerencia_ids)) datosExtra.gerencia_ids = JSON.stringify(gerencia_ids);
  if (horas_dia != null && horas_dia !== '') datosExtra.horas_dia = Number(horas_dia);

  const cols = Object.keys(datosExtra);
  const ph = cols.map((_, i) => `$${i + 2}`).join(',');
  await query(
    `INSERT INTO profiles (id, email, ${cols.join(',')}) VALUES ($1, $${cols.length + 2}, ${ph})
     ON CONFLICT (id) DO UPDATE SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(',')}`,
    [id, ...Object.values(datosExtra), email]
  );

  return { id };
}

async function accionClave(yo, { usuario_id, clave }) {
  clave = String(clave ?? '');
  if (clave.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');

  const [obj] = await query(`SELECT id, rol, area_id, es_admin_principal FROM profiles WHERE id = $1`, [String(usuario_id ?? '')]);
  if (!obj || obj.area_id !== yo.area_id) throw new AuthError('Usuario no encontrado.', 404);

  const soySuper = yo.rol === 'superadmin' || yo.es_admin_principal;
  if (obj.id !== yo.id && (obj.es_admin_principal || (GESTORES.includes(obj.rol) && !soySuper))) {
    throw new AuthError('No puede restablecer la contraseña de ese usuario.', 403);
  }

  const clerk = getClerk();
  try {
    await clerk.users.updateUser(obj.id, { password: clave });
  } catch (e) {
    throw new Error(e?.errors?.[0]?.message || e.message || String(e));
  }

  await query(`UPDATE profiles SET debe_cambiar_clave=$1 WHERE id=$2`, [obj.id !== yo.id, obj.id]);
  return { ok: true };
}

async function accionMisEmpresas(yo) {
  const miembros = await query(
    `SELECT area_id, rol FROM empresa_miembros WHERE usuario_id = $1 AND activo = true`,
    [yo.id]
  ).catch(() => []);
  const ids = [...new Set([...miembros.map(m => m.area_id), yo.area_id].filter(Boolean))];
  const areas = ids.length
    ? await query(`SELECT id, nombre, activa FROM areas WHERE id = ANY($1::text[])`, [ids])
    : [];
  return {
    actual: yo.area_id,
    empresas: areas.map(a => ({
      id: a.id, nombre: a.nombre, activa: a.activa !== false,
      rol: miembros.find(m => m.area_id === a.id)?.rol ?? yo.rol,
    })),
  };
}

async function accionCambiarEmpresa(yo, { area_id }) {
  const destino = String(area_id ?? '');
  if (destino === yo.area_id) return { ok: true };
  await query(`SELECT cambiar_empresa_activa($1, $2)`, [yo.id, destino]);
  return { ok: true };
}

async function accionMejoras(yo, d) {
  if (d.accion === 'mejoras') {
    const items = await query(`SELECT * FROM mejoras ORDER BY created_at DESC LIMIT 500`);
    const autorIds = [...new Set(items.map(s => s.autor_id).filter(Boolean))];
    const [perfiles, areas] = await Promise.all([
      autorIds.length ? query(`SELECT id, nombre FROM profiles WHERE id = ANY($1::text[])`, [autorIds]) : [],
      query(`SELECT id, nombre FROM areas`),
    ]);
    const nom = new Map(perfiles.map(p => [p.id, p.nombre]));
    const areaNom = new Map(areas.map(a => [a.id, a.nombre]));
    return items.map(s => ({ ...s, autor_nombre: nom.get(s.autor_id) || null, area_nombre: areaNom.get(s.area_id) || null }));
  }
  if (d.accion === 'gestionar_mejora') {
    const { id, estado, respuesta: resp } = d;
    if (!['superadmin', 'admin'].includes(yo.rol) && !yo.es_plataforma) throw new AuthError('No autorizado.', 403);
    const fields = [], vals = [];
    if (estado) { fields.push(`estado=$${vals.push(estado)}`); }
    if (resp !== undefined) { fields.push(`respuesta=$${vals.push(resp)}`); }
    if (!fields.length) throw new Error('Nada que actualizar.');
    const [row] = await query(`UPDATE mejoras SET ${fields.join(',')} WHERE id=$${vals.push(id)} RETURNING *`, vals);
    return row ?? { ok: true };
  }
  throw new Error('Acción no válida.');
}
