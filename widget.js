/*
 * ReflectivEI AI widget — full drop-in
 * - Modes: emotional-assessment, hiv-product-knowledge, sales-simulation
 * - Streaming (incremental tokens) with Stop
 * - Markdown rendering (sanitized minimal)
 * - Theme toggle (light/dark via CSS vars)
 * - Simple emoji picker; optional file attach (base64) when cfg.allowFiles = true
 * - Coach Feedback BELOW input. No "Tone". Uses <coach>{json}</coach> extracted from model reply.
 * - Scopes all styles under .cw
 */
/*
 * ReflectivEI AI widget — full drop-in
 * - Modes: emotional-assessment, hiv-product-knowledge, sales-simulation
 * - Streaming (incremental tokens) with Stop
 * - Markdown rendering (sanitized minimal)
 * - Simple emoji picker; optional file attach (base64) when cfg.allowFiles = true
 * - Coach Feedback is a separate section BELOW the chat widget (not inside it)
 * - Coach has no "Tone". Uses <coach>{json}</coach> parsed from model reply with heuristic fallback.
 * - Scopes all styles under .cw
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
  let coachEnabled = true;
  let streamAbort = null;
  let pendingFiles = []; // [{name,type,size,base64}]

  // ---------- Utils ----------
  async function fetchLocal(path) {
    const resp = await fetch(path, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to load ${path} (${resp.status})`);
    const ct = resp.headers.get("content-type") || "";
    return ct.includes("application/json") ? resp.json() : resp.text();
  }
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  // Minimal Markdown -> HTML (sanitized)
  function renderMarkdown(text) {
    if (!text) return "";
    let s = esc(text).replace(/\r\n?/g, "\n");
    s = s.replace(/\*\*([^*\n]+?\([^()\n]+?\))\*\*:/g, "$1:");
    s = s.replace(/^\s*##\s+(.+)$/gm, "<h4>$1</h4>")
         .replace(/^\s*#\s+(.+)$/gm, "<h3>$1</h3>");
    s = s.replace(/^\s*>\s?(.*)$/gm, "<blockquote>$1</blockquote>");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/```([\s\S]*?)```/g, (m, code) => `<pre><code>${esc(code)}</code></pre>`);
    s = s.replace(/(?:^|\n)(\d+\.\s+[^\n]+(?:\n\d+\.\s+[^\n]+)*)/g, m => {
      const items = m.trim().split(/\n/).map(l => l.replace(/^\d+\.\s+/, "").trim());
      return "\n<ol>" + items.map(li => `<li>${li}</li>`).join("") + "</ol>";
    });
    s = s.replace(/(?:^|\n)([-*]\s+[^\n]+(?:\n[-*]\s+[^\n]+)*)/g, m => {
      const items = m.trim().split(/\n/).map(l => l.replace(/^[-*]\s+/, "").trim());
      return "\n<ul>" + items.map(li => `<li>${li}</li>`).join("") + "</ul>";
    });
    const blocks = s.split(/\n{2,}/).map(chunk => {
      if (/^\s*<(h3|h4|ul|ol|li|blockquote|pre|code)/i.test(chunk)) return chunk;
      return `<p>${chunk.replace(/\n/g, "<br>")}</p>`;
    });
    return blocks.join("\n");
  }
  // Legacy scenarios parser
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

  // ---------- Coach Feedback ----------
  function extractCoach(raw) {
    const m = String(raw || "").match(/<coach>([\s\S]*?)<\/coach>/i);
    if (!m) return { coach: null, clean: raw };
    let coach = null;
    try { coach = JSON.parse(m[1]); } catch { coach = null; }
    const clean = String(raw).replace(m[0], "").trim();
    return { coach, clean };
  }
  function heuristicCoach(conv = [], mode = currentMode) {
    if (!conv.length) return null;
    const lastUser = [...conv].reverse().find(m => m.role === "user")?.content || "";
    const lastAI   = [...conv].reverse().find(m => m.role === "assistant")?.content || "";
    const qCount = (lastUser.match(/\?/g) || []).length;
    const asksForCommit = /commit|agree|can we|will you|let's|next step/i.test(lastUser);
    const objections = /\b(concern|barrier|issue|risk|denied|step[- ]?edit|side effect|cost|coverage|pa|prior auth)\b/i.test(lastUser);
    const valueHook = /\bbenefit|outcome|impact|why|evidence|data|guideline|access|coverage|pa|prior auth\b/i.test(lastUser);
    const tooLongAI = lastAI.split(/\s+/).length > 160;
    const noStructureAI = !(/<ol>|<ul>|<h3>|<h4>|•|- |\d\./i.test(lastAI));
    const noCTA = !/\b(next step|commit|plan|consider|agree|schedule|start|switch)\b/i.test(lastAI);
    const worked = [];
    if (qCount > 0) worked.push("You asked at least one focused question.");
    if (valueHook) worked.push("You referenced evidence, access, or outcomes.");
    if (objections) worked.push("You named a barrier to address.");
    const improve = [];
    if (qCount === 0) improve.push("Ask 1–2 specific questions.");
    if (!asksForCommit && mode === "sales-simulation") improve.push("Seek a small commitment or next step.");
    if (noStructureAI || tooLongAI) improve.push("Keep answers concise with bullets.");
    if (noCTA) improve.push("End with a clear action.");
    let phrasing = "“Could we align on one next step for your eligible patients?”";
    if (objections) phrasing = "“What would address that top concern so we can proceed?”";
    if (mode === "hiv-product-knowledge") phrasing = "“Please give a 3-bullet summary and one clinical caveat.”";
    return { worked, improve, phrasing };
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
      coachEnabled = true;
      pendingFiles = [];
      renderMessages();
      updateScenarioSelector();
      updateScenarioMeta();
      renderCoach(); // ensure section updates
    });
    toolbar.appendChild(modeSelect);

    // Scenario select
    const scenarioSelect = el("select");
    scenarioSelect.style.display = "none";
    scenarioSelect.setAttribute("aria-label", "Select Physician Profile");
    scenarioSelect.addEventListener("change", () => {
      currentScenarioId = scenarioSelect.value || null;
      conversation = [];
      coachEnabled = true;
      renderMessages();
      updateScenarioMeta();
      renderCoach();
    });
    toolbar.appendChild(scenarioSelect);

    // Coach toggle
    const coachBtn = el("button", "btn", "Coach: On");
    coachBtn.addEventListener("click", () => {
      coachEnabled = !coachEnabled;
      coachBtn.textContent = coachEnabled ? "Coach: On" : "Coach: Off";
      renderCoach();
    });
    toolbar.appendChild(coachBtn);

    wrapper.appendChild(toolbar);

    // Scenario meta
    const metaEl = el("div", "scenario-meta");
    wrapper.appendChild(metaEl);

    // Messages
    const messagesEl = el("div", "chat-messages");
    wrapper.appendChild(messagesEl);

    // Input
    const inputArea = el("div", "chat-input");

    // Emoji picker
    const emojiBtn = el("button", "btn icon", "😊");
    const emojiMenu = el("div", "emoji-menu");
    const EMOJIS = ["😊","👍","🙏","💡","📌","✅","❓","🚀","📞","🧪"];
    EMOJIS.forEach(em => {
      const b = el("button", "emoji", em);
      b.onclick = () => { textarea.value += em; emojiMenu.style.display = "none"; textarea.focus(); };
      emojiMenu.appendChild(b);
    });
    emojiBtn.onclick = () => {
      emojiMenu.style.display = emojiMenu.style.display === "block" ? "none" : "block";
    };

    // File attach
    const fileBtn = el("button", "btn icon", "📎");
    const fileIn = document.createElement("input");
    fileIn.type = "file";
    fileIn.multiple = true;
    fileIn.style.display = "none";
    fileBtn.onclick = () => { if (cfg.allowFiles) fileIn.click(); };
    const fileChips = el("div", "file-chips");

    fileIn.addEventListener("change", async () => {
      if (!cfg.allowFiles) return;
      const files = Array.from(fileIn.files || []);
      for (const f of files) {
        const chip = el("span", "chip", `${f.name}`);
        fileChips.appendChild(chip);
        const base64 = await fileToBase64(f);
        pendingFiles.push({ name: f.name, type: f.type, size: f.size, base64 });
      }
      fileIn.value = "";
    });

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

    const sendBtn = el("button", "btn primary", "Send");
    sendBtn.addEventListener("click", () => {
      const t = textarea.value.trim();
      if (t) {
        sendMessage(t);
        textarea.value = "";
      }
    });

    const stopBtn = el("button", "btn warn", "Stop");
    stopBtn.style.display = "none";
    stopBtn.onclick = () => { if (streamAbort) { streamAbort.abort(); streamAbort = null; stopBtn.style.display = "none"; } };

    inputArea.appendChild(emojiBtn);
    inputArea.appendChild(fileBtn);
    inputArea.appendChild(fileChips);
    inputArea.appendChild(emojiMenu);
    inputArea.appendChild(textarea);
    inputArea.appendChild(sendBtn);
    inputArea.appendChild(stopBtn);
    wrapper.appendChild(inputArea);

    // Mount chat widget
    container.appendChild(wrapper);

    // Coach Feedback as a SEPARATE SECTION below the chat widget
    const coachSection = el("div", "coach-section");
    coachSection.innerHTML = `<h3>Coach Feedback</h3><div class="coach-body muted">No feedback yet.</div>`;
    container.appendChild(coachSection);

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
      const persona = sc.personaKey ? (personas[sc.personaKey] || {}) : {};
      metaEl.innerHTML =
        `<div class="meta-card">
           <div><strong>Therapeutic Area:</strong> ${esc(sc.therapeuticArea || "—")}</div>
           <div><strong>Background:</strong> ${esc(sc.background || "—")}</div>
           <div><strong>Today’s Goal:</strong> ${esc(sc.goal || "—")}</div>
           <div><strong>Persona:</strong> ${esc(persona.displayName || "—")}</div>
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
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderCoach() {
      const body = coachSection.querySelector(".coach-body");
      if (!coachEnabled) { coachSection.style.display = "none"; return; }
      const last = conversation[conversation.length - 1];
      if (!(last && last.role === "assistant" && last._coach)) {
        coachSection.style.display = "none";
        return;
      }
      const fb = last._coach;
      coachSection.style.display = "";
      body.innerHTML =
        `<ul class="coach-list">
           <li><strong>What worked:</strong> ${esc((fb.worked || []).join(" ") || "—")}</li>
           <li><strong>What to improve:</strong> ${esc((fb.improve || []).join(" ") || "—")}</li>
           <li><strong>Suggested stronger phrasing:</strong> ${esc(fb.phrasing || "—")}</li>
         </ul>`;
    }

    updateScenarioSelector();
    updateScenarioMeta();
    renderMessages();
    renderCoach();

    // ---------- Messaging ----------
    async function sendMessage(userText) {
      // Attach any selected files as a note prefix
      let content = userText;
      if (cfg.allowFiles && pendingFiles.length) {
        const summary = pendingFiles.map(f => `${f.name} (${Math.round(f.size/1024)} KB)`).join(", ");
        content = `(Attached: ${summary})\n\n` + userText;
      }

      conversation.push({ role: "user", content });
      renderMessages();
      renderCoach();

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
`Act as the healthcare provider for a sales simulation.
${personaLine}Therapeutic Area: ${sc.therapeuticArea || "HCP"}.
Background: ${sc.background || "N/A"}
Today’s Goal: ${sc.goal || "N/A"}
Respond in character and keep answers realistic and compliant.`
          });
        }
      }

      // Coach instructions appended to force tailored feedback
      messages.push({
        role: "system",
        content:
`After you produce your reply, output tailored coaching strictly about:
- The user's most recent message, and
- The assistant reply you just wrote.

Return coaching ONLY as JSON wrapped in tags:
<coach>{
  "worked": ["bullet 1","bullet 2"],
  "improve": ["bullet 1","bullet 2"],
  "phrasing": "one concise rewrite for a stronger ask or next step"
}</coach>

Rules: No "Tone". Be specific. Quote short fragments when useful. Keep lists 1–3 items.`
      });

      // Include attachments payload if allowed
      let extra = {};
      if (cfg.allowFiles && pendingFiles.length) {
        extra.attachments = pendingFiles.map(({ name, type, size, base64 }) => ({ name, type, size, base64 }));
      }

      try {
        const endpoint = (cfg.apiBase || cfg.workerEndpoint || "").trim();
        if (!endpoint) throw new Error("Missing apiBase/workerEndpoint in config.json");

        const useStream = cfg.stream === true;
        if (useStream) {
          // Create assistant bubble now and stream into it
          const assist = { role: "assistant", content: "" };
          conversation.push(assist);
          renderMessages();

          const controller = new AbortController();
          streamAbort = controller;
          const r = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages,
              model: cfg.model || "llama-3.1-8b-instant",
              temperature: 0.2,
              stream: true,
              ...extra
            }),
            signal: controller.signal
          });
          if (!r.ok || !r.body) throw new Error(`Upstream ${r.status}`);

          // show Stop while streaming
          const stopBtn = container.querySelector(".btn.warn");
          if (stopBtn) stopBtn.style.display = "inline-block";

          const reader = r.body.getReader();
          const decoder = new TextDecoder();
          let acc = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            acc += chunk;
            assist.content = acc;
            renderMessages(); // partial render; coach shown on completion
          }
          const { coach, clean } = extractCoach(acc);
          assist.content = clean || "";
          assist._coach = coach || heuristicCoach(conversation);
          renderMessages();
          renderCoach();

          if (stopBtn) stopBtn.style.display = "none";
          streamAbort = null;
        } else {
          const r = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages,
              model: cfg.model || "llama-3.1-8b-instant",
              temperature: 0.2,
              stream: false,
              ...extra
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

          const { coach, clean } = extractCoach(String(reply));
          conversation.push({ role: "assistant", content: String(clean || "").trim(), _coach: coach || heuristicCoach(conversation) });
          renderMessages();
          renderCoach();
        }
      } catch (err) {
        console.error("AI call failed:", err);
        conversation.push({ role: "assistant", content: "I couldn’t reach the AI service. Try again later." });
        renderMessages();
        renderCoach();
      } finally {
        pendingFiles = [];
        const chips = container.querySelector(".file-chips");
        if (chips) chips.innerHTML = "";
      }
    }

    // helpers
    async function fileToBase64(file) {
      return new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onerror = () => rej(new Error("file read error"));
        fr.onload = () => res(String(fr.result).split(",")[1] || "");
        fr.readAsDataURL(file);
      });
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
  .cw .reflectiv-chat{--bg:#ffffff;--fg:#111827;--muted:#6b7280;--card:#f9fafc;--line:#e5e7eb;--accent:#3e5494;--warn:#9b1c1c}
  .cw .reflectiv-chat{background:transparent;color:var(--fg)}

  .cw .chat-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
  .cw select{padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
  .cw .btn{padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);cursor:pointer}
  .cw .btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
  .cw .btn.warn{background:var(--warn);color:#fff;border-color:var(--warn)}
  .cw .btn.icon{width:40px}

  .cw .scenario-meta .meta-card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px;font-size:.95rem}

  .cw .chat-messages{min-height:180px;max-height:520px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--bg);margin-bottom:10px}
  .cw .message{margin:8px 0}
  .cw .message.user .content{background:#eef2ff;border-radius:8px;padding:10px}
  .cw .message.assistant .content{background:var(--card);border-radius:8px;padding:10px}
  .cw .message .content h3,.cw .message .content h4{margin:0 0 8px 0;color:var(--fg);font-weight:700}
  .cw .message .content p{margin:8px 0;line-height:1.5}
  .cw .message .content ul,.cw .message .content ol{margin:8px 0 8px 22px}
  .cw .message .content blockquote{margin:8px 0;padding:8px 10px;border-left:3px solid var(--line);background:var(--card);color:var(--fg)}
  .cw pre{background:#0b1020;color:#d1d5db;border-radius:8px;padding:8px;overflow:auto;border:1px solid #1f2937}

  .cw .chat-input{display:grid;grid-template-columns:auto auto 1fr auto auto;gap:8px;align-items:start}
  .cw .chat-input textarea{width:100%;min-height:44px;max-height:200px;padding:10px;border:1px solid var(--line);border-radius:8px;resize:vertical;background:var(--bg);color:var(--fg)}
  .cw .emoji-menu{display:none;position:absolute;transform:translateY(-110%);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:6px;box-shadow:0 10px 24px rgba(0,0,0,.18);z-index:10}
  .cw .emoji{padding:4px 6px;border:none;background:transparent;font-size:18px;cursor:pointer}
  .cw .file-chips{grid-column:1 / span 5;display:flex;gap:6px;flex-wrap:wrap}
  .cw .chip{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px 8px;font-size:12px}

  /* Separate Coach Section under the widget */
  .cw .coach-section{margin-top:8px;background:#fffbea;border:1px solid #fde68a;border-radius:10px;padding:10px}
  .cw .coach-section h3{margin:0 0 6px 0;font-size:1rem;color:#111827;font-weight:700}
  .cw .coach-section .muted{color:#6b7280}
  .cw .coach-section .coach-list{margin:0;padding-left:20px}
  .cw .coach-section li{margin:4px 0;color:#374151}
  `;
  document.head.appendChild(style);

  init();
})();

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
  let coachEnabled = true;
  let theme = "light";
  let streamAbort = null;
  let pendingFiles = []; // [{name,type,size,base64}]

  // ---------- Utils ----------
  async function fetchLocal(path) {
    const resp = await fetch(path, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to load ${path} (${resp.status})`);
    const ct = resp.headers.get("content-type") || "";
    return ct.includes("application/json") ? resp.json() : resp.text();
  }
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  // Minimal Markdown -> HTML (sanitized)
  function renderMarkdown(text) {
    if (!text) return "";
    let s = esc(text).replace(/\r\n?/g, "\n");
    s = s.replace(/\*\*([^*\n]+?\([^()\n]+?\))\*\*:/g, "$1:");
    s = s.replace(/^\s*##\s+(.+)$/gm, "<h4>$1</h4>")
         .replace(/^\s*#\s+(.+)$/gm, "<h3>$1</h3>");
    s = s.replace(/^\s*>\s?(.*)$/gm, "<blockquote>$1</blockquote>");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/```([\s\S]*?)```/g, (m, code) => `<pre><code>${esc(code)}</code></pre>`);
    s = s.replace(/(?:^|\n)(\d+\.\s+[^\n]+(?:\n\d+\.\s+[^\n]+)*)/g, m => {
      const items = m.trim().split(/\n/).map(l => l.replace(/^\d+\.\s+/, "").trim());
      return "\n<ol>" + items.map(li => `<li>${li}</li>`).join("") + "</ol>";
    });
    s = s.replace(/(?:^|\n)([-*]\s+[^\n]+(?:\n[-*]\s+[^\n]+)*)/g, m => {
      const items = m.trim().split(/\n/).map(l => l.replace(/^[-*]\s+/, "").trim());
      return "\n<ul>" + items.map(li => `<li>${li}</li>`).join("") + "</ul>";
    });
    const blocks = s.split(/\n{2,}/).map(chunk => {
      if (/^\s*<(h3|h4|ul|ol|li|blockquote|pre|code)/i.test(chunk)) return chunk;
      return `<p>${chunk.replace(/\n/g, "<br>")}</p>`;
    });
    return blocks.join("\n");
  }
  // Legacy scenarios parser
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

  // ---------- Coach Feedback ----------
  // Extract <coach>{json}</coach> from assistant content
  function extractCoach(raw) {
    const m = String(raw || "").match(/<coach>([\s\S]*?)<\/coach>/i);
    if (!m) return { coach: null, clean: raw };
    let coach = null;
    try { coach = JSON.parse(m[1]); } catch { coach = null; }
    const clean = String(raw).replace(m[0], "").trim();
    return { coach, clean };
  }
  // Heuristic fallback if model omitted coach tag
  function heuristicCoach(conv = [], mode = currentMode) {
    if (!conv.length) return null;
    const lastUser = [...conv].reverse().find(m => m.role === "user")?.content || "";
    const lastAI   = [...conv].reverse().find(m => m.role === "assistant")?.content || "";
    const qCount = (lastUser.match(/\?/g) || []).length;
    const asksForCommit = /commit|agree|can we|will you|let's|next step/i.test(lastUser);
    const objections = /\b(concern|barrier|issue|risk|denied|step[- ]?edit|side effect|cost|coverage|pa|prior auth)\b/i.test(lastUser);
    const valueHook = /\bbenefit|outcome|impact|why|evidence|data|guideline|access|coverage|pa|prior auth\b/i.test(lastUser);
    const tooLongAI = lastAI.split(/\s+/).length > 160;
    const noStructureAI = !(/<ol>|<ul>|<h3>|<h4>|•|- |\d\./i.test(lastAI));
    const noCTA = !/\b(next step|commit|plan|consider|agree|schedule|start|switch)\b/i.test(lastAI);
    const worked = [];
    if (qCount > 0) worked.push("You asked at least one focused question.");
    if (valueHook) worked.push("You referenced evidence, access, or outcomes.");
    if (objections) worked.push("You named a barrier to address.");
    const improve = [];
    if (qCount === 0) improve.push("Ask 1–2 specific questions.");
    if (!asksForCommit && mode === "sales-simulation") improve.push("Seek a small commitment or next step.");
    if (noStructureAI || tooLongAI) improve.push("Keep answers concise with bullets.");
    if (noCTA) improve.push("End with a clear action.");
    let phrasing = "“Could we align on one next step for your eligible patients?”";
    if (objections) phrasing = "“What would address that top concern so we can proceed?”";
    if (mode === "hiv-product-knowledge") phrasing = "“Please give a 3-bullet summary and one clinical caveat.”";
    return { worked, improve, phrasing };
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
      coachEnabled = true;
      pendingFiles = [];
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
      coachEnabled = true;
      renderMessages();
      updateScenarioMeta();
      normalizeCoachPlacement();
    });
    toolbar.appendChild(scenarioSelect);

    // Coach toggle
    const coachBtn = el("button", "btn", "Coach: On");
    coachBtn.addEventListener("click", () => {
      coachEnabled = !coachEnabled;
      coachBtn.textContent = coachEnabled ? "Coach: On" : "Coach: Off";
      renderMessages();
      normalizeCoachPlacement();
    });
    toolbar.appendChild(coachBtn);

    // Theme toggle
    const themeBtn = el("button", "btn", "Theme");
    themeBtn.addEventListener("click", () => {
      theme = theme === "light" ? "dark" : "light";
      wrapper.setAttribute("data-theme", theme);
    });
    toolbar.appendChild(themeBtn);

    wrapper.appendChild(toolbar);

    // Scenario meta
    const metaEl = el("div", "scenario-meta");
    wrapper.appendChild(metaEl);

    // Messages
    const messagesEl = el("div", "chat-messages");
    wrapper.appendChild(messagesEl);

    // Input
    const inputArea = el("div", "chat-input");

    // Emoji picker
    const emojiBtn = el("button", "btn icon", "😊");
    const emojiMenu = el("div", "emoji-menu");
    const EMOJIS = ["😊","👍","🙏","💡","📌","✅","❓","🚀","📞","🧪"];
    EMOJIS.forEach(em => {
      const b = el("button", "emoji", em);
      b.onclick = () => { textarea.value += em; emojiMenu.style.display = "none"; textarea.focus(); };
      emojiMenu.appendChild(b);
    });
    emojiBtn.onclick = () => {
      emojiMenu.style.display = emojiMenu.style.display === "block" ? "none" : "block";
    };

    // File attach
    const fileBtn = el("button", "btn icon", "📎");
    const fileIn = document.createElement("input");
    fileIn.type = "file";
    fileIn.multiple = true;
    fileIn.style.display = "none";
    fileBtn.onclick = () => { if (cfg.allowFiles) fileIn.click(); };
    const fileChips = el("div", "file-chips");

    fileIn.addEventListener("change", async () => {
      if (!cfg.allowFiles) return;
      const files = Array.from(fileIn.files || []);
      for (const f of files) {
        const chip = el("span", "chip", `${f.name}`);
        fileChips.appendChild(chip);
        const base64 = await fileToBase64(f);
        pendingFiles.push({ name: f.name, type: f.type, size: f.size, base64 });
      }
      fileIn.value = "";
    });

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

    const sendBtn = el("button", "btn primary", "Send");
    sendBtn.addEventListener("click", () => {
      const t = textarea.value.trim();
      if (t) {
        sendMessage(t);
        textarea.value = "";
      }
    });

    const stopBtn = el("button", "btn warn", "Stop");
    stopBtn.style.display = "none";
    stopBtn.onclick = () => { if (streamAbort) { streamAbort.abort(); streamAbort = null; stopBtn.style.display = "none"; } };

    inputArea.appendChild(emojiBtn);
    inputArea.appendChild(fileBtn);
    inputArea.appendChild(fileChips);
    inputArea.appendChild(emojiMenu);
    inputArea.appendChild(textarea);
    inputArea.appendChild(sendBtn);
    inputArea.appendChild(stopBtn);
    wrapper.appendChild(inputArea);

    // Coach feedback panel BELOW input
    const coachEl = el("div", "coach-feedback");
    wrapper.appendChild(coachEl);

    container.appendChild(wrapper);

    function normalizeCoachPlacement() {
      if (coachEl.previousSibling !== inputArea) {
        wrapper.insertBefore(coachEl, inputArea.nextSibling);
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
      const persona = sc.personaKey ? (personas[sc.personaKey] || {}) : {};
      metaEl.innerHTML =
        `<div class="meta-card">
           <div><strong>Therapeutic Area:</strong> ${esc(sc.therapeuticArea || "—")}</div>
           <div><strong>Background:</strong> ${esc(sc.background || "—")}</div>
           <div><strong>Today’s Goal:</strong> ${esc(sc.goal || "—")}</div>
           <div><strong>Persona:</strong> ${esc(persona.displayName || "—")}</div>
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
      // Coach
      coachEl.innerHTML = "";
      if (coachEnabled) {
        const last = conversation[conversation.length - 1];
        if (last && last.role === "assistant" && last._coach) {
          const fb = last._coach;
          const h3 = el("h3", null, "Coach Feedback");
          coachEl.appendChild(h3);
          const ul = el("ul");
          [["What worked", (fb.worked || []).join(" ") || "—"],
           ["What to improve", (fb.improve || []).join(" ") || "—"],
           ["Suggested stronger phrasing", fb.phrasing || "—"]]
            .forEach(([k, v]) => {
              const li = el("li");
              li.innerHTML = `<strong>${k}:</strong> ${esc(v)}`;
              ul.appendChild(li);
            });
          coachEl.appendChild(ul);
          coachEl.style.display = "";
        } else {
          coachEl.style.display = "none";
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
      // Attach any selected files as a note prefix
      let content = userText;
      if (cfg.allowFiles && pendingFiles.length) {
        const summary = pendingFiles.map(f => `${f.name} (${Math.round(f.size/1024)} KB)`).join(", ");
        content = `(Attached: ${summary})\n\n` + userText;
      }

      conversation.push({ role: "user", content });
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
`Act as the healthcare provider for a sales simulation.
${personaLine}Therapeutic Area: ${sc.therapeuticArea || "HCP"}.
Background: ${sc.background || "N/A"}
Today’s Goal: ${sc.goal || "N/A"}
Respond in character and keep answers realistic and compliant.`
          });
        }
      }

      // Coach instructions appended to the final system message to force tailored feedback
      messages.push({
        role: "system",
        content:
`After you produce your reply, output tailored coaching strictly about:
- The user's most recent message, and
- The assistant reply you just wrote.

Return coaching ONLY as JSON wrapped in tags:
<coach>{
  "worked": ["bullet 1","bullet 2"],
  "improve": ["bullet 1","bullet 2"],
  "phrasing": "one concise rewrite for a stronger ask or next step"
}</coach>

Rules: No "Tone". Be specific. Quote short fragments when useful. Keep lists 1–3 items.`
      });

      // Include attachments payload if allowed
      let extra = {};
      if (cfg.allowFiles && pendingFiles.length) {
        extra.attachments = pendingFiles.map(({ name, type, size, base64 }) => ({ name, type, size, base64 }));
      }

      try {
        const endpoint = (cfg.apiBase || cfg.workerEndpoint || "").trim();
        if (!endpoint) throw new Error("Missing apiBase/workerEndpoint in config.json");

        const useStream = cfg.stream === true;
        if (useStream) {
          // Create assistant bubble now and stream into it
          const assist = { role: "assistant", content: "" };
          conversation.push(assist);
          renderMessages();
          normalizeCoachPlacement();

          const controller = new AbortController();
          streamAbort = controller;
          const r = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages,
              model: cfg.model || "llama-3.1-8b-instant",
              temperature: 0.2,
              stream: true,
              ...extra
            }),
            signal: controller.signal
          });
          if (!r.ok || !r.body) throw new Error(`Upstream ${r.status}`);

          // show Stop while streaming
          stopBtn.style.display = "inline-block";

          const reader = r.body.getReader();
          const decoder = new TextDecoder();
          let acc = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            acc += chunk;
            assist.content = acc;
            // don't render coach until done; render partial text
            renderMessages();
          }

          // finalize: parse coach tag
          const { coach, clean } = extractCoach(acc);
          assist.content = clean || "";
          assist._coach = coach || heuristicCoach(conversation);
          renderMessages();
        } else {
          const r = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages,
              model: cfg.model || "llama-3.1-8b-instant",
              temperature: 0.2,
              stream: false,
              ...extra
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

          const { coach, clean } = extractCoach(String(reply));
          conversation.push({ role: "assistant", content: String(clean || "").trim(), _coach: coach || heuristicCoach(conversation) });
          renderMessages();
        }
      } catch (err) {
        console.error("AI call failed:", err);
        conversation.push({ role: "assistant", content: "I couldn’t reach the AI service. Try again later." });
        renderMessages();
      } finally {
        // Clear attachments after send
        pendingFiles = [];
        fileChips.innerHTML = "";
        if (streamAbort) { streamAbort = null; }
        stopBtn.style.display = "none";
      }
    }

    // helpers
    async function fileToBase64(file) {
      return new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onerror = () => rej(new Error("file read error"));
        fr.onload = () => res(String(fr.result).split(",")[1] || "");
        fr.readAsDataURL(file);
      });
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
  .cw [data-theme="light"] {}
  .cw [data-theme="dark"] {}

  .cw .reflectiv-chat{--bg:#ffffff;--fg:#111827;--muted:#6b7280;--card:#f9fafc;--line:#e5e7eb;--accent:#3e5494;--warn:#9b1c1c}
  .cw .reflectiv-chat[data-theme="dark"]{--bg:#0f172a;--fg:#e5e7eb;--muted:#94a3b8;--card:#0b1220;--line:#1f2a44;--accent:#6b83d6;--warn:#ef4444}
  .cw .reflectiv-chat{background:transparent;color:var(--fg)}

  .cw .chat-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
  .cw select{padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
  .cw .btn{padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);cursor:pointer}
  .cw .btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
  .cw .btn.warn{background:var(--warn);color:#fff;border-color:var(--warn)}
  .cw .btn.icon{width:40px}
  .cw .scenario-meta .meta-card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px;font-size:.95rem}

  .cw .chat-messages{min-height:180px;max-height:520px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--bg);margin-bottom:10px}
  .cw .message{margin:8px 0}
  .cw .message.user .content{background:#eef2ff;border-radius:8px;padding:10px}
  .cw .message.assistant .content{background:var(--card);border-radius:8px;padding:10px}
  .cw .message .content h3,.cw .message .content h4{margin:0 0 8px 0;color:var(--fg);font-weight:700}
  .cw .message .content p{margin:8px 0;line-height:1.5}
  .cw .message .content ul,.cw .message .content ol{margin:8px 0 8px 22px}
  .cw .message .content blockquote{margin:8px 0;padding:8px 10px;border-left:3px solid var(--line);background:var(--card);color:var(--fg)}
  .cw pre{background:#0b1020;color:#d1d5db;border-radius:8px;padding:8px;overflow:auto;border:1px solid #1f2937}

  .cw .chat-input{display:grid;grid-template-columns:auto auto 1fr auto auto;gap:8px;align-items:start}
  .cw .chat-input textarea{width:100%;min-height:44px;max-height:200px;padding:10px;border:1px solid var(--line);border-radius:8px;resize:vertical;background:var(--bg);color:var(--fg)}
  .cw .emoji-menu{display:none;position:absolute;transform:translateY(-110%);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:6px;box-shadow:0 10px 24px rgba(0,0,0,.18);z-index:10}
  .cw .emoji{padding:4px 6px;border:none;background:transparent;font-size:18px;cursor:pointer}
  .cw .file-chips{grid-column:1 / span 5;display:flex;gap:6px;flex-wrap:wrap}
  .cw .chip{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px 8px;font-size:12px}

  .cw .coach-feedback{position:relative;z-index:1;margin:10px 0 0 0;background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:10px}
  .cw .coach-feedback h3{margin:0 0 6px 0;font-size:1rem;color:var(--fg);font-weight:700}
  .cw .coach-feedback ul{margin:0;padding-left:20px;color:var(--fg)}
  .cw .coach-feedback li{margin:4px 0}
  `;
  document.head.appendChild(style);

  init();
})();
