const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(4)'); await p.waitForTimeout(800);
  const n = () => p.evaluate(() => JSON.parse(localStorage.getItem('lpsgt-demo-db')).actividades.length);
  await p.goto(B + '?demo&y=1#/lookahead'); await p.waitForTimeout(1800);
  const a0 = await n();
  await p.click('button:has-text("Aplicar plantilla de servicio")'); await p.waitForTimeout(800);
  console.log('modal:', (await p.locator('.modal').innerText()).replace(/\s+/g,' ').slice(0, 400));
  const sel = p.locator('.modal select');
  for (let i = 1; i < 2; i++) { const opts = await sel.nth(i).locator('option').evaluateAll(o => o.map(x => x.value).filter(Boolean)); if (opts.length) await sel.nth(i).selectOption(opts[0]); }
  await p.locator('.modal .btn-primario').click(); await p.waitForTimeout(1800);
  console.log('Look Ahead: filas', a0, '→', await n());
  await p.goto(B + '?demo&y=2#/plan'); await p.waitForTimeout(1800);
  const b0 = await n();
  await p.click('button:has-text("Recurrentes")'); await p.waitForTimeout(800);
  if (await p.locator('.modal .btn-primario').count()) await p.locator('.modal .btn-primario').click();
  await p.waitForTimeout(1800);
  console.log('Plan: filas', b0, '→', await n());
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
