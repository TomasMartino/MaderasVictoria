/* Contrato de las notas de pedido (app/js/notas.js): estados, faltante y
 * nombre de la venta asociada. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

vm.runInThisContext(
  readFileSync(new URL("../app/js/notas.js", import.meta.url), "utf8"),
  { filename: "notas.js" },
);

const N = globalThis.TV_NOTAS;

test("los estados se muestran en castellano", () => {
  assert.equal(N.estadoTexto("pendiente"), "Pendiente");
  assert.equal(N.estadoTexto("senado"), "Señado");
  assert.equal(N.estadoTexto("pagado"), "Pagado");
  assert.equal(N.estadoTexto("baja"), "Dado de baja");
});

test("un estado desconocido cae en pendiente", () => {
  assert.equal(N.estadoTexto(""), "Pendiente");
  assert.equal(N.estadoTexto(null), "Pendiente");
});

test("el faltante es el total menos la seña", () => {
  assert.equal(N.restante({ total: 1000000, sena: 400000 }), 600000);
});

test("el faltante nunca es negativo", () => {
  assert.equal(N.restante({ total: 100000, sena: 150000 }), 0);
});

test("sin seña, el faltante es el total", () => {
  assert.equal(N.restante({ total: 50000, sena: 0 }), 50000);
  assert.equal(N.restante({ total: 50000 }), 50000);
});

test("el faltante tolera montos en texto", () => {
  assert.equal(N.restante({ total: "1.000.000", sena: "400000" }), 0);
  assert.equal(N.restante({ total: 1000, sena: "0" }), 1000);
});

test("la venta señalizada se llama con el cliente y (señalizado)", () => {
  assert.equal(N.etiquetaVenta({ cliente: "Juan Gomez" }, false), "Juan Gomez (señalizado)");
});

test("al cobrar el total la misma venta pasa a (finalizada)", () => {
  assert.equal(N.etiquetaVenta({ cliente: "Juan Gomez" }, true), "Juan Gomez (finalizada)");
});

test("sin nombre de cliente usa el numero de la nota", () => {
  assert.equal(N.etiquetaVenta({ cliente: "  ", numero: 23890 }, true), "Nota de pedido N° 23890 (finalizada)");
  assert.equal(N.etiquetaVenta({ numero: null }, false), "Nota de pedido sin número (señalizado)");
});

test("una nota pagada o dada de baja esta cerrada", () => {
  assert.equal(N.cerrada({ estado: "pagado" }), true);
  assert.equal(N.cerrada({ estado: "baja" }), true);
  assert.equal(N.cerrada({ estado: "senado" }), false);
  assert.equal(N.cerrada({ estado: "pendiente" }), false);
});

test("el resumen separa estados y suma por cobrar y cobrado", () => {
  const r = N.resumen([
    { estado: "pendiente", total: 100000, sena: 0 },
    { estado: "senado", total: 500000, sena: 200000 },
    { estado: "pagado", total: 300000, sena: 300000 },
    { estado: "baja", total: 90000, sena: 0 },
  ]);
  assert.equal(r.total, 4);
  assert.equal(r.pendientes, 1);
  assert.equal(r.senadas, 1);
  assert.equal(r.pagadas, 1);
  assert.equal(r.bajas, 1);
  assert.equal(r.porCobrar, 100000 + 300000);
  assert.equal(r.cobrado, 200000 + 300000);
});

test("el resumen de una lista vacia da todo en cero", () => {
  const r = N.resumen([]);
  assert.deepEqual(
    { total: r.total, pendientes: r.pendientes, cobrado: r.cobrado, porCobrar: r.porCobrar },
    { total: 0, pendientes: 0, cobrado: 0, porCobrar: 0 },
  );
});
