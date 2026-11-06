const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(800);
  await p.goto(B + '?demo&y=1#/lookahead'); await p.waitForTimeout(1800);
  const grupoDe = desc => p.evaluate(d => { const r = Tabulator.findTable('.grilla-tabla')[0].getRows().find(x => x.getData().descripcion === d); return r?.getGroup()?.getKey(); }, desc);
  // Fila nueva con descripción, en la semana por defecto
  await p.click('button:has-text("Fila")'); await p.waitForTimeout(300);
  await p.keyboard.type('Actividad 79'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  const g1 = await grupoDe('Actividad 79');
  // Cambiar la semana con el editor (última opción)
  await p.evaluate(() => { const t = Tabulator.findTable('.grilla-tabla')[0]; t.getRows().find(x => x.getData().descripcion === 'Actividad 79').getCell('semana').edit(true); });
  await p.waitForTimeout(300);
  await p.locator('.tabulator-edit-list-item').last().click(); await p.waitForTimeout(1200);
  const g2 = await grupoDe('Actividad 79');
  const sem = await p.evaluate(() => Tabulator.findTable('.grilla-tabla')[0].getRows().find(x => x.getData().descripcion === 'Actividad 79').getData().semana);
  console.log('grupo antes:', g1, '→ después:', g2, '· semana de la fila:', sem, g2 === sem && g1 !== g2 ? 'OK se movió' : 'FALLA');
  // Fila nueva vacía: al elegir la semana también pasa a su grupo
  await p.click('button:has-text("Fila")'); await p.waitForTimeout(300); await p.keyboard.press('Escape');
  await p.evaluate(() => { const t = Tabulator.findTable('.grilla-tabla')[0]; t.getRows().filter(x => !x.getData().id).pop().getCell('semana').edit(true); });
  await p.waitForTimeout(300); await p.locator('.tabulator-edit-list-item').last().click(); await p.waitForTimeout(800);
  const v = await p.evaluate(() => { const r = Tabulator.findTable('.grilla-tabla')[0].getRows().filter(x => !x.getData().id).pop(); return [r.getGroup()?.getKey(), r.getData().semana]; });
  console.log('fila vacía: grupo', v[0], 'semana', v[1], v[0] === v[1] ? 'OK' : 'FALLA');
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
