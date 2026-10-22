/* Productos: la capa que decide que es un producto valido y que pasa cuando
 * la planilla y la app no coinciden.
 *
 * La regla que importa: un precio editado en la app NUNCA se pisa solo.
 * Traer cambios de la planilla agrega lo nuevo, actualiza lo que nadie toco
 * y respeta lo editado a mano. Nunca borra.
 *
 * No toca pantalla ni almacenamiento: se puede probar sola.
 */
(function (root) {
  "use strict";

  var TV = root.TV;
  var UNIDADES = ["METRO LINEAL", "UNIDAD", "METRO 2"];

  function limpiarNombre(valor) {
    return String(valor == null ? "" : valor)
      .replace(/\s+/g, " ")
      .trim();
  }

  function clave(nombre) {
    return limpiarNombre(nombre).toLowerCase();
  }

  /* "MACHIMBRE ÑANDU" se tiene que encontrar escribiendo "nandu" */
  function sinAcentos(texto) {
    return String(texto)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function pideLargoPorUnidad(unidad) {
    return unidad === "METRO LINEAL";
  }

  function numeroOpcional(valor) {
    if (valor === "" || valor === null || valor === undefined) return { ok: true, valor: null };
    var n = TV.parseNumero(valor);
    if (n === null) return { ok: false };
    return { ok: true, valor: n };
  }

  /* Devuelve { ok, producto } o { ok:false, errores:{campo: mensaje} }.
   * `nombreOriginal` es el nombre que tenia antes de editar, para no chocar
   * consigo mismo. */
  function validar(datos, productos, nombreOriginal) {
    datos = datos || {};
    var errores = {};

    var nombre = limpiarNombre(datos.nombre);
    if (!nombre) {
      errores.nombre = "Poné un nombre";
    } else if (nombre.length > 60) {
      errores.nombre = "El nombre es demasiado largo (máximo 60)";
    } else {
      var k = clave(nombre);
      var original = nombreOriginal ? clave(nombreOriginal) : null;
      var repetido = (productos || []).some(function (p) {
        return clave(p.nombre) === k && clave(p.nombre) !== original;
      });
      if (repetido) errores.nombre = "Ya existe un producto con ese nombre";
    }

    var unidad = datos.unidad;
    if (UNIDADES.indexOf(unidad) === -1) errores.unidad = "Elegí una unidad";

    var precio = numeroOpcional(datos.precio);
    if (!precio.ok) {
      errores.precio = "Precio inválido";
    } else if (precio.valor !== null && !(precio.valor > 0)) {
      errores.precio = "Tiene que ser mayor a 0 (dejalo vacío si todavía no lo sabés)";
    }

    var stock = numeroOpcional(datos.stock);
    if (!stock.ok) {
      errores.stock = "Cantidad inválida";
    } else if (stock.valor !== null && stock.valor < 0) {
      errores.stock = "La cantidad no puede ser negativa";
    }

    if (Object.keys(errores).length) return { ok: false, errores: errores };

    var pideLargo =
      datos.pideLargo === undefined || datos.pideLargo === null
        ? pideLargoPorUnidad(unidad)
        : !!datos.pideLargo;

    return {
      ok: true,
      producto: {
        nombre: nombre,
        unidad: unidad,
        precio: precio.valor,
        pideLargo: pideLargo,
        stock: stock.valor,
        activo: datos.activo === undefined ? true : !!datos.activo,
        origen: datos.origen === "planilla" ? "planilla" : "app",
      },
    };
  }

  function agregar(catalogo, datos) {
    var v = validar(datos, catalogo);
    if (!v.ok) return { ok: false, errores: v.errores, catalogo: catalogo };
    var nuevo = Object.assign({}, v.producto, { origen: "app", propio: true });
    return { ok: true, catalogo: (catalogo || []).concat([nuevo]), producto: nuevo };
  }

  function editar(catalogo, nombreOriginal, datos) {
    var v = validar(datos, catalogo, nombreOriginal);
    if (!v.ok) return { ok: false, errores: v.errores, catalogo: catalogo };

    var k = clave(nombreOriginal);
    var encontrado = false;
    var salida = (catalogo || []).map(function (p) {
      if (clave(p.nombre) !== k) return p;
      encontrado = true;
      /* "propio" significa que el precio, la unidad o la formula los fijo una
       * persona. Tocar solo el stock no vuelve propio el precio: si la planilla
       * lo actualiza, se tiene que actualizar. */
      var propio = p.propio === true;
      if (
        v.producto.precio !== p.precio ||
        v.producto.unidad !== p.unidad ||
        v.producto.pideLargo !== p.pideLargo
      ) {
        propio = true;
      }
      return {
        nombre: v.producto.nombre,
        unidad: v.producto.unidad,
        precio: v.producto.precio,
        pideLargo: v.producto.pideLargo,
        stock: v.producto.stock,
        activo: datos.activo === undefined ? p.activo : !!datos.activo,
        propio: propio,
        origen: p.origen === "app" ? "app" : "planilla",
      };
    });

    if (!encontrado) {
      return { ok: false, errores: { nombre: "Ese producto ya no está" }, catalogo: catalogo };
    }
    return { ok: true, catalogo: salida };
  }

  function cambiarActivo(catalogo, nombre, activo) {
    var k = clave(nombre);
    return (catalogo || []).map(function (p) {
      if (clave(p.nombre) !== k) return p;
      return Object.assign({}, p, { activo: activo });
    });
  }

  function baja(catalogo, nombre) {
    return cambiarActivo(catalogo, nombre, false);
  }

  function alta(catalogo, nombre) {
    return cambiarActivo(catalogo, nombre, true);
  }

  function dePlanilla(p) {
    return {
      nombre: limpiarNombre(p.nombre),
      unidad: p.unidad,
      precio: typeof p.precio === "number" ? p.precio : null,
      pideLargo: !!p.pideLargo,
      stock: null,
      activo: true,
      propio: false,
      origen: "planilla",
    };
  }

  /* Une la planilla (semilla) con lo que la persona ya tiene cargado.
   * - producto nuevo en la planilla  -> se agrega
   * - producto sin tocar a mano      -> se actualiza precio/unidad/formula
   * - producto con precio propio     -> se respeta (no se pisa)
   * - producto que solo existe en la app -> se conserva
   * El stock y el alta/baja son siempre locales: la planilla no los conoce. */
  function fusionar(semilla, previo) {
    var cambios = { nuevos: 0, actualizados: 0, respetados: 0 };
    var lista = Array.isArray(previo) ? previo.slice() : [];

    if (!lista.length) {
      return { productos: (semilla || []).map(dePlanilla), cambios: cambios };
    }

    var porNombre = {};
    lista.forEach(function (p) {
      porNombre[clave(p.nombre)] = p;
    });

    var enPlanilla = {};
    var salida = [];

    (semilla || []).forEach(function (s) {
      var k = clave(s.nombre);
      enPlanilla[k] = true;
      var actual = porNombre[k];

      if (!actual) {
        salida.push(dePlanilla(s));
        cambios.nuevos++;
        return;
      }

      if (actual.propio) {
        salida.push(actual);
        cambios.respetados++;
        return;
      }

      var precio = typeof s.precio === "number" ? s.precio : null;
      var cambio =
        actual.precio !== precio ||
        actual.unidad !== s.unidad ||
        actual.pideLargo !== !!s.pideLargo;

      salida.push(
        Object.assign({}, actual, {
          unidad: s.unidad,
          precio: precio,
          pideLargo: !!s.pideLargo,
        }),
      );
      if (cambio) cambios.actualizados++;
    });

    lista.forEach(function (p) {
      if (!enPlanilla[clave(p.nombre)]) salida.push(p);
    });

    return { productos: salida, cambios: cambios };
  }

  function filtrar(productos, opciones) {
    opciones = opciones || {};
    var texto = opciones.texto ? sinAcentos(opciones.texto) : "";
    var unidad = opciones.unidad || "";
    var conBajas = !!opciones.bajas;

    return (productos || []).filter(function (p) {
      if (!conBajas && !p.activo) return false;
      if (unidad && p.unidad !== unidad) return false;
      if (texto && sinAcentos(p.nombre).indexOf(texto) === -1) return false;
      return true;
    });
  }

  function buscar(productos, nombre) {
    var k = clave(nombre);
    var lista = productos || [];
    for (var i = 0; i < lista.length; i++) {
      if (clave(lista[i].nombre) === k) return lista[i];
    }
    return null;
  }

  function resumen(productos) {
    var r = {
      total: 0,
      conPrecio: 0,
      sinPrecio: 0,
      sinStock: 0,
      sinContar: 0,
      bajas: 0,
      lineales: 0,
    };
    (productos || []).forEach(function (p) {
      r.total++;
      if (typeof p.precio === "number" && p.precio > 0) r.conPrecio++;
      else r.sinPrecio++;
      if (p.stock === 0) r.sinStock++;
      if (p.stock === null || p.stock === undefined) r.sinContar++;
      if (!p.activo) r.bajas++;
      if (p.pideLargo) r.lineales++;
    });
    return r;
  }

  /* Para el desplegable del presupuesto: solo activos, con el precio a la
   * vista para no elegir a ciegas. */
  function paraElegir(productos, pesos) {
    var grupos = UNIDADES.map(function (u) {
      return { unidad: u, productos: [] };
    });
    (productos || []).forEach(function (p) {
      if (!p.activo) return;
      for (var i = 0; i < grupos.length; i++) {
        if (grupos[i].unidad === p.unidad) {
          grupos[i].productos.push(p);
          return;
        }
      }
    });
    return grupos.filter(function (g) {
      return g.productos.length > 0;
    });
  }

  root.TV_PRODUCTOS = {
    UNIDADES: UNIDADES,
    limpiarNombre: limpiarNombre,
    clave: clave,
    sinAcentos: sinAcentos,
    pideLargoPorUnidad: pideLargoPorUnidad,
    validar: validar,
    agregar: agregar,
    editar: editar,
    baja: baja,
    alta: alta,
    fusionar: fusionar,
    filtrar: filtrar,
    buscar: buscar,
    resumen: resumen,
    paraElegir: paraElegir,
  };
})(typeof window !== "undefined" ? window : globalThis);
