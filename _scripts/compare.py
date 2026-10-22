"""Cell-by-cell diff between the pristine backup and the deployed workbook."""
import openpyxl

BAK = r"C:\Users\User\Desktop\Proyecos\TioVity\respaldo 2026-10-22\Ingresos Y Gastos Semanales (1).xlsx"
NEW = r"C:\Users\User\Desktop\Proyecos\TioVity\Ingresos Y Gastos Semanales (1).xlsx"

a = openpyxl.load_workbook(BAK)
b = openpyxl.load_workbook(NEW)

print("hojas original:", a.sheetnames)
print("hojas nuevas  :", b.sheetnames)


def sig(cell):
    return (cell.value, cell.number_format, tuple(cell._style),
            getattr(cell.fill.fgColor, "rgb", None))


for name in a.sheetnames:
    wa, wb_ = a[name], b[name]
    diffs = []
    for row in wa.iter_rows(min_row=1, max_row=max(wa.max_row, wb_.max_row),
                            max_col=max(wa.max_column, wb_.max_column)):
        for c in row:
            d = wb_[c.coordinate]
            if sig(c) != sig(d):
                diffs.append((c.coordinate, c.value, d.value, c.number_format, d.number_format))
    ma = sorted(str(m) for m in wa.merged_cells.ranges)
    mb = sorted(str(m) for m in wb_.merged_cells.ranges)
    ca = {k: v.width for k, v in wa.column_dimensions.items() if v.width}
    cb = {k: v.width for k, v in wb_.column_dimensions.items() if v.width}
    ha = {k: v.height for k, v in wa.row_dimensions.items() if v.height}
    hb = {k: v.height for k, v in wb_.row_dimensions.items() if v.height}
    print(f"\n=== {name} ===")
    print(f"  celdas distintas: {len(diffs)}  | merges nuevos: {ma == mb} | anchos iguales: {ca == cb} | altos iguales: {ha == hb}")
    print(f"  freeze: {wa.freeze_panes} -> {wb_.freeze_panes} | estado: {wa.sheet_state} -> {wb_.sheet_state}")
    print(f"  validaciones: {len(wa.data_validations.dataValidation)} -> {len(wb_.data_validations.dataValidation)}")
    for d in diffs[:60]:
        print("   ", d)
    if len(diffs) > 60:
        print(f"    ... y {len(diffs)-60} mas")
