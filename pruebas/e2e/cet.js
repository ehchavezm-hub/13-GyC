const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) errs.push(m); };
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(BASE + '?demo#/config/listas?lista=cet'); await p.waitForTimeout(1300);
  const cols = await p.$$eval('.tabulator-col-title', t => t.map(x => x.textContent).filter(Boolean));
  console.log('  columnas:', cols.join(' | '));
  chk(cols.includes('Proyecto') && !cols.includes('Descripción') && !cols.includes('Color'), 'CET: con Proyecto, sin Descripción ni Color');
  // Asignar proyecto D-101 al CET-002 por API de la grilla (como si se eligiera en la lista)
  const ok = await p.evaluate(async () => {
    const t = Tabulator.findTable('.grilla-tabla')[0];
    const db = JSON.parse(localStorage.getItem('lpsgt-demo-db'));
    const proy = db.proyectos.find(x => x.codigo === 'D-101');
    const row = t.getRows().find(r => r.getData().codigo === 'CET-002');
    row.getCell('_proyecto').setValue(proy.id);
    await new Promise(r => setTimeout(r, 1500));
    const v = JSON.parse(localStorage.getItem('lpsgt-demo-db')).lista_valores.find(x => x.codigo === 'CET-002');
    return v.extra?.proyecto_id === proy.id;
  });
  chk(ok, 'proyecto guardado en el CET');
  await p.screenshot({ path: 'shots3/cet.png' });
  // otra lista conserva sus columnas
  await p.selectOption('[data-l]', 'estados_compromiso'); await p.waitForTimeout(1000);
  const cols2 = await p.$$eval('.tabulator-col-title', t => t.map(x => x.textContent).filter(Boolean));
  chk(cols2.includes('Color') && !cols2.includes('Proyecto'), 'otras listas conservan Color');
  // En el plan, elegir D-101 completa CET-002
  await p.goto(BASE + '?demo#/plan'); await p.waitForTimeout(1300);
  const cet = await p.evaluate(async () => {
    const m = await import('./js/services/columnas.js');
    const db = JSON.parse(localStorage.getItem('lpsgt-demo-db'));
    const proy = db.proyectos.find(x => x.codigo === 'D-101');
    const d = m.derivarActividad({}, { proyecto_id: proy.id });
    return db.lista_valores.find(v => v.id === d.cet_id)?.codigo;
  });
  chk(cet === 'CET-002', 'al elegir el proyecto en una actividad se completa su CET: ' + cet);
  console.log(errs.length ? 'ERRORES:\n' + errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
