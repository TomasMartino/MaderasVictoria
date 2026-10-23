/* Pruebas de la comparacion entre la planilla (hoja PRECIOS) y el
 * catalogo: proponer cambios para aceptar o denegar uno por uno.
 * Se corre con: node --test tests
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const leer = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const ctx = vm.createContext({});
vm.runInContext(leer("../app/js/engine.js"), ctx, { filename: "engine.js" });
vm.runInContext(leer("../app/js/productos.js"), ctx, { filename: "productos.js" });
vm.runInContext(leer("../app/js/planilla.js"), ctx, { filename: "planilla.js" });

const PLANILLA = ctx.TV_PLANILLA;
const PRODUCTOS = ctx.TV_PRODUCTOS;

/* Catalogo de ejemplo: lo que hoy esta en la app */
const catalogo = [
  { nombre: "MDF 18 MM", unidad: "METRO LINEAL", precio: 9000, pideLargo: true, stock: 4, activo: true, propio: false, origen: "planilla" },
  { nombre: "MELAMINA", unidad: "UNIDAD", precio: 12500, pideLargo: false, stock: null, activo: true, propio: true, origen: "app" },
];

const filas = [
  ["Nombre", "Unidad", "Precio", "Pide Largo", "Stock"],
  ["MDF 18 MM", "METRO LINEAL", 9500, "y", 4],           // cambio de precio
  ["MELAMINA", "UNIDAD", 12500, "no", null],             // sin cambios
  ["PLACA OSB", "METRO 2", "18.500", "x", 2],            // nuevo producto
  ["FIERRO 6 MM", "¿QUE?", 100, "no", 1],                // ignorada: unidad invalida
  ["MDF 18 MM", "METRO LINEAL", 9500, "y", 4],           // repetido: dedupe
];

const formatear = (n) => n.toLocaleString("es-AR");

function revisar() {
  return PLANILLA.revisar(filas, catalogo, formatear);
}

test("detecta cambio de precio en producto existente", () => {
  const { cambios } = revisar();
  const c = cambios.find((x) => x.tipo === "campo" && x.campo === "precio" && x.nombre === "MDF 18 MM");
  assert.ok(c, "debe existir la propuesta de precio");
  assert.equal(c.valores.de, 9000);
  assert.equal(c.valores.a, 9500);
});

test("producto propio que no cambia no genera propuesta", () => {
  const { cambios } = revisar();
  assert.ok(!cambios.some((x) => x.nombre === "MELAMINA"), "melamina no Genera propuestas");
});

test("marca el precio propio en la propuesta", () => {
  /* forzamos un cambio de precio en MELAMINA (propio=true) */
  const melaminaConCambio = [
    ["Nombre", "Unidad", "Precio", "Pide Largo", "Stock"],
    ["MELAMINA", "UNIDAD", 14000, "no", null],
  ];
  const { cambios } = PLANILLA.revisar(melaminaConCambio, catalogo);
  const c = cambios.find((x) => x.campo === "precio" && x.nombre === "MELAMINA");
  assert.ok(c, "debe proponer el cambio");
  assert.equal(c.propio, true, "debe avisar que tenia precio propio");
});

test("detecta producto nuevo", () => {
  const { cambios } = revisar();
  const c = cambios.find((x) => x.tipo === "nuevo");
  assert.ok(c, "debe existir propuesta de nuevo producto");
  assert.equal(c.nombre, "PLACA OSB");
  assert.ok(c.a.indexOf("METRO 2") !== -1 && c.a.indexOf("18.500") !== -1);
  assert.equal(c.producto.precio, 18500, "la string 18.500 se parsea con los puntos de miles");
  assert.equal(c.producto.pideLargo, true, "x cuenta como s");
});

test("repetido solo propone una vez", () => {
  const { cambios } = revisar();
  const precios = cambios.filter((x) => x.campo === "precio" && x.nombre === "MDF 18 MM");
  assert.equal(precios.length, 1);
});

test("unidad invalida se ignora y se informa", () => {
  const { ignoradas } = revisar();
  assert.equal(ignoradas.length, 1);
  assert.equal(PRODUCTOS.clave(ignoradas[0]), PRODUCTOS.clave("FIERRO 6 MM"));
});

test("activo que ya no esta en la planilla propone darlo de baja", () => {
  const catalogoConViejo = catalogo.concat([
    { nombre: "MDF VIEJO 10", unidad: "METRO LINEAL", precio: 5000, pideLargo: true, stock: null, activo: true, propio: false, origen: "planilla" },
  ]);
  const { cambios } = PLANILLA.revisar(filas, catalogoConViejo);
  const fuera = cambios.find((x) => x.tipo === "fuera");
  assert.ok(fuera, "debe proponer la baja del que falta en el Excel");
  assert.equal(PRODUCTOS.clave(fuera.nombre), PRODUCTOS.clave("MDF VIEJO 10"));
  assert.ok(fuera.actual, "trae el producto actual para aplicarla");
  assert.ok(!fuera.estado, "arranca pendiente");
});

test("sin diferencias devuelve vacio", () => {
  const iguales = [
    ["Nombre", "Unidad", "Precio", "Pide Largo", "Stock"],
    ["MDF 18 MM", "METRO LINEAL", 9000, "y", 4],
    ["MELAMINA", "UNIDAD", 12500, "no", null],
  ];
  const r = PLANILLA.revisar(iguales, catalogo);
  assert.equal(r.cambios.length, 0);
  assert.equal(r.ignoradas.length, 0);
});

test("encabezado PRODUCTO tambien se reconoce", () => {
  const conProducto = [
    ["PRODUCTO", "UNIDAD", "PRECIO", "PIDE LARGO", "STOCK"],
    ["MDF 18 MM", "METRO LINEAL", 7000, "y", null],
  ];
  const r = PLANILLA.revisar(conProducto, catalogo);
  const c = r.cambios.find((x) => x.campo === "precio");
  assert.ok(c, " precio detectado con header PRODUCTO");
});
