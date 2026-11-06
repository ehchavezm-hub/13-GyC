const { chromium } = require('playwright');
const B = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = [], fallas = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) fallas.push(m); };
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1200);
  await p.goto(B + '?demo&a=1#/config/parametros'); await p.waitForTimeout(1500);
  const cas = p.locator('[data-name="reunion_dias"] input[type="checkbox"]');
  chk(await cas.count() === 7, 'Días de la reunión: 7 casillas');
  const marcadas = []; for (let i = 0; i < 7; i++) if (await cas.nth(i).isChecked()) marcadas.push(await cas.nth(i).getAttribute('value'));
  chk(marcadas.join() === '5', 'por defecto: viernes (' + marcadas + ')');
  for (let i = 0; i < 7; i++) { const c = cas.nth(i); const v = await c.getAttribute('value'); if (['5', '6', '7'].includes(v) !== await c.isChecked()) await c.click(); }
  await p.click('button:has-text("Guardar parámetros")'); await p.waitForTimeout(1200);
  const guardado = await p.evaluate(() => JSON.parse(localStorage.getItem('lpsgt-demo-db')).parametros.find(x => x.clave === 'reunion')?.valor);
  chk(JSON.stringify(guardado) === JSON.stringify({ dias: [5, 6, 7], hora: '08:00' }), 'guardado: ' + JSON.stringify(guardado));
  const el = p.locator('[data-name="reunion_dias"]').locator('xpath=..'); await el.scrollIntoViewIfNeeded(); const bx = await el.boundingBox();
  await p.screenshot({ path: 'shots98/reu112.png', clip: { x: bx.x - 10, y: bx.y - 10, width: 900, height: 120 } });
  // Desmarcar todo: no deja guardar
  for (let i = 0; i < 7; i++) if (await cas.nth(i).isChecked()) await cas.nth(i).click();
  await p.click('button:has-text("Guardar parámetros")'); await p.waitForTimeout(600);
  chk(/al menos un día de la reunión/i.test((await p.locator('.toast, .toasts').allInnerTexts()).join(' ')), 'sin días marcados: avisa');
  await p.goto(B + '?demo&a=2#/ayuda'); await p.waitForTimeout(1200);
  chk(/viernes, sábado y domingo/.test(await p.locator('.tarjeta').innerText()), 'Ayuda: reunión los viernes, sábado y domingo');
  console.log(fallas.length ? 'FALLAS: ' + fallas.length : 'TODO OK'); console.log(errs.length ? errs : 'SIN ERRORES'); await b.close();
})();
