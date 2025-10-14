/*
 * ReflectivAI Chat/Coach v10c
 * Implements deterministic coaching, scoring, EI badges, mode/disease/HCP wiring,
 * session state persistence, mobile safety, and cache-bust.
 */

(function () {
  let mount = null;
  function onReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true });
    else fn();
  }
  function waitForMount(cb) {
    const tryGet = () => {
      mount = document.getElementById("reflectiv-widget");
      if (mount) return cb();
      const obs = new MutationObserver(() => {
        mount = document.getElementById("reflectiv-widget");
        if (mount) {
          obs.disconnect();
          cb();
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => obs.disconnect(), 15000);
    };
    onReady(tryGet);
  }

  let cfg = null, systemPrompt = "";
  let scenarios = [], scenariosById = new Map();

  let currentMode = "sales-simulation";
  let currentScenarioId = null;
  let conversation = [];
  let coachOn = true;

  const DISEASE_STATES = {
    HIV: { productKnowledgeMode: "hiv-product-knowledge", hcpRoles: ["Internal Medicine MD", "Internal Medicine Doctor", "Nurse Practitioner", "Physician Assistant"] },
    Cancer: { productKnowledgeMode: "oncology-product-knowledge", hcpRoles: ["Medical Oncologist", "Nurse Practitioner", "Physician Assistant"] },
    Vaccines: { productKnowledgeMode: "vaccines-product-knowledge", hcpRoles: ["Infectious Disease Specialist", "Nurse Practitioner", "Physician Assistant"] },
    COVID: { productKnowledgeMode: "covid-product-knowledge", hcpRoles: ["Pulmonologist", "Nurse Practitioner", "Physician Assistant"] },
    Cardiovascular: { productKnowledgeMode: "cardio-product-knowledge", hcpRoles: ["Cardiologist", "Nurse Practitioner", "Physician Assistant"] }
  };

  // Utility functions
  async function fetchLocal(path) {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(`Failed to load ${path} (${r.status})`);
    const ct = r.headers.get("content-type") || "";
    return ct.includes("application/json") ? r.json() : r.text();
  }

  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  function sanitizeLLM(raw) {
    let s = String(raw || "");
    s = s.replace(/``````/g, "");
    s = s.replace(/<pre[\s\S]*?<\/pre>/gi, "");
    s = s.replace(/^\s*#{1,6}\s+/gm, "");
    s = s.replace(/^\s*i['’]m\s+tony[^\n]*\n?/i, "");
    s = s.replace(/^\s*(hi|hello|hey)[^\n]*\n+/i, "");
    s = s.replace(/\n{3,}/g, "\n\n").trim();
    return s;
  }

  function md(text) {
    if (!text) return "";
    let s = esc(text).replace(/\r\n?/g, "\n");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/^(?:-\s+|\*\s+).+(?:\n(?:-\s+|\*\s+).+)*/gm, (blk) => {
      const items = blk.split("\n").map((l) => l.replace(/^(?:-\s+|\*\s+)(.+)$/, "<li>$1</li>")).join("");
      return `<ul>${items}</ul>`;
    });
    return s.split(/\n{2,}/).map((p) => (p.startsWith("<ul>") ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`)).join("\n");
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function extractCoach(raw) {
    const m = String(raw || "").match(/<coach>([\s\S]*?)<\/coach>/i);
    if (!m) return { coach: null, clean: sanitizeLLM(raw) };
    let coach = null;
    try { coach = JSON.parse(m[1]); } catch {}
    const clean = sanitizeLLM(String(raw).replace(m[0], "").trim());
    return { coach, clean };
  }

  function scoreReply(userText, replyText, mode) {
    // Simplified deterministic scoring compatible with instructions and example
    const t = (replyText || "").toLowerCase();
    const words = (replyText || "").split(/\s+/).filter(Boolean).length;
    const endsWithQuestion = /\?\s*$/.test(replyText || "");
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    // Example scoring weights: accuracy (3), compliance (3), discovery (2), objection (2), value (2), empathy (1), clarity (1)
    // For brevity, using simplified cues for empathy & compliance flags
    const containsComplianceRisk = /off-label|superior|best/i.test(t);
    const accuracyRisk = /inaccurate|false/i.test(t);

    const accuracy = containsComplianceRisk || accuracyRisk ? 0 : clamp(Math.floor(t.match(/renal|kidney|bone|label|guideline|adherence|resistance|coverage/gi)?.length || 0), 1, 5);
    const compliance = containsComplianceRisk ? 0 : 5;
    const discovery = clamp(t.match(/ask|question|discover|learn/gi)?.length || 0, 1, 5);
    const objection = clamp(t.match(/concern|barrier|cost|coverage|risk|denied|auth/gi)?.length || 0, 1, 5);
    const value = clamp(t.match(/benefit|advantage|outcome/gi)?.length || 0, 1, 5);
    const empathyScore = clamp(t.match(/understand|appreciate|thanks|hear|empathy|support/gi)?.length || 0, 1, 5);
    const clarity = clamp(words > 5 ? 5 : 3, 1, 5);

    const weights = { accuracy: 3, compliance: 3, discovery: 2, objection: 2, value: 2, empathy: 1, clarity: 1 };
    const weightedSum = accuracy * weights.accuracy + compliance * weights.compliance + discovery * weights.discovery + objection * weights.objection + value * weights.value + empathyScore * weights.empathy + clarity * weights.clarity;
    const maxScore = 5 * Object.values(weights).reduce((a, b) => a + b, 0);
    const score = Math.round((weightedSum / maxScore) * 100);

    let toneLabel = "neutral";
    if (empathyScore >= 4) toneLabel = "supportive";
    else if (empathyScore <= 2) toneLabel = "transactional";

    const evidenceQuote = (replyText || "").slice(0, 20);

    return {
      score,
      subscores: { accuracy, compliance, discovery, objection, value, empathy: empathyScore, clarity },
      worked: ["Relevant clinical references included.", "Clear and concise communication."],
      improve: containsComplianceRisk ? ["Avoid compliance risk language."] : ["Use more evidence-based language where possible."],
      phrasing: "Consider emphasizing label-aligned benefits and asking a clarifying question.",
      ei: { empathy_score: empathyScore, tone_label: toneLabel, evidence_quote: evidenceQuote }
    };
  }

  // System prompt builder
  function buildPreface(mode, sc) {
    const COMMON = `
# ReflectivAI — Output Contract
Return two parts only. No code blocks. No markdown headings.
1) Sales Guidance: short, actionable, accurate guidance.
2) <coach>{ "worked":[…], "improve":[…], "phrasing":"…", "score":int, "subscores":{"question_quality":0-4,"objection_handling":0-4,"empathy":0-4,"compliance":0-4} }</coach>
`.trim();

    if (mode === "sales-simulation") {
      return `
# Role
You are a virtual pharma coach prepping a sales rep for a 30-second interaction with an HCP. Be direct, safe, label-aligned.

# Scenario
${sc ? [
  `Therapeutic Area: ${sc.therapeuticArea || "—"}`,
  `Background: ${sc.background || "—"}`,
  `Today’s Goal: ${sc.goal || "—"}`
].join("\n") : ""}

# Style
- 3–6 sentences max, plus one closing question.
- Mention only appropriate, publicly known, label-aligned facts.
- No pricing advice or PHI. No off-label.

${COMMON}`.trim();
    }

    if (mode === "product-knowledge" || mode === "hiv-product-knowledge") {
      return `
Return a concise educational overview with reputable citations. Structure: key takeaways; mechanism/indications; safety/contraindications; efficacy; access notes; references.
`.trim();
    }

    if (mode === "emotional-assessment") {
      return `
Provide brief, practical self-reflection tips tied to communication with HCPs. No clinical or drug guidance.
- 3–5 sentences, then one reflective question.

${COMMON}`.trim();
    }

    return COMMON;
  }

  // UI Builders and Rendering
  function buildUI() {
    mount.innerHTML = "";
    if (!mount.classList.contains("cw")) mount.classList.add("cw");

    // Inject Stylesheet Scoped for Widget
    const styleId = "reflectiv-widget-style";
    let styleEl = document.getElementById(styleId);
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      styleEl.textContent = `/* ... Styles omitted here: use widget.css as linked above ... */`;
      document.head.appendChild(styleEl);
    }

    const shell = el("div", "reflectiv-chat");

    // Toolbar
    const toolbar = el("div", "chat-toolbar");
    const simControls = el("div", "sim-controls");

    // Mode Dropdown
    const lcLabel = el("label", "", "Learning Center");
    lcLabel.htmlFor = "cw-mode";
    const modeSel = el("select", "select");
    modeSel.id = "cw-mode";

    (cfg?.modes || []).forEach(m => {
      const o = el("option");
      o.value = m;
      o.textContent = m.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      modeSel.appendChild(o);
    });

    modeSel.value = currentMode;
    modeSel.onchange = () => {
      currentMode = modeSel.value;
      currentScenarioId = null;
      conversation = [];
      renderMessages();
      renderCoach();
      renderMeta();

      const showSim = currentMode === "sales-simulation";
      diseaseLabel.style.display = showSim ? "" : "none";
      diseaseSelect.style.display = showSim ? "" : "none";
      hcpLabel.style.display = showSim ? "" : "none";
      hcpSelect.style.display = showSim ? "" : "none";

      if (!showSim) coachToggle.style.display = "none";
      else coachToggle.style.display = "";
      saveState();
    };

    // Coach toggle dropdown
    const coachLabel = el("label", "", "Coach");
    coachLabel.htmlFor = "cw-coach";

    const coachToggle = el("select", "select");
    coachToggle.id = "cw-coach";

    [{ v: "on", t: "Coach On" }, { v: "off", t: "Coach Off" }].forEach(({ v, t }) => {
      const o = el("option");
      o.value = v;
      o.textContent = t;
      coachToggle.appendChild(o);
    });

    coachToggle.value = coachOn ? "on" : "off";
    coachToggle.onchange = () => {
      coachOn = coachToggle.value === "on";
      renderCoach();
      saveState();
    };

    // Disease select
    const diseaseLabel = el("label", "", "Disease / Product Knowledge");
    diseaseLabel.htmlFor = "cw-disease";
    const diseaseSelect = el("select", "select");
    diseaseSelect.id = "cw-disease";

    const defaultOpt = el("option", "", "Select…");
    defaultOpt.value = "";
    defaultOpt.selected = true;
    defaultOpt.disabled = true;
    diseaseSelect.appendChild(defaultOpt);

    const diseaseOg1 = document.createElement("optgroup");
    diseaseOg1.label = "Disease State";
    Object.keys(DISEASE_STATES).forEach(ds => {
      const o = el("option", "", ds);
      o.value = `disease::${ds}`;
      diseaseOg1.appendChild(o);
    });

    const diseaseOg2 = document.createElement("optgroup");
    diseaseOg2.label = "Product Knowledge";
    Object.keys(DISEASE_STATES).forEach(ds => {
      const o = el("option", "", `${ds}: Product Knowledge`);
      o.value = `pk::${ds}`;
      diseaseOg2.appendChild(o);
    });

    diseaseSelect.appendChild(diseaseOg1);
    diseaseSelect.appendChild(diseaseOg2);

    // HCP select
    const hcpLabel = el("label", "", "HCP Profile");
    hcpLabel.htmlFor = "cw-hcp";
    const hcpSelect = el("select", "select");
    hcpSelect.id = "cw-hcp";
    const hcpDefault = el("option", "", "Select HCP...");
    hcpDefault.value = "";
    hcpDefault.selected = true;
    hcpDefault.disabled = true;
    hcpSelect.appendChild(hcpDefault);
    hcpSelect.disabled = true;

    simControls.appendChild(lcLabel);
    simControls.appendChild(modeSel);
    simControls.appendChild(coachLabel);
    simControls.appendChild(coachToggle);
    simControls.appendChild(diseaseLabel);
    simControls.appendChild(diseaseSelect);
    simControls.appendChild(hcpLabel);
    simControls.appendChild(hcpSelect);

    toolbar.appendChild(simControls);
    shell.appendChild(toolbar);

    // Meta info
    const meta = el("div", "scenario-meta");
    shell.appendChild(meta);

    // Messages
    const msgs = el("div", "chat-messages");
    shell.appendChild(msgs);

    // Input area
    const inputArea = el("div", "chat-input");
    const textarea = el("textarea");
    textarea.placeholder = "Type your message…";

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });

    const sendBtn = el("button", "btn", "Send");
    sendBtn.onclick = () => {
      const t = textarea.value.trim();
      if (!t) return;
      sendMessage(t);
      textarea.value = "";
    };

    inputArea.appendChild(textarea);
    inputArea.appendChild(sendBtn);
    shell.appendChild(inputArea);

    // Coach feedback panel
    const coachPanel = el("div", "coach-section");
    coachPanel.innerHTML = `<h3>Coach Feedback</h3><div class="coach-body muted">Awaiting the first assistant reply…</div>`;
    shell.appendChild(coachPanel);

    mount.appendChild(shell);

    // Helper for populating HCP select on disease change
    function populateHcpForDisease(ds) {
      hcpSelect.innerHTML = "";
      const def = el("option", "", "Select HCP...");
      def.value = "";
      def.selected = true;
      def.disabled = true;
      hcpSelect.appendChild(def);
      const roles = DISEASE_STATES[ds]?.hcpRoles || [];
      roles.forEach(role => {
        const o = el("option", "", role);
        o.value = role;
        hcpSelect.appendChild(o);
      });
      hcpSelect.disabled = roles.length === 0;
    }

    // Control event listeners
    diseaseSelect.addEventListener("change", () => {
      const val = diseaseSelect.value;
      if (!val) return;
      const [kind, ds] = val.split("::");
      if (kind === "pk") {
        const pkMode = DISEASE_STATES[ds]?.productKnowledgeMode;
        if (pkMode && (cfg?.modes || []).includes(pkMode)) {
          currentMode = pkMode;
          hcpSelect.disabled = true;
          hcpSelect.value = "";
        }
        modeSel.value = currentMode;
        simControls.style.display = "none";
        coachToggle.style.display = "none";
      } else {
        currentMode = "sales-simulation";
        modeSel.value = currentMode;
        populateHcpForDisease(ds);
        simControls.style.display = "";
        coachToggle.style.display = "";
      }
      conversation = [];
      renderMessages();
      renderCoach();
      renderMeta();
      saveState();
    });

    hcpSelect.addEventListener("change", () => {
      const dsv = diseaseSelect.value.startsWith("disease::") ? diseaseSelect.value.split("::")[1] : null;
      const role = hcpSelect.value || null;
      if (!dsv || !role) return;
      const filtered = scenarios.filter(s => (s.therapeuticArea === dsv) && (s.hcpRole === role));
      if (filtered.length >= 1) {
        currentScenarioId = filtered[0].id;
      }
      conversation = [];
      renderMessages();
      renderCoach();
      renderMeta();
      saveState();
    });

    function renderMeta() {
      const sc = scenariosById.get(currentScenarioId);
      if (!sc || !currentScenarioId || !String(currentMode).includes("sales")) {
        meta.innerHTML = "";
        return;
      }
      meta.innerHTML = `
        <div class="meta-card">
          <div><strong>Therapeutic Area:</strong> ${esc(sc.therapeuticArea || "—")}</div>
          <div><strong>HCP Role:</strong> ${esc(sc.hcpRole || "—")}</div>
          <div><strong>Background:</strong> ${esc(sc.background || "—")}</div>
          <div><strong>Today’s Goal:</strong> ${esc(sc.goal || "—")}</div>
        </div>`;
    }

    function renderMessages() {
      msgs.innerHTML = "";
      conversation.forEach(m => {
        const row = el("div", `message ${m.role}`);
        const c = el("div", "content");
        c.innerHTML = md(m.content);
        row.appendChild(c);
        msgs.appendChild(row);
      });
      msgs.scrollTop = msgs.scrollHeight;
    }

    function renderCoach() {
      const body = coachPanel.querySelector(".coach-body");
      if (!coachOn) {
        coachPanel.style.display = "none";
        return;
      }
      coachPanel.style.display = "";
      const last = conversation[conversation.length - 1];
      if (!(last && last.role === "assistant" && last._coach)) {
        body.innerHTML = `<span class="muted">Awaiting the first assistant reply…</span>`;
        return;
      }
      const fb = last._coach, subs = fb.subscores || {};
      body.innerHTML = `
        <div class="coach-score">Score: <strong>${fb.score ?? "—"}</strong>/100</div>
        <div class="coach-subs">${Object.entries(subs).map(([k, v]) => `<span class="pill">${esc(k)}: ${v}</span>`).join(" ")}</div>
        <ul class="coach-list">
          <li><strong>What worked:</strong> ${esc((fb.worked || []).join(" ") || "—")}</li>
          <li><strong>What to improve:</strong> ${esc((fb.improve || []).join(" ") || "—")}</li>
          <li><strong>Suggested phrasing:</strong> ${esc(fb.phrasing || "—")}</li>
        </ul>`;
      // Append EI badges below feedback
      if (fb.ei) {
        const eiHtml = document.createElement("div");
        eiHtml.className = "ei-badges";
        eiHtml.innerHTML = `
          <span class="ei-badge">Empathy ${esc(fb.ei.empathy_score.toFixed(1))} / 5</span>
          <span class="ei-badge">Tone: ${esc(fb.ei.tone_label)}</span>
          <span class="ei-badge">Quote: "${esc(fb.ei.evidence_quote)}"</span>
        `;
        if (!body.querySelector(".ei-badges")) {
          body.appendChild(eiHtml);
        }
      }
    }

    shell._renderMessages = renderMessages;
    shell._renderCoach = renderCoach;
    shell._renderMeta = renderMeta;

    renderMeta();
    renderMessages();
    renderCoach();
  }

  async function callModel(messages) {
    const r = await fetch((cfg?.apiBase || cfg?.workerUrl || "").trim(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: (cfg && cfg.model) || "llama-3.1-8b-instant",
        temperature: 0.2,
        stream: false,
        messages
      })
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`HTTP ${r.status}: ${txt || "no body"}`);
    }
    const data = await r.json().catch(() => ({}));
    return data?.content || data?.reply || data?.choices?.[0]?.message?.content || "";
  }

  async function sendMessage(userText) {
    const shell = mount.querySelector(".reflectiv-chat");
    const renderMessages = shell._renderMessages;
    const renderCoach = shell._renderCoach;

    conversation.push({ role: "user", content: userText });
    renderMessages();
    renderCoach();

    const sc = scenariosById.get(currentScenarioId);
    const preface = buildPreface(currentMode, sc);

    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "system", content: preface });
    messages.push({ role: "user", content: userText });

    try {
      const raw = await callModel(messages);
      const { coach, clean } = extractCoach(raw);
      const computed = scoreReply(userText, clean, currentMode, sc);
      const finalCoach = coach && coach.score && coach.subscores ? coach : computed;

      conversation.push({ role: "assistant", content: clean, _coach: finalCoach });
      renderMessages();
      renderCoach();

      if (cfg && cfg.analyticsEndpoint) {
        fetch(cfg.analyticsEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ts: Date.now(),
            mode: currentMode,
            scenarioId: currentScenarioId,
            turn: conversation.length,
            score: finalCoach.score,
            subscores: finalCoach.subscores
          })
        }).catch(() => {});
      }
    } catch (e) {
      conversation.push({ role: "assistant", content: `Upstream error. Try again.` });
      renderMessages();
      renderCoach();
    }
  }

  async function loadScenarios() {
    if (cfg && cfg.scenariosUrl) {
      const payload = await fetchLocal(cfg.scenariosUrl);
      const arr = Array.isArray(payload) ? payload : (payload.scenarios || []);
      scenarios = arr.map((s) => ({
        id: s.id,
        label: s.label || s.id,
        therapeuticArea: s.therapeuticArea,
        hcpRole: s.hcpRole || "",
        background: s.background || "",
        goal: s.goal || ""
      }));
    } else if (Array.isArray(cfg?.scenarios)) {
      scenarios = cfg.scenarios.map((s) => ({
        id: s.id,
        label: s.label || s.id,
        therapeuticArea: (s.therapeuticArea || "").split(" - ")[0],
        hcpRole: s.hcpRole || "",
        background: s.background || "",
        goal: s.goal || ""
      }));
    } else {
      scenarios = [];
    }
    scenariosById = new Map(scenarios.map((s) => [s.id, s]));
  }

  async function restoreState() {
    try {
      const saved = localStorage.getItem("reflectivai:coach:v10c");
      if (!saved) return;
      const state = JSON.parse(saved);
      if (state.mode && cfg?.modes.includes(state.mode)) currentMode = state.mode;
      if (state.coachOn !== undefined) coachOn = state.coachOn;
      if (state.disease) diseaseSelect.value = state.disease;
      if (state.hcp) hcpSelect.value = state.hcp;
      renderMessages();
      renderCoach();
      renderMeta();
    } catch { }
  }

  function saveState() {
    try {
      const state = {
        mode: currentMode,
        coachOn,
        disease: document.getElementById("cw-disease")?.value || "",
        hcp: document.getElementById("cw-hcp")?.value || ""
      };
      localStorage.setItem("reflectivai:coach:v10c", JSON.stringify(state));
    } catch { }
  }

  async function init() {
    try {
      cfg = await fetchLocal("./assets/chat/config.json");
    } catch (e) {
      console.error("config.json load failed:", e);
      cfg = { modes: ["emotional-assessment", "hiv-product-knowledge", "sales-simulation"], defaultMode: "sales-simulation" };
    }

    try {
      systemPrompt = await fetchLocal("./assets/chat/system.md");
    } catch (_) {
      systemPrompt = "";
    }

    await loadScenarios();

    if (cfg.modes && cfg.defaultMode && cfg.modes.includes(cfg.defaultMode)) {
      currentMode = cfg.defaultMode;
    }

    buildUI();
    await restoreState();
  }

  waitForMount(init);
})();
