/* Balance diario / semanal / mensual. Replica la hoja BALANCE del Excel:
 *   Fecha | Dia | Ventas | Gastos | Impuestos | Sueldos | Proveedores |
 *   Total Ingresos | Total Egresos | Resultado Neto
 *
 * Reglas (las mismas que usa el Excel de la familia):
 *   - Una venta o un gasto anulado NO cuenta.
 *   - Cada gasto cae en Impuestos / Sueldos / Proveedores segun su
 *     categoria; cualquier otra categoria va a la columna "Gastos".
 *   - Ingresos = ventas.
 *   - Egresos  = gastos + impuestos + sueldos + proveedores.
 *   - Neto     = ingresos - egresos.
 *   - Vista de mes completo: fila por cada dia de lunes a sabado (aunque no
 *     haya movimientos, para que se pueda editar), y "Total Semanal" al
 *     cerrar cada semana. Un domingo solo aparece si tuvo movimientos.
 *
 * Es puro: recibe las listas y el rango, no toca el DOM ni Firestore.
 * Se prueba en tests/balance.test.mjs.
 */
(function (root) {
  "use strict";

  var DIAS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  /* Lunes de la semana a la que pertenece una fecha ISO. */
  function lunesISO(f) {
    var p = f.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    var dia = d.getDay();
    d.setDate(d.getDate() + (dia === 0 ? -6 : 1 - dia));
    var m = d.getMonth() + 1;
    return d.getFullYear() + "-" + pad2(m) + "-" + pad2(d.getDate());
  }

  function diaBonito(f) {
    var p = f.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return DIAS_ES[d.getDay()] + " " + Number(p[2]) + "/" + Number(p[1]);
  }

  /* Un registro sin fecha ISO o sin monto numerico no se puede ubicar en
   * ningun dia: si entrara igual, sumaria al total sin aparecer en ninguna
   * fila y el mes no cerraria con la suma de los dias. */
  function montoValido(m) {
    var n = typeof m === "number" ? m : Number(m);
    return isFinite(n) ? n : null;
  }

  function fechaValida(f) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(f || ""));
  }

  /* Recolecta ventas y gastos no anulados del rango, separando los gastos
   * en las columnas que usa el Excel. */
  function recolectarMovimientos(ventas, gastos, desde, hasta) {
    var fechas = new Set();
    var ventasPorFecha = {};
    var gastosPorFecha = {};
    var tot = { ventas: 0, gastos: 0, impuestos: 0, sueldos: 0, proveedores: 0 };

    (ventas || []).forEach(function (v) {
      if (!v || v.anulada) return;
      if (!fechaValida(v.fecha)) return;
      if (v.fecha < desde || v.fecha > hasta) return;
      var monto = montoValido(v.monto);
      if (monto === null) return;
      ventasPorFecha[v.fecha] = (ventasPorFecha[v.fecha] || 0) + monto;
      tot.ventas += monto;
      fechas.add(v.fecha);
    });

    (gastos || []).forEach(function (g) {
      if (!g || g.anulada) return;
      if (!fechaValida(g.fecha)) return;
      if (g.fecha < desde || g.fecha > hasta) return;
      var montoG = montoValido(g.monto);
      if (montoG === null) return;
      if (!gastosPorFecha[g.fecha]) {
        gastosPorFecha[g.fecha] = { gastos: 0, impuestos: 0, sueldos: 0, proveedores: 0 };
      }
      var clave = g.categoria === "Impuestos" ? "impuestos"
        : g.categoria === "Sueldos" ? "sueldos"
        : g.categoria === "Proveedores" ? "proveedores"
        : "gastos";
      gastosPorFecha[g.fecha][clave] += montoG;
      tot[clave] += montoG;
      fechas.add(g.fecha);
    });

    tot.egresos = tot.gastos + tot.impuestos + tot.sueldos + tot.proveedores;

    return {
      fechas: Array.from(fechas).sort(),
      ventasPorFecha: ventasPorFecha,
      gastosPorFecha: gastosPorFecha,
      tot: tot,
    };
  }

  /* Una fila de datos de un dia con las columnas del Excel. */
  function filaDiaBalance(f, mov) {
    var v = (mov.ventasPorFecha[f] || 0);
    var c = mov.gastosPorFecha[f] || { gastos: 0, impuestos: 0, sueldos: 0, proveedores: 0 };
    var egresos = c.gastos + c.impuestos + c.sueldos + c.proveedores;
    var p = f.split("-");
    return {
      tipo: "dia",
      fecha: f,
      etiqueta: DIAS_ES[new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay()],
      ventas: v,
      gastos: c.gastos,
      impuestos: c.impuestos,
      sueldos: c.sueldos,
      proveedores: c.proveedores,
      ingresos: v,
      egresos: egresos,
      neto: v - egresos,
    };
  }

  function sumarFilaEn(acc, fila) {
    acc.ventas += fila.ventas;
    acc.gastos += fila.gastos;
    acc.impuestos += fila.impuestos;
    acc.sueldos += fila.sueldos;
    acc.proveedores += fila.proveedores;
    acc.ingresos += fila.ingresos;
    acc.egresos += fila.egresos;
    acc.neto += fila.neto;
  }

  function filaSubtotal(tipo, etiqueta, acc) {
    return {
      tipo: tipo,
      etiqueta: etiqueta,
      ventas: acc.ventas,
      gastos: acc.gastos,
      impuestos: acc.impuestos,
      sueldos: acc.sueldos,
      proveedores: acc.proveedores,
      ingresos: acc.ingresos,
      egresos: acc.egresos,
      neto: acc.neto,
    };
  }

  function registrosVacios() {
    return { ventas: 0, gastos: 0, impuestos: 0, sueldos: 0, proveedores: 0, ingresos: 0, egresos: 0, neto: 0 };
  }

  function esRangoMesCompleto(desde, hasta) {
    var p = desde.split("-");
    var y = Number(p[0]);
    var m = Number(p[1]);
    var primero = y + "-" + pad2(m) + "-01";
    var ultimoDia = new Date(y, m, 0).getDate();
    return desde === primero && hasta === y + "-" + pad2(m) + "-" + pad2(ultimoDia);
  }

  function construirBalance(ventas, gastos, desde, hasta) {
    var mov = recolectarMovimientos(ventas, gastos, desde, hasta);
    var mesCompleto = esRangoMesCompleto(desde, hasta);
    var lineas = [];
    var accTotal = registrosVacios();

    if (mesCompleto) {
      var p = desde.split("-");
      var y = Number(p[0]);
      var m = Number(p[1]);
      var fin = new Date(y, m - 1, Number(hasta.split("-")[2]));
      /* Arranca el lunes de la semana que contiene el dia 1, como el Excel */
      var actual = new Date(y, m - 1, 1);
      actual.setDate(actual.getDate() + (actual.getDay() === 0 ? -6 : 1 - actual.getDay()));
      var acc = registrosVacios();
      var abiertaSemana = false;

      while (actual <= fin) {
        var dow = actual.getDay();
        var f = actual.getFullYear() + "-" + pad2(actual.getMonth() + 1) + "-" + pad2(actual.getDate());
        var movDia = mov.ventasPorFecha[f] !== undefined || mov.gastosPorFecha[f] !== undefined;
        if (dow !== 0 || movDia) {
          var fila = filaDiaBalance(f, mov);
          lineas.push(fila);
          sumarFilaEn(acc, fila);
          sumarFilaEn(accTotal, fila);
          abiertaSemana = true;
        }
        /* El bloque cierra al llegar al sabado o al terminar el mes */
        if (abiertaSemana && (actual.getDay() === 6 || f === hasta)) {
          lineas.push(filaSubtotal("semana", "Total Semanal", acc));
          acc = registrosVacios();
          abiertaSemana = false;
        }
        actual.setDate(actual.getDate() + 1);
      }
      lineas.push(filaSubtotal("mes", "Total Mensual", accTotal));
    } else {
      var accR = registrosVacios();
      var anterior = null;
      var desdeP = desde.split("-");
      var hastaP = hasta.split("-");
      var d = new Date(Number(desdeP[0]), Number(desdeP[1]) - 1, Number(desdeP[2]));
      var finR = new Date(Number(hastaP[0]), Number(hastaP[1]) - 1, Number(hastaP[2]));
      while (d <= finR) {
        var fR = d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
        var filaR = filaDiaBalance(fR, mov);
        if (anterior !== null && lunesISO(fR) !== lunesISO(anterior)) {
          lineas.push(filaSubtotal("semana", "Semana del " + diaBonito(lunesISO(anterior)) + " al " + diaBonito(anterior), accR));
          accR = registrosVacios();
        }
        lineas.push(filaR);
        sumarFilaEn(accR, filaR);
        sumarFilaEn(accTotal, filaR);
        anterior = fR;
        d.setDate(d.getDate() + 1);
      }
      if (anterior !== null) {
        lineas.push(filaSubtotal("semana", "Semana del " + diaBonito(lunesISO(anterior)) + " al " + diaBonito(anterior), accR));
      }
      if (lineas.length) {
        lineas.push(filaSubtotal("total", "Total del período", accTotal));
      }
    }

    return { lineas: lineas, mesCompleto: mesCompleto, bloques: bloquesDeLineas(lineas) };
  }

  /* Divide las lineas en bloques por semana: filas de dias hasta cada
   * Total Semanal. Los totales no pertenecen a ningun bloque. */
  function bloquesDeLineas(lineas) {
    var bloques = [];
    var actual = null;
    lineas.forEach(function (l) {
      if (l.tipo === "dia") {
        if (!actual) {
          actual = [];
          bloques.push(actual);
        }
        actual.push(l);
      } else if (l.tipo === "semana" && actual) {
        actual.push(l);
        actual = null;
      }
    });
    return bloques;
  }

  /* Una sola fila de dia (la usa el lapicito del balance). */
  function filaDelDia(ventas, gastos, fecha) {
    var mov = recolectarMovimientos(ventas, gastos, fecha, fecha);
    return filaDiaBalance(fecha, mov);
  }

  root.TV_BALANCE = {
    construir: construirBalance,
    dia: filaDelDia,
    bloques: bloquesDeLineas,
    esRangoMesCompleto: esRangoMesCompleto,
    DIAS_ES: DIAS_ES,
  };
})(typeof window !== "undefined" ? window : this);
