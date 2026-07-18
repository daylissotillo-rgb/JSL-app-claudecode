/* =========================================================================
   Sistema de Despachos — lógica de la aplicación (vanilla JS, sin build)
   Datos persistidos en localStorage. Semilla en assets/data.js
   ========================================================================= */
(function () {
  "use strict";

  const STORE_KEY = "despachos.v1";
  const state = {
    clients: [],
    activeClientId: null,
    view: "dashboard",
    search: "",
    status: "",
    detailProductIdx: null,
  };

  /* ----------------------------- Utilidades ----------------------------- */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const uid = () => "id" + Math.random().toString(36).slice(2, 9);

  function toNum(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return v;
    const n = Number(String(v).replace(/[^0-9.-]/g, ""));
    return isNaN(n) ? null : n;
  }
  const fmt = (n) =>
    n === null || n === undefined || isNaN(n)
      ? "—"
      : Number(n).toLocaleString("es-CO");

  function esc(s) {
    return String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function fmtDate(s) {
    if (!s) return "—";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    return s;
  }

  function toast(msg, type = "ok") {
    const el = $("#toast");
    el.textContent = msg;
    el.className = "toast " + type;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.hidden = true), 2600);
  }

  /* ----------------------- Clasificación de estados --------------------- */
  // Devuelve {key,label,cls} normalizando el texto libre del Excel.
  function classifyEstado(raw) {
    const t = (raw || "").toString().trim().toUpperCase();
    if (!t) return { key: "sin", label: "Sin estado", cls: "b-gray" };
    if (t.includes("EXCEDENTE") && t.includes("CERRAD"))
      return { key: "cerrada_exc", label: "Cerrada c/excedente", cls: "b-purple" };
    if (t.includes("EXCEDENTE"))
      return { key: "excedente", label: "Excedente", cls: "b-purple" };
    if (t.includes("CERRAD"))
      return { key: "cerrada", label: "Cerrada", cls: "b-green" };
    if (t.includes("SIN ABONO"))
      return { key: "sin_abono", label: "Abierta sin abono", cls: "b-red" };
    if (t.includes("PENDIENTE"))
      return { key: "pendiente", label: "Pendiente por despachar", cls: "b-orange" };
    if (t.includes("PROCESO"))
      return { key: "proceso", label: "En proceso", cls: "b-amber" };
    if (t.includes("ABIERTA") || t.includes("ABIERTO"))
      return { key: "abierta", label: "Abierta", cls: "b-blue" };
    return { key: "otro", label: raw, cls: "b-gray" };
  }

  const ALL_STATUS = [
    ["abierta", "Abierta"],
    ["proceso", "En proceso"],
    ["pendiente", "Pendiente por despachar"],
    ["sin_abono", "Abierta sin abono"],
    ["cerrada", "Cerrada"],
    ["cerrada_exc", "Cerrada c/excedente"],
    ["excedente", "Excedente"],
    ["sin", "Sin estado"],
  ];

  /* --------------------------- Cálculos por OC -------------------------- */
  function orderStats(order) {
    const cantOC = toNum(order.cantidadOC);
    let entregado = 0;
    let hasEntrega = false;
    let lastEstado = "";
    let lastSaldo = null;
    (order.entregas || []).forEach((e) => {
      const q = toNum(e.entregada);
      if (q !== null) {
        entregado += q;
        hasEntrega = true;
      }
      if (e.estado && e.estado.trim()) lastEstado = e.estado;
      const s = toNum(e.saldo);
      if (s !== null) lastSaldo = s;
    });
    // saldo: si la última entrega trae saldo explícito lo usamos, si no lo calculamos
    let saldo;
    if (lastSaldo !== null) saldo = lastSaldo;
    else if (cantOC !== null) saldo = cantOC - entregado;
    else saldo = null;

    let estado = lastEstado;
    if (!estado) {
      if (!hasEntrega) estado = "Pendiente por despachar";
      else if (saldo !== null && saldo <= 0) estado = "Cerrada";
      else estado = "Abierta";
    }
    return {
      cantOC,
      entregado,
      saldo,
      estado,
      cls: classifyEstado(estado),
      numEntregas: (order.entregas || []).filter((e) => toNum(e.entregada) !== null).length,
    };
  }

  function productStats(product) {
    let cantOC = 0,
      entregado = 0,
      saldoPend = 0,
      abiertas = 0,
      cerradas = 0;
    (product.ordenes || []).forEach((o) => {
      const s = orderStats(o);
      if (s.cantOC !== null) cantOC += s.cantOC;
      entregado += s.entregado;
      if (s.saldo !== null && s.saldo > 0) saldoPend += s.saldo;
      if (s.cls.key === "cerrada" || s.cls.key === "cerrada_exc") cerradas++;
      else abiertas++;
    });
    return { cantOC, entregado, saldoPend, abiertas, cerradas, numOrdenes: (product.ordenes || []).length };
  }

  /* ------------------------------ Estado -------------------------------- */
  function activeClient() {
    return state.clients.find((c) => c.id === state.activeClientId) || state.clients[0];
  }

  function save() {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ clients: state.clients, activeClientId: state.activeClientId })
    );
  }

  function normalizeClient(c) {
    return {
      id: c.id || uid(),
      cliente: c.cliente || "Cliente",
      hoja: c.hoja || "",
      productos: (c.productos || []).map((p) => ({
        id: p.id || uid(),
        producto: p.producto,
        totalPendiente: p.totalPendiente,
        ordenes: (p.ordenes || []).map((o) => ({
          id: o.id || uid(),
          fecha: o.fecha || "",
          oc: o.oc || "",
          cantidadOC: o.cantidadOC || "",
          entregas: (o.entregas || []).map((e) => ({
            id: e.id || uid(),
            entregada: e.entregada || "",
            documento: e.documento || "",
            fechaEntrega: e.fechaEntrega || "",
            saldo: e.saldo || "",
            estado: e.estado || "",
          })),
        })),
      })),
    };
  }

  function loadSeed() {
    return (window.SEED_CLIENTS || []).map(normalizeClient);
  }

  function load() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(STORE_KEY));
    } catch (e) {
      data = null;
    }
    if (data && data.clients && data.clients.length) {
      state.clients = data.clients.map(normalizeClient);
      state.activeClientId =
        data.activeClientId && state.clients.some((c) => c.id === data.activeClientId)
          ? data.activeClientId
          : state.clients[0].id;
    } else {
      state.clients = loadSeed();
      state.activeClientId = state.clients[0] ? state.clients[0].id : null;
      save();
    }
  }

  /* ------------------------------ Render -------------------------------- */
  function render() {
    renderClientSelect();
    renderStatusFilter();
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));
    const titles = {
      dashboard: ["Resumen", "Vista general de despachos del cliente"],
      productos: ["Productos", "Estado de entregas por producto"],
      ordenes: ["Órdenes de compra", "Detalle de todas las OC y entregas"],
      detalle: ["Detalle de producto", ""],
    };
    const t = titles[state.view] || ["", ""];
    $("#viewTitle").textContent = t[0];
    $("#viewSubtitle").textContent = t[1];

    const c = activeClient();
    const el = $("#viewContainer");
    if (!c) {
      el.innerHTML = emptyState("📭", "No hay clientes", "Crea un cliente para comenzar.");
      return;
    }
    if (state.view === "dashboard") el.innerHTML = viewDashboard(c);
    else if (state.view === "productos") el.innerHTML = viewProductos(c);
    else if (state.view === "ordenes") el.innerHTML = viewOrdenes(c);
    else if (state.view === "detalle") el.innerHTML = viewDetalle(c);
  }

  function emptyState(ico, title, sub) {
    return `<div class="empty"><div class="empty-ico">${ico}</div><h3>${esc(title)}</h3><p class="muted">${esc(sub)}</p></div>`;
  }

  function renderClientSelect() {
    const sel = $("#clientSelect");
    sel.innerHTML = state.clients
      .map((c) => `<option value="${c.id}" ${c.id === state.activeClientId ? "selected" : ""}>${esc(c.cliente)}</option>`)
      .join("");
  }

  function renderStatusFilter() {
    const sel = $("#statusFilter");
    if (sel.dataset.filled) {
      sel.value = state.status;
      return;
    }
    sel.innerHTML =
      '<option value="">Todos los estados</option>' +
      ALL_STATUS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
    sel.dataset.filled = "1";
    sel.value = state.status;
  }

  /* --------------------------- Vista: Resumen --------------------------- */
  function viewDashboard(c) {
    let cantOC = 0, entregado = 0, saldoPend = 0, ordenes = 0, entregas = 0;
    const byStatus = {};
    c.productos.forEach((p) => {
      p.ordenes.forEach((o) => {
        ordenes++;
        const s = orderStats(o);
        if (s.cantOC !== null) cantOC += s.cantOC;
        entregado += s.entregado;
        if (s.saldo !== null && s.saldo > 0) saldoPend += s.saldo;
        entregas += s.numEntregas;
        byStatus[s.cls.key] = (byStatus[s.cls.key] || 0) + 1;
      });
    });
    const abiertas = ordenes - (byStatus.cerrada || 0) - (byStatus.cerrada_exc || 0);
    const pct = cantOC > 0 ? Math.min(100, Math.round((entregado / cantOC) * 100)) : 0;

    const cards = [
      ["Productos", fmt(c.productos.length), "activos", ""],
      ["Órdenes de compra", fmt(ordenes), `${entregas} entregas`, ""],
      ["Unidades pedidas", fmt(cantOC), "total OC", ""],
      ["Unidades entregadas", fmt(entregado), pct + "% cumplido", "green"],
      ["Saldo pendiente", fmt(saldoPend), "por despachar", "amber"],
      ["OC abiertas", fmt(abiertas), `${(byStatus.cerrada || 0) + (byStatus.cerrada_exc || 0)} cerradas`, abiertas > 0 ? "orange" : "green"],
    ];

    const statusRows = ALL_STATUS.filter(([k]) => byStatus[k])
      .map(([k, l]) => {
        const cls = classifyEstado(l).cls;
        return `<tr><td><span class="badge ${cls}">${esc(l)}</span></td><td class="num"><b>${byStatus[k]}</b></td></tr>`;
      })
      .join("");

    // Productos con mayor saldo pendiente
    const top = c.productos
      .map((p) => ({ p, s: productStats(p) }))
      .filter((x) => x.s.saldoPend > 0)
      .sort((a, b) => b.s.saldoPend - a.s.saldoPend)
      .slice(0, 8)
      .map(
        (x) => `<tr class="clickable" data-goto="${x.p.id}">
          <td>${esc(x.p.producto)}</td>
          <td class="num">${fmt(x.s.cantOC)}</td>
          <td class="num">${fmt(x.s.entregado)}</td>
          <td class="num"><b class="saldo-pill pos">${fmt(x.s.saldoPend)}</b></td></tr>`
      )
      .join("");

    return `
      <div class="stat-grid">
        ${cards
          .map(
            (c) => `<div class="stat-card ${c[3]}">
              <div class="stat-label">${c[0]}</div>
              <div class="stat-value">${c[1]}</div>
              <div class="stat-sub">${c[2]}</div>
            </div>`
          )
          .join("")}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1.4fr;gap:20px;align-items:start">
        <div>
          <div class="section-title">📌 Órdenes por estado</div>
          <div class="table-wrap">
            <table style="min-width:auto">
              <thead><tr><th>Estado</th><th class="num">Cantidad</th></tr></thead>
              <tbody>${statusRows || '<tr><td colspan="2" class="muted">Sin datos</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        <div>
          <div class="section-title">⚠️ Mayor saldo pendiente</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Producto</th><th class="num">Pedido</th><th class="num">Entregado</th><th class="num">Saldo</th></tr></thead>
              <tbody>${top || '<tr><td colspan="4" class="muted">Todo despachado 🎉</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  /* -------------------------- Vista: Productos -------------------------- */
  function matchProduct(p, s) {
    if (state.search) {
      const q = state.search.toLowerCase();
      const inName = p.producto.toLowerCase().includes(q);
      const inOC = p.ordenes.some((o) => (o.oc || "").toLowerCase().includes(q));
      if (!inName && !inOC) return false;
    }
    if (state.status) {
      const has = p.ordenes.some((o) => orderStats(o).cls.key === state.status);
      if (!has) return false;
    }
    return true;
  }

  function viewProductos(c) {
    const list = c.productos.filter(matchProduct);
    const header = `<div class="wrap-actions">
        <button class="btn btn-primary" id="btnAddProduct">＋ Nuevo producto</button>
        <span class="spacer"></span>
        <span class="count-tag">${list.length} de ${c.productos.length} productos</span>
      </div>`;
    if (!list.length)
      return header + emptyState("🔍", "Sin resultados", "Ajusta la búsqueda o los filtros.");

    const cards = list
      .map((p) => {
        const s = productStats(p);
        const pct = s.cantOC > 0 ? Math.min(100, Math.round((s.entregado / s.cantOC) * 100)) : 0;
        const saldoCls = s.saldoPend > 0 ? "pos" : s.saldoPend < 0 ? "neg" : "zero";
        // estado predominante
        const openStates = p.ordenes
          .map((o) => orderStats(o))
          .filter((x) => x.cls.key !== "cerrada" && x.cls.key !== "cerrada_exc");
        const badge = openStates.length
          ? `<span class="badge ${openStates[0].cls.cls}">${esc(openStates[0].cls.label)}</span>`
          : `<span class="badge b-green">Cerrada</span>`;
        return `<div class="product-card" data-product="${p.id}">
          <div class="product-head">
            <div>
              <div class="product-name">${esc(p.producto)}</div>
              <div class="product-meta">${s.numOrdenes} OC · ${s.abiertas} abiertas · ${s.cerradas} cerradas</div>
            </div>
            ${badge}
          </div>
          <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
          <div class="product-nums">
            <span>Entregado <b>${fmt(s.entregado)}</b></span>
            <span>Pedido <b>${fmt(s.cantOC)}</b></span>
          </div>
          <div class="product-foot">
            <span class="muted" style="font-size:12px">Saldo pendiente</span>
            <span class="saldo-pill ${saldoCls}">${fmt(s.saldoPend)}</span>
          </div>
        </div>`;
      })
      .join("");
    return header + `<div class="product-grid">${cards}</div>`;
  }

  /* --------------------------- Vista: Órdenes -------------------------- */
  function viewOrdenes(c) {
    const rows = [];
    c.productos.forEach((p) => {
      if (!matchProduct(p, state.status)) return;
      p.ordenes.forEach((o) => {
        const s = orderStats(o);
        if (state.status && s.cls.key !== state.status) return;
        rows.push(
          `<tr class="clickable" data-goto="${p.id}">
            <td>${esc(p.producto)}</td>
            <td>${esc(o.oc) || "—"}</td>
            <td>${fmtDate(o.fecha)}</td>
            <td class="num">${fmt(s.cantOC)}</td>
            <td class="num">${fmt(s.entregado)}</td>
            <td class="num">${s.saldo === null ? "—" : fmt(s.saldo)}</td>
            <td>${s.numEntregas}</td>
            <td><span class="badge ${s.cls.cls}">${esc(s.cls.label)}</span></td>
          </tr>`
        );
      });
    });
    const header = `<div class="wrap-actions"><span class="count-tag">${rows.length} órdenes</span></div>`;
    if (!rows.length) return header + emptyState("🔍", "Sin resultados", "Ajusta la búsqueda o los filtros.");
    return (
      header +
      `<div class="table-wrap"><table>
        <thead><tr>
          <th>Producto</th><th>OC</th><th>Fecha</th>
          <th class="num">Pedido</th><th class="num">Entregado</th><th class="num">Saldo</th>
          <th>Entregas</th><th>Estado</th>
        </tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table></div>`
    );
  }

  /* -------------------------- Vista: Detalle --------------------------- */
  function viewDetalle(c) {
    const p = c.productos.find((x) => x.id === state.detailProductIdx);
    if (!p) {
      state.view = "productos";
      return viewProductos(c);
    }
    const s = productStats(p);
    const pct = s.cantOC > 0 ? Math.min(100, Math.round((s.entregado / s.cantOC) * 100)) : 0;

    const blocks = p.ordenes
      .map((o) => {
        const os = orderStats(o);
        const entregas = (o.entregas || [])
          .map(
            (e) => `<tr>
              <td>${fmtDate(e.fechaEntrega)}</td>
              <td class="num">${fmt(toNum(e.entregada))}</td>
              <td>${esc(e.documento) || "—"}</td>
              <td class="num">${e.saldo === "" ? "—" : fmt(toNum(e.saldo))}</td>
              <td>${e.estado ? `<span class="badge ${classifyEstado(e.estado).cls}">${esc(e.estado)}</span>` : "—"}</td>
              <td class="t-right"><button class="btn btn-ghost btn-sm" data-del-entrega="${o.id}:${e.id}">🗑</button></td>
            </tr>`
          )
          .join("");
        return `<div class="order-block">
          <div class="order-block-head">
            <div>
              <span class="order-block-title">OC ${esc(o.oc) || "s/n"}<small>${fmtDate(o.fecha)} · Pedido ${fmt(os.cantOC)}</small></span>
              <div class="chips" style="margin-top:8px">
                <span class="chip">Entregado <b>${fmt(os.entregado)}</b></span>
                <span class="chip">Saldo <b>${os.saldo === null ? "—" : fmt(os.saldo)}</b></span>
                <span class="badge ${os.cls.cls}">${esc(os.cls.label)}</span>
              </div>
            </div>
            <div class="order-actions">
              <button class="btn btn-sm" data-add-entrega="${o.id}">＋ Entrega</button>
              <button class="btn btn-ghost btn-sm btn-danger-ghost" data-del-orden="${o.id}">🗑</button>
            </div>
          </div>
          <div class="table-wrap" style="border:none;border-radius:0">
            <table>
              <thead><tr><th>Fecha entrega</th><th class="num">Cantidad</th><th>Documento</th><th class="num">Saldo</th><th>Estado</th><th></th></tr></thead>
              <tbody>${entregas || '<tr><td colspan="6" class="muted">Sin entregas registradas</td></tr>'}</tbody>
            </table>
          </div>
        </div>`;
      })
      .join("");

    return `
      <button class="back-link" id="btnBack">← Volver a productos</button>
      <div class="detail-head">
        <div>
          <h2 style="margin:0 0 6px">${esc(p.producto)}</h2>
          <div class="chips">
            <span class="chip">Pedido <b>${fmt(s.cantOC)}</b></span>
            <span class="chip">Entregado <b>${fmt(s.entregado)}</b> (${pct}%)</span>
            <span class="chip">Saldo pendiente <b>${fmt(s.saldoPend)}</b></span>
            <span class="chip">${s.numOrdenes} OC</span>
          </div>
        </div>
        <div class="order-actions">
          <button class="btn btn-primary" data-add-orden="${p.id}">＋ Nueva OC</button>
          <button class="btn btn-ghost btn-danger-ghost" data-del-product="${p.id}">🗑 Eliminar</button>
        </div>
      </div>
      ${blocks || emptyState("📋", "Sin órdenes", "Agrega una orden de compra para este producto.")}`;
  }

  /* ------------------------------ Modales ------------------------------ */
  function openModal(title, bodyHTML, onSave, saveLabel = "Guardar") {
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = bodyHTML;
    $("#modalFooter").innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>Cancelar</button>
      <button class="btn btn-primary" data-modal-save>${esc(saveLabel)}</button>`;
    $("#modalOverlay").hidden = false;
    $("[data-modal-cancel]").onclick = closeModal;
    $("[data-modal-save]").onclick = () => onSave && onSave();
    const first = $("#modalBody input, #modalBody select, #modalBody textarea");
    if (first) first.focus();
  }
  function closeModal() {
    $("#modalOverlay").hidden = true;
    $("#modalBody").innerHTML = "";
  }
  function field(label, name, value = "", type = "text", attrs = "") {
    return `<label class="field"><span class="lbl">${esc(label)}</span>
      <input type="${type}" data-f="${name}" value="${esc(value)}" ${attrs} /></label>`;
  }

  function estadoSelect(name, value = "") {
    const opts = ["", "Abierta", "En proceso", "Pendiente por despachar", "Abierta sin abono", "Cerrada", "Cerrada c/excedente", "Excedente"]
      .map((o) => `<option ${o === value ? "selected" : ""}>${o}</option>`)
      .join("");
    return `<label class="field"><span class="lbl">Estado</span><select data-f="${name}">${opts}</select></label>`;
  }

  function modalVals() {
    const v = {};
    $$("#modalBody [data-f]").forEach((el) => (v[el.dataset.f] = el.value.trim()));
    return v;
  }

  /* --- CRUD: cliente --- */
  function addClient() {
    openModal("Nuevo cliente", field("Nombre del cliente", "nombre", "", "text", "required"), () => {
      const v = modalVals();
      if (!v.nombre) return toast("Ingresa un nombre", "err");
      const c = normalizeClient({ cliente: v.nombre, productos: [] });
      state.clients.push(c);
      state.activeClientId = c.id;
      save();
      closeModal();
      render();
      toast("Cliente creado");
    });
  }
  function renameClient() {
    const c = activeClient();
    if (!c) return;
    openModal("Renombrar cliente", field("Nombre del cliente", "nombre", c.cliente, "text", "required"), () => {
      const v = modalVals();
      if (!v.nombre) return toast("Ingresa un nombre", "err");
      c.cliente = v.nombre;
      save();
      closeModal();
      render();
      toast("Cliente actualizado");
    });
  }
  function deleteClient() {
    const c = activeClient();
    if (!c) return;
    if (!confirm(`¿Eliminar el cliente "${c.cliente}" y todos sus datos?`)) return;
    state.clients = state.clients.filter((x) => x.id !== c.id);
    state.activeClientId = state.clients[0] ? state.clients[0].id : null;
    save();
    render();
    toast("Cliente eliminado");
  }

  /* --- CRUD: producto --- */
  function addProduct() {
    openModal("Nuevo producto", field("Nombre del producto", "nombre", "", "text", "required"), () => {
      const v = modalVals();
      if (!v.nombre) return toast("Ingresa un nombre", "err");
      activeClient().productos.push({ id: uid(), producto: v.nombre, ordenes: [] });
      save();
      closeModal();
      render();
      toast("Producto agregado");
    });
  }
  function deleteProduct(pid) {
    const c = activeClient();
    const p = c.productos.find((x) => x.id === pid);
    if (!p || !confirm(`¿Eliminar el producto "${p.producto}"?`)) return;
    c.productos = c.productos.filter((x) => x.id !== pid);
    state.view = "productos";
    save();
    render();
    toast("Producto eliminado");
  }

  /* --- CRUD: orden --- */
  function addOrden(pid) {
    const body =
      `<div class="form-grid">${field("Fecha", "fecha", "", "date")}${field("N° OC", "oc")}</div>` +
      field("Cantidad OC", "cantidadOC", "", "number", 'min="0"');
    openModal("Nueva orden de compra", body, () => {
      const v = modalVals();
      const p = activeClient().productos.find((x) => x.id === pid);
      if (!p) return;
      p.ordenes.push({ id: uid(), fecha: v.fecha, oc: v.oc, cantidadOC: v.cantidadOC, entregas: [] });
      save();
      closeModal();
      render();
      toast("OC creada");
    });
  }
  function deleteOrden(oid) {
    const p = activeClient().productos.find((x) => x.id === state.detailProductIdx);
    if (!p) return;
    const o = p.ordenes.find((x) => x.id === oid);
    if (!o || !confirm(`¿Eliminar la OC "${o.oc || "s/n"}" y sus entregas?`)) return;
    p.ordenes = p.ordenes.filter((x) => x.id !== oid);
    save();
    render();
    toast("OC eliminada");
  }

  /* --- CRUD: entrega --- */
  function addEntrega(oid) {
    const p = activeClient().productos.find((x) => x.id === state.detailProductIdx);
    const o = p && p.ordenes.find((x) => x.id === oid);
    if (!o) return;
    const os = orderStats(o);
    const body =
      `<div class="form-grid">${field("Fecha de entrega", "fechaEntrega", "", "date")}${field("Cantidad entregada", "entregada", "", "number", 'min="0"')}</div>` +
      field("Documento / Factura", "documento") +
      estadoSelect("estado") +
      `<p class="muted" style="font-size:12px;margin:0">El saldo se calculará automáticamente (saldo actual: ${fmt(os.saldo)}).</p>`;
    openModal("Registrar entrega", body, () => {
      const v = modalVals();
      const q = toNum(v.entregada);
      // saldo running: saldo anterior - entregado
      const prev = os.saldo !== null ? os.saldo : os.cantOC || 0;
      const nuevoSaldo = q !== null ? prev - q : "";
      o.entregas.push({
        id: uid(),
        entregada: v.entregada,
        documento: v.documento,
        fechaEntrega: v.fechaEntrega,
        saldo: nuevoSaldo === "" ? "" : String(nuevoSaldo),
        estado: v.estado,
      });
      save();
      closeModal();
      render();
      toast("Entrega registrada");
    });
  }
  function deleteEntrega(oid, eid) {
    const p = activeClient().productos.find((x) => x.id === state.detailProductIdx);
    const o = p && p.ordenes.find((x) => x.id === oid);
    if (!o) return;
    if (!confirm("¿Eliminar esta entrega?")) return;
    o.entregas = o.entregas.filter((x) => x.id !== eid);
    save();
    render();
    toast("Entrega eliminada");
  }

  /* ---------------------------- Exportar / Importar --------------------- */
  function exportData() {
    const blob = new Blob([JSON.stringify({ clients: state.clients }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "despachos-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Datos exportados");
  }
  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const clients = data.clients || (Array.isArray(data) ? data : null);
        if (!clients) throw new Error("formato");
        state.clients = clients.map(normalizeClient);
        state.activeClientId = state.clients[0] ? state.clients[0].id : null;
        state.view = "dashboard";
        save();
        render();
        toast("Datos importados");
      } catch (e) {
        toast("Archivo no válido", "err");
      }
    };
    reader.readAsText(file);
  }
  function resetData() {
    if (!confirm("Esto restaurará los datos originales del Excel y descartará tus cambios. ¿Continuar?")) return;
    state.clients = loadSeed();
    state.activeClientId = state.clients[0] ? state.clients[0].id : null;
    state.view = "dashboard";
    save();
    render();
    toast("Datos restaurados");
  }

  /* ------------------------------ Eventos ------------------------------ */
  function bind() {
    $$(".nav-item").forEach((b) =>
      b.addEventListener("click", () => {
        state.view = b.dataset.view;
        render();
      })
    );
    $("#clientSelect").addEventListener("change", (e) => {
      state.activeClientId = e.target.value;
      state.view = "dashboard";
      save();
      render();
    });
    $("#btnAddClient").addEventListener("click", addClient);
    $("#btnRenameClient").addEventListener("click", renameClient);
    $("#btnDeleteClient").addEventListener("click", deleteClient);

    $("#searchInput").addEventListener("input", (e) => {
      state.search = e.target.value;
      if (state.view === "detalle" || state.view === "dashboard") state.view = "productos";
      render();
    });
    $("#statusFilter").addEventListener("change", (e) => {
      state.status = e.target.value;
      if (state.view === "detalle" || state.view === "dashboard") state.view = "productos";
      render();
    });

    $("#btnExport").addEventListener("click", exportData);
    $("#btnImport").addEventListener("click", () => $("#importFile").click());
    $("#importFile").addEventListener("change", (e) => {
      if (e.target.files[0]) importData(e.target.files[0]);
      e.target.value = "";
    });
    $("#btnReset").addEventListener("click", resetData);

    $("#modalClose").addEventListener("click", closeModal);
    $("#modalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "modalOverlay") closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("#modalOverlay").hidden) closeModal();
    });

    // Delegación de clicks en el contenedor de vistas
    $("#viewContainer").addEventListener("click", (e) => {
      const card = e.target.closest("[data-product]");
      const goto = e.target.closest("[data-goto]");
      const t = e.target;
      if (t.id === "btnAddProduct") return addProduct();
      if (t.id === "btnBack") {
        state.view = "productos";
        return render();
      }
      if (t.dataset.addOrden) return addOrden(t.dataset.addOrden);
      if (t.dataset.delProduct) return deleteProduct(t.dataset.delProduct);
      if (t.dataset.addEntrega) return addEntrega(t.dataset.addEntrega);
      if (t.dataset.delOrden) return deleteOrden(t.dataset.delOrden);
      if (t.dataset.delEntrega) {
        const [oid, eid] = t.dataset.delEntrega.split(":");
        return deleteEntrega(oid, eid);
      }
      if (card) {
        state.detailProductIdx = card.dataset.product;
        state.view = "detalle";
        return render();
      }
      if (goto) {
        state.detailProductIdx = goto.dataset.goto;
        state.view = "detalle";
        return render();
      }
    });
  }

  /* ------------------------------- Init -------------------------------- */
  load();
  bind();
  render();
})();
