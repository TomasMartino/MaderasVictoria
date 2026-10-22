import os
import zipfile
import xml.etree.ElementTree as ET

import openpyxl

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
BASE = r"C:\Users\User\Desktop\Proyecos\TioVity"
PRESU = os.path.join(OUT, "PRESUPUESTO.xlsx")
INGRE = os.path.join(OUT, "Ingresos Y Gastos Semanales.xlsx")
LISTA = os.path.join(OUT, "LISTA DE PRECIOS.xlsx")

ok, fail = [], []


def check(cond, msg):
    (ok if cond else fail).append(msg)


# ---------- XML well formedness for every part
for path in (PRESU, INGRE, LISTA):
    with zipfile.ZipFile(path) as z:
        bad = []
        for n in z.namelist():
            if n.endswith(".xml") or n.endswith(".rels"):
                try:
                    ET.fromstring(z.read(n))
                except Exception as e:
                    bad.append((n, e))
        check(not bad, f"{os.path.basename(path)}: XML valido ({len(z.namelist())} partes) {bad}")

# ---------- logo
with zipfile.ZipFile(BASE + r"\PRESUPUESTO.xlsx") as zo, zipfile.ZipFile(PRESU) as zn:
    for part in ("xl/media/image1.png", "xl/media/image2.jpg",
                 "xl/drawings/drawing1.xml", "xl/drawings/_rels/drawing1.xml.rels"):
        check(zo.read(part) == zn.read(part), f"logo byte-identico: {part}")
    sheet = zn.read("xl/worksheets/sheet1.xml").decode()
    check('<drawing r:id="rId1"/>' in sheet, "sheet1 referencia el drawing")
    check(zn.read("xl/worksheets/_rels/sheet1.xml.rels").decode().count("drawing1.xml") == 1,
          "sheet1.xml.rels apunta al drawing")
    ct = zn.read("[Content_Types].xml").decode()
    check('Extension="png"' in ct and "drawing1.xml" in ct, "content types declara png + drawing")
    # order: drawing before tableParts/extLst if present
    check(sheet.index("<drawing") < len(sheet) - 12, "drawing al final del sheet")

# ---------- PRESUPUESTO content
wb = openpyxl.load_workbook(PRESU)
check(wb.sheetnames == ["CLIENTES", "PRECIOS"], f"hojas: {wb.sheetnames}")
ws = wb["CLIENTES"]
sh = wb["PRECIOS"]
check(sh.sheet_state == "hidden", "hoja PRECIOS oculta")
rows = [r for r in range(2, sh.max_row + 1) if sh.cell(r, 1).value]
check(len(rows) == 87, f"catalogo: {len(rows)} productos")
check(len({sh.cell(r, 1).value for r in rows}) == 87, "catalogo sin duplicados")

dvs = ws.data_validations.dataValidation
check(len(dvs) == 3, f"cantidad de validaciones: {len(dvs)}")
dv = [d for d in dvs if "C8" in str(d.sqref)][0]
check(dv.formula1 == "PRECIOS!$A$2:$A$88", f"dropdown rango: {dv.formula1}")
check(str(dv.sqref) == "C8:C85", f"dropdown celdas: {dv.sqref}")
dvl = [d for d in dvs if "H8" in str(d.sqref)][0]
check(dvl.type == "decimal" and dvl.formula1 == "0.5" and dvl.formula2 == "50",
      f"validacion de largo: {dvl.type} {dvl.formula1}-{dvl.formula2}")
check("COMA" in dvl.error, "mensaje de coma decimal")
check(any("PRESUPUESTO" in str(d.formula1) for d in dvs), "validacion de tipo de documento intacta")

merged = [str(m) for m in ws.merged_cells.ranges]
for r in (8, 26, 40, 53, 84, 85):
    for a, b in (("A", "B"), ("C", "F"), ("H", "I"), ("J", "K")):
        check(f"{a}{r}:{b}{r}" in merged, f"merge {a}{r}:{b}{r}")
check("G26:K53" not in merged, "merge gigante eliminado")

for r in (8, 26, 53, 85):
    check(str(ws[f"L{r}"].value).startswith("=IF($C"), f"L{r} formula")
    check("ROUNDUP($H" in str(ws[f"J{r}"].value), f"J{r} redondea el largo")
    check(f"$A{r}*$J{r}*$L{r}" in str(ws[f"M{r}"].value), f"M{r} usa largo x precio")
    check(ws[f"J{r}"].number_format == "0.00", f"J{r} formato de medida")
    check(ws[f"M{r}"].number_format == "[$$]#,##0", f"M{r} formato moneda")

check(ws["J7"].value == "LARGO A PEDIR", f"encabezado J7: {ws['J7'].value}")
check(sh["H1"].value == 0.5, "paso de corte 0,50")
check(sh["G1"].value == "PASO DE CORTE (m)", "etiqueta paso de corte")

check(ws["L86"].value == "=SUM(M8:M85)", f"total: {ws['L86'].value}")
check(ws["C86"].value == "TOTAL", "etiqueta TOTAL")
check(wb.calculation.fullCalcOnLoad is True, "recalcula al abrir")

# catalog spot checks
cat = {sh.cell(r, 1).value: (sh.cell(r, 3).value, sh.cell(r, 4).value) for r in rows}
check(cat["ROLLIZO 13-15CM"] == (5000, "SI"), f"rollizo = {cat.get('ROLLIZO 13-15CM')}")
check(cat["PUNTALES 13-15"] == (5500, "NO"), f"puntales = {cat.get('PUNTALES 13-15')}")
check(cat["VIGA 25-30CM"] == (9500, "SI"), f"viga 25-30 = {cat.get('VIGA 25-30CM')}")
check(cat["MACHIMBRE 3/4 X4 1RA"] == (9900, "NO"), "machimbre 3/4x4")
check(sh["E2"].value.startswith("=IF($C2="), "columna PRECIO OK es formula")
check(len({sh.cell(r, 2).value for r in rows} & {"METRO LINEAL", "METRO 2", "UNIDAD"}) == 3,
      "unidades normalizadas")
check(not any(sh.cell(r, 2).value == "M2" for r in rows), "sin unidad M2 suelta")

# invariant: unit METRO LINEAL <=> MULTIPLICA LARGO = SI (a price per meter that
# does not multiply the length undercharges the whole length)
bad_mult = [
    (sh.cell(r, 1).value, sh.cell(r, 2).value, sh.cell(r, 4).value)
    for r in rows
    if (sh.cell(r, 2).value == "METRO LINEAL") != (sh.cell(r, 4).value == "SI")
]
check(not bad_mult, f"unidad vs MULTIPLICA LARGO coherentes: {bad_mult[:5]}")
lineales = [r for r in rows if sh.cell(r, 2).value == "METRO LINEAL"]
check(len(lineales) == 26, f"productos por metro lineal: {len(lineales)}")

# ---------- INGRESOS
wb2 = openpyxl.load_workbook(INGRE)
check(wb2.sheetnames == ["VENTAS DIARIAS", "BALANCE", "TARJETAS"], f"hojas: {wb2.sheetnames}")
wsb = wb2["BALANCE"]
check(wsb["C4"].value is None, "C4 (sin fecha) queda vacia")
check(wsb["C7"].value == "=IF($A7=\"\",\"\",SUMIF('VENTAS DIARIAS'!$B$2:$B$5000,$A7,'VENTAS DIARIAS'!$E$2:$E$5000))",
      f"C7: {wsb['C7'].value}")
check(wsb["C37"].value is not None, "C37 con formula")
for r in (10, 17, 24, 31, 39):
    check(str(wsb[f"C{r}"].value).startswith("="), f"total C{r} intacto")
for col in "CDEFG":
    check(wsb[f"{col}38"].value == f"=SUM({col}32:{col}37)", f"total semana 5 {col}38")
check(wsb["H4"].value == "=C4" and wsb["J4"].value == "=H4-I4", "columnas H/J intactas")
check(wsb["I39"].value == "=I10+I17+I24+I31+I38", "total mensual intacto")
check(wb2.calculation.fullCalcOnLoad is True, "balance recalcula al abrir")
with zipfile.ZipFile(INGRE) as z:
    check("xl/tables/table1.xml" in z.namelist(), "tabla INGRESOS_DIARIOS preservada")

# ---------- LISTA
wb3 = openpyxl.load_workbook(LISTA)
ws3 = wb3["Hoja1"]
names = [ws3.cell(r, 2).value for r in range(2, 89)]
check(len([n for n in names if n]) == 87, f"lista: {len([n for n in names if n])} productos")
check(len(set(names)) == len(names), "lista sin duplicados")
check(ws3["B89"].value == "TODOS LOS PRECIOS SON MAS IVA", f"pie: {ws3['B89'].value}")
check("B89:D89" in [str(m) for m in ws3.merged_cells.ranges], "pie fusionado")
check(sorted(n for n in names if n) == sorted(cat.keys()), "lista y catalogo tienen los mismos productos")

print(f"OK: {len(ok)}")
print(f"FALLAS: {len(fail)}")
for f in fail:
    print("  X", f)
