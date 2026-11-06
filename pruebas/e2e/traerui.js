const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1200);
  await p.evaluate(() => import('./js/views/traer-demo.js').then(m => m.abrirTraerDemo()));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: require('path').join(__dirname, 'salida') + '/' + 'traer.png' });
  console.log(await p.$eval('.modal', m => m.innerText.slice(0, 600)));
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
