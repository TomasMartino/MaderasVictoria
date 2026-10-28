/* Pruebas del detector de ventas repetidas.
 * Caso real: el balance se importó 3 veces porque la nube tardaba en
 * mostrarlo, y las ventas quedaron triplicadas (5 -> 10 -> 15).
 * Se corre con: node --test tests/duplicadas.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const leer = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const ctx = vm.createContext({});
vm.runInContext(leer("../app/js/engine.js"), ctx, { filename: "engine.js" });
vm.runInContext(leer("../app/js/productos.js"), ctx, { filename: "productos.js" });
vm.runInContext(leer("../app/js/planilla-ventas.js"), ctx, { filename: "planilla-ventas.js" });

const { duplicadas, duplicadasGastos } = ctx.TV_PLANILLA_VENTAS;

const venta = (id, fecha, detalle, monto, extra = {}) => ({
  id,
  fecha,
  detalle,
  monto,
  medioPago: extra.medioPago || "Efectivo",
  anulada: extra.anulada === true,
});

test("sin repetidas no devuelve nada", () => {
  const lista = [
    venta("a", "2026-10-27", "Tablas", 5000),
    venta("b", "2026-10-27", "Machimbre", 7000),
    venta("c", "2026-10-28", "Ventas 2026-10-28", 5000),
  ];
  assert.equal(duplicadas(lista).length, 0);
});

test("dos copias exactas forman un grupo", () => {
  const lista = [
    venta("a", "2026-10-27", "Ventas 2026-10-27", 5000),
    venta("b", "2026-10-27", "Ventas 2026-10-27", 5000),
    venta("c", "2026-10-28", "Ventas 2026-10-28", 5000),
  ];
  const grupos = duplicadas(lista);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].ventas.length, 2);
  assert.equal(grupos[0].ventas.map((v) => v.id).join(","), "a,b");
});

test("tres copias dejan dos para anular", () => {
  const lista = [
    venta("a", "2026-10-27", "Ventas 2026-10-27", 5000),
    venta("b", "2026-10-27", "Ventas 2026-10-27", 5000),
    venta("c", "2026-10-27", "Ventas 2026-10-27", 5000),
  ];
  const grupos = duplicadas(lista);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].ventas.length - 1, 2);
});

test("mismo dia y detalle pero distinto monto NO es duplicada", () => {
  const lista = [
    venta("a", "2026-10-27", "Tablas 3/4 x 4", 5000),
    venta("b", "2026-10-27", "Tablas 3/4 x 4", 6000),
  ];
  assert.equal(duplicadas(lista).length, 0);
});

test("distinto detalle con el mismo monto NO es duplicada", () => {
  const lista = [
    venta("a", "2026-10-27", "Tablas", 5000),
    venta("b", "2026-10-27", "Machimbre", 5000),
  ];
  assert.equal(duplicadas(lista).length, 0);
});

test("distinto medio de pago NO es duplicada", () => {
  const lista = [
    venta("a", "2026-10-27", "Ventas 2026-10-27", 5000, { medioPago: "Efectivo" }),
    venta("b", "2026-10-27", "Ventas 2026-10-27", 5000, { medioPago: "Transferencia" }),
  ];
  assert.equal(duplicadas(lista).length, 0);
});

test("las anuladas no cuentan como duplicadas", () => {
  const lista = [
    venta("a", "2026-10-27", "Ventas 2026-10-27", 5000),
    venta("b", "2026-10-27", "Ventas 2026-10-27", 5000, { anulada: true }),
  ];
  assert.equal(duplicadas(lista).length, 0);
});

test("mayusculas y acentos no cambian la clave del detalle", () => {
  const lista = [
    venta("a", "2026-10-27", "Ventas 2026-10-27", 5000),
    venta("b", "2026-10-27", "VENTAS 2026-10-27", 5000),
  ];
  const grupos = duplicadas(lista);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].ventas.length, 2);
});

test("el total del dia se agrupa aunque el monto haya cambiado entre intentos", () => {
  const lista = [
    venta("a", "2026-10-27", "Ventas 2026-10-27", 5000),
    venta("b", "2026-10-27", "Ventas 2026-10-27", 10000),
    venta("c", "2026-10-27", "Ventas 2026-10-27", 15000),
  ];
  const grupos = duplicadas(lista);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].ventas.length - 1, 2);
});

/* ---------- gastos ---------- */

const gasto = (id, fecha, categoria, concepto, monto, extra = {}) => ({
  id,
  fecha,
  categoria,
  concepto,
  monto,
  anulada: extra.anulada === true,
});

test("gastos identicos forman un grupo", () => {
  const lista = [
    gasto("a", "2026-10-27", "Otros", "Ventas 2026-10-27", 5000),
    gasto("b", "2026-10-27", "Otros", "Ventas 2026-10-27", 5000),
  ];
  assert.equal(duplicadasGastos(lista).length, 1);
});

test("gasto total del dia se agrupa aunque cambie el monto", () => {
  const lista = [
    gasto("a", "2026-10-27", "Sueldos", "Sueldos 2026-10-27", 5000),
    gasto("b", "2026-10-27", "Sueldos", "Sueldos 2026-10-27", 9000),
  ];
  const grupos = duplicadasGastos(lista);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].gastos.length - 1, 1);
});

test("gastos de distinta categoria no se agrupan", () => {
  const lista = [
    gasto("a", "2026-10-27", "Sueldos", "Pago", 5000),
    gasto("b", "2026-10-27", "Proveedores", "Pago", 5000),
  ];
  assert.equal(duplicadasGastos(lista).length, 0);
});

test("gastos anulados no cuentan", () => {
  const lista = [
    gasto("a", "2026-10-27", "Otros", "Compra", 5000),
    gasto("b", "2026-10-27", "Otros", "Compra", 5000, { anulada: true }),
  ];
  assert.equal(duplicadasGastos(lista).length, 0);
});
