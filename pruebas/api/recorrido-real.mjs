// Recorre todas las pantallas en MODO REAL (adapter-api.js → api/ → PostgreSQL) con una sesión de Clerk simulada.
// Falla si una pantalla pide una tabla, columna o acción que el API o la base no tienen, o si hay errores de JavaScript.
// Uso: 1) DATABASE_URL_PRUEBAS=… node pruebas/api/servidor-local.mjs 8098 --reiniciar
//      2) node pruebas/api/recorrido-real.mjs [http://localhost:8098/]
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8098/';
const RUTAS = ['/plan', '/lookahead', '/backlog', '/restricciones', '/cartera', '/tablero', '/reunion',
  '/informacion-proyecto', '/programa-arranque', '/proyectos', '/config/usuarios', '/config/listas', '/config/parametros', '/config/permisos',
  '/config/columnas', '/config/importar', '/config/respaldo', '/config/auditoria', '/config/empresas', '/reportes', '/admin'];
// Pantallas retiradas del menú (pedidos a5 y a6): no deben aparecer
const RETIRADAS = ['Plantillas', 'Ayuda', 'Mejoras del aplicativo', 'Equipo y capacidad', 'Todas las empresas'];

// Clerk simulado: el "token" es el id del usuario (el servidor local lo acepta así)
const clerkFalso = usuario => `window.Clerk = { loaded: true, user: { id: '${usuario}', updatePassword: async () => {} },
  session: { getToken: async () => '${usuario}' }, addListener() { return () => {}; }, load: async () => {},
  signOut: async () => {}, mountSignIn() {} };`;

// Preparación por el API: el primer ingreso es el super administrador; los demás reciben su rol
const api = (usuario, ruta, cuerpo) => fetch(new URL(`api/${ruta}`, BASE), {
  method: 'POST', headers: { authorization: `Bearer ${usuario}`, 'content-type': 'application/json' }, body: JSON.stringify(cuerpo),
}).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(`${ruta}: ${j.error}`); return j; });
const [yo] = await api('user_admin', 'datos', { accion: 'list', tabla: 'profiles', eq: { id: 'user_admin' } });
if (yo.rol !== 'superadmin') throw new Error('Use una base reiniciada (servidor-local.mjs --reiniciar): user_admin debe ser el primer ingreso.');
for (const [u, rol] of [['user_lider', 'lider'], ['user_consulta', 'consulta']]) {
  await api(u, 'datos', { accion: 'list', tabla: 'profiles', eq: { id: u } });
  await api('user_admin', 'datos', { accion: 'update', tabla: 'profiles', id: u, data: { rol, nombre: u, tour_visto: true } });
}
await api('user_admin', 'datos', { accion: 'update', tabla: 'profiles', id: 'user_admin', data: { tour_visto: true } });
const [proy] = await api('user_admin', 'datos', { accion: 'list', tabla: 'proyectos' });
await api('user_admin', 'admin-usuarios', { accion: 'lideres', proyecto_id: proy.id, usuario_ids: ['user_admin', 'user_lider'] });
const hoy = new Date(); hoy.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
const semana = hoy.toISOString().slice(0, 10);
await api('user_lider', 'datos', { accion: 'insert', tabla: 'actividades', data: [{ semana, responsable_id: 'user_lider', proyecto_id: proy.id, descripcion: 'Encofrado', hh_lu: 4, comprometida: true }] });
await api('user_lider', 'datos', { accion: 'insert', tabla: 'restricciones', data: [{ proyecto_id: proy.id, descripcion: 'Falta plano', responsable_id: 'user_lider' }] });

const opciones = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};
const navegador = await chromium.launch(opciones);
const errores = [];
let pantallas = 0;

// Pantalla de ingreso: sin modo demostración y, si Clerk no carga, un aviso en lugar de una caja en blanco
{
  const ctx = await navegador.newContext({ serviceWorkers: 'block' });
  const pagina = await ctx.newPage();
  await pagina.route('**/clerk.browser.js', r => r.abort());
  await pagina.goto(BASE);
  const aviso = await pagina.locator('.login .aviso.error').textContent({ timeout: 15000 }).catch(() => null);
  if (!aviso || !/Clerk/.test(aviso)) errores.push(`ingreso: sin aviso cuando Clerk no carga (${aviso})`);
  if (await pagina.getByText(/demostraci/i).count()) errores.push('ingreso: todavía ofrece el modo demostración');
  // Con Clerk disponible y sin sesión se monta el formulario
  await pagina.unroute('**/clerk.browser.js');
  let montado = false;
  await pagina.exposeFunction('__montado', () => { montado = true; });
  await pagina.route('**/clerk.browser.js', r => r.fulfill({ contentType: 'text/javascript', body: `window.Clerk = { loaded: true, user: null,
    session: null, addListener() { return () => {}; }, load: async () => {}, mountSignIn(el) { el.innerHTML = '<form>Ingreso</form>'; window.__montado(); } };` }));
  await pagina.reload();
  await pagina.waitForTimeout(1500);
  if (!montado) errores.push('ingreso: no se montó el formulario de Clerk');
  await ctx.close();
  console.log('✔ pantalla de ingreso');
}

for (const usuario of ['user_admin', 'user_lider', 'user_consulta']) {
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const pagina = await ctx.newPage();
  pagina.on('pageerror', e => errores.push(`[${usuario}] JS: ${e.message} @ ${pagina.url()}`));
  pagina.on('console', m => {
    if (m.type() === 'error' && !/favicon|fonts|ERR_FAILED|404/.test(m.text())) errores.push(`[${usuario}] consola: ${m.text()} @ ${pagina.url()}`);
  });
  pagina.on('response', async r => {
    if (r.url().includes('/api/') && r.status() >= 400) {
      const cuerpo = await r.text().catch(() => '');
      const pedido = r.request().postData() || '';
      // 403 por rol es esperado (consulta, líder); lo demás es una incompatibilidad
      if (r.status() !== 403) errores.push(`[${usuario}] API ${r.status()}: ${cuerpo.slice(0, 200)} ← ${pedido.slice(0, 200)} @ ${pagina.url()}`);
    }
  });
  await pagina.route('**/clerk.browser.js', r => r.fulfill({ contentType: 'text/javascript', body: clerkFalso(usuario) }));
  await pagina.route('**/fonts.g*/**', r => r.abort());
  for (const ruta of RUTAS) {
    await pagina.goto(`${BASE}#${ruta}`);
    await pagina.waitForTimeout(1200);
    pantallas++;
    const aviso = await pagina.locator('.toast.error, .aviso.error').first().textContent({ timeout: 300 }).catch(() => null);
    if (aviso) errores.push(`[${usuario}] aviso de error: ${aviso.trim()} @ ${ruta}`);
  }
  await ctx.close();
  console.log(`✔ ${usuario}`);
}
// Estilos: ninguna hoja vacía y la página con diseño aplicado
for (const css of ['css/app.css', 'css/admin.css', 'vendor/tabulator.min.css']) {
  const t = await fetch(new URL(css, BASE)).then(r => r.ok ? r.text() : '');
  if (t.length < 1000) errores.push(`estilos: ${css} está vacío o no existe (${t.length} bytes)`);
}
// Programa de arranque del proyecto elegido: sus 81 ítems
{
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const pagina = await ctx.newPage();
  await pagina.route('**/clerk.browser.js', r => r.fulfill({ contentType: 'text/javascript', body: clerkFalso('user_admin') }));
  await pagina.addInitScript(id => localStorage.setItem('gyc-proyecto', id), proy.id);
  await pagina.goto(`${BASE}#/programa-arranque`);
  await pagina.waitForTimeout(2500);
  const filas = await pagina.locator('[data-item-row]').count();
  if (filas !== 81) errores.push(`programa de arranque: ${filas} ítems en pantalla (se esperaban 81)`);
  const menu = await pagina.locator('nav, .lateral, aside').first().innerText().catch(() => '');
  for (const r of RETIRADAS) if (menu.includes(r)) errores.push(`menú: todavía aparece «${r}»`);
  if (!menu.includes('Información del proyecto')) errores.push('menú: falta «Información del proyecto»');
  // Edición: % avance (verde, reunión de seguimiento) e inicio programado (amarillo, definición)
  await pagina.locator('[data-modo="seguimiento"]').click();
  await pagina.locator('[data-item-row="1"] [data-campo="avance"]').click();
  await pagina.locator('[data-item-row="1"] [data-campo="avance"] input').fill('40');
  await pagina.keyboard.press('Enter');
  await pagina.waitForTimeout(800);
  if (!(await pagina.locator('[data-item-row="1"] [data-campo="avance"]').innerText()).includes('40%')) errores.push('programa de arranque: el avance no se muestra');
  if (!(await pagina.locator('[data-item-row="1"] .pa-estado').innerText()).includes('En curso')) errores.push('programa de arranque: estado del ítem 1 no es «En curso»');
  // Ficha lateral con su historial
  await pagina.locator('[data-ficha="1"]').click();
  await pagina.waitForTimeout(300);
  if (!(await pagina.locator('.pa-ficha .pa-linea li').count())) errores.push('programa de arranque: la ficha no muestra el historial');
  await pagina.keyboard.press('Escape');
  // Curva S (q32): pestaña a la derecha de "+ Reunión", con su gráfico y resumen
  await pagina.locator('[data-modo="curva"]').click();
  await pagina.waitForTimeout(1200);
  // Sin ítems con fechas programadas, la pestaña pide completarlas; con fechas, dibuja la curva y su resumen
  const textoCurva = await pagina.locator('[data-tabla]').innerText().catch(() => '');
  const hayCurva = await pagina.locator('.pa-curva canvas').count();
  if (!(hayCurva && textoCurva.includes('Programado')) && !textoCurva.includes('Inicio prog. y Fin prog.')) errores.push('curva S: ni gráfico ni aviso de fechas');
  // PDF (q34): vista previa con la Curva S y las tablas por proceso
  await pagina.locator('[data-a="pdf"]').click();
  await pagina.waitForTimeout(1500);
  const docPdf = await pagina.locator('.vista-pdf iframe').evaluate(f => f.srcdoc).catch(() => '');
  if (!docPdf.includes('Curva S') || (docPdf.match(/<h3>/g) || []).length < 10) errores.push('PDF: no incluye la Curva S o los procesos');
  await pagina.keyboard.press('Escape');
  await pagina.locator('[data-modo="definicion"]').click();
  // Aplica (lista Si / N/A): el ítem opcional 6 parte en N/A y se cambia a Si
  if (!(await pagina.locator('[data-item-row="6"] [data-campo="aplica"]').innerText()).includes('N/A')) errores.push('programa de arranque: el ítem opcional 6 no parte en N/A');
  await pagina.locator('[data-item-row="6"] [data-campo="aplica"]').click();
  await pagina.locator('[data-item-row="6"] [data-campo="aplica"] select').selectOption('si');
  await pagina.waitForTimeout(800);
  if (!(await pagina.locator('[data-item-row="6"] [data-campo="aplica"]').innerText()).includes('Si')) errores.push('programa de arranque: Aplica no se guardó');
  await pagina.locator('[data-item-row="1a"] [data-campo="inicio_programado"]').click();
  await pagina.locator('[data-item-row="1a"] [data-campo="inicio_programado"] input').fill('2026-07-06');
  await pagina.keyboard.press('Enter');
  await pagina.waitForTimeout(800);
  const [pa] = await api('user_admin', 'datos', { accion: 'list', tabla: 'programa_arranque', eq: { proyecto_id: proy.id } });
  const seg = await api('user_admin', 'datos', { accion: 'list', tabla: 'programa_arranque_seguimiento', eq: { programa_id: pa.id, item_codigo: '1' } });
  if (seg[0]?.avance !== 40) errores.push(`programa de arranque: el avance no se guardó (${JSON.stringify(seg[0])})`);
  const [det] = await api('user_admin', 'datos', { accion: 'list', tabla: 'programa_arranque_detalle', eq: { programa_id: pa.id, item_codigo: '1a' } });
  if (det?.inicio_programado !== '2026-07-06' || det?.fin_programado !== '2026-10-04') {
    errores.push(`programa de arranque: inicio/fin programado mal guardados (${det?.inicio_programado} / ${det?.fin_programado})`);
  }
  const fondo = await pagina.evaluate(() => getComputedStyle(document.querySelector('.cabecera') || document.body).display);
  if (!fondo || fondo === 'block') errores.push(`estilos: la cabecera no tiene diseño aplicado (display=${fondo})`);
  await ctx.close();
  console.log(`✔ programa de arranque (${filas} ítems) y estilos`);
}
// Tres niveles de administración (pedido a7): qué ve cada persona en la consola
await api('user_admin', 'datos', { accion: 'updateWhere', tabla: 'proyecto_lideres', eq: { proyecto_id: proy.id, usuario_id: 'user_lider' }, data: { rol: 'administrador' } });
for (const [usuario, debe, noDebe] of [
  ['user_admin', ['Nivel 1', 'Nivel 2', 'Nivel 3'], []],
  ['user_lider', ['Nivel 3', 'Miembros del proyecto'], ['Nivel 1', 'Nivel 2']],
]) {
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const pagina = await ctx.newPage();
  pagina.on('pageerror', e => errores.push(`[${usuario}] JS en administración: ${e.message}`));
  await pagina.route('**/clerk.browser.js', r => r.fulfill({ contentType: 'text/javascript', body: clerkFalso(usuario) }));
  await pagina.goto(`${BASE}#/admin`);
  await pagina.waitForTimeout(2500);
  const texto = (await pagina.locator('.admin-nav').innerText().catch(() => '')).toLowerCase();
  for (const t of debe) if (!texto.includes(t.toLowerCase())) errores.push(`[${usuario}] administración: falta «${t}»`);
  for (const t of noDebe) if (texto.includes(t.toLowerCase())) errores.push(`[${usuario}] administración: no debería ver «${t}»`);
  if (usuario === 'user_lider' && !(await pagina.locator('[data-quitar]').count())) errores.push('[user_lider] nivel 3: no se listan los miembros');
  await ctx.close();
}
{
  const ctx = await navegador.newContext({ serviceWorkers: 'block' });
  const pagina = await ctx.newPage();
  await pagina.route('**/clerk.browser.js', r => r.fulfill({ contentType: 'text/javascript', body: clerkFalso('user_consulta') }));
  await pagina.goto(`${BASE}#/tablero`);
  await pagina.waitForTimeout(2000);
  if ((await pagina.locator('body').innerText()).includes('Administración')) errores.push('[user_consulta] ve «Administración» sin administrar nada');
  await ctx.close();
}
console.log('✔ tres niveles de administración');
await navegador.close();
console.log(`${pantallas} pantallas recorridas en modo real`);
if (errores.length) { console.log([...new Set(errores)].join('\n')); process.exit(1); }
console.log('SIN ERRORES');
