const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(B + '?demo#/plan'); await p.waitForTimeout(1300);
  const cols = await p.$$eval('.tabulator-col-title', t => t.map(x => x.textContent).filter(Boolean));
  console.log('columnas:', cols.slice(0, 4).join(' | '));
  console.log('celda:', await p.$eval('.tabulator-row .tabulator-cell[tabulator-field="semana"]', c => c.textContent));
  await p.click('[data-a="sig"]'); await p.waitForTimeout(1300);
  console.log('siguiente:', await p.textContent('[data-semana]'), '·', await p.$eval('.tabulator-row .tabulator-cell[tabulator-field="semana"]', c => c.textContent).catch(() => '(sin filas)'));
  console.log('filas:', JSON.stringify(await p.evaluate(() => Tabulator.findTable('.grilla-tabla')[0].getData().map(r => [r.id ? 'id' : 'nueva', r.semana, r.descripcion]))));
  console.log(errs.length ? errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
