const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  // Simula la vista automática guardada antes de existir la columna Semana (como en el navegador del usuario)
  await p.evaluate(() => { const db = JSON.parse(localStorage.getItem('lpsgt-demo-db')); const u = localStorage.getItem('lpsgt-demo-usuario');
    db.vistas = (db.vistas || []).filter(v => v.grilla !== 'plan');
    db.vistas.push({ id: crypto.randomUUID(), area_id: db.areas[0].id, usuario_id: u, grilla: 'plan', nombre: '__auto__',
      config: { columnas: [{ field: 'responsable_id', visible: true, width: 130 }, { field: 'gerencia_id', visible: true }, { field: 'proyecto_id', visible: true }, { field: 'descripcion', visible: true }], orden: [], agrupar: '' } });
    localStorage.setItem('lpsgt-demo-db', JSON.stringify(db)); });
  await p.goto(B + '?demo&y=1#/plan'); await p.waitForTimeout(1500);
  const cols = await p.$$eval('.tabulator-col-title', t => t.map(x => x.textContent).filter(Boolean));
  console.log('columnas:', cols.slice(0, 6).join(' | '));
  console.log(cols.indexOf('Semana') === cols.indexOf('Resp. 1') - 1 ? 'OK  Semana a la izquierda de Resp. 1' : 'FALLA');
  console.log(errs.length ? errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
