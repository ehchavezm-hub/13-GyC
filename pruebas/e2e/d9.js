// Pedido d9: exportar / importar por XLS en todas las listas, con botones verdes. Importar nunca borra.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const XLSX = require(path.join(__dirname, '..', '..', 'app', 'vendor', 'xlsx.full.min.js'));
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  const fallas = []; const chk = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallas.push(m); };
  const salida = path.join(__dirname, 'salida'); fs.mkdirSync(salida, { recursive: true });
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  const valores = clave => p.evaluate(async c => { const { api } = await import('./js/data/api.js'); const s = await import('./js/core/store.js');
    return (await api.list('lista_valores', { eq: { lista_id: s.store.listas[c].lista.id } })).map(v => ({ id: v.id, valor: v.valor, codigo: v.codigo, extra: v.extra })); }, clave);
  for (const clave of ['fases', 'servicios']) {
    await p.goto(B + `?demo#/config/listas?lista=${clave}`); await p.waitForTimeout(1500);
    const bExp = p.locator('[data-a="xls-exp"]'), bImp = p.locator('[data-a="xls-imp"]');
    const color = await bExp.evaluate(e => getComputedStyle(e).backgroundColor);
    chk(await bExp.count() && await bImp.count() && color === 'rgb(29, 111, 66)', `${clave}: botones Exportar / Importar XLS en verde (${color})`);
    const antes = await valores(clave);
    const [d] = await Promise.all([p.waitForEvent('download'), bExp.click()]);
    const archivo = path.join(salida, `${clave}.xlsx`); await d.saveAs(archivo);
    const wb = XLSX.read(fs.readFileSync(archivo), { type: 'buffer' }); const ws = wb.Sheets[wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    console.log('  cabecera:', filas[0].join(' | '), '·', filas.length - 1, 'filas');
    chk(filas.length - 1 === antes.length, `${clave}: exporta todos los valores (${filas.length - 1}/${antes.length})`);
    const iTxt = filas[0].indexOf(clave === 'servicios' ? 'Servicio' : 'Texto visible');
    const original = filas[1][iTxt];
    filas[1][iTxt] = original + ' (editado)';            // un cambio
    filas.splice(2, 1);                                 // una fila borrada del archivo: no debe borrarse de la lista
    const nueva = filas[0].map(() => ''); nueva[iTxt] = 'Valor nuevo d9'; filas.push(nueva);   // un valor nuevo
    if (clave === 'servicios') { chk(!filas[0].includes('Proyecto'), 'r3: el Excel de CET / Servicio no trae la columna Proyecto'); nueva[filas[0].indexOf('CET')] = 'CET-D9'; }
    const wb2 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(filas), 'Lista');
    const editado = path.join(salida, `${clave}-editado.xlsx`); fs.writeFileSync(editado, XLSX.write(wb2, { type: 'buffer', bookType: 'xlsx' }));
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), bImp.click()]); await fc.setFiles(editado); await p.waitForTimeout(1200);
    const resumen = (await p.locator('.modal').last().innerText()).replace(/\s+/g, ' ');
    console.log('  resumen:', resumen.slice(0, 220));
    chk(/1 nuevo/.test(resumen) && /1 con cambios/.test(resumen) && /se conservan/.test(resumen), `${clave}: muestra el resumen antes de aplicar (1 nuevo, 1 con cambios, el resto se conserva)`);
    await p.locator('.modal-pie button:has-text("Aplicar")').click(); await p.waitForTimeout(1500);
    const despues = await valores(clave);
    chk(despues.length === antes.length + 1, `${clave}: nada se borró (${antes.length} → ${despues.length})`);
    chk(despues.some(v => v.valor === original + ' (editado)'), `${clave}: el cambio se aplicó`);
    if (clave === 'servicios') {
      const n = despues.find(v => v.valor === 'Valor nuevo d9');
      chk(n && n.codigo === 'CET-D9' && !n.extra?.proyecto_id, 'servicios: el nuevo CET queda con su código y sin proyecto');
    }
  }
  // Proyectos / Procesos y Grupos LPS
  for (const l of ['__proyectos', '__grupos']) {
    await p.goto(B + `?demo#/config/listas?lista=${l}`); await p.waitForTimeout(1500);
    const n = await p.locator('.btn-excel').count();
    const [d] = await Promise.all([p.waitForEvent('download'), p.locator('[data-a="xls-exp"]').click()]);
    chk(n === 2 && !!d, `${l}: botones verdes Exportar / Importar XLS y descarga (${await d.suggestedFilename()})`);
  }
  // Importar Grupos LPS: cambia una descripción, no borra ni mueve actividades
  const g0 = await p.evaluate(async () => { const { api } = await import('./js/data/api.js'); const s = await import('./js/core/store.js');
    const P = s.store.proyectos.find(x => !x.padre_id);
    const [G] = await api.insert('proyectos', { area_id: s.store.area.id, codigo: 'G-D9', nombre_corto: 'Grupo d9', estado: 'activo', padre_id: P.id });
    await s.cargarCatalogo(); return { grupos: s.store.proyectos.filter(x => x.padre_id).length, acts: (await api.list('actividades', {})).length }; });
  await p.goto(B + '?demo#/config/listas?lista=__grupos'); await p.waitForTimeout(1500);
  const [dg] = await Promise.all([p.waitForEvent('download'), p.locator('[data-a="xls-exp"]').click()]);
  const ag = path.join(salida, 'grupos.xlsx'); await dg.saveAs(ag);
  const fg = XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync(ag), { type: 'buffer' }).Sheets['Grupos LPS'], { header: 1, defval: '' });
  fg[1][2] = 'Descripción desde Excel';
  const wbg = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wbg, XLSX.utils.aoa_to_sheet(fg), 'Grupos LPS');
  const ag2 = path.join(salida, 'grupos-editado.xlsx'); fs.writeFileSync(ag2, XLSX.write(wbg, { type: 'buffer', bookType: 'xlsx' }));
  const [fcg] = await Promise.all([p.waitForEvent('filechooser'), p.locator('[data-a="importar"]').click()]); await fcg.setFiles(ag2); await p.waitForTimeout(1000);
  const rg = (await p.locator('.modal').last().innerText()).replace(/\s+/g, ' ');
  chk(/0 Grupo\(s\) LPS nuevo/.test(rg) && /1 con cambios/.test(rg), 'grupos: resumen correcto (0 nuevos, 1 con cambios)');
  await p.locator('.modal-pie button:has-text("Aplicar")').click(); await p.waitForTimeout(1500);
  const g1 = await p.evaluate(async () => { const { api } = await import('./js/data/api.js'); const s = await import('./js/core/store.js');
    return { grupos: s.store.proyectos.filter(x => x.padre_id).length, acts: (await api.list('actividades', {})).length, desc: s.store.proyectos.filter(x => x.padre_id).map(x => x.nombre_completo) }; });
  chk(g1.grupos === g0.grupos && g1.acts === g0.acts && g1.desc.includes('Descripción desde Excel'), `grupos: cambio aplicado sin pérdida (grupos ${g1.grupos}/${g0.grupos}, actividades ${g1.acts}/${g0.acts})`);
  console.log(errs.length || fallas.length ? ['ERRORES', ...errs, ...fallas] : 'SIN ERRORES');
  await b.close();
})();
