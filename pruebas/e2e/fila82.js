const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(800);
  const largo = 'Planificar\nEl proyecto fue concebido como un último impulso promocional para American Life ante su bajo desempeño comercial y reactivar la carrera musical de Madonna. Según la cantante, la idea de este material era mantener vigente el álbum de estudio.';
  // Datos: actividad comprometida (trasladada) con texto largo en la semana siguiente
  await p.evaluate(t => { const db = JSON.parse(localStorage.getItem('lpsgt-demo-db')); const a = db.actividades.find(x => !x.comprometida);
    a.descripcion = t; a.comprometida = true; a.estado_la = 'trasladada'; localStorage.setItem('oid', a.id); localStorage.setItem('lpsgt-demo-db', JSON.stringify(db)); }, largo);
  await p.goto(B + '?demo&y=1#/lookahead'); await p.waitForTimeout(1800);
  const id = await p.evaluate(() => localStorage.getItem('oid'));
  await p.evaluate(id => { const r = Tabulator.findTable('.grilla-tabla')[0].getRow(id); r.getElement().id = 'objetivo'; r.getElement().scrollIntoView(); }, id);
  const celda = p.locator('#objetivo [tabulator-field="descripcion"]');
  console.log('antes: alto celda', Math.round((await celda.boundingBox()).height), '· editable:', await p.evaluate(id => { const c = Tabulator.findTable('.grilla-tabla')[0].getRow(id).getCell('descripcion'); return c.getColumn().getDefinition().editable(c); }, id));
  console.log('contenido vs celda:', await celda.evaluate(e => [e.scrollHeight, e.clientHeight]));
  await celda.dblclick(); await p.waitForTimeout(600);
  const ed = await p.evaluate(() => { const e = document.querySelector('#objetivo [tabulator-field="descripcion"] textarea, #objetivo [tabulator-field="descripcion"] input'); return e ? [e.tagName, e.offsetHeight, e.scrollHeight, getComputedStyle(e).whiteSpace] : 'sin editor'; });
  console.log('editor:', ed);
  const box = await celda.boundingBox();
  await p.screenshot({ path: require('path').join(__dirname, 'salida') + '/' + 'fila82.png', clip: { x: box.x - 200, y: Math.max(0, box.y - 40), width: 600, height: box.height + 80 } });
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
