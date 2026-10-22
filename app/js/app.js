/* Pantalla del presupuesto.
 * Script clasico: abre con doble clic, sin servidor y sin compilar.
 * Toda la cuenta vive en engine.js; aca solo se dibuja y se guarda.
 */
(function () {
  "use strict";

  var CAT = window.TV_CATALOGO;
  var TV = window.TV;
  /* Toda la cuenta pasa por esta calculadora: ella sabe traducir el nombre
   * del producto que guarda la pantalla al producto del catalogo. */
  var CALC = TV.crearCalculadora(CAT);
  var PASO = CALC.paso;
  var CLAVE = "tiovity.presupuesto.v1";
  var ORDEN_UNIDADES = ["METRO LINEAL", "UNIDAD", "METRO 2", "UNIDAD/M2"];

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };

  var elLineas = $("#lineas");
  var elTotal = $("#total");
  var elTotalBar = $("#total-bar");
  var elAviso = $("#aviso");
  var elToast = $("#toast");
  var elEstado = $("#estado-texto");
  var elDot = $("#estado-dot");
  var elFecha = $("#fecha");

  var POR_NOMBRE = {};
  CAT.productos.forEach(function (p) { POR_NOMBRE[p.n] = p; });
  /* POR_NOMBRE queda solo para pintar el catalogo; las cuentas usan CALC. */

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

  /* ---------- catalogo en el desplegable ---------- */

  function agrupar() {
    var grupos = {};
    CAT.productos.forEach(function (p) {
      (grupos[p.u] = grupos[p.u] || []).push(p);
    });
    var orden = ORDEN_UNIDADES.filter(function (u) { return grupos[u]; });
    Object.keys(grupos).forEach(function (u) {
      if (orden.indexOf(u) === -1) orden.push(u);
    });
    return orden.map(function (u) {
      return { unidad: u, productos: grupos[u] };
    });
  }

  function etiquetaProducto(p) {
    if (p.p === null) return p.n + " · sin precio";
    var sufijo = p.l ? "/m" : p.u === "METRO 2" ? "/m²" : "";
    return p.n + " · " + TV.pesos(p.p) + sufijo;
  }

  var OPCIONES_HTML = (function () {
    var html = '<option value="">Elegí un producto…</option>';
    agrupar().forEach(function (g) {
      html += '<optgroup label="' + g.unidad + '">';
      g.productos.forEach(function (p) {
        html += '<option value="' + escapar(p.n) + '">' + escapar(etiquetaProducto(p)) + "</option>";
      });
      html += "</optgroup>";
    });
    return html;
  })();

  function escapar(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------- estado ---------- */

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
          producto: l.producto && POR_NOMBRE[l.producto] ? l.producto : null,
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
        '<select class="prod">' + OPCIONES_HTML + "</select>" +
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
      var p = l.producto ? POR_NOMBRE[l.producto] : null;
      if (p && p.l) {
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

      inputLargo.disabled = !(p && p.l);
      inputLargo.placeholder = p && p.l ? "4,2" : "";
      nombreImpreso.textContent = p ? p.n : "";
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
    var botones = document.querySelectorAll(".tipo");
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

    document.querySelectorAll(".tipo").forEach(function (b) {
      b.addEventListener("click", function () {
        marcarTipo(b.dataset.tipo);
        guardar(false);
      });
    });
  }

  /* ---------- acciones ---------- */

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

  /* ---------- arranque ---------- */

  function iniciar() {
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
        document.querySelectorAll(".view").forEach(function (v) {
          v.classList.toggle("is-hidden", v.id !== "view-" + b.dataset.view);
        });
      });
    });

    if (habia) avisar("Se recuperó el presupuesto de este equipo");
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();
