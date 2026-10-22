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
  try {
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

  /* foto del presupuesto ANTES de tocar la pantalla de productos */
  var antes = {
    total: document.getElementById("total").textContent,
    totalBar: document.getElementById("total-bar").textContent,
    aviso: aviso.hidden ? "" : aviso.textContent
  };

  /* ---------- productos: se maneja la pantalla como lo haria el tio ---------- */
  window.confirm = function () { return true; };

  var porNombre = function (n) {
    return document.querySelector('#productos-lista .prod-fila[data-nombre="' + n + '"]');
  };
  var guardados = function () {
    try {
      return JSON.parse(localStorage.getItem("tiovity.productos.v1")).productos;
    } catch (e) {
      return [];
    }
  };
  var enviarForm = function () {
    var form = document.getElementById("form-producto");
    if (form.requestSubmit) form.requestSubmit();
    else form.querySelector('button[type="submit"]').click();
  };
  var abrirNuevo = function (nombre, precio, stock) {
    document.getElementById("productos-agregar").click();
    document.getElementById("p-nombre").value = nombre;
    document.getElementById("p-precio").value = precio;
    document.getElementById("p-stock").value = stock;
    enviarForm();
  };

  document.querySelector('.navbtn[data-view="productos"]').click();

  var listaAntes = document.querySelectorAll("#productos-lista .prod-fila").length;

  abrirNuevo("TIRANTE DE PRUEBA 2X6", "7.500", "40");

  var filaNueva = porNombre("TIRANTE DE PRUEBA 2X6");
  var opciones = [].map.call(
    document.querySelectorAll("#lineas select.prod option"),
    function (o) { return o.value; },
  );
  var guardadosNuevo = guardados().filter(function (p) { return p.nombre === "TIRANTE DE PRUEBA 2X6"; });

  var repProd = {
    navActivo: document.querySelector(".navbtn.is-active").dataset.view,
    vistaVisible: !document.getElementById("view-productos").classList.contains("is-hidden"),
    barraOculta: document.querySelector(".app").classList.contains("app--sin-barra"),
    listaAntes: listaAntes,
    listaDespues: document.querySelectorAll("#productos-lista .prod-fila").length,
    modalCerrado: document.getElementById("modal-producto").hidden,
    nuevoVisible: !!filaNueva,
    nuevoEnSelect: opciones.indexOf("TIRANTE DE PRUEBA 2X6") !== -1,
    nuevoStock: filaNueva ? filaNueva.querySelector(".prod__stock").textContent : "",
    nuevoPrecio: filaNueva ? filaNueva.querySelector(".prod__precio").textContent : "",
    guardado: guardadosNuevo.length,
    guardadoStock: guardadosNuevo.length ? guardadosNuevo[0].stock : null,
    resumen: document.getElementById("productos-resumen").textContent
  };

  /* editar el precio de un producto que ya esta en el presupuesto abierto:
   * la linea tiene que recalcularse sola (2 x 4,50 x 9.000 = 81.000) */
  porNombre("VIGA 23-25CM").click();
  document.getElementById("p-precio").value = "9.000";
  enviarForm();
  repProd.totalVigaTrasEditar = document.querySelector(".linea .total").textContent;
  repProd.vigaPrecio = porNombre("VIGA 23-25CM").querySelector(".prod__precio").textContent;

  /* un nombre repetido no puede entrar dos veces */
  document.getElementById("productos-agregar").click();
  document.getElementById("p-nombre").value = "viga 23-25cm";
  document.getElementById("p-precio").value = "1";
  enviarForm();
  repProd.errorRepetido = document.getElementById("p-errores").hidden
    ? ""
    : document.getElementById("p-errores").textContent;
  repProd.sinDuplicar = document.querySelectorAll("#productos-lista .prod-fila").length;
  document.getElementById("p-cancelar").click();

  /* dar de baja un producto que ya esta en el presupuesto abierto: la linea
   * no se puede vaciar ni perder el total */
  porNombre("VIGA 23-25CM").click();
  document.getElementById("p-baja").click();
  var selViga = document.querySelector("#lineas select.prod");
  repProd.bajaSelect = selViga.value;
  repProd.bajaOpcion = selViga.selectedOptions[0].textContent;
  repProd.bajaTotal = document.querySelector(".linea .total").textContent;
  repProd.bajaSigueEnCatalogo = !!porNombre("VIGA 23-25CM");
  porNombre("VIGA 23-25CM").click();
  document.getElementById("p-baja").click();
  repProd.reactivado = !!porNombre("VIGA 23-25CM") &&
    !porNombre("VIGA 23-25CM").classList.contains("prod-fila--baja");

  /* el buscador filtra */
  var buscador = document.getElementById("productos-buscar");
  buscador.value = "tirante";
  buscador.dispatchEvent(new Event("input", { bubbles: true }));
  repProd.filtrados = document.querySelectorAll("#productos-lista .prod-fila").length;
  buscador.value = "";
  buscador.dispatchEvent(new Event("input", { bubbles: true }));

  var pre = document.createElement("pre");
  pre.id = "reporte";
  pre.textContent = JSON.stringify({
    cliente: document.getElementById("cliente").value,
    direccion: document.getElementById("direccion").value,
    telefono: document.getElementById("telefono").value,
    fecha: document.getElementById("fecha").value,
    total: antes.total,
    totalBar: antes.totalBar,
    aviso: antes.aviso,
    filas: filas,
    productos: repProd
  });
  document.body.appendChild(pre);
  } catch (err) {
    var fallo = document.createElement("pre");
    fallo.id = "reporte";
    fallo.textContent = JSON.stringify({ error: String((err && err.stack) || err) });
    document.body.appendChild(fallo);
  }
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
if (r.error) console.error("REPORTE:", r.error);

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

/* ---------------- productos ---------------- */

const prod = r.productos || {};

test("la seccion de productos lista el catalogo completo", { skip }, () => {
  assert.equal(prod.navActivo, "productos");
  assert.equal(prod.vistaVisible, true);
  assert.equal(prod.barraOculta, true, "el total del presupuesto no debe quedar a la vista en productos");
  assert.equal(prod.listaAntes, 87);
  assert.match(limpio(prod.resumen), /^88 productos/);
  assert.match(limpio(prod.resumen), /31 con precio/);
});

test("un producto agregado en la pantalla entra al catalogo y al presupuesto", { skip }, () => {
  assert.equal(prod.nuevoVisible, true);
  assert.equal(prod.listaDespues, 88);
  assert.equal(prod.modalCerrado, true, "el formulario tiene que cerrarse al guardar");
  assert.equal(prod.nuevoEnSelect, true, "el producto nuevo tiene que aparecer en el desplegable");
  assert.equal(limpio(prod.nuevoPrecio), "$ 7.500");
  assert.equal(prod.nuevoStock, "40 m");
  assert.equal(prod.guardado, 1, "el producto nuevo tiene que quedar guardado");
  assert.equal(prod.guardadoStock, 40);
});

test("editar un precio recalcula el presupuesto abierto", { skip }, () => {
  assert.equal(limpio(prod.vigaPrecio), "$ 9.000");
  assert.equal(limpio(prod.totalVigaTrasEditar), "$ 81.000");
});

test("un nombre repetido se rechaza con aviso y no duplica", { skip }, () => {
  assert.match(prod.errorRepetido, /existe/i);
  assert.equal(prod.sinDuplicar, 88);
});

test("el buscador de productos filtra la lista", { skip }, () => {
  assert.equal(prod.filtrados, 1);
});

test("dar de baja un producto no rompe el presupuesto abierto", { skip }, () => {
  assert.equal(prod.bajaSelect, "VIGA 23-25CM", "la linea tiene que conservar el producto");
  assert.match(prod.bajaOpcion, /dado de baja/i, "el desplegable tiene que avisar que esta fuera de lista");
  assert.equal(limpio(prod.bajaTotal), "$ 81.000", "el total no puede cambiar por dar de baja");
  assert.equal(prod.bajaSigueEnCatalogo, true, "el producto no se borra del catalogo");
  assert.equal(prod.reactivado, true, "se tiene que poder volver a activar");
});
