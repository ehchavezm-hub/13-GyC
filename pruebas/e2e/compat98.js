// Pedido 98: verificación de las incompatibilidades corregidas
const { chromium } = require('playwright');
const B = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = [], fallas = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) fallas.push(m); };
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('lpsgt-demo-db')));
  const editarDb = fn => p.evaluate(f => { const d = JSON.parse(localStorage.getItem('lpsgt-demo-db')); new Function('db', f)(d); localStorage.setItem('lpsgt-demo-db', JSON.stringify(d)); }, fn);
  const entrar = async n => {
    await p.evaluate(() => localStorage.removeItem('lpsgt-demo-usuario'));
    await p.goto(B + '?demo&e=' + n + '#/'); await p.waitForSelector('.usuarios-demo button'); await p.click(`.usuarios-demo button:nth-child(${n})`); await p.waitForTimeout(1200);
  };
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await entrar(1);
  // Abrir el Plan una vez: se guarda la vista automática con sábado y domingo ocultos
  await p.goto(B + '?demo&a=0#/plan'); await p.waitForTimeout(2500);

  // 1. Restricciones → Estado LA (levantar desde la pantalla Restricciones)
  const d0 = await db();
  const r0 = d0.restricciones.find(r => r.actividad_id && r.estado !== 'levantada' &&
    d0.restricciones.filter(x => x.actividad_id === r.actividad_id && x.estado !== 'levantada').length === 1);
  const act0 = d0.actividades.find(a => a.id === r0.actividad_id);
  console.log('  actividad:', act0.descripcion.slice(0, 40), '· estado LA', act0.estado_la);
  await p.goto(B + '?demo&a=1#/restricciones'); await p.waitForTimeout(2000);
  const fila = p.locator('.tabulator-row', { hasText: r0.descripcion }).first();
  await fila.locator('[tabulator-field="estado"]').dblclick(); await p.waitForTimeout(300);
  await p.locator('.tabulator-edit-list-item', { hasText: 'Levantada' }).first().click(); await p.waitForTimeout(2500);
  const act1 = (await db()).actividades.find(a => a.id === r0.actividad_id);
  chk(act1.estado_la === 'lista', `levantar en Restricciones → actividad "${act1.estado_la}" (esperado lista)`);
  // PDF de Restricciones: la columna Actividad trae el texto
  await p.locator('button:has-text("PDF")').first().click(); await p.waitForTimeout(1500);
  const pdfAct = await p.evaluate(() => [...document.querySelector('.vista-pdf iframe').contentDocument.querySelectorAll('tbody tr')].map(tr => tr.children[0]?.textContent.trim()));
  chk(pdfAct.length && pdfAct.every(t => t), `PDF Restricciones: columna Actividad con texto (${pdfAct.slice(0, 2).join(' | ')})`);
  await p.keyboard.press('Escape');

  // 2. Fines de semana: la vista guardada no oculta S y D cuando se activan
  await editarDb(`const x = db.parametros.find(p => p.clave === 'trabajo_fin_semana'); if (x) x.valor = true; else db.parametros.push({ id: crypto.randomUUID(), area_id: db.areas[0].id, clave: 'trabajo_fin_semana', valor: true });`);
  await p.goto(B + '?demo&a=2#/plan'); await p.waitForTimeout(2500);
  const tit = await p.$$eval('.tabulator-col[tabulator-field] .tabulator-col-title', t => t.filter(x => x.offsetParent).map(x => x.textContent.trim()));
  chk(tit.includes('S') && tit.includes('D'), 'Plan con vista guardada: S y D visibles al activar fin de semana');
  await editarDb(`db.parametros.find(p => p.clave === 'trabajo_fin_semana').valor = false;`);

  // 3. CET / Servicio ↔ Proyecto en el Look Ahead
  const d2 = await db();
  const servs = d2.lista_valores.filter(v => v.lista_id === d2.listas.find(l => l.clave === 'servicios').id);
  const [pA, pB] = d2.proyectos.filter(x => x.estado === 'activo');
  await editarDb(`const l = db.listas.find(l => l.clave === 'servicios'); const vs = db.lista_valores.filter(v => v.lista_id === l.id);
    vs.forEach(v => v.extra = { ...(v.extra || {}) , proyecto_id: null });
    vs[0].codigo = 'CET-A1'; vs[0].extra.proyecto_id = '${pA.id}'; vs[1].codigo = 'CET-A2'; vs[1].extra.proyecto_id = '${pA.id}';
    vs[2].codigo = 'CET-B1'; vs[2].extra.proyecto_id = '${pB.id}';`);
  await p.goto(B + '?demo&a=3#/lookahead'); await p.waitForTimeout(2200);
  const filaLA = p.locator('.tabulator-row:has([tabulator-field="_cet"])').first();
  await filaLA.locator('[tabulator-field="proyecto_id"]').dblclick(); await p.waitForTimeout(300);
  await p.locator('.tabulator-edit-list-item', { hasText: pA.codigo }).first().click(); await p.waitForTimeout(800);
  await filaLA.locator('[tabulator-field="servicio_id"]').dblclick(); await p.waitForTimeout(400);
  const opsServ = await p.$$eval('.tabulator-edit-list-item', i => i.map(x => x.textContent.trim()));
  chk(opsServ.includes(servs[0].valor) && !opsServ.includes(servs[2].valor), `Servicio: solo los del proyecto ${pA.codigo} y los sin proyecto (${opsServ.length - 1} opciones)`);
  await p.locator('.tabulator-edit-list-item', { hasText: servs[1].valor }).first().click(); await p.waitForTimeout(800);
  chk((await filaLA.locator('[tabulator-field="_cet"]').innerText()).trim() === 'CET-A2', 'elegir Servicio completa su CET');
  await filaLA.locator('[tabulator-field="proyecto_id"]').dblclick(); await p.waitForTimeout(300);
  await p.locator('.tabulator-edit-list-item', { hasText: pB.codigo }).first().click(); await p.waitForTimeout(800);
  const servTras = (await filaLA.locator('[tabulator-field="servicio_id"]').innerText()).trim();
  chk(servTras !== servs[1].valor, `cambiar a ${pB.codigo}: el servicio de ${pA.codigo} se reemplaza ("${servTras || 'vacío'}")`);

  // 4. Look Ahead: contador de comentarios 💬
  const d3 = await db();
  const actLA = d3.actividades.find(a => !a.comprometida && a.semana > d3._semana && a.semana <= new Date(Date.parse(d3._semana) + 7 * 86400000).toISOString().slice(0, 10));
  await editarDb(`db.comentarios.push({ id: crypto.randomUUID(), area_id: db.areas[0].id, entidad: 'actividad', entidad_id: '${actLA?.id}', texto: 'Hola', autor_id: db.profiles[0].id, created_at: new Date().toISOString() });`);
  await p.goto(B + '?demo&a=4#/lookahead'); await p.waitForTimeout(2200);
  const n = await p.evaluate(id => { const t = Tabulator.findTable('[data-grilla] .tabulator')[0] || Tabulator.findTable('[data-grilla]')[0]; const r = t.getRow(id); return r ? r.getCell('_colab').getElement().textContent.trim() : null; }, actLA?.id);
  chk(n === '1', `Look Ahead 💬 muestra la cantidad de comentarios (${n})`);

  // 5. Look Ahead: "Trasladada" se puede deshacer mientras no tenga estado final
  const filaT = p.locator(`.tabulator-row:has([tabulator-field="estado_la"])`).filter({ hasText: actLA.descripcion.slice(0, 25) }).first();
  await filaT.locator('[tabulator-field="estado_la"]').dblclick(); await p.waitForTimeout(300);
  await p.locator('.tabulator-edit-list-item', { hasText: 'Trasladada' }).first().click(); await p.waitForTimeout(2200);
  chk((await db()).actividades.find(a => a.id === actLA.id).comprometida === true, 'Trasladada al plan → comprometida');
  await filaT.locator('[tabulator-field="estado_la"]').dblclick(); await p.waitForTimeout(300);
  const abierto = await p.locator('.tabulator-edit-list-item').count();
  if (abierto) { await p.locator('.tabulator-edit-list-item', { hasText: 'Lista' }).first().click(); await p.waitForTimeout(2200); }
  const fin = (await db()).actividades.find(a => a.id === actLA.id);
  chk(abierto > 0 && fin.comprometida === false && fin.estado_la === 'lista', `volver a Lista la saca del Plan (comprometida=${fin.comprometida})`);

  // 6. Cartera: CET y Servicio enlazados
  await p.goto(B + '?demo&a=5#/cartera'); await p.waitForTimeout(2000);
  const tc = await p.$$eval('.tabulator-col[tabulator-field] .tabulator-col-title', t => t.filter(x => x.offsetParent).map(x => x.textContent.trim()));
  chk(tc.includes('CET') && tc.includes('Servicio') && !tc.includes('CET / Servicio'), 'Cartera: columnas CET y Servicio');
  const filaC = p.locator('.tabulator-row:has([tabulator-field="_cet"])').first();
  await filaC.locator('[tabulator-field="_cet"]').dblclick(); await p.waitForTimeout(300);
  await p.locator('.tabulator-edit-list-item', { hasText: 'CET-B1' }).first().click(); await p.waitForTimeout(1500);
  chk((await filaC.locator('[tabulator-field="servicio_id"]').innerText()).trim() === servs[2].valor, 'Cartera: elegir CET completa el Servicio');

  // 7. Reportes: Cartera igual a la pantalla; semana de los indicadores = la del Tablero
  await p.goto(B + '?demo&a=6#/reportes'); await p.waitForTimeout(1500);
  await p.click('[data-r="cartera"]'); await p.waitForTimeout(1500);
  const thC = await p.evaluate(() => [...document.querySelector('[data-prev]').contentDocument.querySelectorAll('th')].map(x => x.textContent.trim()));
  chk(thC.includes('CET') && thC.includes('Servicio') && thC.includes('Antigüedad'), 'Reporte Cartera con las columnas de la pantalla: ' + thC.slice(0, 7).join(' | '));
  const orig = await p.evaluate(() => [...document.querySelector('[data-prev]').contentDocument.querySelectorAll('tbody tr')].map(tr => tr.lastElementChild?.textContent.trim()));
  await p.click('[data-r="pac"]'); await p.waitForTimeout(1500);
  const semSel = await p.inputValue('[data-fl="semana"]');
  const esperada = await p.evaluate(() => { const d = new Date(); const l = new Date(d); l.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); return l.toISOString().slice(0, 10); });
  chk(semSel === esperada, `PAC por semana: termina en la última semana completa (${semSel})`);
  await p.click('[data-r="plan"]'); await p.waitForTimeout(1200);
  chk(await p.inputValue('[data-fl="semana"]') > esperada, 'Plan semanal: semana actual');

  // 8. Reportes con el rol Consulta: solo los del Tablero
  await entrar(8);
  await p.goto(B + '?demo&a=7#/reportes'); await p.waitForTimeout(1800);
  const arbol = await p.$$eval('[data-r]', x => x.map(b => b.dataset.r));
  chk(arbol.join(',') === 'ejecutivo,pac,pac_resp,pareto', 'Consulta ve: ' + arbol.join(', '));

  console.log(fallas.length ? 'FALLAS: ' + fallas.length : 'TODO OK');
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
