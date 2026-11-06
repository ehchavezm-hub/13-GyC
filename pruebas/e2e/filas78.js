const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(800);
  for (const ruta of ['lookahead', 'plan']) {
    await p.goto(B + '?demo&y=' + ruta + '#/' + ruta); await p.waitForTimeout(1800);
    const contar = () => p.evaluate(() => Tabulator.findTable('.grilla-tabla')[0].getRows().filter(r => !r.getData().id).length);
    for (let i = 0; i < 3; i++) { await p.click('button:has-text("Fila")'); await p.waitForTimeout(250); await p.keyboard.press('Escape'); }
    await p.waitForTimeout(800);
    console.log(ruta, 'filas nuevas vacías:', await contar());
    // Recarga de la grilla (cambio de proyecto en el menú lateral → pintar)
    await p.evaluate(() => document.querySelector('.proy-item, [data-proy]')?.click()); await p.waitForTimeout(1200);
    await p.evaluate(() => document.querySelector('[data-pestana="todos"], .proy-todos')?.click()); await p.waitForTimeout(800);
    console.log(ruta, 'tras recargar la grilla:', await contar());
    await p.reload(); await p.waitForTimeout(2200);
    console.log(ruta, 'tras recargar la página (F5):', await contar());
    // Escribir en una: se guarda y deja de ser borrador
    const fila = p.locator('.tabulator-row:has([tabulator-field="descripcion"])').filter({ hasNot: p.locator('text=x') }).last();
    await p.evaluate(() => { const t = Tabulator.findTable('.grilla-tabla')[0]; t.getRows().filter(r => !r.getData().id)[0].getCell('descripcion').edit(true); });
    await p.waitForTimeout(200); await p.keyboard.type('Nueva actividad 78'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
    await p.reload(); await p.waitForTimeout(2200);
    const guardada = await p.evaluate(() => Tabulator.findTable('.grilla-tabla')[0].getRows().some(r => r.getData().id && r.getData().descripcion === 'Nueva actividad 78'));
    console.log(ruta, 'la escrita quedó guardada:', guardada ? 'OK' : 'FALLA', '· vacías que siguen:', await contar());
  }
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
