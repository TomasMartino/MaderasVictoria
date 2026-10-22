"""Genera app/js/catalogo.js desde la hoja PRECIOS del PRESUPUESTO.

El presupuesto Excel sigue siendo la fuente de la lista de precios: se edita
ahi y se vuelve a correr este script. La app nunca inventa precios.
"""
import datetime
import json
import os

import openpyxl

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRESU = os.path.join(BASE, "PRESUPUESTO.xlsx")
OUT = os.path.join(BASE, "app", "js", "catalogo.js")

wb = openpyxl.load_workbook(PRESU)
ws = wb["PRECIOS"]

paso = ws["H1"].value
productos = []
for r in range(2, 89):
    nombre = ws.cell(r, 1).value
    if not nombre:
        continue
    precio = ws.cell(r, 3).value
    productos.append(
        {
            "n": nombre,
            "u": ws.cell(r, 2).value,
            "p": precio if isinstance(precio, (int, float)) else None,
            "l": ws.cell(r, 4).value == "SI",
        }
    )

# el logo y los telefonos salen del mismo archivo que usa el primo
tel = [wb["CLIENTES"].cell(r, 7).value for r in (2, 3)]
tel = [str(t) for t in tel if t]

data = {
    "paso": float(paso),
    "actualizado": datetime.date.today().isoformat(),
    "negocio": {"nombre": "Maderas Victoria", "telefonos": tel},
    "productos": productos,
}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
cuerpo = json.dumps(data, ensure_ascii=False, indent=1)
with open(OUT, "w", encoding="utf-8") as fh:
    fh.write("// GENERADO desde PRESUPUESTO.xlsx (hoja PRECIOS). No editar a mano.\n")
    fh.write(f"// Productos: {len(productos)} | paso de corte: {paso} m\n")
    fh.write(f"window.TV_CATALOGO = {cuerpo};\n")

con_precio = sum(1 for p in productos if p["p"] is not None)
print(f"{OUT}: {len(productos)} productos ({con_precio} con precio), paso {paso}")
