// Pruebas de compatibilidad aplicativo ↔ API ↔ base de datos.
// Ejecuta api/datos.js y api/admin-usuarios.js contra un PostgreSQL de prueba con las migraciones 000 + 035,
// reemplazando Neon (driver HTTP) por node-postgres y Clerk por un verificador de prueba ("Bearer <id>").
// Uso: DATABASE_URL_PRUEBAS=postgres://… node --test pruebas/api/
// La base indicada se BORRA y se vuelve a crear. Nunca apunte esta variable a producción.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { usarEjecutor, configurarTipos } from '../../api/_lib/db.js';
import { usarVerificador } from '../../api/_lib/auth.js';
import datos from '../../api/datos.js';
import admin from '../../api/admin-usuarios.js';
import { semillaEmpresa } from '../../app/js/data/catalogos.js';

configurarTipos(pg.types);   // igual que en producción (api/_lib/db.js)
const URL_BD = process.env.DATABASE_URL_PRUEBAS;
if (!URL_BD) { console.log('DATABASE_URL_PRUEBAS no definida: se omiten las pruebas del API.'); process.exit(0); }
if (/neon\.tech|vercel/i.test(URL_BD)) throw new Error('DATABASE_URL_PRUEBAS parece producción: use un PostgreSQL local.');

const raiz = new URL('../../', import.meta.url);
const migracion = n => readFileSync(fileURLToPath(new URL(`db/migrations/${n}`, raiz)), 'utf8');
const pool = new pg.Pool({ connectionString: URL_BD, max: 4 });

before(async () => {
  const c = await pool.connect();
  try {
    await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await c.query(migracion('000_gyc_neon_completo.sql'));
    await c.query(migracion('035_compatibilidad_api.sql'));
    await c.query(migracion('036_cuentas_preasignadas.sql'));
    await c.query(migracion('037_programa_arranque_r1.sql'));
    await c.query(migracion('038_administracion_tres_niveles.sql'));
  } finally { c.release(); }
  usarVerificador(async token => token);
  usarEjecutor(async (sentencias, uid) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.current_user_id', $1, true)`, [uid || '']);
      const out = [];
      for (const [texto, params = []] of sentencias) out.push((await c.query(texto, params)).rows);
      await c.query('COMMIT');
      return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
});
after(() => pool.end());

// Petición simulada a una Vercel Function
async function llamar(handler, usuario, body) {
  let estado = 200, json;
  const res = {
    setHeader() {}, status(s) { estado = s; return res; }, json(j) { json = j; return res; }, end() { return res; },
  };
  await handler({ method: 'POST', headers: { authorization: `Bearer ${usuario}` }, body }, res);
  if (estado >= 300) { const e = new Error(json?.error || `HTTP ${estado}`); e.status = estado; throw e; }
  return json;
}
// Igual que app/js/data/adapter-api.js
const cliente = u => ({
  list: (tabla, f = {}) => llamar(datos, u, { accion: 'list', tabla, ...f }),
  insert: (tabla, filas) => llamar(datos, u, { accion: 'insert', tabla, data: Array.isArray(filas) ? filas : [filas] }),
  upsert: (tabla, filas, onConflict = 'id') => llamar(datos, u, { accion: 'upsert', tabla, data: Array.isArray(filas) ? filas : [filas], onConflict }),
  update: (tabla, id, data) => llamar(datos, u, { accion: 'update', tabla, id, data }),
  updateWhere: (tabla, f, data) => llamar(datos, u, { accion: 'updateWhere', tabla, data, ...f }),
  remove: (tabla, id) => llamar(datos, u, { accion: 'remove', tabla, id }),
  removeWhere: (tabla, f) => llamar(datos, u, { accion: 'removeWhere', tabla, ...f }),
  rpc: (nombre, params = {}) => llamar(datos, u, { accion: 'rpc', nombre, params }),
  adminUsuarios: (accion, d = {}) => llamar(admin, u, { accion, ...d }),
});
const A = cliente('user_admin'), B = cliente('user_lider'), C = cliente('user_consulta');
const lunes = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
const ctx = {};

test('primer ingreso: super administrador principal y propietario de la plataforma', async () => {
  const [p] = await A.list('profiles', { eq: { id: 'user_admin' } });
  assert.equal(p.rol, 'superadmin');
  assert.equal(p.es_admin_principal, true);
  assert.equal(p.es_plataforma, true);
  assert.ok(p.area_id);
  ctx.area = p.area_id;
});

test('siguientes ingresos quedan pendientes y solo leen su perfil', async () => {
  const [p] = await B.list('profiles', { eq: { id: 'user_lider' } });
  assert.equal(p.rol, 'pendiente');
  assert.equal(p.area_id, ctx.area);
  await assert.rejects(B.list('proyectos', {}), /rol asignado/);
  await C.list('profiles', { eq: { id: 'user_consulta' } });
  const notas = await A.list('notificaciones', { eq: { usuario_id: 'user_admin' } });
  assert.ok(notas.some(n => n.tipo === 'usuario_nuevo'));
});

test('catálogo como lo pide store.cargarCatalogo()', async () => {
  await A.update('profiles', 'user_lider', { rol: 'lider', nombre: 'Lía Líder', codigo: 'LL', horas_dia: '' });
  await A.update('profiles', 'user_consulta', { rol: 'consulta' });
  const [areas, listas, valores, params, permisos, perfiles, proyectos, lideres, favs, columnas, portafolios, programas, miembros, sup] = await Promise.all([
    B.list('areas', { eq: { id: ctx.area } }), B.list('listas', {}), B.list('lista_valores', { order: [['orden', true]] }),
    B.list('parametros', { eq: { area_id: ctx.area } }), B.list('permisos', { eq: { area_id: ctx.area } }),
    B.list('profiles', { order: [['nombre', true]] }), B.list('proyectos', { eq: { area_id: ctx.area }, order: [['codigo', true]] }),
    B.list('proyecto_lideres', {}), B.list('proyecto_favoritos', { eq: { usuario_id: 'user_lider' } }),
    B.list('columnas_personalizadas', { eq: { area_id: ctx.area }, order: [['orden', true]] }),
    B.list('portafolios', { eq: { area_id: ctx.area }, order: [['nombre', true]] }),
    B.list('programas', { eq: { area_id: ctx.area }, order: [['nombre', true]] }),
    B.list('empresa_miembros', {}), B.list('supervisiones', { eq: { area_id: ctx.area } }),
  ]);
  assert.equal(areas.length, 1);
  assert.ok(listas.length > 5 && valores.length > 20 && params.length > 5 && permisos.length > 5);
  assert.equal(perfiles.length, 3);
  assert.equal(proyectos.length, 1);
  assert.deepEqual([lideres.length, favs.length, columnas.length, sup.length], [0, 0, 0, 0]);
  assert.ok(portafolios.length && programas.length && miembros.length);
  ctx.proyecto = proyectos[0].id;
  ctx.cnc = valores.find(v => listas.find(l => l.id === v.lista_id)?.clave === 'cnc')?.id;
});

test('actividades: columnas generadas, jsonb, cadenas vacías y filtros', async () => {
  const [a] = await B.insert('actividades', {
    semana: lunes, responsable_id: 'user_lider', proyecto_id: ctx.proyecto, descripcion: 'Vaciado de losa',
    hh_lu: 2, hh_ma: '3', hh_total: 99, extra: { color: 'rojo', lista: [1, 2] }, comprometida: true, cnc_id: '', columna_vieja: 'x',
  });
  assert.equal(a.hh_total, 5);                 // numeric → número (como PostgREST), no "5.00"
  assert.equal(a.semana, lunes);               // date → 'AAAA-MM-DD', no un timestamp
  assert.deepEqual(a.extra, { color: 'rojo', lista: [1, 2] });
  assert.equal(a.area_id, ctx.area);
  assert.equal(a.created_by, 'user_lider');
  ctx.act = a.id;
  const r = await B.list('actividades', { eq: { responsable_id: 'user_lider' }, gte: { semana: lunes }, in: { estado: ['programado'] }, is: { cnc_id: null }, select: 'id,hh_total' });
  assert.equal(r.length, 1);
  assert.equal((await B.list('actividades', { in: { id: [] } })).length, 0);
  const u = await B.update('actividades', a.id, { hh_mi: 1, comentario: '' });
  assert.equal(u.hh_total, 6);
  await assert.rejects(C.update('actividades', a.id, { hh_mi: 2 }), /solo consulta/);
});

test('cierre de semana: reglas de negocio', async () => {
  await assert.rejects(B.insert('cierres', { responsable_id: 'user_lider', semana: lunes, cerrada: true }), /sin estado final/);
  await B.update('actividades', ctx.act, { estado: 'no_completado', cnc_id: ctx.cnc });
  const [c] = await B.insert('cierres', { responsable_id: 'user_lider', semana: lunes, cerrada: true });
  await assert.rejects(B.update('actividades', ctx.act, { hh_lu: 1 }), /está cerrada/);
  await assert.rejects(B.update('cierres', c.id, { cerrada: false }), /Solo el administrador o el delegado/);
  const r = await A.update('cierres', c.id, { cerrada: false });
  assert.equal(r.reabierto_por, 'user_admin');
});

test('upsert de parámetros (jsonb: texto, booleano, objeto) y permisos', async () => {
  await A.upsert('parametros', [
    { area_id: ctx.area, clave: 'zona_horaria', valor: 'America/Bogota' },
    { area_id: ctx.area, clave: 'trabajo_fin_semana', valor: true },
    { area_id: ctx.area, clave: 'cierre', valor: { dia: 4, hora: '18:00' } },
  ], 'area_id,clave');
  const ps = await A.list('parametros', { eq: { area_id: ctx.area } });
  assert.equal(ps.find(p => p.clave === 'zona_horaria').valor, 'America/Bogota');
  assert.equal(ps.find(p => p.clave === 'trabajo_fin_semana').valor, true);
  await A.upsert('permisos', { area_id: ctx.area, rol: 'lider', accion: 'crear_cartera', permitido: true }, 'area_id,rol,accion');
});

test('programa de arranque (tablas nuevas, jsonb en arreglo, update devuelve un objeto)', async () => {
  const items = await B.list('programa_arranque_items', { order: [['orden', true]] });
  assert.equal(items.length, 81);
  const [pa] = await B.insert('programa_arranque', { proyecto_id: ctx.proyecto, num_semanas: 8 });
  const [d1] = await B.upsert('programa_arranque_detalle', { programa_id: pa.id, item_codigo: '1', semanas: [{ plan: true }, {}] }, 'programa_id,item_codigo');
  assert.deepEqual(d1.semanas, [{ plan: true }, {}]);
  const [d2] = await B.upsert('programa_arranque_detalle', { programa_id: pa.id, item_codigo: '1', responsable: 'EHCM' }, 'programa_id,item_codigo');
  assert.equal(d2.responsable, 'EHCM');
  assert.deepEqual(d2.semanas, [{ plan: true }, {}]);
  // Formato r1: definición (amarillo) y seguimiento por reunión (verde)
  const [def] = await B.upsert('programa_arranque_detalle', { programa_id: pa.id, item_codigo: '1', responsable_id: 'user_lider',
    responsable: 'Lía', inicio_programado: '2026-07-06', fin_programado: '2026-10-04' }, 'programa_id,item_codigo');
  assert.equal(def.fin_programado, '2026-10-04');
  for (const [fecha, avance] of [['2026-11-06', 10], ['2026-11-13', 35]]) {
    await B.upsert('programa_arranque_seguimiento', { programa_id: pa.id, item_codigo: '1', fecha_revision: fecha, avance }, 'programa_id,item_codigo,fecha_revision');
  }
  const [s2] = await B.upsert('programa_arranque_seguimiento', { programa_id: pa.id, item_codigo: '1', fecha_revision: '2026-11-13', comentarios: 'ok' },
    'programa_id,item_codigo,fecha_revision');
  assert.deepEqual([s2.avance, s2.comentarios], [35, 'ok']);
  assert.equal((await B.list('programa_arranque_seguimiento', { eq: { programa_id: pa.id } })).length, 2);
  await assert.rejects(B.upsert('programa_arranque_seguimiento', { programa_id: pa.id, item_codigo: '1', fecha_revision: '2026-11-20', avance: 120 },
    'programa_id,item_codigo,fecha_revision'), /check/);
  // Información del proyecto (pestaña 0)
  const info = await B.update('proyectos', ctx.proyecto, { cr: 'C202000', inicio_contractual: '2026-07-01', fin_contractual: '2027-06-30' });
  assert.equal(info.inicio_contractual, '2026-07-01');
  const act = await B.update('programa_arranque', pa.id, { cr_proyecto: 'CR-1', fecha_movilizacion: '' });
  assert.equal(act.cr_proyecto, 'CR-1');
  assert.equal(Array.isArray(act), false);
});

test('reuniones con asistentes (ids de Clerk) y comentarios con menciones', async () => {
  const [r] = await B.insert('reuniones', { asistentes: ['user_admin', 'user_lider'], notas: 'x' });
  assert.deepEqual(r.asistentes, ['user_admin', 'user_lider']);
  await B.insert('comentarios', { entidad: 'actividad', entidad_id: ctx.act, texto: 'Revisar @admin', menciones: ['user_admin'] });
  const n = await A.list('notificaciones', { eq: { tipo: 'mencion' } });
  assert.equal(n.length, 1);
  await A.update('notificaciones', n[0].id, { leida: true });
  await assert.rejects(B.update('notificaciones', n[0].id, { leida: false }), /ya no existe/);
});

test('perfiles: columnas protegidas y reglas de roles', async () => {
  await assert.rejects(B.update('profiles', 'user_lider', { rol: 'admin' }), /No puede modificar "rol"/);
  await assert.rejects(B.update('profiles', 'user_admin', { nombre: 'x' }), /Solo los gestores/);
  await assert.rejects(A.update('profiles', 'user_lider', { es_plataforma: true }), /No puede modificar/);
  await assert.rejects(A.update('profiles', 'user_admin', { activo: false }), /No puede desactivarse/);
  const yo = await B.update('profiles', 'user_lider', { tour_visto: true, debe_cambiar_clave: false });
  assert.equal(yo.tour_visto, true);
  await assert.rejects(B.insert('profiles', { id: 'user_x', nombre: 'x' }), /Configuración → Usuarios/);
});

test('plataforma: crear empresa con semilla, estructura y aislamiento entre empresas', async () => {
  const { area_id } = await A.adminUsuarios('crear_empresa', { nombre_empresa: 'Constructora Dos', semilla: semillaEmpresa() });
  ctx.area2 = area_id;
  const { empresas } = await A.adminUsuarios('empresas');
  assert.equal(empresas.length, 2);
  const port = (await A.adminUsuarios('estructura', { tabla: 'portafolios', area_id, datos: { nombre: 'Minería' } })).registro;
  const prog = (await A.adminUsuarios('estructura', { tabla: 'programas', area_id, datos: { nombre: 'Relaves', portafolio_id: port.id } })).registro;
  const proy = (await A.adminUsuarios('estructura', { tabla: 'proyectos', area_id, datos: { codigo: 'P2', nombre_corto: 'Presa', programa_id: prog.id } })).registro;
  assert.equal(proy.portafolio_id, port.id);
  const sub = (await A.adminUsuarios('estructura', { tabla: 'proyectos', area_id, datos: { codigo: 'P2-A', nombre_corto: 'Grupo A', padre_id: proy.id } })).registro;
  assert.equal(sub.programa_id, prog.id);
  ctx.proy2 = proy.id;
  // La persona de la empresa 1 no ve ni modifica datos de la empresa 2
  assert.equal((await B.list('proyectos', { eq: { id: proy.id } })).length, 0);
  await assert.rejects(B.update('proyectos', proy.id, { nombre_corto: 'hack' }), /ya no existe/);
  await assert.rejects(B.insert('actividades', { area_id, semana: lunes, responsable_id: 'user_lider', descripcion: 'x' }), /no pertenece a su empresa/);
  await assert.rejects(B.insert('proyecto_lideres', { proyecto_id: proy.id, usuario_id: 'user_lider' }), /no pertenece a su empresa|administradores del proyecto/);
  await B.remove('proyectos', proy.id);
  assert.equal((await A.adminUsuarios('historial_proyecto', { id: proy.id })).subproyectos, 1);
  const plat = await A.adminUsuarios('plataforma');
  assert.ok(plat.areas.length === 2 && plat.proyectos.length === 3 && plat.mi_area === ctx.area);
});

test('plataforma: usuarios en varias empresas, líderes, principal y propietario', async () => {
  await A.adminUsuarios('crear', { email: 'lia@ejemplo.com', nombre: 'Lía', rol: 'lider', area_id: ctx.area2, clave: '12345678' })
    .catch(e => assert.match(e.message, /CLERK_SECRET_KEY/));
  await A.update('profiles', 'user_lider', { nombre: 'Lía Líder' });
  await A.adminUsuarios('lideres', { proyecto_id: ctx.proyecto, usuario_ids: ['user_lider', 'user_inexistente'] });
  assert.equal((await B.list('proyecto_lideres', {})).length, 1);
  await A.adminUsuarios('usar_empresa', { area_id: ctx.area2 });
  const { actual } = await A.adminUsuarios('mis_empresas');
  assert.equal(actual, ctx.area2);
  assert.equal((await A.list('proyectos', {})).length, 2);
  await A.adminUsuarios('usar_empresa', { area_id: ctx.area });
  await assert.rejects(A.adminUsuarios('propietario', { usuario_id: 'user_admin', es: false }), /a sí mismo/);
  await assert.rejects(B.adminUsuarios('plataforma'), /plataforma/);
  await A.adminUsuarios('usuario_plataforma', { usuario_id: 'user_consulta', rol: 'lider' });
  await A.adminUsuarios('usuario_plataforma', { usuario_id: 'user_consulta', rol: 'consulta' });
});

test('mejoras de todas las empresas', async () => {
  const [s] = await B.insert('solicitudes_cambio', { titulo: 'Exportar a Excel', descripcion: 'x' });
  assert.equal(s.autor_id, 'user_lider');
  const r = await B.adminUsuarios('mejoras');
  assert.equal(r.gestiona, false);
  assert.equal(r.mejoras[0].autor_nombre, 'Lía Líder');
  await assert.rejects(B.adminUsuarios('gestionar_mejora', { id: s.id, estado: 'aprobada' }), /propietarios/);
  const g = await A.adminUsuarios('gestionar_mejora', { id: s.id, estado: 'aprobada', prioridad: 'alta', respuesta: 'Ok' });
  assert.equal(g.estado, 'aprobada');
});

test('rpc: respaldo de la empresa, eliminar proyecto, eliminar usuario', async () => {
  const resp = await A.rpc('exportar_respaldo');
  assert.equal(resp.area_id, ctx.area);
  assert.ok(resp.profiles.every(p => p.area_id === ctx.area));
  await assert.rejects(B.rpc('exportar_respaldo'), /permiso/);
  await assert.rejects(B.rpc('eliminar_proyecto_completo', { p_proyecto: ctx.proyecto }), /administrador/);
  const r = await A.rpc('eliminar_proyecto_completo', { p_proyecto: ctx.proyecto });
  assert.equal(r.actividades, 1);
  assert.equal(await A.rpc('registro_abierto'), false);
  await assert.rejects(A.rpc('cualquier_funcion'), /no disponible/);
  assert.equal(await A.rpc('eliminar_usuario', { p_usuario: 'user_consulta' }), 'desactivado');
  const aud = await A.list('auditoria', { eq: { tabla: 'proyectos' }, order: [['created_at', false]], limit: 5 });
  assert.equal(aud[0].usuario_id, 'user_admin');
  await A.adminUsuarios('eliminar_empresa', { area_id: ctx.area2 });
  assert.equal((await A.adminUsuarios('empresas')).empresas.length, 1);
});

test('cuenta preasignada por correo: entra directo con su rol', async () => {
  await pool.query(`INSERT INTO cuentas_preasignadas (email, rol, es_plataforma, area_id) VALUES ('dueno@ejemplo.com', 'superadmin', true, $1)`, [ctx.area]);
  usarVerificador(async token => token);
  const [p] = await pool.query(`SELECT * FROM gyc_alta_usuario('user_dueno', 'Dueño', 'Dueno@Ejemplo.com')`).then(r => r.rows);
  assert.equal(p.rol, 'superadmin');
  assert.equal(p.es_plataforma, true);
  assert.equal(p.area_id, ctx.area);
  const plat = await cliente('user_dueno').adminUsuarios('plataforma');
  assert.ok(plat.areas.length >= 1);
});

test('tres niveles: el administrador del proyecto gestiona sus miembros; un miembro no', async () => {
  const [p] = await A.insert('proyectos', { codigo: 'N3', nombre_corto: 'Nivel 3', estado: 'activo' });
  await A.insert('proyecto_lideres', [{ proyecto_id: p.id, usuario_id: 'user_lider', rol: 'administrador' }]);
  // nivel 3: agrega a otra persona y le cambia el rol
  await B.insert('proyecto_lideres', [{ proyecto_id: p.id, usuario_id: 'user_dueno', rol: 'miembro' }]);
  await B.updateWhere('proyecto_lideres', { eq: { proyecto_id: p.id, usuario_id: 'user_dueno' } }, { rol: 'administrador' });
  await B.updateWhere('proyecto_lideres', { eq: { proyecto_id: p.id, usuario_id: 'user_dueno' } }, { rol: 'miembro' });
  // un líder que no administra otro proyecto no puede tocar sus miembros
  const [otro] = await A.insert('proyectos', { codigo: 'OTRO', nombre_corto: 'Otro', estado: 'activo' });
  await assert.rejects(B.insert('proyecto_lideres', [{ proyecto_id: otro.id, usuario_id: 'user_lider' }]), /administradores del proyecto/);
  await assert.rejects(B.removeWhere('proyecto_lideres', { eq: { usuario_id: 'user_lider' } }), /proyecto_id/);
  // al dejar de ser administrador pierde el permiso
  await A.updateWhere('proyecto_lideres', { eq: { proyecto_id: p.id, usuario_id: 'user_lider' } }, { rol: 'miembro' });
  await assert.rejects(B.removeWhere('proyecto_lideres', { eq: { proyecto_id: p.id, usuario_id: 'user_dueno' } }), /administradores del proyecto/);
  // «lideres» de la plataforma conserva el rol de quienes siguen
  await A.updateWhere('proyecto_lideres', { eq: { proyecto_id: p.id, usuario_id: 'user_lider' } }, { rol: 'administrador' });
  await A.adminUsuarios('lideres', { proyecto_id: p.id, usuario_ids: ['user_lider'] });
  const m = await A.list('proyecto_lideres', { eq: { proyecto_id: p.id } });
  assert.deepEqual(m.map(x => [x.usuario_id, x.rol]), [['user_lider', 'administrador']]);
});
