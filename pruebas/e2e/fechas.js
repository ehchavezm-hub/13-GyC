// Editar fechas en las grillas (calendario del navegador): antes fallaba con «luxon is not defined».
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1700, height: 1000 }, serviceWorkers: 'block' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  const fallas = []; const chk = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallas.push(m); };
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(B + '?demo#/config/listas?lista=__proyectos'); await p.waitForTimeout(2000);
  const fila = p.locator('[data-grilla="activo"] .tabulator-row').first();
  const codigo = (await fila.locator('[tabulator-field="codigo"]').innerText()).trim();
  await fila.locator('[tabulator-field="fecha_inicio"]').dblclick(); await p.waitForTimeout(300);
  await fila.locator('[tabulator-field="fecha_inicio"] input').fill('2026-12-07'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  const v = await p.evaluate(async c => (await (await import('./js/data/api.js')).api.list('proyectos', {})).find(x => x.codigo === c)?.fecha_inicio, codigo);
  chk(v === '2026-12-07', `fecha de inicio del proyecto ${codigo} guardada (${v})`);
  console.log(errs.length || fallas.length ? ['ERRORES', ...errs, ...fallas] : 'SIN ERRORES');
  await b.close();
})();
