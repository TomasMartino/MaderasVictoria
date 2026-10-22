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
    else guardarTimer = setTimeout(escribir, 350);
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
    if (!usaFirebase || !usuarioActual) return;
    db.collection("presupuestos").doc("compartido").onSnapshot(function (doc) {
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
    var url = "https://wa.me/?text=" + encodeURIComponent(textoWhatsApp());
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
    elProdLista.innerHTML = visibles.length
      ? visibles.map(filaProductoHTML).join("")
      : '<p class="prod-vacio">No hay productos que coincidan.</p>';
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

    $("#productos-planilla").addEventListener("click", function () {
      var r = PRODUCTOS.fusionar(CAT.productos, catalogo);
      catalogo = r.productos;
      guardarCatalogo();
      refrescarCatalogo();
      elProdReporte.hidden = false;
      elProdReporte.textContent = reporteCambios(r.cambios);
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
      });
    });

    enlazarProductos();
    pintarProductos();
    enlazarCerrarSesion();

    if (cambios) {
      elProdReporte.hidden = false;
      elProdReporte.textContent = reporteCambios(cambios);
    }

    if (habia) avisar("Se recuperó el presupuesto de este equipo");
    mostrarVista("presupuesto");
  }

  function iniciar() {
    if (usaFirebase) {
      auth.onAuthStateChanged(function (user) {
        usuarioActual = user;
        var btn = $("#cerrar-sesion");
        if (btn) btn.hidden = !user;
        if (user) {
          iniciarApp();
          escucharPresupuesto();
        } else {
          mostrarLogin();
        }
      });
      return;
    }
    iniciarApp();
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
    $("#form-login").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var email = $("#login-email").value;
      var password = $("#login-password").value;
      $("#login-errores").hidden = true;
      auth.signInWithEmailAndPassword(email, password).catch(function (err) {
        $("#login-errores").hidden = false;
        $("#login-errores").textContent = err.message || "No se pudo iniciar sesión.";
      });
    });
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();

