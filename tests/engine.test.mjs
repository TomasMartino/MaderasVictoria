/* Pruebas del motor contra los casos reales del Excel.
 * Se corre con: node --test tests
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const codigo = readFileSync(new URL("../app/js/engine.js", import.meta.url), "utf8");
vm.runInThisContext(codigo, { filename: "engine.js" });
const TV = globalThis.TV;

const metro = { nombre: "TIRANTE 2X4", unidad: "METRO LINEAL", precio: 1000, pideLargo: true };
const unidad = { nombre: "PLACA 18MM", unidad: "UNIDAD", precio: 8500, pideLargo: false };
const sinPrecio = { nombre: "DOLARES 05/03", unidad: "UNIDAD", precio: null, pideLargo: false };

const caso = (producto, cantidad, largo) => ({ producto, cantidad, largo });

test("redondea el largo hacia arriba al paso de corte de 0,50 m", () => {
  assert.equal(TV.largoAPedir(4.2, 0.5).valor, 4.5);
  assert.equal(TV.largoAPedir(4.5, 0.5).valor, 4.5);
  assert.equal(TV.largoAPedir(4.7, 0.5).valor, 5);
  assert.equal(TV.largoAPedir(3.66, 0.5).valor, 4);
  assert.equal(TV.largoAPedir(0.5, 0.5).valor, 0.5);
  assert.equal(TV.largoAPedir(3, 0.5).valor, 3);
});

test("no sube un paso de mas por error de coma flotante", () => {
  assert.equal(TV.largoAPedir(2.0000000000000004, 0.5).valor, 2);
  assert.equal(TV.largoAPedir(2.5, 0.5).valor, 2.5);
});

test("acepta coma y punto como decimal", () => {
  assert.equal(TV.largoAPedir("4,2", 0.5).valor, 4.5);
  assert.equal(TV.largoAPedir("4.2", 0.5).valor, 4.5);
  assert.equal(TV.largoAPedir(" 3,66 ", 0.5).valor, 4);
});

test("rechaza largos fuera de rango, vacios o que no son numero", () => {
  assert.equal(TV.largoAPedir(0.3, 0.5).ok, false);
  assert.equal(TV.largoAPedir(50.1, 0.5).ok, false);
  assert.equal(TV.largoAPedir(0, 0.5).ok, false);
  assert.equal(TV.largoAPedir("", 0.5).ok, false);
  assert.equal(TV.largoAPedir("4,2 metros", 0.5).ok, false);
  assert.equal(TV.largoAPedir(0.3, 0.5).motivo, "REVISAR LARGO");
});

test("el 46057 del bug de fechas de Excel queda como REVISAR LARGO", () => {
  // Escribir 4.2 en una celda de Excel la convierte en fecha: serie 46057.
  const r = TV.largoAPedir(46057, 0.5);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "REVISAR LARGO");
});

test("producto por metro lineal: cantidad x largo a pedir x precio", () => {
  const c = TV.calcularLinea(caso(metro, 2, "4,2"), 0.5);
  assert.equal(c.largoPedir, 4.5);
  assert.equal(c.total, 9000); // 2 x 4,50 x 1000
  assert.equal(c.aviso, null);
});

test("producto por unidad: cantidad x precio, sin largo", () => {
  const c = TV.calcularLinea(caso(unidad, 3), 0.5);
  assert.equal(c.total, 25500);
  assert.equal(c.largoTiene, false);
});

test("producto por metro lineal sin largo cargado no suma", () => {
  const c = TV.calcularLinea(caso(metro, 2, ""), 0.5);
  assert.equal(c.total, null);
  assert.equal(c.aviso, "REVISAR LARGO");
});

test("sin cantidad el total queda vacio, no en cero", () => {
  assert.equal(TV.calcularLinea(caso(metro, "", "4,2"), 0.5).total, null);
  assert.equal(TV.calcularLinea(caso(unidad, ""), 0.5).total, null);
});

test("producto sin precio avisa y no inventa cero", () => {
  const c = TV.calcularLinea(caso(sinPrecio, 2), 0.5);
  assert.equal(c.aviso, "SIN PRECIO");
  assert.equal(c.total, null);
});

test("linea sin producto esta vacia", () => {
  const c = TV.calcularLinea({ producto: null, cantidad: 2, largo: 3 }, 0.5);
  assert.equal(c.vacia, true);
  assert.equal(c.total, null);
});

test("el resumen suma solo las lineas completas y ubica los avisos", () => {
  const lineas = [
    caso(metro, 2, "4,2"), // 9000
    caso(sinPrecio, 1), // aviso
    caso(unidad, 1), // 8500
    caso(metro, 1, ""), // aviso
  ];
  const r = TV.resumen(lineas, 0.5);
  assert.equal(r.total, 17500);
  assert.equal(r.validas, 2);
  assert.deepEqual(
    r.avisos.map((a) => a.indice),
    [1, 3],
  );
  assert.equal(r.avisos[0].motivo, "SIN PRECIO");
  assert.equal(r.avisos[1].motivo, "REVISAR LARGO");
});

test("parseNumero: la coma manda sobre el punto", () => {
  assert.equal(TV.parseNumero("1.234,5"), 1234.5);
  assert.equal(TV.parseNumero("4,2"), 4.2);
  assert.equal(TV.parseNumero("$ 8.500"), 8500);
  assert.equal(TV.parseNumero("4.500"), 4500);
  assert.equal(TV.parseNumero("4,500"), 4.5);
  assert.equal(TV.parseNumero(""), null);
  assert.equal(TV.parseNumero("abc"), null);
  assert.equal(TV.parseNumero(null), null);
});

test("formato de plata en pesos argentinos", () => {
  const s = TV.pesos(76500);
  assert.match(s, /76\.500/);
  assert.equal(TV.pesos(null), "—");
  assert.equal(TV.metros(4.5), "4,50 m");
});

/* --- la frontera donde estaba el bug: la pantalla guarda el nombre del
   producto y el motor necesita el producto del catalogo --- */

const CAT_PRUEBA = { paso: 0.5, productos: [metro, unidad, sinPrecio] };

test("la calculadora resuelve el precio desde el nombre guardado", () => {
  const CALC = TV.crearCalculadora(CAT_PRUEBA);
  const c = CALC.linea({ producto: "TIRANTE 2X4", cantidad: "2", largo: "4,2" });
  assert.equal(c.precio, 1000);
  assert.equal(c.largoPedir, 4.5);
  assert.equal(c.total, 9000);
  assert.equal(c.aviso, null);
});

test("un nombre que ya no esta en el catalogo no rompe ni inventa precio", () => {
  const CALC = TV.crearCalculadora(CAT_PRUEBA);
  const c = CALC.linea({ producto: "PRODUCTO BORRADO", cantidad: "2", largo: "4,2" });
  assert.equal(c.vacia, true);
  assert.equal(c.total, null);
});

test("el resumen de la calculadora tambien acepta nombres", () => {
  const CALC = TV.crearCalculadora(CAT_PRUEBA);
  const r = CALC.resumen([
    { producto: "TIRANTE 2X4", cantidad: "2", largo: "4,2" },
    { producto: "PLACA 18MM", cantidad: "1" },
    { producto: "DOLARES 05/03", cantidad: "1" },
  ]);
  assert.equal(r.total, 17500);
  assert.equal(r.validas, 2);
  assert.equal(r.avisos.length, 1);
  assert.equal(r.avisos[0].indice, 2);
});

test("la calculadora usa el paso de corte del catalogo", () => {
  const CALC = TV.crearCalculadora({ paso: 0.25, productos: [metro] });
  assert.equal(CALC.linea({ producto: "TIRANTE 2X4", cantidad: "1", largo: "4,2" }).largoPedir, 4.25);
});

/* --- el mensaje que recibe el cliente --- */

test("la fecha se muestra como en el papel", () => {
  assert.equal(TV.fechaLarga("2026-10-22"), "22/10/2026");
  assert.equal(TV.fechaLarga(""), "");
  assert.equal(TV.fechaLarga("lo que sea"), "lo que sea");
});

test("el mensaje de WhatsApp lleva cliente, lineas, total y el aviso de IVA", () => {
  const CALC = TV.crearCalculadora({ paso: 0.5, productos: [metro, unidad] });
  const texto = TV.textoPresupuesto({
    negocio: "Maderas Victoria",
    tipo: "PRESUPUESTO",
    cliente: "Juan Gomez",
    fecha: "2026-10-22",
    calc: CALC,
    lineas: [
      { producto: "TIRANTE 2X4", cantidad: "2", largo: "4,2" },
      { producto: "PLACA 18MM", cantidad: "1" },
    ],
  });

  const lineas = texto.split("\n");
  assert.equal(lineas[0], "*Maderas Victoria*");
  assert.equal(lineas[1], "Presupuesto");
  assert.equal(lineas[2], "Cliente: Juan Gomez");
  assert.equal(lineas[3], "Fecha: 22/10/2026");
  assert.equal(lineas[4], "");
  assert.match(texto, /TIRANTE 2X4 — 2 × 4,50 m/);
  assert.match(texto, /PLACA 18MM — 1 un\./);
  assert.match(texto, /\*TOTAL: .*17\.500\*/);
  assert.equal(lineas[lineas.length - 1], "Precios más IVA.");
});

test("el mensaje no incluye lineas sin precio ni sin cantidad", () => {
  const CALC = TV.crearCalculadora({ paso: 0.5, productos: [unidad, sinPrecio] });
  const texto = TV.textoPresupuesto({
    negocio: "Maderas Victoria",
    tipo: "NOTA DE PEDIDO",
    calc: CALC,
    lineas: [
      { producto: "PLACA 18MM", cantidad: "1" },
      { producto: "DOLARES 05/03", cantidad: "3" },
      { producto: "PLACA 18MM", cantidad: "" },
    ],
  });
  assert.match(texto, /Nota de pedido/);
  assert.ok(!/DOLARES/.test(texto));
  assert.equal((texto.match(/PLACA 18MM/g) || []).length, 1);
  assert.match(texto, /TOTAL: .*8\.500/);
});
