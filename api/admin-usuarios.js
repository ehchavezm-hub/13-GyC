// Acciones de administración que no pasan por el CRUD genérico: usuarios (cuentas en Clerk), empresas,
// consola de la plataforma y mejoras. Misma interfaz que adaptador de demostración (adapter-demo.js → adminUsuarios).
import { randomUUID } from 'node:crypto';
import { query, transaccion } from './_lib/db.js';
import { verificarAuth, AuthError, leerCuerpo, clerk, GESTORES, esSuper, habilitado } from './_lib/auth.js';
import { puede, eliminarUsuario } from './_lib/usuarios.js';

const ROLES = ['lider', 'consulta', 'delegado', 'admin', 'superadmin', 'pendiente'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
  try { d = await leerCuerpo(req); } catch { return res.status(400).json({ error: 'JSON inválido' }); }

  try {
    const result = await atender(perfil, d);
    res.status(200).json(result ?? { ok: true });
  } catch (e) {
    const st = e instanceof AuthError ? e.status : 400;
    res.status(st).json({ error: e.message });
  }
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

const ACCIONES_PLATAFORMA = {
  empresas: accionEmpresas,
  crear_empresa: accionCrearEmpresa,
  estado_empresa: accionEstadoEmpresa,
  plataforma: accionPlataforma,
  editar_empresa: accionEditarEmpresa,
  eliminar_empresa: accionEliminarEmpresa,
  usar_empresa: accionUsarEmpresa,
  cambiar_principal: accionCambiarPrincipal,
  estructura: accionEstructura,
  lideres: accionLideres,
  propietario: accionPropietario,
  usuario_plataforma: accionUsuarioPlataforma,
  auditoria_plataforma: accionAuditoriaPlataforma,
  historial_proyecto: accionHistorialProyecto,
  eliminar_usuario: (yo, d) => eliminarUsuario(yo, String(d.usuario_id || ''), { plataforma: true }).then(r => ({ resultado: r })),
};

async function atender(yo, d) {
  const { accion } = d;
  if (!habilitado(yo)) throw new AuthError('No autorizado.', 403);

  // Cualquier usuario activo
  if (accion === 'mejoras' || accion === 'gestionar_mejora') return accionMejoras(yo, d);
  if (accion === 'mis_empresas') return accionMisEmpresas(yo);
  if (accion === 'cambiar_empresa') return accionCambiarEmpresa(yo, d);

  // Consola de la plataforma: solo sus propietarios
  if (Object.prototype.hasOwnProperty.call(ACCIONES_PLATAFORMA, accion)) {
    if (!yo.es_plataforma) throw new AuthError('Solo el administrador de la plataforma gestiona empresas.', 403);
    return ACCIONES_PLATAFORMA[accion](yo, d);
  }

  // Cuentas creadas al traer los datos del modo demostración
  if (accion === 'crear_cuenta') {
    if (!['superadmin', 'admin'].includes(yo.rol) && !yo.es_admin_principal) throw new AuthError('No autorizado.', 403);
    return accionCrearCuenta(yo, d);
  }

  // Resto: permiso gestionar_usuarios
  if (!GESTORES.includes(yo.rol) || !(await puede(yo, 'gestionar_usuarios'))) {
    throw new AuthError('No tiene permiso para gestionar usuarios.', 403);
  }
  if (accion === 'crear') return accionCrear(yo, d);
  if (accion === 'clave') return accionClave(yo, d);

  throw new Error('Acción no válida.');
}

// ── Clerk ────────────────────────────────────────────────────────────────────

function errorClerk(e) {
  return e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || e?.message || String(e);
}

async function crearEnClerk(email, nombre, clave) {
  const partes = nombre.split(/\s+/);
  try {
    const u = await clerk().users.createUser({
      emailAddress: [email], password: clave,
      firstName: partes[0] || undefined, lastName: partes.slice(1).join(' ') || undefined,
      skipPasswordChecks: false,
    });
    return u.id;
  } catch (e) {
    const msg = errorClerk(e);
    if (/already|taken|exists|registrad/i.test(msg)) {
      const err = new Error('Ya existe una cuenta con ese correo.');
      err.yaExiste = true;
      throw err;
    }
    throw new Error(msg);
  }
}

// ── Usuarios ─────────────────────────────────────────────────────────────────

async function accionCrearCuenta(yo, { email, nombre, clave }) {
  email = String(email ?? '').trim().toLowerCase();
  nombre = String(nombre ?? '').trim();
  if (!EMAIL_RE.test(email)) throw new Error('Correo no válido.');
  if (!nombre) throw new Error('Indique el nombre.');
  if (String(clave ?? '').length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  const [existente] = await query(`SELECT id FROM profiles WHERE email = $1 AND NOT eliminado`, [email]);
  if (existente) throw new Error('Ya existe un usuario con ese correo.');
  const id = await crearEnClerk(email, nombre, String(clave));
  await query(
    `INSERT INTO profiles (id, nombre, email, rol, area_id, activo, debe_cambiar_clave)
     VALUES ($1, $2, $3, 'pendiente', $4, true, true)
     ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, email = EXCLUDED.email, area_id = EXCLUDED.area_id`,
    [id, nombre, email, yo.area_id], yo.id);
  return { id };
}

async function accionCrear(yo, d) {
  const email = String(d.email ?? '').trim().toLowerCase();
  const nombre = String(d.nombre ?? '').trim();
  const rol = String(d.rol || 'lider');
  const clave = String(d.clave ?? '');
  if (!EMAIL_RE.test(email)) throw new Error('Correo no válido.');
  if (!nombre) throw new Error('Indique el nombre.');
  if (!ROLES.includes(rol)) throw new Error('Rol no válido.');
  if (GESTORES.includes(rol) && !esSuper(yo)) {
    throw new AuthError('Solo el super administrador asigna los roles de super administrador, administrador y delegado.', 403);
  }
  const destino = yo.es_plataforma && d.area_id ? String(d.area_id) : yo.area_id;
  if (!UUID_RE.test(String(destino || ''))) throw new Error('Empresa no válida.');

  // Ya tiene cuenta (en otra empresa): un propietario de la plataforma la agrega a esta empresa con el rol elegido
  const [existente] = await query(`SELECT id, area_id FROM profiles WHERE email = $1 AND NOT eliminado`, [email]);
  if (existente) {
    if (!yo.es_plataforma) throw new Error('Ya existe un usuario con ese correo en otra empresa. Pida a un propietario de la plataforma que lo agregue a esta empresa.');
    const [ya] = await query(`SELECT pertenece($1, $2) AS ok`, [existente.id, destino]);
    if (ya?.ok) throw new Error('Ya existe un usuario con ese correo en esta empresa.');
    await query(
      `INSERT INTO empresa_miembros (usuario_id, area_id, rol, activo, es_admin_principal) VALUES ($1, $2, $3, true, false)
       ON CONFLICT (usuario_id, area_id) DO UPDATE SET rol = EXCLUDED.rol, activo = true`,
      [existente.id, destino, rol], yo.id);
    return { id: existente.id, agregado: true };
  }

  if (clave.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  const id = await crearEnClerk(email, nombre, clave);
  const gerencias = Array.isArray(d.gerencia_ids) ? d.gerencia_ids.filter(x => UUID_RE.test(String(x))) : [];
  const horas = d.horas_dia === '' || d.horas_dia == null ? null : Number(d.horas_dia);
  await query(
    `INSERT INTO profiles (id, email, nombre, rol, area_id, codigo, cargo_id, gerencia_ids, horas_dia, activo, debe_cambiar_clave)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid[], $9, true, true)
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, nombre = EXCLUDED.nombre, rol = EXCLUDED.rol,
       area_id = EXCLUDED.area_id, codigo = EXCLUDED.codigo, cargo_id = EXCLUDED.cargo_id,
       gerencia_ids = EXCLUDED.gerencia_ids, horas_dia = EXCLUDED.horas_dia, debe_cambiar_clave = true`,
    [id, email, nombre, rol, destino, d.codigo ? String(d.codigo).trim() : null,
      UUID_RE.test(String(d.cargo_id || '')) ? d.cargo_id : null, gerencias, horas], yo.id);
  return { id };
}

async function accionClave(yo, { usuario_id, clave }) {
  clave = String(clave ?? '');
  if (clave.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  const [obj] = await query(`SELECT id, rol, area_id, es_admin_principal FROM profiles WHERE id = $1`, [String(usuario_id ?? '')]);
  const [m] = obj ? await query(`SELECT pertenece($1, $2) AS ok`, [obj.id, yo.area_id]) : [];
  if (!obj || !m?.ok) throw new AuthError('Usuario no encontrado.', 404);
  if (obj.id !== yo.id && (obj.es_admin_principal || (GESTORES.includes(obj.rol) && !esSuper(yo)))) {
    throw new AuthError('No puede restablecer la contraseña de ese usuario.', 403);
  }
  try {
    await clerk().users.updateUser(obj.id, { password: clave, skipPasswordChecks: false });
  } catch (e) {
    throw new Error(errorClerk(e));
  }
  await query(`UPDATE profiles SET debe_cambiar_clave = $1 WHERE id = $2`, [obj.id !== yo.id, obj.id], yo.id);
  return { ok: true };
}

// ── Varias empresas ──────────────────────────────────────────────────────────

async function accionMisEmpresas(yo) {
  const miembros = await query(
    `SELECT area_id, rol FROM empresa_miembros WHERE usuario_id = $1 AND activo`, [yo.id]);
  const ids = [...new Set([yo.area_id, ...miembros.map(m => m.area_id)].filter(Boolean))];
  const areas = ids.length ? await query(`SELECT id, nombre, activa FROM areas WHERE id = ANY($1::uuid[]) ORDER BY nombre`, [ids]) : [];
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
  if (!UUID_RE.test(destino)) throw new Error('Empresa no válida.');
  if (destino === yo.area_id) return { ok: true };
  // La empresa que deja queda como membresía con su rol actual (la mantiene tg_sync_miembro)
  await query(`SELECT cambiar_empresa_activa($1, $2::uuid)`, [yo.id, destino], yo.id);
  return { ok: true };
}

// ── Mejoras del aplicativo (todas las empresas) ──────────────────────────────

async function accionMejoras(yo, d) {
  if (d.accion === 'mejoras') {
    const mejoras = await query(
      `SELECT s.*, coalesce(p.nombre, '') AS autor_nombre, coalesce(a.nombre, '') AS empresa
         FROM solicitudes_cambio s
         LEFT JOIN profiles p ON p.id = s.autor_id
         LEFT JOIN areas a ON a.id = s.area_id
        ORDER BY s.created_at DESC LIMIT 1000`);
    return { mejoras, gestiona: !!yo.es_plataforma };
  }
  const [s] = await query(`SELECT id, area_id FROM solicitudes_cambio WHERE id = $1`, [String(d.id ?? '')]);
  if (!s) throw new Error('La solicitud ya no existe.');
  if (!yo.es_plataforma && !(s.area_id === yo.area_id && await puede(yo, 'ver_solicitud'))) {
    throw new AuthError('Solo los propietarios de la plataforma gestionan las mejoras de todas las empresas.', 403);
  }
  const campos = [], vals = [];
  for (const k of ['estado', 'prioridad', 'respuesta']) {
    if (d[k] !== undefined) { vals.push(d[k] === '' ? null : d[k]); campos.push(`${k} = $${vals.length}`); }
  }
  if (!campos.length) throw new Error('Nada que actualizar.');
  vals.push(s.id);
  const [row] = await query(`UPDATE solicitudes_cambio SET ${campos.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals, yo.id);
  return row;
}

// ── Empresas (plataforma) ────────────────────────────────────────────────────

function uuidDe(v, que = 'Empresa') {
  const s = String(v ?? '');
  if (!UUID_RE.test(s)) throw new Error(`${que} no encontrada.`);
  return s;
}

async function accionEmpresas(yo) {
  const filas = await query(
    `SELECT a.*,
            (SELECT count(*) FROM profiles p WHERE p.area_id = a.id AND NOT p.eliminado AND p.activo AND p.rol <> 'pendiente')::int AS usuarios,
            (SELECT count(*) FROM proyectos x WHERE x.area_id = a.id)::int AS proyectos,
            (SELECT p.nombre || ' (' || coalesce(p.email, '') || ')' FROM profiles p
              WHERE p.area_id = a.id AND p.es_admin_principal AND NOT p.eliminado
              ORDER BY p.es_plataforma, p.created_at LIMIT 1) AS administrador
       FROM areas a ORDER BY a.nombre`);
  return {
    empresas: filas.map(a => ({ ...a, codigo: String(a.id).slice(0, 8), activa: a.activa !== false,
      administrador: a.administrador || '', mia: a.id === yo.area_id })),
  };
}

async function accionCrearEmpresa(yo, d) {
  const nombre = String(d.nombre_empresa || '').trim();
  if (!nombre) throw new Error('Indique el nombre de la empresa.');
  const [rep] = await query(`SELECT 1 FROM areas WHERE lower(nombre) = lower($1)`, [nombre]);
  if (rep) throw new Error('Ya existe una empresa con ese nombre.');
  const area = randomUUID();
  const sentencias = [[`INSERT INTO areas (id, nombre, descripcion, activa) VALUES ($1, $2, $3, true)`, [area, nombre, d.descripcion || null]]];
  const semilla = d.semilla;
  if (semilla && Array.isArray(semilla.listas)) {
    for (const l of semilla.listas) {
      const lid = randomUUID();
      sentencias.push([`INSERT INTO listas (id, area_id, clave, nombre, grupo, sistema) VALUES ($1, $2, $3, $4, $5, true)`,
        [lid, area, String(l.clave), String(l.nombre), l.grupo || null]]);
      (l.valores || []).forEach((v, i) => sentencias.push([
        `INSERT INTO lista_valores (lista_id, codigo, valor, orden, color, protegido, extra) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [lid, v.codigo ?? null, String(v.valor), (i + 1) * 10, v.color ?? null, !!v.protegido, JSON.stringify(v.extra || {})]]));
    }
    for (const [clave, valor] of Object.entries(semilla.parametros || {})) {
      sentencias.push([`INSERT INTO parametros (area_id, clave, valor) VALUES ($1, $2, $3::jsonb) ON CONFLICT (area_id, clave) DO NOTHING`,
        [area, clave, JSON.stringify(valor ?? null)]]);
    }
    for (const x of semilla.permisos || []) {
      if (!['admin', 'delegado', 'lider', 'consulta'].includes(x.rol)) continue;
      sentencias.push([`INSERT INTO permisos (area_id, rol, accion, permitido) VALUES ($1, $2, $3, $4) ON CONFLICT (area_id, rol, accion) DO NOTHING`,
        [area, x.rol, String(x.accion), !!x.permitido]]);
    }
  } else {
    sentencias.push([`SELECT sembrar_area($1)`, [area]]);
  }
  await transaccion(yo.id, sentencias);
  return { area_id: area };
}

async function accionEstadoEmpresa(yo, d) {
  const area = uuidDe(d.area_id);
  if (area === yo.area_id && d.activa === false) throw new Error('No puede desactivar su propia empresa.');
  await query(`UPDATE areas SET activa = $1 WHERE id = $2`, [!!d.activa, area], yo.id);
  return { ok: true };
}

async function accionEditarEmpresa(yo, d) {
  const area = uuidDe(d.area_id);
  const nombre = String(d.nombre || '').trim();
  if (!nombre) throw new Error('Indique el nombre de la empresa.');
  const [rep] = await query(`SELECT 1 FROM areas WHERE lower(nombre) = lower($1) AND id <> $2`, [nombre, area]);
  if (rep) throw new Error('Ya existe una empresa con ese nombre.');
  await query(`UPDATE areas SET nombre = $1, descripcion = $2 WHERE id = $3`, [nombre, d.descripcion || null, area], yo.id);
  return { ok: true };
}

async function accionEliminarEmpresa(yo, d) {
  const area = uuidDe(d.area_id);
  if (area === yo.area_id) throw new Error('No puede eliminar la empresa en la que está trabajando. Abra otra empresa primero.');
  const [p] = await query(`SELECT 1 FROM profiles WHERE area_id = $1 AND es_plataforma`, [area]);
  if (p) throw new Error('Un propietario de la plataforma está trabajando en esa empresa. Que abra otra empresa primero.');
  await query(`SELECT eliminar_empresa($1)`, [area], yo.id);
  return { ok: true };
}

async function accionUsarEmpresa(yo, d) {
  const area = uuidDe(d.area_id);
  const [a] = await query(`SELECT 1 FROM areas WHERE id = $1`, [area]);
  if (!a) throw new Error('Empresa no encontrada.');
  // El propietario de la plataforma "entra" a la empresa sin perder sus membresías
  await transaccion(yo.id, [
    [`SELECT set_config('lpsgt.cambio_empresa', 'on', true)`, []],
    [`UPDATE profiles SET area_id = $1 WHERE id = $2`, [area, yo.id]],
  ]);
  return { ok: true };
}

async function accionCambiarPrincipal(yo, d) {
  const area = uuidDe(d.area_id);
  const uid = String(d.usuario_id || '');
  const [nuevo] = await query(`SELECT id, area_id FROM profiles WHERE id = $1 AND NOT eliminado`, [uid]);
  const [miembro] = nuevo ? await query(`SELECT 1 FROM empresa_miembros WHERE usuario_id = $1 AND area_id = $2`, [uid, area]) : [];
  if (!nuevo || (nuevo.area_id !== area && !miembro)) throw new Error('El usuario no pertenece a esa empresa.');
  const sentencias = [
    [`UPDATE profiles SET es_admin_principal = false WHERE area_id = $1 AND NOT es_plataforma AND id <> $2 AND es_admin_principal`, [area, uid]],
    [`UPDATE empresa_miembros SET es_admin_principal = false WHERE area_id = $1 AND usuario_id <> $2`, [area, uid]],
  ];
  if (nuevo.area_id === area) {
    sentencias.push([`UPDATE profiles SET es_admin_principal = true, rol = 'superadmin', activo = true WHERE id = $1`, [uid]]);
  } else {
    sentencias.push([`UPDATE empresa_miembros SET es_admin_principal = true, rol = 'superadmin', activo = true WHERE usuario_id = $1 AND area_id = $2`, [uid, area]]);
  }
  await transaccion(yo.id, sentencias);
  return { ok: true };
}

// ── Estructura de las empresas (portafolios, programas y proyectos) ──────────

const CAMPOS_EST = {
  portafolios: ['codigo', 'nombre', 'descripcion', 'responsable_id', 'estado'],
  programas: ['codigo', 'nombre', 'descripcion', 'responsable_id', 'estado', 'portafolio_id'],
  proyectos: ['codigo', 'nombre_corto', 'nombre_completo', 'estado', 'portafolio_id', 'programa_id', 'padre_id', 'gerencia_id',
    'fase_id', 'pais_id', 'fecha_inicio', 'fecha_fin', 'observaciones'],
};

async function accionEstructura(yo, d) {
  const t = String(d.tabla || '');
  if (!CAMPOS_EST[t]) throw new Error('Tabla no válida.');

  if (d.op === 'eliminar') {
    const id = uuidDe(d.id, 'Registro');
    if (t === 'proyectos' && d.completo) {
      const [r] = await query(`SELECT eliminar_proyecto_plataforma($1) AS v`, [id], yo.id);
      return { ok: true, ...r.v };
    }
    if (t === 'proyectos') {
      const [h] = await query(`SELECT count(*)::int AS n FROM proyectos WHERE padre_id = $1`, [id]);
      if (h.n) throw new Error(`El proyecto tiene ${h.n} Grupo(s) LPS: elimínelos o muévalos primero.`);
      const [a] = await query(`SELECT count(*)::int AS n FROM actividades WHERE proyecto_id = $1`, [id]);
      if (a.n) throw new Error(`El proyecto tiene ${a.n} actividades: ciérrelo en lugar de eliminarlo para conservar su historial.`);
    }
    await query(`DELETE FROM ${t} WHERE id = $1`, [id], yo.id);   // portafolio/programa: FK on delete set null
    return { ok: true };
  }

  const datos = {};
  for (const k of CAMPOS_EST[t]) if (k in (d.datos || {})) datos[k] = d.datos[k] === '' ? null : d.datos[k];
  if (t === 'proyectos' && datos.programa_id) {
    const [g] = await query(`SELECT portafolio_id FROM programas WHERE id = $1`, [datos.programa_id]);
    if (g?.portafolio_id) datos.portafolio_id = g.portafolio_id;
  }

  if (d.id) {
    const id = uuidDe(d.id, 'Registro');
    const [actual] = await query(`SELECT * FROM ${t} WHERE id = $1`, [id]);
    if (!actual) throw new Error('El registro ya no existe.');
    if (t === 'proyectos' && d.area_id && d.area_id !== actual.area_id) return moverProyecto(yo, actual, uuidDe(d.area_id), datos);
    const claves = Object.keys(datos);
    if (!claves.length) return { registro: actual };
    const [registro] = await query(
      `UPDATE ${t} SET ${claves.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${claves.length + 1} RETURNING *`,
      [...claves.map(k => datos[k]), id], yo.id);
    return { registro };
  }

  const area = uuidDe(d.area_id);
  const [a] = await query(`SELECT 1 FROM areas WHERE id = $1`, [area]);
  if (!a) throw new Error('Empresa no encontrada.');
  if (t === 'proyectos') {
    if (!datos.codigo || !datos.nombre_corto) throw new Error('Indique el código y el nombre del proyecto.');
    const [rep] = await query(`SELECT 1 FROM proyectos WHERE area_id = $1 AND codigo = $2`, [area, datos.codigo]);
    if (rep) throw new Error('Ya existe un proyecto con ese código en la empresa.');
    datos.created_by = yo.id;
  } else if (!datos.nombre) {
    throw new Error('Indique el nombre.');
  }
  datos.estado ??= 'activo';
  const claves = Object.keys(datos);
  const [registro] = await query(
    `INSERT INTO ${t} (area_id, ${claves.join(', ')}) VALUES ($1, ${claves.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`,
    [area, ...claves.map(k => datos[k])], yo.id);
  return { registro };
}

// Traslada un proyecto (con sus Grupos LPS) a otra empresa, si aún no tiene historial
async function moverProyecto(yo, actual, area, datos) {
  if (actual.padre_id) throw new Error('Un Grupo LPS se mueve junto con su proyecto: mueva el proyecto.');
  const subs = await query(`SELECT id, codigo FROM proyectos WHERE padre_id = $1`, [actual.id]);
  const ids = [actual.id, ...subs.map(s => s.id)];
  for (const [tt, texto] of [['actividades', 'actividades'], ['restricciones', 'restricciones'], ['cartera', 'registros de cartera']]) {
    const [r] = await query(`SELECT count(*)::int AS n FROM ${tt} WHERE proyecto_id = ANY($1::uuid[])`, [ids]);
    if (r.n) throw new Error(`No se puede mover: el proyecto${subs.length ? ' o sus Grupos LPS' : ''} ya tiene ${r.n} ${texto} en esta empresa. Mantenga su historial aquí o cree el proyecto en la otra empresa.`);
  }
  const codigos = [datos.codigo ?? actual.codigo, ...subs.map(s => s.codigo)];
  const rep = await query(`SELECT codigo FROM proyectos WHERE area_id = $1 AND codigo = ANY($2::text[])`, [area, codigos]);
  if (rep.length) throw new Error(`En la empresa de destino ya existe el código ${rep.map(r => r.codigo).join(', ')}. Cámbielo antes de mover.`);

  const cambios = { ...datos, area_id: area, portafolio_id: datos.portafolio_id ?? null, programa_id: datos.programa_id ?? null,
    gerencia_id: null, cet_id: null, fase_id: null, pais_id: null, tipo_id: null, padre_id: null };
  const claves = Object.keys(cambios);
  const res = await transaccion(yo.id, [
    [`DELETE FROM proyecto_lideres WHERE proyecto_id = ANY($1::uuid[])`, [ids]],
    [`DELETE FROM proyecto_favoritos WHERE proyecto_id = ANY($1::uuid[])`, [ids]],
    [`DELETE FROM supervisiones WHERE proyecto_id = ANY($1::uuid[])`, [ids]],
    [`UPDATE proyectos SET ${claves.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${claves.length + 1} RETURNING *`,
      [...claves.map(k => cambios[k]), actual.id]],
    [`UPDATE proyectos SET area_id = $1, gerencia_id = NULL, cet_id = NULL, fase_id = NULL, pais_id = NULL, tipo_id = NULL
       WHERE padre_id = $2`, [area, actual.id]],
  ]);
  return { registro: res[3][0] };
}

async function accionLideres(yo, d) {
  const pid = uuidDe(d.proyecto_id, 'Proyecto');
  const [p] = await query(`SELECT id, area_id FROM proyectos WHERE id = $1`, [pid]);
  if (!p) throw new Error('Proyecto no encontrado.');
  const pedidos = (Array.isArray(d.usuario_ids) ? d.usuario_ids : []).map(String);
  const validos = pedidos.length
    ? (await query(`SELECT id FROM profiles WHERE id = ANY($1::text[]) AND pertenece(id, $2)`, [pedidos, p.area_id])).map(r => r.id)
    : [];
  // Se conserva el rol en el proyecto (miembro / administrador) de quienes siguen
  await transaccion(yo.id, [
    [`DELETE FROM proyecto_lideres WHERE proyecto_id = $1 AND NOT (usuario_id = ANY($2::text[]))`, [pid, validos]],
    ...validos.map(u => [`INSERT INTO proyecto_lideres (proyecto_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [pid, u]]),
  ]);
  return { ok: true };
}

async function accionPropietario(yo, d) {
  const uid = String(d.usuario_id || '');
  if (!d.es) {
    if (uid === yo.id) throw new Error('No puede quitarse a sí mismo. Otro propietario debe hacerlo.');
    const [n] = await query(`SELECT count(*)::int AS n FROM profiles WHERE es_plataforma AND NOT eliminado`);
    if (n.n <= 1) throw new Error('Debe quedar al menos un propietario de la plataforma.');
  }
  const r = await query(`UPDATE profiles SET es_plataforma = $1 WHERE id = $2 AND NOT eliminado RETURNING id`, [!!d.es, uid], yo.id);
  if (!r.length) throw new Error('Usuario no encontrado.');
  return { ok: true };
}

async function accionUsuarioPlataforma(yo, d) {
  const uid = String(d.usuario_id || '');
  const area = d.area_id ? uuidDe(d.area_id) : null;
  const [u] = await query(`SELECT * FROM profiles WHERE id = $1 AND NOT eliminado`, [uid]);
  if (!u) throw new Error('Usuario no encontrado.');
  if (d.rol !== undefined && !ROLES.includes(d.rol)) throw new Error('Rol no válido.');

  // Membresía en una empresa que no es la activa de esa persona
  if (area && u.area_id !== area) {
    const [m] = await query(`SELECT * FROM empresa_miembros WHERE usuario_id = $1 AND area_id = $2`, [uid, area]);
    if (!m) throw new Error('El usuario no pertenece a esa empresa.');
    if (d.quitar) {
      if (m.es_admin_principal) throw new Error('Es el super administrador principal de esa empresa: designe antes a otro.');
      await query(`DELETE FROM empresa_miembros WHERE usuario_id = $1 AND area_id = $2`, [uid, area], yo.id);
      return { ok: true };
    }
    const sets = [], vals = [];
    if (d.rol !== undefined) { vals.push(d.rol); sets.push(`rol = $${vals.length}`); }
    if (d.activo !== undefined) { vals.push(!!d.activo); sets.push(`activo = $${vals.length}`); }
    if (sets.length) await query(`UPDATE empresa_miembros SET ${sets.join(', ')} WHERE usuario_id = $${vals.length + 1} AND area_id = $${vals.length + 2}`,
      [...vals, uid, area], yo.id);
    return { ok: true };
  }

  // Empresa activa de esa persona
  if (d.quitar) {
    if (u.es_admin_principal) throw new Error('Es el super administrador principal de esa empresa: designe antes a otro.');
    const [r] = await query(`SELECT mover_a_otra_empresa($1, $2) AS ok`, [uid, u.area_id], yo.id);
    if (!r.ok) throw new Error('Esta es la única empresa de la persona: para quitarla use «Eliminar usuario» en la configuración de la empresa.');
    await query(`DELETE FROM empresa_miembros WHERE usuario_id = $1 AND area_id = $2`, [uid, u.area_id], yo.id);
    return { ok: true };
  }
  const sets = [], vals = [];
  if (d.rol !== undefined) {
    if (u.es_admin_principal && d.rol !== 'superadmin') throw new Error('El administrador principal de una empresa es super administrador. Cambie antes el principal.');
    vals.push(d.rol); sets.push(`rol = $${vals.length}`);
  }
  if (d.activo !== undefined) {
    if (uid === yo.id && !d.activo) throw new Error('No puede desactivarse a sí mismo.');
    vals.push(!!d.activo); sets.push(`activo = $${vals.length}`);
  }
  if (sets.length) await query(`UPDATE profiles SET ${sets.join(', ')} WHERE id = $${vals.length + 1}`, [...vals, uid], yo.id);
  return { ok: true };
}

async function accionPlataforma(yo) {
  const [areas, perfiles, portafolios, programas, proyectos, lideres, miembros] = await Promise.all([
    query(`SELECT * FROM areas ORDER BY nombre`),
    query(`SELECT * FROM profiles WHERE NOT eliminado ORDER BY nombre`),
    query(`SELECT * FROM portafolios ORDER BY nombre`),
    query(`SELECT * FROM programas ORDER BY nombre`),
    query(`SELECT * FROM proyectos ORDER BY codigo`),
    query(`SELECT * FROM proyecto_lideres`),
    query(`SELECT * FROM empresa_miembros`),
  ]);
  return { areas: areas.map(a => ({ ...a, activa: a.activa !== false })), perfiles, portafolios, programas, proyectos, lideres, miembros, mi_area: yo.area_id };
}

async function accionHistorialProyecto(_yo, d) {
  const id = uuidDe(d.id, 'Proyecto');
  const [r] = await query(
    `WITH ids AS (SELECT id FROM proyectos WHERE id = $1 OR padre_id = $1)
     SELECT (SELECT count(*) FROM ids)::int - 1 AS subproyectos,
            (SELECT count(*) FROM actividades WHERE proyecto_id IN (SELECT id FROM ids))::int AS actividades,
            (SELECT count(*) FROM restricciones WHERE proyecto_id IN (SELECT id FROM ids))::int AS restricciones,
            (SELECT count(*) FROM cartera WHERE proyecto_id IN (SELECT id FROM ids))::int AS cartera`, [id]);
  return r;
}

async function accionAuditoriaPlataforma(_yo, d) {
  const registros = d.area_id
    ? await query(`SELECT * FROM auditoria WHERE area_id = $1 ORDER BY created_at DESC LIMIT 300`, [uuidDe(d.area_id)])
    : await query(`SELECT * FROM auditoria ORDER BY created_at DESC LIMIT 300`);
  return { registros };
}
