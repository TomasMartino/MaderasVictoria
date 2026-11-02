/* El PDF del presupuesto (app/js/pdf-presupuesto.js).
 *
 * Se prueba con un jsPDF falso que anota cada texto dibujado: asi se comprueba
 * el titulo del membrete sin abrir el navegador ni bajar la libreria.
 *
 * Se corre con: node --test "tests/*.test.mjs"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

vm.runInThisContext(
  readFileSync(new URL("../app/js/pdf-presupuesto.js", import.meta.url), "utf8"),
  { filename: "pdf-presupuesto.js" },
);

/* jsPDF de mentira: guarda cada `text` con la fuente activa y acepta el resto
 * de las llamadas de dibujo sin hacer nada. */
function crearJsPDFFalso(llamadas) {
  function Doc() {
    this.fuente = { estilo: "normal", tamano: 10 };
  }
  Doc.prototype.text = function (texto, x, y, opciones) {
    llamadas.push({
      texto: Array.isArray(texto) ? texto.join(" ") : String(texto),
      estilo: this.fuente.estilo,
      tamano: this.fuente.tamano,
      y: y,
      opciones: opciones || null,
    });
  };
  Doc.prototype.setFont = function (nombre, estilo) { this.fuente.estilo = estilo; };
  Doc.prototype.setFontSize = function (tamano) { this.fuente.tamano = tamano; };
  Doc.prototype.setTextColor = function () {};
  Doc.prototype.setDrawColor = function () {};
  Doc.prototype.setLineWidth = function () {};
  Doc.prototype.rect = function () {};
  Doc.prototype.line = function () {};
  Doc.prototype.addImage = function () {};
  Doc.prototype.addPage = function () {};
  Doc.prototype.splitTextToSize = function (texto) { return [String(texto)]; };
  Doc.prototype.output = function () { return null; };
  return Doc;
}

const CALC = {
  linea: function () {
    return {
      producto: { nombre: "PLACA 18MM" },
      cantidad: 1,
      largo: null,
      precio: 8500,
      total: 8500,
    };
  },
  resumen: function () { return { total: 8500 }; },
};

/* Devuelve los textos dibujados en el membrete (titulo) para un tipo dado. */
function tituloDelPdf(tipo) {
  const llamadas = [];
  globalThis.TV_PDF.crear({
    jsPDF: crearJsPDFFalso(llamadas),
    pesos: function (v) { return "$ " + v; },
    dato: function (v) { return v == null || v === "" ? "-" : String(v); },
    negocio: {},
    estado: { cliente: "Juan Gomez", direccion: "", telefono: "", cuit: "", lineas: [] },
    numero: 23890,
    fecha: "22/10/2026",
    calc: CALC,
    tipo: tipo,
  });
  /* El titulo es el unico texto grande (14) en la fila del membrete (y=24). */
  const titulo = llamadas.find(function (c) { return c.tamano === 14 && c.y === 24; });
  return titulo ? titulo.texto : "";
}

test("una nota de pedido sale con el titulo NOTA DE PEDIDO", () => {
  assert.equal(tituloDelPdf("NOTA DE PEDIDO"), "NOTA DE PEDIDO N° 23890");
});

test("un presupuesto sigue saliendo con el titulo PRESUPUESTO", () => {
  assert.equal(tituloDelPdf("PRESUPUESTO"), "PRESUPUESTO N° 23890");
});

test("sin tipo explicito el PDF sigue siendo un presupuesto", () => {
  assert.equal(tituloDelPdf(undefined), "PRESUPUESTO N° 23890");
});
