const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) errs.push(m); };
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  const nav = await p.$$eval('.nav a', a => a.map(x => x.textContent.trim()));
  chk(!nav.some(x => /^🏗?\s*Proyectos$/.test(x) || x.endsWith('Proyectos')), 'menú lateral sin "Proyectos": ' + nav.join(', '));
  chk(!!(await p.$('.menu-proy')), 'el selector de proyectos de la barra lateral se mantiene');
  await p.goto(BASE + '?demo#/config/listas'); await p.waitForTimeout(1200);
  await p.selectOption('[data-l]', '__proyectos'); await p.waitForTimeout(1500);
  chk(p.url().includes('#/config/listas') && (await p.$$('[data-grilla]')).length === 3, 'catálogo con sus tres ventanas dentro de Configuración → Listas');
  // nuevo proyecto desde ahí
  await p.click('[data-a="nuevo"]'); await p.waitForTimeout(300);
  await p.fill('.modal input[name="codigo"]', 'CFG-1'); await p.fill('.modal input[name="nombre_corto"]', 'Desde configuración');
  await p.selectOption('.modal select[name="gerencia_id"]', { index: 1 }); await p.click('.modal-pie button:has-text("Crear")'); await p.waitForTimeout(1500);
  chk(p.url().includes('#/config/listas') && (await p.evaluate(() => Tabulator.findTable('[data-grilla="activo"] .grilla-tabla')[0].getData().some(r => r.codigo === 'CFG-1'))), 'crea el proyecto y sigue en Configuración');
  // ficha y volver
  await p.click('[data-grilla="activo"] .tabulator-row:has(.tabulator-cell[tabulator-field="codigo"]:text-is("CFG-1")) .mini-btn:not(.mini-peligro)'); await p.waitForTimeout(1200);
  await p.click('a:has-text("‹ Proyectos")'); await p.waitForTimeout(1500);
  chk(p.url().includes('lista=__proyectos') && (await p.$$('[data-grilla]')).length === 3, '"‹ Proyectos" vuelve al catálogo en Configuración');
  // otra lista sigue funcionando
  await p.selectOption('[data-l]', 'gerencias'); await p.waitForTimeout(1000);
  chk((await p.$$('[data-grilla]')).length === 0 && !!(await p.$('.grilla-tabla')), 'cambiar a otra lista funciona');
  // ruta antigua redirige
  await p.goto(BASE + '?demo#/proyectos'); await p.waitForTimeout(1500);
  chk(p.url().includes('lista=__proyectos'), 'la dirección antigua #/proyectos lleva al catálogo en Configuración');
  console.log(errs.length ? 'ERRORES:\n' + errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
