#!/usr/bin/env python3
"""
Genera assets/data.js a partir del archivo base DESPACHO_1.xlsx
(hoja "HISTORICO PARCIAL").

Uso:
    pip install openpyxl
    python3 scripts/build_data.py RUTA/A/DESPACHO_1.xlsx

Estructura esperada de la hoja (por bloque de producto):
    - Fila con el nombre del producto (solo columna A).
    - Fila de encabezado: FECHA | OC | CANTIDAD OC | CANTIDAD ENTREGADA |
      DOCUMENTO | FECHA ENTREGA | SALDO | ESTADO
    - Filas de ordenes de compra (OC): traen OC y/o CANTIDAD OC, y su
      primera entrega en la misma fila (columnas D-H).
    - Filas de entregas de continuacion: solo columnas D-H.
    - Fila "TOTAL UNIDADES ..." que cierra el producto (saldo total en G).
"""
import sys
import json
import datetime
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("Falta openpyxl. Instala con: pip install openpyxl")

CLIENTE = "DESPACHO 1"
HOJA = "HISTORICO PARCIAL"


def fmt(v):
    """Formatea un valor de celda a texto limpio (sin decimales sobrantes)."""
    if v is None:
        return ""
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, int):
        return str(v)
    return str(v).strip()


def is_date(v):
    return isinstance(v, (datetime.datetime, datetime.date))


def parse(xlsx_path):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb.worksheets[0]  # primera hoja (HISTORICO PARCIAL)

    productos = []
    prod = None
    orden = None

    for r in range(1, ws.max_row + 1):
        a, b, c, d, e, f, g, h = (ws.cell(r, col).value for col in range(1, 9))
        cells = [a, b, c, d, e, f, g, h]
        non_empty = [x for x in cells if x not in (None, "")]

        if not non_empty:
            continue  # fila en blanco / separador

        txt = " ".join(str(x) for x in non_empty).upper()

        # Fila TOTAL: cierra el producto y fija el saldo pendiente total.
        if "TOTAL" in txt:
            if prod is not None:
                prod["totalPendiente"] = fmt(g)
            orden = None
            continue

        # Fila de encabezado (FECHA | OC | ...): se ignora.
        if isinstance(a, str) and a.strip().upper().startswith("FECHA"):
            continue

        # Fila de nombre de producto: solo columna A con texto (no fecha).
        rest_empty = all(x in (None, "") for x in cells[1:])
        if a not in (None, "") and not is_date(a) and rest_empty:
            prod = {"producto": fmt(a), "ordenes": [], "totalPendiente": "0"}
            productos.append(prod)
            orden = None
            continue

        if prod is None:
            continue  # dato suelto antes de cualquier producto: se ignora

        # Nueva OC unicamente cuando trae CANTIDAD OC (col C): toda orden real
        # tiene una cantidad pedida. Una fila con OC (col B) pero sin cantidad
        # es una entrega de continuacion con una referencia secundaria.
        nueva_oc = c not in (None, "")
        if nueva_oc:
            orden = {
                "fecha": fmt(a),
                "oc": fmt(b),
                "cantidadOC": fmt(c),
                "entregas": [],
            }
            prod["ordenes"].append(orden)

        # Entrega (en la fila de la OC o en fila de continuacion).
        tiene_entrega = any(x not in (None, "") for x in (d, e, f, g, h))
        if tiene_entrega and orden is not None:
            documento = fmt(e)
            # En filas de continuacion, la col B lleva a veces una referencia
            # secundaria (p. ej. una OC de compra): la conservamos en el documento.
            if not nueva_oc and b not in (None, ""):
                documento = f"{documento} ({fmt(b)})".strip() if documento else fmt(b)
            orden["entregas"].append({
                "entregada": fmt(d),
                "documento": documento,
                "fechaEntrega": fmt(f),
                "saldo": fmt(g),
                "estado": fmt(h),
            })

    return productos


def main():
    if len(sys.argv) < 2:
        sys.exit("Uso: python3 scripts/build_data.py RUTA/A/DESPACHO_1.xlsx")
    xlsx_path = sys.argv[1]
    productos = parse(xlsx_path)

    version = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    clients = [{"cliente": CLIENTE, "hoja": HOJA, "productos": productos}]

    n_ord = sum(len(p["ordenes"]) for p in productos)
    n_ent = sum(len(o["entregas"]) for p in productos for o in p["ordenes"])

    out = Path(__file__).resolve().parent.parent / "assets" / "data.js"
    body = json.dumps(clients, ensure_ascii=False, indent=2)
    header = (
        "// Datos semilla generados desde DESPACHO_1.xlsx (HISTORICO PARCIAL)\n"
        "// Generado automaticamente por scripts/build_data.py — no editar a mano.\n"
        "// Cliente principal precargado. La app soporta multiples clientes.\n"
        f'window.SEED_VERSION = "{version}";\n'
        "window.SEED_CLIENTS = "
    )
    out.write_text(header + body + ";\n", encoding="utf-8")

    print(f"OK -> {out}")
    print(f"  version={version}")
    print(f"  productos={len(productos)}  ordenes={n_ord}  entregas={n_ent}")


if __name__ == "__main__":
    main()
