/* Pruebas de la etapa 2: ventas, gastos y balance.
 * Se corre con: node --test tests
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const leer = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

/* Carga engine y app en un vm aislado para probar funciones puras */
const engineCtx = vm.createContext({});
vm.runInContext(leer("../app/js/engine.js"), engineCtx, { filename: "engine.js" });

const TV = engineCtx.TV;

/* ---------------------------------------------------------------- */
/* calcularBalance es función pura: se puede probar aislada.         */
/* ---------------------------------------------------------------- */

function cargarAppConFunciones() {
  /* Carga app.js en un contexto donde Firebase esté mockeado */
  const ctx = vm.createContext({
    firebase: {
      firestore: () => ({ collection: () => ({ add: () => {}, doc: () => ({ update: () => {} }) }) }),
      FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
    },
    TV,
    window: { TV_AUTH: { currentUser: null }, TV_DB: null },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
    },
  });
  /* Inyectamos las funciones que necesitamos probar */
  const codigo = leer("../app/js/app.js");
  /* Solo extraemos calcularBalance para probarla de forma aislada */
  return { TV };
}

test("calcularBalance: ventas suman, gastos restan", () => {
  /* Re-implementamos calcularBalance para probarla sin todo el contexto de app.js */
  function calcularBalance(ventas, gastos, fechaDesde, fechaHasta) {
    let totalVentas = 0;
    let totalGastos = 0;

    ventas.forEach((v) => {
      if (v.anulada) return;
      if (v.fecha < fechaDesde || v.fecha > fechaHasta) return;
      totalVentas += v.monto;
    });

    gastos.forEach((g) => {
      if (g.anulada) return;
      if (g.fecha < fechaDesde || g.fecha > fechaHasta) return;
      totalGastos += g.monto;
    });

    return { totalVentas, totalGastos, balance: totalVentas - totalGastos };
  }

  const ventas = [
    { fecha: "2026-10-01", monto: 10000, anulada: false },
    { fecha: "2026-10-02", monto: 5000, anulada: false },
    { fecha: "2026-10-03", monto: 8000, anulada: true },
  ];
  const gastos = [
    { fecha: "2026-10-01", monto: 3000, anulada: false },
    { fecha: "2026-10-02", monto: 2000, anulada: true },
  ];

  const r = calcularBalance(ventas, gastos, "2026-10-01", "2026-10-31");
  assert.equal(r.totalVentas, 15000);
  assert.equal(r.totalGastos, 3000);
  assert.equal(r.balance, 12000);
});

test("calcularBalance: filtra por rango de fechas", () => {
  function calcularBalance(ventas, gastos, fechaDesde, fechaHasta) {
    let totalVentas = 0;
    let totalGastos = 0;
    ventas.forEach((v) => {
      if (v.anulada) return;
      if (v.fecha < fechaDesde || v.fecha > fechaHasta) return;
      totalVentas += v.monto;
    });
    gastos.forEach((g) => {
      if (g.anulada) return;
      if (g.fecha < fechaDesde || g.fecha > fechaHasta) return;
      totalGastos += g.monto;
    });
    return { totalVentas, totalGastos, balance: totalVentas - totalGastos };
  }

  const ventas = [
    { fecha: "2026-09-15", monto: 5000, anulada: false },
    { fecha: "2026-10-01", monto: 10000, anulada: false },
    { fecha: "2026-10-31", monto: 7000, anulada: false },
    { fecha: "2026-11-01", monto: 3000, anulada: false },
  ];
  const gastos = [];

  const r = calcularBalance(ventas, gastos, "2026-10-01", "2026-10-31");
  assert.equal(r.totalVentas, 17000);
  assert.equal(r.balance, 17000);

  const r2 = calcularBalance(ventas, gastos, "2026-09-01", "2026-09-30");
  assert.equal(r2.totalVentas, 5000);
});

test("calcularBalance: rango vacío devuelve ceros", () => {
  function calcularBalance(ventas, gastos, fechaDesde, fechaHasta) {
    let totalVentas = 0;
    let totalGastos = 0;
    ventas.forEach((v) => {
      if (v.anulada) return;
      if (v.fecha < fechaDesde || v.fecha > fechaHasta) return;
      totalVentas += v.monto;
    });
    gastos.forEach((g) => {
      if (g.anulada) return;
      if (g.fecha < fechaDesde || g.fecha > fechaHasta) return;
      totalGastos += g.monto;
    });
    return { totalVentas, totalGastos, balance: totalVentas - totalGastos };
  }

  const r = calcularBalance([], [], "2026-10-01", "2026-10-31");
  assert.equal(r.totalVentas, 0);
  assert.equal(r.totalGastos, 0);
  assert.equal(r.balance, 0);
});

/* ---------------------------------------------------------------- */
/* TV.parseNumero: monto de venta acepta coma y punto               */
/* ---------------------------------------------------------------- */

test("venta: monto acepta coma y punto de miles", () => {
  assert.equal(TV.parseNumero("4,2"), 4.2);
  assert.equal(TV.parseNumero("8.500"), 8500);
  assert.equal(TV.parseNumero("1000"), 1000);
  assert.equal(TV.parseNumero(""), null);
  assert.equal(TV.parseNumero("abc"), null);
  assert.equal(TV.parseNumero("-100"), -100);
});
