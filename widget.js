/*
 * ReflectivEI AI widget — drop-in
 * - Loads config and content from /assets/chat/*
 * - Renders chat UI with three modes
 * - Calls Cloudflare Worker defined in config.apiBase (or workerEndpoint)
 * - Scopes all widget styles under .cw
 * - Markdown rendering + readability polish
 * - Heuristic, turn-aware Coach Feedback
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

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Minimal Markdown -> HTML tuned for chat
  function renderMarkdown(text) {
    if (!text) return "";
    let s = esc(text).replace(/\r\n?/g, "\n");

    // Remove **Name (..)**: -> Name (..):
    s = s.replace(/\*\*([^*\n]+?\([^()\n]+?\))\*\*:/g, "$1:");

    // Headings
    s = s.replace(/^\s*##\s+(.+)$/gm, "<h4>$1</h4>")
         .replace(/^\s*#\s+(.+)$/gm, "<h3>$1</h3>");

    // Blockquote
    s = s.replace(/^\s*>\s?(.*)$/gm, "<blockquote>$1</blockquote>");

    // Bold
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");

    // Ordered lists
    s = s.replace(/(?:^|\n)(\d+\.\s+[^\n]+(?:\n\d+\.\s+[^\n]+)*)/g, m => {
      const items = m.trim().split(/\n/).map(l => l.replace(/^\d+\.\s+/, "").trim());
      return "\n<ol>" + items.map(li => `<li>${li}</li>`).join("") + "</ol>";
    });
    // Unordered lists
    s = s.replace(/(?:^|\n)([-*]\s+[^\n]+(?:\n[-*]\s+[^\n]+)*)/g, m => {
      const items = m.trim().split(/\n/).map(l => l.replace(/^[-*]\s+/, "").trim());
      return "\n<ul>" + items.map(li => `<li>${li}</li>`).join("") + "</ul>";
    });

    // Paragraphs
    const blocks = s.split(/\n{2,}/).map(chunk => {
      if (/^\s*<(h3|h4|ul|ol|li|blockquote)/i.test(chunk)) return chunk;
      return `<p>${chunk.replace(/\n/g, "<br>")}</p>`;
    });
    return blocks.join("\n");
  }

  // Legacy scenarios parser (for hcp_scenarios.txt)
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

  // ---------- Coach Feedback (heuristic, turn-aware) ----------
  function generateCoachFeedback(conv = [], mode = currentMode) {
    if (!conv.length) {
      return {
        tone: "neutral",
        worked: "Ready when you are.",
        improve: "Ask a goal-directed question to begin.",
        phrasing: "Try: “What’s the next best step and why?”"
      };
    }

    const lastUser = [...conv].reverse().find(m => m.role === "user")?.content || "";
    const lastAI   = [...conv].reverse().find(m => m.role === "assistant")?.content || "";

    const qCount = (lastUser.match(/\?/g) || []).length;
    const asksForCommit = /commit|agree|can we|will you|let's|next step/i.test(lastUser);
    const empathy = /\b(thanks|appreciate|understand|sorry|that sounds|i hear)\b/i.test(lastUser);
    const objections = /\b(concern|barrier|issue|risk|resistance|denied|step[- ]?edit)\b/i.test(lastUser);
    const valueHook = /\bbenefit|outcome|impact|why|evidence|data|guideline|access|coverage|pa|prior auth\b/i.test(lastUser);
    const tooLongAI = lastAI.split(/\s+/).length > 180;
    const noStructureAI = !(/<ol>|<ul>|<h3>|<h4>|•|- |\d\./i.test(lastAI));
    const noCTA = !/\b(next step|commit|plan|consider|let's|agree|would you|schedule|start|switch)\b/i.test(lastAI);
    const noQuestionAI = !/\?/i.test(lastAI);

    let tone = "neutral";
    if (empathy) tone = "warm";
    if (/!\s*$/.test(lastUser) || /\b(frustrated|upset|angry)\b/i.test(lastUser)) tone = "tense";

    const worked = [
      qCount > 0 ? "You asked questions to focus the exchange." : null,
      empathy ? "You used empathetic language." : null,
      valueHook ? "You referenced evidence, access, or outcomes." : null,
      objections ? "You surfaced an objection to address." : null
    ].filter(Boolean).join(" ") || "You kept the dialog moving.";

    const improveList = [];
    if (qCount === 0) improveList.push("Ask 1–2 specific questions.");
    if (!asksForCommit && mode === "sales-simulation") improveList.push("Seek a small commitment or next step.");
    if (noStructureAI || tooLongAI) improveList.push("Request a concise, structured reply with bullets.");
    if (noCTA) improveList.push("Ask for a clear action, timeline, or criteria.");
    if (noQuestionAI && mode !== "hiv-product-knowledge") improveList.push("Invite the HCP to react with one question.");
    const improve = improveList.join(" ");

    let phrasing = "“Could you outline the next best step and why?”";
    if (objections) phrasing = "“What would address your top concern so we can proceed?”";
    else if (mode === "sales-simulation" && valueHook)
      phrasing = "“Given the data and access, can we align on which patients you’ll start with?”";
    else if (mode === "hiv-product-knowledge")
      phrasing = "“Please give a 3-bullet summary and one clinical caveat.”";

    return { tone, worked, improve, phrasing };
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
      normalizeCoachPlacement();
    });
    toolbar.appendChild(modeSelect);

    // Scenario select
    const scenarioSelect = el("select");
    scenarioSelect.style.display = "none";
    scenarioSelect.setAttribute("aria-label", "Select Physician Profile");
    scenarioSelect.addEventListener("change", () => {
      currentScenarioId = scenarioSelect.value || null;
      conversation = [];
      coachEnabled = false;
      renderMessages();
      updateScenarioMeta();
      normalizeCoachPlacement();
    });
    toolbar.appendChild(scenarioSelect);

    // Coach toggle
    const coachBtn = el("button", null, "Enable Coach");
    coachBtn.addEventListener("click", () => {
      coachEnabled = !coachEnabled;
      coachBtn.textContent = coachEnabled ? "Disable Coach" : "Enable Coach";
      renderMessages();
      normalizeCoachPlacement();
    });
    toolbar.appendChild(coachBtn);

    wrapper.appendChild(toolbar);

    // Scenario meta
    const metaEl = el("div", "scenario-meta");
    wrapper.appendChild(metaEl);

    // Messages
    const messagesEl = el("div", "chat-messages");
    wrapper.appendChild(messagesEl);

    // Coach feedback panel (sibling of messages + input)
    const coachEl = el("div", "coach-feedback");
    wrapper.appendChild(coachEl);

    // Input
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

    // Ensure coach panel never overlays input and always sits above it
    function normalizeCoachPlacement() {
      // Put coach block right before input
      if (coachEl.nextSibling !== inputArea) {
        wrapper.insertBefore(coachEl, inputArea);
      }
      coachEl.style.position = "relative";
      coachEl.style.zIndex = "1";
    }

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
           <div><strong>Therapeutic Area:</strong> ${esc(sc.therapeuticArea || "—")}</div>
           <div><strong>Background:</strong> ${esc(sc.background || "—")}</div>
           <div><strong>Today’s Goal:</strong> ${esc(sc.goal || "—")}</div>
         </div>`;
    }

    function renderMessages() {
      messagesEl.innerHTML = "";
      for (const m of conversation) {
        const div = el("div", `message ${m.role}`);
        const content = el("div", "content");
        content.innerHTML = renderMarkdown(m.content);
        div.appendChild(content);
        messagesEl.appendChild(div);
      }

      coachEl.innerHTML = "";
      if (coachEnabled) {
        const fb = generateCoachFeedback(conversation, currentMode);
        if (fb) {
          const h3 = el("h3", null, "Coach Feedback");
          coachEl.appendChild(h3);
          const ul = el("ul");
          [["Tone", fb.tone], ["What worked", fb.worked], ["What to improve", fb.improve], ["Suggested stronger phrasing", fb.phrasing]]
            .forEach(([k, v]) => {
              const li = el("li");
              li.innerHTML = `<strong>${k}:</strong> ${esc(v)}`;
              ul.appendChild(li);
            });
          coachEl.appendChild(ul);
          coachEl.style.display = "";
        }
      } else {
        coachEl.style.display = "none";
      }

      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    updateScenarioSelector();
    updateScenarioMeta();
    renderMessages();
    normalizeCoachPlacement();

    // ---------- Messaging ----------
    async function sendMessage(userText) {
      conversation.push({ role: "user", content: userText });
      renderMessages();
      normalizeCoachPlacement();

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
        normalizeCoachPlacement();
      } catch (err) {
        console.error("AI call failed:", err);
        conversation.push({
          role: "assistant",
          content: "I couldn’t reach the AI service. Try again later."
        });
        renderMessages();
        normalizeCoachPlacement();
      }
    }
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

  // ---------- Scoped styles ----------
  const style = document.createElement("style");
  style.textContent = `
    .cw .chat-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
    .cw select{padding:8px 10px;border:1px solid #cfd8e3;border-radius:8px}
    .cw .scenario-meta .meta-card{background:#f9fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px;margin-bottom:10px;font-size:.95rem;color:#374151}

    /* Messages scroll, footer stays visible */
    .cw .chat-messages{min-height:180px;max-height:520px;overflow:auto;border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;background:#fff;margin-bottom:10px}
    .cw .message{margin:8px 0}
    .cw .message.user .content{background:#eef2ff;border-radius:8px;padding:10px}
    .cw .message.assistant .content{background:#f8fafc;border-radius:8px;padding:10px}
    .cw .message .content h3,.cw .message .content h4{margin:0 0 8px 0;color:#1f2937;font-weight:700}
    .cw .message .content p{margin:8px 0;line-height:1.5}
    .cw .message .content ul,.cw .message .content ol{margin:8px 0 8px 22px}
    .cw .message .content blockquote{margin:8px 0;padding:8px 10px;border-left:3px solid #cbd5e1;background:#f9fafb;color:#334155}

    .cw .coach-feedback{position:relative;z-index:1;margin:10px 0 10px 0;background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:10px}
    .cw .coach-feedback h3{margin:0 0 6px 0;font-size:1rem;color:#111827;font-weight:700}
    .cw .coach-feedback ul{margin:0;padding-left:20px;color:#374151}
    .cw .coach-feedback li{margin:4px 0;color:#374151}

    .cw .chat-input{display:flex;gap:8px}
    .cw .chat-input textarea{flex:1;min-height:44px;max-height:200px;padding:10px;border:1px solid #cfd8e3;border-radius:8px;resize:vertical}
    .cw .chat-input button{padding:10px 12px;border:1px solid #cfd8e3;border-radius:8px;background:#fff;color:#1d344f;cursor:pointer}
  `;
  document.head.appendChild(style);

  init();
})();
