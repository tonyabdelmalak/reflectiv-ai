/* widget.js
 * ReflectivAI Chat/Coach — drop-in (coach-v2, deterministic scoring v3)
 * Modes: emotional-assessment | product-knowledge | sales-simulation
 */

(function () {
  // ---------- safe bootstrapping ----------
  let mount = null;
  function onReady(fn){ if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once:true }); else fn(); }
  function waitForMount(cb){
    const tryGet = () => {
      mount = document.getElementById("reflectiv-widget");
      if (mount) return cb();
      const obs = new MutationObserver(() => {
        mount = document.getElementById("reflectiv-widget");
        if (mount) { obs.disconnect(); cb(); }
      });
      obs.observe(document.documentElement, { childList:true, subtree:true });
      setTimeout(() => obs.disconnect(), 15000);
    };
    onReady(tryGet);
  }

  // ---------- config/state ----------
  const LC_OPTIONS = ["Emotional Intelligence","Product Knowledge","Sales Simulation"];
  const LC_TO_INTERNAL = {
    "Emotional Intelligence": "emotional-assessment",
    "Product Knowledge": "product-knowledge",
    "Sales Simulation": "sales-simulation"
  };

  let cfg = null;
  let systemPrompt = "";
  let scenarios = [];
  let scenariosById = new Map();

  let currentMode = "sales-simulation";
  let currentScenarioId = null;
  let conversation = [];
  let coachOn = true;

  // ---------- EI globals ----------
  let personaSelectElem = null;
  let eiFeatureSelectElem = null;
  let feedbackDisplayElem = null;
  let lastUserMessage = "";

  // Fallbacks so dropdowns show even if config.json lacks entries
  const DEFAULT_PERSONAS = [
    { key: "difficult",   label: "Difficult HCP" },
    { key: "busy",        label: "Busy HCP" },
    { key: "engaged",     label: "Engaged HCP" },
    { key: "indifferent", label: "Indifferent HCP" } // added
  ];
  const DEFAULT_EI_FEATURES = [
    { key: "empathy",    label: "Empathy Rating" },
    { key: "stress",     label: "Stress Level Indicator" },
    { key: "listening",  label: "Active Listening Hints" },         // added
    { key: "validation", label: "Validation & Reframing Tips" }     // added
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
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

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

  // persona traits snapshot
  function getPersonaSnapshot(profileLabel = "") {
    const k = profileLabel.toLowerCase();
    const pick = (arr) => arr.slice(0, 17);
    if (k.includes("internal medicine"))
      return pick(["time-pressed","guideline-driven","broad-spectrum","chronic-care","risk-stratifies","skeptical","data-oriented","value-focused","workflow-conscious","formulary-aware","pragmatic","outcomes-minded","team-based","patient-education","preventive-care","evidence-first","concise"]);
    if (k.includes("nurse practitioner"))
      return pick(["holistic","patient-centered","education-forward","empathetic","adherence-minded","practical","care-coordination","resource-seeking","workload-heavy","protocol-aware","time-limited","community-focused","clear-instructions","safety-oriented","access-aware","collaborative","approachable"]);
    if (k.includes("physician assistant"))
      return pick(["collaborative","protocol-aligned","triage-savvy","throughput-focused","documentation-heavy","coverage-aware","concise-updates","safety-first","evidence-seeking","task-oriented","team-based","scope-conscious","practical","checklist-minded","patient-education","prior-auth-aware","efficient"]);
    if (k.includes("infectious"))
      return pick(["evidence-intense","resistance-aware","ddi-sensitive","guideline-driven","case-based","nuance-seeking","trial-literate","safety-vigilant","population-health","stewardship-focused","risk-benefit","outbreak-aware","adherence-minded","equity-conscious","follow-up-oriented","precise","skeptical"]);
    if (k.includes("oncolog"))
      return pick(["precision-medicine","trial-savvy","biomarker-driven","QoL-aware","shared-decision","value-focused","access-sensitive","time-limited","adverse-event-vigilant","guideline-aligned","multidisciplinary","compassionate","data-dense","survivorship-minded","payer-aware","nuanced","measured"]);
    if (k.includes("pulmonolog"))
      return pick(["device-aware","technique-focused","adherence-sensitive","exacerbation-prevention","spirometry-literate","step-up/step-down","education-forward","workflow-minded","coverage-aware","chronic-care","guideline-aligned","safety-oriented","pragmatic","inhaler-coaching","symptom-tracking","access-focused","efficient"]);
    if (k.includes("cardiolog"))
      return pick(["endpoint-focused","risk-reduction","polypharmacy-aware","renal-thresholds","guideline-driven","outcomes-oriented","value-conscious","skeptical","time-efficient","workflow-minded","safety-vigilant","metric-driven","adherence-focused","care-team","prior-auth-aware","practical","evidence-first"]);
    return pick(["time-pressed","evidence-seeking","guideline-aligned","value-focused","coverage-aware","workflow-minded","adherence-minded","safety-first","concise","pragmatic","patient-education","team-based","access-sensitive","data-oriented","empathetic","outcomes-driven","measured"]);
  }

  // local scoring fallback
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
      accuracyCue: /(renal|egfr|creatinine|bmd|resistance|ddi|interaction|efficacy|safety|adherence|formulary|access|prior auth|prep|tdf|taf|bictegravir|cabotegravir|rilpivirine|descovy|biktarvy|cabenuva)/i.test(t),
      tooLong: words > 180,
      idealLen: inRange(words, 45, 120)
    };

    const accuracy  = sig.accuracyCue ? (sig.label ? 5 : 4) : 3;
    const compliance= sig.label ? 5 : 3;
    const discovery = sig.discovery ? 4 : 2;
    const objection_handling = sig.objection ? (sig.accuracyCue ? 4 : 3) : 2;
    const empathy   = sig.empathy ? 3 : 2;
    const clarity   = sig.tooLong ? 2 : (sig.idealLen ? 4 : 3);

    const W = { accuracy:.26, compliance:.22, discovery:.16, objection_handling:.14, clarity:.12, empathy:.10 };
    const toPct = v => v * 20;

    let overall = (
      toPct(accuracy)  * W.accuracy +
      toPct(compliance)* W.compliance +
      toPct(discovery) * W.discovery +
      toPct(objection_handling)*W.objection_handling +
      toPct(clarity)   * W.clarity +
      toPct(empathy)   * W.empathy
    );
    if (sig.idealLen) overall += 3;
    if (endsWithQ) overall += 3;
    if (sig.tooLong) overall -= 6;
    overall = Math.max(0, Math.min(100, Math.round(overall)));

    const worked = [
      sig.empathy ? "Acknowledged HCP context" : null,
      sig.discovery ? "Closed with a clear discovery question" : null,
      sig.label ? "Referenced label/guidelines" : null,
      sig.accuracyCue ? "Tied points to clinical cues" : null
    ].filter(Boolean);

    const improve = [
      sig.tooLong ? "Tighten to 3–5 sentences" : null,
      sig.discovery ? null : "End with one specific question",
      sig.label ? null : "Anchor claims to label or guideline",
      clarity < 4 ? "Use one idea per sentence" : null
    ].filter(Boolean);

    const phrasing =
      sig.discovery
        ? "Given your criteria, which patients would be the best fit to start, and what would help you try one this month?"
        : "Would it help to align on eligibility criteria and agree on one next step for your earliest appropriate patient?";

    return {
      overall,
      scores: { accuracy, empathy, clarity, compliance, discovery, objection_handling },
      feedback: "Be concise, cite label or guidelines, end with one discovery question, and propose a next step.",
      worked,
      improve,
      phrasing,
      context: { rep_question: String(userText || ""), hcp_reply: String(replyText || "") },
      score: overall,
      subscores: { accuracy, empathy, clarity, compliance, discovery, objection_handling }
    };
  }

  // EI ratings
  function calculateEmpathyRating(personaKey, message) {
    if (!message) return 0;
    const text = String(message || "").toLowerCase();
    let score = { difficult:1, busy:2, engaged:4, indifferent:2 }[personaKey] ?? 3;
    ["understand","appreciate","concern","feel","sorry","hear","sounds like","empathize","thanks","acknowledge"]
      .forEach((kw)=>{ if (text.includes(kw)) score++; });
    return Math.min(5, score);
  }
  function calculateStressRating(personaKey, message) {
    if (!message) return 0;
    const text = String(message || "").toLowerCase();
    let score = { difficult:4, busy:5, engaged:2, indifferent:3 }[personaKey] ?? 3;
    ["stress","busy","overwhelmed","frustrated","tired","pressure","deadline"]
      .forEach((kw)=>{ if (text.includes(kw)) score++; });
    return Math.min(5, score);
  }

  function generateDynamicFeedback(personaKey, featureKey) {
    if (!personaKey || !featureKey) return "";
    if (featureKey === "empathy") {
      return {
        difficult:"Remain calm and acknowledge frustration. Use 'I understand this is challenging.'",
        busy:"Be concise and acknowledge workload.",
        engaged:"Show appreciation and ask collaborative questions.",
        indifferent:"Surface patient impact, acknowledge neutrality, pivot to benefits."
      }[personaKey] || "Tailor tone to the HCP and demonstrate understanding.";
    }
    if (featureKey === "stress") {
      return {
        difficult:"Keep delivery calm and reassuring.",
        busy:"Deliver brief solutions. Respect time pressure.",
        engaged:"Support curiosity with clear info.",
        indifferent:"Build rapport and emphasize patient benefit."
      }[personaKey] || "Match stress level with clarity and support.";
    }
    if (featureKey === "listening") {
      return {
        difficult:"Reflect and validate concerns before responding.",
        busy:"Summarize key points quickly to show attentiveness.",
        engaged:"Use affirmations and clarifying questions.",
        indifferent:"Use gentle prompts to draw them in."
      }[personaKey] || "Use active listening to validate and clarify.";
    }
    if (featureKey === "validation") {
      return {
        difficult:"Validate frustration, reframe to shared goals.",
        busy:"Acknowledge time limits, reframe to efficiency.",
        engaged:"Validate insights, emphasize partnership.",
        indifferent:"Acknowledge neutrality, reframe to meaningful outcomes."
      }[personaKey] || "Validate perspective then reframe toward collaboration.";
    }
    return "Select a valid EI feature.";
  }

  function generateFeedback() {
    if (!feedbackDisplayElem) return;
    if (currentMode !== "emotional-assessment") { feedbackDisplayElem.innerHTML = ""; return; }
    const personaKey = personaSelectElem?.value;
    const featureKey = eiFeatureSelectElem?.value;
    if (!personaKey || !featureKey || !lastUserMessage) {
      feedbackDisplayElem.innerHTML = `<span class="muted">Select a persona and EI feature, then send a message to see feedback.</span>`;
      return;
    }
    let rating = 0;
    if (featureKey === "empathy") rating = calculateEmpathyRating(personaKey, lastUserMessage);
    else if (featureKey === "stress") rating = calculateStressRating(personaKey, lastUserMessage);

    const featureList = (cfg?.eiFeatures?.length ? cfg.eiFeatures : DEFAULT_EI_FEATURES);
    const featureObj = featureList.find(f => f.key === featureKey);
    const featureLabel = featureObj ? featureObj.label : featureKey;
    const feedback = generateDynamicFeedback(personaKey, featureKey, rating);
    feedbackDisplayElem.innerHTML = `<strong>${esc(featureLabel)}${rating?`: ${rating}/5`:``}</strong><br/><p>${esc(feedback)}</p>`;
  }

  // prompt preface
  function buildPreface(mode, sc) {
    const COMMON = `
Return exactly two parts. No code blocks.
1) Sales Guidance: short, actionable, accurate guidance.
2) <coach>{
 "overall":0-100,"scores":{"accuracy":0-5,"empathy":0-5,"clarity":0-5,"compliance":0-5,"discovery":0-5,"objection_handling":0-5},
 "worked":["…"],"improve":["…"],"phrasing":"…","feedback":"one concise paragraph",
 "context":{"rep_question":"...","hcp_reply":"..."}
}</coach>`.trim();

    if (mode === "sales-simulation") {
      return `
You are a virtual pharma coach. Be label-aligned and safe.
${sc ? `Background: ${sc.background||"—"}\nToday’s Goal: ${sc.goal||"—"}` : ""}
Style: 3–6 sentences and one closing question. No pricing. No PHI. No off-label.

${COMMON}`.trim();
    }
    if (mode === "product-knowledge") {
      return `Concise educational overview with reputable citations: takeaways; mechanism/indications; safety/contraindications; efficacy; access notes; references.`.trim();
    }
    return `Brief self-reflection tips tied to HCP communication. 3–5 sentences, then one reflective question.\n\n${COMMON}`.trim();
  }

  // ---------- UI ----------
  function buildUI() {
    mount.innerHTML = "";
    if (!mount.classList.contains("cw")) mount.classList.add("cw");

    const style = document.createElement("style");
    style.textContent = `
      #reflectiv-widget .reflectiv-chat{ display:flex; flex-direction:column; gap:14px; border:2px solid #d1dae6; border-radius:16px; background:#fff; overflow:hidden; box-shadow:0 8px 28px rgba(15,24,36,.08); }
      #reflectiv-widget .chat-toolbar{ padding:16px; background:#0c2740; color:#fff; }
      #reflectiv-widget .controls-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px; align-items:end; }
      #reflectiv-widget .ctrl{ display:flex; flex-direction:column; gap:6px; min-width:0; width:100%; }
      #reflectiv-widget .ctrl label{ font-size:12px; font-weight:600; opacity:.9; }
      #reflectiv-widget .ctrl select{ display:block; width:100% !important; min-width:0 !important; height:38px; padding:6px 10px; font-size:14px; border:1px solid #b9c5d6; border-radius:10px; background:#fff; color:#0b1323; box-sizing:border-box; }
      #reflectiv-widget .chat-messages{ min-height:260px; height:320px; max-height:50vh; overflow:auto; padding:12px 14px; background:#f7f9fc; }
      #reflectiv-widget .message{ margin:8px 0; display:flex; }
      #reflectiv-widget .message.user{ justify-content:flex-end; }
      #reflectiv-widget .message.assistant{ justify-content:flex-start; }
      #reflectiv-widget .message .content{ max-width:85%; line-height:1.45; font-size:14px; padding:10px 12px; border-radius:14px; border:1px solid #d6dbe3; color:#0f1522; background:#e9edf3; }
      #reflectiv-widget .message.user .content{ background:#e0e0e0; color:#000; }
      #reflectiv-widget .chat-input{ display:flex; gap:8px; padding:12px 14px; border-top:1px solid #e1e6ef; background:#fff; }
      #reflectiv-widget .chat-input textarea{ flex:1; resize:none; min-height:44px; max-height:120px; padding:10px 12px; border:1px solid #cfd6df; border-radius:10px; outline:none; }
      #reflectiv-widget .chat-input .btn{ min-width:86px; border:0; border-radius:999px; background:#1e2a3a; color:#fff; font-weight:600; }
      #reflectiv-widget .coach-section{ margin:0 14px 14px; padding:12px 14px; border:1px solid #e1e6ef; border-radius:12px; background:#fff; }
      #reflectiv-widget .coach-subs .pill{ display:inline-block; padding:2px 8px; margin-right:6px; font-size:12px; background:#f1f3f7; border:1px solid #d6dbe3; border-radius:999px; }
      @media (max-width:900px){ #reflectiv-widget .controls-grid{ grid-template-columns:repeat(2,1fr); } #reflectiv-widget .chat-messages{ height:46vh; } }
      @media (max-width:540px){ #reflectiv-widget .controls-grid{ grid-template-columns:1fr; } }
      #reflectiv-widget .hidden{ display:none !important; }
    `;
    document.head.appendChild(style);

    const shell = el("div", "reflectiv-chat");
    const bar = el("div", "chat-toolbar");
    const grid = el("div","controls-grid");

    function makeField(labelText, inputEl, id){
      const wrap = el("div","ctrl"); const lab = el("label","",labelText);
      if(id) lab.htmlFor = id;
      // harden width at element level too
      inputEl.style.width = "100%";
      inputEl.style.minWidth = "0";
      wrap.appendChild(lab); wrap.appendChild(inputEl);
      return wrap;
    }

    const modeSel = el("select"); modeSel.id = "cw-mode";
    LC_OPTIONS.forEach((name) => { const o = el("option"); o.value = name; o.textContent = name; modeSel.appendChild(o); });
    const initialLc = Object.keys(LC_TO_INTERNAL).find(k => LC_TO_INTERNAL[k] === (cfg?.defaultMode || "sales-simulation")) || "Sales Simulation";
    modeSel.value = initialLc;
    currentMode = LC_TO_INTERNAL[modeSel.value];

    const coachSel = el("select"); coachSel.id = "cw-coach";
    [{v:"on",t:"Coach On"},{v:"off",t:"Coach Off"}].forEach(({v,t})=>{ const o = el("option"); o.value=v; o.textContent=t; coachSel.appendChild(o); });
    coachSel.value = coachOn ? "on" : "off";
    coachSel.onchange = () => { coachOn = coachSel.value === "on"; renderCoach(); };

    const diseaseSelect = el("select"); diseaseSelect.id = "cw-disease";
    const hcpSelect = el("select"); hcpSelect.id="cw-hcp";

    const personaSelect = el("select"); personaSelect.id = "cw-ei-persona";
    personaSelectElem = personaSelect;
    const featureSelect = el("select"); featureSelect.id = "cw-ei-feature";
    eiFeatureSelectElem = featureSelect;

    personaSelect.addEventListener("change", generateFeedback);
    featureSelect.addEventListener("change", generateFeedback);

    // order: four visible controls in sim mode span full width
    grid.appendChild(makeField("Learning Center", modeSel, "cw-mode"));
    grid.appendChild(makeField("Coach",          coachSel, "cw-coach"));
    grid.appendChild(makeField("Disease State",  diseaseSelect, "cw-disease"));
    grid.appendChild(makeField("HCP Profiles",   hcpSelect, "cw-hcp"));
    // EI mode controls
    grid.appendChild(makeField("HCP Persona",    personaSelect, "cw-ei-persona"));
    grid.appendChild(makeField("EI Feature",     featureSelect, "cw-ei-feature"));

    bar.appendChild(grid);
    shell.appendChild(bar);

    const meta = el("div", "scenario-meta");
    shell.appendChild(meta);

    const msgs = el("div", "chat-messages");
    shell.appendChild(msgs);

    const inp = el("div", "chat-input");
    const ta = el("textarea"); ta.placeholder = "Type your message…";
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send.click(); } });
    const send = el("button", "btn", "Send");
    send.onclick = () => { const t = ta.value.trim(); if (!t) return; sendMessage(t); ta.value = ""; };
    inp.appendChild(ta); inp.appendChild(send);
    shell.appendChild(inp);

    const coach = el("div", "coach-section");
    coach.innerHTML = `<h3>Coach Feedback</h3><div class="coach-body muted">Awaiting the first assistant reply…</div>`;
    shell.appendChild(coach);

    feedbackDisplayElem = el("div", "ei-feedback");
    feedbackDisplayElem.id = "feedback-display";
    feedbackDisplayElem.style.marginTop = "8px";
    feedbackDisplayElem.style.padding = "8px";
    feedbackDisplayElem.style.borderTop = "1px solid #e1e6ef";
    feedbackDisplayElem.style.fontSize = "14px";
    coach.appendChild(feedbackDisplayElem);

    function getDiseaseStates() {
      let ds = Array.isArray(cfg?.diseaseStates) ? cfg.diseaseStates.slice() : [];
      if (!ds.length && Array.isArray(scenarios) && scenarios.length){
        ds = Array.from(new Set(scenarios.map(s => (s.therapeuticArea || s.diseaseState || "").trim()))).filter(Boolean);
      }
      ds = ds.map(x => x.replace(/\bHiv\b/gi,"HIV"));
      return ds;
    }

    function elOption(select, val, label) {
      const o = document.createElement("option");
      o.value = val; o.textContent = label;
      select.appendChild(o);
    }

    function setSelectOptions(select, values, withPlaceholder) {
      select.innerHTML = "";
      if (withPlaceholder) {
        const p = document.createElement("option");
        p.value = ""; p.textContent = "Select…"; p.disabled = true; p.selected = true;
        select.appendChild(p);
      }
      values.forEach(v => {
        if (!v) return;
        if (typeof v === "string") elOption(select, v, v);
        else elOption(select, v.value || v.id || v.key || v.label, v.label || v.value || v.id || v.key);
      });
    }

    function populateDiseases() {
      const ds = getDiseaseStates();
      setSelectOptions(diseaseSelect, ds, true);
    }

    function populateHcpForDisease(ds) {
      const dsKey = (ds || "").trim();
      const scen = scenarios.filter(s => {
        const area = (s.therapeuticArea || s.diseaseState || "").trim();
        return area.toLowerCase() === dsKey.toLowerCase();
      });

      if (scen.length) {
        const opts = scen.map(s => ({ value: s.id, label: s.label || s.id }));
        setSelectOptions(hcpSelect, opts, true);
        hcpSelect.disabled = false;
      } else {
        setSelectOptions(hcpSelect, [], true);
        hcpSelect.disabled = true;
      }
    }

    function populateEIOptions() {
      const personaList = (cfg?.personas?.length ? cfg.personas : DEFAULT_PERSONAS);
      const featureList = (cfg?.eiFeatures?.length ? cfg.eiFeatures : DEFAULT_EI_FEATURES);
      setSelectOptions(personaSelect, personaList.map(p => ({ value: p.key || p.id || p.label, label: p.label || p.key || p.id })), true);
      setSelectOptions(featureSelect, featureList.map(f => ({ value: f.key || f.id || f.label, label: f.label || f.key || f.id })), true);
    }

    function selectedHcpLabel(){
      const opt = hcpSelect.options[hcpSelect.selectedIndex];
      return opt ? opt.textContent : "";
    }

    function renderMeta() {
      const sc = scenariosById.get(currentScenarioId);
      if (!sc || !currentScenarioId || currentMode !== "sales-simulation") { meta.innerHTML = ""; return; }
      const snapshot = getPersonaSnapshot(selectedHcpLabel()).join(", ");
      meta.innerHTML = `
        <div class="meta-card" style="margin:0 14px;padding:12px 14px;background:linear-gradient(0deg,#f6fbff,#fff);border:1px solid #e1e6ef;border-radius:12px;">
          <div><span class="briefing-label" style="display:block;font-size:12px;font-weight:700;color:#405065;margin-bottom:4px;">Background</span>
            <div class="briefing-val" style="font-size:14px;color:#0b1323;">${esc(snapshot || sc.background || "—")}</div></div>
          <div style="margin-top:8px"><span class="briefing-label" style="display:block;font-size:12px;font-weight:700;color:#405065;margin-bottom:4px;">Today’s Goal</span>
            <div class="briefing-val" style="font-size:14px;color:#0b1323;">${esc(sc.goal || "—")}</div></div>
        </div>`;
    }

    function renderMessages() {
      const msgsEl = shell.querySelector(".chat-messages");
      msgsEl.innerHTML = "";
      for (const m of conversation) {
        const row = el("div", `message ${m.role}`);
        const c = el("div", "content");
        c.innerHTML = md(m.content);
        row.appendChild(c);
        msgsEl.appendChild(row);
      }
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    function orderedPills(scores) {
      const order = ["accuracy","empathy","clarity","compliance","discovery","objection_handling"];
      return order
        .filter(k => k in (scores || {}))
        .map(k => `<span class="pill">${esc(k)}: ${scores[k]}</span>`)
        .join(" ");
    }

    function renderCoach() {
      const body = coach.querySelector(".coach-body");
      if (!coachOn || currentMode === "product-knowledge") { coach.style.display = "none"; return; }
      coach.style.display = "";
      const last = conversation[conversation.length - 1];
      if (!(last && last.role === "assistant" && last._coach)) { body.innerHTML = `<span class="muted">Awaiting the first assistant reply…</span>`; return; }
      const fb = last._coach;
      const scores = fb.scores || fb.subscores || {};
      const workedStr = (fb.worked && fb.worked.length) ? fb.worked.join(". ") + "." : "—";
      const improveStr = (fb.improve && fb.improve.length) ? fb.improve.join(". ") + "." : (fb.feedback || "—");
      body.innerHTML = `
        <div class="coach-score">Score: <strong>${fb.overall ?? fb.score ?? "—"}</strong>/100</div>
        <div class="coach-subs">${orderedPills(scores)}</div>
        <ul class="coach-list">
          <li><strong>What worked:</strong> ${esc(workedStr)}</li>
          <li><strong>What to improve:</strong> ${esc(improveStr)}</li>
          <li><strong>Suggested phrasing:</strong> ${esc(fb.phrasing || "—")}</li>
        </ul>`;
    }

    shell._renderMessages = renderMessages;
    shell._renderCoach = renderCoach;
    shell._renderMeta = renderMeta;

    function applyModeVisibility() {
      const lc = modeSel.value;
      currentMode = LC_TO_INTERNAL[lc];
      const pk = currentMode === "product-knowledge";

      if (currentMode === "sales-simulation") {
        coachSel.parentElement.classList.remove("hidden");
        diseaseSelect.parentElement.classList.remove("hidden");
        hcpSelect.parentElement.classList.remove("hidden");
        personaSelect.parentElement.classList.add("hidden");
        featureSelect.parentElement.classList.add("hidden");
        feedbackDisplayElem.innerHTML = "";
        populateDiseases();
      } else if (pk) {
        coachSel.parentElement.classList.add("hidden");
        diseaseSelect.parentElement.classList.remove("hidden");
        hcpSelect.parentElement.classList.add("hidden");
        personaSelect.parentElement.classList.add("hidden");
        featureSelect.parentElement.classList.add("hidden");
        feedbackDisplayElem.innerHTML = "";
        populateDiseases();
      } else { // emotional-assessment
        coachSel.parentElement.classList.add("hidden");
        diseaseSelect.parentElement.classList.add("hidden");
        hcpSelect.parentElement.classList.add("hidden");
        personaSelect.parentElement.classList.remove("hidden");
        featureSelect.parentElement.classList.remove("hidden");
        feedbackDisplayElem.innerHTML = "";
        currentScenarioId = null;
        conversation = [];
        renderMessages(); renderCoach(); renderMeta();
      }

      if (currentMode !== "sales-simulation") {
        currentScenarioId = null;
        conversation = [];
        renderMessages(); renderCoach(); renderMeta();
      }
    }

    populateDiseases();
    populateEIOptions();
    applyModeVisibility();

    diseaseSelect.addEventListener("change", ()=>{
      const ds = diseaseSelect.value || "";
      if (!ds) return;
      if (currentMode === "sales-simulation") populateHcpForDisease(ds);
      else currentScenarioId = null;
      conversation=[]; renderMessages(); renderCoach(); renderMeta();
    });

    hcpSelect.addEventListener("change", ()=>{
      const sel = hcpSelect.value || "";
      if (!sel) return;
      const sc = scenariosById.get(sel);
      currentScenarioId = sc ? sc.id : null;
      conversation=[]; renderMessages(); renderCoach(); renderMeta();
    });

    modeSel.addEventListener("change", applyModeVisibility);
    mount.appendChild(shell);
  }

  // ---------- transport ----------
  async function callModel(messages) {
    const r = await fetch((cfg?.apiBase || cfg?.workerUrl || "").trim(), {
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

  // ---------- send ----------
  async function sendMessage(userText) {
    const shellEl = mount.querySelector(".reflectiv-chat");
    const renderMessages = shellEl._renderMessages;
    const renderCoach = shellEl._renderCoach;

    lastUserMessage = userText;

    conversation.push({ role: "user", content: userText });
    renderMessages(); renderCoach();

    if (currentMode === "emotional-assessment") generateFeedback();

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
          const overall = typeof coach.overall === "number" ? coach.overall : (typeof coach.score === "number" ? coach.score : undefined);
          return {
            overall: overall ?? computed.overall,
            scores,
            feedback: coach.feedback || computed.feedback,
            worked: coach.worked && coach.worked.length ? coach.worked : computed.worked,
            improve: coach.improve && coach.improve.length ? coach.improve : computed.improve,
            phrasing: typeof coach.phrasing === "string" && coach.phrasing ? coach.phrasing : computed.phrasing,
            context: coach.context || { rep_question: userText, hcp_reply: clean },
            score: overall ?? computed.overall,
            subscores: scores
          };
        }
        return computed;
      })();

      conversation.push({ role: "assistant", content: clean, _coach: finalCoach });
      renderMessages(); renderCoach();

      if (currentMode === "emotional-assessment") generateFeedback();

      if (cfg && cfg.analyticsEndpoint) {
        fetch(cfg.analyticsEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ts: Date.now(),
            schema: (cfg.schemaVersion || "coach-v2"),
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
    }
  }

  // ---------- scenarios loader ----------
  async function loadScenarios() {
    if (cfg && cfg.scenariosUrl) {
      const payload = await fetchLocal(cfg.scenariosUrl);
      const arr = Array.isArray(payload) ? payload : (payload.scenarios || []);
      scenarios = arr.map((s)=>({
        id: s.id,
        label: s.label || s.id,
        therapeuticArea: s.therapeuticArea || s.diseaseState || "",
        hcpRole: s.hcpRole || "",
        background: s.background || "",
        goal: s.goal || ""
      }));
    } else if (Array.isArray(cfg?.scenarios)) {
      scenarios = cfg.scenarios.map((s)=>({
        id: s.id,
        label: s.label || s.id,
        therapeuticArea: (s.therapeuticArea||s.diseaseState||""),
        hcpRole: s.hcpRole || "",
        background: s.background || "",
        goal: s.goal || ""
      }));
    } else {
      scenarios = [];
    }
    scenarios.forEach(s => { if (/^hiv\b/i.test(s.therapeuticArea)) s.therapeuticArea = "HIV"; });
    scenariosById = new Map(scenarios.map((s)=>[s.id,s]));
  }

  // ---------- init ----------
  async function init() {
    try {
      cfg = await fetchLocal("./assets/chat/config.json");
    } catch (e) {
      console.error("config.json load failed:", e);
      cfg = { defaultMode: "sales-simulation" };
    }

    try {
      systemPrompt = await fetchLocal("./assets/chat/system.md");
    } catch (_) {
      systemPrompt = "";
    }

    await loadScenarios();
    buildUI();
  }

  waitForMount(init);
})();
