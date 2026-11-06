const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) errs.push(m); };
  const visibles = () => p.evaluate(() => Tabulator.findTable('.grilla-tabla')[0].getRows('active').map(r => r.getData().codigo));
  const pestanas = () => p.$$eval('[data-pestanas] button', b => b.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(BASE + '?demo#/proyectos'); await p.waitForTimeout(1300);
  console.log('  pestañas:', (await pestanas()).join(' | '));
  chk((await pestanas()).map(x => x.split(' ')[0]).join(',') === 'Activos,En,Cerrados', 'tres pestañas en orden Activos, En pausa, Cerrados');
  const antes = await visibles();
  chk(antes.includes('D-101'), 'D-101 en Activos');
  // opciones del combo de estado
  await p.dblclick('.tabulator-row:has(.tabulator-cell[tabulator-field="codigo"]:text-is("D-101")) .tabulator-cell[tabulator-field="estado"]'); await p.waitForTimeout(400);
  const ops = await p.$$eval('.tabulator-edit-list-item', o => o.map(x => x.textContent));
  chk(ops.join(',') === 'Activo,En pausa,Cerrado', 'estado solo Activo, En pausa, Cerrado: ' + ops.join(','));
  await p.click('.tabulator-edit-list-item:text-is("Cerrado")'); await p.waitForTimeout(800);
  chk(!(await visibles()).includes('D-101'), 'al pasar a Cerrado sale de inmediato de Activos');
  console.log('  pestañas:', (await pestanas()).join(' | '));
  await p.click('[data-pestanas] [data-e="cerrado"]'); await p.waitForTimeout(400);
  chk((await visibles()).includes('D-101'), 'aparece en Cerrados');
  await p.waitForTimeout(1200);
  chk((await p.evaluate(() => JSON.parse(localStorage.getItem('lpsgt-demo-db')).proyectos.find(x => x.codigo === 'D-101').estado)) === 'cerrado', 'estado guardado');
  // nueva fila en pestaña En pausa
  await p.click('[data-pestanas] [data-e="en_pausa"]'); await p.waitForTimeout(300);
  // borrar con doble confirmación: crear proyecto sin historial
  await p.click('[data-pestanas] [data-e="activo"]'); await p.waitForTimeout(300);
  await p.click('[data-a="nuevo"]'); await p.waitForTimeout(300);
  await p.fill('.modal input[name="codigo"]', 'DEL-1'); await p.fill('.modal input[name="nombre_corto"]', 'Para borrar');
  await p.selectOption('.modal select[name="gerencia_id"]', { index: 1 }); await p.click('.modal-pie button:has-text("Crear")'); await p.waitForTimeout(1500);
  const btn = await p.$('.tabulator-row:has-text("DEL-1") .mini-peligro');
  chk(!!btn, 'botón 🗑 visible en la fila');
  await btn.click(); await p.waitForTimeout(400);
  const t1 = await p.textContent('.modal h2'); await p.click('.modal-pie button:has-text("Sí, eliminar")'); await p.waitForTimeout(400);
  const t2 = await p.textContent('.modal h2'); await p.click('.modal-pie button:has-text("Eliminar definitivamente")'); await p.waitForTimeout(1500);
  console.log('  confirmaciones:', t1, '→', t2);
  chk(t1.includes('1 de 2') && t2.includes('2 de 2'), 'doble confirmación');
  chk(!(await p.evaluate(() => JSON.parse(localStorage.getItem('lpsgt-demo-db')).proyectos.some(x => x.codigo === 'DEL-1'))), 'proyecto eliminado');
  // con historial: 🗑 ofrece desactivar
  await p.click('.tabulator-row:has-text("D-102") .mini-peligro'); await p.waitForTimeout(800);
  chk((await p.textContent('.modal h2')).includes('No se puede eliminar'), 'con historial: no elimina y ofrece desactivar');
  await p.screenshot({ path: 'shots3/proy_pestanas.png' });
  console.log(errs.length ? 'ERRORES:\n' + errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
