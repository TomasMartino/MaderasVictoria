# etapa2-ventas-balance — ventas, gastos y balance compartido en tiempo real

Objective: etapa 2 del app de Maderas Victoria. Ventas y balance compartido entre 4 usuarios en tiempo real con Firebase Firestore. Como en el Excel: ventas por un lado, balance por otro, y el balance se calcula solo a partir de las ventas y gastos cargados.

Branch: `main` (local only). Delivery: work-unit commits, no push.
Test runner: `node --test "tests/*.test.mjs"` (Node 24, Edge headless for the screen test).

## Specs

- **S1** — Ventas: se cargan ventas con fecha, medio de pago, detalle y monto. Cada venta queda firmada con el usuario que la cargó.
- **S2** — Ventas: se anulan con motivo (no se borran). Una venta anulada no suma al balance.
- **S3** — Gastos: se cargan gastos con fecha, concepto, categoría (impuesto / sueldo / proveedor / otro) y monto. Firmados con el usuario.
- **S4** — Balance: se calcula solo a partir de ventas y gastos. Ventas suman, gastos restan.
- **S5** — Balance: se filtra por rango de fechas (cualquier mes, cualquier año). No hay filas fijas.
- **S6** — Tiempo real: una venta o gasto cargado en una pantalla aparece al instante en las otras 3 pantallas (Firestore onSnapshot).
- **S7** — Auth: 5 cuentas, una por persona. Cada carga está firmada con el usuario que la hizo.
- **S8** — El balance no se toca a mano: es un cálculo derivado de ventas y gastos.
- **S9** — Si Firebase no está disponible, la app sigue funcionando en modo local (localStorage) para ventas y balance.

## Tasks

| ID | Task | Spec | Route | Status | Evidence |
|---|---|---|---|---|---|
| E1 | Firestore schema y reglas: colecciones ventas y gastos | S1, S3, S6, S7 | inline | pending | `app/js/firebase-config.js` actualizado, reglas Firestore |
| E2 | Vista de Ventas: formulario de carga + lista del día + anulación con motivo | S1, S2 | inline | pending | `#view-ventas` funcional |
| E3 | Vista de Balance: filtro por fechas, tabla de ventas/gastos por día, totales | S4, S5 | inline | pending | `#view-balance` funcional |
| E4 | Tiempo real: onSnapshot de ventas y gastos, se ve en todas las pantallas | S6 | inline | pending | onSnapshot conectado |
| E5 | Balance calculado: ventas suman, gastos restan, anuladas no suman | S4, S8 | inline | pending | totales correctos |
| E6 | Tests unitarios para ventas/gastos/balance | S1–S8 | inline | pending | `tests/ventas.test.mjs`, `tests/balance.test.mjs` |
| E7 | Docs: README de etapa 2 | S1–S8 | inline | pending | `app/README.md` sección etapa 2 |

## Log


- **L2** — Reglas de Firestore: archivo `firestore.rules` listo para copiar y pegar en Firebase Console (Firestore → Reglas → Publicar). Sin esto, ventas y gastos no se pueden leer ni escribir.
- **L3** — Las 5 cuentas de usuario ya están creadas en Firebase Authentication (vityDiamante, joacoDiamante, ezequielDiamante, Diamante + una más). Cada venta/gasto queda firmado con el usuario que lo cargó.
- **L4** — Modo local: si Firebase no está disponible, ventas y gastos se guardan en localStorage y la app sigue funcionando.
- **L1** — Request: continuar con la etapa 2 (ventas, gastos y balance compartido en tiempo real con Firebase). Como en el Excel: ventas por un lado, balance por otro, el balance se actualiza solo con las ventas.

## Log (append)

- L5 (23/10): Balance real: se reemplazó el placeholder de #view-balance por pantalla completa (rangos, subtotales semana/mes, desglose de gastos por categoría por día, exportar CSV, form de gastos Proveedores/Sueldos/Impuestos/Otro). Botón 'Traer de la planilla' eliminado; queda 'Descargar plantilla'. Commit 687ab25 + este.
