/* Comparacion entre la hoja BALANCE del .xlsx que suben y el balance
 * que calcula la app para cada dia. Puro: no toca el DOM ni guarda nada.
 * Depende de TV (parseNumero) y TV_PRODUCTOS (sinAcentos). */
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
      if (t.indexOf("d\u00eda") !== -1 || t === "dia") mapa.fecha = i;
      else if (t === "ventas" || t === "venta" || t.indexOf("total ventas") !== -1 || t.indexOf("ingresos") !== -1) mapa.ventas = i;
      else if (t === "gastos") mapa.gastos = i;
      else if (t.indexOf("impuesto") !== -1) mapa.impuestos = i;
      else if (t.indexOf("sueldo") !== -1) mapa.sueldos = i;
      else if (t.indexOf("proveedor") !== -1) mapa.proveedores = i;
      else if (t.indexOf("total ingresos") !== -1) mapa.totalIngresos = i;
      else if (t.indexOf("total egresos") !== -1) mapa.totalEgresos = i;
      else if (t.indexOf("resultado neto") !== -1) mapa.resultadoNeto = i;
    });
    return mapa;
  }

  /* Calcula el balance de un dia concreto a partir de las ventas y
   * gastos de la app (misma logica que calcularBalance pero por dia). */
  function balanceDelDia(fecha, ventas, gastos) {
    var tv = 0;
    var tg = 0;
    var imp = 0;
    var sue = 0;
    var prov = 0;
    var i;
    var j;
    var v;
    var g;
    var cat;
    var m;
    for (i = 0; i < (ventas || []).length; i++) {
      v = ventas[i];
      if (!v.anulada && v.fecha === fecha) {
        m = typeof v.monto === "number" ? v.monto : 0;
        tv += m;
      }
    }
    for (j = 0; j < (gastos || []).length; j++) {
      g = gastos[j];
      if (!g.anulada && g.fecha === fecha) {
        m = typeof g.monto === "number" ? g.monto : 0;
        tg += m;
        cat = PRODUCTOS.sinAcentos(String(g.categoria || "").toLowerCase()).trim();
        if (cat.indexOf("impuesto") !== -1) imp += m;
        else if (cat.indexOf("sueldo") !== -1) sue += m;
        else if (cat.indexOf("proveedor") !== -1) prov += m;
      }
    }
    return { ventas: tv, gastos: tg, impuestos: imp, sueldos: sue, proveedores: prov };
  }

  function textoValor(v, campo, formatear) {
    if (v === null || v === undefined) return "\u2014";
    if (typeof v === "number") return (formatear || String)(v);
    return String(v);
  }

  /* Devuelve propuestas de campo por cada diferencia entre el Excel y
   * lo que calcula la app para ese dia. Solo propone, no muta nada. */
  function revisar(filas, ventas, gastos, formatear) {
    filas = filas || [];
    var mapa = null;
    var desde = 0;
    var i;
    var j;
    for (i = 0; i < filas.length; i++) {
      mapa = mapearColumnas(filas[i]);
      if (mapa.fecha !== undefined && mapa.ventas !== undefined) {
        desde = i + 1;
        break;
      }
    }
    var sinEncabezado = !(mapa && mapa.fecha !== undefined && mapa.ventas !== undefined);

    /* Auto-detectar la columna de fecha: algunas planillas (BALANCE de este
     * Excel) ponen el encabezado "Día" en una columna que en los datos trae
     * texto ("Jueves", "Viernes"), mientras el serial de Excel (numero) esta
     * en la columna anterior sin encabezado. Si la columna mapeada no trae
     * numeros, buscamos la primera que sí los tenga. */
    if (mapa && mapa.fecha !== undefined) {
      var pareceNumerica = false;
      var probeHasta = Math.min(desde + 8, filas.length);
      for (var z = desde; z < probeHasta; z++) {
        if (typeof filas[z][mapa.fecha] === "number") { pareceNumerica = true; break; }
      }
      if (!pareceNumerica) {
        for (var c = 0; c < filas[desde].length; c++) {
          var hayNumero = false;
          for (var z = desde; z < probeHasta; z++) {
            if (typeof filas[z][c] === "number") { hayNumero = true; break; }
          }
          if (hayNumero &&
              c !== mapa.ventas && c !== mapa.gastos &&
              c !== mapa.impuestos && c !== mapa.sueldos &&
              c !== mapa.proveedores && c !== mapa.totalIngresos &&
              c !== mapa.totalEgresos && c !== mapa.resultadoNeto) {
            mapa = Object.assign({}, mapa, { fecha: c });
            break;
          }
        }
      }
    }

    var cambios = [];
    var vistos = {};
    var fila;
    var fecha;
    var clave;
    var real;
    var c;
    var excelVal;
    var campos;
    var k;
    if (mapa) {
      for (j = desde; j < filas.length; j++) {
        fila = filas[j];
        if (!fila) continue;
        fecha = serialAFecha(fila[mapa.fecha]);
        if (!fecha) continue;
        clave = fecha;
        if (vistos[clave]) continue;
        vistos[clave] = true;

        real = balanceDelDia(fecha, ventas, gastos);
        campos = [
          { key: "ventas", excel: mapa.ventas, label: "Ventas", val: real.ventas },
          { key: "gastos", excel: mapa.gastos, label: "Gastos", val: real.gastos },
          { key: "impuestos", excel: mapa.impuestos, label: "Impuestos", val: real.impuestos },
          { key: "sueldos", excel: mapa.sueldos, label: "Sueldos", val: real.sueldos },
          { key: "proveedores", excel: mapa.proveedores, label: "Proveedores", val: real.proveedores },
        ];
        for (k = 0; k < campos.length; k++) {
          c = campos[k];
          if (c.excel === undefined) continue;
          excelVal = numeroDe(fila[c.excel]);
          if (excelVal === null) continue;
          if (excelVal !== c.val) {
            cambios.push({
              tipo: "campo",
              campo: c.key,
              nombre: fecha + " · " + c.label,
              de: textoValor(c.val, c.key, formatear),
              a: textoValor(excelVal, c.key, formatear),
              valores: { de: c.val, a: excelVal },
              fecha: fecha,
              etiqueta: c.label,
              estado: "",
            });
          }
        }
      }
    }

    return { cambios: cambios, ignoradas: [], sinEncabezado: sinEncabezado };
  }

  root.TV_PLANILLA_BALANCE = { revisar: revisar };
})(typeof window !== "undefined" ? window : globalThis);
