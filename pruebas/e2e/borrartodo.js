const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) errs.push(m); };
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('lpsgt-demo-db')));
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(BASE + '?demo#/proyectos'); await p.waitForTimeout(1500);
  const id = (await db()).proyectos.find(x => x.codigo === 'D-103').id;
  const antes = (await db()).actividades.filter(a => a.proyecto_id === id).length;
  await p.click('[data-grilla="activo"] .tabulator-row:has(.tabulator-cell[tabulator-field="codigo"]:text-is("D-103")) .mini-peligro'); await p.waitForTimeout(800);
  console.log('  aviso:', (await p.textContent('.modal .modal-cuerpo')).replace(/\s+/g, ' ').slice(0, 200));
  await p.screenshot({ path: 'shots3/borrar_todo1.png' });
  await p.click('.modal-pie button:has-text("Eliminar con todo su historial")'); await p.waitForTimeout(500);
  await p.fill('.modal [data-cod]', 'D-10X'); await p.click('.modal-pie button:has-text("Eliminar definitivamente")'); await p.waitForTimeout(500);
  chk(!!(await p.$('.modal [data-cod]')), 'código incorrecto: no elimina');
  await p.fill('.modal [data-cod]', 'D-103'); await p.click('.modal-pie button:has-text("Eliminar definitivamente")'); await p.waitForTimeout(2000);
  const d = await db();
  chk(!d.proyectos.some(x => x.codigo === 'D-103') && !d.actividades.some(a => a.proyecto_id === id), `D-103 eliminado con sus ${antes} actividades`);
  chk(!(await p.evaluate(() => Tabulator.findTable('[data-grilla="activo"] .grilla-tabla')[0].getData().map(r => r.codigo))).includes('D-103'), 'desaparece de la ventana Activos');
  console.log('  toasts:', await p.$$eval('.toast', t => t.map(x => x.textContent).join(' | ')));
  // líder: no ve "eliminar con historial"
  console.log(errs.length ? 'ERRORES:\n' + errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
