/* =========================================================================
   Boti — interfaz de chat (vanilla JS, sin build).
   - Llama a /api/chat (nunca a Anthropic directamente).
   - Renderiza markdown de forma segura (sin HTML crudo).
   - Muestra costo por respuesta y costo acumulado de la sesión.
   - La sesión vive solo en memoria: se reinicia cada vez que se abre el panel.
   ========================================================================= */
(function () {
  "use strict";

  // Pricing de claude-sonnet-4-6 (USD por millón de tokens).
  const PRICE_IN = 3 / 1_000_000;
  const PRICE_OUT = 15 / 1_000_000;

  const $ = (s) => document.querySelector(s);

  const el = {
    open: $("#botiOpen"),
    panel: $("#botiPanel"),
    back: $("#botiBack"),
    messages: $("#botiMessages"),
    form: $("#botiForm"),
    input: $("#botiInput"),
    send: $("#botiSend"),
    sessionCost: $("#botiSessionCost"),
  };

  // Estado en memoria (se reinicia al abrir).
  let history = []; // [{role:'user'|'assistant', content:string}]
  let loading = false;
  let sessionCost = 0;

  /* -------------------- Utilidades -------------------- */
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function money(n) {
    return "$" + n.toFixed(4);
  }

  /* -------------------- Renderizado de markdown (seguro) --------------------
     Escapa TODO el HTML primero; luego convierte un subconjunto de markdown
     (encabezados, negritas, cursivas, listas, tablas, código, enlaces).
     Al escapar antes, ningún HTML crudo del modelo puede inyectarse. */
  function renderInline(text) {
    let t = escapeHtml(text);
    // código en línea `code`
    t = t.replace(/`([^`]+)`/g, (_, c) => "<code>" + c + "</code>");
    // negrita **texto** o __texto__
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    // cursiva *texto* o _texto_
    t = t.replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1<em>$2</em>");
    t = t.replace(/(^|[^_])_(?!\s)([^_]+?)_(?!_)/g, "$1<em>$2</em>");
    // enlaces [texto](http...)
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, txt, url) => {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + txt + "</a>";
    });
    return t;
  }

  function renderTable(rows) {
    // rows: array de líneas que empiezan con "|"
    const cells = (line) =>
      line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
    const header = cells(rows[0]);
    // rows[1] es el separador |---|---|
    const bodyRows = rows.slice(2);
    let html = '<table class="boti-table"><thead><tr>';
    header.forEach((h) => (html += "<th>" + renderInline(h) + "</th>"));
    html += "</tr></thead><tbody>";
    bodyRows.forEach((r) => {
      html += "<tr>";
      cells(r).forEach((c) => (html += "<td>" + renderInline(c) + "</td>"));
      html += "</tr>";
    });
    html += "</tbody></table>";
    return html;
  }

  function renderMarkdown(src) {
    const lines = String(src).replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;

    const isTableSep = (s) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(s);

    while (i < lines.length) {
      const line = lines[i];

      // Bloque de código ```
      if (/^\s*```/.test(line)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        i++; // saltar cierre
        out.push("<pre class=\"boti-pre\"><code>" + escapeHtml(buf.join("\n")) + "</code></pre>");
        continue;
      }

      // Tabla: línea con | seguida de un separador |---|
      if (/\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const tbl = [line, lines[i + 1]];
        i += 2;
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== "") tbl.push(lines[i++]);
        out.push(renderTable(tbl));
        continue;
      }

      // Encabezados #..######
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        const lvl = Math.min(h[1].length, 6);
        out.push("<h" + lvl + ' class="boti-h">' + renderInline(h[2]) + "</h" + lvl + ">");
        i++;
        continue;
      }

      // Lista no ordenada - / *
      if (/^\s*[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push("<li>" + renderInline(lines[i].replace(/^\s*[-*]\s+/, "")) + "</li>");
          i++;
        }
        out.push("<ul class=\"boti-ul\">" + items.join("") + "</ul>");
        continue;
      }

      // Lista ordenada 1. 2.
      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push("<li>" + renderInline(lines[i].replace(/^\s*\d+\.\s+/, "")) + "</li>");
          i++;
        }
        out.push("<ol class=\"boti-ol\">" + items.join("") + "</ol>");
        continue;
      }

      // Línea en blanco
      if (line.trim() === "") {
        i++;
        continue;
      }

      // Párrafo: acumula líneas contiguas
      const para = [line];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !/^\s*```/.test(lines[i]) &&
        !/^(#{1,6})\s+/.test(lines[i]) &&
        !/^\s*[-*]\s+/.test(lines[i]) &&
        !/^\s*\d+\.\s+/.test(lines[i]) &&
        !/\|/.test(lines[i])
      ) {
        para.push(lines[i++]);
      }
      out.push("<p>" + para.map(renderInline).join("<br>") + "</p>");
    }
    return out.join("");
  }

  /* -------------------- Construcción del resumen para el prompt -------------------- */
  function buildSummaryText() {
    const api = window.DespachosBoti;
    if (!api || typeof api.getSummary !== "function") return "";
    const s = api.getSummary();
    if (!s) return "";
    const fmt = api.fmt || ((n) => String(n));
    const lines = [];
    lines.push("Cliente: " + s.cliente);
    lines.push("Productos activos: " + s.productos);
    lines.push("Órdenes de compra (movimientos): " + s.ordenes + " (con " + s.entregas + " entregas)");
    lines.push("Unidades pedidas (ingresos comprometidos): " + fmt(s.unidadesPedidas));
    lines.push("Unidades entregadas: " + fmt(s.unidadesEntregadas) + " (" + s.pctCumplido + "% de cumplimiento)");
    lines.push("Saldo pendiente por despachar (deuda de entrega): " + fmt(s.saldoPendiente));
    lines.push("OC abiertas: " + s.ocAbiertas + " · OC cerradas: " + s.ocCerradas);
    if (s.porEstado.length) {
      lines.push("Distribución por estado: " + s.porEstado.map((e) => e.estado + " (" + e.cantidad + ")").join(", "));
    }
    if (s.topPendientes.length) {
      lines.push("Productos con mayor saldo pendiente:");
      s.topPendientes.forEach((t) => {
        lines.push(
          "  - " + t.producto + ": pedido " + fmt(t.pedido) + ", entregado " + fmt(t.entregado) + ", saldo " + fmt(t.saldo)
        );
      });
    }
    return lines.join("\n");
  }

  /* -------------------- UI de mensajes -------------------- */
  function bubble(role, innerHtml, extraHtml) {
    const wrap = document.createElement("div");
    wrap.className = "boti-msg boti-msg-" + role;
    const avatar = role === "boti" ? "🤖" : "🧑";
    wrap.innerHTML =
      '<div class="boti-msg-avatar">' + avatar + "</div>" +
      '<div class="boti-msg-body">' +
      '<div class="boti-msg-bubble">' + innerHtml + "</div>" +
      (extraHtml || "") +
      "</div>";
    el.messages.appendChild(wrap);
    el.messages.scrollTop = el.messages.scrollHeight;
    return wrap;
  }

  function addUserMessage(text) {
    // Los mensajes del usuario se muestran como texto plano.
    bubble("user", "<p>" + escapeHtml(text).replace(/\n/g, "<br>") + "</p>");
  }

  function addBotiMessage(text, usage) {
    let costHtml = "";
    if (usage) {
      const tokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
      const cost = (usage.input_tokens || 0) * PRICE_IN + (usage.output_tokens || 0) * PRICE_OUT;
      sessionCost += cost;
      el.sessionCost.textContent = money(sessionCost);
      costHtml = '<div class="boti-cost-line">' + tokens + " tokens · " + money(cost) + "</div>";
    }
    bubble("boti", renderMarkdown(text), costHtml);
  }

  function showTyping() {
    const wrap = document.createElement("div");
    wrap.className = "boti-msg boti-msg-boti boti-typing";
    wrap.id = "botiTyping";
    wrap.innerHTML =
      '<div class="boti-msg-avatar">🤖</div>' +
      '<div class="boti-msg-body"><div class="boti-msg-bubble"><span class="boti-dots"><span></span><span></span><span></span></span> Escribiendo…</div></div>';
    el.messages.appendChild(wrap);
    el.messages.scrollTop = el.messages.scrollHeight;
  }
  function hideTyping() {
    const t = $("#botiTyping");
    if (t) t.remove();
  }

  function updateSendState() {
    el.send.disabled = loading || el.input.value.trim() === "";
  }

  /* -------------------- Flujo de envío -------------------- */
  async function send(text) {
    loading = true;
    updateSendState();
    addUserMessage(text);
    history.push({ role: "user", content: text });
    showTyping();

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          summary: buildSummaryText(),
          history: history.slice(0, -1), // turnos previos (sin el actual)
        }),
      });
      const data = await resp.json().catch(() => ({}));
      hideTyping();
      if (!resp.ok) {
        bubble("boti", '<p class="boti-error">⚠️ ' + escapeHtml(data.error || "Error al contactar a Boti.") + "</p>");
      } else {
        addBotiMessage(data.reply || "(sin respuesta)", data.usage);
        history.push({ role: "assistant", content: data.reply || "" });
      }
    } catch (e) {
      hideTyping();
      bubble("boti", '<p class="boti-error">⚠️ No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.</p>');
    } finally {
      loading = false;
      updateSendState();
      el.input.focus();
    }
  }

  /* -------------------- Apertura / cierre -------------------- */
  function openPanel() {
    // Sesión limpia cada vez.
    history = [];
    sessionCost = 0;
    el.sessionCost.textContent = money(0);
    el.messages.innerHTML = "";
    el.input.value = "";
    bubble(
      "boti",
      renderMarkdown(
        "¡Hola! 👋 Soy **Boti**, tu asistente financiero.\n\n" +
          "Puedo ayudarte con tus **despachos**: saldo pendiente, cumplimiento de entregas, " +
          "órdenes abiertas y los productos con mayor saldo. ¿Qué quieres saber?"
      )
    );
    el.panel.hidden = false;
    document.body.classList.add("boti-open");
    updateSendState();
    setTimeout(() => el.input.focus(), 50);
  }
  function closePanel() {
    el.panel.hidden = true;
    document.body.classList.remove("boti-open");
  }

  /* -------------------- Eventos -------------------- */
  el.open.addEventListener("click", openPanel);
  el.back.addEventListener("click", closePanel);
  el.input.addEventListener("input", updateSendState);
  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = el.input.value.trim();
    if (!text || loading) return;
    el.input.value = "";
    updateSendState();
    send(text);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.panel.hidden) closePanel();
  });
})();
