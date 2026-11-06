const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
const IN = __dirname + '/../in/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/404|ERR_FAILED|fonts/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.route('**/fonts.g*/**', r => r.abort());
  await p.goto(BASE + '?demo'); await p.waitForTimeout(500);
  await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&u=1#/'); await p.waitForSelector('.usuarios-demo button');
  await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1200);
  // realtime: segunda pestaña
  const p2 = await ctx.newPage();
  await p2.goto(BASE + '?demo#/plan'); await p2.waitForTimeout(1500);
  await p.goto(BASE + '?demo#/plan'); await p.waitForTimeout(1500);
  const id = await p.evaluate(() => { const t = Tabulator.findTable('.grilla-tabla')[0]; const r = t.getRows()[0]; r.update({ descripcion: 'Cambio en vivo' }); return r.getData().id; });
  await p.waitForTimeout(2000);
  const visto = await p2.evaluate(id => Tabulator.findTable('.grilla-tabla')[0].getRow(id)?.getData().descripcion, id);
  console.log(visto === 'Cambio en vivo' ? 'OK tiempo real entre pestañas' : 'FALLA tiempo real: ' + visto);
  await p2.close();
  for (const f of ['la.xlsx', 'lps.xlsm']) {
    await p.goto(BASE + '?demo#/config/importar'); await p.waitForTimeout(1200);
    await p.setInputFiles('[data-f="hist"]', IN + f);
    await p.waitForSelector('.modal', { timeout: 60000 });
    console.log(f, (await p.textContent('[data-res-hist]')).trim());
    await p.click('.modal-pie button:has-text("Importar")');
    await p.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 240000 });
    console.log('  ', (await p.textContent('[data-res-hist]')).trim());
  }
  await p.goto(BASE + '?demo#/tablero'); await p.waitForTimeout(2000);
  await p.selectOption('select >> nth=0', { index: 3 }).catch(() => {});
  await p.waitForTimeout(1500);
  await p.screenshot({ path: __dirname + '/shots3/imp_tablero.png' });
  console.log(errs.length ? errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
