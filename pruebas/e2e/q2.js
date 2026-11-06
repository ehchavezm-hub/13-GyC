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
  await p.goto(B + '?demo&a=1#/admin'); await p.waitForTimeout(1200);
  await p.click('.admin-item:has-text("Estructura de todas")'); await p.waitForTimeout(800);
  console.log('subtítulo:', (await p.locator('#admin-contenido .nota, #admin-contenido p').first().innerText()).slice(0, 80));
  // 1) botón de arriba
  await p.click('[data-a="nuevo-sub"]'); await p.waitForTimeout(300);
  await p.locator('.modal [name="padre_id"]').selectOption({ index: 1 });
  console.log('proyecto elegido:', await p.locator('.modal [name="padre_id"]').evaluate(s => s.selectedOptions[0].textContent));
  await p.click('.modal-pie .btn-primario'); await p.waitForTimeout(500);
  console.log('formulario:', await p.locator('.modal').last().locator('h2, .modal-titulo').first().innerText().catch(() => '?'));
  await p.locator('.modal [name="codigo"]').fill('SP-1'); await p.locator('.modal [name="nombre_corto"]').fill('Frente Norte');
  await p.click('.modal-pie .btn-primario'); await p.waitForTimeout(800);
  // 2) + en la tarjeta del organigrama
  await p.click('[data-vista="arbol"]'); await p.waitForTimeout(500);
  console.log('botones + en proyectos:', await p.locator('.org-mas').count(), '· tarjetas de proyecto:', await p.locator('.org-proyecto').count());
  await p.locator('.org-mas').nth(1).click(); await p.waitForTimeout(300);
  console.log('formulario +:', await p.locator('.modal').last().locator('h2, .modal-titulo').first().innerText().catch(() => '?'));
  await p.locator('.modal [name="codigo"]').fill('SP-2'); await p.locator('.modal [name="nombre_corto"]').fill('Frente Sur');
  await p.click('.modal-pie .btn-primario'); await p.waitForTimeout(800);
  console.log('Grupos LPS en organigrama:', await p.locator('.org-subproyecto').count(), '·', (await p.locator('.org-subproyecto').allInnerTexts()).map(t => t.split('\n')[0]).join(', '));
  console.log('chips:', (await p.locator('.chips-cifras').innerText()).replace(/\s+/g, ' '));
  await p.locator('.org-arbol').first().screenshot({ path: SH + 'q2.png' });
  // el Grupo LPS aparece para registrar LPS
  const ops = await p.evaluate(async () => (await import('./js/core/store.js')).opcionesProyectos().map(o => o.label).filter(l => /Frente/.test(l)));
  console.log('en el selector del LPS:', ops);
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
