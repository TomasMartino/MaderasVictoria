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
  var PLANILLA = window.TV_PLANILLA;

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
  var escuchandoCatalogo = false;
  var suscripcionCatalogo = null;
  var appIniciada = false;
  /* Verdadero mientras se esta resolviendo un login manual. Evita que el
   * listener de Firebase nos devuelva al login en medio del ingreso. */
  var loginEnCurso = false;

  /* Cada dispositivo trabaja en su propio documento de presupuesto.
   * Así 3 personas pueden usar la app al mismo tiempo sin pisarse. */
  var presupuestoActivo = null;
  var CLAVE_PRESUPUESTO_ACTIVO = "tiovity.presupuesto-activo";

  function presupuestoActivoId() {
    if (presupuestoActivo) return presupuestoActivo;
    var guardado = null;
    try { guardado = localStorage.getItem(CLAVE_PRESUPUESTO_ACTIVO); } catch (e) {}
    if (guardado) {
      presupuestoActivo = guardado;
      return presupuestoActivo;
    }
    presupuestoActivo = "pres_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
    try { localStorage.setItem(CLAVE_PRESUPUESTO_ACTIVO, presupuestoActivo); } catch (e) {}
    return presupuestoActivo;
  }

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
    numero: null,
    numeroRemito: null,
    cliente: "",
    direccion: "",
    telefono: "",
    cuit: "",
    localidad: "",
    provincia: "",
    condicionIva: "",
    fecha: "",
    tipo: "PRESUPUESTO",
    lineas: [],
  };

  /* ---------- numeracion ----------
   * Presupuestos y remitos llevan series separadas, cada una autoincremental.
   * Se guarda el ultimo emitido en este equipo y tambien en Firestore para que
   * dos dispositivos no repitan el mismo numero. */
  var NUMERO_BASE = 23889;      /* el primer presupuesto sale con 23890 */
  var NUMERO_BASE_REMITO = 99;  /* el primer remito sale con 100 */

  /* Contador de una serie: guarda el ultimo numero en localStorage y, si hay
   * sesion, lo lleva a un documento de Firestore con una transaccion. */
  function crearContador(claveLocal, docFirestore, base) {
    function leer() {
      try {
        var v = Number(localStorage.getItem(claveLocal));
        if (isFinite(v) && v >= base) return v;
      } catch (e) {}
      return base;
    }

    var ultimo = leer();

    function fijar(n) {
      ultimo = n;
      try { localStorage.setItem(claveLocal, String(n)); } catch (e) {}
    }

    return {
      ultimo: function () { return ultimo; },
      /* Reserva el siguiente y lo entrega por callback. Sin sesion o sin red
       * usa el contador del equipo. */
      reservar: function (listo) {
        if (!usaFirebase || !usuarioActual) {
          fijar(ultimo + 1);
          listo(ultimo);
          return;
        }
        var ref = db.collection("config").doc(docFirestore);
        db.runTransaction(function (tx) {
          return tx.get(ref).then(function (doc) {
            var n = doc.exists ? Number(doc.data().numero) || 0 : 0;
            n = Math.max(n, leer()) + 1;
            tx.set(ref, { numero: n }, { merge: true });
            return n;
          });
        }).then(function (n) {
          fijar(n);
          listo(n);
        }).catch(function () {
          fijar(ultimo + 1);
          listo(ultimo);
        });
      },
    };
  }

  var contadorPresupuesto = crearContador("tiovity.ultimo-numero.v1", "presupuesto-numero", NUMERO_BASE);
  var contadorRemito = crearContador("tiovity.ultimo-remito.v1", "remito-numero", NUMERO_BASE_REMITO);
  /* Evita pedir dos numeros de remito si la pantalla se repinta mientras la
   * reserva todavia esta en vuelo. */
  var reservandoRemito = false;

  /* El numero que corresponde al documento que se esta por emitir. */
  function numeroDelTipo() {
    return esRemito() ? estado.numeroRemito : estado.numero;
  }

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
    guardarCatalogoAFirestore();
  }

  /* Sube el catálogo a Firebase para que los otros dispositivos lo vean.
   * Último en escribir gana (suficiente para 3 personas). */
  function guardarCatalogoAFirestore() {
    if (!usaFirebase || !usuarioActual) return;
    try {
      db.collection("config").doc("catalogo").set({
        productos: catalogo,
        actualizado: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }).catch(function () {});
    } catch (e) {}
  }

  /* Escucha cambios de catálogo en la nube y los trae a este equipo. */
  function escucharCatalogo() {
    if (!usaFirebase || !usuarioActual || escuchandoCatalogo) return;
    escuchandoCatalogo = true;
    suscripcionCatalogo = db.collection("config").doc("catalogo").onSnapshot(function (doc) {
      if (!doc.exists) return;
      var d = doc.data() || {};
      if (!d.productos || !Array.isArray(d.productos)) return;
      var r = PRODUCTOS.fusionar(CAT.productos, d.productos);
      catalogo = r.productos;
      crearMotor();
      refrescarSelects();
      pintarProductos();
      /* También lo dejamos en localStorage para offline */
      try {
        localStorage.setItem(CLAVE_PRODUCTOS, JSON.stringify({ version: 1, productos: catalogo }));
      } catch (e) {}
    }, function (err) {
      /* silencioso: si falla la red, seguimos con lo local */
    });
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
      }).then(function (ref) {
        /* Se muestra YA, sin esperar al snapshot. Si la nube tarda y el
         * usuario cree que no se guardó, vuelve a cargar y duplica todo. */
        venta.id = ref.id;
        venta.anulada = false;
        if (!ventas.some(function (x) { return x.id === ref.id; })) {
          ventas.push(venta);
          guardarVentasLocales();
          pintarVentas();
          pintarBalance();
        }
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
      }).then(function (ref) {
        gasto.id = ref.id;
        gasto.anulada = false;
        if (!gastos.some(function (x) { return x.id === ref.id; })) {
          gastos.push(gasto);
          guardarGastosLocales();
          pintarGastos();
          pintarBalance();
        }
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

  /* Edita una venta existente (monto, detalle, medio de pago, fecha). */
  function editarVenta(id, campos) {
    var v = ventas.find(function (x) { return x.id === id; });
    if (!v) return;
    Object.keys(campos || {}).forEach(function (k) { v[k] = campos[k]; });
    if (!usaFirebase || !usuarioActual) {
      guardarVentasLocales();
      pintarVentas();
      pintarBalance();
      return;
    }
    try {
      db.collection("ventas").doc(id).update(campos).catch(function (err) {
        guardarVentasLocales();
        pintarVentas();
        pintarBalance();
        avisar("La venta no se editó en la nube: quedó en este equipo");
      });
    } catch (e) {
      guardarVentasLocales();
      pintarVentas();
      pintarBalance();
    }
  }

  /* Edita un gasto existente (monto, concepto, categoría, fecha). */
  function editarGasto(id, campos) {
    var g = gastos.find(function (x) { return x.id === id; });
    if (!g) return;
    Object.keys(campos || {}).forEach(function (k) { g[k] = campos[k]; });
    if (!usaFirebase || !usuarioActual) {
      guardarGastosLocales();
      pintarGastos();
      pintarBalance();
      return;
    }
    try {
      db.collection("gastos").doc(id).update(campos).catch(function (err) {
        guardarGastosLocales();
        pintarGastos();
        pintarBalance();
        avisar("El gasto no se editó en la nube: quedó en este equipo");
      });
    } catch (e) {
      guardarGastosLocales();
      pintarGastos();
      pintarBalance();
    }
  }

  /* Aplica la edición de una fila del balance (un día) a las ventas y
   * gastos subyacentes. Los campos son los totales del día por categoría.
   * Mismo criterio que la comparación con el Excel: no toca el detalle
   * cargado a mano, ajusta el registro de resumen del día. */
  function aplicarEdicionFilaBalance(fecha, valores) {
    ajustarResumenDia("ventas", fecha, "Ventas " + fecha, null,
      typeof valores.ventas === "number" ? valores.ventas : 0);

    [
      { categoria: "Otros", campo: "gastos" },
      { categoria: "Impuestos", campo: "impuestos" },
      { categoria: "Sueldos", campo: "sueldos" },
      { categoria: "Proveedores", campo: "proveedores" },
    ].forEach(function (cat) {
      ajustarResumenDia("gastos", fecha, cat.categoria + " " + fecha, cat.categoria,
        typeof valores[cat.campo] === "number" ? valores[cat.campo] : 0);
    });

    pintarVentas();
    pintarGastos();
    pintarBalance();
    avisar("Fila del balance actualizada");
  }

  /* Repara las importaciones repetidas: anula las ventas y gastos idénticos
   * que sobraron (misma fecha, detalle/concepto, monto y medio/categoría).
   * No borra nada. Abre un modal para elegir grupo por grupo qué limpiar. */
  function revisarDuplicados() {
    var gruposV = TV_PLANILLA_VENTAS.duplicadas(ventas);
    var gruposG = TV_PLANILLA_VENTAS.duplicadasGastos(gastos);

    if (!gruposV.length && !gruposG.length) {
      avisar("No hay ventas ni gastos duplicados");
      return;
    }

    var modal = $("#modal-duplicados");
    var lista = $("#duplicados-lista");
    var resumen = $("#duplicados-resumen");
    var error = $("#duplicados-error");
    var btnAplicar = $("#duplicados-aplicar");

    var grupos = [];
    gruposV.forEach(function (g) { grupos.push({ tipo: "ventas", grupo: g }); });
    gruposG.forEach(function (g) { grupos.push({ tipo: "gastos", grupo: g }); });

    function registrosDe(item) {
      return item.tipo === "ventas" ? item.grupo.ventas : item.grupo.gastos;
    }

    function marcados() {
      return lista.querySelectorAll("input[type=checkbox]:checked");
    }

    function actualizarResumen() {
      var elegidos = marcados();
      var sobran = 0;
      var monto = 0;
      Array.prototype.forEach.call(elegidos, function (cb) {
        var regs = registrosDe(grupos[Number(cb.getAttribute("data-grupo"))]);
        var repetidos = regs.length - 1;
        sobran += repetidos;
        monto += (Number(regs[0].monto) || 0) * repetidos;
      });
      resumen.innerHTML = elegidos.length
        ? "<strong>" + elegidos.length + "</strong> de " + grupos.length +
          " grupos marcados · se anulan <strong>" + sobran + "</strong> registros (" +
          TV.pesos(monto) + ")"
        : "No hay ningún grupo marcado.";
      btnAplicar.disabled = !elegidos.length;
    }

    function armarGrupo(item, i) {
      var esVenta = item.tipo === "ventas";
      var regs = registrosDe(item);
      var primero = regs[0];
      var caja = document.createElement("div");
      caja.className = "dup-grupo";

      var cab = document.createElement("label");
      cab.className = "dup-grupo__cab";

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.setAttribute("data-grupo", String(i));
      cb.addEventListener("change", actualizarResumen);

      var texto = document.createElement("span");
      texto.className = "dup-grupo__texto";

      var titulo = document.createElement("span");
      titulo.className = "dup-grupo__titulo";
      titulo.textContent = (esVenta ? "Venta" : "Gasto") + " · " + primero.fecha;

      var meta = document.createElement("span");
      meta.className = "dup-grupo__meta";
      var desc = esVenta ? (primero.detalle || "sin detalle") : (primero.concepto || "sin concepto");
      meta.textContent = desc + " · " + TV.pesos(primero.monto) + " · " + regs.length + " veces";

      texto.appendChild(titulo);
      texto.appendChild(meta);
      cab.appendChild(cb);
      cab.appendChild(texto);
      caja.appendChild(cab);

      var detalle = document.createElement("div");
      detalle.className = "dup-grupo__detalle";
      regs.forEach(function (r, j) {
        var fila = document.createElement("div");
        fila.className = "dup-fila " + (j === 0 ? "dup-fila--queda" : "dup-fila--sale");
        var etiqueta = document.createElement("span");
        etiqueta.textContent = j === 0 ? "Queda" : "Se anula";
        var valor = document.createElement("span");
        valor.textContent = TV.pesos(r.monto) +
          (esVenta && r.medioPago ? " · " + r.medioPago : "");
        fila.appendChild(etiqueta);
        fila.appendChild(valor);
        detalle.appendChild(fila);
      });
      caja.appendChild(detalle);

      return caja;
    }

    function anularSeleccionados() {
      var elegidos = marcados();
      if (!elegidos.length) return;
      var sobran = 0;
      Array.prototype.forEach.call(elegidos, function (cb) {
        var item = grupos[Number(cb.getAttribute("data-grupo"))];
        var regs = registrosDe(item);
        for (var i = 1; i < regs.length; i++) {
          var r = regs[i];
          if (item.tipo === "ventas") {
            anularVenta(r.id, "Duplicada por importación");
            var local = ventas.find(function (x) { return x.id === r.id; });
            if (local) {
              local.anulada = true;
              local.motivoAnulacion = "Duplicada por importación";
            }
          } else {
            anularGasto(r.id, "Duplicado por importación");
            var localG = gastos.find(function (x) { return x.id === r.id; });
            if (localG) {
              localG.anulada = true;
              localG.motivoAnulacion = "Duplicado por importación";
            }
          }
          sobran++;
        }
      });

      modal.hidden = true;
      pintarVentas();
      pintarGastos();
      pintarBalance();
      avisar("Se anularon " + sobran + " registros duplicados");
    }

    lista.innerHTML = "";
    grupos.forEach(function (item, i) {
      lista.appendChild(armarGrupo(item, i));
    });

    error.hidden = true;
    modal.hidden = false;
    actualizarResumen();

    $("#duplicados-todos").onclick = function () {
      Array.prototype.forEach.call(lista.querySelectorAll("input[type=checkbox]"), function (c) {
        c.checked = true;
      });
      actualizarResumen();
    };
    $("#duplicados-ninguno").onclick = function () {
      Array.prototype.forEach.call(lista.querySelectorAll("input[type=checkbox]"), function (c) {
        c.checked = false;
      });
      actualizarResumen();
    };
    $("#duplicados-cancelar").onclick = function () { modal.hidden = true; };
    btnAplicar.onclick = anularSeleccionados;
    /* Cerrar tocando el fondo, sin cerrar si el click es dentro de la caja. */
    modal.onclick = function (ev) { if (ev.target === modal) modal.hidden = true; };
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
  /* Borra datos según la opción elegida:
   * - "todo": ventas, gastos, productos, presupuesto (local y Firebase)
   * - "solo-ventas": solo ventas (local y Firebase), no toca gastos ni balance
   * Recarga la página al terminar para que todo empiece limpio. */
  function borrarDatos(opcion) {
    var mensajeTodo = "Esto borra TODO: ventas, gastos, productos y presupuesto de este dispositivo, y ventas/gastos/presupuestos de Firebase (la nube). ¿Seguro que querés continuar?";
    var mensajeSoloVentas = "Esto borra solo las ventas diarias (local y Firebase). Los gastos y el balance no se tocan. ¿Seguro que querés continuar?";
    var mensaje = (opcion === "solo-ventas") ? mensajeSoloVentas : mensajeTodo;

    var primera = window.confirm(mensaje);
    if (!primera) return;
    var segunda = window.confirm("Confirmación final: no se puede deshacer. ¿Borrar ahora?");
    if (!segunda) return;

    var borrarVentas = (opcion === "todo" || opcion === "solo-ventas");
    var borrarGastos = (opcion === "todo" || opcion === "solo-gastos");
    var borrarProductos = (opcion === "todo");
    var borrarPresupuesto = (opcion === "todo");

    var promesas = [];
    if (usaFirebase && usuarioActual) {
      if (borrarVentas) {
        promesas.push(
          db.collection("ventas").get().then(function (snap) {
            var batch = db.batch();
            snap.forEach(function (doc) { batch.delete(doc.ref); });
            return batch.commit();
          }).catch(function () {})
        );
      }
      if (borrarGastos) {
        promesas.push(
          db.collection("gastos").get().then(function (snap) {
            var batch = db.batch();
            snap.forEach(function (doc) { batch.delete(doc.ref); });
            return batch.commit();
          }).catch(function () {})
        );
      }
      if (borrarPresupuesto) {
        promesas.push(
          db.collection("presupuestos").get().then(function (snap) {
            var batch = db.batch();
            snap.forEach(function (doc) { batch.delete(doc.ref); });
            return batch.commit();
          }).catch(function () {})
        );
      }
    }

    Promise.all(promesas).then(function () {
      if (borrarVentas) ventas = [];
      if (borrarGastos) gastos = [];
      try {
        if (borrarVentas) localStorage.removeItem("tiovity.ventas.v1");
        if (borrarGastos) localStorage.removeItem("tiovity.gastos.v1");
        if (borrarProductos) localStorage.removeItem("tiovity.productos.v1");
        if (borrarPresupuesto) localStorage.removeItem("tiovity.presupuesto.v1");
        if (borrarPresupuesto) localStorage.removeItem("tiovity.presupuesto-activo");
      } catch (e) {}

      if (borrarProductos) {
        catalogo = [];
        crearMotor();
        refrescarSelects();
      }

      pintarVentas();
      pintarGastos();
      pintarBalance();
      location.reload();
    });
  }

  /* Mantiene compatibilidad: "Reiniciar desde cero" = borrar todo. */
  function limpiarTodo() {
    borrarDatos("todo");
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
    if (suscripcionCatalogo) { suscripcionCatalogo(); suscripcionCatalogo = null; }
    escuchandoPresupuesto = false;
    escuchandoVentasGastos = false;
    escuchandoCatalogo = false;
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

  /* Orden para grupos y listas: con precio arriba, después los sin precio;
   * dentro de cada tramo, alfabético. No toca el motor, solo la UI. */
  function conPrecioPrimero(gs) {
    return gs.slice().sort(function (a, b) {
      var pa = typeof a.precio === "number" ? 0 : 1;
      var pb = typeof b.precio === "number" ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0;
    });
  }

  function refrescarSelects() {
    var filas = elLineas.children;
    for (var i = 0; i < filas.length; i++) {
      var linea = buscar(Number(filas[i].dataset.id));
      var input = $(".prod-buscar", filas[i]);
      if (!input || !linea) continue;
      input.value = etiquetaMostrada(linea.producto);
    }
  }

  /* Lo que muestra el campo del producto elegido. Los dados de baja no
   * aparecen en la lista, pero si una línea guardada todavía tiene uno,
   * el campo lo marca "(anulado)" en vez de perder el nombre y el total
   * en silencio. */
  function etiquetaMostrada(nombre) {
    var p = nombre ? PRODUCTOS.buscar(catalogo, nombre) : null;
    if (!p) return "";
    /* Solo el nombre. El precio y el stock se muestran en el desplegable,
     * no en el campo del producto ya elegido. */
    return p.nombre + (p.activo ? "" : " (anulado)");
  }

  /* Lista filtrada para el buscador del dropdown de producto, agrupada por
   * unidad y con los que tienen precio siempre arriba. El producto elegido
   * (aunque esté dado de baja) sale marcado para que se vea el elegido. */
  function listaProductosHTML(texto, valorActual) {
    var t = PRODUCTOS.sinAcentos(String(texto || "").trim().toLowerCase());
    var html = "";
    PRODUCTOS.paraElegir(catalogo).forEach(function (g) {
      var ps = conPrecioPrimero(g.productos).filter(function (p) {
        if (!t) return true;
        return PRODUCTOS.sinAcentos(p.nombre.toLowerCase()).indexOf(t) !== -1;
      });
      if (!ps.length) return;
      html += '<div class="prod-drop__grupo">' + escapar(g.unidad) + "</div>";
      ps.forEach(function (p) {
        var elegido = valorActual && PRODUCTOS.clave(valorActual) === PRODUCTOS.clave(p.nombre);
        html += '<div class="prod-drop__op' + (elegido ? " prod-drop__op--elegido" : "") + '" data-nombre="' + escapar(p.nombre) + '">' + escapar(etiquetaProducto(p)) + "</div>";
      });
    });
    if (valorActual) {
      html = '<div class="prod-drop__op" data-nombre="">— Sin producto —</div>' + html;
    }
    if (!html) html = '<div class="prod-drop__vacio">Sin resultados</div>';
    return html;
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
    /* Auto-guardado tras 2 minutos de inactividad (120.000 ms). */
    else guardarTimer = setTimeout(escribir, 120000);
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
      estado.numero = d.numero || null;
      estado.numeroRemito = d.numeroRemito || null;
      estado.cliente = d.cliente || "";
      estado.direccion = d.direccion || "";
      estado.telefono = d.telefono || "";
      estado.cuit = d.cuit || "";
      estado.localidad = d.localidad || "";
      estado.provincia = d.provincia || "";
      estado.condicionIva = d.condicionIva || "";
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
        '<input class="prod-buscar" type="text" autocomplete="off" placeholder="Buscar producto…">' +
        '<div class="prod-drop__lista" hidden></div>' +
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

    var buscando = $(".prod-buscar", row);
    var lista = $(".prod-drop__lista", row);
    var cant = $(".cant", row);
    var largo = $(".largo", row);

    function etiquetaDe(nombre) {
      return etiquetaMostrada(nombre);
    }

    function ponerValor(nombre) {
      buscar(linea.id).producto = nombre || null;
      buscando.value = etiquetaDe(nombre);
    }

    function abrirLista() {
      lista.innerHTML = listaProductosHTML(buscando.value, buscar(linea.id).producto);
      lista.hidden = false;
    }

    function elegir(nombre) {
      ponerValor(nombre);
      lista.hidden = true;
      var p = nombre ? PRODUCTOS.buscar(catalogo, nombre) : null;
      if (p && p.pideLargo) {
        largo.focus();
      }
      tocar();
    }

    buscando.value = etiquetaDe(linea.producto);
    cant.value = linea.cantidad;
    largo.value = linea.largo;

    buscando.addEventListener("focus", abrirLista);
    buscando.addEventListener("input", function () {
      abrirLista();
    });
    buscando.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        lista.hidden = true;
        buscando.value = etiquetaDe(buscar(linea.id).producto);
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        var op = lista.querySelector(".prod-drop__op");
        if (op) elegir(op.dataset.nombre || null);
      }
    });
    buscando.addEventListener("blur", function () {
      setTimeout(function () {
        lista.hidden = true;
        buscando.value = etiquetaDe(buscar(linea.id).producto);
      }, 120);
    });
    lista.addEventListener("mousedown", function (ev) {
      var op = ev.target.closest(".prod-drop__op");
      if (!op) return;
      ev.preventDefault();
      elegir(op.dataset.nombre || null);
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
    $(".prod-buscar", row).focus();
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
    $("#cuit").value = estado.cuit;
    $("#localidad").value = estado.localidad;
    $("#provincia").value = estado.provincia;
    $("#condicion-iva").value = estado.condicionIva;
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
    /* El remito lleva su propia serie: se pide un numero la primera vez que se
     * pasa el documento a remito. */
    if (esRemito() && !estado.numeroRemito && !reservandoRemito) {
      reservandoRemito = true;
      contadorRemito.reservar(function (n) {
        reservandoRemito = false;
        if (estado.numeroRemito) return;
        estado.numeroRemito = n;
        guardar(true);
      });
    }
  }

  function enlazarCabecera() {
    [
      ["#cliente", "cliente"],
      ["#direccion", "direccion"],
      ["#telefono", "telefono"],
      ["#cuit", "cuit"],
      ["#localidad", "localidad"],
      ["#provincia", "provincia"],
      ["#condicion-iva", "condicionIva"],
    ].forEach(function (par) {
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
      db.collection("presupuestos").doc(presupuestoActivoId()).set({
        numero: estado.numero,
        numeroRemito: estado.numeroRemito,
        cliente: estado.cliente,
        direccion: estado.direccion,
        telefono: estado.telefono,
        cuit: estado.cuit,
        localidad: estado.localidad,
        provincia: estado.provincia,
        condicionIva: estado.condicionIva,
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
    suscripcionPresupuesto = db.collection("presupuestos").doc(presupuestoActivoId()).onSnapshot(function (doc) {
      if (!doc.exists) return;
      var d = doc.data() || {};
      ignorandoFirestore = true;
      estado.numero = d.numero || estado.numero || null;
      estado.numeroRemito = d.numeroRemito || estado.numeroRemito || null;
      estado.cliente = d.cliente || "";
      estado.direccion = d.direccion || "";
      estado.telefono = d.telefono || "";
      estado.cuit = d.cuit || "";
      estado.localidad = d.localidad || "";
      estado.provincia = d.provincia || "";
      estado.condicionIva = d.condicionIva || "";
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
      $("#cuit").value = estado.cuit;
      $("#localidad").value = estado.localidad;
      $("#provincia").value = estado.provincia;
      $("#condicion-iva").value = estado.condicionIva;
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

  /* ---------- PDF del presupuesto (lo que se manda por WhatsApp) ---------- */

  /* dd/mm/aaaa para el PDF. fechaCorta() (mas abajo) devuelve solo "dd/mm". */
  function fechaCompleta(iso) {
    var p = String(iso || "").split("-");
    return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : String(iso || "");
  }

  /* Lo que va en una celda del PDF: "-" si el dato esta vacio. */
  function datoCelda(v) {
    if (v === null || v === undefined) return "-";
    var t = String(v).trim();
    return t === "" ? "-" : t;
  }

  /* El dibujo vive en js/pdf-presupuesto.js, que no toca el DOM y tiene tests.
   * El remito usa otra maqueta: sin precios y con transporte. */
  function pdfDelPresupuesto() {
    var jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!jsPDF || !window.TV_PDF) return null;
    var datos = {
      jsPDF: jsPDF,
      logo: window.TV_LOGO_JPG,
      negocio: CAT.negocio,
      estado: estado,
      numero: numeroDelTipo(),
      calc: CALC,
      pesos: TV.pesos,
      dato: datoCelda,
      fecha: fechaCompleta(estado.fecha),
    };
    if (esRemito() && window.TV_PDF.crearRemito) return window.TV_PDF.crearRemito(datos);
    return window.TV_PDF.crear(datos);
  }

  function esRemito() {
    return String(estado.tipo || "").toUpperCase() === "REMITO";
  }

  /* Número para un link wa.me. Si ya viene con país (54...) se respeta; si es
   * un número local se le agrega 549. Evita el "549549..." al duplicar. */
  function numeroWa(tel) {
    var d = String(tel || "").replace(/\D/g, "");
    if (!d) return "";
    if (d.indexOf("54") === 0) return d;
    return "549" + d;
  }

  /* Baja el PDF al equipo. */
  function bajarArchivo(blob, nombre) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  /* Mensaje que acompaña al PDF en el chat. */
  function mensajeConPdf() {
    return esRemito()
      ? "Te paso el remito en PDF."
      : "Te paso el presupuesto en PDF. Cualquier duda me escribís.";
  }

  /* Envía el presupuesto: descarga el PDF y abre el chat del número directo.
   * WhatsApp no deja adjuntar archivos por link (wa.me solo lleva texto), así
   * que el PDF se baja y se adjunta en el chat que ya queda abierto. */
  function enviarPresupuesto() {
    var res = recalcular();
    if (res.avisos.length) {
      avisar("Revisá las líneas marcadas antes de enviar");
      return;
    }
    if (!res.validas) {
      avisar("Agregá al menos un producto con cantidad");
      return;
    }

    var telCliente = numeroWa(estado.telefono);
    var telNegocio = numeroWa(CAT.negocio.telefonos[0]);
    var tel = telCliente || telNegocio;

    var doc = pdfDelPresupuesto();
    if (!doc) {
      /* Sin la librería del PDF: se manda el texto de siempre */
      var texto = textoWhatsApp();
      if (!tel) {
        avisar("Poné el teléfono del cliente para abrir su chat");
        return;
      }
      window.open("https://wa.me/" + tel + "?text=" + encodeURIComponent(texto), "_blank", "noopener");
      return;
    }

    var nombre = (esRemito() ? "Remito " : "Presupuesto ") +
      String(estado.cliente || "Maderas Victoria").trim() +
      " " + String(estado.fecha || "").replace(/-/g, "") + ".pdf";
    nombre = nombre.replace(/[\\/:*?"<>|]/g, "-");
    var blob = doc.output("blob");

    /* Sin teléfono no hay chat al que ir: se abre la hoja de compartir para
     * que al menos pueda elegir el contacto a mano. */
    if (!tel) {
      var archivo = null;
      try { archivo = new File([blob], nombre, { type: "application/pdf" }); } catch (e) { archivo = null; }
      if (archivo && navigator.canShare && navigator.canShare({ files: [archivo] })) {
        try {
          navigator.share({ files: [archivo], title: nombre }).catch(function () {});
          return;
        } catch (e) { /* sigue por la descarga */ }
      }
      bajarArchivo(blob, nombre);
      avisar("Sin teléfono del cliente: ponelo arriba para abrir su chat");
      return;
    }

    /* Caso normal: se baja el PDF y se abre el chat de ESE número. */
    bajarArchivo(blob, nombre);
    avisar("PDF descargado: adjuntalo en el chat que se abrió");
    window.open("https://wa.me/" + tel + "?text=" + encodeURIComponent(mensajeConPdf()), "_blank", "noopener");
  }

  function nuevo() {
    if (!confirm("¿Empezar un presupuesto nuevo? Se borra el actual de este equipo.")) return;
    /* Nuevo documento de presupuesto para no pisar a los otros dispositivos */
    presupuestoActivo = "pres_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
    try {
      localStorage.setItem(CLAVE_PRESUPUESTO_ACTIVO, presupuestoActivo);
    } catch (e) {}
    if (usaFirebase && usuarioActual) {
      cerrarSuscripciones();
      escucharPresupuesto();
      escucharVentasYGastos();
    }
    estado.numero = null;
    estado.numeroRemito = null;
    estado.cliente = "";
    estado.direccion = "";
    estado.telefono = "";
    estado.cuit = "";
    estado.localidad = "";
    estado.provincia = "";
    estado.condicionIva = "";
    estado.fecha = hoyISO();
    estado.tipo = "PRESUPUESTO";
    estado.lineas = [nuevaLinea()];
    pintarTodo();
    guardar(true);
    contadorPresupuesto.reservar(function (n) {
      if (estado.numero) return;
      estado.numero = n;
      guardar(true);
    });
    avisar("Presupuesto nuevo");
  }

  /* ================= PRODUCTOS ================= */

  var elProdLista = $("#productos-lista");
  var elProdResumen = $("#productos-resumen");
  var elProdComparar = $("#productos-comparar");
  var elExcelInput = $("#productos-excel");
  var elVentasExcelInput = $("#ventas-excel");
  var elBalanceExcelInput = $("#balance-excel");
  var elModalExcel = $("#modal-excel");
  var elExcelCambios = $("#excel-cambios");
  var elExcelResumen = $("#excel-resumen");
  var elExcelError = $("#excel-error");
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
  var elBalanceMesSel = $("#balance-mes-sel");
  var elBalanceAnio = $("#balance-anio");
  var elBalanceSemana = $("#balance-semana");
  var elBalanceQuitar = $("#balance-quitar");
  var elBalanceExportar = $("#balance-exportar");
  var elBalanceBorrar = $("#balance-borrar");
  var elBalanceAplicar = $("#balance-aplicar");
  var elEditarBalance = $("#modal-editar-balance");
  var elEditarBalanceFecha = $("#editar-balance-fecha");
  var elEditarBalanceFechaTexto = $("#editar-balance-fecha-texto");
  var elEditarBalanceVentas = $("#editar-balance-ventas");
  var elEditarBalanceGastos = $("#editar-balance-gastos");
  var elEditarBalanceImpuestos = $("#editar-balance-impuestos");
  var elEditarBalanceSueldos = $("#editar-balance-sueldos");
  var elEditarBalanceProveedores = $("#editar-balance-proveedores");
  var elEditarBalanceError = $("#editar-balance-error");
  var elEditarBalanceGuardar = $("#editar-balance-guardar");
  var elEditarBalanceCancelar = $("#editar-balance-cancelar");
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

  /* ---------- comparar con el excel ---------- */

  var revisionExcel = [];

  /* La planilla es la fuente original (catalogo.js se genero de la hoja
   * PRECIOS). Suben el .xlsx actualizado, la app compara contra el
   * catalogo y propone cada cambio para aceptar o denegar uno por uno.
   * Solo se aplica lo aceptado; denegar conserva el producto como viene. */

  function pintarRevision() {
    var hechas = revisionExcel.filter(function (c) { return c.estado; }).length;
    elExcelResumen.innerHTML = revisionExcel.length
      ? "<strong>" + hechas + " de " + revisionExcel.length + "</strong> cambios revisados"
      : "";

    var porProducto = {};
    revisionExcel.forEach(function (c, i) {
      (porProducto[c.nombre] || (porProducto[c.nombre] = [])).push(i);
    });

    var html = "";
    Object.keys(porProducto).forEach(function (nombre) {
      html += '<div class="excel-item"><div class="excel-item__prod">' + escapar(nombre) + "</div>";
      porProducto[nombre].forEach(function (i) {
        var c = revisionExcel[i];
        html += '<div class="excel-cambio" data-idx="' + i + '">' +
          '<span class="excel-cambio__campo">' + escapar(c.campo) + "</span>" +
          '<span class="excel-cambio__valores">' + escapar(c.de) + " → " + escapar(c.a) + "</span>";
        if (c.propio && c.campo === "precio") {
          html += '<span class="excel-cambio__nota">tenía precio propio en la app</span>';
        }
        if (c.estado) {
          html += '<span class="excel-cambio__estado' + (c.estado === "ok" ? " excel-cambio__estado--ok" : "") + '">' +
            (c.estado === "ok" ? "aceptado ✓" : "denegado ✕") + "</span>";
        } else {
          html += '<button type="button" class="btn btn--mini" data-decision="ok">Aceptar</button>' +
            '<button type="button" class="btn btn--mini" data-decision="no">Denegar</button>';
        }
        html += "</div>";
      });
      html += "</div>";
    });
    elExcelCambios.innerHTML = html;

    /* Los botones masivos solo sirven si hay algo pendiente por decidir. */
    var hayPendientes = revisionExcel.some(function (c) { return !c.estado; });
    $("#excel-aceptar-todo").hidden = !hayPendientes;
    $("#excel-denegar-todo").hidden = !hayPendientes;
    $("#excel-aceptar-pendientes").hidden = !hayPendientes;
    $("#excel-denegar-pendientes").hidden = !hayPendientes;
  }

  function aplicarCambio(c) {
    /* ---------- ventas desde Excel ---------- */
    if (c._origen === "ventas") {
      if (c.tipo === "nuevo") {
        guardarVenta({
          fecha: c.venta.fecha,
          monto: c.venta.monto,
          medioPago: c.venta.medioPago,
          detalle: c.venta.detalle,
        });
      } else if (c.tipo === "campo" && c.campo === "monto") {
        var v = ventas.find(function (x) {
          return x.fecha === c.fecha && PRODUCTOS.clave(x.detalle || "") === PRODUCTOS.clave(c.detalle);
        });
        /* Va por editarVenta: si solo se cambiaba el objeto local, el
         * listener de Firestore lo pisaba con el valor viejo de la nube y el
         * cambio no quedaba. */
        if (v) editarVenta(v.id, { monto: c.valores.a });
      }
      pintarVentas();
      pintarBalance();
      return;
    }

    /* ---------- balance desde Excel ---------- */
    if (c._origen === "balance") {
      if (c.tipo === "campo" && (c.campo === "ventas" || c.campo === "gastos" || c.campo === "impuestos" || c.campo === "sueldos" || c.campo === "proveedores")) {
        aplicarBalanceCampo(c, c.campo);
      }
      pintarVentas();
      pintarBalance();
      return;
    }

    /* ---------- catalogo de productos (original) ---------- */
    if (c.tipo === "nuevo") {
      catalogo.push({
        nombre: c.producto.nombre,
        unidad: c.producto.unidad,
        precio: c.producto.precio,
        pideLargo: c.producto.pideLargo,
        stock: c.producto.stock,
        activo: true,
        propio: false,
        origen: "planilla",
      });
    } else if (c.tipo === "fuera") {
      catalogo = PRODUCTOS.baja(catalogo, c.actual.nombre);
    } else {
      var actual = PRODUCTOS.buscar(catalogo, c.nombre);
      if (!actual) return;
      if (c.campo === "precio") {
        actual.precio = c.valores.a;
        actual.propio = false;
      } else if (c.campo === "unidad") {
        actual.unidad = c.valores.a;
      } else if (c.campo === "pideLargo") {
        actual.pideLargo = c.valores.a;
      } else if (c.campo === "stock") {
        actual.stock = c.valores.a;
      }
    }
    guardarCatalogo();
    crearMotor();
    refrescarSelects();
    pintarProductos();
  }

  /* Deja el TOTAL del día (o de la categoría) en `valor` sin tocar nada de lo
   * cargado a mano. Suma los registros reales y ajusta un único registro de
   * resumen por día y categoría.
   *
   * Antes se editaba el primer registro del día para llegar al total. Eso
   * rompía el detalle: al comparar después la planilla de ventas, ese mismo
   * registro no coincidía con el Excel y se cambiaba de vuelta, así que las
   * dos comparaciones se peleaban en un bucle y nunca quedaba nada. */
  function aplicarBalanceCampo(c, campo) {
    var fecha = c.fecha;
    var valor = typeof c.valores.a === "number" ? c.valores.a : 0;

    if (campo === "ventas") {
      ajustarResumenDia("ventas", fecha, "Ventas " + fecha, null, valor);
      return;
    }

    /* Gastos por categoría: gastos=Otros, impuestos, sueldos, proveedores */
    var categoriaMap = {
      "gastos": "Otros",
      "impuestos": "Impuestos",
      "sueldos": "Sueldos",
      "proveedores": "Proveedores"
    };
    var categoria = categoriaMap[campo] || "Otros";
    ajustarResumenDia("gastos", fecha, categoria + " " + fecha, categoria, valor);
  }

  function sinAcentosMin(v) {
    return PRODUCTOS.sinAcentos(String(v || "").toLowerCase()).trim();
  }

  /* Calcula lo cargado a mano para ese día (sin el registro de resumen) y
   * deja el resumen con la diferencia. Si la diferencia es cero, anula el
   * resumen. Nunca toca los registros reales. */
  function ajustarResumenDia(tipo, fecha, nombreResumen, categoria, valor) {
    var esVenta = tipo === "ventas";
    var lista = esVenta ? ventas : gastos;
    var claveResumen = PRODUCTOS.clave(nombreResumen);
    var cat = sinAcentosMin(categoria);
    var resumenes = [];
    var cargado = 0;

    lista.forEach(function (r) {
      if (r.anulada || r.fecha !== fecha) return;
      if (!esVenta && sinAcentosMin(r.categoria) !== cat) return;
      var nombre = esVenta ? (r.detalle || "") : (r.concepto || "");
      if (PRODUCTOS.clave(nombre) === claveResumen) {
        resumenes.push(r);
        return;
      }
      cargado += Number(r.monto) || 0;
    });

    var diferencia = Math.round((valor - cargado) * 100) / 100;
    var motivo = "Ajustado al total del Excel";

    /* Si quedaron resumenes repetidos de importaciones viejas, se anulan
     * todos menos uno: si no, el sobrante se sumaria como si fuera detalle. */
    for (var k = 1; k < resumenes.length; k++) {
      if (esVenta) anularVenta(resumenes[k].id, motivo);
      else anularGasto(resumenes[k].id, motivo);
      resumenes[k].anulada = true;
      resumenes[k].motivoAnulacion = motivo;
    }
    var resumen = resumenes.length ? resumenes[0] : null;

    if (resumen) {
      if (Math.abs(diferencia) < 0.005) {
        if (!resumen.anulada) {
          if (esVenta) anularVenta(resumen.id, motivo);
          else anularGasto(resumen.id, motivo);
          resumen.anulada = true;
          resumen.motivoAnulacion = motivo;
        }
      } else if (esVenta) {
        editarVenta(resumen.id, { monto: diferencia, anulada: false });
      } else {
        editarGasto(resumen.id, { monto: diferencia, anulada: false });
      }
      return;
    }

    if (Math.abs(diferencia) < 0.005) return;

    if (esVenta) {
      guardarVenta({ fecha: fecha, monto: diferencia, medioPago: "Efectivo", detalle: nombreResumen });
    } else {
      guardarGasto({ fecha: fecha, monto: diferencia, concepto: nombreResumen, categoria: categoria });
    }
  }

  function decidir(i, decision) {
    var c = revisionExcel[i];
    if (!c || c.estado) return;
    if (decision === "ok") {
      aplicarCambio(c);
    }
    c.estado = decision === "ok" ? "ok" : "no";
    pintarRevision();

    var pendientes = revisionExcel.some(function (x) { return !x.estado; });
    if (!pendientes) {
      var aplicados = revisionExcel.filter(function (x) { return x.estado === "ok"; }).length;
      var denegados = revisionExcel.length - aplicados;
      elModalExcel.hidden = true;
      revisionExcel = [];
      avisar("Revisión lista: " + aplicados + " aplicados, " + denegados + " denegados");
    }
  }

  function cerrarExcel() {
    var pendientes = revisionExcel.filter(function (c) { return !c.estado; }).length;
    if (pendientes && !confirm("Quedan " + pendientes + " cambios sin revisar: se conservan sin aplicar. ¿Cerrar igual?")) {
      return;
    }
    revisionExcel = [];
    elModalExcel.hidden = true;
  }

  /* Aplica una decisión (ok / no) a todos los cambios que aún no tienen
   * estado. Aceptar llama a aplicarCambio; denegar solo lo marca. Cierra el
   * modal al terminar y avisa el resumen. */
  function aplicarMasivo(decision) {
    var pendientes = revisionExcel.filter(function (c) { return !c.estado; });
    if (!pendientes.length) return;
    pendientes.forEach(function (c) {
      if (decision === "ok") aplicarCambio(c);
      c.estado = decision === "ok" ? "ok" : "no";
    });
    pintarRevision();
    elModalExcel.hidden = true;
    var total = revisionExcel.length;
    var aplicados = revisionExcel.filter(function (x) { return x.estado === "ok"; }).length;
    var denegados = total - aplicados;
    revisionExcel = [];
    avisar("Revisión lista: " + aplicados + " aplicados, " + denegados + " denegados");
  }

  /* origen: "productos" | "ventas" | "balance" */
  function abrirExcel(archivo, origen) {
    if (!archivo) return;
    if (typeof XLSX === "undefined") {
      avisar("No se pudo cargar el lector de Excel. Revisá la conexión a internet y recargá.");
      return;
    }
    var lector = new FileReader();
    lector.onload = function () {
      try {
        var hojas = XLSX.read(lector.result, { type: "array" });
        var nombreHoja;
        if (origen === "ventas") {
          nombreHoja = hojas.SheetNames.indexOf("VENTAS DIARIAS") !== -1 ? "VENTAS DIARIAS" : hojas.SheetNames[0];
        } else if (origen === "balance") {
          nombreHoja = hojas.SheetNames.indexOf("BALANCE") !== -1 ? "BALANCE" : hojas.SheetNames[0];
        } else {
          nombreHoja = hojas.SheetNames.indexOf("PRECIOS") !== -1 ? "PRECIOS" : hojas.SheetNames[0];
        }
        console.log("Excel subido: hoja elegida =", nombreHoja, "· hojas =", hojas.SheetNames.join(", "));
        var filas = XLSX.utils.sheet_to_json(hojas.Sheets[nombreHoja], { header: 1, defval: null });
        var r;
        var tituloHoja;
        if (origen === "ventas") {
          r = TV_PLANILLA_VENTAS.revisar(filas, ventas, numeroCorto);
          tituloHoja = "VENTAS DIARIAS";
        } else if (origen === "balance") {
          r = TV_PLANILLA_BALANCE.revisar(filas, ventas, gastos, numeroCorto);
          tituloHoja = "BALANCE";
        } else {
          origen = "productos";
          r = PLANILLA.revisar(filas, catalogo, numeroCorto);
          tituloHoja = "PRECIOS";
        }
        /* Marca cada propuesta con su origen para aplicarCambio */
        r.cambios.forEach(function (c) { c._origen = origen; });
        revisionExcel = r.cambios;
        elModalExcel.hidden = false;
        elExcelError.hidden = true;
        pintarRevision();
        if (r.sinEncabezado) {
          revisionExcel = [];
          elExcelError.hidden = false;
          elExcelError.textContent = "No encontré las columnas esperadas en la hoja \"" + nombreHoja + "\". Probá con Ingresos Y Gastos Semanales (hoja " + tituloHoja + ").";
        } else if (revisionExcel.length === 0) {
          elExcelError.hidden = false;
          elExcelError.textContent = "El Excel coincide: no hay cambios para revisar.";
        } else if (r.ignoradas.length) {
          elExcelError.hidden = false;
          elExcelError.textContent = "Filas ignoradas (datos incompletos): " + r.ignoradas.join(", ");
        }
      } catch (e) {
        console.error("Lectura del Excel:", e);
        avisar("El archivo no se pudo leer como Excel (" + (e && e.message ? e.message : "abre la consola F12 e informame") + ")");
      }
    };
    lector.readAsArrayBuffer(archivo);
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
  /* La matematica del balance vive en js/balance.js (probada en
   * tests/balance.test.mjs). Aca solo se le pasan los datos. */
  function construirBalance(desde, hasta) {
    return TV_BALANCE.construir(ventas, gastos, desde, hasta);
  }

  var MESES_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
                  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  /* Rango del mes elegido en el select de mes y el campo de año.
   * Año inválido o incompleto: usa el año en curso. */
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  function rangoDeSeleccion() {
    var hoy = new Date();
    var mes = elBalanceMesSel && elBalanceMesSel.value >= 1 && elBalanceMesSel.value <= 12
      ? Number(elBalanceMesSel.value)
      : hoy.getMonth() + 1;
    var anioCrudo = elBalanceAnio ? Number(elBalanceAnio.value) : 0;
    var anio = (anioCrudo >= 1000 && anioCrudo <= 9999) ? anioCrudo : hoy.getFullYear();
    var ultimoDia = new Date(anio, mes, 0).getDate();
    return {
      desde: anio + "-" + pad2(mes) + "-01",
      hasta: anio + "-" + pad2(mes) + "-" + pad2(ultimoDia),
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
      '<th>Editar</th>' +
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
      (l.tipo === "dia"
        ? '<td class="accion"><button type="button" class="btn btn--ghost btn-editar-balance" data-fecha="' + escapar(l.fecha) + '" title="Editar fila">✏</button></td>'
        : '<td></td>') +
      "</tr>";
  }

  function fechaCorta(f) {
    var p = f.split("-");
    return Number(p[2]) + "/" + Number(p[1]);
  }

  /* Recarga las opciones del selector de semana según el mes elegido,
   * conservando la elección si sigue existiendo. */
  function refrescarOpcionesSemana(b) {
    if (!elBalanceSemana) return;
    var previo = elBalanceSemana.value;
    var html = '<option value="">Todo el mes</option>';
    (b.bloques || []).forEach(function (bloq, i) {
      var dias = bloq.filter(function (l) { return l.tipo === "dia"; });
      var a = dias.length ? fechaCorta(dias[0].fecha) : "";
      var z = dias.length ? fechaCorta(dias[dias.length - 1].fecha) : "";
      html += '<option value="' + i + '">Semana ' + (i + 1) + " · " + a + " al " + z + "</option>";
    });
    elBalanceSemana.innerHTML = html;
    var existe = Array.prototype.some.call(elBalanceSemana.options, function (o) {
      return o.value === previo;
    });
    elBalanceSemana.value = existe ? previo : "";
  }

  /* Lo que la tabla muestra ahora: lo manda igual al CSV de exportación. */
  var balanceVisibles = [];

  function pintarBalance() {
    if (!elBalanceTabla) return;

    var r = rangoDeSeleccion();
    var desde = r.desde;
    var hasta = r.hasta;

    var b = construirBalance(desde, hasta);
    refrescarOpcionesSemana(b);

    /* Filtro de semana: arriba la elegida y abajo le sigue la próxima */
    var visibles = b.lineas;
    var etiquetaSemana = "";
    var sel = elBalanceSemana ? elBalanceSemana.value : "";
    if (sel !== "" && b.bloques && b.bloques.length) {
      var n = Number(sel);
      var v = [];
      if (b.bloques[n]) v = v.concat(b.bloques[n]);
      if (b.bloques[n + 1]) v = v.concat(b.bloques[n + 1]);
      if (v.length) {
        visibles = v;
        etiquetaSemana = b.bloques[n + 1]
          ? " · Semanas " + (n + 1) + " y " + (n + 2)
          : " · Semana " + (n + 1) + " (última del mes)";
      }
    }
    balanceVisibles = visibles;

    var titulo = MESES_ES[Number(desde.split("-")[1]) - 1] + " " + desde.split("-")[0] + etiquetaSemana;

    if (!visibles.length) {
      elBalanceTabla.innerHTML = '<p class="prod-vacio">Sin movimientos este mes.</p>';
      elBalanceResumen.textContent = titulo;
      if (elBalanceExportar) elBalanceExportar.hidden = true;
      return;
    }

    elBalanceTabla.innerHTML =
      '<div class="tabla-scroll"><table class="tabla-balance"><caption>' + escapar(titulo) + "</caption>" + cabeceraBalance() +
      "<tbody>" + visibles.map(function (l) { return filaBalanceHTML(l, true); }).join("") + "</tbody></table></div>";

    /* Totales de la vista: suma de los Total Semanal visibles */
    var ingresos = 0;
    var egresos = 0;
    visibles.forEach(function (l) {
      if (l.tipo === "semana") {
        ingresos += l.ingresos;
        egresos += l.egresos;
      }
    });
    var final = visibles[visibles.length - 1];
    if (final.tipo === "mes" || final.tipo === "total") {
      ingresos = final.ingresos;
      egresos = final.egresos;
    }

    elBalanceResumen.innerHTML =
      "<span>" + escapar(titulo) + "</span>" +
      '<i aria-hidden="true">·</i><span>Ingresos: ' + numeroCorto(ingresos) + "</span>" +
      '<i aria-hidden="true">·</i><span>Egresos: ' + numeroCorto(egresos) + "</span>" +
      '<i aria-hidden="true">·</i><span>Resultado: ' + numeroCorto(ingresos - egresos) + "</span>";
    if (elBalanceExportar) elBalanceExportar.hidden = false;
  }

  /* Exporta al CSV exactamente lo que muestra la tabla en pantalla. */
  function exportarBalance(desde, hasta) {
    if (!balanceVisibles.length) return;
    var filas = ["Fecha,Dia,Ventas,Gastos,Impuestos,Sueldos,Proveedores,Total Ingresos,Total Egresos,Resultado Neto"];
    balanceVisibles.forEach(function (l) {
      var enBlanco = l.tipo === "dia";
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

    $("#productos-restablecer").addEventListener("click", function () {
      var primera = window.confirm("Esto borra TODOS los productos agregados o editados en este equipo y vuelve al catálogo del Excel. ¿Seguro?");
      if (!primera) return;
      var segunda = window.confirm("Confirmación final: el catálogo queda igual a la planilla. ¿Restablecer?");
      if (!segunda) return;
      catalogo = [];
      CAT.productos.forEach(function (p) {
        catalogo.push(Object.assign({}, p, { activo: true }));
      });
      guardarCatalogo();
      crearMotor();
      refrescarSelects();
      pintarProductos();
      avisar("Catálogo restablecido al Excel");
    });

    elProdComparar.addEventListener("click", function () {
      elExcelInput.value = "";
      elExcelInput.click();
    });

    elExcelInput.addEventListener("change", function () {
      abrirExcel(this.files && this.files[0], "productos");
    });

    elVentasExcelInput = $("#ventas-excel");
    elBalanceExcelInput = $("#balance-excel");

    $("#ventas-comparar").addEventListener("click", function () {
      elVentasExcelInput.value = "";
      elVentasExcelInput.click();
    });
    elVentasExcelInput.addEventListener("change", function () {
      abrirExcel(this.files && this.files[0], "ventas");
    });

    var btnDuplicadas = $("#ventas-duplicadas");
    if (btnDuplicadas) {
      btnDuplicadas.addEventListener("click", revisarDuplicados);
    }
    var btnDuplicadasBalance = $("#balance-duplicadas");
    if (btnDuplicadasBalance) {
      btnDuplicadasBalance.addEventListener("click", revisarDuplicados);
    }

    $("#balance-comparar").addEventListener("click", function () {
      elBalanceExcelInput.value = "";
      elBalanceExcelInput.click();
    });
    elBalanceExcelInput.addEventListener("change", function () {
      abrirExcel(this.files && this.files[0], "balance");
    });

    elExcelCambios.addEventListener("click", function (ev) {
      var caja = ev.target.closest(".excel-cambio");
      var d = ev.target.closest("[data-decision]");
      if (!caja || !d) return;
      decidir(Number(caja.dataset.idx), d.dataset.decision);
    });

    $("#excel-cancelar").addEventListener("click", cerrarExcel);

    $("#excel-aceptar-todo").addEventListener("click", function () { aplicarMasivo("ok"); });
    $("#excel-denegar-todo").addEventListener("click", function () { aplicarMasivo("no"); });
    $("#excel-aceptar-pendientes").addEventListener("click", function () { aplicarMasivo("ok"); });
    $("#excel-denegar-pendientes").addEventListener("click", function () { aplicarMasivo("no"); });

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

    var elVentasBorrarOpcion = $("#ventas-borrar-opcion");
    var elVentasBorrar = $("#ventas-borrar");

    elVentasBorrarOpcion.addEventListener("change", function () {
      elVentasBorrar.style.display = elVentasBorrarOpcion.value ? "inline-block" : "none";
    });

    elVentasBorrar.addEventListener("click", function () {
      var opcion = elVentasBorrarOpcion.value;
      if (!opcion) return;
      borrarDatos(opcion);
      elVentasBorrarOpcion.value = "";
      elVentasBorrar.style.display = "none";
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
    if (!elBalanceMesSel) return;

    elBalanceMesSel.addEventListener("change", function () {
      pintarBalance();
    });

    elBalanceSemana.addEventListener("change", function () {
      pintarBalance();
    });

    elBalanceAnio.addEventListener("change", function () {
      pintarBalance();
    });
    elBalanceAnio.addEventListener("input", function () {
      pintarBalance();
    });

    elBalanceAplicar.addEventListener("click", function () {
      pintarBalance();
      avisar("Balance aplicado: " + MESES_ES[Number(elBalanceMesSel.value) - 1] + " " + elBalanceAnio.value);
    });

    elBalanceQuitar.addEventListener("click", function () {
      elBalanceSemana.value = "";
      elBalanceMesSel.value = String(new Date().getMonth() + 1);
      elBalanceAnio.value = String(new Date().getFullYear());
      pintarBalance();
      avisar("Filtro restablecido: mes en curso completo");
    });

    /* Valores por defecto: mes y año en curso, editables */
    if (!elBalanceMesSel.value) elBalanceMesSel.value = String(new Date().getMonth() + 1);
    if (!elBalanceAnio.value) elBalanceAnio.value = String(new Date().getFullYear());

    elBalanceExportar.addEventListener("click", function () {
      var r = rangoDeSeleccion();
      exportarBalance(r.desde, r.hasta);
    });

    elBalanceBorrar.addEventListener("click", function () {
      borrarDatos("solo-gastos");
    });

    /* ---------- editar fila de balance (lapicito) ---------- */
    elBalanceTabla.addEventListener("click", function (ev) {
      var btn = ev.target.closest(".btn-editar-balance");
      if (!btn) return;
      var fecha = btn.dataset.fecha;
      if (!fecha) return;
      var dia = TV_BALANCE.dia(ventas, gastos, fecha);
      elEditarBalanceFecha.value = fecha;
      elEditarBalanceFechaTexto.textContent = fecha + " · " + dia.etiqueta;
      elEditarBalanceVentas.value = dia.ventas === 0 ? "" : numeroCorto(dia.ventas);
      elEditarBalanceGastos.value = dia.gastos === 0 ? "" : numeroCorto(dia.gastos);
      elEditarBalanceImpuestos.value = dia.impuestos === 0 ? "" : numeroCorto(dia.impuestos);
      elEditarBalanceSueldos.value = dia.sueldos === 0 ? "" : numeroCorto(dia.sueldos);
      elEditarBalanceProveedores.value = dia.proveedores === 0 ? "" : numeroCorto(dia.proveedores);
      elEditarBalanceError.hidden = true;
      elEditarBalance.hidden = false;
    });

    elEditarBalanceCancelar.addEventListener("click", function () {
      elEditarBalance.hidden = true;
    });

    elEditarBalanceGuardar.addEventListener("click", function () {
      var fecha = elEditarBalanceFecha.value;
      if (!fecha) return;
      var parse = function (el) {
        var v = TV.parseNumero(el.value);
        return typeof v === "number" ? v : 0;
      };
      aplicarEdicionFilaBalance(fecha, {
        ventas: parse(elEditarBalanceVentas),
        gastos: parse(elEditarBalanceGastos),
        impuestos: parse(elEditarBalanceImpuestos),
        sueldos: parse(elEditarBalanceSueldos),
        proveedores: parse(elEditarBalanceProveedores),
      });
      elEditarBalance.hidden = true;
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
    presupuestoActivoId();
    var cambios = cargarCatalogo();

    var habia = cargar();
    if (!estado.lineas.length) estado.lineas = [nuevaLinea()];
    if (!estado.fecha) estado.fecha = hoyISO();
    /* Un presupuesto guardado antes de la numeracion automatica no tiene
     * numero: se le asigna uno al abrirlo. */
    if (!estado.numero) {
      contadorPresupuesto.reservar(function (n) {
        if (estado.numero) return;
        estado.numero = n;
        guardar(true);
      });
    }
    /* Un remito guardado antes de la numeracion propia ya trae su tipo. */
    if (esRemito() && !estado.numeroRemito && !reservandoRemito) {
      reservandoRemito = true;
      contadorRemito.reservar(function (n) {
        reservandoRemito = false;
        if (estado.numeroRemito) return;
        estado.numeroRemito = n;
        guardar(true);
      });
    }

    enlazarCabecera();
    pintarTodo();

    if ($("#print-tel")) {
      var tel = CAT.negocio.telefonos.join(" · ");
      $("#print-tel").textContent = "Tel. " + tel;
      $("#print-tel-2").textContent = "Tel. " + tel;
    }

    $("#agregar").addEventListener("click", agregarLinea);
    $("#imprimir").addEventListener("click", function () { window.print(); });
    $("#whatsapp").addEventListener("click", enviarPresupuesto);
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

    /* Muestra qué documento de presupuesto está usando este dispositivo */
    var badge = $("#presupuesto-badge");
    if (!badge) {
      badge = document.createElement("span");
      badge.id = "presupuesto-badge";
      badge.style.cssText = "font-size:11px;color:var(--tinta-2);margin-left:10px;border:1px solid var(--tinta-2);padding:2px 6px;border-radius:4px;display:inline-block;vertical-align:middle;";
      var head = $(".print-head__datos");
      if (head) head.appendChild(badge);
    }
    badge.textContent = "Presupuesto · " + presupuestoActivoId().replace("pres_", "");

    mostrarVista("presupuesto");
  }

  /* 24 horas en milisegundos. Pasado este tiempo desde el último login, la
   * sesión se considera expirada y hay que volverse a loguear. */
  var SESION_EXPIRACION_MS = 24 * 60 * 60 * 1000;
  var CLAVE_SESION_INICIO = "tiovity.sesion-inicio";

  function sesionValida() {
    var inicio = localStorage.getItem(CLAVE_SESION_INICIO);
    if (!inicio) return false;
    return Date.now() - Number(inicio) < SESION_EXPIRACION_MS;
  }

  function iniciar() {
    if (usaFirebase) {
      /* Si ya hay sesión guardada (sobrevive al reinicio de la PC), entrar
       * directo sin parpadear el login. auth.currentUser cubre file://, donde
       * onAuthStateChanged no dispara confiablemente; el listener cubre el
       * logout desde otra pestaña. */
      var user = auth.currentUser;
      if (user) {
        if (!sesionValida()) {
          /* Sesión expirada por tiempo: cierra la sesión de Firebase y
           * obliga a volver a loguearse. */
          auth.signOut().catch(function () {});
          localStorage.removeItem(CLAVE_SESION_INICIO);
          usuarioActual = null;
          cerrarSuscripciones();
          mostrarLogin();
          avisar("Tu sesión expiró (pasaron más de 24 horas). Volvé a ingresar.");
          return;
        }
        entrarConSesion(user);
      } else {
        mostrarLogin();
        auth.onAuthStateChanged(function (user) {
          if (user) {
            /* Con un login manual en curso este aviso puede llegar antes de
             * que la marca de sesión se escriba: no es una sesión vieja. */
            if (!sesionValida() && !loginEnCurso) {
              auth.signOut().catch(function () {});
              localStorage.removeItem(CLAVE_SESION_INICIO);
              usuarioActual = null;
              cerrarSuscripciones();
              mostrarLogin();
              avisar("Tu sesión expiró (pasaron más de 24 horas). Volvé a ingresar.");
              return;
            }
            entrarConSesion(user);
          } else {
            /* Mientras se está logueando, un "sin usuario" transitorio no
             * debe devolvernos al login. */
            if (loginEnCurso) return;
            usuarioActual = null;
            cerrarSuscripciones();
            mostrarLogin();
          }
        });
      }
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
    var estabaEnLogin = !$("#view-login").classList.contains("is-hidden");
    /* Listeners primero: si algo falla al enlazar la UI, las ventas
     * quedan sincronizadas igual. Los flags evitan duplicados. */
    escucharPresupuesto();
    escucharVentasYGastos();
    escucharCatalogo();
    if (!appIniciada) {
      appIniciada = true;
      iniciarApp();
    }
    /* Si la pantalla quedo en el login (el aviso de Firebase llego despues
     * de que se armo todo), igual se entra al presupuesto. */
    if (estabaEnLogin) mostrarVista("presupuesto");
  }

  function enlazarCerrarSesion() {
    var btn = $("#cerrar-sesion");
    if (!btn) return;
    btn.hidden = !usuarioActual;
    btn.addEventListener("click", function () {
      if (!usuarioActual) return;
      auth.signOut().then(function () {
        localStorage.removeItem(CLAVE_SESION_INICIO);
      }).catch(function (err) {
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

    /* La marca de sesión se escribe ANTES de pedir el login: el aviso de
     * Firebase puede llegar antes que esta promesa y, sin la marca, tomaría
     * el ingreso como una sesión vencida. */
    loginEnCurso = true;
    try {
      localStorage.setItem(CLAVE_SESION_INICIO, String(Date.now()));
    } catch (e) {}

    auth.signInWithEmailAndPassword(email, password).then(function (cred) {
      loginEnCurso = false;
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
      loginEnCurso = false;
      /* El intento falló: se descarta la marca para no dejar una sesión
       * abierta que no existe. */
      try {
        localStorage.removeItem(CLAVE_SESION_INICIO);
      } catch (e) {}
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

