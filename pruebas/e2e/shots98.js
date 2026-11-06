const { chromium } = require('playwright');
const B = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  for (const r of ['cartera', 'restricciones', 'lookahead', 'plan', 'reportes', 'ayuda', 'plantillas']) {
    await p.goto(B + '?demo&s=' + r + '#/' + r); await p.waitForTimeout(2200);
    await p.screenshot({ path: `shots98/${r}.png` });
  }
  await p.goto(B + '?demo&s=r2#/reportes'); await p.waitForTimeout(1500); await p.click('[data-r="restricciones"]'); await p.waitForTimeout(1800);
  await p.screenshot({ path: 'shots98/rep-restr.png' });
  console.log(errs.length ? errs : 'SIN ERRORES'); await b.close();
})();
