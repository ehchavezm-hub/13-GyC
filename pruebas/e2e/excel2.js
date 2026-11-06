const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ acceptDownloads: true, viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(B + '?demo&a=1#/admin'); await p.waitForTimeout(1200);
  await p.click('.admin-item:has-text("Reportes")'); await p.waitForTimeout(600);
  const [d1] = await Promise.all([p.waitForEvent('download'), p.click('#admin-contenido [data-a="excel"]')]);
  console.log('plataforma:', d1.suggestedFilename());
  await p.goto(B + '?demo#/config/respaldo'); await p.waitForTimeout(1500);
  const btn = p.locator('[data-a="excel"]');
  console.log('botón respaldo excel:', await btn.count());
  if (await btn.count()) { const [d2] = await Promise.all([p.waitForEvent('download'), btn.first().click()]); const fs = require('fs'); const buf = fs.readFileSync(await d2.path()); console.log('respaldo:', d2.suggestedFilename(), buf.length, 'bytes, firma', buf.slice(0, 2).toString(), '· botón:', await btn.first().innerText()); }
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
