"""Genera app/js/catalogo.js desde la hoja PRECIOS del PRESUPUESTO.

Ojo: este archivo es la SEMILLA del catalogo, no la verdad absoluta. Desde la
app se pueden agregar productos y cambiar precios; esos cambios se guardan
aparte y no se pisan al volver a correr este script (la regla vive en
app/js/productos.js). La app nunca inventa precios: o salen de aca o los carga
una persona.
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
            "nombre": nombre,
            "unidad": ws.cell(r, 2).value,
            "precio": precio if isinstance(precio, (int, float)) else None,
            "pideLargo": ws.cell(r, 4).value == "SI",
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

con_precio = sum(1 for p in productos if p["precio"] is not None)
print(f"{OUT}: {len(productos)} productos ({con_precio} con precio), paso {paso}")
