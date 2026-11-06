const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(800);
  await p.goto(B + '?demo&y=1#/lookahead'); await p.waitForTimeout(1800);
  // Una actividad no comprometida: elegir "Trasladada al plan" a mano
  const info = await p.evaluate(() => { const t = Tabulator.findTable('.grilla-tabla')[0]; const r = t.getRows().find(x => x.getData().id && !x.getData().comprometida && x.getData().estado_la !== 'cancelada');
    window.__id = r.getData().id; r.getCell('estado_la').edit(true); return [r.getData().id, r.getData().semana, r.getData().responsable_id]; });
  await p.waitForTimeout(300);
  await p.locator('.tabulator-edit-list-item', { hasText: 'Trasladada al plan' }).first().click(); await p.waitForTimeout(1500);
  await p.goto(B + `?demo&z=1#/plan?semana=${info[1]}`); await p.waitForTimeout(1500);
  await p.selectOption('select:near(:text("Semana actual"))', 'todos').catch(() => {});
  await p.waitForTimeout(1200);
  const enPlan = await p.evaluate(id => Tabulator.findTable('.grilla-tabla')[0].getRows().some(r => r.getData().id === id), info[0]);
  console.log('Trasladada a mano aparece en el Plan:', enPlan ? 'OK' : 'FALLA');
  // Editar la actividad larga: la caja muestra todo el texto
  await p.goto(B + '?demo&w=1#/lookahead'); await p.waitForTimeout(1800);
  const largo = 'Planificar El proyecto fue concebido como un último impulso promocional para American Life ante su bajo desempeño comercial y reactivar la carrera musical. Según la cantante, la idea de este material era mantener vigente el álbum de estudio.';
  await p.evaluate(() => { const r = Tabulator.findTable('.grilla-tabla')[0].getRows().find(x => x.getData().id && !x.getData().comprometida); r.getElement().id = 'objetivo'; localStorage.setItem('oid', r.getData().id); });
  const celda = p.locator('#objetivo [tabulator-field="descripcion"]');
  await celda.dblclick(); await p.waitForTimeout(200); await p.keyboard.press('Control+A'); await p.keyboard.type(largo); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  await p.reload(); await p.waitForTimeout(1800);
  await p.evaluate(id => { Tabulator.findTable('.grilla-tabla')[0].getRow(id).getElement().id = 'objetivo'; }, await p.evaluate(() => localStorage.getItem('oid')));
  await p.locator('#objetivo [tabulator-field="descripcion"]').dblclick(); await p.waitForTimeout(400);
  const m = await p.locator('.tabulator-cell textarea').evaluate(e => [e.offsetHeight, e.scrollHeight]);
  console.log('Actividad en edición: alto caja', m[0], '· alto texto', m[1], m[0] >= m[1] ? 'OK se ve todo' : 'FALLA');
  await p.keyboard.press('Escape');
  // Comentario en varias líneas
  const com = p.locator('#objetivo [tabulator-field="comentario"]');
  await com.dblclick(); await p.waitForTimeout(200); await p.keyboard.type('Comentario largo que debe ajustarse al ancho de la columna y verse en varias líneas dentro de la celda');
  const c = await p.locator('.tabulator-cell textarea').evaluate(e => [e.offsetHeight, e.scrollHeight]);
  await p.keyboard.press('Enter'); await p.waitForTimeout(800);
  console.log('Comentario en edición:', c, c[0] >= c[1] && c[0] > 40 ? 'OK varias líneas' : 'FALLA');
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
