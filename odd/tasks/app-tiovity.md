# app-tiovity — presupuesto en pantalla para Maderas Victoria

Objective: turn the Excel quote workflow into a screen the uncle and three cousins can use, starting with the quote (etapa 1), keeping the Excel as the source of prices.
Branch: `main` (local only). Delivery: work-unit commits, no push.
Test runner: `node --test "tests/*.test.mjs"` (Node 24, Edge headless for the screen test).

## Specs

- **S1** — Four users (uncle + 3 cousins) share the same data, editing from different areas, always up to date in real time. Etapa 2 (Firestore Spark, $0). Etapa 1 must **not pretend** it shares: the app says "Guardado en este equipo".
- **S2** — "Los datos no se borran cuando cierro la página": the quote must survive reopening.
- **S3** — "No hay plata para una base de datos": the chosen backend must cost $0 with no card and no surprise bill.
- **S4** — "No tocar TARJETAS en el Excel" (uncle's explicit rule). The app never reads or writes `TARJETAS`.
- **S5** — Budget and income/expenses stay separate: "un presupuesto que no se cierra no deja rastro".
- **S6** — The balance must stop being manual by date: any month, any year (etapa 2).
- **S7** — "Investiga y hacé algún diseño a la medida para ellos": real logo and palette, notebook first (1366×768), phone must not break. Verbatim: "si usas el logo sos un crack".
- **S8** — "Mi tío no sabe nada de Excel": no syntax traps. Accept `4,2` and `4.2`; every error names the line.
- **S9** — Same math as `PRESUPUESTO.xlsx`: `J = ROUNDUP(largo/paso)*paso` with `paso = PRECIOS!H1 = 0,5`; `M = cantidad × largo a pedir × precio` for METRO LINEAL, `cantidad × precio` otherwise; `SIN PRECIO` never sums; `REVISAR LARGO` replaces the total; prices are "más IVA".
- **S10** — Delivery: printable sheet / PDF with logo, and a WhatsApp message with detail and total.

## Tasks

| ID | Task | Spec | Route | Status | Evidence |
|---|---|---|---|---|---|
| T1 | Catalog generator from `PRECIOS` rows 2-88 | S9 | inline | done | `_scripts/gen_catalogo.py` → 87 products, 30 with price, paso 0.5 |
| T2 | Pure engine: parse, roundup, line, summary, whatsapp text | S8, S9, S10 | inline | done | `app/js/engine.js`, 18 tests |
| T3 | Screen: rail, paper, lines, warnings, autosave | S2, S7, S8 | inline | done | `app/index.html`, `app/css/app.css`, `app/js/app.js` |
| T4 | Print sheet / PDF | S7, S10 | inline | done | `app/css/print.css`, verified on A4 render + real PDF |
| T5 | WhatsApp text moved into the engine | S10 | inline | done | `TV.textoPresupuesto`, 3 tests |
| T6 | Data contract test | S9 | inline | done | `tests/catalogo.test.mjs`, 8 tests |
| T7 | Screen smoke test in real browser | S2, S8, S9 | inline | done | `tests/pantalla.test.mjs`, 5 tests |
| T8 | Docs: app guide + root README pointer | S7, S8 | inline | done | `app/README.md`, `README.md` §1 |
| T9 | Repo + work-unit commits | — | inline | done | `git init -b main`, 4 commits by unit, no push |

## Log

- **L1** — Request (compacted; verbatim fragments preserved): build the budget + income/expenses workflow as a shared, real-time web app for 4 users from different devices; nothing may reset when the page reopens; no money for a database (asked whether the Excel or a JSON could be the DB); devices are tablets/phones but mainly notebooks; "mi tío no sabe nada de Excel" so it must be very interactive; "no tocar TARJETAS"; place is "Maderas Victoria"; "investiga y hace algún diseño a la medida para ellos".
- **L2** — "si usas el logo sos un crack": use the real logo. Extracted `xl/media/image1.png` (46,267 B) from `PRESUPUESTO.xlsx` → `app/assets/logo.png`; sampled palette: red `#EE1D23`, wood `#875E37`, sand `#EEBB81`. `image2.jpg` is the WhatsApp icon (already in their workflow).
- **L3** — Real-time for four users needs a central DB. Excel/JSON as a live DB rejected: a file cannot arbitrate writes, Pages is read-only, a browser token would expose salaries/providers/debts. Firestore Spark verified: 1 GiB, 50k reads/day, 20k writes/day, offline included, no inactivity pause, no surprise bill. Supabase Pro discarded (free pauses after a week, no backups).
- **L4** — Bug found while first rendering: every line showed `SIN PRECIO`. Cause: the screen state stores the product **name**, the engine expects the product **object**. Engine tests passed because they passed objects. Fix: `TV.crearCalculadora(catalogo)` owns the name→product translation, in one place, with its own test. The screen smoke test now covers that boundary.
- **L5** — Bug found by the smoke test: `var elTotal` inside `recalcular()` shadowed the footer total, so the grand total was painted into the last line and the sheet total stayed `$ 0`. Renamed the row locals.
- **L6** — Bug found in the PDF: `@media (max-width: 900px)` also matched the 794px A4 page, so the printed sheet inherited the phone card layout (stacked columns, select printing its whole option label). Fix: all responsive queries are now `@media screen and (...)`. Print shows the bare product name (`prod-nombre`) and a real `A PEDIR` column.
- **L7** — Print header hid the product name: `.linea .f > span { display: none }` outranked `.linea .prod-nombre`. Fixed with `:not(.prod-nombre)` and a more specific selector.
- **L8** — Mobile overflow: the native `select` imposes its widest option as min-content and blew the 2-column card grid past 390px. Fix: `minmax(0, 1fr)` tracks. Verified with a real 390px iframe viewport (headless Edge ignores `--window-size` below ~500): `scrollWidth === clientWidth === 390`, zero overflowing elements.
- **L9** — Verification: `node --test "tests/*.test.mjs"` → 34/34 pass. Visual review at 1440×1000, 1366×768, 390×844 (iframe), A4 print render, and a real `--print-to-pdf` file (122 KB).
- **L10** — Open product decisions carried from the Excel work (not app bugs): charge cut length (4,50) vs real (4,20); `DOLARES 05/03` pesos or dollars; `TABLAS DE PINO CEP. 3/4X4` dual price; 57 products without price; m² not computed automatically.
