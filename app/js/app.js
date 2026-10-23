/* Pantalla del presupuesto y de productos.
 * Script clasico: abre con doble clic, sin servidor y sin compilar.
 * Toda la cuenta vive en engine.js; la forma valida de un producto en
 * productos.js; aca solo se dibuja, se guarda y se conecta.
 */
(function () {
  "use strict";

  var CAT = window.TV_CATALOGO;
  var TV = window.TV;
  var PRODUCTOS = window.TV_PRODUCTOS;

  var PASO = CAT.paso;
  var CLAVE = "tiovity.presupuesto.v1";
  var CLAVE_PRODUCTOS = "tiovity.productos.v1";

  /* ---------- Firebase (opcional) ---------- */
  var auth = window.TV_AUTH;
  var db = window.TV_DB;
  var usaFirebase = !!(auth && db);
  var usuarioActual = null;
  var ignorandoFirestore = false;
  var escuchandoVentasGastos = false;
  var escuchandoPresupuesto = false;
  var suscripcionPresupuesto = null;
  var suscripcionVentas = null;
  var suscripcionGastos = null;
  var appIniciada = false;

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };

  var elLineas = $("#lineas");
  var elTotal = $("#total");
  var elTotalBar = $("#total-bar");
  var elAviso = $("#aviso");
  var elToast = $("#toast");
  var elEstado = $("#estado-texto");
  var elDot = $("#estado-dot");
  var elFecha = $("#fecha");

  /* catalogo vivo: arranca desde la planilla y se edita en la app */
  var catalogo = [];
  /* Toda la cuenta pasa por esta calculadora: ella sabe traducir el nombre
   * del producto que guarda la pantalla al producto del catalogo. */
  var CALC = null;

  var estado = {
    cliente: "",
    direccion: "",
    telefono: "",
    fecha: "",
    tipo: "PRESUPUESTO",
    lineas: [],
  };

  var ventas = [];
  var gastos = [];

  var proximoId = 1;
  var guardarTimer = null;

  /* ---------- catalogo: carga, fusión y guardado ---------- */

  function crearMotor() {
    CALC = TV.crearCalculadora({ paso: PASO, productos: catalogo });
  }

  function guardarCatalogo() {
    try {
      localStorage.setItem(CLAVE_PRODUCTOS, JSON.stringify({ version: 1, productos: catalogo }));
    } catch (e) {
      /* sin almacenamiento la app sigue funcionando, solo no recuerda */
    }
  }

  /* Devuelve los cambios que trajo la planilla, o null si no hubo nada. */
  function cargarCatalogo() {
    var previo = null;
    try {
      var crudo = localStorage.getItem(CLAVE_PRODUCTOS);
      if (crudo) {
        var d = JSON.parse(crudo);
        if (d && Array.isArray(d.productos)) previo = d.productos;
      }
    } catch (e) {
      previo = null;
    }

    var r = PRODUCTOS.fusionar(CAT.productos, previo);
    catalogo = r.productos;
    crearMotor();

    if (!previo) {
      guardarCatalogo();
      return null;
    }
    if (r.cambios.nuevos || r.cambios.actualizados) {
      guardarCatalogo();
      return r.cambios;
    }
    return null;
  }

  function reporteCambios(c) {
    var partes = [];
    if (c.nuevos) partes.push(c.nuevos + (c.nuevos === 1 ? " producto nuevo" : " productos nuevos"));
    if (c.actualizados) {
      partes.push(c.actualizados + (c.actualizados === 1 ? " precio actualizado" : " precios actualizados"));
    }
    if (c.respetados) partes.push(c.respetados + " respetados porque los editaste acá");
    if (!partes.length) return "La planilla no trajo cambios.";
    return "Planilla: " + partes.join(", ") + ". No se pisó nada de lo que editaste acá.";
  }

  function refrescarCatalogo() {
    crearMotor();
    refrescarSelects();
    recalcular();
    pintarProductos();
  }

  /* ---------- ventas y gastos (etapa 2) ---------- */

  /* Carga una venta en Firestore y en el estado local. */
  function guardarVenta(venta) {
    if (!usaFirebase || !usuarioActual) {
      /* modo local */
      ventas.push(venta);
      guardarVentasLocales();
      return;
    }
    try {
      db.collection("ventas").add({
        fecha: venta.fecha,
        monto: venta.monto,
        medioPago: venta.medioPago,
        detalle: venta.detalle,
        usuario: usuarioActual.email || usuarioActual.uid,
        uid: usuarioActual.uid,
        creadaEn: firebase.firestore.FieldValue.serverTimestamp(),
        anulada: false,
      }).catch(function (err) {
        /* Si la subida a la nube falla, al menos la venta queda visible acá */
        ventas.push(venta);
        guardarVentasLocales();
        pintarVentas();
        pintarBalance();
        avisar("La venta no se subió a la nube: quedó en este equipo");
      });
    } catch (e) {
      ventas.push(venta);
      guardarVentasLocales();
    }
  }

  /* Carga un gasto en Firestore y en el estado local. */
  function guardarGasto(gasto) {
    if (!usaFirebase || !usuarioActual) {
      gastos.push(gasto);
      guardarGastosLocales();
      return;
    }
    try {
      db.collection("gastos").add({
        fecha: gasto.fecha,
        monto: gasto.monto,
        concepto: gasto.concepto,
        categoria: gasto.categoria,
        usuario: usuarioActual.email || usuarioActual.uid,
        uid: usuarioActual.uid,
        creadaEn: firebase.firestore.FieldValue.serverTimestamp(),
        anulada: false,
      }).catch(function (err) {
        gastos.push(gasto);
        guardarGastosLocales();
        pintarGastos();
        pintarBalance();
        avisar("El gasto no se subió a la nube: quedó en este equipo");
      });
    } catch (e) {
      gastos.push(gasto);
      guardarGastosLocales();
    }
  }

  /* Anula una venta: la marca como anulada con motivo. No se borra. */
  function anularVenta(id, motivo) {
    if (!usaFirebase || !usuarioActual) {
      var v = ventas.find(function (x) { return x.id === id; });
      if (v) {
        v.anulada = true;
        v.motivoAnulacion = motivo;
        v.anuladaPor = usuarioActual ? (usuarioActual.email || usuarioActual.uid) : "local";
        v.anuladaEn = new Date().toISOString();
        guardarVentasLocales();
      }
      return;
    }
    try {
      db.collection("ventas").doc(id).update({
        anulada: true,
        motivoAnulacion: motivo,
        anuladaPor: usuarioActual.email || usuarioActual.uid,
        anuladaEn: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      var v = ventas.find(function (x) { return x.id === id; });
      if (v) {
        v.anulada = true;
        v.motivoAnulacion = motivo;
        v.anuladaPor = usuarioActual ? (usuarioActual.email || usuarioActual.uid) : "local";
        v.anuladaEn = new Date().toISOString();
        guardarVentasLocales();
      }
    }
  }

  /* Anula un gasto: lo marca como anulado con motivo. No se borra. */
  function anularGasto(id, motivo) {
    if (!usaFirebase || !usuarioActual) {
      var g = gastos.find(function (x) { return x.id === id; });
      if (g) {
        g.anulada = true;
        g.motivoAnulacion = motivo;
        g.anuladaPor = usuarioActual ? (usuarioActual.email || usuarioActual.uid) : "local";
        g.anuladaEn = new Date().toISOString();
        guardarGastosLocales();
      }
      return;
    }
    try {
      db.collection("gastos").doc(id).update({
        anulada: true,
        motivoAnulacion: motivo,
        anuladaPor: usuarioActual.email || usuarioActual.uid,
        anuladaEn: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      var g = gastos.find(function (x) { return x.id === id; });
      if (g) {
        g.anulada = true;
        g.motivoAnulacion = motivo;
        g.anuladaPor = usuarioActual ? (usuarioActual.email || usuarioActual.uid) : "local";
        g.anuladaEn = new Date().toISOString();
        guardarGastosLocales();
      }
    }
  }

  /* Borra TODAS las ventas y gastos activos (pide confirmación doble).
   * Es la única excepción a la regla de "no se borra": el tío pidió poder
   * empezar de cero. EnFirebase borra también los documentos de la nube. */
  function limpiarTodo() {
    var primera = window.confirm("Esto borra TODAS las ventas y gastos guardados (en este dispositivo y en la nube). ¿Seguro que querés continuar?");
    if (!primera) return;
    var segunda = window.confirm("Confirmación final: los datos borrados no se pueden recuperar. ¿Borrar todo?");
    if (!segunda) return;

    if (usaFirebase && usuarioActual) {
      db.collection("ventas").get().then(function (snap) {
        var batch = db.batch();
        snap.forEach(function (doc) { batch.delete(doc.ref); });
        return batch.commit();
      }).catch(function () {});
      db.collection("gastos").get().then(function (snap) {
        var batch = db.batch();
        snap.forEach(function (doc) { batch.delete(doc.ref); });
        return batch.commit();
      }).catch(function () {});
      /* El onSnapshot refresca la vista cuando la nube termina de borrar. */
    }

    /* Modo local o mientras llega el snapshot: dejamos el array vacío ya. */
    ventas = []; gastos = [];
    try {
      localStorage.removeItem("tiovity.ventas.v1");
      localStorage.removeItem("tiovity.gastos.v1");
    } catch (e) {}
    pintarVentas();
    pintarGastos();
    pintarBalance();
  }

  /* Escucha cambios en ventas y gastos en tiempo real. Solo una vez por sesión. */
  function escucharVentasYGastos() {
    if (escuchandoVentasGastos) return;
    if (!usaFirebase || !usuarioActual) return;
    escuchandoVentasGastos = true;

    suscripcionVentas = db.collection("ventas").onSnapshot(function (snap) {
      ventas = snap.docs.map(function (doc) {
        var d = doc.data();
        return { id: doc.id, fecha: d.fecha, monto: d.monto, medioPago: d.medioPago,
                 detalle: d.detalle, usuario: d.usuario, uid: d.uid,
                 anulada: d.anulada === true, motivoAnulacion: d.motivoAnulacion };
      });
      pintarVentas();
      pintarBalance();
    }, function (err) {
      avisar("Ventas: no se pudo sincronizar (" + (err.message || err.code || "error") + ")");
    });

    suscripcionGastos = db.collection("gastos").onSnapshot(function (snap) {
      gastos = snap.docs.map(function (doc) {
        var d = doc.data();
        return { id: doc.id, fecha: d.fecha, monto: d.monto, concepto: d.concepto,
                 categoria: d.categoria, usuario: d.usuario, uid: d.uid,
                 anulada: d.anulada === true, motivoAnulacion: d.motivoAnulacion };
      });
      pintarGastos();
      pintarBalance();
    }, function (err) {
      avisar("Gastos: no se pudo sincronizar (" + (err.message || err.code || "error") + ")");
    });
  }

  /* Cierra las suscripciones en tiempo real al cerrar sesión, para que al
   * volver a entrar se conecten de nuevo frescas. */
  function cerrarSuscripciones() {
    if (suscripcionPresupuesto) { suscripcionPresupuesto(); suscripcionPresupuesto = null; }
    if (suscripcionVentas) { suscripcionVentas(); suscripcionVentas = null; }
    if (suscripcionGastos) { suscripcionGastos(); suscripcionGastos = null; }
    escuchandoPresupuesto = false;
    escuchandoVentasGastos = false;
  }

  /* Calcula el balance en un rango de fechas: ventas suman, gastos restan. */
  function calcularBalance(fechaDesde, fechaHasta) {
    var totalVentas = 0;
    var totalGastos = 0;
    var ventasPorFecha = {};
    var gastosPorFecha = {};

    ventas.forEach(function (v) {
      if (v.anulada) return;
      if (v.fecha < fechaDesde || v.fecha > fechaHasta) return;
      totalVentas += v.monto;
      if (!ventasPorFecha[v.fecha]) ventasPorFecha[v.fecha] = 0;
      ventasPorFecha[v.fecha] += v.monto;
    });

    gastos.forEach(function (g) {
      if (g.anulada) return;
      if (g.fecha < fechaDesde || g.fecha > fechaHasta) return;
      totalGastos += g.monto;
      if (!gastosPorFecha[g.fecha]) gastosPorFecha[g.fecha] = 0;
      gastosPorFecha[g.fecha] += g.monto;
    });

    return {
      totalVentas: totalVentas,
      totalGastos: totalGastos,
      balance: totalVentas - totalGastos,
      ventasPorFecha: ventasPorFecha,
      gastosPorFecha: gastosPorFecha,
    };
  }

  function guardarVentasLocales() {
    try {
      localStorage.setItem("tiovity.ventas.v1", JSON.stringify({ version: 1, ventas: ventas }));
    } catch (e) {}
  }

  function guardarGastosLocales() {
    try {
      localStorage.setItem("tiovity.gastos.v1", JSON.stringify({ version: 1, gastos: gastos }));
    } catch (e) {}
  }

  function cargarVentasLocales() {
    try {
      var crudo = localStorage.getItem("tiovity.ventas.v1");
      if (crudo) {
        var d = JSON.parse(crudo);
        if (d && Array.isArray(d.ventas)) ventas = d.ventas;
      }
    } catch (e) {}
  }

  function cargarGastosLocales() {
    try {
      var crudo = localStorage.getItem("tiovity.gastos.v1");
      if (crudo) {
        var d = JSON.parse(crudo);
        if (d && Array.isArray(d.gastos)) gastos = d.gastos;
      }
    } catch (e) {}
  }

  /* ---------- catalogo en el desplegable ---------- */

  /* El stock va entre parentesis y es solo informativo: no se descuenta al
   * presupuestar ni al vender (se maneja a mano en Productos). */
  function etiquetaProducto(p) {
    var precio = p.precio === null
      ? "sin precio"
      : TV.pesos(p.precio) + (p.pideLargo ? "/m" : p.unidad === "METRO 2" ? "/m²" : "");
    var stock = p.stock === 0
      ? " (sin stock)"
      : typeof p.stock === "number"
        ? " (" + stockTexto(p) + ")"
        : "";
    return p.nombre + " · " + precio + stock;
  }

  /* El producto elegido tiene que seguir apareciendo aunque esté dado de baja:
   * si no, un presupuesto guardado perdería la línea en silencio. */
  function opcionesHTML(valorActual) {
    var html = '<option value="">Elegí un producto…</option>';
    var enLista = {};

    PRODUCTOS.paraElegir(catalogo).forEach(function (g) {
      html += '<optgroup label="' + escapar(g.unidad) + '">';
      g.productos.forEach(function (p) {
        enLista[PRODUCTOS.clave(p.nombre)] = true;
        html += '<option value="' + escapar(p.nombre) + '">' + escapar(etiquetaProducto(p)) + "</option>";
      });
      html += "</optgroup>";
    });

    if (valorActual && !enLista[PRODUCTOS.clave(valorActual)]) {
      var p = PRODUCTOS.buscar(catalogo, valorActual);
      if (p) {
        html += '<optgroup label="Fuera de lista">';
        html += '<option value="' + escapar(p.nombre) + '">' + escapar(etiquetaProducto(p) + " (dado de baja)") + "</option>";
        html += "</optgroup>";
      }
    }
    return html;
  }

  function refrescarSelects() {
    var filas = elLineas.children;
    for (var i = 0; i < filas.length; i++) {
      var linea = buscar(Number(filas[i].dataset.id));
      var sel = $("select.prod", filas[i]);
      if (!sel || !linea) continue;
      var valor = linea.producto || "";
      sel.innerHTML = opcionesHTML(valor);
      sel.value = valor;
    }
  }

  function escapar(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------- estado del presupuesto ---------- */

  function nuevaLinea() {
    return { id: proximoId++, producto: null, cantidad: "", largo: "" };
  }

  function hoyISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var dia = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + dia;
  }

  /* ---------- persistencia local ---------- */

  function guardar(ahora) {
    clearTimeout(guardarTimer);
    elEstado.textContent = "Guardando…";
    elDot.dataset.estado = "guardando";
    var escribir = function () {
      try {
        localStorage.setItem(CLAVE, JSON.stringify(estado));
        elEstado.textContent = "Guardado en este equipo";
        elDot.dataset.estado = "ok";
      } catch (e) {
        elEstado.textContent = "No se pudo guardar";
        elDot.dataset.estado = "error";
      }
      guardarEnFirestore();
    };
    if (ahora) escribir();
    else guardarTimer = setTimeout(escribir, 30000);
  }

  function cargar() {
    var crudo;
    try {
      crudo = localStorage.getItem(CLAVE);
    } catch (e) {
      crudo = null;
    }
    if (!crudo) return false;
    try {
      var d = JSON.parse(crudo);
      estado.cliente = d.cliente || "";
      estado.direccion = d.direccion || "";
      estado.telefono = d.telefono || "";
      estado.fecha = d.fecha || "";
      estado.tipo = d.tipo || "PRESUPUESTO";
      estado.lineas = (d.lineas || []).map(function (l) {
        return {
          id: proximoId++,
          producto: l.producto && PRODUCTOS.buscar(catalogo, l.producto) ? l.producto : null,
          cantidad: l.cantidad == null ? "" : l.cantidad,
          largo: l.largo == null ? "" : l.largo,
        };
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------- filas ---------- */

  function crearFila(linea) {
    var row = document.createElement("div");
    row.className = "linea";
    row.dataset.id = linea.id;
    row.innerHTML =
      '<span class="linea__n"></span>' +
      '<label class="f f--prod"><span>Producto</span>' +
        '<select class="prod">' + opcionesHTML(linea.producto) + "</select>" +
        '<span class="prod-nombre"></span></label>' +
      '<label class="f f--cant"><span>Cantidad</span>' +
        '<input class="cant" type="text" inputmode="decimal" autocomplete="off" placeholder="0"></label>' +
      '<label class="f f--largo"><span>Largo real</span>' +
        '<input class="largo" type="text" inputmode="decimal" autocomplete="off" placeholder="—" disabled>' +
        '<em class="pista" hidden></em></label>' +
      '<span class="pedir-print"></span>' +
      '<span class="f f--precio"><span>Precio</span><output class="salida precio" data-base="salida precio">—</output></span>' +
      '<span class="f f--total"><span>Total</span><output class="salida total" data-base="salida total">—</output></span>' +
      '<button class="linea__del" type="button" title="Quitar" aria-label="Quitar producto">×</button>';

    var sel = $(".prod", row);
    var cant = $(".cant", row);
    var largo = $(".largo", row);

    sel.value = linea.producto || "";
    cant.value = linea.cantidad;
    largo.value = linea.largo;

    sel.addEventListener("change", function () {
      var l = buscar(linea.id);
      l.producto = sel.value || null;
      var p = l.producto ? PRODUCTOS.buscar(catalogo, l.producto) : null;
      if (p && p.pideLargo) {
        largo.focus();
      }
      tocar();
    });

    cant.addEventListener("input", function () {
      buscar(linea.id).cantidad = cant.value;
      tocar();
    });

    largo.addEventListener("input", function () {
      buscar(linea.id).largo = largo.value;
      tocar();
    });

    largo.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        agregarLinea();
      }
    });

    $(".linea__del", row).addEventListener("click", function () {
      estado.lineas = estado.lineas.filter(function (l) { return l.id !== linea.id; });
      row.remove();
      renumerar();
      tocar();
    });

    return row;
  }

  function buscar(id) {
    for (var i = 0; i < estado.lineas.length; i++) {
      if (estado.lineas[i].id === id) return estado.lineas[i];
    }
    return null;
  }

  function renumerar() {
    var filas = elLineas.children;
    for (var i = 0; i < filas.length; i++) {
      $(".linea__n", filas[i]).textContent = i + 1;
    }
  }

  function agregarLinea() {
    var linea = nuevaLinea();
    estado.lineas.push(linea);
    var row = crearFila(linea);
    elLineas.appendChild(row);
    renumerar();
    $(".prod", row).focus();
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    tocar();
  }

  function pintarTodo() {
    elLineas.innerHTML = "";
    estado.lineas.forEach(function (l) {
      elLineas.appendChild(crearFila(l));
    });
    renumerar();
    $("#cliente").value = estado.cliente;
    $("#direccion").value = estado.direccion;
    $("#telefono").value = estado.telefono;
    elFecha.value = estado.fecha;
    marcarTipo(estado.tipo);
    recalcular();
  }

  /* ---------- recalculo ---------- */

  function recalcular() {
    var filas = elLineas.children;
    for (var i = 0; i < filas.length; i++) {
      var row = filas[i];
      var linea = buscar(Number(row.dataset.id));
      var calc = CALC.linea(linea);
      var p = calc.producto;

      var salidaPrecio = $(".precio", row);
      var salidaTotal = $(".total", row);
      var inputLargo = $(".largo", row);
      var pistaLargo = $(".pista", row);
      var nombreImpreso = $(".prod-nombre", row);
      var pedirImpreso = $(".pedir-print", row);

      inputLargo.disabled = !(p && p.pideLargo);
      inputLargo.placeholder = p && p.pideLargo ? "4,2" : "";
      nombreImpreso.textContent = p ? p.nombre : "";
      pedirImpreso.textContent =
        calc.largoPedir !== null && calc.largoPedir !== undefined ? TV.metros(calc.largoPedir) : "";

      if (!p) {
        texto(salidaPrecio, "—", "salida--vacia");
        texto(salidaTotal, "—", "salida--vacia");
        pistaLargo.hidden = true;
      } else if (calc.aviso === "SIN PRECIO") {
        texto(salidaPrecio, "SIN PRECIO", "salida--aviso");
        texto(salidaTotal, "—", "salida--vacia");
        pistaLargo.hidden = true;
      } else if (calc.aviso === "REVISAR LARGO") {
        texto(salidaPrecio, TV.pesos(calc.precio), "");
        texto(salidaTotal, "REVISAR LARGO", "salida--aviso");
        pistaLargo.hidden = true;
      } else {
        texto(salidaPrecio, TV.pesos(calc.precio), "");
        if (calc.largoPedir !== null) {
          pistaLargo.hidden = false;
          pistaLargo.textContent = "se pide " + TV.metros(calc.largoPedir);
        } else {
          pistaLargo.hidden = true;
        }
        texto(salidaTotal, calc.total === null ? "—" : TV.pesos(calc.total), calc.total === null ? "salida--vacia" : "");
      }

      row.classList.toggle("linea--incompleta", !!calc.aviso);
    }

    var res = CALC.resumen(estado.lineas);
    elTotal.textContent = TV.pesos(res.total);
    elTotalBar.textContent = TV.pesos(res.total);

    if (res.avisos.length) {
      var items = res.avisos
        .map(function (a) {
          return "<li><strong>Línea " + (a.indice + 1) + ":</strong> " + escapar(a.motivo) +
                 (a.detalle ? " — " + escapar(a.detalle) : "") + "</li>";
        })
        .join("");
      elAviso.innerHTML = "<span>Hay " + res.avisos.length +
        (res.avisos.length === 1 ? " línea" : " líneas") +
        " para revisar antes de mandar el presupuesto:</span><ul>" + items + "</ul>";
      elAviso.hidden = false;
    } else {
      elAviso.hidden = true;
      elAviso.innerHTML = "";
    }

    return res;
  }

  function texto(el, valor, clase) {
    el.textContent = valor;
    el.className = el.dataset.base + (clase ? " " + clase : "");
  }

  function tocar() {
    recalcular();
    guardar(false);
  }

  /* ---------- cabecera ---------- */

  function marcarTipo(tipo) {
    estado.tipo = tipo;
    var botones = document.querySelectorAll("#tipos .tipo");
    for (var i = 0; i < botones.length; i++) {
      botones[i].classList.toggle("is-active", botones[i].dataset.tipo === tipo);
    }
  }

  function enlazarCabecera() {
    [["#cliente", "cliente"], ["#direccion", "direccion"], ["#telefono", "telefono"]].forEach(function (par) {
      var el = $(par[0]);
      el.addEventListener("input", function () {
        estado[par[1]] = el.value;
        guardar(false);
      });
    });

    elFecha.addEventListener("change", function () {
      estado.fecha = elFecha.value;
      guardar(false);
    });

    document.querySelectorAll("#tipos .tipo").forEach(function (b) {
      b.addEventListener("click", function () {
        marcarTipo(b.dataset.tipo);
        guardar(false);
      });
    });
  }


  /* ---------- Firestore: guardar y escuchar ---------- */

  function guardarEnFirestore() {
    if (!usaFirebase || !usuarioActual || ignorandoFirestore) return;
    try {
      db.collection("presupuestos").doc("compartido").set({
        cliente: estado.cliente,
        direccion: estado.direccion,
        telefono: estado.telefono,
        fecha: estado.fecha,
        tipo: estado.tipo,
        lineas: estado.lineas,
        actualizado: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      /* silencioso: si falla la red, el localStorage sigue vigente */
    }
  }

  function escucharPresupuesto() {
    if (!usaFirebase || !usuarioActual || escuchandoPresupuesto) return;
    escuchandoPresupuesto = true;
    suscripcionPresupuesto = db.collection("presupuestos").doc("compartido").onSnapshot(function (doc) {
      if (!doc.exists) return;
      var d = doc.data() || {};
      ignorandoFirestore = true;
      estado.cliente = d.cliente || "";
      estado.direccion = d.direccion || "";
      estado.telefono = d.telefono || "";
      estado.fecha = d.fecha || hoyISO();
      estado.tipo = d.tipo || "PRESUPUESTO";
      estado.lineas = (d.lineas || []).map(function (l) {
        return {
          id: proximoId++,
          producto: l.producto && PRODUCTOS.buscar(catalogo, l.producto) ? l.producto : null,
          cantidad: l.cantidad == null ? "" : l.cantidad,
          largo: l.largo == null ? "" : l.largo,
        };
      });
      $("#cliente").value = estado.cliente;
      $("#direccion").value = estado.direccion;
      $("#telefono").value = estado.telefono;
      elFecha.value = estado.fecha;
      marcarTipo(estado.tipo);
      pintarTodo();
      ignorandoFirestore = false;
    });
  }


  function avisar(mensaje) {
    elToast.textContent = mensaje;
    elToast.classList.add("is-visible");
    clearTimeout(avisar.timer);
    avisar.timer = setTimeout(function () {
      elToast.classList.remove("is-visible");
    }, 2200);
  }

  function textoWhatsApp() {
    return TV.textoPresupuesto({
      negocio: CAT.negocio.nombre,
      tipo: estado.tipo,
      cliente: estado.cliente,
      fecha: estado.fecha,
      lineas: estado.lineas,
      calc: CALC,
    });
  }

  function enviar() {
    var res = recalcular();
    if (res.avisos.length) {
      avisar("Revisá las líneas marcadas antes de enviar");
      return;
    }
    if (!res.validas) {
      avisar("Agregá al menos un producto con cantidad");
      return;
    }
    var tel = (estado.telefono || "").replace(/\D/g, "");
    if (!tel) tel = (CAT.negocio.telefonos[0] || "").replace(/\D/g, "");
    var url = "https://wa.me/549" + tel + "?text=" + encodeURIComponent(textoWhatsApp());
    window.open(url, "_blank", "noopener");
  }

  function nuevo() {
    if (!confirm("¿Empezar un presupuesto nuevo? Se borra el actual de este equipo.")) return;
    estado.cliente = "";
    estado.direccion = "";
    estado.telefono = "";
    estado.fecha = hoyISO();
    estado.tipo = "PRESUPUESTO";
    estado.lineas = [nuevaLinea()];
    pintarTodo();
    guardar(true);
    avisar("Presupuesto nuevo");
  }

  /* ================= PRODUCTOS ================= */

  var elProdLista = $("#productos-lista");
  var elProdResumen = $("#productos-resumen");
  var elProdReporte = $("#productos-reporte");
  var elProdBuscar = $("#productos-buscar");
  var elProdUnidad = $("#productos-unidad");
  var elProdPrecioMax = $("#productos-precio-max");
  var elProdStockFiltro = $("#productos-stock-filtro");

  var elModal = $("#modal-producto");
  var elForm = $("#form-producto");
  var elTitulo = $("#modal-titulo");
  var elPNombre = $("#p-nombre");
  var elPPrecio = $("#p-precio");
  var elPStock = $("#p-stock");
  var elPLargo = $("#p-largo");
  var elPUnidad = $("#p-unidad");
  var elPErrores = $("#p-errores");
  var elPBaja = $("#p-baja");

  /* ================= VENTAS ================= */

  var elVentasResumen = $("#ventas-resumen");
  var elVentasLista = $("#ventas-lista");
  var elVentasBuscar = $("#ventas-buscar");
  var elVentaForm = $("#venta-form");
  var elFormVenta = $("#form-venta");
  var elVentaFecha = $("#venta-fecha");
  var elVentaMedio = $("#venta-medio");
  var elVentaDetalle = $("#venta-detalle");
  var elVentaMonto = $("#venta-monto");
  var elVentaErrores = $("#venta-errores");
  var elVentaCancelar = $("#venta-cancelar");

  var elVentasDesde = $("#ventas-desde");
  var elVentasHasta = $("#ventas-hasta");
  var elVentasMedioFiltro = $("#ventas-medio-filtro");
  var elVentasHoy = $("#ventas-hoy");

  var filtroVentas = { texto: "", fechaDesde: "", fechaHasta: "", medio: "" };

  /* ================= BALANCE ================= */

  var elBalanceResumen = $("#balance-resumen");
  var elBalanceTabla = $("#balance-tabla");
  var elBalanceDesde = $("#balance-desde");
  var elBalanceHasta = $("#balance-hasta");
  var elBalanceCalcular = $("#balance-calcular");
  var elBalanceExportar = $("#balance-exportar");
  var elBalanceMes = $("#balance-mes");
  var elGastoNuevo = $("#gasto-nuevo");

  var elGastoForm = $("#gasto-form");
  var elFormGasto = $("#form-gasto");
  var elGastoFecha = $("#gasto-fecha");
  var elGastoCategoria = $("#gasto-categoria");
  var elGastoConcepto = $("#gasto-concepto");
  var elGastoMonto = $("#gasto-monto");
  var elGastoErrores = $("#gasto-errores");
  var elGastoCancelar = $("#gasto-cancelar");

  var filtro = { texto: "", unidad: "" };
  var editando = null;
  var unidadForm = "METRO LINEAL";

  /* Numero para mostrar y para volver a escribir: 8500 -> "8.500", 4.2 -> "4,2" */
  function numeroCorto(n) {
    var redondeado = Math.round(n * 100) / 100;
    var partes = String(redondeado).split(".");
    var entero = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return partes[1] ? entero + "," + partes[1] : entero;
  }

  function nombreUnidad(u) {
    if (u === "METRO LINEAL") return "Metro lineal";
    if (u === "METRO 2") return "Metro 2";
    return "Unidad";
  }

  function stockTexto(p) {
    if (p.stock === null || p.stock === undefined) return "—";
    if (p.unidad === "UNIDAD") return numeroCorto(p.stock) + " un.";
    if (p.unidad === "METRO 2") return numeroCorto(p.stock) + " m²";
    return numeroCorto(p.stock) + " m";
  }

  function textoFormula(p) {
    return p.pideLargo ? "Cantidad × largo" : "Cantidad × precio";
  }

  function marcasProducto(p) {
    var m = [];
    if (p.precio === null) m.push('<span class="prod__marca prod__marca--ambar">Sin precio</span>');
    if (p.stock === 0) m.push('<span class="prod__marca prod__marca--rojo">Sin stock</span>');
    if (!p.activo) m.push('<span class="prod__marca prod__marca--gris">Dado de baja</span>');
    if (p.unidad === "METRO LINEAL" && !p.pideLargo) {
      m.push('<span class="prod__marca prod__marca--ambar" title="Un producto por metro lineal sin largo se cobra por unidad">Sin largo</span>');
    }
    if (p.propio && p.origen === "planilla" && p.activo) {
      m.push('<span class="prod__marca" title="El precio se fijó en la app: la planilla no lo pisa">Precio propio</span>');
    }
    return m.length ? '<span class="prod__marcas">' + m.join("") + "</span>" : "";
  }

  function filaProductoHTML(p) {
    var precio = p.precio === null
      ? '<span class="prod__precio prod__precio--vacio">Sin precio</span>'
      : '<span class="prod__precio">' + TV.pesos(p.precio) + "</span>";

    var stock = p.stock === null || p.stock === undefined
      ? '<span class="prod__stock prod__stock--vacio">—</span>'
      : '<span class="prod__stock' + (p.stock === 0 ? " prod__stock--cero" : "") + '">' +
        escapar(stockTexto(p)) + "</span>";

    return '<div class="prod-fila' + (p.activo ? "" : " prod-fila--baja") + '"' +
        ' data-nombre="' + escapar(p.nombre) + '" role="button" tabindex="0"' +
        ' aria-label="Editar ' + escapar(p.nombre) + '">' +
      '<div class="prod__nombre-col">' +
        '<div class="prod__nombre">' + escapar(p.nombre) + "</div>" +
        '<span class="prod__unidad">' + escapar(nombreUnidad(p.unidad)) + "</span>" +
        marcasProducto(p) +
      "</div>" +
      precio +
      '<span class="prod__formula">' + escapar(textoFormula(p)) + "</span>" +
      stock +
      '<span class="prod__accion">' +
        '<button class="btn btn--ghost" type="button" tabindex="-1">Editar</button>' +
      "</span>" +
    "</div>";
  }

  function pintarProductos() {
    if (!elProdLista) return;

    var r = PRODUCTOS.resumen(catalogo);
    var partes = [r.total + (r.total === 1 ? " producto" : " productos")];
    partes.push(r.conPrecio + " con precio");
    if (r.sinPrecio) partes.push(r.sinPrecio + " sin precio");
    if (r.sinContar) partes.push(r.sinContar + " sin contar stock");
    if (r.bajas) partes.push(r.bajas + (r.bajas === 1 ? " dado de baja" : " dados de baja"));
    /* cada dato envuelve entero: no queda la palabra "stock" sola en otra linea */
    elProdResumen.innerHTML = partes
      .map(function (x) { return "<span>" + escapar(x) + "</span>"; })
      .join('<i aria-hidden="true">·</i>');

    /* el catalogo muestra tambien los dados de baja (atenuados): si no, no
     * habria forma de volver a activarlos. El desplegable del presupuesto si
     * los esconde (paraElegir). */
    var visibles = PRODUCTOS.filtrar(catalogo, {
      texto: filtro.texto,
      unidad: filtro.unidad,
      bajas: true,
    });

    /* filtros adicionales: precio máximo y stock */
    var precioMaxRaw = elProdPrecioMax ? elProdPrecioMax.value : "";
    var precioMax = precioMaxRaw ? TV.parseNumero(precioMaxRaw) : null;
    var stockFiltro = elProdStockFiltro ? elProdStockFiltro.value : "";

    visibles = visibles.filter(function (p) {
      if (precioMax !== null && typeof p.precio === "number" && p.precio > precioMax) {
        return false;
      }
      if (stockFiltro === "con") {
        if (typeof p.stock !== "number" || p.stock <= 0) return false;
      } else if (stockFiltro === "sin") {
        if (p.stock === 0 || p.stock === null) return false;
        if (typeof p.stock !== "number" || p.stock <= 0) return false;
      } else if (stockFiltro === "sincontar") {
        if (p.stock !== null && p.stock !== undefined) return false;
      }
      return true;
    });

    elProdLista.innerHTML = visibles.length
      ? visibles.map(filaProductoHTML).join("")
      : '<p class="prod-vacio">No hay productos que coincidan.</p>';
  }

  /* ---------- ventas ---------- */

  function moneda(n) {
    return typeof n === "number" ? TV.pesos(n) : "—";
  }

  function pintarVentas() {
    if (!elVentasLista) return;

    var txt = filtroVentas.texto ? filtroVentas.texto.toLowerCase() : "";
    var fd = filtroVentas.fechaDesde;
    var fh = filtroVentas.fechaHasta;
    var med = filtroVentas.medio;
    var visibles = ventas.filter(function (v) {
      if (txt && (v.detalle || "").toLowerCase().indexOf(txt) === -1) return false;
      if (fd && v.fecha < fd) return false;
      if (fh && v.fecha > fh) return false;
      if (med && v.medioPago !== med) return false;
      return true;
    });

    var total = 0;
    visibles.forEach(function (v) { if (!v.anulada) total += v.monto; });

    elVentasResumen.innerHTML =
      '<span>' + ventas.length + ' venta' + (ventas.length === 1 ? '' : 's') + '</span>' +
      '<i aria-hidden="true">·</i><span>' + visibles.length + ' mostradas</span>' +
      '<i aria-hidden="true">·</i><span>Total: ' + moneda(total) + '</span>';

    if (!visibles.length) {
      elVentasLista.innerHTML = '<p class="prod-vacio">No hay ventas que coincidan.</p>';
      return;
    }

    elVentasLista.innerHTML = visibles.map(function (v) {
      var anuladaHtml = v.anulada
        ? '<span class="prod__marca prod__marca--rojo">Anulada</span>'
        : '';
      var usuarioHtml = v.usuario ? '<span style="font-size:11px;color:var(--tinta-2);">'+ escapar(v.usuario) +'</span>' : '';
      return '<div class="prod-fila' + (v.anulada ? ' prod-fila--baja' : '') + '">' +
        '<div class="prod__nombre-col">' +
          '<div class="prod__nombre">' + escapar(v.detalle) + "</div>" +
          '<span class="prod__unidad">' + escapar(v.fecha) + ' · ' + escapar(v.medioPago) + '</span>' +
          '<span class="prod__marcas">' + anuladaHtml + usuarioHtml + '</span>' +
        '</div>' +
        '<span class="prod__precio">' + moneda(v.monto) + '</span>' +
        '<span class="prod__formula">' + (v.anulada ? 'Anulada: ' + escapar(v.motivoAnulacion || '') : 'Venta') + '</span>' +
        '<span class="prod__stock prod__stock--vacio">—</span>' +
        (v.anulada ? '' :
          '<span class="prod__accion">' +
            '<button class="btn btn--ghost btn-anular" type="button" data-id="' + v.id + '">Anular</button>' +
          '</span>') +
      '</div>';
    }).join("");
  }

  function pintarGastos() {
    /* Se usa internamente por el balance; no tiene pantalla propia en esta etapa */
  }

  /* Semana corrida de lunes a lunes: devuelvo el ISO del lunes de esa fecha. */
  function lunesISO(f) {
    var p = f.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    var dia = d.getDay();
    d.setDate(d.getDate() + (dia === 0 ? -6 : 1 - dia));
    var m = d.getMonth() + 1;
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate();
  }

  var DIAS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  var MESES_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
                  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  function diaBonito(f) {
    var p = f.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return DIAS_ES[d.getDay()] + " " + Number(p[2]) + "/" + Number(p[1]);
  }

  /* Recolecta ventas y gastos no anulados del rango, separando los gastos
   * en las columnas que usa su Excel: Gastos (otros), Impuestos, Sueldos y
   * Proveedores. */
  function recolectarMovimientos(desde, hasta) {
    var fechas = new Set();
    var ventasPorFecha = {};
    var gastosPorFecha = {};
    var tot = { ventas: 0, gastos: 0, impuestos: 0, sueldos: 0, proveedores: 0 };

    ventas.forEach(function (v) {
      if (v.anulada) return;
      if (v.fecha < desde || v.fecha > hasta) return;
      ventasPorFecha[v.fecha] = (ventasPorFecha[v.fecha] || 0) + v.monto;
      tot.ventas += v.monto;
      fechas.add(v.fecha);
    });
    gastos.forEach(function (g) {
      if (g.anulada) return;
      if (g.fecha < desde || g.fecha > hasta) return;
      if (!gastosPorFecha[g.fecha]) {
        gastosPorFecha[g.fecha] = { gastos: 0, impuestos: 0, sueldos: 0, proveedores: 0 };
      }
      var clave = g.categoria === "Impuestos" ? "impuestos"
        : g.categoria === "Sueldos" ? "sueldos"
        : g.categoria === "Proveedores" ? "proveedores"
        : "gastos";
      gastosPorFecha[g.fecha][clave] += g.monto;
      tot[clave] += g.monto;
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

  /* Arma una fila de datos de un día con las columnas del Excel. */
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

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  /* Arma las líneas del balance del rango. Si el rango es un mes completo,
   * sigue el formato exacto de su Excel BALANCE: fila fija por cada día de
   * lunes a sábado (vacía si no hay datos), Total Semanal tras cada bloque
   * y Total Mensual al final. Si no, filas de los días con movimiento, con
   * subtotales de semana y el total del período. Los domingos no existían
   * en su planilla (no venden), así que solo se muestran si tuvieron venta
   * o gasto, para no perder ese dinero del total. */
  function construirBalance(desde, hasta) {
    var mov = recolectarMovimientos(desde, hasta);
    var mesCompleto = esRangoMesCompleto(desde, hasta);
    var lineas = [];
    var accTotal = registrosVacios();

    if (mesCompleto) {
      var p = desde.split("-");
      var y = Number(p[0]);
      var m = Number(p[1]);
      var fin = new Date(y, m - 1, Number(hasta.split("-")[2]));
      /* Arranca el lunes de la semana que contiene el día 1, como el Excel */
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
        /* El bloque cierra al llegar al sábado o al terminar el mes */
        if (abiertaSemana && (actual.getDay() === 6 || f === hasta)) {
          lineas.push(filaSubtotal("semana", "Total Semanal", acc));
          acc = registrosVacios();
          abiertaSemana = false;
        }
        actual.setDate(actual.getDate() + 1);
      }
      lineas.push(filaSubtotal("mes", "Total Mensual", accTotal));
    } else {
      var acc = registrosVacios();
      var anterior = null;
      mov.fechas.forEach(function (f) {
        var fila = filaDiaBalance(f, mov);
        if (anterior !== null && lunesISO(f) !== lunesISO(anterior)) {
          lineas.push(filaSubtotal("semana", "Semana del " + diaBonito(lunesISO(anterior)) + " al " + diaBonito(anterior), acc));
          acc = registrosVacios();
        }
        lineas.push(fila);
        sumarFilaEn(acc, fila);
        sumarFilaEn(accTotal, fila);
        anterior = f;
      });
      if (anterior !== null) {
        lineas.push(filaSubtotal("semana", "Semana del " + diaBonito(lunesISO(anterior)) + " al " + diaBonito(anterior), acc));
      }
      if (lineas.length) {
        lineas.push(filaSubtotal("total", "Total del período", accTotal));
      }
    }

    return { lineas: lineas, mesCompleto: mesCompleto };
  }

  function rangoMesActual() {
    var hoy = new Date();
    var y = hoy.getFullYear();
    var m = hoy.getMonth() + 1;
    var ultimoDia = new Date(y, m, 0).getDate();
    return {
      desde: y + "-" + pad2(m) + "-01",
      hasta: y + "-" + pad2(m) + "-" + pad2(ultimoDia),
    };
  }

  /* Tabla con las mismas columnas de la hoja BALANCE del Excel:
   * Día | Ventas | Gastos | Impuestos | Sueldos | Proveedores |
   * Total Ingresos | Total Egresos | Resultado Neto. */
  function cabeceraBalance() {
    return '<thead><tr>' +
      '<th>Fecha</th><th>D&iacute;a</th>' +
      '<th class="num">Ventas</th>' +
      '<th class="num">Gastos</th>' +
      '<th class="num">Impuestos</th>' +
      '<th class="num">Sueldos</th>' +
      '<th class="num">Proveedores</th>' +
      '<th class="num">Total Ingresos</th>' +
      '<th class="num">Total Egresos</th>' +
      '<th class="num">Resultado Neto</th>' +
      '</tr></thead>';
  }

  function celdaMonto(fila, campo, enBlanco) {
    if (enBlanco && !fila[campo]) return '<td class="num"></td>';
    return '<td class="num">' + numeroCorto(fila[campo]) + "</td>";
  }

  function filaBalanceHTML(l, mesCompleto) {
    var clase = l.tipo === "dia"
      ? ""
      : (l.tipo === "total" || l.tipo === "mes" ? " fila-balance-total" : " fila-balance-subtotal");
    var enBlanco = mesCompleto && l.tipo === "dia";
    var p = l.fecha ? l.fecha.split("-") : null;
    var fechaCol = p ? Number(p[2]) + "/" + Number(p[1]) : "";
    return '<tr' + (clase ? ' class="' + clase + '"' : "") + ">" +
      "<td>" + fechaCol + "</td>" +
      "<td>" + escapar(l.etiqueta) + "</td>" +
      celdaMonto(l, "ventas", enBlanco) +
      celdaMonto(l, "gastos", enBlanco) +
      celdaMonto(l, "impuestos", enBlanco) +
      celdaMonto(l, "sueldos", enBlanco) +
      celdaMonto(l, "proveedores", enBlanco) +
      celdaMonto(l, "ingresos", enBlanco) +
      celdaMonto(l, "egresos", enBlanco) +
      celdaMonto(l, "neto", enBlanco) +
      "</tr>";
  }

  function pintarBalance() {
    if (!elBalanceTabla) return;

    var desde = elBalanceDesde ? elBalanceDesde.value : "";
    var hasta = elBalanceHasta ? elBalanceHasta.value : "";

    /* Sin fechas elegidas arranca mostrando el mes corriente, así el
     * balance queda a la vista y se actualiza en tiempo real con las
     * ventas y gastos que carguen todos. */
    if (!desde || !hasta) {
      var r = rangoMesActual();
      desde = r.desde;
      hasta = r.hasta;
      if (elBalanceDesde) elBalanceDesde.value = desde;
      if (elBalanceHasta) elBalanceHasta.value = hasta;
    }

    var b = construirBalance(desde, hasta);

    var titulo = b.mesCompleto
      ? MESES_ES[Number(desde.split("-")[1]) - 1] + " " + desde.split("-")[0]
      : "Del " + diaBonito(desde) + " al " + diaBonito(hasta);

    if (!b.lineas.length) {
      elBalanceTabla.innerHTML = '<p class="prod-vacio">Sin movimientos en este rango.</p>';
      elBalanceResumen.textContent = titulo;
      if (elBalanceExportar) elBalanceExportar.hidden = true;
      return;
    }

    var enBlanco = b.mesCompleto;
    elBalanceTabla.innerHTML =
      '<div class="tabla-scroll"><table class="tabla-balance">' + cabeceraBalance() +
      "<tbody>" + b.lineas.map(function (l) { return filaBalanceHTML(l, enBlanco); }).join("") + "</tbody></table></div>";

    var t = b.lineas[b.lineas.length - 1];
    elBalanceResumen.innerHTML =
      "<span>" + escapar(titulo) + "</span>" +
      '<i aria-hidden="true">·</i><span>Ingresos: ' + numeroCorto(t.ingresos) + "</span>" +
      '<i aria-hidden="true">·</i><span>Egresos: ' + numeroCorto(t.egresos) + "</span>" +
      '<i aria-hidden="true">·</i><span>Resultado: ' + numeroCorto(t.neto) + "</span>";
    if (elBalanceExportar) elBalanceExportar.hidden = false;
  }

  /* Exporta el balance tal cual se ve, a un CSV que abre Excel. */
  function exportarBalance(desde, hasta) {
    var b = construirBalance(desde, hasta);
    var filas = ["Fecha,Dia,Ventas,Gastos,Impuestos,Sueldos,Proveedores,Total Ingresos,Total Egresos,Resultado Neto"];
    b.lineas.forEach(function (l) {
      var enBlanco = b.mesCompleto && l.tipo === "dia";
      function num(campo) {
        var v = l[campo];
        return (enBlanco && !v) ? "" : String(v);
      }
      filas.push([
        l.fecha || "",
        l.etiqueta || "",
        num("ventas"),
        num("gastos"),
        num("impuestos"),
        num("sueldos"),
        num("proveedores"),
        num("ingresos"),
        num("egresos"),
        num("neto"),
      ].join(","));
    });
    var csv = filas.join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "balance-" + desde + "-" + hasta + ".csv";
    link.click();
    URL.revokeObjectURL(url);
    avisar("Balance exportado");
  }

  /* ---------- formulario de producto ---------- */

  function ayudaStock(u) {
    if (u === "UNIDAD") return "Cantidad de unidades que hay hoy. Vacío = sin contar.";
    if (u === "METRO 2") return "Metros cuadrados disponibles. Vacío = sin contar.";
    return "Metros disponibles. Vacío = sin contar.";
  }

  function actualizarAyudaLargo() {
    var ayuda = $("#p-largo-ayuda");
    var natural = PRODUCTOS.pideLargoPorUnidad(unidadForm);
    if (elPLargo.checked === natural) {
      ayuda.className = "";
      ayuda.textContent = natural
        ? "Se cobra cantidad × largo, redondeado a 0,50 m."
        : "Se cobra cantidad × precio.";
      return;
    }
    ayuda.className = "alerta";
    ayuda.textContent = elPLargo.checked
      ? "Va a pedir largo aunque la unidad no sea metro lineal."
      : "Ojo: por metro lineal lo habitual es que pida largo. Así se cobra cantidad × precio.";
  }

  function pintarUnidad() {
    elPUnidad.querySelectorAll(".tipo").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.unidad === unidadForm);
    });
    $("#p-stock-ayuda").textContent = ayudaStock(unidadForm);
    actualizarAyudaLargo();
  }

  function limpiarErrores() {
    elPErrores.hidden = true;
    elPErrores.textContent = "";
    [elPNombre, elPPrecio, elPStock].forEach(function (el) {
      el.classList.remove("campo__input--mal");
    });
  }

  function mostrarErrores(errores) {
    limpiarErrores();
    var campos = { nombre: elPNombre, precio: elPPrecio, stock: elPStock };
    var mensajes = [];
    Object.keys(errores).forEach(function (k) {
      if (campos[k]) campos[k].classList.add("campo__input--mal");
      mensajes.push(errores[k]);
    });
    elPErrores.textContent = mensajes.join(" · ");
    elPErrores.hidden = false;
  }

  function abrirForm(nombre) {
    editando = nombre || null;
    var p = nombre ? PRODUCTOS.buscar(catalogo, nombre) : null;

    elTitulo.textContent = p ? "Editar producto" : "Nuevo producto";
    elPNombre.value = p ? p.nombre : "";
    elPPrecio.value = p && p.precio !== null ? numeroCorto(p.precio) : "";
    elPStock.value = p && p.stock !== null && p.stock !== undefined ? numeroCorto(p.stock) : "";
    unidadForm = p ? p.unidad : "METRO LINEAL";
    elPLargo.checked = p ? !!p.pideLargo : true;
    pintarUnidad();

    elPBaja.hidden = !p;
    if (p) {
      elPBaja.textContent = p.activo ? "Dar de baja" : "Volver a activar";
      elPBaja.className = "btn btn--peligro";
    }

    limpiarErrores();
    elModal.hidden = false;
    elPNombre.focus();
    elPNombre.select();
  }

  function cerrarForm() {
    elModal.hidden = true;
    editando = null;
  }

  function guardarForm(ev) {
    ev.preventDefault();

    var datos = {
      nombre: elPNombre.value,
      unidad: unidadForm,
      precio: elPPrecio.value,
      pideLargo: elPLargo.checked,
      stock: elPStock.value,
    };

    var r = editando
      ? PRODUCTOS.editar(catalogo, editando, datos)
      : PRODUCTOS.agregar(catalogo, datos);

    if (!r.ok) {
      mostrarErrores(r.errores);
      return;
    }

    catalogo = r.catalogo;

    /* si cambió el nombre, el presupuesto abierto tiene que seguir apuntando
     * al mismo producto y no quedar como línea vacía */
    if (editando) {
      var nuevo = PRODUCTOS.limpiarNombre(datos.nombre);
      if (PRODUCTOS.clave(editando) !== PRODUCTOS.clave(nuevo)) {
        estado.lineas.forEach(function (l) {
          if (l.producto && PRODUCTOS.clave(l.producto) === PRODUCTOS.clave(editando)) {
            l.producto = nuevo;
          }
        });
        guardar(false);
      }
    }

    var eraEdicion = !!editando;
    guardarCatalogo();
    cerrarForm();
    refrescarCatalogo();
    avisar(eraEdicion ? "Producto actualizado" : "Producto agregado");
  }

  function descargarPlantilla() {
    var filas = [];
    filas.push("Nombre,Unidad,Precio,Pide Largo,Stock");
    catalogo.forEach(function (p) {
      var nombre = p.nombre || "";
      var unidad = p.unidad || "";
      var precio = typeof p.precio === "number" ? p.precio : "";
      var pideLargo = p.pideLargo ? "SI" : "NO";
      var stock = p.stock !== null && p.stock !== undefined ? p.stock : "";
      filas.push(nombre + "," + unidad + "," + precio + "," + pideLargo + "," + stock);
    });
    var csv = filas.join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "plantilla-productos-maderas-victoria.csv";
    link.click();
    URL.revokeObjectURL(url);
    avisar("Plantilla descargada");
  }

  function enlazarProductos() {
    if (!elProdLista) return;

    elProdBuscar.addEventListener("input", function () {
      filtro.texto = elProdBuscar.value;
      pintarProductos();
    });

    elProdUnidad.addEventListener("click", function (ev) {
      var b = ev.target.closest(".tipo");
      if (!b) return;
      filtro.unidad = b.dataset.unidad || "";
      elProdUnidad.querySelectorAll(".tipo").forEach(function (o) {
        o.classList.toggle("is-active", o === b);
      });
      pintarProductos();
    });

    elProdPrecioMax.addEventListener("input", function () {
      pintarProductos();
    });

    elProdStockFiltro.addEventListener("change", function () {
      pintarProductos();
    });

    elProdLista.addEventListener("click", function (ev) {
      var fila = ev.target.closest(".prod-fila");
      if (!fila) return;
      abrirForm(fila.dataset.nombre);
    });

    elProdLista.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      var fila = ev.target.closest(".prod-fila");
      if (!fila) return;
      ev.preventDefault();
      abrirForm(fila.dataset.nombre);
    });

    document.querySelectorAll("#productos-agregar, #productos-agregar-2").forEach(function (b) {
      b.addEventListener("click", function () { abrirForm(null); });
    });

    $("#productos-descargar-plantilla").addEventListener("click", function () {
      descargarPlantilla();
    });

    elPUnidad.addEventListener("click", function (ev) {
      var b = ev.target.closest(".tipo");
      if (!b) return;
      unidadForm = b.dataset.unidad;
      elPLargo.checked = PRODUCTOS.pideLargoPorUnidad(unidadForm);
      pintarUnidad();
    });

    elPLargo.addEventListener("change", actualizarAyudaLargo);

    elForm.addEventListener("submit", guardarForm);

    $("#p-cancelar").addEventListener("click", cerrarForm);

    elPBaja.addEventListener("click", function () {
      if (!editando) return;
      var p = PRODUCTOS.buscar(catalogo, editando);
      if (!p) return;

      if (p.activo && !confirm('¿Dar de baja "' + p.nombre + '"? Deja de aparecer en el presupuesto, pero no se borra.')) {
        return;
      }

      catalogo = p.activo ? PRODUCTOS.baja(catalogo, editando) : PRODUCTOS.alta(catalogo, editando);
      guardarCatalogo();
      cerrarForm();
      refrescarCatalogo();
      avisar(p.activo ? "Producto dado de baja" : "Producto activado de nuevo");
    });

    elModal.addEventListener("click", function (ev) {
      if (ev.target === elModal) cerrarForm();
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && !elModal.hidden) cerrarForm();
    });
  }

  /* ---------- ventas ---------- */

  function enlazarVentas() {
    if (!elVentasLista) return;

    elVentasBuscar.addEventListener("input", function () {
      filtroVentas.texto = elVentasBuscar.value;
      pintarVentas();
    });

    elVentasDesde.addEventListener("change", function () {
      filtroVentas.fechaDesde = elVentasDesde.value;
      pintarVentas();
    });

    elVentasHasta.addEventListener("change", function () {
      filtroVentas.fechaHasta = elVentasHasta.value;
      pintarVentas();
    });

    elVentasMedioFiltro.addEventListener("click", function (ev) {
      var b = ev.target.closest(".tipo");
      if (!b) return;
      elVentasMedioFiltro.querySelectorAll(".tipo").forEach(function (o) {
        o.classList.toggle("is-active", o === b);
      });
      filtroVentas.medio = b.dataset.medio || "";
      pintarVentas();
    });

    elVentasHoy.addEventListener("click", function () {
      var hoy = hoyISO();
      elVentasDesde.value = hoy;
      elVentasHasta.value = hoy;
      filtroVentas.fechaDesde = hoy;
      filtroVentas.fechaHasta = hoy;
      pintarVentas();
    });

    $("#ventas-nueva").addEventListener("click", function () {
      elVentaFecha.value = hoyISO();
      elVentaMonto.value = "";
      elVentaDetalle.value = "";
      elVentaMedio.value = "Efectivo";
      elVentaErrores.hidden = true;
      elVentaForm.hidden = false;
      elVentaFecha.focus();
    });

    $("#ventas-limpiar").addEventListener("click", function () {
      limpiarTodo();
    });

    elVentaCancelar.addEventListener("click", function () {
      elVentaForm.hidden = true;
    });

    elVentaForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      elVentaErrores.hidden = true;

      var btnSubmit = elVentaForm.querySelector('button[type="submit"]');
      if (btnSubmit.dataset.enviando === "1") return;
      btnSubmit.dataset.enviando = "1";
      btnSubmit.textContent = "Guardando…";
      btnSubmit.disabled = true;

      var fecha = elVentaFecha.value;
      var medio = elVentaMedio.value;
      var detalle = elVentaDetalle.value.trim();
      var montoRaw = elVentaMonto.value;
      var monto = TV.parseNumero(montoRaw);

      if (!fecha) {
        elVentaErrores.textContent = "Elegí una fecha";
        elVentaErrores.hidden = false;
        btnSubmit.dataset.enviando = "0";
        btnSubmit.textContent = "Guardar venta";
        btnSubmit.disabled = false;
        return;
      }
      if (!detalle) {
        elVentaErrores.textContent = "Poné un detalle";
        elVentaErrores.hidden = false;
        btnSubmit.dataset.enviando = "0";
        btnSubmit.textContent = "Guardar venta";
        btnSubmit.disabled = false;
        return;
      }
      if (monto === null || !(monto > 0)) {
        elVentaErrores.textContent = "Monto inválido";
        elVentaErrores.hidden = false;
        btnSubmit.dataset.enviando = "0";
        btnSubmit.textContent = "Guardar venta";
        btnSubmit.disabled = false;
        return;
      }

      var venta = { fecha: fecha, monto: monto, medioPago: medio, detalle: detalle };
      guardarVenta(venta);
      elVentaForm.hidden = true;
      avisar("Venta cargada");
      btnSubmit.dataset.enviando = "0";
      btnSubmit.textContent = "Guardar venta";
      btnSubmit.disabled = false;
    });

    elVentasLista.addEventListener("click", function (ev) {
      var btn = ev.target.closest(".btn-anular");
      if (!btn) return;
      var id = btn.dataset.id;
      var motivo = prompt("Motivo de la anulación:");
      if (motivo === null) return;
      motivo = motivo.trim();
      if (!motivo) {
        avisar("El motivo es obligatorio para anular");
        return;
      }
      anularVenta(id, motivo);
      avisar("Venta anulada");
    });

    elVentaForm.addEventListener("click", function (ev) {
      if (ev.target === elVentaForm) elVentaForm.hidden = true;
    });
  }

  /* ---------- balance ---------- */

  function enlazarBalance() {
    if (!elBalanceCalcular) return;

    elBalanceCalcular.addEventListener("click", function () {
      pintarBalance();
    });

    elBalanceDesde.addEventListener("change", function () {
      if (elBalanceHasta.value && elBalanceDesde.value > elBalanceHasta.value) {
        elBalanceHasta.value = elBalanceDesde.value;
      }
      pintarBalance();
    });
    elBalanceHasta.addEventListener("change", function () {
      if (elBalanceDesde.value && elBalanceHasta.value < elBalanceDesde.value) {
        elBalanceDesde.value = elBalanceHasta.value;
      }
      pintarBalance();
    });

    elBalanceMes.addEventListener("click", function () {
      var r = rangoMesActual();
      elBalanceDesde.value = r.desde;
      elBalanceHasta.value = r.hasta;
      pintarBalance();
    });

    elBalanceExportar.addEventListener("click", function () {
      if (elBalanceDesde.value && elBalanceHasta.value) {
        exportarBalance(elBalanceDesde.value, elBalanceHasta.value);
      }
    });

    /* ---------- gastos ---------- */

    elGastoNuevo.addEventListener("click", function () {
      elGastoFecha.value = hoyISO();
      elGastoCategoria.value = "Proveedores";
      elGastoConcepto.value = "";
      elGastoMonto.value = "";
      elGastoErrores.hidden = true;
      elGastoForm.hidden = false;
      elGastoFecha.focus();
    });

    elGastoCancelar.addEventListener("click", function () {
      elGastoForm.hidden = true;
    });

    elGastoForm.addEventListener("click", function (ev) {
      if (ev.target === elGastoForm) elGastoForm.hidden = true;
    });

    elFormGasto.addEventListener("submit", function (ev) {
      ev.preventDefault();
      elGastoErrores.hidden = true;

      var btnSubmit = this.querySelector('button[type="submit"]');
      var fecha = elGastoFecha.value;
      var concepto = elGastoConcepto.value.trim();
      var categoria = elGastoCategoria.value;
      var monto = TV.parseNumero(elGastoMonto.value);

      if (!fecha) {
        elGastoErrores.textContent = "Elegí una fecha";
        elGastoErrores.hidden = false;
        return;
      }
      if (!concepto) {
        elGastoErrores.textContent = "Poné un concepto";
        elGastoErrores.hidden = false;
        return;
      }
      if (monto === null || !(monto > 0)) {
        elGastoErrores.textContent = "Monto inválido";
        elGastoErrores.hidden = false;
        return;
      }

      if (btnSubmit) {
        btnSubmit.dataset.enviando = "1";
        btnSubmit.textContent = "Guardando…";
        btnSubmit.disabled = true;
      }
      guardarGasto({ fecha: fecha, monto: monto, concepto: concepto, categoria: categoria });
      elGastoForm.hidden = true;
      pintarBalance();
      avisar("Gasto cargado");
      if (btnSubmit) {
        btnSubmit.dataset.enviando = "0";
        btnSubmit.textContent = "Guardar gasto";
        btnSubmit.disabled = false;
      }
    });
  }

  /* ---------- navegacion ---------- */

  function mostrarVista(vista) {
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("is-hidden", v.id !== "view-" + vista);
    });
    document.querySelector(".app").classList.toggle("app--sin-barra", vista !== "presupuesto");
    document.querySelector(".app").classList.toggle("app--login", vista === "login");
    if (vista !== "productos" && !elModal.hidden) cerrarForm();
  }

  /* ---------- arranque ---------- */

  function iniciarApp() {
    var cambios = cargarCatalogo();

    var habia = cargar();
    if (!estado.lineas.length) estado.lineas = [nuevaLinea()];
    if (!estado.fecha) estado.fecha = hoyISO();

    enlazarCabecera();
    pintarTodo();

    if ($("#print-tel")) {
      var tel = CAT.negocio.telefonos.join(" · ");
      $("#print-tel").textContent = "Tel. " + tel;
      $("#print-tel-2").textContent = "Tel. " + tel;
    }

    $("#agregar").addEventListener("click", agregarLinea);
    $("#imprimir").addEventListener("click", function () { window.print(); });
    $("#whatsapp").addEventListener("click", enviar);
    $("#guardar").addEventListener("click", function () {
      guardar(true);
      avisar("Guardado");
    });
    $("#nuevo").addEventListener("click", nuevo);

    document.querySelectorAll(".navbtn").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll(".navbtn").forEach(function (o) {
          o.classList.toggle("is-active", o === b);
        });
        mostrarVista(b.dataset.view);
        /* El balance se repinta al entrar, para que siempre esté al día */
        if (b.dataset.view === "balance") pintarBalance();
      });
    });

    enlazarProductos();
    pintarProductos();
    enlazarCerrarSesion();
    enlazarVentas();
    enlazarBalance();

    cargarVentasLocales();
    cargarGastosLocales();
    pintarVentas();
    pintarGastos();
    pintarBalance();

    if (cambios) {
      elProdReporte.hidden = false;
      elProdReporte.textContent = reporteCambios(cambios);
    }

    if (habia) avisar("Se recuperó el presupuesto de este equipo");
    mostrarVista("presupuesto");
  }

  function iniciar() {
    if (usaFirebase) {
      /* El login es la pantalla principal: arranca siempre en login y el
       * onAuthStateChanged decide si entra directo al presupuesto (sesión
       * guardada) o espera el login a mano. */
      mostrarLogin();
      auth.onAuthStateChanged(function (user) {
        if (user) {
          entrarConSesion(user);
        } else {
          usuarioActual = null;
          cerrarSuscripciones();
          mostrarLogin();
        }
      });
      return;
    }
    iniciarApp();
  }

  /* Único punto de entrada a la app con sesión. Idempotente: se puede
   * llamar desde onAuthStateChanged y desde el login, sin duplicar nada. */
  function entrarConSesion(user) {
    usuarioActual = user;
    var btn = $("#cerrar-sesion");
    if (btn) btn.hidden = !user;
    /* Listeners primero: si algo falla al enlazar la UI, las ventas
     * quedan sincronizadas igual. Los flags evitan duplicados. */
    escucharPresupuesto();
    escucharVentasYGastos();
    if (!appIniciada) {
      appIniciada = true;
      iniciarApp();
    }
  }

  function enlazarCerrarSesion() {
    var btn = $("#cerrar-sesion");
    if (!btn) return;
    btn.hidden = !usuarioActual;
    btn.addEventListener("click", function () {
      if (!usuarioActual) return;
      auth.signOut().catch(function (err) {
        avisar("No se pudo cerrar sesión: " + (err.message || ""));
      });
    });
  }

  function mostrarLogin() {
    mostrarVista("login");
    var form = $("#form-login");
    form.removeEventListener("submit", manejarLogin);
    form.addEventListener("submit", manejarLogin);
  }

  function manejarLogin(ev) {
    ev.preventDefault();
    var email = $("#login-email").value;
    var password = $("#login-password").value;
    var errores = $("#login-errores");
    var btn = $("#form-login").querySelector('button[type="submit"]');

    errores.hidden = true;
    if (btn && btn.dataset.enviando === "1") return;
    if (btn) {
      btn.dataset.enviando = "1";
      btn.disabled = true;
      btn.textContent = "Ingresando…";
    }

    auth.signInWithEmailAndPassword(email, password).then(function (cred) {
      /* No se depende solo del onAuthStateChanged: si el estado no dispara
       * en la página (ocurre con file://), entramos por acá igual.
       * entrarConSesion es idempotente, así que no hay arranque doble. */
      entrarConSesion(cred.user);
      if (btn) {
        btn.dataset.enviando = "0";
        btn.disabled = false;
        btn.textContent = "Entrar";
      }
    }).catch(function (err) {
      errores.hidden = false;
      errores.textContent = err.message || "No se pudo iniciar sesión.";
      if (btn) {
        btn.dataset.enviando = "0";
        btn.disabled = false;
        btn.textContent = "Entrar";
      }
    });
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();

