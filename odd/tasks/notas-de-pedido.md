# notas-de-pedido — registro, señas y cobro de notas de pedido

Objective: registrar las notas de pedido generadas, marcar su estado (pendiente / señado / pagado / dado de baja) y que la plata entre en ventas diarias y balance sin duplicar ventas.
Branch: `main`. Delivery: work-unit commits. Test runner: `node --test "tests/*.test.mjs"`.

## Specs

- **S1** — Al elegir el tipo "Nota de pedido" aparece un botón **Registrar nota** que la guarda en una sección nueva de la app. No depende de enviar por WhatsApp.
- **S2** — La sección nueva se llama "Notas de pedido" y lista: cliente, número, fecha, total, seña, faltante y estado.
- **S3** — Cada nota se puede marcar como **pagada**, **señada** o **dada de baja**.
- **S4** — Al marcar pagada, la app **pregunta** si quiere cargar la venta diaria del total. Si el usuario dice que no, la nota queda pagada sin venta.
- **S5** — La seña la escribe el usuario; el faltante se calcula (`total - seña`).
- **S6** — Al registrar una seña, la app **pregunta** si quiere cargar la seña como venta diaria.
- **S7** — La venta asociada se llama `"<cliente> (señalizado)"` mientras falta plata y `"<cliente> (finalizada)"` cuando se cobra el total.
- **S8** — Al cobrar el faltante, se **actualiza la misma venta** (no se crea otra): la seña + el faltante quedan en una sola venta.
- **S9** — Dar de baja deja la nota inactiva; si tenía venta cargada, pregunta si anularla.
- **S10** — Ventas diarias y balance se actualizan solos, porque el balance se calcula desde las ventas.
- **S11** — La seña y el pago final piden **medio de pago** (Efectivo / Transferencia / Tarjeta). La nota guarda `medioSena` y `medioFinal`; la venta asociada queda con un solo medio: el de la seña mientras está señalada y el del pago final al quedar pagada.
- **S12** — El sello en el PDF (PAGADO / SEÑADO) queda **fuera de alcance**: el usuario lo descartó.

Assumptions (no confirmadas con el usuario, avisadas en el mensaje final):
- La nota usa el mismo número del documento y su fecha es la del documento.
- Si se vuelve a generar la misma nota (mismo número), se actualiza y no se duplica.
- La venta asociada se carga en Efectivo (se puede editar después en Ventas).
- Datos en Firestore (`notas`) con espejo en localStorage, igual que ventas y gastos.

## Tasks

| ID | Task | Spec | Route | Status | Evidence |
|---|---|---|---|---|---|
| T1 | Módulo puro `app/js/notas.js` + tests | S2, S5, S7 | inline | done | `tests/notas.test.mjs` |
| T2 | Vista "Notas de pedido" (nav, HTML, CSS) | S1, S2, S3 | inline | done | `app/index.html`, `app/css/app.css` |
| T3 | Datos: localStorage + Firestore `notas` + reglas | S1 | inline | done | `app/js/app.js`, `firestore.rules` |
| T4 | Botón "Registrar nota" visible sólo con tipo Nota de pedido | S1 | inline | done | `#nota-registrar`, `marcarTipo()` |
| T5 | Acciones con modal: monto de seña + medio de pago + "cargar venta" | S3, S4, S5, S6, S8, S9, S11 | inline | done | `#nota-form`, `abrirModalNota()`, `confirmarModalNota()` |
| T6 | Venta única señalizada → finalizada | S7, S8, S10 | inline | done | `editarVenta` sobre `nota.ventaId` |

## Log

- **L1** (2026-10-30, pedido del primo, transmitido por el usuario): "cuando pongas nota de pedido poneme en una parte o configurame algo para agregar que diga pagado, que quede con un sello o algo que diga que esta pagado, señado con el monto señado y lo faltante, o en ultima instancia dado de baja, que la seña que ponen ellos la escribo yo". El usuario interpreta: sección nueva donde queda registrada la nota y se marca pagado/señado/baja; si está pagada se registra como venta diaria (preguntando); si es seña se pregunta si cargarla, y al cobrar el faltante la misma venta pasa a finalizada; todo debe reflejarse en ventas diarias y balance.
- Sello impreso en el PDF (PAGADO / SEÑADO): pedido original del primo, **no implementado** en esta unidad; la sección cubre el estado. Queda como próximo paso si lo quieren en el papel.
