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
  var COLOR_ROJO = [238, 29, 35];

  function crearPdf(o) {
    var jsPDF = o.jsPDF;
    var doc = new jsPDF({ unit: "mm", format: "a4" });
    var pesos = o.pesos;
    var dato = o.dato;
    var negocio = o.negocio || {};
    var estado = o.estado || {};
    var calc = o.calc;
    var y = 16;

    /* ---------- membrete ---------- */
    if (o.logo) {
      try { doc.addImage(o.logo, "JPEG", M, y, 42, 29.4); } catch (e) {}
    }
    doc.setTextColor(COLOR_INK[0], COLOR_INK[1], COLOR_INK[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(String(negocio.nombre || "MADERAS VICTORIA").toUpperCase(), DER, y + 5, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Tel. " + (negocio.telefonos || []).join(" - "), DER, y + 10.5, { align: "right" });

    y += 29.4;
    doc.setDrawColor(COLOR_ROJO[0], COLOR_ROJO[1], COLOR_ROJO[2]);
    doc.setLineWidth(0.8);
    doc.line(M, y, DER, y);

    /* ---------- datos del cliente ---------- */
    y += 8;
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

    /* ---------- tipo de documento ---------- */
    y += 16;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(String(estado.tipo || "PRESUPUESTO").toUpperCase(), DER, y, { align: "right" });

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

    y = encabezadoTabla(y + 6);

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
