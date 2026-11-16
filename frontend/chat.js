"use strict";

// Ask Helios: a chat panel that answers questions about the spot on the map.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const panel = $("#chat"), log = $("#chat-log"), form = $("#chat-form"), input = $("#chat-input");
  const btn = $("#chat-btn"), send = $("#chat-send"), chips = $("#chat-chips");
  const history = [];
  let busy = false;

  function bubble(role, text, kind = "") {
    const el = document.createElement("div");
    el.className = `msg ${role}${kind ? " " + kind : ""}`;
    el.textContent = text;                       // plain text only, never HTML from the model
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  // what's on screen right now, trimmed to the numbers the AI needs
  function context() {
    const s = window.firescout?.snapshot?.();
    if (!s?.pin) return { note: "no spot picked on the map yet" };
    const round = (v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);
    const ins = s.ins ? Object.fromEntries(Object.entries(s.ins).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 15) : round(v)])) : null;
    const rep = s.reported ? { count: s.reported.count, fires: (s.reported.fires || []).slice(0, 8) } : s.reported;
    return {
      place: s.place, area: s.poly ? "drawn shape" : `circle, ${s.radius} km radius`,
      window: `7 days ending ${window.firescout.iso(s.end)}`, sensor: s.sensor,
      still_loading: s.loading, readout: ins, agency_reports: rep,
      so2_last_30_days: (s.series || []).slice(-30).map((r) => [r.t, round(r.v)]),
    };
  }

  async function ask(text) {
    text = text.trim();
    if (!text || busy) return;
    busy = true; send.disabled = true; chips.hidden = true;
    bubble("user", text);
    history.push({ role: "user", content: text });
    const wait = bubble("assistant", "reading the satellites…", "typing");
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, context: context() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof j.detail === "string" ? j.detail : "The AI couldn't answer just now.");
      wait.textContent = j.reply; wait.classList.remove("typing");
      history.push({ role: "assistant", content: j.reply });
    } catch (err) {
      wait.textContent = err.message; wait.className = "msg assistant error";
      history.pop();                             // let them ask again
    } finally {
      busy = false; send.disabled = false; input.focus();
      log.scrollTop = log.scrollHeight;
    }
  }

  function open() {
    panel.hidden = false; btn.setAttribute("aria-expanded", "true");
    const s = window.firescout?.snapshot?.();
    $("#chat-where").textContent = s?.pin ? `about ${s.place}` : "click the map first, or ask anything";
    input.focus();
  }
  function close() { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); btn.focus(); }

  btn.addEventListener("click", () => (panel.hidden ? open() : close()));
  $("#chat-x").addEventListener("click", close);
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); const t = input.value; input.value = ""; ask(t); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  chips.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) ask(b.textContent); });
  addEventListener("firescout:pin", () => { if (!panel.hidden) open(); });

  window.FireChat = { open, close, ask };
})();
