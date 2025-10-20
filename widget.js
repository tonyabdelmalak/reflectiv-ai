/* widget.js — ReflectivAI Coach (modal)
 * Modes: emotional-assessment | product-knowledge | sales-simulation
 * Requirements covered:
 * - Centered modal with dim overlay (CSS-driven)
 * - Fixed-width content, non-overlap with Alora bubble
 * - 4 EI Personas + 4 EI Features with tooltips
 * - Scoring panel always visible under input
 * - “Scoring rubric” link
 * - Launch API: window.ReflectivCoach.open(), .close()
 */

(function () {
  // ---------- boot ----------
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const onReady = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  // ---------- state ----------
  let cfg = null;
  let systemPrompt = "";
  let scenarios = [];
  let scenariosById = new Map();

  let currentMode = "sales-simulation";
  let currentScenarioId = null;
  let conversation = [];
  let coachOn = true;

  // EI UI refs
  let personaSelect, featureSelect, personaInfo, featureInfo;

  // ---------- config ----------
  const DEFAULT_PERSONAS = [
    { key: "difficult", label: "Difficult HCP", description: "Resistant, emotional, argumentative" },
    { key: "busy", label: "Busy HCP", description: "Time-pressed; wants bottom line" },
    { key: "engaged", label: "Highly Engaged HCP", description: "Collaborative, attentive, detail-driven" },
    { key: "indifferent", label: "Nice but Doesn’t Prescribe", description: "Pleasant, disengaged, low intent" }
  ];
  const DEFAULT_EI_FEATURES = [
    { key: "empathy", label: "Empathy Rating", description: "Acknowledges feelings and context with clear validation." },
    { key: "stress", label: "Stress Level Indicator", description: "Detects time/pressure cues and adapts tone." },
    { key: "listening", label: "Active Listening Hints", description: "Reflects, clarifies, and summarizes accurately." },
    { key: "validation", label: "Validation & Reframing Tips", description: "Validates concerns and reframes to shared goals." }
  ];

  // ---------- utils ----------
  async function fetchLocal(path) {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(`Failed to load ${path} (${r.status})`);
    const ct = r.headers.get("content-type") || "";
    return ct.includes("application/json") ? r.json() : r.text();
  }
  const esc = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  function sanitizeLLM(raw) {
    let s = String(raw || "");
    s = s.replace(/```[\s\S]*?```/g, "");
    s = s.replace(/<pre[\s\S]*?<\/pre>/gi, "");
    s = s.replace(/^\s*#{1,6}\s+/gm, "");
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
      const items = blk
        .split("\n")
        .map((l) => l.replace(/^(?:-\s+|\*\s+)(.+)$/, "<li>$1</li>"))
        .join("");
      return `<ul>${items}</ul>`;
    });
    return s
      .split(/\n{2,}/)
      .map((p) => (p.startsWith("<ul>") ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`))
      .join("\n");
  }
  function extractCoach(raw) {
    const m = String(raw || "").match(/<coach>([\s\S]*?)<\/coach>/i);
    if (!m) return { coach: null, clean: sanitizeLLM(raw) };
    let coach = null;
    try {
      coach = JSON.parse(m[1]);
    } catch {}
    const clean = sanitizeLLM(String(raw).replace(m[0], "").trim());
    return { coach, clean };
  }

  // ---------- deterministic scoring ----------
  function scoreReply(userText, replyText) {
    const text = String(replyText || "");
    const t = text.toLowerCase();
    const words = text.split(/\s+/).filter(Boolean).length;
    const endsWithQ = /\?\s*$/.test(text);
    const inRange = (n, a, b) => n >= a && n <= b;

    const sig = {
      label: /(per label|fda\s*label|indication|contraindication|boxed warning|guideline|fda)/i.test(text),
      discovery: endsWithQ || /(how|what|could you|can you|help me understand|walk me|clarify)\b/i.test(t),
      objection: /(concern|barrier|risk|coverage|auth|denied|cost|workflow|adherence|side effect|safety)/i.test(t),
      empathy: /(i understand|appreciate|given your time|thanks for|i hear|it sounds like)/i.test(t),
      accuracyCue:
        /(renal|egfr|creatinine|bmd|resistance|ddi|interaction|efficacy|safety|adherence|formulary|access|prior auth|prep|tdf|taf|bictegravir|cabotegravir|rilpivirine|descovy|biktarvy|cabenuva)/i.test(
          t
        ),
      tooLong: words > 180,
      idealLen: inRange(words, 45, 120)
    };

    const accuracy = sig.accuracyCue ? (sig.label ? 5 : 4) : 3;
    const compliance = sig.label ? 5 : 3;
    const discovery = sig.discovery ? 4 : 2;
    const objection_handling = sig.objection ? (sig.accuracyCue ? 4 : 3) : 2;
    const empathy = sig.empathy ? 3 : 2;
    const clarity = sig.tooLong ? 2 : sig.idealLen ? 4 : 3;

    const W = { accuracy: 0.26, compliance: 0.22, discovery: 0.16, objection_handling: 0.14, clarity: 0.12, empathy: 0.10 };
    const toPct = (v) => v * 20;

    let overall =
      toPct(accuracy) * W.accuracy +
      toPct(compliance) * W.compliance +
      toPct(discovery) * W.discovery +
      toPct(objection_handling) * W.objection_handling +
      toPct(clarity) * W.clarity +
      toPct(empathy) * W.empathy;
    if (sig.idealLen) overall += 3;
    if (endsWithQ) overall += 3;
    if (sig.tooLong) overall -= 6;
    overall = Math.max(0, Math.min(100, Math.round(overall)));

    const worked = [
      sig.empathy ? "Acknowledged HCP context" : null,
      sig.discovery ? "Closed with a clear discovery question" : null,
      sig.label ? "Referenced label or guidelines" : null,
      sig.accuracyCue ? "Tied points to clinical cues" : null
    ].filter(Boolean);

    const improve = [
      sig.tooLong ? "Tighten to 3–5 sentences" : null,
      sig.discovery ? null : "End with one specific question",
      sig.label ? null : "Anchor claims to label or guideline",
      clarity < 4 ? "Use one idea per sentence" : null
    ].filter(Boolean);

    const phrasing = sig.discovery
      ? "Given your criteria, which patients would be the best fit to start, and what would help you try one this month?"
      : "Would it help to align on eligibility criteria and agree on one next step for your earliest appropriate patient?";

    return {
      overall,
      scores: { accuracy, empathy, clarity, compliance, discovery, objection_handling },
      feedback:
        "Be concise, cite label or guidelines for clinical points, ask one focused discovery question, and propose a concrete next step.",
      worked,
      improve,
      phrasing,
      context: { rep_question: String(userText || ""), hcp_reply: String(replyText || "") },
      score: overall,
      subscores: { accuracy, empathy, clarity, compliance, discovery, objection_handling }
    };
  }

  // ---------- empathy helpers ----------
  function personaTip(k) {
    const map = {
      difficult: "Validate frustration first. Stay calm and specific.",
      busy: "One-line empathy, bottom line first.",
      engaged: "Acknowledge insight and collaborate.",
      indifferent: "Validate neutrality, pivot to patient impact."
    };
    return map[k] || "Match tone and show you understand context.";
  }
  function featureTip(k) {
    const map = {
      empathy: "Use short validation phrases before guidance.",
      stress: "Lower cognitive load. Offer one low-effort next step.",
      listening: "Reflect back and ask one clarifier.",
      validation: "Normalize concern and reframe to shared goals."
    };
    return map[k] || "Apply best-practice EI technique.";
  }

  // ---------- prompt builder ----------
  function buildPreface(mode, sc) {
    const COMMON = `
# ReflectivAI — Output Contract
Return exactly two parts. No code blocks. No markdown headings.
1) Sales Guidance: short, actionable, accurate guidance.
2) <coach>{
  "overall":0-100,
  "scores":{"accuracy":0-5,"empathy":0-5,"clarity":0-5,"compliance":0-5,"discovery":0-5,"objection_handling":0-5},
  "worked":["…"],"improve":["…"],"phrasing":"…","feedback":"one concise paragraph",
  "context":{"rep_question":"...","hcp_reply":"..."}
}</coach>
`.trim();

    if (mode === "sales-simulation") {
      return `
# Role
You are a virtual pharma coach. Be direct, label-aligned, and safe.

# Scenario
${sc ? [
  `Therapeutic Area: ${sc.therapeuticArea || "—"}`,
  `HCP Role: ${sc.hcpRole || "—"}`,
  `Background: ${sc.background || "—"}`,
  `Today’s Goal: ${sc.goal || "—"}`
].join("\n") : ""}

# Style
- 3–6 sentences and one closing question.
- Only appropriate, publicly known, label-aligned facts.
- No pricing advice or PHI. No off-label.

${COMMON}`.trim();
    }

    if (mode === "product-knowledge") {
      return `Return a concise educational overview with reputable citations. Structure: key takeaways; mechanism/indications; safety/contraindications; efficacy; access notes; references.`.trim();
    }

    // emotional-assessment
    return `
Provide brief self-reflection tips tied to HCP communication.
- 3–5 sentences, then one reflective question.

${COMMON}`.trim();
  }

  // ---------- transport ----------
  async function callModel(messages) {
    const url = (cfg?.apiBase || cfg?.workerUrl || "").trim();
    if (!url) throw new Error("No API endpoint configured (config.apiBase).");
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: (cfg && cfg.model) || "llama-3.1-8b-instant",
        temperature: 0.2,
        stream: !!cfg?.stream,
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

  // ---------- UI ----------
  function createModalShell() {
    // overlay + modal
    const overlay = document.createElement("div");
    overlay.id = "coachOverlay";
    overlay.className = "coach-overlay";
    overlay.setAttribute("aria-hidden", "true");

    const modal = document.createElement("div");
    modal.id = "coachModal";
    modal.className = "coach-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "coachTitle");

    modal.innerHTML = `
      <div class="coach-head">
        <div class="coach-title" id="coachTitle">ReflectivAI Coach</div>
        <div class="head-actions">
          <a class="rubric-link" href="#coach-rubric" id="rubricLink">Scoring rubric</a>
          <button class="coach-close" id="coachClose" aria-label="Close">×</button>
        </div>
      </div>

      <div class="coach-body">
        <div class="toolbar">
          <div class="grid">
            <label for="cw-mode">Learning Center</label>
            <select id="cw-mode">
              <option>Sales Simulation</option>
              <option>Product Knowledge</option>
              <option>Emotional Intelligence</option>
            </select>

            <label for="cw-coach">Coach</label>
            <select id="cw-coach">
              <option value="on">Coach On</option>
              <option value="off">Coach Off</option>
            </select>

            <label for="cw-disease">Disease State</label>
            <select id="cw-disease"><option value="" selected disabled>Select…</option></select>

            <label for="cw-hcp">HCP Profiles</label>
            <select id="cw-hcp" disabled><option value="" selected disabled>Select…</option></select>

            <label for="cw-ei-persona">EI Persona <span class="info" id="personaInfo" title=""></span></label>
            <select id="cw-ei-persona"><option value="" selected disabled>Select…</option></select>

            <label for="cw-ei-feature">EI Feature <span class="info" id="featureInfo" title=""></span></label>
            <select id="cw-ei-feature"><option value="" selected disabled>Select…</option></select>
          </div>
        </div>

        <div class="scenario-meta" id="scenarioMeta"></div>

        <div class="chat-area">
          <div class="chat-messages" id="chatMessages" aria-live="polite"></div>
          <div class="chat-input">
            <textarea id="chatInput" placeholder="Type your message…"></textarea>
            <button id="chatSend" class="btn">Send</button>
          </div>

          <div class="coach-section" id="coachSection">
            <h3>Coach Feedback</h3>
            <div class="coach-body-panel" id="coachPanel"><span class="muted">Awaiting the first assistant reply…</span></div>
            <div class="ei-help" id="eiHelp"><span class="muted">Hover over EI labels to see definitions.</span></div>
          </div>
        </div>
      </div>

      <div id="coachRubric" class="rubric hidden" role="region" aria-label="Scoring rubric">
        <div class="rubric-inner">
          <button class="rubric-close" id="rubricClose" aria-label="Close rubric">×</button>
          <h4>Scoring rubric</h4>
          <ul>
            <li><strong>Accuracy</strong> — label/guideline aligned; no off-label; correct facts.</li>
            <li><strong>Compliance</strong> — fair balance, safe wording, no PHI or pricing advice.</li>
            <li><strong>Discovery</strong> — ends with a precise question; advances conversation.</li>
            <li><strong>Objection handling</strong> — acknowledges concern and addresses with evidence.</li>
            <li><strong>Clarity</strong> — concise; one idea per sentence; 3–6 sentences target.</li>
            <li><strong>Empathy</strong> — validates HCP context with respectful tone.</li>
          </ul>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    // bind controls
    qs("#coachClose").onclick = () => window.ReflectivCoach.close();
    qs("#rubricLink").onclick = (e) => {
      e.preventDefault();
      qs("#coachRubric").classList.remove("hidden");
    };
    qs("#rubricClose").onclick = () => qs("#coachRubric").classList.add("hidden");
    overlay.addEventListener("click", () => window.ReflectivCoach.close());

    return modal;
  }

  function setSelectOptions(select, values, withPlaceholder) {
    select.innerHTML = "";
    if (withPlaceholder) {
      const p = document.createElement("option");
      p.value = "";
      p.textContent = "Select…";
      p.disabled = true;
      p.selected = true;
      select.appendChild(p);
    }
    values.forEach((v) => {
      if (!v) return;
      const o = document.createElement("option");
      if (typeof v === "string") {
        o.value = v;
        o.textContent = v;
        o.dataset.tooltip = "";
      } else {
        o.value = v.value || v.id || v.key || v.label;
        o.textContent = v.label || v.value || v.id || v.key;
        if (v.description) o.dataset.tooltip = v.description;
      }
      select.appendChild(o);
    });
  }

  function getDiseaseStates() {
    let ds = Array.isArray(cfg?.diseaseStates) ? cfg.diseaseStates.slice() : [];
    if (!ds.length && Array.isArray(scenarios) && scenarios.length) {
      ds = Array.from(new Set(scenarios.map((s) => (s.therapeuticArea || s.diseaseState || "").trim()))).filter(Boolean);
    }
    ds = ds.map((x) => x.replace(/\bhiv\b/gi, "HIV"));
    return ds;
  }

  function populateDiseases() {
    setSelectOptions(qs("#cw-disease"), getDiseaseStates(), true);
  }

  function populateHcpForDisease(ds) {
    const dsKey = (ds || "").trim();
    const scen = scenarios.filter((s) => {
      const area = (s.therapeuticArea || s.diseaseState || "").trim();
      return area.toLowerCase() === dsKey.toLowerCase();
    });

    const hcpSelect = qs("#cw-hcp");
    if (scen.length) {
      const opts = scen.map((s) => ({ value: s.id, label: s.label || s.id }));
      setSelectOptions(hcpSelect, opts, true);
      hcpSelect.disabled = false;
    } else {
      setSelectOptions(hcpSelect, [], true);
      hcpSelect.disabled = true;
    }
  }

  function populateEI() {
    const personas = (cfg?.personas && cfg.personas.length) ? cfg.personas : DEFAULT_PERSONAS;
    const features = (cfg?.eiFeatures && cfg.eiFeatures.length) ? cfg.eiFeatures : DEFAULT_EI_FEATURES;
    personaSelect = qs("#cw-ei-persona");
    featureSelect = qs("#cw-ei-feature");
    personaInfo = qs("#personaInfo");
    featureInfo = qs("#featureInfo");

    setSelectOptions(
      personaSelect,
      personas.map((p) => ({ value: p.key || p.id || p.label, label: p.label || p.key || p.id, description: p.description || personaTip(p.key) })),
      true
    );
    setSelectOptions(
      featureSelect,
      features.map((f) => ({ value: f.key || f.id || f.label, label: f.label || f.key || f.id, description: f.description || featureTip(f.key) })),
      true
    );

    personaSelect.addEventListener("change", () => {
      const sel = personaSelect.options[personaSelect.selectedIndex];
      personaInfo.setAttribute("title", sel?.dataset?.tooltip || "");
    });
    featureSelect.addEventListener("change", () => {
      const sel = featureSelect.options[featureSelect.selectedIndex];
      featureInfo.setAttribute("title", sel?.dataset?.tooltip || "");
    });
  }

  function applyModeVisibility() {
    const lc = qs("#cw-mode").value;
    const LC_TO_INTERNAL = {
      "Emotional Intelligence": "emotional-assessment",
      "Product Knowledge": "product-knowledge",
      "Sales Simulation": "sales-simulation"
    };
    currentMode = LC_TO_INTERNAL[lc] || "sales-simulation";

    const diseaseLabel = qs('label[for="cw-disease"]');
    const diseaseSelect = qs("#cw-disease");
    const hcpLabel = qs('label[for="cw-hcp"]');
    const hcpSelect = qs("#cw-hcp");
    const personaLabel = qs('label[for="cw-ei-persona"]');
    const featureLabel = qs('label[for="cw-ei-feature"]');
    const coachLabel = qs('label[for="cw-coach"]');
    const coachSel = qs("#cw-coach");

    const pk = currentMode === "product-knowledge";

    // show coach toggle always except PK where coaching UI is hidden
    coachLabel.classList.toggle("hidden", pk);
    coachSel.classList.toggle("hidden", pk);

    if (currentMode === "sales-simulation") {
      diseaseLabel.classList.remove("hidden");
      diseaseSelect.classList.remove("hidden");
      hcpLabel.classList.remove("hidden");
      hcpSelect.classList.remove("hidden");
      personaLabel.classList.add("hidden");
      qs("#cw-ei-persona").classList.add("hidden");
      featureLabel.classList.add("hidden");
      qs("#cw-ei-feature").classList.add("hidden");
      populateDiseases();
    } else if (currentMode === "product-knowledge") {
      diseaseLabel.classList.remove("hidden");
      diseaseSelect.classList.remove("hidden");
      hcpLabel.classList.add("hidden");
      hcpSelect.classList.add("hidden");
      personaLabel.classList.add("hidden");
      qs("#cw-ei-persona").classList.add("hidden");
      featureLabel.classList.add("hidden");
      qs("#cw-ei-feature").classList.add("hidden");
      populateDiseases();
    } else {
      // emotional-assessment
      diseaseLabel.classList.add("hidden");
      diseaseSelect.classList.add("hidden");
      hcpLabel.classList.add("hidden");
      hcpSelect.classList.add("hidden");
      personaLabel.classList.remove("hidden");
      qs("#cw-ei-persona").classList.remove("hidden");
      featureLabel.classList.remove("hidden");
      qs("#cw-ei-feature").classList.remove("hidden");
      currentScenarioId = null;
      conversation = [];
      renderMessages();
      renderMeta();
      renderCoach();
    }

    if (currentMode !== "sales-simulation") {
      currentScenarioId = null;
      conversation = [];
      renderMessages();
      renderMeta();
      renderCoach();
    }
  }

  // ---------- render ----------
  function renderMeta() {
    const meta = qs("#scenarioMeta");
    const sc = scenariosById.get(currentScenarioId);
    if (!sc || !currentScenarioId || currentMode !== "sales-simulation") {
      meta.innerHTML = "";
      return;
    }
    meta.innerHTML = `
      <div class="meta-card">
        <div><strong>Therapeutic Area:</strong> ${esc(sc.therapeuticArea || sc.diseaseState || "—")}</div>
        <div><strong>HCP Role:</strong> ${esc(sc.hcpRole || "—")}</div>
        <div><strong>Background:</strong> ${esc(sc.background || "—")}</div>
        <div><strong>Today’s Goal:</strong> ${esc(sc.goal || "—")}</div>
      </div>`;
  }

  function renderMessages() {
    const msgsEl = qs("#chatMessages");
    msgsEl.innerHTML = "";
    for (const m of conversation) {
      const row = document.createElement("div");
      row.className = `message ${m.role}`;
      const c = document.createElement("div");
      c.className = "content";
      c.innerHTML = md(m.content);
      row.appendChild(c);
      msgsEl.appendChild(row);
    }
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function orderedPills(scores) {
    const order = ["accuracy", "empathy", "clarity", "compliance", "discovery", "objection_handling"];
    return order
      .filter((k) => k in (scores || {}))
      .map((k) => `<span class="pill">${esc(k)}: ${scores[k]}</span>`)
      .join(" ");
  }

  function renderCoach() {
    const coachPanel = qs("#coachPanel");
    if (!coachOn || currentMode === "product-knowledge") {
      coachPanel.innerHTML = `<span class="muted">Coach is off.</span>`;
      return;
    }
    const last = conversation[conversation.length - 1];
    if (!(last && last.role === "assistant" && last._coach)) {
      coachPanel.innerHTML = `<span class="muted">Awaiting the first assistant reply…</span>`;
      return;
    }
    const fb = last._coach;
    const scores = fb.scores || fb.subscores || {};
    const workedStr = fb.worked?.length ? fb.worked.join(". ") + "." : "—";
    const improveStr = fb.improve?.length ? fb.improve.join(". ") + "." : fb.feedback || "—";
    coachPanel.innerHTML = `
      <div class="coach-score">Score: <strong>${fb.overall ?? fb.score ?? "—"}</strong>/100</div>
      <div class="coach-subs">${orderedPills(scores)}</div>
      <ul class="coach-list">
        <li><strong>What worked:</strong> ${esc(workedStr)}</li>
        <li><strong>What to improve:</strong> ${esc(improveStr)}</li>
        <li><strong>Suggested phrasing:</strong> ${esc(fb.phrasing || "—")}</li>
      </ul>`;
  }

  // ---------- send ----------
  async function sendMessage(userText) {
    const ta = qs("#chatInput");

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
      const computed = scoreReply(userText, clean, currentMode);
      const finalCoach = (() => {
        if (coach && (coach.scores || coach.subscores)) {
          const scores = coach.scores || coach.subscores;
          const overall =
            typeof coach.overall === "number" ? coach.overall : typeof coach.score === "number" ? coach.score : undefined;
          return {
            overall: overall ?? computed.overall,
            scores,
            feedback: coach.feedback || computed.feedback,
            worked: coach.worked?.length ? coach.worked : computed.worked,
            improve: coach.improve?.length ? coach.improve : computed.improve,
            phrasing: typeof coach.phrasing === "string" && coach.phrasing ? coach.phrasing : computed.phrasing,
            context: coach.context || { rep_question: userText, hcp_reply: clean },
            score: overall ?? computed.overall,
            subscores: scores
          };
        }
        return computed;
      })();

      conversation.push({ role: "assistant", content: clean, _coach: finalCoach });
      renderMessages();
      renderCoach();

      if (cfg && cfg.analyticsEndpoint) {
        fetch(cfg.analyticsEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ts: Date.now(),
            schema: cfg.schemaVersion || "coach-v2",
            mode: currentMode,
            scenarioId: currentScenarioId,
            turn: conversation.length,
            context: finalCoach.context || { rep_question: userText, hcp_reply: clean },
            overall: finalCoach.overall,
            scores: finalCoach.scores
          })
        }).catch(() => {});
      }
    } catch (e) {
      conversation.push({ role: "assistant", content: `Model error: ${String(e.message || e)}` });
      renderMessages();
    } finally {
      ta.focus();
    }
  }

  // ---------- event wiring ----------
  function wireEvents() {
    // selects
    qs("#cw-mode").addEventListener("change", applyModeVisibility);
    qs("#cw-coach").addEventListener("change", (e) => {
      coachOn = e.target.value === "on";
      renderCoach();
    });
    qs("#cw-disease").addEventListener("change", (e) => {
      const ds = e.target.value || "";
      if (!ds) return;
      if (currentMode === "sales-simulation") {
        populateHcpForDisease(ds);
      } else if (currentMode === "product-knowledge") {
        currentScenarioId = null;
      }
      conversation = [];
      renderMessages();
      renderMeta();
      renderCoach();
    });
    qs("#cw-hcp").addEventListener("change", (e) => {
      const sel = e.target.value || "";
      if (!sel) return;
      const sc = scenariosById.get(sel);
      currentScenarioId = sc ? sc.id : null;
      conversation = [];
      renderMessages();
      renderMeta();
      renderCoach();
    });

    // send
    const input = qs("#chatInput");
    const sendBtn = qs("#chatSend");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const t = input.value.trim();
        if (!t) return;
        input.value = "";
        sendMessage(t);
      }
    });
    sendBtn.addEventListener("click", () => {
      const t = input.value.trim();
      if (!t) return;
      input.value = "";
      sendMessage(t);
    });
  }

  // ---------- scenarios ----------
  async function loadScenarios() {
    if (cfg && cfg.scenariosUrl) {
      const payload = await fetchLocal(cfg.scenariosUrl);
      const arr = Array.isArray(payload) ? payload : payload.scenarios || [];
      scenarios = arr.map((s) => ({
        id: s.id,
        label: s.label || s.id,
        therapeuticArea: s.therapeuticArea || s.diseaseState || "",
        hcpRole: s.hcpRole || "",
        background: s.background || "",
        goal: s.goal || ""
      }));
    } else if (Array.isArray(cfg?.scenarios)) {
      scenarios = cfg.scenarios.map((s) => ({
        id: s.id,
        label: s.label || s.id,
        therapeuticArea: s.therapeuticArea || s.diseaseState || "",
        hcpRole: s.hcpRole || "",
        background: s.background || "",
        goal: s.goal || ""
      }));
    } else {
      scenarios = [];
    }
    scenarios.forEach((s) => {
      if (s.therapeuticArea) s.therapeuticArea = s.therapeuticArea.replace(/\bhiv\b/gi, "HIV");
    });
    scenariosById = new Map(scenarios.map((s) => [s.id, s]));
  }

  // ---------- public API ----------
  window.ReflectivCoach = {
    open() {
      const overlay = qs("#coachOverlay") || null;
      const modal = qs("#coachModal") || createModalShell();
      // initialize selects on first open
      if (!modal.dataset.ready) {
        // set default LC
        const modeSel = qs("#cw-mode");
        const defaultInternal = (cfg?.defaultMode || "sales-simulation");
        const internalToLC = {
          "sales-simulation": "Sales Simulation",
          "product-knowledge": "Product Knowledge",
          "emotional-assessment": "Emotional Intelligence"
        };
        modeSel.value = internalToLC[defaultInternal] || "Sales Simulation";
        applyModeVisibility();
        populateEI();
        wireEvents();
        modal.dataset.ready = "1";
      }
      document.body.classList.add("coach-open");
      qs("#coachOverlay").setAttribute("aria-hidden", "false");
      qs("#chatInput").focus({ preventScroll: true });
    },
    close() {
      document.body.classList.remove("coach-open");
      const ov = qs("#coachOverlay");
      if (ov) ov.setAttribute("aria-hidden", "true");
    }
  };

  // ---------- init ----------
  async function init() {
    try {
      try {
        cfg = await fetchLocal("./assets/chat/config.json");
      } catch {
        cfg = await fetchLocal("./config.json");
      }
    } catch (e) {
      console.error("config load failed:", e);
      cfg = { defaultMode: "sales-simulation" };
    }

    try {
      systemPrompt = await fetchLocal("./assets/chat/system.md");
    } catch (e) {
      console.warn("system.md load failed:", e);
      systemPrompt = "";
    }

    await loadScenarios();

    // wiring launchers present on the page
    onReady(() => {
      qsa('[data-launch="coach"], #ctaExplore, #launchCoach').forEach((el) =>
        el.addEventListener("click", (e) => {
          e.preventDefault();
          window.ReflectivCoach.open();
        })
      );
    });
  }

  onReady(init);
})();
