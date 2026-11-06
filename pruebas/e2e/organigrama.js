const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) errs.push(m); };
  const nodos = () => p.evaluate(() => JSON.parse(localStorage.getItem('lpsgt-demo-db')).organigrama_nodos || []);
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  for (const r of ['/plan', '/lookahead']) {
    await p.goto(BASE + '?demo#' + r); await p.waitForTimeout(1300);
    chk(!(await p.$$eval('.tabulator-col-title', t => t.map(x => x.textContent))).includes('Resp. 2'), r + ' sin columna Resp. 2');
  }
  await p.goto(BASE + '?demo#/config/usuarios'); await p.waitForTimeout(1500);
  chk((await p.textContent('.org')).includes('Aún no hay organigrama'), 'sección Organigrama del equipo vacía');
  await p.click('[data-o="generar"]'); await p.waitForTimeout(300);
  await p.click('.modal-pie button:has-text("Generar")'); await p.waitForTimeout(2500);
  const n = await nodos();
  const personas = await p.evaluate(() => JSON.parse(localStorage.getItem('lpsgt-demo-db')).profiles.filter(x => x.activo && !['consulta', 'pendiente'].includes(x.rol)).length);
  chk(n.filter(x => x.tipo === 'persona').length === personas && n.filter(x => x.tipo === 'unidad').length === 1, `generado: 1 unidad y ${personas} personas`);
  chk((await p.$$('.org-nodo')).length === n.length && (await p.$$('.org-lineas path')).length === n.length - 1, 'tarjetas y líneas dibujadas');
  // agregar unidad BIM debajo de la raíz
  await p.click('[data-o="unidad"]'); await p.waitForTimeout(300);
  await p.fill('.modal input[name="titulo"]', 'BIM');
  await p.selectOption('.modal select[name="padre_id"]', { index: 1 });
  await p.click('.modal-pie button:has-text("Agregar")'); await p.waitForTimeout(1200);
  chk((await nodos()).some(x => x.titulo === 'BIM'), 'unidad BIM agregada');
  // arrastrar una tarjeta
  const card = await p.$('.org-nodo.org-unidad:has-text("BIM")');
  const bb = await card.boundingBox();
  await p.mouse.move(bb.x + 100, bb.y + 60); await p.mouse.down(); await p.mouse.move(bb.x + 260, bb.y + 160, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(800);
  const bim = (await nodos()).find(x => x.titulo === 'BIM');
  console.log('  BIM en', bim.x, bim.y);
  await p.click('[data-o="organizar"]'); await p.waitForTimeout(1200);
  await p.click('[data-o="ajustar"]'); await p.waitForTimeout(400);
  await p.screenshot({ path: 'shots3/organigrama.png' });
  console.log(errs.length ? 'ERRORES:\n' + errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
