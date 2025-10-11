/*
 * ReflectivEI AI widget — drop-in
 * - Loads config and content from /assets/chat/*
 * - Renders chat UI with three modes
 * - Calls Cloudflare Worker defined in config.apiBase (or workerEndpoint)
 * - Scopes all widget styles under .cw to avoid site CSS conflicts
 */

(function () {
  const container = document.getElementById("reflectiv-widget");
  if (!container) return;

  // Ensure widget CSS scope class exists on root
  container.classList.add("cw");

  // ---------- State ----------
  let cfg = null;
  let systemPrompt = "";
  let knowledge = "";
  let scenarios = {};
  let currentMode = "emotional-assessment";
  let currentScenarioKey = null;
  let conversation = [];
  let coachEnabled = false;

  // ---------- Utils ----------
  async function fetchLocal(path) {
    const resp = await fetch(path, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to load ${path} (${resp.status})`);
    const ct = resp.headers.get("content-type") || "";
    return ct.includes("application/json") ? resp.json() : resp.text();
  }

  function parseScenarios(text) {
    const lines = String(text || "").split(/\r?\n/);
    const out = {};
    let key = null, obj = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith("# Scenario:")) {
        if (key && obj) out[key] = obj;
        key = line.slice("# Scenario:".length).trim();
        obj = {};
        continue;
      }
      if (!key || !line) continue;
      const idx = line.indexOf(":");
      if (idx > 0) {
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim();
        obj[k] = v;
      }
    }
    if (key && obj) out[key] = obj;
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
      currentScenarioKey = null;
      conversation = [];
      coachEnabled = false;
      renderMessages();
      updateScenarioSelector();
    });
    toolbar.appendChild(modeSelect);

    // Scenario select (only for sales-simulation)
    const scenarioSelect = el("select");
    scenarioSelect.style.display = "none";
    scenarioSelect.addEventListener("change", () => {
      currentScenarioKey = scenarioSelect.value || null;
      conversation = [];
      coachEnabled = false;
      renderMessages();
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
        scenarioSelect.innerHTML = "<option value=''>Select Scenario</option>";
        Object.keys(scenarios).forEach((k) => {
          const opt = el("option");
          opt.value = k;
          opt.textContent = k;
          scenarioSelect.appendChild(opt);
        });
      } else {
        scenarioSelect.style.display = "none";
      }
    }

    function renderMessages() {
      messagesEl.innerHTML = "";
      for (const m of conversation) {
        const div = el("div", `message ${m.role}`);
        div.textContent = m.content;
        messagesEl.appendChild(div);
      }

      // Coach feedback panel
      const old = container.querySelector(".coach-feedback");
      if (old) old.remove();
      if (coachEnabled && conversation.length) {
        const fb = generateCoachFeedback();
        if (fb) {
          const panel = el("div", "coach-feedback");
          const h3 = el("h3", null, "Coach Feedback");
          panel.appendChild(h3);
          const ul = el("ul");
          const fields = [
            ["Tone", fb.tone],
            ["What worked", fb.worked],
            ["What to improve", fb.improve],
            ["Suggested stronger phrasing", fb.phrasing],
          ];
          for (const [k, v] of fields) {
            const li = el("li");
            li.innerHTML = `<strong>${k}:</strong> ${v}`;
            ul.appendChild(li);
          }
          panel.appendChild(ul);
          container.appendChild(panel);
        }
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    updateScenarioSelector();
    renderMessages();

    // ---------- Messaging ----------
    async function sendMessage(userText) {
      conversation.push({ role: "user", content: userText });
      renderMessages();

      // Build system and context
      const messages = [{ role: "system", content: systemPrompt }];

      if (currentMode === "hiv-product-knowledge") {
        messages.push({ role: "system", content: "You are answering questions about HIV medications using the provided evidence-based knowledge." });
        messages.push({ role: "system", content: knowledge });
      } else if (currentMode === "emotional-assessment") {
        messages.push({ role: "system", content: "You are helping the user reflect on their emotional intelligence and communication style." });
      } else if (currentMode === "sales-simulation" && currentScenarioKey && scenarios[currentScenarioKey]) {
        const sc = scenarios[currentScenarioKey];
        messages.push({ role: "system", content: `Act as a healthcare provider for simulation. Background: ${sc.Background}. Goal: ${sc["Goal for Today"]}. Respond as this provider would.` });
      }

      // Add transcript
      for (const m of conversation) messages.push(m);

      try {
        // Use apiBase if present, else workerEndpoint for backward compatibility
        const endpoint = (cfg.apiBase || cfg.workerEndpoint || "").trim();
        if (!endpoint) throw new Error("Missing apiBase/workerEndpoint in config.json");

        const r = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages,
            model: cfg.model || "llama-3.1-8b-instant",
            temperature: 0.2,
            stream: cfg.stream === true ? true : false
            // Do NOT send systemUrl/kbUrl/personaUrl. The server Worker selects by Origin.
          })
        });

        // Handle non-2xx quickly for clearer errors
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          throw new Error(`Upstream ${r.status}: ${t || "no body"}`);
        }

        const data = await r.json().catch(() => ({}));

        // Accept either OpenAI-style or unified format
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
          content: "I’m sorry, I couldn’t reach the AI service. Please try again later."
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
      // Load config and content
      cfg = await fetchLocal("./assets/chat/config.json");
      systemPrompt = await fetchLocal("./assets/chat/system.md");
      knowledge = await fetchLocal("./assets/chat/about-ei.md");
      const scenText = await fetchLocal("./assets/chat/data/hcp_scenarios.txt");
      scenarios = parseScenarios(scenText);

      buildUI();
    } catch (e) {
      console.error(e);
      container.textContent = "Failed to load ReflectivEI Coach. Check the console for details.";
    }
  }

  init();
})();
