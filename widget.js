/*
 * ReflectivEI chat widget — fixed input always visible
 * - Modes: emotional-assessment, hiv-product-knowledge, sales-simulation
 * - Separate Coach Feedback section
 * - No emoji/file/theme
 * - Analytics POST if analyticsEndpoint in config.json
 */

(function () {
  const container = document.getElementById("reflectiv-widget");
  if (!container) return;
  if (!container.classList.contains("cw")) container.classList.add("cw");

  let cfg = null, systemPrompt = "", knowledge = "", personas = {};
  let scenariosList = [], scenariosById = new Map();
  let currentMode = "sales-simulation", currentScenarioId = null;
  let conversation = [], coachEnabled = true;

  async function fetchLocal(path) {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(`load ${path}`);
    const ct = r.headers.get("content-type") || "";
    return ct.includes("application/json") ? r.json() : r.text();
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function renderMarkdown(t) {
    if (!t) return "";
    let s = esc(t).replace(/\r\n?/g, "\n");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    return s.split(/\n{2,}/).map(c => `<p>${c.replace(/\n/g, "<br>")}</p>`).join("\n");
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function extractCoach(raw) {
    const m = String(raw || "").match(/<coach>([\s\S]*?)<\/coach>/i);
    if (!m) return { coach: null, clean: raw };
    let coach = null;
    try { coach = JSON.parse(m[1]); } catch { }
    return { coach, clean: String(raw).replace(m[0], "").trim() };
  }

  function heuristicCoach(conv = [], mode = currentMode) {
    if (!conv.length) return null;
    const lastUser = [...conv].reverse().find(m => m.role === "user")?.content || "";
    const obj = /\b(concern|barrier|risk|cost|auth)\b/i.test(lastUser);
    const q = (lastUser.match(/\?/g) || []).length;
    const worked = [], improve = [];
    if (q > 0) worked.push("You asked a clear question.");
    if (obj) worked.push("You identified a barrier.");
    if (q === 0) improve.push("Ask at least one question.");
    if (!obj) improve.push("Acknowledge or probe barriers.");
    const score = Math.round(((q ? 4 : 2) + (obj ? 4 : 2) + 4 + 3) / 20 * 100);
    return {
      worked, improve,
      phrasing: "“Could we align on one next step for your eligible patients?”",
      score,
      subscores: { question_quality: q ? 4 : 2, objection_handling: obj ? 4 : 2, empathy: 3, compliance: 4 }
    };
  }

  function buildUI() {
    container.innerHTML = "";
    const wrapper = el("div", "reflectiv-chat");
    const toolbar = el("div", "chat-toolbar");

    const modeSelect = el("select");
    (cfg.modes || []).forEach(m => {
      const o = el("option");
      o.value = m;
      o.textContent = m.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      modeSelect.appendChild(o);
    });
    modeSelect.value = currentMode;
    modeSelect.onchange = () => {
      currentMode = modeSelect.value; currentScenarioId = null; conversation = [];
      renderMessages(); updateScenarioSelector(); updateScenarioMeta(); renderCoach();
    };
    toolbar.appendChild(modeSelect);

    const scenarioSelect = el("select");
    scenarioSelect.style.display = "none";
    scenarioSelect.onchange = () => {
      currentScenarioId = scenarioSelect.value || null; conversation = [];
      renderMessages(); updateScenarioMeta(); renderCoach();
    };
    toolbar.appendChild(scenarioSelect);

    const coachBtn = el("button", "btn", "Coach: On");
    coachBtn.onclick = () => {
      coachEnabled = !coachEnabled;
      coachBtn.textContent = coachEnabled ? "Coach: On" : "Coach: Off";
      renderCoach();
    };
    toolbar.appendChild(coachBtn);
    wrapper.appendChild(toolbar);

    const metaEl = el("div", "scenario-meta");
    wrapper.appendChild(metaEl);
    const messagesEl = el("div", "chat-messages");
    wrapper.appendChild(messagesEl);

    const inputArea = el("div", "chat-input");
    const textarea = el("textarea");
    textarea.placeholder = "Type your message…";
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });

    const sendBtn = el("button", "btn primary", "Send");
    sendBtn.onclick = () => {
      const t = textarea.value.trim();
      if (t) {
        sendMessage(t);
        textarea.value = "";
      }
    };
    inputArea.appendChild(textarea);
    inputArea.appendChild(sendBtn);
    wrapper.appendChild(inputArea);

    const coachSection = el("div", "coach-section");
    coachSection.innerHTML = `<h3>Coach Feedback</h3><div class="coach-body muted">Awaiting the first assistant reply…</div>`;
    container.appendChild(wrapper);
    container.appendChild(coachSection);

    function updateScenarioSelector() {
      if (currentMode === "sales-simulation") {
        scenarioSelect.style.display = "";
        scenarioSelect.innerHTML = "<option value=''>Select Physician Profile</option>";
        scenariosList.forEach(sc => {
          const o = el("option"); o.value = sc.id; o.textContent = sc.label; scenarioSelect.appendChild(o);
        });
      } else scenarioSelect.style.display = "none";
    }

    function updateScenarioMeta() {
      const sc = scenariosById.get(currentScenarioId);
      if (!sc || currentMode !== "sales-simulation") { metaEl.innerHTML = ""; return; }
      metaEl.innerHTML = `
        <div class="meta-card">
          <div><strong>Therapeutic Area:</strong> ${esc(sc.therapeuticArea)}</div>
          <div><strong>Background:</strong> ${esc(sc.background)}</div>
          <div><strong>Today’s Goal:</strong> ${esc(sc.goal)}</div>
        </div>`;
    }

    function renderMessages() {
      messagesEl.innerHTML = "";
      for (const m of conversation) {
        const d = el("div", `message ${m.role}`);
        const c = el("div", "content");
        c.innerHTML = renderMarkdown(m.content);
        d.appendChild(c);
        messagesEl.appendChild(d);
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderCoach() {
      const body = coachSection.querySelector(".coach-body");
      if (!coachEnabled) { coachSection.style.display = "none"; return; }
      coachSection.style.display = "";
      const last = conversation[conversation.length - 1];
      if (!(last && last.role === "assistant" && last._coach)) {
        body.innerHTML = `<span class="muted">Awaiting the first assistant reply…</span>`; return;
      }
      const fb = last._coach, subs = fb.subscores || {};
      body.innerHTML = `
        <div class="coach-score">Score: <strong>${fb.score ?? "—"}</strong>/100</div>
        <div class="coach-subs">${Object.entries(subs).map(([k, v]) => `<span class="pill">${esc(k)}: ${v}</span>`).join(" ")}</div>
        <ul class="coach-list">
          <li><strong>What worked:</strong> ${esc(fb.worked.join(" ") || "—")}</li>
          <li><strong>What to improve:</strong> ${esc(fb.improve.join(" ") || "—")}</li>
          <li><strong>Suggested phrasing:</strong> ${esc(fb.phrasing || "—")}</li>
        </ul>`;
    }

    updateScenarioSelector();
    updateScenarioMeta();
    renderMessages();
    renderCoach();

    async function sendMessage(userText) {
      conversation.push({ role: "user", content: userText });
      renderMessages();
      renderCoach();

      const messages = [{ role: "system", content: systemPrompt }];
      if (currentMode === "sales-simulation" && currentScenarioId) {
        const sc = scenariosById.get(currentScenarioId);
        messages.push({ role: "system", content: `Scenario: ${sc.label}\n${sc.background}` });
      }

      messages.push({
        role: "system",
        content: `After reply, include coaching JSON in <coach>{...}</coach> tags with score and subscores.`
      });

      try {
        const r = await fetch(cfg.apiBase.trim(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages, model: cfg.model })
        });
        const data = await r.json();
        const { coach, clean } = extractCoach(data.content || "");
        const fb = coach || heuristicCoach(conversation);
        conversation.push({ role: "assistant", content: clean, _coach: fb });
        renderMessages();
        renderCoach();

        if (cfg.analyticsEndpoint) {
          fetch(cfg.analyticsEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ts: Date.now(),
              mode: currentMode,
              scenarioId: currentScenarioId,
              turn: conversation.length,
              score: fb.score,
              subscores: fb.subscores
            })
          }).catch(() => { });
        }
      } catch {
        conversation.push({ role: "assistant", content: "Error contacting model." });
        renderMessages();
      }
    }
  }

  async function init() {
    cfg = await fetchLocal("./assets/chat/config.json");
    systemPrompt = await fetchLocal("./assets/chat/system.md");
    knowledge = await fetchLocal("./assets/chat/about-ei.md");
    try { personas = await fetchLocal("./assets/chat/persona.json"); } catch { personas = {}; }
    const legacy = await fetchLocal("./assets/chat/data/hcp_scenarios.txt").catch(() => "");
    scenariosList = cfg.scenarios || [];
    if (!scenariosList.length && legacy) {
      legacy.split("\n").forEach(l => {
        if (l.startsWith("# Scenario:")) scenariosList.push({ id: l.slice(11).trim(), label: l.slice(11).trim() });
      });
    }
    scenariosById = new Map(scenariosList.map(s => [s.id, s]));
    buildUI();
  }

  const style = document.createElement("style");
  style.textContent = `
  .cw .reflectiv-chat{--bg:#fff;--fg:#111827;--line:#e5e7eb;--accent:#3e5494;}
  .cw .chat-toolbar{display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
  .cw .chat-messages{height:50vh;overflow-y:auto;border:1px solid var(--line);border-radius:10px;padding:12px;background:var(--bg);margin-bottom:8px}
  .cw .chat-input{display:flex;gap:8px;align-items:center;position:sticky;bottom:0;background:var(--bg);padding:8px 0;border-top:1px solid #eee;}
  .cw textarea{flex:1;min-height:48px;resize:none;padding:10px;border:1px solid var(--line);border-radius:8px}
  .cw .btn{padding:8px 12px;border-radius:8px;border:1px solid var(--line);cursor:pointer}
  .cw .btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
  .cw .scenario-meta .meta-card{background:#f9fafc;border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin-bottom:8px;font-size:.9rem}
  .cw .coach-section{background:#fffbea;border:1px solid #fde68a;border-radius:10px;padding:10px;margin-top:10px}
  .cw .coach-section .pill{display:inline-block;background:#fff;border:1px solid #e5e7eb;border-radius:999px;padding:2px 6px;font-size:.8rem;margin-right:4px}
  `;
  document.head.appendChild(style);
  init();
})();
