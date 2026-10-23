/* Comparacion entre la hoja PRECIOS del .xlsx que suben y el catalogo
 * actual. Puro: no toca el DOM ni guarda nada. Sus helpers dependen de
 * TV (parseNumero) y TV_PRODUCTOS (sinAcentos, limpiarNombre, clave,
 * buscar, UNIDADES), que se cargan antes que este archivo. */
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

  function boolDe(v) {
    if (typeof v === "boolean") return v;
    if (v === null || v === undefined) return false;
    var t = PRODUCTOS.sinAcentos(String(v).trim().toLowerCase());
    return t === "si" || t === "y" || t === "x" || t === "true" || t === "1";
  }

  /* Acepta "Nombre" o "Producto" como encabezado de la primera columna;
   * los demas encabezados se reconocen por texto. */
  function mapearColumnas(fila) {
    var mapa = {};
    (fila || []).forEach(function (c, i) {
      var t = PRODUCTOS.sinAcentos(String(c === null ? "" : c).toLowerCase()).trim();
      if (t === "nombre" || t === "producto") mapa.nombre = i;
      else if (t === "unidad") mapa.unidad = i;
      else if (t === "precio") mapa.precio = i;
      else if (t.indexOf("largo") !== -1) mapa.largo = i;
      else if (t === "stock") mapa.stock = i;
    });
    return mapa;
  }

  function productoDeFila(mapa, fila) {
    if (!mapa || mapa.nombre === undefined) return null;
    var celda = fila[mapa.nombre];
    var nombre = celda === null || celda === undefined ? "" : String(celda).trim();
    if (!nombre) return null;
    if (PRODUCTOS.sinAcentos(nombre.toLowerCase()) === "nombre") return null;
    var cand = {
      nombre: PRODUCTOS.limpiarNombre(nombre),
      unidad: "",
      precio: null,
      pideLargo: false,
      stock: null,
    };
    if (mapa.unidad !== undefined && fila[mapa.unidad] !== null && fila[mapa.unidad] !== undefined) {
      cand.unidad = PRODUCTOS.sinAcentos(String(fila[mapa.unidad]).trim()).toUpperCase();
    }
    if (mapa.precio !== undefined) cand.precio = numeroDe(fila[mapa.precio]);
    if (mapa.largo !== undefined) cand.pideLargo = boolDe(fila[mapa.largo]);
    if (mapa.stock !== undefined) cand.stock = numeroDe(fila[mapa.stock]);
    return cand;
  }

  /* Algunas planillas (LISTA DE PRECIOS) tienen encabezado incompleto: se
   * ve PRODUCTO y PRECIO pero las unidades aparecen debajo, en una columna
   * sin rotulo. Con los datos de las primeras filas se infiere la columna. */
  function ajustarMapa(filas, mapaInicial) {
    var mapa = mapaInicial;
    if (!mapa || mapa.nombre === undefined) return mapa;
    if (mapa.unidad !== undefined && mapa.precio !== undefined) return mapa;
    for (var i = 1; i < Math.min(12, filas.length); i++) {
      var f = filas[i];
      if (!f) continue;
      for (var c = 0; c < f.length; c++) {
        var t = PRODUCTOS.sinAcentos(String(f[c] === null ? "" : f[c]).toLowerCase()).trim();
        if (!t) continue;
        if (c !== mapa.nombre && (PRODUCTOS.UNIDADES.indexOf(t.toUpperCase()) !== -1)) {
          if (mapa.unidad === undefined) mapa = Object.assign({}, mapa, { unidad: c });
          break;
        }
      }
      if (mapa.unidad !== undefined && mapa.precio !== undefined) return mapa;
    }
    return mapa;
  }

  function textoValor(v, campo, formatear) {
    if (campo === "pideLargo") return v ? "s\u00ed" : "no";
    if (v === null || v === undefined) {
      if (campo === "precio") return "sin precio";
      if (campo === "stock") return "sin contar";
      return "\u2014";
    }
    if (typeof v === "number") return (formatear || String)(v);
    return String(v);
  }

  /* Devuelve la propuesta de cambios: una entrada por diferencia. Los
   * tipos son "nuevo" (no esta en el catalogo), "campo" (difiere un
   * valor en un producto existente) y "fuera" (activo que ya no esta
   * en la planilla). Tambien devuelve las filas ignoradas por unidad
   * invalida. Solo se emiten propuestas: nada muta el catalogo. */
  function revisar(filas, catalogo, formatear) {
    filas = filas || [];
    var mapa = null;
    var desde = 0;
    var i;
    var j;
    for (i = 0; i < filas.length; i++) {
      mapa = mapearColumnas(filas[i]);
      if (mapa.nombre !== undefined) {
        desde = i + 1;
        break;
      }
    }
    var sinEncabezado = !(mapa && mapa.nombre !== undefined);
    if (sinEncabezado) {
      mapa = null;
    } else {
      mapa = ajustarMapa(filas, mapa);
    }

    var candidatos = [];
    if (mapa) {
      for (j = desde; j < filas.length; j++) {
        var c = productoDeFila(mapa, filas[j]);
        if (c) candidatos.push(c);
      }
    }

    var cambios = [];
    var vistos = {};
    var ignoradas = [];
    candidatos.forEach(function (c) {
      var k = PRODUCTOS.clave(c.nombre);
      if (vistos[k]) return;
      vistos[k] = true;
      var actual = PRODUCTOS.buscar(catalogo, c.nombre);

      if (!actual) {
        if (PRODUCTOS.UNIDADES.indexOf(c.unidad) !== -1) {
          cambios.push({
            tipo: "nuevo",
            nombre: c.nombre,
            campo: "Producto nuevo",
            de: "\u2014",
            a: c.unidad + (c.precio === null ? " \u00b7 sin precio" : " \u00b7 " + textoValor(c.precio, "precio", formatear)),
            producto: c,
            estado: "",
          });
        } else {
          ignoradas.push(c.nombre);
        }
        return;
      }

      function pushCampo(campo, valores) {
        cambios.push({
          tipo: "campo",
          campo: campo,
          nombre: c.nombre,
          de: textoValor(valores.de, campo, formatear),
          a: textoValor(valores.a, campo, formatear),
          valores: valores,
          propio: actual.propio,
          estado: "",
        });
      }

      if (c.precio !== null && c.precio !== actual.precio) {
        pushCampo("precio", { de: actual.precio, a: c.precio });
      }
      if (c.unidad && c.unidad !== actual.unidad && PRODUCTOS.UNIDADES.indexOf(c.unidad) !== -1) {
        pushCampo("unidad", { de: actual.unidad, a: c.unidad });
      }
      /* LAS planillas sin columna no proponen ese cambio: un campo que la
       * planilla no trae no es un cambio a denegar, es informacion que
       * simplemente no esta en el archivo subido. */
      if (mapa.largo !== undefined && c.pideLargo !== actual.pideLargo) {
        pushCampo("pideLargo", { de: actual.pideLargo, a: c.pideLargo });
      }
      if (mapa.stock !== undefined && c.stock !== null && c.stock !== actual.stock) {
        pushCampo("stock", { de: actual.stock, a: c.stock });
      }
    });

    (catalogo || []).forEach(function (p) {
      if (p.activo && !vistos[PRODUCTOS.clave(p.nombre)]) {
        cambios.push({
          tipo: "fuera",
          nombre: p.nombre,
          campo: "Producto",
          de: "est\u00e1 en la app",
          a: "ya no est\u00e1 en la planilla",
          actual: p,
          estado: "",
        });
      }
    });

    return { cambios: cambios, ignoradas: ignoradas, sinEncabezado: sinEncabezado };
  }

  root.TV_PLANILLA = {
    revisar: revisar,
  };
})(typeof window !== "undefined" ? window : globalThis);
