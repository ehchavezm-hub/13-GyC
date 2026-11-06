const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await ctx.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(800);
  for (const ruta of ['lookahead', 'plan', 'restricciones', 'cartera', 'proyectos']) {
    await p.goto(B + '?demo&y=' + ruta + '#/' + (ruta === 'proyectos' ? 'config/listas?lista=__proyectos' : ruta)); await p.waitForTimeout(2000);
    const web = await p.$$eval('.tabulator-col', cs => cs.filter(c => c.offsetParent && c.getAttribute('tabulator-field')).map(c => c.querySelector('.tabulator-col-title').textContent.trim()).filter(Boolean));
    const [w] = await Promise.all([ctx.waitForEvent('page'), p.locator('button:has-text("PDF")').first().click()]);
    await w.waitForLoadState(); await w.waitForTimeout(600);
    const tablas = await w.$$eval('table', ts => ts.map(t => ({ cols: [...t.querySelectorAll('col')].map(c => c.style.width).join(','), th: [...t.querySelectorAll('th')].map(x => x.textContent.trim()) })));
    const iguales = tablas.every(t => t.cols === tablas[0].cols);
    console.log(`${ruta}: ${tablas.length} tabla(s) · anchos iguales entre tablas: ${iguales ? 'OK' : 'NO'} · cabeceras PDF: ${tablas[0]?.th.join(' | ')}`);
    console.log(`   web: ${web.join(' | ')}`);
    await w.close();
  }
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
