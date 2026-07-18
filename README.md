# 📦 Sistema de Despachos

Aplicación web para el control de **despachos y entregas por cliente**, construida a
partir del histórico de despachos (`DESPACHO_1.xlsx` – hoja *HISTORICO PARCIAL*).

Permite dar seguimiento a las **órdenes de compra (OC)** de cada producto, a sus
**entregas parciales**, el **saldo pendiente** y el **estado** de cada orden.

## ✨ Funcionalidades

- **Resumen (dashboard)**: unidades pedidas vs. entregadas, % de cumplimiento,
  saldo pendiente, OC abiertas/cerradas, distribución por estado y ranking de
  productos con mayor saldo pendiente.
- **Productos**: tarjetas por producto con barra de progreso, saldo y estado.
- **Órdenes**: tabla con todas las OC (pedido, entregado, saldo, entregas, estado).
- **Detalle de producto**: cada OC con su listado de entregas (fecha, cantidad,
  documento/factura, saldo corrido y estado).
- **Búsqueda** por nombre de producto o número de OC, y **filtro por estado**.
- **Edición completa (CRUD)**: agregar/editar/eliminar clientes, productos,
  órdenes de compra y entregas. El saldo se recalcula automáticamente.
- **Multi-cliente**: gestiona varios clientes, cada uno con sus propios productos.
- **Persistencia local** en el navegador (`localStorage`).
- **Exportar / Importar** los datos en formato JSON y **restaurar** los datos
  originales del Excel.

### Estados reconocidos

`Abierta` · `En proceso` · `Pendiente por despachar` · `Abierta sin abono` ·
`Cerrada` · `Cerrada c/excedente` · `Excedente`

El texto libre del Excel (p. ej. *"CERRADA C/ EXCEDENTE"*, *"ABIERTA SIN ABONO"*)
se normaliza automáticamente a estos estados con su color correspondiente.

## 🚀 Uso

No requiere instalación ni compilación. Solo abre **`index.html`** en el navegador.

```
index.html            → estructura de la app
assets/styles.css     → estilos (tema oscuro, responsive)
assets/app.js         → lógica de la aplicación
assets/data.js        → datos semilla generados desde DESPACHO_1.xlsx
```

## 🗂️ Modelo de datos

```
Cliente
 └── Producto (p. ej. "PAN PAL DÍA")
      └── Orden de compra / OC (fecha, N° OC, cantidad pedida)
           └── Entrega (fecha, cantidad entregada, documento, saldo, estado)
```

Los datos precargados corresponden a **25 productos, 63 órdenes de compra y
132 entregas** del cliente inicial (*DESPACHO 1*).
