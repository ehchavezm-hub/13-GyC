const { chromium } = require('playwright');
const SH = require('path').join(__dirname, 'salida') + '/' + '';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.evaluate(async () => { const { api } = await import('./js/data/api.js'); const { store } = await import('./js/core/store.js');
    await api.adminUsuarios('estructura', { tabla: 'proyectos', area_id: store.area.id, datos: { codigo: 'VAC-1', nombre_corto: 'Proyecto vacío' } }); });
  await p.goto(B + '?demo&a=1#/admin'); await p.waitForTimeout(1200);
  await p.click('.admin-item:has-text("Estructura de todas")'); await p.waitForTimeout(700);
  await p.click('[data-vista="arbol"]'); await p.waitForTimeout(400);
  const n0 = await p.locator('.org-proyecto').count();
  // 1) sin trabajo: una confirmación
  const c1 = p.locator('.org-proyecto:has-text("Proyecto vacío")');
  await c1.hover(); await c1.locator('.org-borrar').click(); await p.waitForTimeout(300);
  console.log('confirmación:', (await p.locator('.modal').last().innerText()).replace(/\s+/g, ' ').slice(0, 110));
  await p.locator('.modal').last().locator('.btn-primario, .btn-peligro').last().click(); await p.waitForTimeout(800);
  // 2) con historial: pide el nombre
  const c2 = p.locator('.org-proyecto:has-text("Hospital Demo Norte")');
  await c2.hover(); await c2.locator('.org-borrar').click(); await p.waitForTimeout(500);
  console.log('aviso:', (await p.locator('.modal .aviso').innerText()).replace(/\s+/g, ' ').slice(0, 150));
  await p.screenshot({ path: SH + 'borrar_proy.png' });
  await p.locator('.modal [name="confirmacion"]').fill('Hospital Demo Norte'); await p.click('.modal-pie .btn-primario'); await p.waitForTimeout(900);
  console.log('tarjetas de proyecto:', n0, '→', await p.locator('.org-proyecto').count());
  const quedan = await p.evaluate(async () => { const { api } = await import('./js/data/api.js'); const acts = await api.list('actividades', {});
    return acts.filter(a => a.descripcion && a.proyecto_id === null).length + ' sin proyecto · total ' + acts.length; });
  console.log('actividades:', quedan);
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
