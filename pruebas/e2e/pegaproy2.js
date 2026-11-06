const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) errs.push(m); };
  const datos = () => p.evaluate(() => { const db = JSON.parse(localStorage.getItem('lpsgt-demo-db'));
    const v = id => db.lista_valores.find(x => x.id === id)?.valor || null;
    return db.proyectos.filter(r => /^[CE]\d/.test(r.codigo)).map(r => ({ c: r.codigo, n: r.nombre_corto, g: v(r.gerencia_id), f: v(r.fase_id), pa: v(r.pais_id), e: r.estado })); });
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(BASE + '?demo#/proyectos'); await p.waitForTimeout(1300);
  // A) Diálogo con títulos en otro orden y una gerencia nueva
  const tsv = 'Nombre corto\tCódigo\tGerencia\tPaís\tNombre completo\tFase\nProyecto Uno\tC1\tGOC\tPerú\tProyecto Uno completo\tConstrucción\nProyecto Dos\tC2\tGerencia de Minería\tChile\tProyecto Dos completo\tDiseño\n';
  await p.click('[data-a="pegar"]'); await p.waitForTimeout(300);
  await p.fill('.modal textarea', tsv); await p.waitForTimeout(200);
  console.log('  vista previa:', (await p.textContent('.pegar-previa')).slice(0, 220));
  chk(await p.$eval('.modal [data-cab]', c => c.checked), 'detecta la fila de títulos');
  await p.click('.modal-pie button:has-text("Agregar filas")'); await p.waitForTimeout(1200);
  const conf = await p.textContent('.modal .modal-cuerpo').catch(() => '');
  console.log('  confirmación:', conf.slice(0, 160));
  await p.screenshot({ path: 'shots3/pegar_confirmar.png' });
  await p.click('.modal-pie button:has-text("Agregar a las listas")'); await p.waitForTimeout(2000);
  let d = await datos(); console.log('  ', JSON.stringify(d));
  chk(d.length === 2 && d[0].g === 'Gerencia de Obras Civiles' && d[1].g === 'Gerencia de Minería' && d[1].pa === 'Chile' && d[0].f === 'Construcción', 'filas completas, gerencia nueva agregada a la lista');
  const fichas = await p.evaluate(() => Tabulator.findTable('.grilla-tabla')[0].getRows().filter(r => /^C\d/.test(r.getData().codigo)).map(r => !!r.getElement().querySelector('.mini-btn')));
  chk(fichas.every(Boolean), 'botón Ficha visible sin recargar');
  // B) Ctrl+V sobre la grilla con una fase nueva
  await p.evaluate(() => {
    const t = Tabulator.findTable('.grilla-tabla')[0];
    const rows = t.getRows(); const c = rows[rows.length - 1].getCell('codigo'); t.addRange(c, c);
  });
  // pegar debajo: seleccionar la fila final y pegar 2 filas (la primera sobrescribe la última, por eso pegamos en una fila nueva)
  await p.click('[data-a="nueva"]'); await p.waitForTimeout(300); await p.keyboard.press('Escape');
  await p.evaluate(() => {
    const t = Tabulator.findTable('.grilla-tabla')[0];
    const rows = t.getRows(); const c = rows[rows.length - 1].getCell('codigo'); t.addRange(c, c);
    const dt = new DataTransfer(); dt.setData('text/plain', 'E1\tPegado Uno\tPegado uno completo\tGOC\tFase Nueva\n');
    document.querySelector('.grilla-tabla').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await p.waitForTimeout(1200);
  if (await p.$('.modal-pie button:has-text("Agregar a las listas")')) { await p.click('.modal-pie button:has-text("Agregar a las listas")'); await p.waitForTimeout(2000); }
  d = await datos(); const e1 = d.find(x => x.c === 'E1'); console.log('  ', JSON.stringify(e1));
  chk(e1 && e1.f === 'Fase Nueva' && e1.g === 'Gerencia de Obras Civiles', 'Ctrl+V: fila guardada y fase nueva agregada');
  console.log(errs.length ? 'ERRORES:\n' + errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
