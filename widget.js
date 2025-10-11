/*
 * ReflectivEI chat widget — fixed input always visible
 * - Modes: emotional-assessment, hiv-product-knowledge, sales-simulation
 * - Separate Coach Feedback section under the chat
 * - Enter = Send, Shift+Enter = newline
 * - No emoji/file/theme
 * - Tailored Coach via <coach>{...}</coach> with heuristic fallback + scoring
 * - Analytics POST if analyticsEndpoint in config.json
 */

(function () {
  const mount = document.getElementById("reflectiv-widget");
  if (!mount) return;

  // namespace the host with a class
  if (!mount.classList.contains("cw")) mount.classList.add("cw");

  // ---------- state ----------
  let cfg = null;
  let systemPrompt = "";
  let personas = {};
  let scenariosList = [];
  let scenariosById = new Map();

  let currentMode = "sales-simulation";
  let currentScenarioId = null;
  let conversation = [];
  let coachEnabled = true;

  // ---------- utils ----------
  async function fetchLocal(path) {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(`Failed to load ${path} (${r.status})`);
    const ct = r.headers.get("content-type") || "";
    return ct.includes("application/json") ? r.json() : r.text();
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // minimal markdown for bubbles
  function md(text) {
    if (!text) return "";
    let s = esc(text).replace(/\r\n?/g, "\n");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    return s.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("\n");
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // parse <coach>{...}</coach>
  function extractCoach(raw) {
    const m = String(raw || "").match(/<coach>([\s\S]*?)<\/coach>/i);
    if (!m) return { coach: null, clean: raw };
    let coach = null;
    try { coach = JSON.parse(m[1]); } catch {}
    return { coach, clean: String(raw).replace(m[0], "").trim() };
  }

  // fallback if model omitted <coach>
  function heuristicCoach(conv = [], mode = currentMode) {
    if (!conv.length) return null;
    const lastUser = [...conv].reverse().find(m => m.role === "user")?.content || "";
    const qCount = (lastUser.match(/\?/g) || []).length;
    const objection = /\b(concern|barrier|risk|cost|coverage|auth|denied|step[- ]?edit)\b/i.test(lastUser);
    const worked = [];
    const improve = [];
    if (qCount > 0) worked.push("You asked a focused question.");
    else improve.push("Ask at least one clear question.");
    if (objection) worked.push("You surfaced a barrier.");
    else improve.push("Probe for barriers to progress.");
    const subscores = {
      question_quality: qCount ? 4 : 2,
      objection_handling: objection ? 4 : 2,
      empathy: 3,
      compliance: 4
    };
    const score = Math.round(
      (subscores.question_quality + subscores.objection_handling + subscores.empathy + subscores.compliance) / 20 * 100
    );
    return {
      worked,
      improve,
      phrasing: "“Could we align on one next step for your eligible patients?”",
      score,
      subscores
    };
  }

  // ---------- UI ----------
  function buildUI() {
    mount.innerHTML = "";

    const wrapper = el("div", "reflectiv-chat");

    // toolbar
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
      currentMode = modeSelect.value;
      currentScenarioId = null;
      conversation = [];
      renderMessages();
      updateScenarioSelector();
      updateScenarioMeta();
      renderCoach();
    };
    toolbar.appendChild(modeSelect);

    const scenarioSelect = el("select");
    scenarioSelect.style.display = "none";
    scenarioSelect.onchange = () => {
      currentScenarioId = scenarioSelect.value || null;
      conversation = [];
      renderMessages();
      updateScenarioMeta();
      renderCoach();
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

    // scenario meta
    const metaEl = el("div", "scenario-meta");
    wrapper.appendChild(metaEl);

    // messages
    const messagesEl = el("div", "chat-messages");
    wrapper.appendChild(messagesEl);

    // input
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

    // mount chat and separate coach section
    mount.appendChild(wrapper);

    const coachSection = el("div", "coach-section");
    coachSection.innerHTML = `<h3>Coach Feedback</h3><div class="coach-body muted">Awaiting the first assistant reply…</div>`;
    mount.appendChild(coachSection);

    // helpers that close over elements
    function updateScenarioSelector() {
      if (currentMode === "sales-simulation") {
        scenarioSelect.style.display = "";
        scenarioSelect.innerHTML = "<option value=''>Select Physician Profile</option>";
        scenariosList.forEach(sc => {
          const o = el("option");
          o.value = sc.id;
          o.textContent = sc.label || sc.id;
          scenarioSelect.appendChild(o);
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
      metaEl.innerHTML = `
        <div class="meta-card">
          <div><strong>Therapeutic Area:</strong> ${esc(sc.therapeuticArea || "—")}</div>
          <div><strong>Background:</strong> ${esc(sc.background || "—")}</div>
          <div><strong>Today’s Goal:</strong> ${esc(sc.goal || "—")}</div>
        </div>`;
    }

    function renderMessages() {
      messagesEl.innerHTML = "";
      for (const m of conversation) {
        const d = el("div", `message ${m.role}`);
        const c = el("div", "content");
        c.innerHTML = md(m.content);
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
        body.innerHTML = `<span class="muted">Awaiting the first assistant reply…</span>`;
        return;
      }
      const fb = last._coach, subs = fb.subscores || {};
      body.innerHTML = `
        <div class="coach-score">Score: <strong>${fb.score ?? "—"}</strong>/100</div>
        <div class="coach-subs">${Object.entries(subs).map(([k,v]) => `<span class="pill">${esc(k)}: ${v}</span>`).join(" ")}</div>
        <ul class="coach-list">
          <li><strong>What worked:</strong> ${esc((fb.worked || []).join(" ") || "—")}</li>
          <li><strong>What to improve:</strong> ${esc((fb.improve || []).join(" ") || "—")}</li>
          <li><strong>Suggested phrasing:</strong> ${esc(fb.phrasing || "—")}</li>
        </ul>`;
    }

    // expose for init refresh
    wrapper._renderMessages = renderMessages;
    wrapper._renderCoach = renderCoach;
    wrapper._updateScenarioSelector = updateScenarioSelector;
    wrapper._updateScenarioMeta = updateScenarioMeta;

    // first paint
    updateScenarioSelector();
    updateScenarioMeta();
    renderMessages();
    renderCoach();
  }

  // ---------- send ----------
  async function sendMessage(userText) {
    const wrapper = mount.querySelector(".reflectiv-chat");
    const renderMessages = wrapper._renderMessages;
    const renderCoach = wrapper._renderCoach;

    conversation.push({ role: "user", content: userText });
    renderMessages();
    renderCoach();

    const messages = [{ role: "system", content: systemPrompt }];

    if (currentMode === "hiv-product-knowledge") {
      messages.push({ role: "system", content: "You are answering questions about HIV medications using the provided knowledge. Be concise and evidence-based." });
    } else if (currentMode === "emotional-assessment") {
      messages.push({ role: "system", content: "You are helping the user reflect on their emotional intelligence and communication style." });
    } else if (currentMode === "sales-simulation" && currentScenarioId) {
      const sc = scenariosById.get(currentScenarioId);
      if (sc) {
        messages.push({
          role: "system",
          content:
`Act as the HCP in a realistic, compliant sales simulation.
Therapeutic Area: ${sc.therapeuticArea || "—"}
Background: ${sc.background || "—"}
Today’s Goal: ${sc.goal || "—"}`
        });
      }
    }

    // force tailored coach JSON
    messages.push({
      role: "system",
      content:
`After you write your reply, return tailored coaching wrapped exactly as:
<coach>{
  "worked": ["..."],
  "improve": ["..."],
  "phrasing": "one concise next-step ask",
  "score": 0-100,
  "subscores": {"question_quality":0-4,"objection_handling":0-4,"empathy":0-4,"compliance":0-4}
}</coach>
No 'Tone'. Keep lists 1–3 items.`
    });

    try {
      const r = await fetch(cfg.apiBase.trim(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          model: cfg.model || "llama-3.1-8b-instant",
          temperature: 0.2,
          stream: false
        })
      });

      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status} from apiBase: ${txt || "no body"}`);
      }

      const data = await r.json();
      const { coach, clean } = extractCoach(data.content || "");
      const fb = coach || heuristicCoach(conversation);
      conversation.push({ role: "assistant", content: String(clean || "").trim(), _coach: fb });
      renderMessages();
      renderCoach();

      // analytics beacon
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
        }).catch(() => {});
      }
    } catch (e) {
      conversation.push({ role: "assistant", content: `Model error: ${String(e.message || e)}` });
      renderMessages();
    }
  }

  // ---------- init ----------
  async function init() {
    cfg = await fetchLocal("./assets/chat/config.json");
    systemPrompt = await fetchLocal("./assets/chat/system.md");
    try { personas = await fetchLocal("./assets/chat/persona.json"); } catch { personas = {}; }

    if (Array.isArray(cfg.scenarios) && cfg.scenarios.length) {
      scenariosList = cfg.scenarios.map(s => ({
        id: s.id,
        label: s.label || s.id,
        therapeuticArea: s.therapeuticArea || "",
        background: s.background || "",
        goal: s.goal || ""
      }));
    } else {
      scenariosList = [];
    }
    scenariosById = new Map(scenariosList.map(s => [s.id, s]));
    buildUI();
  }

  init();
})();
