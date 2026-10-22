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
- **S11** — A products section reachable from the rail showing every product with price, unit, whether it asks for length, stock and state (activo / sin precio / sin stock / dado de baja).
- **S12** — Products can be added and edited from the app: name, unit, price, "pide largo" (the formula) and stock. Names must be unique (case-insensitive) and non-empty; a price may be empty ("sin precio"), never negative.
- **S13** — Stock is a quantity available per product. Today it is a manual baseline; etapa 2 decrements it automatically with every sale. `sin contar` (null) is different from `0`: the first shows "—", the second "SIN STOCK".
- **S14** — `PRESUPUESTO.xlsx` seeds the catalog. Products edited in the app are marked and **never** silently overwritten by a re-import: importing from the sheet adds new products and updates only products not edited in the app, and never deletes.
- **S15** — A catalog change repaints the quote's product list and recalculates an open quote, so a price edit is reflected immediately (no stale totals).
- **S16** — "Dar de baja" instead of deleting: the product leaves the quote list but stays in the catalog and in already saved quotes.

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
| T10 | Catalog data layer (pure): shape, merge, add/edit/baja, validation | S12, S13, S14, S16 | inline | done | `app/js/productos.js` + `tests/productos.test.mjs` |
| T11 | Readable catalog field names (generator, engine, app, tests) | S12, S14 | inline | done | `catalogo.js` migrates `n/u/p/l` → `nombre/unidad/precio/pideLargo` |
| T12 | Products screen: list, search, unit filter, stock and states | S11 | inline | done | `#view-productos` |
| T13 | Product form: add/edit with the formula and stock, with validation | S12, S13 | inline | done | modal |
| T14 | Wiring: rebuild quote options + recalc on catalog change; import from sheet | S14, S15 | inline | done | `app.js` |
| T15 | Tests + docs for the products section | S11–S16 | inline | done | smoke test + `app/README.md` |

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

- **L11** — Request: "me gustaría que haya un apartado de productos o stock, que visualice todo eso y pueda seguir agregando productos sin problemas, que elija el precio, la fórmula y todo lo que tenga que considerar como vienen trabajando, después sí arranca con la parte 2". Asked one question (catalog only vs stock with sales vs manual stock). Answer: **"Catálogo + stock que baja solo con las ventas"**. Implemented as: stock field today (manual baseline), etapa 2 decrements it. No parallel stock ledger.
- **L12** — Price-source conflict resolved in code, not by asking: `catalogo.js` is the **seed**, the app keeps an editable copy, and `fusionar` adds new sheet products, updates unedited prices and never overwrites or deletes. `n/u/p/l` migrated to `nombre/unidad/precio/pideLargo` now, before Firestore documents are designed.
- **L13** — Bug caught by looking at the rendered screen: editing only the **stock** set the old `editado` flag, which showed a false "PRECIO PROPIO" badge and would have frozen that price against the sheet forever. Fix: the flag is now `propio` and only the three sheet-owned fields (precio/unidad/pideLargo) set it; the regression has its own test.
- **L14** — Two UI defects from the mobile capture: the 4th nav item ("Balance") was cut at 390 px and the summary left the word "stock" orphaned on its own line. Fix: at <=520 px the nav wraps to its own row with 4 even items; the summary wraps as whole items.
- **L15** — Verification: `node --test "tests/*.test.mjs"` → **60/60** pass, including 6 UI tests that drive the real screen (add product, price edit recalculation, duplicate rejection, search, baja/reactivar, actionbar hidden outside the quote). Visual check: 1440x1050, 1366x768 (notebook), 390x844 (iframe), modal open, real Edge headless.
- **L16** — Bug found by the new screen test: `filtrar` excluded inactive products by default, so after "Dar de baja" the product vanished from the catalog and there was no way to reactivate it. Fix: the catalog always shows them dimmed; only the quote picker hides them. Covered by the "dar de baja no rompe el presupuesto abierto" test.
