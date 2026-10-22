/* Contrato del catalogo generado desde Excel (app/js/catalogo.js).
 * Si alguien regenera con una planilla rota, esto lo frena antes de publicar.
 * Se corre con: node --test tests
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

globalThis.window = globalThis;
vm.runInThisContext(readFileSync(new URL("../app/js/catalogo.js", import.meta.url), "utf8"), {
  filename: "catalogo.js",
});
vm.runInThisContext(readFileSync(new URL("../app/js/engine.js", import.meta.url), "utf8"), {
  filename: "engine.js",
});

const CAT = globalThis.TV_CATALOGO;
const TV = globalThis.TV;
const UNIDADES = new Set(["METRO LINEAL", "UNIDAD", "METRO 2", "UNIDAD/M2"]);

test("el catalogo tiene los 87 productos de la planilla", () => {
  assert.equal(CAT.productos.length, 87);
  assert.equal(CAT.paso, 0.5);
});

test("hay 30 con precio y 57 sin precio, como en el Excel", () => {
  const conPrecio = CAT.productos.filter((p) => typeof p.p === "number").length;
  assert.equal(conPrecio, 30);
  assert.equal(CAT.productos.length - conPrecio, 57);
});

test("los 26 productos por metro lineal piden largo", () => {
  const lineales = CAT.productos.filter((p) => p.u === "METRO LINEAL");
  assert.equal(lineales.length, 26);
  assert.equal(lineales.filter((p) => p.l !== true).length, 0);
});

test("solo los productos por metro lineal piden largo", () => {
  const otros = CAT.productos.filter((p) => p.u !== "METRO LINEAL");
  assert.equal(otros.filter((p) => p.l !== false).length, 0);
});

test("cada producto tiene nombre unico, unidad valida y precio numerico o nulo", () => {
  const nombres = new Set();
  for (const p of CAT.productos) {
    assert.ok(typeof p.n === "string" && p.n.trim().length > 0, "nombre vacio");
    assert.ok(!nombres.has(p.n), "nombre repetido: " + p.n);
    nombres.add(p.n);
    assert.ok(UNIDADES.has(p.u), "unidad rara: " + p.u);
    assert.ok(p.p === null || (typeof p.p === "number" && p.p > 0), "precio invalido en " + p.n);
    assert.equal(typeof p.l, "boolean");
  }
});

test("los telefonos del negocio salen del Excel", () => {
  assert.deepEqual(CAT.negocio.telefonos, ["2615410210", "2615860139"]);
});

test("una linea real del catalogo calcula como en la planilla", () => {
  const CALC = TV.crearCalculadora(CAT);
  const c = CALC.linea({ producto: "VIGA 23-25CM", cantidad: "2", largo: "4,2" });
  assert.equal(c.precio, 8500);
  assert.equal(c.largoPedir, 4.5);
  assert.equal(c.total, 76500);
});

test("un producto sin precio del catalogo real avisa en vez de valer cero", () => {
  const CALC = TV.crearCalculadora(CAT);
  const sinPrecio = CAT.productos.find((p) => p.p === null);
  const c = CALC.linea({ producto: sinPrecio.n, cantidad: "1" });
  assert.equal(c.aviso, "SIN PRECIO");
  assert.equal(c.total, null);
});
