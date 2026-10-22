/* Pruebas de la capa de productos: es la que decide si un precio editado en
 * la app se pisa al volver a importar la planilla. Un error acá se paga en
 * plata, asi que se prueba sola, sin pantalla.
 *
 * Se corre con: node --test tests
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const leer = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
vm.runInThisContext(leer("../app/js/engine.js"), { filename: "engine.js" });
vm.runInThisContext(leer("../app/js/productos.js"), { filename: "productos.js" });

const P = globalThis.TV_PRODUCTOS;

const semilla = () => [
  { nombre: "ROLLIZO 13-15CM", unidad: "METRO LINEAL", precio: 5000, pideLargo: true },
  { nombre: "PLACA 18MM", unidad: "UNIDAD", precio: 8500, pideLargo: false },
  { nombre: "MEMBRANA 40KG", unidad: "UNIDAD", precio: null, pideLargo: false },
];

const base = () => P.fusionar(semilla(), null).productos;

/* ---------------- validacion ---------------- */

test("un producto necesita nombre y no puede repetirse", () => {
  const productos = base();
  const sinNombre = P.validar({ nombre: "  ", unidad: "UNIDAD", precio: "100" }, productos);
  assert.equal(sinNombre.ok, false);
  assert.match(sinNombre.errores.nombre, /nombre/i);

  const repetido = P.validar(
    { nombre: "placa 18mm", unidad: "UNIDAD", precio: "100" },
    productos,
  );
  assert.equal(repetido.ok, false);
  assert.match(repetido.errores.nombre, /existe/i);
});

test("al editar se puede conservar el mismo nombre", () => {
  const productos = base();
  const r = P.validar(
    { nombre: "PLACA 18MM", unidad: "UNIDAD", precio: "9.000" },
    productos,
    "PLACA 18MM",
  );
  assert.equal(r.ok, true);
  assert.equal(r.producto.nombre, "PLACA 18MM");
  assert.equal(r.producto.precio, 9000);
});

test("el nombre se limpia: espacios de mas y recortes", () => {
  const r = P.validar({ nombre: "  VIGA   NUEVA  ", unidad: "METRO LINEAL", precio: "1000" }, []);
  assert.equal(r.ok, true);
  assert.equal(r.producto.nombre, "VIGA NUEVA");
});

test("el precio acepta coma, punto de miles y vacio (sin precio)", () => {
  const p = (v) => P.validar({ nombre: "X", unidad: "UNIDAD", precio: v }, []);
  assert.equal(p("4,2").producto.precio, 4.2);
  assert.equal(p("8.500").producto.precio, 8500);
  assert.equal(p("").producto.precio, null);
  assert.equal(p(null).producto.precio, null);
  assert.equal(p("abc").ok, false);
  assert.equal(p("-5").ok, false);
});

test("el stock acepta vacio (sin contar), cero y decimales; nunca negativo", () => {
  const s = (v) => P.validar({ nombre: "X", unidad: "METRO LINEAL", precio: "1", stock: v }, []);
  assert.equal(s("").producto.stock, null);
  assert.equal(s("0").producto.stock, 0);
  assert.equal(s("12,5").producto.stock, 12.5);
  assert.equal(s("-1").ok, false);
  assert.equal(s("mucho").ok, false);
});

test("la formula arranca segun la unidad y se puede cambiar a mano", () => {
  const auto = P.validar({ nombre: "X", unidad: "METRO LINEAL", precio: "1" }, []);
  assert.equal(auto.producto.pideLargo, true);

  const unidad = P.validar({ nombre: "X", unidad: "UNIDAD", precio: "1" }, []);
  assert.equal(unidad.producto.pideLargo, false);

  const aMano = P.validar(
    { nombre: "X", unidad: "METRO LINEAL", precio: "1", pideLargo: false },
    [],
  );
  assert.equal(aMano.producto.pideLargo, false);
});

test("unidad desconocida se rechaza", () => {
  const r = P.validar({ nombre: "X", unidad: "KILO", precio: "1" }, []);
  assert.equal(r.ok, false);
  assert.match(r.errores.unidad, /unidad/i);
});

/* ---------------- alta, edicion y baja ---------------- */

test("agregar deja el producto marcado como creado en la app", () => {
  const r = P.agregar(base(), { nombre: "TIRANTE NUEVO", unidad: "METRO LINEAL", precio: "7.500" });
  assert.equal(r.ok, true);
  const nuevo = r.catalogo[r.catalogo.length - 1];
  assert.equal(nuevo.nombre, "TIRANTE NUEVO");
  assert.equal(nuevo.origen, "app");
  assert.equal(nuevo.propio, true);
  assert.equal(nuevo.activo, true);
  assert.equal(nuevo.stock, null);
});

test("agregar un nombre repetido no toca el catalogo", () => {
  const antes = base();
  const r = P.agregar(antes, { nombre: "ROLLIZO 13-15CM", unidad: "UNIDAD", precio: "1" });
  assert.equal(r.ok, false);
  assert.equal(r.catalogo.length, antes.length);
});

test("editar el precio marca el producto como precio propio", () => {
  const r = P.editar(base(), "PLACA 18MM", { nombre: "PLACA 18MM", unidad: "UNIDAD", precio: "9.900", stock: "4" });
  assert.equal(r.ok, true);
  const p = r.catalogo.find((x) => x.nombre === "PLACA 18MM");
  assert.equal(p.precio, 9900);
  assert.equal(p.stock, 4);
  assert.equal(p.propio, true);
});

test("dar de baja lo saca de la lista del presupuesto pero no del catalogo", () => {
  const r = P.baja(base(), "PLACA 18MM");
  const p = r.find((x) => x.nombre === "PLACA 18MM");
  assert.equal(p.activo, false);
  assert.equal(r.length, 3);

  const activos = P.filtrar(r, {});
  assert.equal(activos.length, 2);
  assert.equal(P.filtrar(r, { bajas: true }).length, 3);

  const vuelta = P.alta(r, "PLACA 18MM");
  assert.equal(vuelta.find((x) => x.nombre === "PLACA 18MM").activo, true);
});

/* ---------------- fusion con la planilla ---------------- */

test("la primera vez, el catalogo se siembra desde la planilla", () => {
  const r = P.fusionar(semilla(), null);
  assert.equal(r.productos.length, 3);
  assert.equal(r.productos[0].origen, "planilla");
  assert.equal(r.productos[0].propio, false);
  assert.equal(r.productos[0].stock, null);
  assert.equal(r.productos[0].activo, true);
});

test("traer la planilla agrega los productos nuevos", () => {
  const previo = base();
  const planilla = semilla().concat([
    { nombre: "POSTE NUEVO", unidad: "METRO LINEAL", precio: 6000, pideLargo: true },
  ]);
  const r = P.fusionar(planilla, previo);
  assert.equal(r.productos.length, 4);
  assert.equal(r.cambios.nuevos, 1);
  assert.equal(r.productos.find((p) => p.nombre === "POSTE NUEVO").origen, "planilla");
});

test("traer la planilla actualiza el precio de los que no se tocaron", () => {
  const previo = base();
  previo[0].stock = 30; // stock cargado a mano: no se puede perder
  const planilla = semilla();
  planilla[0].precio = 5500;

  const r = P.fusionar(planilla, previo);
  const p = r.productos.find((x) => x.nombre === "ROLLIZO 13-15CM");
  assert.equal(p.precio, 5500);
  assert.equal(p.stock, 30, "el stock local no se pisa con la planilla");
  assert.equal(r.cambios.actualizados, 1);
});

test("traer la planilla NO pisa un precio editado en la app", () => {
  const previo = base();
  previo[1].precio = 9500;
  previo[1].propio = true;

  const planilla = semilla();
  planilla[1].precio = 8000; // en el Excel sigue viejo

  const r = P.fusionar(planilla, previo);
  const p = r.productos.find((x) => x.nombre === "PLACA 18MM");
  assert.equal(p.precio, 9500);
  assert.equal(r.cambios.respetados, 1);
});

test("traer la planilla nunca borra un producto creado en la app", () => {
  const conNuevo = P.agregar(base(), { nombre: "TIRANTE NUEVO", unidad: "UNIDAD", precio: "100" }).catalogo;
  const r = P.fusionar(semilla(), conNuevo);
  assert.equal(r.productos.length, 4);
  assert.ok(r.productos.some((p) => p.nombre === "TIRANTE NUEVO"));
});

test("un producto dado de baja sigue de baja aunque la planilla lo actualice", () => {
  const previo = P.baja(base(), "MEMBRANA 40KG");
  const planilla = semilla();
  planilla[2].precio = 12000;

  const r = P.fusionar(planilla, previo);
  const p = r.productos.find((x) => x.nombre === "MEMBRANA 40KG");
  assert.equal(p.precio, 12000);
  assert.equal(p.activo, false);
});

/* ---------------- busqueda y resumen ---------------- */

test("la busqueda ignora mayusculas y acentos", () => {
  const productos = base().concat([
    { nombre: "MACHIMBRE ÑANDU", unidad: "UNIDAD", precio: 100, pideLargo: false, stock: null, activo: true, editado: true, origen: "app" },
  ]);
  assert.equal(P.filtrar(productos, { texto: "machimbre" }).length, 1);
  assert.equal(P.filtrar(productos, { texto: "nandu" }).length, 1);
  assert.equal(P.filtrar(productos, { texto: "rollizo" }).length, 1);
});

test("el resumen cuenta precios, stock y bajas", () => {
  const productos = P.baja(base(), "MEMBRANA 40KG");
  productos[0].stock = 0;
  const r = P.resumen(productos);
  assert.equal(r.total, 3);
  assert.equal(r.conPrecio, 2);
  assert.equal(r.sinPrecio, 1);
  assert.equal(r.sinStock, 1);
  assert.equal(r.bajas, 1);
});

test("tocar solo el stock NO congela el precio de la planilla", () => {
  const previo = base();
  const editado = P.editar(previo, "ROLLIZO 13-15CM", {
    nombre: "ROLLIZO 13-15CM",
    unidad: "METRO LINEAL",
    precio: "5000",
    stock: "30",
  });
  assert.equal(editado.ok, true);
  assert.equal(editado.catalogo.find((p) => p.nombre === "ROLLIZO 13-15CM").propio, false);

  const planilla = semilla();
  planilla[0].precio = 6200;
  const r = P.fusionar(planilla, editado.catalogo);
  const p = r.productos.find((x) => x.nombre === "ROLLIZO 13-15CM");
  assert.equal(p.precio, 6200, "el precio tiene que seguir a la planilla");
  assert.equal(p.stock, 30, "el stock cargado a mano no se pierde");
});
