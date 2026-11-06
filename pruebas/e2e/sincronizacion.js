// Guardado seguro: un envío colgado no bloquea los siguientes; reintentos sin duplicados; ediciones que fallan por la red
// se conservan (también al recargar); el relleno que no pasa por la edición de celda aplica las reglas de la fila.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await b.newContext({ viewport: { width: 1700, height: 1000 }, serviceWorkers: 'block' });   // sin recarga automática por versión nueva
  await ctx.addInitScript(() => { window.LPSGT_LIMITE_GUARDADO_MS = 1500; });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  const fallas = []; const chk = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallas.push(m); };
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  const ini = await p.evaluate(async () => {
    const { api } = await import('./js/data/api.js'); const s = await import('./js/core/store.js');
    const P = s.store.proyectos.find(x => !x.padre_id);
    const [G] = await api.insert('proyectos', { area_id: s.store.area.id, codigo: 'G-SYNC', nombre_corto: 'LPS Gestión', estado: 'activo', padre_id: P.id });
    await s.cargarCatalogo(); s.seleccionarProyecto(G.id);
    return { total: (await api.list('actividades', {})).length };
  });
  const contar = t => p.evaluate(async t => (await (await import('./js/data/api.js')).api.list('actividades', {})).filter(a => a.descripcion === t).length, t);
  const nuevaFila = async texto => {
    await p.click('[data-a="nueva"]'); await p.waitForTimeout(500);   // la app abre el editor de «Actividad» en la fila nueva
    await p.keyboard.type(texto); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  };

  await p.goto(B + '?demo#/lookahead'); await p.waitForTimeout(2200);
  // 1) El primer envío se cuelga (como al cambiar de red): los siguientes no deben quedar bloqueados para siempre
  await p.evaluate(async () => { const { api } = await import('./js/data/api.js'); window.__ins = api.insert; let n = 0;
    api.insert = (...a) => (n++ === 0 ? new Promise(() => {}) : window.__ins(...a)); });
  await nuevaFila('Sync A'); await nuevaFila('Sync B'); await nuevaFila('Sync C');
  await p.waitForTimeout(500);
  const indicador = await p.locator('.grilla-estado').innerText();
  console.log('  indicador:', indicador.replace(/\s+/g, ' '));
  await p.waitForTimeout(9000);   // tiempo límite + reintento automático
  const ab = [await contar('Sync A'), await contar('Sync B'), await contar('Sync C')];
  chk(ab.every(n => n === 1), `envío colgado: las 3 actividades se guardan, sin duplicados (${ab.join(', ')})`);
  // 2) La respuesta se pierde aunque sí se guardó: el reintento no duplica
  await p.evaluate(async () => { const { api } = await import('./js/data/api.js'); let n = 0;
    api.insert = async (...a) => { const r = await window.__ins(...a); if (n++ === 0) throw new Error('Failed to fetch'); return r; }; });
  await nuevaFila('Sync D'); await p.waitForTimeout(9000);
  chk(await contar('Sync D') === 1, 'respuesta perdida: el reintento no duplica (1 sola «Sync D»)');
  // 3) Una edición falla por la red: no se revierte, y al recargar la página se reaplica y se guarda
  await p.evaluate(async () => { const { api } = await import('./js/data/api.js'); api.insert = window.__ins; window.__upd = api.update;
    api.update = async () => { throw new Error('Failed to fetch'); }; });
  const celda = p.locator('.tabulator-row', { hasText: 'Sync A' }).locator('[tabulator-field="descripcion"]');
  await celda.dblclick(); await p.keyboard.press('Control+A'); await p.keyboard.type('Sync A editada'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  chk((await p.locator('.tabulator-row', { hasText: 'Sync A editada' }).count()) === 1, 'edición con falla de red: no se revierte en pantalla');
  chk(/sin guardar/.test(await p.locator('.grilla-estado').innerText()), 'aviso «⚠ N sin guardar» con «Reintentar»');
  await p.goto(B + '?demo#/plan'); await p.waitForTimeout(800);   // sale de la pantalla (nueva carga sin la falla simulada)
  await p.reload(); await p.waitForTimeout(1200);
  await p.goto(B + '?demo#/lookahead'); await p.waitForTimeout(4000);
  chk(await contar('Sync A editada') === 1 && await contar('Sync A') === 0, 'al volver a abrir: la edición pendiente se reaplica y se guarda');
  // 4) Relleno que no pasa por la edición de celda (como arrastrar la esquina): «Trasladada al plan» compromete
  const r4 = await p.evaluate(async () => {
    const t = (window.Tabulator || window.TabulatorFull)?.findTable?.('[data-grilla] .tabulator')?.[0];
    if (!t) return 'sin tabla';
    const fila = t.getRows().find(r => r.getData().descripcion === 'Sync B');
    fila.update({ estado_la: 'trasladada' });
    await new Promise(r => setTimeout(r, 2500));
    const { api } = await import('./js/data/api.js');
    const x = (await api.list('actividades', {})).find(a => a.descripcion === 'Sync B');
    return `${x.estado_la}/${x.comprometida}`;
  });
  chk(r4 === 'trasladada/true', `relleno sin edición de celda: aplica la regla (estado/comprometida = ${r4})`);
  const fin = await p.evaluate(async () => (await (await import('./js/data/api.js')).api.list('actividades', {})).length);
  chk(fin === ini.total + 4, `sin pérdidas ni duplicados (actividades ${fin} = ${ini.total} + 4)`);
  console.log(errs.length || fallas.length ? ['ERRORES', ...errs, ...fallas] : 'SIN ERRORES');
  await b.close();
})();
