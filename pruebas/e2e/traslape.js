const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(B + '?demo#/tablero'); await p.waitForTimeout(1500);
  await p.evaluate(async () => {
    const { api } = await import('./js/data/api.js'); const s = await import('./js/core/store.js');
    const area = s.store.area.id; const ps = s.store.proyectos.filter(x => !x.padre_id);
    const [f] = await api.insert('portafolios', { area_id: area, nombre: 'GT_POR', estado: 'activo' });
    const [f2] = await api.insert('portafolios', { area_id: area, nombre: 'Obras Industriales', estado: 'activo' });
    const progs = [];
    for (const [n, pf] of [['GT_PROG', f], ['Obras sur', f2], ['Varias obras Lima', f2]]) progs.push((await api.insert('programas', { area_id: area, nombre: n, portafolio_id: pf.id, estado: 'activo' }))[0]);
    let i = 0;
    for (const P of ps) { const g = progs[i % 3]; await api.update('proyectos', P.id, { portafolio_id: g.portafolio_id, programa_id: g.id }); i++; }
    // dos Grupos LPS bajo el primer proyecto de cada programa
    for (const g of progs) { const P = ps.find(x => x.programa_id === g.id) || ps[progs.indexOf(g)];
      for (const k of [1, 2]) await api.insert('proyectos', { area_id: area, codigo: P.codigo + '.' + k, nombre_corto: 'Grupo LPS con nombre largo ' + k, estado: 'activo', padre_id: P.id, portafolio_id: g.portafolio_id, programa_id: g.id }); }
  });
  await p.goto(B + '?demo&a=1#/admin'); await p.waitForTimeout(1200);
  await p.click('.admin-item:has-text("Estructura de todas")'); await p.waitForTimeout(600);
  await p.click('[data-vista="arbol"]'); await p.waitForTimeout(600);
  const r = await p.evaluate(() => {
    const cs = [...document.querySelectorAll('.org-caja')].map(e => ({ t: e.innerText.split('\n')[0], r: (() => { const q = e.getBoundingClientRect(); const m = e.querySelector('.org-mas')?.getBoundingClientRect(); return m ? { left: q.left, top: q.top, bottom: Math.max(q.bottom, m.bottom), right: Math.max(q.right, m.right) } : q; })() }));
    const sobre = [];
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i].r, c = cs[j].r;
      if (a.left < c.right + 6 && c.left < a.right + 6 && a.top < c.bottom - 1 && c.top < a.bottom - 1) sobre.push(cs[i].t + ' ⟷ ' + cs[j].t);
    }
    const cols = [...document.querySelectorAll('.org-arbol li')].filter(li => li.querySelector(':scope > .org-programa')).map(li => {
      const rs = [...li.querySelectorAll('.org-caja')].map(e => e.getBoundingClientRect()); return { t: li.querySelector('.org-programa b').innerText, l: Math.min(...rs.map(x => x.left)), r: Math.max(...rs.map(x => x.right)) + 9 }; });
    const invade = []; for (let i = 0; i + 1 < cols.length; i++) if (cols[i].r > cols[i + 1].l) invade.push(cols[i].t + ' → ' + cols[i + 1].t + ' (' + Math.round(cols[i].r - cols[i + 1].l) + ' px)');
    return { invade, cajas: cs.length, sub: document.querySelectorAll('.org-subproyecto').length, sobre };
  });
  console.log(JSON.stringify(r));
  await p.locator('.org-lienzo').screenshot({ path: require('path').join(__dirname, 'salida', 'traslape.png') });
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
