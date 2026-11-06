const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  // Vista guardada con Semana al final (como en el navegador del usuario)
  await p.evaluate(() => { const db = JSON.parse(localStorage.getItem('lpsgt-demo-db')); const u = localStorage.getItem('lpsgt-demo-usuario');
    db.vistas = (db.vistas || []).filter(v => v.grilla !== 'plan');
    db.vistas.push({ id: crypto.randomUUID(), area_id: db.areas[0].id, usuario_id: u, grilla: 'plan', nombre: '__auto__',
      config: { columnas: [{ field: 'responsable_id', visible: true }, { field: 'gerencia_id', visible: true }, { field: 'proyecto_id', visible: true }, { field: 'servicio_id', visible: true }, { field: 'descripcion', visible: true }, { field: 'comentario', visible: true }, { field: 'semana', visible: true }], orden: [], agrupar: '' } });
    localStorage.setItem('lpsgt-demo-db', JSON.stringify(db)); });
  await p.evaluate(() => { const db = JSON.parse(localStorage.getItem('lpsgt-demo-db'));
    const tabla = Object.values(db).find(t => Array.isArray(t) && t.some(v => v && v.valor === 'Metrados'));
    tabla.find(v => v.valor === 'Metrados').codigo = 'CET-099'; localStorage.setItem('lpsgt-demo-db', JSON.stringify(db)); });
  for (const r of ['plan', 'lookahead']) {
    await p.goto(B + '?demo&y=' + r + '#/' + r); await p.waitForTimeout(1800);
    const cols = await p.$$eval('.tabulator-col-title', t => t.map(x => x.textContent.trim()).filter(Boolean));
    console.log(r + ':', cols.slice(0, 8).join(' | '), '... último:', cols[cols.length - 1]);
    const i = n => cols.indexOf(n);
    console.log(i('CET') === i('Servicio') - 1 ? 'OK CET antes de Servicio' : 'FALLA CET');
    if (r === 'plan') console.log(i('Semana') === i('Resp. 1') - 1 ? 'OK Semana a la izquierda de Resp. 1' : 'FALLA Semana');
    console.log('CET/Serv:', await p.$$eval('.tabulator-row', rs => rs.slice(0, 4).map(r => r.querySelector('[tabulator-field="_cet"]')?.textContent + ' / ' + r.querySelector('[tabulator-field="servicio_id"]')?.textContent)), await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('lpsgt-demo-db')))));
  }
  console.log(errs.length ? errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
