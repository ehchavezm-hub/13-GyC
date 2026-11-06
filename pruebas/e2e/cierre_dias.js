const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(B + '?demo&a=2#/config/parametros'); await p.waitForTimeout(1500);
  const cajas = p.locator('[data-name="cierre_dias"] input[type="checkbox"]');
  console.log('casillas:', await cajas.count(), 'marcadas:', await p.locator('[data-name="cierre_dias"] input:checked').count());
  // desmarcar todas → error
  for (let i = 0; i < 7; i++) if (await cajas.nth(i).isChecked()) await cajas.nth(i).uncheck();
  await p.click('text=Guardar parámetros'); await p.waitForTimeout(500);
  console.log('sin días:', (await p.locator('.toast').allInnerTexts()).join(' | '));
  await cajas.nth(4).check(); await cajas.nth(5).check();
  await p.click('text=Guardar parámetros'); await p.waitForTimeout(1000);
  await p.goto(B + '?demo&a=3#/config/parametros'); await p.waitForTimeout(1500);
  const marc = []; for (let i = 0; i < 7; i++) if (await p.locator('[data-name="cierre_dias"] input[type="checkbox"]').nth(i).isChecked()) marc.push(i + 1);
  console.log('tras recargar:', marc.join(','), await p.evaluate(async () => JSON.stringify((await import('./js/core/store.js')).param('cierre'))));
  const el = p.locator('[data-name="cierre_dias"]').locator('xpath=..');
  await el.scrollIntoViewIfNeeded(); const bx = await el.boundingBox();
  await p.screenshot({ path: '../cierre_dias.png', clip: { x: Math.max(0, bx.x - 300), y: bx.y - 200, width: 1100, height: 420 } });
  await p.goto(B + '?demo&a=4#/ayuda'); await p.waitForTimeout(1200);
  console.log('ayuda:', (await p.locator('li:has-text("Cierre del")').first().innerText()).slice(0, 40));
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
