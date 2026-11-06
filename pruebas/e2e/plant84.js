const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(4)'); await p.waitForTimeout(800);
  const cab = () => p.$$eval('.tabulator-col', cs => cs.filter(c => c.offsetParent && c.getAttribute('tabulator-field')).map(c => c.querySelector('.tabulator-col-title').textContent.trim()));
  await p.goto(B + '?demo&y=1#/lookahead'); await p.waitForTimeout(1800);
  const la = await cab();
  await p.goto(B + '?demo&y=2#/plantillas'); await p.waitForTimeout(1800);
  const rec = await cab();
  console.log('Look Ahead :', la.join(' | '));
  console.log('Recurrentes:', rec.join(' | '));
  console.log('Primeras columnas iguales:', JSON.stringify(rec) === JSON.stringify(la.slice(0, rec.length)) ? 'OK' : 'DIFIEREN');
  // Probar edición: CET → Servicio y HH total
  await p.click('button:has-text("Fila")'); await p.waitForTimeout(300); await p.keyboard.type('Reunión semanal de coordinación'); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
  await p.evaluate(() => { const t = Tabulator.findTable('.grilla-tabla')[0]; const r = t.getRows().pop(); r.getCell('hh_lu').setValue(2); r.getCell('hh_vi').setValue(1); });
  await p.waitForTimeout(1200);
  console.log('HH total de la fila:', await p.evaluate(() => Tabulator.findTable('.grilla-tabla')[0].getRows().pop().getData().hh_total));
  await p.click('button[data-m="servicio"]'); await p.waitForTimeout(1500);
  console.log('Servicio   :', (await cab()).join(' | '));
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
