/* Reglas de las notas de pedido: estados, faltante y como se llama la venta
 * que queda asociada. Puro: no toca el DOM ni guarda nada.
 * Lo usa app.js y lo cubren tests/notas.test.mjs. */
(function (root) {
  "use strict";

  function numero(v) {
    var n = typeof v === "number" ? v : Number(v);
    return isFinite(n) ? n : 0;
  }

  function redondear(n) {
    return Math.round(numero(n) * 100) / 100;
  }

  function estadoTexto(e) {
    if (e === "senado") return "Se\u00f1ado";
    if (e === "pagado") return "Pagado";
    if (e === "baja") return "Dado de baja";
    return "Pendiente";
  }

  function nombreCliente(nota) {
    var c = String((nota && nota.cliente) || "").trim();
    if (c) return c;
    var n = nota && nota.numero;
    return n ? "Nota de pedido N\u00b0 " + n : "Nota de pedido sin n\u00famero";
  }

  /* Lo que falta cobrar: nunca negativo. */
  function restante(nota) {
    var r = redondear(numero(nota && nota.total) - numero(nota && nota.sena));
    return r > 0 ? r : 0;
  }

  /* Detalle de la venta diaria asociada. */
  function etiquetaVenta(nota, finalizada) {
    return nombreCliente(nota) + (finalizada ? " (finalizada)" : " (se\u00f1alizado)");
  }

  function cerrada(nota) {
    return !!nota && (nota.estado === "pagado" || nota.estado === "baja");
  }

  /* Totales para el encabezado de la seccion. */
  function resumen(lista) {
    var r = {
      total: 0,
      pendientes: 0,
      senadas: 0,
      pagadas: 0,
      bajas: 0,
      porCobrar: 0,
      cobrado: 0,
    };
    (lista || []).forEach(function (n) {
      r.total++;
      if (n.estado === "pagado") {
        r.pagadas++;
        r.cobrado = redondear(r.cobrado + numero(n.total));
      } else if (n.estado === "baja") {
        r.bajas++;
      } else if (n.estado === "senado") {
        r.senadas++;
        r.cobrado = redondear(r.cobrado + numero(n.sena));
        r.porCobrar = redondear(r.porCobrar + restante(n));
      } else {
        r.pendientes++;
        r.porCobrar = redondear(r.porCobrar + restante(n));
      }
    });
    return r;
  }

  root.TV_NOTAS = {
    estadoTexto: estadoTexto,
    nombreCliente: nombreCliente,
    restante: restante,
    etiquetaVenta: etiquetaVenta,
    cerrada: cerrada,
    resumen: resumen,
  };
})(typeof window !== "undefined" ? window : globalThis);
