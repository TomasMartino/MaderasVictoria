# Maderas Victoria — la app del presupuesto

La misma cuenta que hace `PRESUPUESTO.xlsx`, pero en pantalla, sin fórmulas que se rompan y sin el problema de la coma y el punto.

**Abrir:** doble clic en `index.html`. No se instala nada, no hace falta internet y no hay que compilar.

---

## 1. Qué hace hoy (etapa 1: presupuesto y productos)

| Se hace | Cómo |
|---|---|
| Elegir el producto | Desplegable con los **87 productos** del catálogo (no se puede escribir cualquier cosa) |
| Cargar cantidad y largo | Se acepta `4,2` y también `4.2` — el error que rompía el Excel acá no existe |
| Ver el largo a cortar | Debajo del largo aparece **se pide 4,50 m** (la columna LARGO A PEDIR del Excel, que había que buscar a mano) |
| Ver el total | Se actualiza en cada cambio, con `PRECIOS MÁS IVA` siempre a la vista |
| Guardar | Solo, en este equipo. El puntito verde de abajo a la izquierda dice el estado |
| Imprimir o PDF | Botón `Imprimir / PDF` → sale la hoja con el logo, los datos del cliente y la tabla |
| Mandar por WhatsApp | Botón `WhatsApp` → abre el mensaje armado con el detalle y el total |
| Ver y editar productos | Pestaña `Productos`: los 87 con precio, unidad, fórmula y stock. Se agregan y editan ahí, sin tocar el Excel |

### Las tres protecciones que trae del Excel

1. **Largo fuera de rango** → el total de esa línea dice `REVISAR LARGO` en vez de inventar un número.
2. **Producto sin precio** → dice `SIN PRECIO` y no suma. Además aparece un aviso abajo con el número de línea.
3. **No se puede enviar un presupuesto con líneas en revisión.** El botón de WhatsApp avisa y no manda nada hasta que esté limpio.

Los tres avisos dicen **en qué línea** está el problema. En Excel había que buscarlo.

---

## 2. Qué NO hace todavía (y por qué)

Esto es importante, para no confundirse:

- **No se comparte entre los cuatro.** Cada equipo guarda su propio presupuesto. Lo compartido en tiempo real es la etapa 2, y necesita la base de datos (Firebase, plan gratuito).
- **No hay ventas ni balance.** Las pestañas `Ventas` y `Balance` muestran qué van a tener.
- **No hay usuarios.** No hay contraseña ni quién cargó qué.
- **Un presupuesto a la vez.** El botón `Nuevo` borra el actual (pide confirmación). El historial es etapa 3.

> Si se borran los datos del navegador (o se abre en otro equipo), el presupuesto guardado no aparece. Mientras no esté la base de datos, **lo que hay que conservar se imprime o se manda por WhatsApp.**

---

## 3. De dónde salen los precios (y qué pasa si los cambiás en la app)

La planilla es el punto de partida, no una jaula. Hay dos caminos y los dos son válidos:

**Camino corto, desde la app:** `Productos` → `Editar` → precio nuevo → `Guardar`. Queda marcado como **Precio propio**.

**Camino masivo, desde el Excel:** se cambia la hoja `PRECIOS` columna C, se corre `python _scripts\gen_catalogo.py` y se recarga la app.

```
PRESUPUESTO.xlsx → hoja PRECIOS → gen_catalogo.py → app/js/catalogo.js  (semilla)
                                                              ↓
                                              la app guarda su copia editable
```

La regla que evita perder plata:

- `Traer de la planilla` **agrega** los productos nuevos, **actualiza** los precios que nadie tocó y **respeta** los que tienen `Precio propio`.
- **Nunca borra** un producto creado en la app.
- Tocar solo el **stock** no marca el precio como propio: la planilla lo sigue actualizando.
- La app avisa cuántos agregó, actualizó y respetó, en la misma pantalla.

**El stock no existe en el Excel.** Es siempre de la app: hoy se carga a mano y en la etapa 2 lo descuenta cada venta.

El generador copia también el paso de corte (`PRECIOS!H1`, hoy 0,5 m) y los teléfonos. Si cambia el paso, la app cambia sola.

---

## 4. El diseño, y por qué es así

La app no usa una plantilla: los colores salen del logo real de la marca.

| Color | De dónde | Dónde se usa |
|---|---|---|
| `#EE1D23` rojo | la banda del cartel | la línea del membrete, el botón de WhatsApp, el foco |
| `#875E37` madera | el anillo del leño | textos secundarios, el "se pide" |
| `#EEBB81` arena | la madera clara | detalles y numeración |
| `#2B2118` tinta | — | texto |
| `#FAF6EF` papel | — | fondo, para que la hoja blanca se despegue |

- **Se ve como una hoja de presupuesto, no como un formulario.** Los datos del cliente son renglones para escribir, la tabla tiene las mismas columnas que el papel y el total va abajo a la derecha, como en la planilla.
- **Letra del sistema.** Nada de fuentes que haya que bajar: abre igual sin internet.
- **Los números grandes en serif** (Georgia), como el cartel de la marca; los del día a día en sans, que se lee mejor.
- **Medidas pensadas para el notebook** (1366×768): el presupuesto entra completo sin scrollear, con la barra de acciones siempre a mano.
- **En el celular** cada línea se convierte en una tarjeta: producto arriba, cantidad y largo en el medio, precio y total abajo. Nada se corta ni se sale de la pantalla.
- **Rojo solo para la marca y las acciones.** Los avisos van en ámbar, para que un error no se confunda con el logo.

---

## 5. Cómo se prueba

```
node --test "tests/*.test.mjs"
```

| Archivo | Qué comprueba |
|---|---|
| `tests/engine.test.mjs` | La cuenta: redondeo al paso de corte, coma y punto, `REVISAR LARGO`, `SIN PRECIO`, el mensaje de WhatsApp |
| `tests/catalogo.test.mjs` | Que el catálogo generado tenga los 87 productos, 30 con precio, 26 por metro lineal y los teléfonos |
| `tests/productos.test.mjs` | Que un precio editado en la app no se pise, que el stock no se pierda y que traer la planilla nunca borre |
| `tests/pantalla.test.mjs` | Abre la app de verdad en Edge, carga un presupuesto y verifica totales, alta de producto y recálculo en pantalla |

El de pantalla es el que importa: los otros pueden pasar mientras la pantalla muestra cualquier cosa. Ya pasó dos veces durante el desarrollo y las dos las cazó ese test.

---

## 6. Los archivos

```
app/
  index.html          la pantalla
  css/app.css         el diseño (colores, medidas, celular)
  css/print.css       la hoja impresa / PDF
  js/catalogo.js      GENERADO desde el Excel — no editar a mano
  js/engine.js        la cuenta, sin pantalla: se puede probar solo
  js/productos.js     qué es un producto válido y cómo se fusiona con la planilla
  js/app.js           dibuja, guarda y conecta los botones
  assets/logo.png     el logo real, sacado del Excel
tests/                las pruebas
```

`engine.js` no sabe que existe una pantalla: recibe productos y devuelve totales. Por eso se puede probar sin abrir el navegador, y por eso la misma cuenta va a servir para la etapa 2.

---

## 7. Lo que sigue

1. **Etapa 2 — ventas y balance compartido.** Firebase Firestore (plan gratuito): los cuatro ven lo mismo al instante, y sigue andando si se corta internet.
2. **Balance por fecha.** Se termina el problema de las filas fijas: cualquier mes, cualquier año.
3. **Etapa 3 — usuarios e historial.** Cada carga firmada, presupuestos guardados y buscables, y exportación al Excel de siempre.
