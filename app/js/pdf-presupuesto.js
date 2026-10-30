/* Arma el PDF del presupuesto con el mismo formato que la impresion:
 * membrete, datos del cliente, tabla de 6 columnas (# / Producto /
 * Cantidad / Largo real / Precio / Total) y total.
 *
 * Puro respecto del DOM: recibe todo por parametro para poder probarlo
 * sin navegador (tests/pdf.test.mjs).
 */
(function (root) {
  "use strict";

  var ANCHO = 210;   /* A4 en mm */
  var M = 13;        /* margen izquierdo y derecho */
  var DER = ANCHO - M;
  var COLOR_INK = [43, 33, 24];
  var COLOR_MUTED = [110, 91, 71];
  var COLOR_LINEA = [225, 213, 194];

  function crearPdf(o) {
    var jsPDF = o.jsPDF;
    var doc = new jsPDF({ unit: "mm", format: "a4" });
    var pesos = o.pesos;
    var dato = o.dato;
    var negocio = o.negocio || {};
    var estado = o.estado || {};
    var calc = o.calc;
    var y;

    /* ---------- membrete ----------
     * Caja con tres partes, como el talonario de papel: a la izquierda el
     * logo y los datos del negocio, en el medio la cruz que marca que el
     * documento es un PRESUPUESTO, y a la derecha el titulo y la fecha. */
    var Y_CAB = 12;
    var ALTO_CAB = 60;
    var X_DIV = M + 92;
    var ANCHO_CRUZ = 18;
    var X_DER = X_DIV + ANCHO_CRUZ;

    doc.setTextColor(COLOR_INK[0], COLOR_INK[1], COLOR_INK[2]);
    doc.setDrawColor(COLOR_INK[0], COLOR_INK[1], COLOR_INK[2]);
    doc.setLineWidth(0.5);
    doc.rect(M, Y_CAB, DER - M, ALTO_CAB);
    doc.line(X_DIV, Y_CAB, X_DIV, Y_CAB + ALTO_CAB);
    doc.rect(X_DIV, Y_CAB, ANCHO_CRUZ, ANCHO_CRUZ);
    doc.line(X_DER, Y_CAB, X_DER, Y_CAB + ALTO_CAB);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("X", X_DIV + ANCHO_CRUZ / 2, Y_CAB + 12.3, { align: "center" });

    /* logo + datos del negocio (columna izquierda) */
    var hayLogo = false;
    if (o.logo) {
      try {
        doc.addImage(o.logo, "JPEG", M + 4, Y_CAB + 3, 32, 22.4);
        hayLogo = true;
      } catch (e) {}
    }

    var yTxt = hayLogo ? Y_CAB + 30 : Y_CAB + 10;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(String(negocio.nombre || "MADERAS VICTORIA").toUpperCase(), M + 4, yTxt);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text("VENTA DE MADERAS", M + 4, yTxt + 4.4);
    doc.text("Tiranter\u00edas - pino - \u00e1lamo", M + 4, yTxt + 8);
    doc.text("machimbre - rollizos eucaliptos", M + 4, yTxt + 11.6);
    doc.text("piso entablonado", M + 4, yTxt + 15.2);

    doc.setFontSize(6.6);
    doc.text("Lareal Acceso Sur 7522 - Carrodilla - Luj\u00e1n de Cuyo - Mendoza", M + 4, yTxt + 19.6);
    doc.text(
      "maderasvictoria@gmail.com  \u00b7  Tel. " + (negocio.telefonos || []).join(" - "),
      M + 4,
      yTxt + 23.2
    );

    /* titulo y fecha (columna derecha) */
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("PRESUPUESTO", DER - 4, Y_CAB + 12, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text("Fecha de Emisi\u00f3n: " + String(o.fecha || ""), DER - 4, Y_CAB + 22, { align: "right" });

    /* ---------- datos del cliente ---------- */
    y = Y_CAB + ALTO_CAB + 8;
    var cols = [
      { x: M, w: 64, label: "CLIENTE", val: estado.cliente },
      { x: M + 70, w: 52, label: "DIRECCION", val: estado.direccion },
      { x: M + 128, w: 28, label: "TELEFONO", val: estado.telefono },
      { x: DER - 24, w: 24, label: "FECHA", val: o.fecha },
    ];
    doc.setFontSize(6.5);
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    cols.forEach(function (c) { doc.text(c.label, c.x, y); });
    doc.setFontSize(10);
    doc.setTextColor(COLOR_INK[0], COLOR_INK[1], COLOR_INK[2]);
    cols.forEach(function (c) {
      doc.text(String(c.val || "").slice(0, 42), c.x, y + 5.5);
      doc.setDrawColor(198, 185, 165);
      doc.setLineWidth(0.2);
      doc.line(c.x, y + 7, c.x + c.w, y + 7);
    });

    /* ---------- tabla ---------- */
    var cN = { x: M };
    var cProd = { x: M + 6, w: 66 };
    var cCant = { der: M + 90 };
    var cLargo = { der: M + 114 };
    var cPrecio = { der: M + 139 };
    var cTotal = { der: DER };

    function encabezadoTabla(yy) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
      doc.text("#", cN.x, yy);
      doc.text("PRODUCTO", cProd.x, yy);
      doc.text("CANTIDAD", cCant.der, yy, { align: "right" });
      doc.text("LARGO REAL", cLargo.der, yy, { align: "right" });
      doc.text("PRECIO", cPrecio.der, yy, { align: "right" });
      doc.text("TOTAL", cTotal.der, yy, { align: "right" });
      doc.setDrawColor(COLOR_INK[0], COLOR_INK[1], COLOR_INK[2]);
      doc.setLineWidth(0.4);
      doc.line(M, yy + 2, DER, yy + 2);
      return yy + 7;
    }

    y = encabezadoTabla(y + 20);

    var lineas = estado.lineas || [];
    for (var i = 0; i < lineas.length; i++) {
      var l = lineas[i];
      var c = calc.linea(l);
      if (!c || !c.producto) continue;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      var trozos = doc.splitTextToSize(String(c.producto.nombre || ""), cProd.w);
      var alto = Math.max(6, trozos.length * 4.2 + 2);

      if (y + alto > 266) {
        doc.addPage();
        y = encabezadoTabla(16);
      }

      doc.setTextColor(COLOR_INK[0], COLOR_INK[1], COLOR_INK[2]);
      doc.setFontSize(7.5);
      doc.text(String(i + 1), cN.x, y + 3.6);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.text(trozos, cProd.x, y + 3.6);
      doc.text(dato(l.cantidad), cCant.der, y + 3.6, { align: "right" });
      doc.text(dato(l.largo), cLargo.der, y + 3.6, { align: "right" });
      doc.text(pesos(c.precio), cPrecio.der, y + 3.6, { align: "right" });

      doc.setFont("helvetica", "bold");
      doc.text(pesos(c.total), cTotal.der, y + 3.6, { align: "right" });

      y += alto;
      doc.setDrawColor(COLOR_LINEA[0], COLOR_LINEA[1], COLOR_LINEA[2]);
      doc.setLineWidth(0.2);
      doc.line(M, y, DER, y);
    }

    /* ---------- total ---------- */
    y += 4;
    if (y > 256) {
      doc.addPage();
      y = 20;
    }
    doc.setDrawColor(COLOR_INK[0], COLOR_INK[1], COLOR_INK[2]);
    doc.setLineWidth(0.5);
    doc.line(M, y, DER, y);

    var res = calc.resumen(lineas);
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text("PRECIOS MAS IVA", M, y);
    doc.setFontSize(11);
    doc.text("TOTAL", DER - 52, y, { align: "right" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.setTextColor(COLOR_INK[0], COLOR_INK[1], COLOR_INK[2]);
    doc.text(pesos(res.total), DER, y + 1, { align: "right" });

    /* ---------- pie ---------- */
    doc.setDrawColor(COLOR_LINEA[0], COLOR_LINEA[1], COLOR_LINEA[2]);
    doc.setLineWidth(0.2);
    doc.line(M, 282, DER, 282);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text(String(negocio.nombre || "MADERAS VICTORIA").toUpperCase(), M, 287);
    doc.setFont("helvetica", "normal");
    doc.text("Tel. " + (negocio.telefonos || []).join(" - "), DER, 287, { align: "right" });

    return doc;
  }

  root.TV_PDF = { crear: crearPdf };
})(typeof window !== "undefined" ? window : this);
