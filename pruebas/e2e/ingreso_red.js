// Ingreso sin conexión al servidor de datos: la app reintenta, diagnostica y explica qué hacer (no solo «Sin conexión»).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const fallas = []; const chk = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallas.push(m); };
  const B = 'http://localhost:8099/';
  for (const caso of ['bloqueado', 'solo_ingreso']) {
    const p = await (await b.newContext()).newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    let intentos = 0;
    await p.route('**/*.supabase.co/**', r => {
      const u = r.request().url();
      if (u.includes('/auth/v1/token')) intentos++;
      if (caso === 'bloqueado' || u.includes('/auth/v1/token')) return r.abort('failed');
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await p.route('**/fonts.g*/**', r => r.abort());
    await p.goto(B); await p.waitForSelector('#l-email');
    chk((await p.locator('.logo').first().innerText()).includes('LPS-GES'), `${caso}: el logo dice LPS-GES`);
    await p.fill('#l-email', 'prueba@ejemplo.pe'); await p.fill('#l-clave', 'Clave-1234');
    await p.click('[data-f="ingresar"] button'); await p.waitForTimeout(3000);
    const diag = (await p.locator('.login-diagnostico').innerText().catch(() => '')).replace(/\s+/g, ' ');
    console.log('  ', diag.slice(0, 170));
    chk(intentos === 2, `${caso}: reintenta una vez (${intentos} intentos)`);
    if (caso === 'bloqueado') chk(/no logra conectarse/.test(diag) && /incógnito/.test(diag) && /supabase\.co/.test(diag), 'bloqueado: explica la causa y los pasos (incógnito, red, TI)');
    else chk(/servidor responde/.test(diag), 'solo ingreso: indica que el servidor responde y que reintente');
    if (errs.length) fallas.push(...errs);
  }
  console.log(fallas.length ? ['ERRORES', ...fallas] : 'SIN ERRORES');
  await b.close();
})();
