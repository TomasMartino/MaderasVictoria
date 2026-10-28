/* Pruebas de las cuentas del balance (hoja BALANCE del Excel).
 * Octubre 2026: el 1 cae jueves y el 31 sabado, asi que el mes tiene
 * 5 semanas (lunes a sabado) y arranca mostrando el lunes 28/09.
 * Se corre con: node --test tests/balance.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const leer = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const ctx = vm.createContext({});
vm.runInContext(leer("../app/js/balance.js"), ctx, { filename: "balance.js" });
const { construir, dia, esRangoMesCompleto } = ctx.TV_BALANCE;

const V = (fecha, monto, extra = {}) => ({ fecha, monto, detalle: "venta", ...extra });
const G = (fecha, monto, categoria, extra = {}) => ({ fecha, monto, categoria, ...extra });

const ventas = [
  V("2026-10-02", 10000),
  V("2026-10-03", 5000),
  V("2026-10-04", 4000),            // domingo con movimiento
  V("2026-10-02", 99000, { anulada: true }),
  V("2026-09-30", 7000),            // fuera del mes
  V("2026-11-01", 8000),            // fuera del mes
];

const gastos = [
  G("2026-10-02", 2000, "Otros"),
  G("2026-10-02", 1000, "Impuestos"),
  G("2026-10-03", 500, "Sueldos"),
  G("2026-10-05", 3000, "Proveedores"),
  G("2026-10-05", 50000, "Proveedores", { anulada: true }),
  G("2026-10-06", 900, "Categoria rara"), // cae en "Gastos"
];

const oct = construir(ventas, gastos, "2026-10-01", "2026-10-31");
const dias = oct.lineas.filter((l) => l.tipo === "dia");
const semanas = oct.lineas.filter((l) => l.tipo === "semana");
const mes = oct.lineas[oct.lineas.length - 1];

const buscarDia = (f) => dias.find((l) => l.fecha === f);

test("el total del mes suma solo lo del mes y sin anuladas", () => {
  assert.equal(mes.tipo, "mes");
  assert.equal(mes.ventas, 19000);
  assert.equal(mes.gastos, 2900);        // 2000 (Otros) + 900 (categoria rara)
  assert.equal(mes.impuestos, 1000);
  assert.equal(mes.sueldos, 500);
  assert.equal(mes.proveedores, 3000);
  assert.equal(mes.ingresos, 19000);
  assert.equal(mes.egresos, 7400);
  assert.equal(mes.neto, 11600);
});

test("una anulada no suma, ni venta ni gasto", () => {
  assert.equal(mes.ventas, 19000);      // no incluye los 99.000
  assert.equal(mes.proveedores, 3000);  // no incluye los 50.000
});

test("una fila de dia cuadra por dentro", () => {
  const d = buscarDia("2026-10-02");
  assert.ok(d);
  assert.equal(d.ventas, 10000);
  assert.equal(d.gastos, 2000);
  assert.equal(d.impuestos, 1000);
  assert.equal(d.egresos, 3000);
  assert.equal(d.neto, 7000);
  assert.equal(d.ingresos, d.ventas);
});

test("todas las filas cumplen ingresos - egresos = neto", () => {
  oct.lineas.forEach((l) => {
    assert.equal(l.neto, l.ingresos - l.egresos);
    assert.equal(l.ingresos, l.ventas);
    assert.equal(l.egresos, l.gastos + l.impuestos + l.sueldos + l.proveedores);
  });
});

test("los subtotales semanales suman exactamente el total del mes", () => {
  const suma = { ventas: 0, gastos: 0, impuestos: 0, sueldos: 0, proveedores: 0, ingresos: 0, egresos: 0, neto: 0 };
  semanas.forEach((s) => {
    Object.keys(suma).forEach((k) => { suma[k] += s[k]; });
  });
  Object.keys(suma).forEach((k) => {
    assert.equal(suma[k], mes[k], "columna " + k);
  });
});

test("cada subtotal semanal es la suma de sus dias", () => {
  oct.bloques.forEach((bloque) => {
    const filas = bloque.filter((l) => l.tipo === "dia");
    const sub = bloque.find((l) => l.tipo === "semana");
    const suma = { ventas: 0, gastos: 0, impuestos: 0, sueldos: 0, proveedores: 0, ingresos: 0, egresos: 0, neto: 0 };
    filas.forEach((f) => Object.keys(suma).forEach((k) => { suma[k] += f[k]; }));
    Object.keys(suma).forEach((k) => {
      assert.equal(suma[k], sub[k], "columna " + k + " del bloque " + sub.etiqueta);
    });
  });
});

test("octubre 2026 tiene 31 filas de dia y 5 semanas", () => {
  assert.equal(dias.length, 31);
  assert.equal(semanas.length, 5);
  assert.equal(oct.mesCompleto, true);
});

test("arranca el lunes de la semana del 1 y muestra el domingo solo con movimientos", () => {
  assert.equal(dias[0].fecha, "2026-09-28");   // lunes previo al 1/10
  const domingo = buscarDia("2026-10-04");
  assert.ok(domingo, "el domingo con venta tiene que aparecer");
  assert.equal(domingo.etiqueta, "Dom");
  assert.equal(domingo.ventas, 4000);
  assert.equal(buscarDia("2026-10-11"), undefined); // domingo sin movimientos: no aparece
});

test("un dia sin movimientos existe igual (para poder editarlo)", () => {
  const d = buscarDia("2026-10-01");
  assert.ok(d);
  assert.equal(d.ventas, 0);
  assert.equal(d.neto, 0);
});

test("mes vacio: todas las filas en cero y sin NaN", () => {
  const vacio = construir([], [], "2026-07-01", "2026-07-31");
  const filas = vacio.lineas.filter((l) => l.tipo === "dia");
  const total = vacio.lineas[vacio.lineas.length - 1];
  assert.equal(filas.length, 29);   // julio 2026: 1/7 miercoles, 31/7 viernes
  filas.forEach((f) => {
    assert.equal(f.neto, 0);
    assert.ok(Number.isFinite(f.neto));
  });
  assert.equal(total.neto, 0);
  assert.ok(Number.isFinite(total.ventas));
});

test("la fila del lapicito coincide con la de la tabla", () => {
  const d = dia(ventas, gastos, "2026-10-02");
  const enTabla = buscarDia("2026-10-02");
  ["ventas", "gastos", "impuestos", "sueldos", "proveedores", "ingresos", "egresos", "neto"].forEach((k) => {
    assert.equal(d[k], enTabla[k], k);
  });
});

test("reconoce el mes completo y no un rango parcial", () => {
  assert.equal(esRangoMesCompleto("2026-10-01", "2026-10-31"), true);
  assert.equal(esRangoMesCompleto("2026-02-01", "2026-02-28"), true);
  assert.equal(esRangoMesCompleto("2026-10-01", "2026-10-15"), false);
});
