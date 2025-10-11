/*
 * ReflectivEI AI widget — drop-in
 * - Loads config, personas, and scenarios from /assets/chat/*
 * - Renders chat UI with three modes
 * - Calls Cloudflare Worker defined in config.apiBase (or workerEndpoint)
 * - Scopes all widget styles under .cw to avoid site CSS conflicts
 */

(function () {
  const container = document.getElementById("reflectiv-widget");
  if (!container) return;

  if (!container.classList.contains("cw")) container.classList.add("cw");

  // ---------- State ----------
  let cfg = null;
  let systemPrompt = "";
  let knowledge = "";
  let personas = {};
  let scenariosList = [];
  let scenariosById = new Map();
  let currentMode = "emotional-assessment";
  let currentScenarioId = null;
  let conversation = [];
  let coachEnabled = false;

  // ---------- Utils ----------
  async function fetchLocal(path) {
    const resp = await fetch(path, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to load ${path} (${resp.status})`);
    const ct = resp.headers.get("content-type") || "";
    return ct.includes("application/json") ? resp.json() : resp.text();
  }

  function parseLegacyScenarios(text) {
    const lines = String(text || "").split(/\r?\n/);
    const out = [];
    let key = null, obj = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith("# Scenario:")) {
        if (key && obj) out.push(obj);
        key = line.slice("# Scenario:".length).trim();
        obj = { id: key, label: key, therapeuticArea: "", background: "", goal: "", personaKey: "" };
        continue;
      }
      if (!key || !line) continue;
      const idx = line.indexOf(":");
      if (idx > 0) {
        const k = line.slice(0, idx).trim().toLowerCase();
        const v = line.slice(idx + 1).trim();
        if (k === "background") obj.background = v;
        else if (k === "goal for today" || k === "goal") obj.goal = v;
        else if (k === "area" || k === "therapeutic area") obj.therapeuticArea = v;
        else if (k === "persona" || k === "personakey") obj.personaKey = v;
      }
    }
    if (key && obj) out.push(obj);
    return out;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------- UI ----------
  function buildUI() {
    container.innerHTML = "";
    const wrapper = el("div", "reflectiv-chat");

    // Toolbar
    const toolbar = el("div", "chat-toolbar");

    // Mode select
    const modeSelect = el("select");
    (cfg.modes || []).forEach((m) => {
      const opt = el("option");
      opt.value = m;
      opt.textContent = m.replace(/-/g, " ").replace(/\b(\w)/g, (c) => c.toUpperCase());
      modeSelect.appendChild(opt);
    });
    modeSelect.value = currentMode;
    modeSelect.addEventListener("change", () => {
      currentMode = modeSelect.value;
      currentScenarioId = null;
      conversation = [];
      coachEnabled = false;
      renderMessages();
      updateScenarioSelector();
      updateScenarioMeta();
    });
    toolbar.appendChild(modeSelect);

    // Scenario select (sales-simulation only)
    const scenarioSelect = el("select");
    scenarioSelect.style.display = "none";
    scenarioSelect.setAttribute("aria-label", "Select Physician Profile");
    scenarioSelect.addEventListener("change", () => {
      currentScenarioId = scenarioSelect.value || null;
      conversation = [];
      coachEnabled = false;
      renderMessages();
      updateScenarioMeta();
    });
    toolbar.appendChild(scenarioSelect);

    // Coach toggle
    const coachBtn = el("button", null, "Enable Coach");
    coachBtn.addEventListener("click", () => {
      coachEnabled = !coachEnabled;
      coachBtn.textContent = coachEnabled ? "Disable Coach" : "Enable Coach";
      renderMessages();
    });
    toolbar.appendChild(coachBtn);

    wrapper.appendChild(toolbar);

    // Scenario meta (inline info panel)
    const metaEl = el("div", "scenario-meta");
    wrapper.appendChild(metaEl);

    // Messages area
    const messagesEl = el("div", "chat-messages");
    wrapper.appendChild(messagesEl);

    // Input area
    const inputArea = el("div", "chat-input");
    const textarea = el("textarea");
    textarea.placeholder = "Type your message…";
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const t = textarea.value.trim();
        if (t) sendMessage(t);
        textarea.value = "";
      }
    });
    const sendBtn = el("button", null, "Send");
    sendBtn.addEventListener("click", () => {
      const t = textarea.value.trim();
      if (t) {
        sendMessage(t);
        textarea.value = "";
      }
    });
    inputArea.appendChild(textarea);
    inputArea.appendChild(sendBtn);
    wrapper.appendChild(inputArea);

    container.appendChild(wrapper);

    // Helpers
    function updateScenarioSelector() {
      if (currentMode === "sales-simulation") {
        scenarioSelect.style.display = "";
        scenarioSelect.innerHTML = "<option value=''>Select Physician Profile</option>";
        scenariosList.forEach((sc) => {
          const opt = el("option");
          opt.value = sc.id;
          opt.textContent = sc.label || sc.id;
          scenarioSelect.appendChild(opt);
        });
      } else {
        scenarioSelect.style.display = "none";
      }
    }

    function updateScenarioMeta() {
      const sc = scenariosById.get(currentScenarioId);
      if (!sc || currentMode !== "sales-simulation") {
        metaEl.innerHTML = "";
        return;
      }
      metaEl.innerHTML =
        `<div class="meta-card">
           <div><strong>Therapeutic Area:</strong> ${sc.therapeuticArea || "—"}</div>
           <div><strong>Background:</strong> ${sc.background || "—"}</div>
           <div><strong>Today’s Goal:</strong> ${sc.goal || "—"}</div>
         </div>`;
    }

    function renderMessages() {
      messagesEl.innerHTML = "";
      for (const m of conversation) {
        const div = el("div", `message ${m.role}`);
        div.textContent = m.content;
        messagesEl.appendChild(div);
      }

      const old = container.querySelector(".coach-feedback");
      if (old) old.remove();
      if (coachEnabled && conversation.length) {
        const fb = generateCoachFeedback();
        if (fb) {
          const panel = el("div", "coach-feedback");
          const h3 = el("h3", null, "Coach Feedback");
          panel.appendChild(h3);
          const ul = el("ul");
          [["Tone", fb.tone], ["What worked", fb.worked], ["What to improve", fb.improve], ["Suggested stronger phrasing", fb.phrasing]]
            .forEach(([k, v]) => {
              const li = el("li");
              li.innerHTML = `<strong>${k}:</strong> ${v}`;
              ul.appendChild(li);
            });
          panel.appendChild(ul);
          container.appendChild(panel);
        }
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    updateScenarioSelector();
    updateScenarioMeta();
    renderMessages();

    // ---------- Messaging ----------
    async function sendMessage(userText) {
      conversation.push({ role: "user", content: userText });
      renderMessages();

      const messages = [{ role: "system", content: systemPrompt }];

      if (currentMode === "hiv-product-knowledge") {
        messages.push({ role: "system", content: "You are answering questions about HIV medications using the provided evidence-based knowledge." });
        messages.push({ role: "system", content: knowledge });
      } else if (currentMode === "emotional-assessment") {
        messages.push({ role: "system", content: "You are helping the user reflect on their emotional intelligence and communication style." });
      } else if (currentMode === "sales-simulation" && currentScenarioId) {
        const sc = scenariosById.get(currentScenarioId);
        if (sc) {
          const persona = sc.personaKey ? (personas[sc.personaKey] || {}) : {};
          const personaLine = persona.displayName ? `Persona: ${persona.displayName} (${persona.role || "HCP"}). Style: ${persona.style || "concise"}.\n` : "";
          messages.push({
            role: "system",
            content:
              `Act as the healthcare provider for a sales simulation.\n` +
              `${personaLine}` +
              `Therapeutic Area: ${sc.therapeuticArea || "HCP"}.\n` +
              `Background: ${sc.background || "N/A"}\n` +
              `Today’s Goal: ${sc.goal || "N/A"}\n` +
              `Respond in character and keep answers realistic and compliant.`
          });
        }
      }

      for (const m of conversation) messages.push(m);

      try {
        const endpoint = (cfg.apiBase || cfg.workerEndpoint || "").trim();
        if (!endpoint) throw new Error("Missing apiBase/workerEndpoint in config.json");

        const r = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages,
            model: cfg.model || "llama-3.1-8b-instant",
            temperature: 0.2,
            stream: cfg.stream === true
          })
        });

        if (!r.ok) {
          const t = await r.text().catch(() => "");
          throw new Error(`Upstream ${r.status}: ${t || "no body"}`);
        }

        const data = await r.json().catch(() => ({}));
        const reply =
          data.reply ||
          data.content ||
          data?.choices?.[0]?.message?.content ||
          data?.message?.content ||
          "";

        if (!reply) throw new Error("Empty reply");

        conversation.push({ role: "assistant", content: String(reply).trim() });
        renderMessages();
      } catch (err) {
        console.error("AI call failed:", err);
        conversation.push({
          role: "assistant",
          content: "I couldn’t reach the AI service. Try again later."
        });
        renderMessages();
      }
    }
  }

  function generateCoachFeedback() {
    if (!conversation.length) return null;
    return {
      tone: "neutral",
      worked: "You engaged with the chat and explored the content.",
      improve: "Ask specific, goal-directed questions to get targeted guidance.",
      phrasing: "Try: “Could you walk me through the next best step and why?”"
    };
  }

  // ---------- Init ----------
  async function init() {
    try {
      cfg = await fetchLocal("./assets/chat/config.json");
      systemPrompt = await fetchLocal("./assets/chat/system.md");
      knowledge = await fetchLocal("./assets/chat/about-ei.md");
      try { personas = await fetchLocal("./assets/chat/persona.json"); } catch { personas = {}; }

      if (Array.isArray(cfg.scenarios) && cfg.scenarios.length) {
        scenariosList = cfg.scenarios.map(s => ({
          id: s.id,
          label: s.label || s.id,
          therapeuticArea: s.therapeuticArea || "",
          background: s.background || "",
          goal: s.goal || "",
          personaKey: s.personaKey || ""
        }));
      } else {
        const legacy = await fetchLocal("./assets/chat/data/hcp_scenarios.txt");
        scenariosList = parseLegacyScenarios(legacy);
      }
      scenariosById = new Map(scenariosList.map(s => [s.id, s]));

      buildUI();
    } catch (e) {
      console.error(e);
      container.textContent = "Failed to load ReflectivEI Coach. Check the console for details.";
    }
  }

  // Scoped styles (selector + meta)
  const style = document.createElement("style");
  style.textContent = `
    .cw .chat-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
    .cw select{padding:8px 10px;border:1px solid #cfd8e3;border-radius:8px}
    .cw .scenario-meta .meta-card{background:#f9fafc;border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin-bottom:8px;font-size:.92rem;color:#374151}
    .cw .chat-messages{min-height:180px;max-height:420px;overflow:auto;border:1px solid #e5e7eb;border-radius:10px;padding:10px;background:#fff;margin-bottom:8px}
    .cw .message.user{margin:6px 0;padding:8px 10px;border-radius:8px;background:#eef2ff}
    .cw .message.assistant{margin:6px 0;padding:8px 10px;border-radius:8px;background:#f3f4f6}
    .cw .chat-input{display:flex;gap:8px}
    .cw .chat-input textarea{flex:1;min-height:42px;max-height:160px;padding:8px 10px;border:1px solid #cfd8e3;border-radius:8px;resize:vertical}
    .cw .chat-input button{padding:8px 12px;border:1px solid #cfd8e3;border-radius:8px;background:#fff;color:#1d344f;cursor:pointer}
    .cw .coach-feedback{margin-top:10px;background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:10px}
    .cw .coach-feedback h3{margin:0 0 6px 0;font-size:1rem}
    .cw .coach-feedback ul{margin:0;padding-left:18px}
  `;
  document.head.appendChild(style);

  init();
})();
