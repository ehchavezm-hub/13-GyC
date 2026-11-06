const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await ctx.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) errs.push(m); };
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(BASE + '?demo#/config/listas?lista=servicios'); await p.waitForTimeout(1300);
  const cols = await p.$$eval('.tabulator-col-title', t => t.map(x => x.textContent).filter(Boolean));
  console.log('  columnas:', cols.join(' | '));
  chk(cols.join('|') === 'Proyecto|Código (CET)|Servicio|Orden|Activo', 'orden Proyecto, Código (CET), Servicio');
  // asignar D-101 al primer servicio
  await p.evaluate(() => { const t = Tabulator.findTable('.grilla-tabla')[0]; const db = JSON.parse(localStorage.getItem('lpsgt-demo-db'));
    t.getRows()[0].getCell('_proyecto').setValue(db.proyectos.find(x => x.codigo === 'D-101').id); });
  await p.waitForTimeout(1200);
  // segunda pestaña: crear proyecto y renombrar D-101
  const p2 = await ctx.newPage();
  await p2.goto(BASE + '?demo#/proyectos'); await p2.waitForTimeout(1500);
  await p2.click('[data-a="nuevo"]'); await p2.waitForTimeout(300);
  await p2.fill('.modal input[name="codigo"]', 'SYNC-1'); await p2.fill('.modal input[name="nombre_corto"]', 'Proyecto sincronizado');
  await p2.selectOption('.modal select[name="gerencia_id"]', { index: 1 }); await p2.click('.modal-pie button:has-text("Crear")'); await p2.waitForTimeout(800);
  await p2.evaluate(() => { const t = Tabulator.findTable('.grilla-tabla')[0]; t.getRows().find(r => r.getData().codigo === 'D-101').getCell('nombre_corto').setValue('Hospital Renombrado'); });
  await p2.waitForTimeout(1500);
  await p.bringToFront(); await p.waitForTimeout(1500);
  const opciones = await p.evaluate(async () => (await import('./js/core/store.js')).opcionesProyectos().map(o => o.label));
  chk(opciones.some(x => x.includes('SYNC-1')), 'el proyecto creado en otra pestaña aparece en el combo');
  const etiqueta = await p.evaluate(() => Tabulator.findTable('.grilla-tabla')[0].getRows()[0].getCell('_proyecto').getElement().textContent);
  chk(etiqueta.includes('Hospital Renombrado'), 'el nombre del proyecto se actualiza en la lista: ' + etiqueta);
  await p.screenshot({ path: 'shots3/cet_orden.png' });
  console.log(errs.length ? 'ERRORES:\n' + errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
