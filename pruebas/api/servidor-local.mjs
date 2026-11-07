// Servidor local de desarrollo y pruebas: sirve app/ y ejecuta las Vercel Functions de api/ contra un PostgreSQL local
// (node-postgres en lugar del driver HTTP de Neon). La sesión de Clerk se simula: el token es el id del usuario.
// Uso: DATABASE_URL_PRUEBAS=postgres://… node pruebas/api/servidor-local.mjs [puerto] [--reiniciar]
// Nunca apunte DATABASE_URL_PRUEBAS a producción.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { usarEjecutor, configurarTipos } from '../../api/_lib/db.js';
import { usarVerificador } from '../../api/_lib/auth.js';

configurarTipos(pg.types);   // igual que en producción (api/_lib/db.js)
const URL_BD = process.env.DATABASE_URL_PRUEBAS;
if (!URL_BD) throw new Error('Defina DATABASE_URL_PRUEBAS (PostgreSQL local).');
if (/neon\.tech|vercel/i.test(URL_BD)) throw new Error('DATABASE_URL_PRUEBAS parece producción: use un PostgreSQL local.');

const PUERTO = Number(process.argv.find(a => /^\d+$/.test(a)) || 8098);
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const pool = new pg.Pool({ connectionString: URL_BD, max: 8 });

if (process.argv.includes('--reiniciar')) {
  const c = await pool.connect();
  try {
    await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    for (const m of ['000_gyc_neon_completo.sql', '035_compatibilidad_api.sql', '036_cuentas_preasignadas.sql', '037_programa_arranque_r1.sql', '038_administracion_tres_niveles.sql', '039_paleta_tableau.sql', '040_aplica.sql']) {
      await c.query(readFileSync(path.join(RAIZ, 'db/migrations', m), 'utf8'));
    }
  } finally { c.release(); }
  console.log('Base reiniciada con 000 + 035 + 036 + 037 + 038 + 039 + 040.');
}

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

const funciones = {
  '/api/datos': (await import('../../api/datos.js')).default,
  '/api/admin-usuarios': (await import('../../api/admin-usuarios.js')).default,
  '/api/health': (await import('../../api/health.js')).default,
};
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const fn = funciones[url.pathname];
  if (fn) {
    // Igual que Vercel: req.body ya parseado y res.status().json()
    const partes = [];
    for await (const p of req) partes.push(p);
    try { req.body = partes.length ? JSON.parse(Buffer.concat(partes).toString()) : undefined; } catch { req.body = undefined; }
    res.status = s => { res.statusCode = s; return res; };
    res.json = j => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(j)); return res; };
    try { await fn(req, res); } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  const archivo = path.join(RAIZ, 'app', path.normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
  if (!archivo.startsWith(path.join(RAIZ, 'app'))) { res.statusCode = 403; return res.end(); }
  try {
    const cuerpo = await readFile(archivo);
    res.setHeader('Content-Type', TIPOS[path.extname(archivo)] || 'application/octet-stream');
    res.end(cuerpo);
  } catch { res.statusCode = 404; res.end('No encontrado'); }
}).listen(PUERTO, () => console.log(`GyC local: http://localhost:${PUERTO}/  (API contra ${URL_BD.replace(/:[^:@/]*@/, ':***@')})`));
