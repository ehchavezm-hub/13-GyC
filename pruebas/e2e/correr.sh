#!/usr/bin/env bash
# Pruebas de pantallas en modo demostración (?demo, sin base de datos).
# Uso: bash pruebas/e2e/correr.sh [prueba ...]   (sin argumentos corre la lista de regresión)
# Requiere Node 18+ y Playwright (cd pruebas && npm install && npx playwright install chromium),
# o PW_CHROMIUM=/ruta/a/chrome si ya hay un Chromium instalado.
cd "$(dirname "$0")"
mkdir -p salida
RAIZ=$(cd ../.. && pwd)
# Servidor local de la carpeta app/ en el puerto que usan las pruebas
if ! curl -s -o /dev/null http://localhost:8099/; then
  (setsid nohup python3 -m http.server 8099 -d "$RAIZ/app" >/dev/null 2>&1 < /dev/null &)
  sleep 1
fi
[ -d node_modules ] || ln -sfn ../node_modules node_modules
LISTA=${*:-"tablero_todos grupo_naranja backlog fechas sincronizacion kpi_filtro grupos ingreso_red aud3 d10 d9 d7 d5 grupolps traslape multi usuarios tarjeta borrar a11 q2 q5 q6 q10 q15 q16 mover adm10 equipo clave aud2"}
FALLAS=0
for f in $LISTA; do
  f=${f%.js}
  if timeout 200 node "$f.js" > "salida/$f.txt" 2>&1 && grep -q "SIN ERRORES" "salida/$f.txt"; then echo "OK    $f"
  else echo "FALLA $f  (ver pruebas/e2e/salida/$f.txt)"; FALLAS=$((FALLAS+1)); fi
done
echo "$FALLAS con falla"
