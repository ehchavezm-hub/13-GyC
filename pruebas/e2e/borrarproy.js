const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) errs.push(m); };
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('lpsgt-demo-db')));
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  // crear proyecto sin historial
  await p.goto(BASE + '?demo#/proyectos'); await p.waitForTimeout(1200);
  await p.click('[data-a="nuevo"]'); await p.waitForTimeout(300);
  await p.fill('.modal input[name="codigo"]', 'ERR-1'); await p.fill('.modal input[name="nombre_corto"]', 'Creado por error');
  await p.selectOption('.modal select[name="gerencia_id"]', { index: 1 }); await p.click('.modal-pie button:has-text("Crear")'); await p.waitForTimeout(1200);
  // eliminar desde la grilla (clic derecho → Eliminar fila)
  await p.click('.tabulator-row:has-text("ERR-1") .tabulator-cell[tabulator-field="nombre_corto"]', { button: 'right' }); await p.waitForTimeout(300);
  await p.click('.tabulator-menu-item:has-text("Eliminar")'); await p.waitForTimeout(300);
  await p.click('.modal-pie button:has-text("Eliminar")'); await p.waitForTimeout(500);
  await p.click('.modal-pie button:has-text("Eliminar definitivamente")'); await p.waitForTimeout(1500);
  chk(!(await db()).proyectos.some(x => x.codigo === 'ERR-1'), 'proyecto sin historial eliminado (con segunda confirmación)');
  // con historial: D-101 → ofrece desactivar
  await p.click('.tabulator-row:has(.tabulator-cell[tabulator-field="codigo"]:text-is("D-101")) .tabulator-cell[tabulator-field="nombre_corto"]', { button: 'right' }); await p.waitForTimeout(300);
  await p.click('.tabulator-menu-item:has-text("Eliminar")'); await p.waitForTimeout(300);
  await p.click('.modal-pie button:has-text("Eliminar")'); await p.waitForTimeout(1200);
  const txt = await p.textContent('.modal .modal-cuerpo');
  console.log('  aviso:', txt.slice(0, 170));
  await p.click('.modal-pie button:has-text("Desactivar")'); await p.waitForTimeout(1500);
  const d101 = (await db()).proyectos.find(x => x.codigo === 'D-101');
  chk(d101 && d101.estado === 'cerrado', 'con historial: no se elimina, se desactiva');
  chk(!(await p.textContent('.proy-lista')).includes('Hospital Demo Norte'), 'desactivado no aparece en el menú de proyectos');
  // historial sigue mostrando el nombre
  await p.goto(BASE + '?demo#/plan?semana=' + (await p.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 7 - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); }))); await p.waitForTimeout(1500);
  const etiquetas = await p.evaluate(() => [...document.querySelectorAll('.tabulator-cell[tabulator-field="proyecto_id"]')].map(c => c.textContent));
  chk(etiquetas.some(x => x.includes('D-101') && x.includes('desactivado')), 'actividades antiguas siguen mostrando el proyecto desactivado');
  // reactivar desde la ficha
  await p.goto(BASE + '?demo#/proyectos/' + d101.id); await p.waitForTimeout(1300);
  await p.click('[data-a="reactivar"]'); await p.waitForTimeout(1500);
  chk((await db()).proyectos.find(x => x.codigo === 'D-101').estado === 'activo', 'reactivado desde la ficha');
  // líder no ve opciones
  console.log(errs.length ? 'ERRORES:\n' + errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
