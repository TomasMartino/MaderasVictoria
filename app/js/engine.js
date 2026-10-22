/* Motor de calculo del presupuesto.
 *
 * Reproduce exactamente las formulas que ya estan en PRESUPUESTO.xlsx:
 *   J = largo redondeado hacia arriba al paso de corte
 *   M = cantidad x largo a pedir x precio   (productos por metro lineal)
 *   M = cantidad x precio                   (productos por unidad)
 *
 * Es un script clasico (no modulo) para que la app abra con doble clic,
 * sin servidor y sin compilar nada. En las pruebas se carga con vm.
 */
(function (root) {
  "use strict";

  var MAX_LARGO = 50;
  var MIN_LARGO = 0.5;

  /* Acepta "4,2", "4.2" y "8.500".
   * - Si hay coma, la coma es decimal y los puntos son de miles.
   * - Si no hay coma y el punto separa grupos de 3 digitos, es de miles
   *   ("8.500" = 8500), para no leer un precio mil veces mas chico.
   * - Si no, el punto es decimal: el error tipico de quien escribe con
   *   teclado en ingles y que en Excel rompia todo. */
  function parseNumero(texto) {
    if (typeof texto === "number") return isFinite(texto) ? texto : null;
    if (texto == null) return null;
    var s = String(texto).trim().replace(/[$\s]/g, "");
    if (s === "") return null;
    if (s.indexOf(",") !== -1) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, "");
    }
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  /* Redondeo al paso de corte, siempre hacia arriba, con 2 decimales.
   * El epsilon evita que 3,0000000004 suba un paso de mas. */
  function largoAPedir(largo, paso) {
    var l = parseNumero(largo);
    if (l === null) {
      return { ok: false, motivo: "REVISAR LARGO", detalle: "Falta el largo." };
    }
    if (l < MIN_LARGO || l > MAX_LARGO) {
      return {
        ok: false,
        motivo: "REVISAR LARGO",
        detalle: "El largo va de " + metros(MIN_LARGO) + " a " + metros(MAX_LARGO) + ".",
      };
    }
    if (!paso || paso <= 0) paso = 0.5;
    var pasos = Math.ceil(l / paso - 1e-9);
    var valor = Math.round(pasos * paso * 100) / 100;
    return { ok: true, valor: valor };
  }

  /* Calcula una linea. Nunca lanza: devuelve el estado para que la pantalla
   * decida que mostrar. */
  function calcularLinea(linea, paso) {
    var prod = linea && linea.producto;
    if (!prod) return { vacia: true, total: null };

    var cant = parseNumero(linea.cantidad);
    if (cant !== null && cant <= 0) cant = null;

    var r = {
      producto: prod,
      cantidad: cant,
      precio: prod.precio,
      largoTiene: !!prod.pideLargo,
      largoPedir: null,
      total: null,
      aviso: null,
      detalle: null,
    };

    if (prod.precio === null || prod.precio === undefined) {
      r.aviso = "SIN PRECIO";
      r.detalle = "Falta cargar el precio de este producto.";
      return r;
    }

    if (prod.pideLargo) {
      var lp = largoAPedir(linea.largo, paso);
      if (!lp.ok) {
        r.aviso = lp.motivo;
        r.detalle = lp.detalle;
        return r;
      }
      r.largoPedir = lp.valor;
      r.total = cant === null ? null : cant * lp.valor * prod.precio;
      return r;
    }

    r.total = cant === null ? null : cant * prod.precio;
    return r;
  }

  function resumen(lineas, paso) {
    var total = 0;
    var avisos = [];
    var validas = 0;
    (lineas || []).forEach(function (linea, i) {
      var c = calcularLinea(linea, paso);
      if (c.total !== null && c.total !== undefined) {
        total += c.total;
        validas++;
      }
      if (c.aviso) avisos.push({ indice: i, motivo: c.aviso, detalle: c.detalle });
    });
    return { total: total, avisos: avisos, validas: validas };
  }

  /* Une el catalogo con el motor.
   * La pantalla guarda el NOMBRE del producto (asi se puede guardar y
   * sincronizar sin repetir objetos); el motor trabaja con el producto.
   * Toda esa traduccion vive aca, en un solo lugar, y tiene su prueba. */
  function crearCalculadora(catalogo) {
    var productos = (catalogo && catalogo.productos) || [];
    var paso = (catalogo && catalogo.paso) || 0.5;
    var porNombre = {};
    productos.forEach(function (p) {
      porNombre[p.nombre] = p;
    });

    function resolver(linea) {
      var nombre = linea && linea.producto;
      return {
        producto: nombre ? porNombre[nombre] || null : null,
        cantidad: linea ? linea.cantidad : "",
        largo: linea ? linea.largo : "",
      };
    }

    return {
      paso: paso,
      producto: function (nombre) {
        return porNombre[nombre] || null;
      },
      linea: function (linea) {
        return calcularLinea(resolver(linea), paso);
      },
      resumen: function (lineas) {
        return resumen((lineas || []).map(resolver), paso);
      },
    };
  }

  function pesos(n) {
    if (n === null || n === undefined || !isFinite(n)) return "—";
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    }).format(n);
  }

  function metros(n) {
    if (n === null || n === undefined || !isFinite(n)) return "—";
    return (
      new Intl.NumberFormat("es-AR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n) + " m"
    );
  }

  /* "2026-10-22" -> "22/10/2026" */
  function fechaLarga(iso) {
    if (!iso) return "";
    var p = String(iso).split("-");
    if (p.length !== 3) return String(iso);
    return p[2] + "/" + p[1] + "/" + p[0];
  }

  /* El mensaje que recibe el cliente por WhatsApp.
   * Es la cara del negocio: se arma aca, en una funcion pura, para poder
   * probarla palabra por palabra. */
  function textoPresupuesto(d) {
    var calc = d.calc;
    var tipo = String(d.tipo || "PRESUPUESTO");
    var titulo = tipo.charAt(0) + tipo.slice(1).toLowerCase();
    var res = calc.resumen(d.lineas);

    var l = ["*" + (d.negocio || "Maderas Victoria") + "*", titulo];
    if (d.cliente) l.push("Cliente: " + d.cliente);
    if (d.fecha) l.push("Fecha: " + fechaLarga(d.fecha));
    l.push("");

    (d.lineas || []).forEach(function (linea) {
      var c = calc.linea(linea);
      if (c.total === null || c.total === undefined) return;
      var detalle = c.largoTiene
        ? c.cantidad + " × " + metros(c.largoPedir)
        : c.cantidad + " un.";
      l.push(linea.producto + " — " + detalle + " — " + pesos(c.total));
    });

    l.push("");
    l.push("*TOTAL: " + pesos(res.total) + "*");
    l.push("Precios más IVA.");
    return l.join("\n");
  }

  root.TV = {
    MAX_LARGO: MAX_LARGO,
    MIN_LARGO: MIN_LARGO,
    parseNumero: parseNumero,
    largoAPedir: largoAPedir,
    calcularLinea: calcularLinea,
    resumen: resumen,
    crearCalculadora: crearCalculadora,
    textoPresupuesto: textoPresupuesto,
    fechaLarga: fechaLarga,
    pesos: pesos,
    metros: metros,
  };
})(typeof window !== "undefined" ? window : globalThis);
