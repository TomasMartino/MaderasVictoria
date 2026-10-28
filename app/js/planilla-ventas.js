/* Comparacion entre la hoja VENTAS DIARIAS del .xlsx que suben y las
 * ventas de la app. Puro: no toca el DOM ni guarda nada. Depende de
 * TV (parseNumero) y TV_PRODUCTOS (sinAcentos, limpiarNombre, clave). */
(function (root) {
  "use strict";
  var TV = root.TV;
  var PRODUCTOS = root.TV_PRODUCTOS;

  function numeroDe(v) {
    if (typeof v === "number") return v;
    if (v === null || v === undefined) return null;
    var s = String(v).trim();
    if (!s || s === "\u2014") return null;
    var n = TV.parseNumero(s);
    return typeof n === "number" ? n : null;
  }

  /* Serial de Excel (dias desde 1899-12-30) a ISO "YYYY-MM-DD". */
  function serialAFecha(serial) {
    if (typeof serial !== "number") return null;
    var ms = (Math.floor(serial) - 25569) * 86400000;
    var d = new Date(ms);
    var y = d.getUTCFullYear();
    var m = d.getUTCMonth() + 1;
    var day = d.getUTCDate();
    return y + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  function mapearColumnas(fila) {
    var mapa = {};
    (fila || []).forEach(function (c, i) {
      var t = PRODUCTOS.sinAcentos(String(c === null ? "" : c).toLowerCase()).trim();
      if (t.indexOf("fecha") !== -1) mapa.fecha = i;
      else if (t.indexOf("tipo") !== -1 || t.indexOf("medio") !== -1 || t.indexOf("pago") !== -1) mapa.medioPago = i;
      else if (t.indexOf("detalle") !== -1 || t.indexOf("concepto") !== -1) mapa.detalle = i;
      else if (t === "monto" || t.indexOf("total") !== -1) mapa.monto = i;
    });
    return mapa;
  }

  function medioPagoDe(t) {
    var s = PRODUCTOS.sinAcentos(String(t === null ? "" : t).trim().toLowerCase());
    if (s.indexOf("efectivo") !== -1) return "Efectivo";
    if (s.indexOf("transferencia") !== -1) return "Transferencia";
    if (s.indexOf("debito") !== -1 || s.indexOf("d\u00e9bito") !== -1) return "Debito";
    if (s.indexOf("credito") !== -1 || s.indexOf("cr\u00e9dito") !== -1) return "Credito";
    return String(t === null ? "" : t).trim() || "Efectivo";
  }

  function textoValor(v, campo, formatear) {
    if (campo === "monto") return (formatear || String)(v);
    return String(v === null || v === undefined ? "\u2014" : v);
  }

  /* Devuelve propuestas: "nuevo" (venta que no esta en la app) o "campo"
   * (monto distinto para la misma fecha + detalle). Solo propone, no
   * muta nada. */
  function revisar(filas, ventasExistentes, formatear) {
    filas = filas || [];
    var mapa = null;
    var desde = 0;
    var i;
    var j;
    for (i = 0; i < filas.length; i++) {
      mapa = mapearColumnas(filas[i]);
      if (mapa.fecha !== undefined && mapa.detalle !== undefined && mapa.monto !== undefined) {
        desde = i + 1;
        break;
      }
    }
    var sinEncabezado = !(mapa && mapa.fecha !== undefined && mapa.detalle !== undefined && mapa.monto !== undefined);

    var candidatos = [];
    if (mapa) {
      for (j = desde; j < filas.length; j++) {
        var fila = filas[j];
        if (!fila) continue;
        var fecha = serialAFecha(fila[mapa.fecha]);
        var detalle = fila[mapa.detalle];
        detalle = detalle === null || detalle === undefined ? "" : String(detalle).trim();
        if (!fecha || !detalle) continue;
        var monto = numeroDe(fila[mapa.monto]);
        if (monto === null) continue;
        var medio = mapa.medioPago !== undefined ? medioPagoDe(fila[mapa.medioPago]) : "Efectivo";
        candidatos.push({ fecha: fecha, detalle: detalle, monto: monto, medioPago: medio });
      }
    }

    var cambios = [];
    var vistos = {};
    var ignoradas = [];
    candidatos.forEach(function (c) {
      var clave = c.fecha + "|" + PRODUCTOS.clave(c.detalle);
      if (vistos[clave]) return;
      vistos[clave] = true;

      var actual = null;
      for (var k = 0; k < (ventasExistentes || []).length; k++) {
        var v = ventasExistentes[k];
        if (v.fecha === c.fecha && PRODUCTOS.clave(v.detalle || "") === PRODUCTOS.clave(c.detalle)) {
          actual = v;
          break;
        }
      }

      if (!actual) {
        cambios.push({
          tipo: "nuevo",
          nombre: c.detalle,
          campo: "Venta nueva",
          de: "\u2014",
          a: c.fecha + " · " + c.medioPago + " · " + textoValor(c.monto, "monto", formatear),
          venta: c,
          estado: "",
        });
        return;
      }

      if (c.monto !== actual.monto) {
        cambios.push({
          tipo: "campo",
          campo: "monto",
          nombre: c.detalle,
          de: textoValor(actual.monto, "monto", formatear),
          a: textoValor(c.monto, "monto", formatear),
          valores: { de: actual.monto, a: c.monto },
          fecha: c.fecha,
          detalle: c.detalle,
          estado: "",
        });
      }
    });

    return { cambios: cambios, ignoradas: ignoradas, sinEncabezado: sinEncabezado };
  }

  /* Ventas repetidas: misma fecha, mismo detalle, mismo monto y mismo medio.
   * Devuelve solo los grupos con mas de una, con la primera como la que se
   * queda. Sirve para reparar importaciones repetidas. */
  function duplicadas(lista) {
    var grupos = {};
    var orden = [];
    (lista || []).forEach(function (v) {
      if (!v || v.anulada) return;
      var detalle = PRODUCTOS.clave(v.detalle || "");
      /* El total del día que crea la importación del balance ("Ventas
       * <fecha>") tiene que existir UNA sola vez por fecha, aunque el monto
       * haya quedado distinto en cada intento. */
      var esTotalDelDia = detalle === PRODUCTOS.clave("Ventas " + v.fecha);
      var montoClave = esTotalDelDia
        ? "*"
        : typeof v.monto === "number" ? v.monto : Number(v.monto) || 0;
      var clave = [
        v.fecha,
        detalle,
        montoClave,
        PRODUCTOS.sinAcentos(String(v.medioPago || "").toLowerCase()),
      ].join("|");
      if (!grupos[clave]) {
        grupos[clave] = [];
        orden.push(clave);
      }
      grupos[clave].push(v);
    });
    return orden
      .filter(function (k) { return grupos[k].length > 1; })
      .map(function (k) { return { clave: k, ventas: grupos[k] }; });
  }

  /* Mismo criterio para gastos: la importación del balance crea un gasto
   * por categoría y día ("Otros 2026-10-27"), que debe existir una sola vez. */
  function duplicadasGastos(lista) {
    var grupos = {};
    var orden = [];
    (lista || []).forEach(function (g) {
      if (!g || g.anulada) return;
      var concepto = PRODUCTOS.clave(g.concepto || "");
      var categoria = PRODUCTOS.sinAcentos(String(g.categoria || "").toLowerCase());
      var esTotalDelDia = concepto === PRODUCTOS.clave(String(g.categoria || "") + " " + g.fecha);
      var montoClave = esTotalDelDia
        ? "*"
        : typeof g.monto === "number" ? g.monto : Number(g.monto) || 0;
      var clave = [g.fecha, categoria, concepto, montoClave].join("|");
      if (!grupos[clave]) {
        grupos[clave] = [];
        orden.push(clave);
      }
      grupos[clave].push(g);
    });
    return orden
      .filter(function (k) { return grupos[k].length > 1; })
      .map(function (k) { return { clave: k, gastos: grupos[k] }; });
  }

  root.TV_PLANILLA_VENTAS = { revisar: revisar, duplicadas: duplicadas, duplicadasGastos: duplicadasGastos };
})(typeof window !== "undefined" ? window : globalThis);
