const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(B + '?demo&a=1#/admin'); await p.waitForTimeout(1200);
  console.log((await p.locator('.admin-nav').innerText()).replace(/\n+/g, ' | '));
  await p.goto(B + '?demo&a=2#/config/listas'); await p.waitForTimeout(1200);
  console.log('Configuración › Listas:', (await p.locator('#contenido').innerText()).slice(0, 60).replace(/\s+/g, ' '));
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
