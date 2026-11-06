const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
const OUT = __dirname + '/shots3';
const log = (...a) => console.log(...a);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/404|ERR_FAILED|fonts/.test(m.text())) errs.push('console: ' + m.text()); });
  p.on('popup', async w => { await w.waitForLoadState().catch(()=>{}); log('  popup abierto:', (await w.title().catch(()=>'')) ); await w.screenshot({ path: OUT + '/popup.png' }).catch(()=>{}); await w.close(); });
  await p.route('**/fonts.g*/**', r => r.abort());
  await p.goto(BASE + '?demo'); await p.waitForTimeout(800);
  await p.evaluate(() => { localStorage.clear(); });
  const entrar = async u => {
    await p.evaluate(() => localStorage.removeItem('lpsgt-demo-usuario'));
    await p.goto(BASE + '?demo&u=' + u + Date.now() + '#/');
    await p.waitForSelector('.usuarios-demo button');
    const nombre = await p.textContent(`.usuarios-demo button:nth-child(${u})`);
    await p.click(`.usuarios-demo button:nth-child(${u})`);
    await p.waitForTimeout(1200);
    log('== Usuario', u, nombre.replace(/\s+/g, ' ').trim());
  };
  const ir = async r => { await p.goto(BASE + '?demo#' + r); await p.waitForTimeout(1300); };
  const filas = () => p.evaluate(() => Tabulator.findTable('.grilla-tabla')[0].getData());
  const btnModal = async t => { await p.click(`.modal-pie button:has-text("${t}")`); await p.waitForTimeout(700); };
  const toasts = () => p.$$eval('.toast', t => t.map(x => x.textContent));
  const rellenarModal = async () => {
    for (const c of await p.$$('.modal input[type=text], .modal textarea')) await c.fill('Prueba e2e');
    for (const c of await p.$$('.modal input[type=date]')) await c.fill('2026-12-15');
    for (const s of await p.$$('.modal select')) { const v = await s.$$eval('option', o => o.map(x => x.value).filter(Boolean)); if (v.length) await s.selectOption(v[0]); }
  };
  const check = (c, msg) => { log((c ? '  OK  ' : '  FALLA ') + msg); if (!c) errs.push('FALLA: ' + msg); };

  // ---------- 1. Líder edita su plan ----------
  await entrar(3);
  await ir('/plan');
  let d0 = await filas();
  log('  filas iniciales:', d0.length);
  await p.click('[data-a="nueva"]');
  await p.waitForTimeout(300);
  await p.keyboard.type('Actividad de prueba e2e');
  log('  activo:', await p.evaluate(() => document.activeElement.outerHTML.slice(0,120)));
  await p.keyboard.press('Enter');
  await p.waitForTimeout(1500);
  let d1 = await filas();
  log('  ultimas:', JSON.stringify(d1.slice(-2).map(a => [a.id, a.descripcion, a._nueva, a._guardando])));
  await p.screenshot({ path: OUT + '/0_nueva.png' });
  const nueva = d1.find(a => a.descripcion === 'Actividad de prueba e2e');
  check(nueva && nueva.id, 'fila nueva creada y guardada con id');
  // editar HH escribiendo en celda lunes
  await p.evaluate(id => { const t = Tabulator.findTable('.grilla-tabla')[0]; t.getRow(id).getCell('hh_lu').edit(true); }, nueva.id);
  await p.waitForTimeout(200);
  await p.keyboard.press('Control+A'); await p.keyboard.type('3.5'); await p.keyboard.press('Enter');
  await p.waitForTimeout(1500);
  await ir('/plan');
  d1 = await filas();
  check(d1.find(a => a.id === nueva.id)?.hh_total == 3.5, 'HH lunes editadas y persistidas (hh_total=3.5)');

  // ---------- 2. Pegar filas (diálogo con títulos) ----------
  await p.click('[data-a="pegar"]');
  await p.check('.modal [data-cab]');
  await p.fill('.modal textarea', 'Actividad\tLu\tMa\nPegada A\t2\t3\nPegada B\t1\t\n');
  await btnModal('Agregar filas');
  await p.waitForTimeout(1800);
  await ir('/plan');
  d1 = await filas();
  const pa = d1.find(a => a.descripcion === 'Pegada A'), pb = d1.find(a => a.descripcion === 'Pegada B');
  log('  pa/pb:', JSON.stringify([pa&&[pa.hh_lu,pa.hh_ma,pa.hh_total], pb&&[pb.hh_lu,pb.hh_total]]));
  check(pa && pa.hh_total == 5 && pb && pb.hh_total == 1, 'diálogo pegar: 2 filas con HH 5 y 1');

  // ---------- 3. Pegado de rango (Ctrl+V sobre celda) ----------
  await p.evaluate(id => { const t = Tabulator.findTable('.grilla-tabla')[0]; const c = t.getRow(id).getCell('descripcion'); t.addRange(c, c); }, pa.id);
  await p.evaluate(() => {
    const dt = new DataTransfer(); dt.setData('text/plain', 'Pegada A editada\nPegada B editada\nPegada C nueva\n');
    const el = document.querySelector('.grilla-tabla .tabulator-tableholder') || document.querySelector('.grilla-tabla');
    document.querySelector('.grilla-tabla').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await p.waitForTimeout(2000);
  await ir('/plan');
  d1 = await filas();
  log('  descripciones:', d1.map(a => a.descripcion).filter(x => /Pegada/.test(x || '')).join(' | '));
  check(d1.some(a => a.descripcion === 'Pegada A editada') && d1.some(a => a.descripcion === 'Pegada C nueva'), 'Ctrl+V de rango edita y agrega filas');

  // ---------- 4. Deshacer ----------
  // ---------- 5. Cerrar semana con validación ----------
  const yo = await p.evaluate(() => localStorage.getItem('lpsgt-demo-usuario'));
  await p.click('[data-a="cerrar"]').catch(() => errs.push('sin botón cerrar'));
  await p.waitForTimeout(600);
  const titulo = await p.textContent('.modal h2').catch(() => '');
  check(/No se puede cerrar/.test(titulo), 'cierre bloqueado por compromisos sin estado: ' + titulo);
  await btnModal('Entendido');
  await p.click('[data-a="completar"]');
  await p.waitForTimeout(500);
  await p.selectOption('.modal select[name="estado"]', 'completado');
  await btnModal('Aplicar');
  await p.waitForTimeout(1200);
  await p.click('[data-a="cerrar"]');
  await p.waitForTimeout(600);
  log('  confirmación:', (await p.textContent('.modal-cuerpo')).slice(0, 160));
  await btnModal('Cerrar semana');
  await p.waitForTimeout(1500);
  if (await p.$('.modal')) { log('  modal extra:', await p.textContent('.modal-cuerpo')); await btnModal('Cancelar'); }
  const aviso = await p.textContent('[data-aviso]');
  check(/está cerrada/.test(aviso), 'semana cerrada (aviso)');
  // intento de edición en semana cerrada
  const editable = await p.evaluate(id => { const t = Tabulator.findTable('.grilla-tabla')[0]; return t.getRow(id).getElement().classList.contains('fila-ajena'); }, nueva.id);
  check(editable, 'filas bloqueadas tras el cierre');
  await p.screenshot({ path: OUT + '/1_cerrada.png' });

  // ---------- 6. Líder propone proyecto ----------
  await ir('/proyectos');
  await p.click('[data-a="nuevo"]');
  await p.waitForTimeout(500);
  await rellenarModal();
  await p.fill('.modal input[name="codigo"]', 'E2E-1');
  await p.fill('.modal input[name="nombre_corto"]', 'Propuesto e2e');
  await p.screenshot({ path: OUT + '/2_proponer.png' });
  const btns = await p.$$eval('.modal-pie button', b => b.map(x => x.textContent));
  await btnModal(btns[btns.length - 1]);
  await p.waitForTimeout(1000);
  log('  toasts:', (await toasts()).join(' | '));

  // ---------- 7. Consulta registra solicitud ----------
  await entrar(8);
  await ir('/cartera');
  await p.click('[data-a="nueva"]').catch(() => errs.push('consulta sin botón nueva solicitud'));
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/3_solicitud.png' });
  const campos = await p.$$eval('.modal [name]', c => c.map(x => x.name + ':' + x.tagName));
  log('  campos solicitud:', campos.join(', '));
  await rellenarModal();
  const b2 = await p.$$eval('.modal-pie button', b => b.map(x => x.textContent));
  await btnModal(b2[b2.length - 1]);
  await p.waitForTimeout(1000);
  log('  toasts:', (await toasts()).join(' | '));

  // ---------- 8. Admin aprueba proyecto, acepta solicitud, reabre semana ----------
  await entrar(1);
  const notif = await p.textContent('header').catch(() => '');
  await ir('/proyectos');
  await p.screenshot({ path: OUT + '/4_admin_proyectos.png' });
  const aprobar = await p.$('button:has-text("Aprobar")');
  check(!!aprobar, 'admin ve botón Aprobar para propuestos');
  if (aprobar) { await aprobar.click(); await p.waitForTimeout(600); if (await p.$('.modal')) { const bb = await p.$$eval('.modal-pie button', b => b.map(x => x.textContent)); await btnModal(bb[bb.length - 1]); } }
  await p.waitForTimeout(800);
  const est = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => /lpsgt-demo-db/.test(k)) || 'null'))?.proyectos?.find(x => x.codigo === 'E2E-1')?.estado);
  log('  estado proyecto E2E-1:', est);
  await ir('/cartera');
  await p.screenshot({ path: OUT + '/5_admin_cartera.png' });
  const aceptar = await p.$('button:has-text("Aceptar")');
  check(!!aceptar, 'admin ve botón Aceptar solicitud');
  if (aceptar) { await aceptar.click(); await p.waitForTimeout(600); if (await p.$('.modal')) { await p.screenshot({ path: OUT + '/6_aceptar.png' }); const bb = await p.$$eval('.modal-pie button', b => b.map(x => x.textContent)); await btnModal(bb[bb.length - 1]); } }
  log('  toasts:', (await toasts()).join(' | '));
  await ir('/plan?resp=' + yo);
  await p.click('[data-a="reabrir"]').catch(() => errs.push('sin botón reabrir'));
  await p.waitForTimeout(500);
  await btnModal('Reabrir');
  await p.waitForTimeout(1200);
  check(!/está cerrada/.test(await p.textContent('[data-aviso]')), 'semana reabierta por admin');
  // PDF
  await p.click('[data-a="pdf"]'); await p.waitForTimeout(1500);
  // LA comprometer
  await ir('/lookahead');
  await p.screenshot({ path: OUT + '/7_la.png' });
  await p.click('[data-a="comprometer"]'); await p.waitForTimeout(800);
  await p.screenshot({ path: OUT + '/8_comprometer.png' });
  if (await p.$('.modal')) { const bb = await p.$$eval('.modal-pie button', b => b.map(x => x.textContent)); log('  botones:', bb.join('|')); await btnModal(bb[bb.length - 1]); await p.waitForTimeout(800);
    if (await p.$('.modal')) { log('  2do modal:', (await p.textContent('.modal h2'))); await p.screenshot({ path: OUT + '/9_restr.png' }); const bb2 = await p.$$eval('.modal-pie button', b => b.map(x => x.textContent)); await btnModal(bb2[bb2.length - 1]); } }
  log('  toasts:', (await toasts()).join(' | '));
  // Notificaciones
  await p.click('[data-notif], .btn-notif, button[title*="otific"]').catch(() => log('  (sin selector campana)'));
  await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + '/10_notif.png' });

  console.log(errs.length ? '\nERRORES:\n' + errs.join('\n') : '\nSIN ERRORES');
  await b.close();
})();
