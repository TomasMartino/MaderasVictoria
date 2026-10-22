/* Prueba de humo de la pantalla completa.
 *
 * Abre index.html en Edge headless (sin servidor, como lo va a abrir el tio),
 * siembra un presupuesto con los productos reales del catalogo y revisa lo
 * que la pantalla termino mostrando.
 *
 * Esto es lo que faltaba: los tests del motor pasaban mientras la pantalla
 * decia SIN PRECIO en todos los productos. Motor y pantalla se prueban
 * por separado, y tambien juntos.
 *
 * Se corre con: node --test tests
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find(existsSync);

const SEMILLA = `
try {
  localStorage.setItem("tiovity.presupuesto.v1", JSON.stringify({
    cliente: "Juan Gomez",
    direccion: "Ruta 40 Km 12, Maipu",
    telefono: "261 555 0199",
    fecha: "2026-10-22",
    tipo: "PRESUPUESTO",
    lineas: [
      { producto: "VIGA 23-25CM", cantidad: "2", largo: "4,2" },
      { producto: "MACHIMBRE 3/4 X4 1RA", cantidad: "12", largo: "" },
      { producto: "ROLLIZO 13-15CM", cantidad: "1", largo: "3,66" },
      { producto: "MEMBRANA 40KG", cantidad: "3", largo: "" }
    ]
  }));
} catch (e) {}
`;

/* Corre despues de app.js (mismo evento, registrado despues) y deja en el
 * documento el estado tal como quedo en pantalla, para poder afirmarlo. */
const REPORTE = `
document.addEventListener("DOMContentLoaded", function () {
  var filas = [].map.call(document.querySelectorAll(".linea"), function (row) {
    var pista = row.querySelector(".pista");
    return {
      producto: row.querySelector(".prod").value,
      cantidad: row.querySelector(".cant").value,
      largo: row.querySelector(".largo").value,
      largoDeshabilitado: row.querySelector(".largo").disabled,
      precio: row.querySelector(".precio").textContent,
      total: row.querySelector(".total").textContent,
      pista: pista.hidden ? "" : pista.textContent,
      nombreImprenta: row.querySelector(".prod-nombre").textContent,
      pedirImprenta: row.querySelector(".pedir-print").textContent
    };
  });
  var aviso = document.getElementById("aviso");
  var pre = document.createElement("pre");
  pre.id = "reporte";
  pre.textContent = JSON.stringify({
    cliente: document.getElementById("cliente").value,
    direccion: document.getElementById("direccion").value,
    telefono: document.getElementById("telefono").value,
    fecha: document.getElementById("fecha").value,
    total: document.getElementById("total").textContent,
    totalBar: document.getElementById("total-bar").textContent,
    aviso: aviso.hidden ? "" : aviso.textContent,
    filas: filas
  });
  document.body.appendChild(pre);
});
`;

function renderizar() {
  const dir = mkdtempSync(join(tmpdir(), "tiovity-humo-"));
  const app = join(dir, "app");
  cpSync(join(RAIZ, "app"), app, { recursive: true });

  writeFileSync(join(app, "seed.js"), SEMILLA, "utf8");
  writeFileSync(join(app, "reporte.js"), REPORTE, "utf8");
  const html = readFileSync(join(app, "index.html"), "utf8").replace(
    '<script src="js/app.js"></script>',
    '<script src="seed.js"></script>\n<script src="js/app.js"></script>\n<script src="reporte.js"></script>',
  );
  writeFileSync(join(app, "index.html"), html, "utf8");

  const r = spawnSync(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--virtual-time-budget=4000",
      `--user-data-dir=${join(dir, "perfil")}`,
      "--dump-dom",
      pathToFileURL(join(app, "index.html")).href,
    ],
    { encoding: "utf8", timeout: 90000 },
  );

  rmSync(dir, { recursive: true, force: true });
  if (r.error) throw r.error;

  const dom = r.stdout || "";
  const m = /<pre id="reporte">([\s\S]*?)<\/pre>/.exec(dom);
  if (!m) {
    throw new Error(
      "la pantalla no dejo reporte: no arranco o quedo un error de JavaScript.\n" +
        dom.slice(0, 600),
    );
  }

  const json = m[1]
    .replace(/&nbsp;/g, "\u00a0")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

  return JSON.parse(json);
}

const skip = !EDGE && "Edge no esta instalado";

/* Intl mete un espacio duro (U+00A0) entre el $ y el numero para que no se
 * corte en dos lineas. Aca se compara con espacio comun. */
const limpio = (v) => (typeof v === "string" ? v.replace(/\u00a0/g, " ") : v);

const r = EDGE ? renderizar() : { filas: [] };

test("la pantalla abre con el presupuesto guardado", { skip }, () => {
  assert.equal(r.filas.length, 4, "no se recuperaron las 4 lineas guardadas");
  assert.equal(r.cliente, "Juan Gomez");
  assert.equal(r.direccion, "Ruta 40 Km 12, Maipu");
  assert.equal(r.telefono, "261 555 0199");
  assert.equal(r.fecha, "2026-10-22");
});

test("cada linea calcula el precio y el total como en la planilla", { skip }, () => {
  const [viga, machimbre, rollizo] = r.filas;

  // 2 x 4,50 x 8.500
  assert.equal(limpio(viga.precio), "$ 8.500");
  assert.equal(limpio(viga.total), "$ 76.500");
  assert.equal(viga.pista, "se pide 4,50 m");

  // 12 x 9.900, producto por metro cuadrado: no pide largo
  assert.equal(limpio(machimbre.total), "$ 118.800");
  assert.equal(machimbre.largoDeshabilitado, true);
  assert.equal(machimbre.pista, "");

  // 3,66 se pide como 4,00
  assert.equal(rollizo.pista, "se pide 4,00 m");
  assert.equal(limpio(rollizo.total), "$ 20.000");
});

test("el total de la hoja suma solo las lineas completas", { skip }, () => {
  assert.match(limpio(r.total), /215\.300/);
  assert.match(limpio(r.totalBar), /215\.300/);
});

test("un producto sin precio queda avisado y no suma", { skip }, () => {
  const membrana = r.filas[3];
  assert.equal(membrana.precio, "SIN PRECIO");
  assert.equal(membrana.total, "—");
  assert.match(r.aviso, /Línea 4/);
  assert.match(r.aviso, /SIN PRECIO/);
});

test("la hoja impresa lleva el nombre pelado y el largo a pedir", { skip }, () => {
  assert.equal(r.filas[0].nombreImprenta, "VIGA 23-25CM");
  assert.equal(r.filas[0].pedirImprenta, "4,50 m");
  assert.equal(r.filas[1].nombreImprenta, "MACHIMBRE 3/4 X4 1RA");
  assert.equal(r.filas[1].pedirImprenta, "");
  assert.equal(r.filas[2].pedirImprenta, "4,00 m");
});
