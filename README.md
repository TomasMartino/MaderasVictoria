# Presupuestos y Balance — Maderas Victoria

Guía de uso y de límites. Si algo de acá no coincide con lo que ves en el Excel, avisá: es un error del sistema, no tuyo.

Última actualización: 22/10/2026

---

## 1. Los archivos

| Archivo | Para qué sirve | Se toca |
|---|---|---|
| `PRESUPUESTO.xlsx` | Hacer el presupuesto de un cliente | Sí, todos los días |
| `LISTA DE PRECIOS.xlsx` | Lista de precios para imprimir o mandar | Solo para imprimir |
| `Ingresos Y Gastos Semanales (1).xlsx` | Cargar ventas y ver el balance | Sí: ventas y egresos |
| `app\` | El presupuesto y la lista de productos en pantalla (ver `app\README.md`) | Sí, se abre con doble clic |
| `tests\` | Pruebas automáticas de la app | No |
| `respaldo 2026-10-22\` | Copia de los archivos originales | **No** |
| `_scripts\` | Programas que generan los Excel y el catálogo de la app | **No** (es solo respaldo técnico) |

> **La app no reemplaza a los Excel todavía.** Hoy hace el presupuesto en pantalla, con los mismos precios de `PRESUPUESTO.xlsx`. Las ventas y el balance siguen en `Ingresos Y Gastos Semanales (1).xlsx`.
>
> Los precios se pueden cambiar **en la app** (`Productos` → `Editar`) o **en el Excel**. Si se cambia en la planilla, después se corre `python _scripts\gen_catalogo.py` y la app actualiza solo los productos que nadie tocó a mano: lo que se editó en la app no se pisa, y no se borra nada.

---

## 2. Cómo se conectan (y cómo NO se conectan)

Son **dos mundos separados**. A propósito.

```
   LISTA DE PRECIOS.xlsx
            |
            |  es la misma tabla, copiada
            v
   PRESUPUESTO.xlsx
     hoja oculta PRECIOS  ----->  precio, unidad, si multiplica el largo
     hoja CLIENTES        ----->  lo que cargas vos
            |
            v
     TOTAL (fila 86)  -->  se lo mandas al cliente
                           FIN. No escribe nada en el balance.


   VENTAS DIARIAS  (cargas cada venta)
            |
            |  SUMAR.SI por fecha
            v
   BALANCE  (ventas, gastos, resultado del mes)


   TARJETAS  (manual, independiente, no se tocó)
```

**Por qué el presupuesto no llega al balance:** porque un presupuesto no es una venta. Si el trato no se cierra, el presupuesto se tira y la contabilidad no se ensucia. La venta entra al balance **solo** cuando la cargas en `VENTAS DIARIAS`.

**Por qué `TARJETAS` está separada:** porque así lo pidió el dueño. No se automatizó, no se modificó y no se alimenta de ninguna otra hoja.

---

## 3. Presupuesto, paso a paso

### 3.1 Lo que tenés que cargar

| Dónde | Qué |
|---|---|
| C1 / C2 / C3 | Nombre, dirección y teléfono del cliente |
| G1 | Fecha del presupuesto |
| J1 | Tipo de documento: PRESUPUESTO, NOTA DE PEDIDO, REMITO o RECIBO (es solo un rótulo) |
| A (filas 8 a 85) | Cantidad |
| C (filas 8 a 85) | Producto, elegido del desplegable |
| H (filas 8 a 85) | LARGO REAL: lo que pide el cliente, en metros y **con coma** (`4,2`) |
| E y G | Texto libre (diámetro, detalle). Opcional, no afecta las cuentas |

### 3.2 Lo que hace solo

| Columna | Qué calcula |
|---|---|
| J — LARGO A PEDIR | El largo redondeado hacia arriba al múltiplo de 0,50 que se corta: `4,2 → 4,50` · `4,7 → 5,00` · `3,66 → 4,00` |
| L — PRECIO X METRO/U | Busca el producto en la hoja oculta `PRECIOS` |
| M — PRECIO TOTAL | `cantidad × largo a pedir × precio` si el producto se cobra por metro; `cantidad × precio` si se cobra por unidad |
| L86 — TOTAL | Suma de todos los totales |

### 3.3 Qué producto multiplica el largo

El dato vive en la hoja oculta `PRECIOS`, columna **MULTIPLICA LARGO**. La regla es la unidad:

- **METRO LINEAL** (rollizos, postes, vigas): el precio es por metro, así que se multiplica por el largo. 26 productos.
- **UNIDAD** (puntales, alfajías, tablas, membranas): se multiplica solo por la cantidad.
- **METRO 2** (machimbre, deck, fenólicos): ídem unidad; ver el límite en el punto 6.

### 3.4 Cambiar un precio

Se cambia **en la hoja oculta `PRECIOS`, columna C**, y listo: el presupuesto lo toma al instante.

La hoja está oculta: clic derecho sobre cualquier pestaña → "Mostrar" → `PRECIOS`.

> El archivo `LISTA DE PRECIOS.xlsx` **no** alimenta al presupuesto. Es una copia para imprimir. Si cambiás un precio ahí, el presupuesto no se entera.

---

## 4. Balance, paso a paso

### 4.1 Ventas

En `VENTAS DIARIAS`, una fila por venta:

| Columna | Qué |
|---|---|
| B — FECHAS | Fecha de la venta |
| C — TIPO DE INGRESO | EFECTIVO, TRANSFERENCIA, etc. (texto libre) |
| D — DETALLE | Qué se vendió |
| E — MONTO | El importe |

El balance la busca por fecha y la suma. No hay que tocar `BALANCE` para las ventas.

### 4.2 Egresos

En `BALANCE` se cargan a mano, por día:

| Columna | Qué |
|---|---|
| D | Gastos |
| E | Impuestos |
| F | Sueldos |
| G | Proveedores |

`I` (Total Egresos) y `J` (Resultado Neto) se calculan solos.

### 4.3 Estructura del balance

Cinco bloques de semana, cada uno con su total:

| Bloque | Días | Total semanal |
|---|---|---|
| Semana 1 | filas 4 a 9 | fila 10 |
| Semana 2 | filas 11 a 16 | fila 17 |
| Semana 3 | filas 18 a 23 | fila 24 |
| Semana 4 | filas 25 a 30 | fila 31 |
| Semana 5 | filas 32 a 37 | fila 38 |
| **Mes** | — | **fila 39** |

El bloque de la derecha (L5:S7, con los nombres y los aguinaldos) es una **nota**: no entra en ninguna cuenta.

---

## 5. Lo que SÍ se puede hacer

- Hacer presupuestos de hasta **78 productos** (filas 8 a 85).
- Cobrar por metro (rollizo, poste, viga) o por unidad, sin configurar nada: lo decide la unidad del producto.
- Cambiar el paso de corte: `PRECIOS!H1` (hoy `0,5`). Si algún día se corta cada 0,30, se cambia ahí y todo el presupuesto se adapta.
- Agregar productos nuevos a la lista (ver punto 6.7).
- Cargar ventas hasta la fila **5000** de `VENTAS DIARIAS`: el balance las busca hasta ahí.
- Usar el mismo archivo de presupuesto para distintos tipos de documento (presupuesto, remito, recibo).
- Seguir cargando egresos y ventas sin que nada se rompa: las fórmulas del balance cubren cualquier monto.

---

## 6. Lo que NO se puede hacer (y por qué)

### 6.1 No escribir el largo con punto

`4.2` con punto se guarda como **fecha** (4 de febrero) y multiplicaba el total por 10.000. Un presupuesto de $76.500 aparecía como $782.969.000.

**Siempre con coma: `4,2`.**

Hay dos protecciones puestas:
- La columna solo acepta números entre 0,5 y 50. Si escribís `4.2`, Excel te frena al salir de la celda.
- Si el valor entra igual (por ejemplo, pegado desde otro lado), en LARGO A PEDIR aparece **REVISAR LARGO** y el total queda vacío, en vez de calcular una barbaridad.

### 6.2 El balance es de octubre

`BALANCE` tiene fechas **del 1 al 31 de octubre de 2026**. Una venta con fecha de otro mes queda cargada en `VENTAS DIARIAS` pero **no aparece en el balance**, porque no existe la fila con esa fecha.

Para noviembre hace falta un bloque nuevo con sus fechas. Copiar un bloque y cambiarle las fechas funciona, pero es fácil equivocarse: pedilo y se agrega.

### 6.3 Un presupuesto no genera una venta

Por diseño. Si querés que la venta cuente, se carga en `VENTAS DIARIAS`. No hay traspaso automático.

### 6.4 Los precios son más IVA

La fila 86 lo dice: `PRECIOS MAS IVA`. El total **no** incluye IVA. La lista impresa repite el aviso al pie.

### 6.5 No mover ni renombrar cosas de la hoja PRECIOS

Las fórmulas apuntan a `PRECIOS!A2:E88` y a `PRECIOS!H1`. Si se mueven las columnas, se borra una fila del medio o se cambia el nombre de la columna, el presupuesto deja de encontrar los precios y todo dice NO EN LISTA.

### 6.6 No tocar TARJETAS

No se modificó (verificado celda por celda contra el original: 0 diferencias) y no hay que automatizarla. Si algo se rompe ahí, se arregla a mano como siempre.

### 6.7 No agregar productos al final de la lista

El desplegable y las búsquedas llegan hasta la fila 88. Para sumar un producto hay que **insertar una fila en el medio** de la lista (por ejemplo antes de la última): así Excel estira el rango solo y el producto aparece en el desplegable.

Agregarlo en la fila 89 o más abajo **no funciona**: no va a aparecer en el desplegable.

### 6.8 Los productos por METRO 2 no calculan el área

Machimbre, deck y fenólicos se cobran por m². El presupuesto **no** calcula m² a partir del largo: en CANTIDADES hay que poner los m² ya calculados.

Si querés cargar "3 tablas de 3,66 m de 3/4x4" y que él saque los m², eso hoy no está. Se puede agregar.

### 6.9 No hay control de dos personas a la vez

El archivo no está preparado para que dos personas lo editen al mismo tiempo. Si está abierto en otra computadora, hay que esperar o duplicar.

### 6.10 La hoja PRECIOS está oculta, no protegida

Oculta alcanza para que un cliente no la vea de casualidad, pero quien sepa Excel puede mostrarla. Si se manda el presupuesto afuera, conviene exportar a PDF.

---

## 7. Errores frecuentes y qué significan

| Aparece | Significa | Qué hacer |
|---|---|---|
| **REVISAR LARGO** | El largo no es un número válido (casi siempre: escrito con punto) | Escribirlo con coma: `4,2` |
| **SIN PRECIO** | El producto está en la lista pero no tiene precio cargado | Cargar el precio en `PRECIOS`, columna C (hoy faltan 57 de 87) |
| **NO EN LISTA** | El producto no existe en la lista, o está escrito distinto | Elegirlo del desplegable |
| LARGO A PEDIR vacío | El producto se cobra por unidad | Es correcto, no lleva largo |
| PRECIO TOTAL vacío | Falta el precio o falta la cantidad | Completar lo que falta |
| El total no suma | Alguna fila tiene producto sin precio | Buscar el SIN PRECIO |
| La venta de hoy no aparece en el balance | La fecha no existe en el balance (otro mes) | Ver 6.2 |

---

## 8. Reglas de negocio cargadas

- **Redondeo de largo**: siempre hacia arriba, al múltiplo de 0,50. Se configura en `PRECIOS!H1`.
- **Productos por metro**: cantidad × largo a pedir × precio por metro.
- **Productos por unidad**: cantidad × precio.
- **Rango válido de largo**: de 0,5 a 50 metros.
- **El total cobra el largo a pedir**, no el real: un pedido de 4,2 m se cobra como 4,50 m. *(Pendiente de confirmar: si querés cobrar el largo real, se cambia.)*
- **Precios sin IVA.**

---

## 9. Pendientes conocidos

1. **57 productos sin precio** (de 87). Mientras no tengan precio, el presupuesto avisa SIN PRECIO y no calcula el total.
2. **Fila DOLARES del 05/03** en el balance: no se tocó porque falta decidir si esos $1.000.000 son pesos o dólares.
3. **TABLAS DE PINO CEP. 3/4X4** viene con precio doble en la lista original (`$4000/$9000`). Hay que definir cuál corresponde.
4. **Cobrar largo a pedir vs largo real** (ver punto 8).
5. **Bloque de noviembre** en el balance, cuando empiece el mes.
6. **m² automático** para machimbre, deck y fenólicos (ver 6.8).
7. **Sincronizar** `LISTA DE PRECIOS.xlsx` con la hoja `PRECIOS` del presupuesto: hoy son dos copias y se pueden desincronizar.

---

## 10. Si algo no cierra

1. ¿Hay un `~$NOMBRE.xlsx` en la carpeta? Eso significa que el archivo quedó abierto en Excel.
2. Si hay que volver atrás: los originales están intactos en `respaldo 2026-10-22\`.
3. Cualquier cambio de fórmula, columna o precio se hace sobre los generadores de `_scripts\`, nunca a mano sobre el Excel (a mano se rompe en el siguiente cambio).
