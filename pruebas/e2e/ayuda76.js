const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(800);
  for (const [ruta, campo, opcion] of [['lookahead', 'estado_la', 'Lista'], ['plan', 'estado', 'No completado']]) {
    await p.goto(B + '?demo&y=' + ruta + '#/' + ruta); await p.waitForTimeout(1800);
    const celda = p.locator(`.tabulator-row:has([tabulator-field="${campo}"])`).first().locator(`[tabulator-field="${campo}"]`);
    await celda.dblclick(); await p.waitForTimeout(400);
    const item = p.locator('.tabulator-edit-list-item', { hasText: opcion }).first();
    await item.hover(); await p.waitForTimeout(300);
    const globo = await p.locator('.globo-ayuda').textContent().catch(() => null);
    console.log(ruta, opcion, '→', globo || 'SIN GLOBO');
    await p.screenshot({ path: `${require("path").join(__dirname, "salida")}/ayuda_${ruta}.png` });
    await p.keyboard.press('Escape');
  }
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
