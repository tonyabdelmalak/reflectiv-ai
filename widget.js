/* widget.js
 * ReflectivAI Chat/Coach — drop-in (coach-v2, deterministic scoring v3, utilities v2)
 * Modes: emotional-intelligence | product-knowledge | sales-simulation | role-play
 * Implements:
 *  - Disease State + HCP Profile dropdowns for Role Play and Sales Simulation.
 *  - Continuous dialog with HCP.
 *  - Per-turn Coach Feedback panel BELOW the chat.
 *  - Final evaluation only when user types a variant of “Evaluate this exchange.” or presses Evaluate.
 *  - Safe fallback when config endpoint is missing.
 *  - Accessibility labeling, focus trap, keyboard shortcuts.
 *  - Utilities: export transcript, copy transcript, reset session, evaluate button.
 *  - Persisted UI prefs: mode, disease, hcp, compact view, autoscroll, debug.
 *  - Robust internals: request queue, retry with backoff, timeouts, input debouncing.
 *  - Defensive HTML escaping and minimal DOM writes.
 */
(function () {
  // ===========================
  // Safe bootstrapping
  // ===========================
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

  // ===========================
  // Config / State
  // ===========================
  const LC_OPTIONS = ["Emotional Intelligence","Product Knowledge","Sales Simulation","Role Play"];
  const LC_TO_INTERNAL = {
    "Emotional Intelligence": "emotional-intelligence",
    "Product Knowledge": "product-knowledge",
    "Sales Simulation": "sales-simulation",
    "Role Play": "role-play"
  };

  const INTERNAL_TO_LC = {
    "emotional-intelligence": "Emotional Intelligence",
    "product-knowledge": "Product Knowledge",
    "sales-simulation": "Sales Simulation",
    "role-play": "Role Play"
  };

  const EVAL_ALIASES = [
    "evaluate this exchange",
    "evaluate this conversation",
    "evaluate the conversation",
    "give feedback",
    "final evaluation",
    "please evaluate",
    "overall feedback",
    "overall evaluation"
  ];

  let cfg = null;
  let systemPrompt = "";
  let scenarios = [];
  let scenariosById = new Map();

  let currentMode = "sales-simulation";
  let currentScenarioId = null;
  let conversation = []; // [{role:'user'|'assistant'|'system', content, _coach?}]
  let coachOn = true;

  // prefs
  let prefCompact = false;
  let prefAutoscroll = true;
  let prefDebug = false;

  // refs populated in buildUI()
  let refs = {
    shell: null,
    msgs: null,
    coach: null,
    coachBody: null,
    feedbackDisplay: null,
    toolbar: null,
    ta: null,
    sendBtn: null,
    evalBtn: null,
    copyBtn: null,
    exportBtn: null,
    resetBtn: null,
    modeSel: null,
    coachSel: null,
    diseaseSel: null,
    hcpSel: null,
    personaSel: null,
    featureSel: null,
    compactChk: null,
    autoscrollChk: null,
    debugChk: null,
    liveRegion: null
  };

  // EI globals
  let personaSelectElem = null;
  let eiFeatureSelectElem = null;
  let feedbackDisplayElem = null;
  let personaLabelElem = null;
  let featureLabelElem = null;
  let lastUserMessage = "";

  // Abort + Queue
  let activeController = null;
  const queue = [];
  let queueBusy = false;

  // ===========================
  // Defaults
  // ===========================
  const DEFAULT_PERSONAS = [
    { key: "difficult",   label: "Difficult HCP" },
    { key: "busy",        label: "Busy HCP" },
    { key: "engaged",     label: "Engaged HCP" },
    { key: "indifferent", label: "Indifferent HCP" }
  ];
  const DEFAULT_EI_FEATURES = [
    { key: "empathy",    label: "Empathy Rating" },
    { key: "stress",     label: "Stress Level Indicator" },
    { key: "listening",  label: "Active Listening Hints" },
    { key: "validation", label: "Validation & Reframing Tips" }
  ];

  // ===========================
  // Utilities
  // ===========================
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
    let s = esc(String(text)).replace(/\r\n?/g, "\n");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(
      /^(?:-\s+|\*\s+).+(?:\n(?:-\s+|\*\s+).+)*/gm,
      (blk) => {
        const items = blk
          .split("\n")
          .map((l) => l.replace(/^(?:-\s+|\*\s+)(.+)$/, "<li>$1</li>"))
          .join("");
        return `<ul>${items}</ul>`;
      }
    );
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

  function nowIso(){ return new Date().toISOString(); }

  function debounce(fn, ms){
    let t = null;
    return function(...args){
      clearTimeout(t);
      t = setTimeout(()=>fn.apply(this,args), ms);
    };
  }

  function liveAnnounce(msg){
    if (!refs.liveRegion) return;
    refs.liveRegion.textContent = ""; // clear to retrigger
    refs.liveRegion.textContent = msg;
  }

  function copyToClipboard(text){
    try {
      navigator.clipboard.writeText(text);
      liveAnnounce("Transcript copied.");
    } catch {
      const tmp = document.createElement("textarea");
      tmp.value = text;
      tmp.setAttribute("readonly", "");
      tmp.style.position = "absolute";
      tmp.style.left = "-9999px";
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand("copy");
      document.body.removeChild(tmp);
      liveAnnounce("Transcript copied.");
    }
  }

  function downloadFile(name, mime, content){
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  function transcriptText(){
    const lines = [];
    lines.push(`# ReflectivAI Transcript — ${new Date().toLocaleString()}`);
    lines.push("");
    for (const m of conversation){
      if (m.role === "system") continue;
      const who = m.role === "user" ? "Rep" : "HCP/Coach";
      lines.push(`${who}: ${m.content}`);
    }
    return lines.join("\n");
  }

  function savePrefs(){
    const obj = {
      mode: currentMode,
      scenarioId: currentScenarioId,
      coachOn,
      compact: prefCompact,
      autoscroll: prefAutoscroll,
      debug: prefDebug,
      disease: refs.diseaseSel ? refs.diseaseSel.value : "",
      hcp: refs.hcpSel ? refs.hcpSel.value : ""
    };
    try { localStorage.setItem("reflectiv-coach-prefs", JSON.stringify(obj)); } catch {}
  }

  function loadPrefs(){
    try {
      const raw = localStorage.getItem("reflectiv-coach-prefs");
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p && typeof p === "object"){
        currentMode = p.mode || currentMode;
        currentScenarioId = p.scenarioId || null;
        coachOn = !!p.coachOn;
        prefCompact = !!p.compact;
        prefAutoscroll = p.autoscroll !== false;
        prefDebug = !!p.debug;
      }
    } catch {}
  }

  // ===========================
  // Robust extractor for <coach>{...}</coach>
  // ===========================
  function extractCoach(raw) {
    const s = String(raw || "");
    const openIdx = s.indexOf("<coach>");
    if (openIdx === -1) return { coach: null, clean: sanitizeLLM(s) };

    const cleanText = sanitizeLLM(s.slice(0, openIdx).trim());
    let tail = s.slice(openIdx + "<coach>".length);
    const closeIdx = tail.indexOf("</coach>");
    let block = closeIdx >= 0 ? tail.slice(0, closeIdx) : tail;
    const braceStart = block.indexOf("{");
    if (braceStart === -1) return { coach: null, clean: cleanText };

    let depth = 0, end = -1;
    for (let i = braceStart; i < block.length; i++) {
      const ch = block[i];
      if (ch === "{") depth++;
      if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) return { coach: null, clean: cleanText };

    let jsonTxt = block.slice(braceStart, end + 1)
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");

    let coach = null;
    try { coach = JSON.parse(jsonTxt); } catch {}
    return { coach, clean: cleanText };
  }

  // ===========================
  // Deterministic local scoring v3
  // ===========================
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
      sig.label ? "Referenced label or guidelines" : null,
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
      feedback: "Be concise, cite label or guidelines for clinical points, ask one focused discovery question, and propose a concrete next step.",
      worked,
      improve,
      phrasing,
      context: { rep_question: String(userText || ""), hcp_reply: String(replyText || "") },
      score: overall,
      subscores: { accuracy, empathy, clarity, compliance, discovery, objection_handling }
    };
  }

  // ===========================
  // EI scoring helpers
  // ===========================
  function calculateEmpathyRating(personaKey, message) {
    if (!message) return 0;
    const text = String(message || "").toLowerCase();
    let score = 0;
    switch (personaKey) {
      case "difficult": score = 1; break;
      case "busy": score = 2; break;
      case "engaged": score = 4; break;
      case "indifferent": score = 3; break;
      default: score = 3;
    }
    const empathyKeywords = ["understand","appreciate","concern","feel","sorry","hear","sounds like","empathize","thanks","acknowledge"];
    empathyKeywords.forEach((kw)=>{ if (text.includes(kw)) score++; });
    return Math.min(5, score);
  }

  function calculateStressRating(personaKey, message) {
    if (!message) return 0;
    const text = String(message || "").toLowerCase();
    let score = 0;
    switch (personaKey) {
      case "difficult": score = 4; break;
      case "busy": score = 5; break;
      case "engaged": score = 2; break;
      case "indifferent": score = 3; break;
      default: score = 3;
    }
    const stressWords = ["stress","busy","overwhelmed","frustrated","tired","pressure","deadline"];
    stressWords.forEach((kw)=>{ if (text.includes(kw)) score++; });
    return Math.min(5, score);
  }

  function generateDynamicFeedback(personaKey, featureKey) {
    if (!personaKey || !featureKey) return "";
    let feedback = "";

    if (featureKey === "empathy") {
      switch (personaKey) {
        case "difficult":   feedback = "Acknowledge frustration and keep voice calm. Use short validating phrases before you propose next steps."; break;
        case "busy":        feedback = "Empathize in one line, then get to the point. Lead with the outcome and time saved."; break;
        case "engaged":     feedback = "Reinforce collaboration. Thank them for input and ask one specific next question."; break;
        case "indifferent": feedback = "Validate neutrality, then pivot to patient impact and one meaningful benefit."; break;
        default:            feedback = "Match tone to the HCP and show you understand their context before offering guidance.";
      }
    } else if (featureKey === "stress") {
      switch (personaKey) {
        case "difficult":   feedback = "Stress likely high. Keep it brief and reassuring. Remove jargon."; break;
        case "busy":        feedback = "Time pressure high. Bottom line first. Offer one low-effort next step."; break;
        case "engaged":     feedback = "Moderate stress. Provide clear info and invite collaboration."; break;
        case "indifferent": feedback = "Average stress. Build rapport through patient-centered framing."; break;
        default:            feedback = "Adjust tone to stress level. Reduce cognitive load and give clear choices.";
      }
    } else if (featureKey === "listening") {
      switch (personaKey) {
        case "difficult":   feedback = "Reflect back their words. Confirm you got it right, then ask a short clarifier."; break;
        case "busy":        feedback = "Summarize their point in one sentence. Ask one yes or no clarifier."; break;
        case "engaged":     feedback = "Affirm insights and build on them. Use clarifying questions to deepen trust."; break;
        case "indifferent": feedback = "Use light affirmations to draw them in. Ask a simple patient-impact question."; break;
        default:            feedback = "Use reflective and clarifying questions. Keep it concise.";
      }
    } else if (featureKey === "validation") {
      switch (personaKey) {
        case "difficult":   feedback = "Validate frustration first. Reframe around shared goals and patient outcomes."; break;
        case "busy":        feedback = "Validate time constraints. Reframe to efficiency and workflow fit."; break;
        case "engaged":     feedback = "Validate expertise. Reframe to partnership and quick experimentation."; break;
        case "indifferent": feedback = "Validate neutrality. Reframe to meaningful benefits for a typical patient."; break;
        default:            feedback = "Validate perspective and reframe to collaboration and patient value.";
      }
    } else {
      feedback = "Select a valid EI feature for targeted guidance.";
    }

    return feedback;
  }

  function generateFeedback() {
    if (!feedbackDisplayElem) return;
    if (currentMode !== "emotional-intelligence") {
      feedbackDisplayElem.innerHTML = "";
      return;
    }
    const personaKey = personaSelectElem && personaSelectElem.value;
    const featureKey = eiFeatureSelectElem && eiFeatureSelectElem.value;
    if (!personaKey || !featureKey || !lastUserMessage) {
      feedbackDisplayElem.innerHTML = `<span class="muted">Select a persona and EI feature, then send a message to see feedback.</span>`;
      return;
    }
    let rating = null;
    if (featureKey === "empathy") rating = calculateEmpathyRating(personaKey, lastUserMessage);
    else if (featureKey === "stress") rating = calculateStressRating(personaKey, lastUserMessage);

    const featureList = (cfg?.eiFeatures && cfg.eiFeatures.length ? cfg.eiFeatures : DEFAULT_EI_FEATURES);
    const featureObj = featureList.find(f => f.key === featureKey || f.value === featureKey || f.id === featureKey);
    const featureLabel = featureObj ? (featureObj.label || featureKey) : featureKey;
    const feedback = generateDynamicFeedback(personaKey, featureKey);

    feedbackDisplayElem.innerHTML = (rating == null)
      ? `<strong>${esc(featureLabel)}</strong><br><p>${esc(feedback)}</p>`
      : `<strong>${esc(featureLabel)}: ${rating}/5</strong><br><p>${esc(feedback)}</p>`;
  }

  // ===========================
  // Prompt Preface builders
  // ===========================
  function commonCoachContract(){
/* no-indent */return (
`# ReflectivAI — Output Contract
Return exactly two parts. No code blocks. No markdown headings.
1) Sales Guidance: short, actionable, accurate guidance.
2) <coach>{
     "overall": 0-100,
     "scores": { "accuracy":0-5,"empathy":0-5,"clarity":0-5,"compliance":0-5,"discovery":0-5,"objection_handling":0-5 },
     "worked": ["…"],
     "improve": ["…"],
     "phrasing": "…",
     "feedback": "one concise paragraph",
     "context": { "rep_question":"...", "hcp_reply":"..." }
   }</coach>`
).trim();
  }

  function buildPreface(mode, sc) {
    if (mode === "sales-simulation") {
      return (
`# Role
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

${commonCoachContract()}`).trim();
    }

    if (mode === "product-knowledge") {
      return `Return a concise educational overview with reputable citations. Structure: key takeaways; mechanism/indications; safety/contraindications; efficacy; access notes; references.`.trim();
    }

    if (mode === "role-play") {
  return (
`# Role Play — HCP only
You are the Healthcare Provider. Reply ONLY as the HCP. Be realistic, brief, and sometimes skeptical or time-constrained.

Return exactly two parts. No code blocks. No headings.
1) HCP: one natural, concise HCP message responding to the rep’s last message. No bullets. No meta.
2) <coach>{
     "overall": 0-100,
     "scores": { "accuracy":0-5,"empathy":0-5,"clarity":0-5,"compliance":0-5,"discovery":0-5,"objection_handling":0-5 },
     "worked": ["…"],
     "improve": ["…"],
     "phrasing": "…",
     "feedback": "one concise paragraph",
     "context": { "rep_question":"...", "hcp_reply":"..." }
   }</coach>`.trim();
}

    // emotional-intelligence
    return (
`Provide brief self-reflection tips tied to HCP communication.
- 3–5 sentences, then one reflective question.

${commonCoachContract()}`).trim();
  }

  // ===========================
  // Focus trap
  // ===========================
  function setupFocusTrap(container){
    const focusable = () => Array.from(container.querySelectorAll(`
      a[href], button:not([disabled]), textarea:not([disabled]),
      input[type="text"]:not([disabled]), select:not([disabled]),
      [tabindex]:not([tabindex="-1"])
    `));
    container.addEventListener("keydown", (e)=>{
      if (e.key !== "Tab") return;
      const nodes = focusable();
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey){
        if (document.activeElement === first){ last.focus(); e.preventDefault(); }
      } else {
        if (document.activeElement === last){ first.focus(); e.preventDefault(); }
      }
    });
  }

  // ===========================
  // UI Builder
  // ===========================
  function buildUI() {
    mount.innerHTML = "";
    if (!mount.classList.contains("cw")) mount.classList.add("cw");

    // styles
    const STYLE_ID = "reflectiv-widget-inline-style";
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
#reflectiv-widget .reflectiv-chat{display:flex;flex-direction:column;gap:12px;border:3px solid #bfc7d4;border-radius:14px;background:#fff;overflow:hidden}
#reflectiv-widget .chat-toolbar{display:flex;flex-direction:column;gap:12px;padding:14px 16px;background:#f6f8fb;border-bottom:1px solid #e1e6ef}
#reflectiv-widget .toolbar-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
#reflectiv-widget .sim-controls{display:grid;grid-template-columns:200px 1fr 200px 1fr;gap:12px 12px;align-items:center}
#reflectiv-widget .sim-controls label{font-size:13px;font-weight:600;color:#2f3a4f;justify-self:end;white-space:nowrap}
#reflectiv-widget .sim-controls select{width:100%;height:38px;padding:6px 10px;font-size:14px;border:1px solid #cfd6df;border-radius:8px;background:#fff}
#reflectiv-widget .pref-controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
#reflectiv-widget .pref-controls label{font-size:13px;color:#2f3a4f}
#reflectiv-widget .toolbar-btn{height:32px;padding:0 12px;border:1px solid #cfd6df;border-radius:8px;background:#fff;color:#0f1522;font-weight:600;cursor:pointer}
#reflectiv-widget .toolbar-btn.primary{background:#2f3a4f;color:#fff;border:0}
#reflectiv-widget .chat-messages{min-height:240px;height:auto;max-height:52vh;overflow:auto;padding:12px 14px;background:#fafbfd}
#reflectiv-widget .message{margin:8px 0;display:flex}
#reflectiv-widget .message.user{justify-content:flex-end}
#reflectiv-widget .message.assistant{justify-content:flex-start}
#reflectiv-widget .message .content{max-width:85%;line-height:1.5;font-size:14px;padding:10px 12px;border-radius:14px;border:1px solid #d6dbe3;color:#0f1522;background:#e9edf3}
#reflectiv-widget .message.user .content{background:#e0e0e0;color:#000}
#reflectiv-widget .chat-input{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #e1e6ef;background:#fff}
#reflectiv-widget .chat-input textarea{flex:1;resize:none;min-height:44px;max-height:120px;padding:10px 12px;border:1px solid #cfd6df;border-radius:10px;outline:none}
#reflectiv-widget .chat-input .btn{min-width:86px;border:0;border-radius:999px;background:#2f3a4f;color:#fff;font-weight:600}
#reflectiv-widget .coach-section{margin-top:0;padding:12px 14px;border:1px solid #e1e6ef;border-radius:12px;background:#fffbe8}
#reflectiv-widget .coach-subs .pill{display:inline-block;padding:2px 8px;margin-right:6px;font-size:12px;background:#f1f3f7;border:1px solid #d6dbe3;border-radius:999px}
#reflectiv-widget .scenario-meta .meta-card{padding:10px 12px;background:#f7f9fc;border:1px solid #e1e6ef;border-radius:10px}
#reflectiv-widget .muted{color:#6b7280}
#reflectiv-widget .hidden{display:none!important}
#reflectiv-widget.compact .message .content{font-size:13px;line-height:1.4;padding:8px 10px}
#reflectiv-widget .kbd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid #cfd6df;border-bottom-width:2px;padding:.1rem .35rem;border-radius:.3rem;background:#fff}
#reflectiv-widget .live-region{position:absolute;left:-9999px;height:1px;width:1px;overflow:hidden}
@media (max-width:980px){#reflectiv-widget .sim-controls{grid-template-columns:1fr 1fr;gap:10px}}
@media (max-width:640px){#reflectiv-widget .sim-controls{grid-template-columns:1fr;gap:8px}#reflectiv-widget .sim-controls label{justify-self:start}}
      `;
      document.head.appendChild(style);
    }

    const shell = el("div", "reflectiv-chat");
    refs.shell = shell;

    const live = el("div", "live-region");
    live.setAttribute("aria-live", "polite");
    live.setAttribute("aria-atomic", "true");
    shell.appendChild(live);
    refs.liveRegion = live;

    // Toolbar
    const bar = el("div", "chat-toolbar");
    refs.toolbar = bar;

    // Row 1: Sim controls
    const row1 = el("div","toolbar-row");
    const simControls = el("div","sim-controls");

    const lcLabel = el("label", "", "Learning Center Mode");
    lcLabel.htmlFor = "cw-mode";
    const modeSel = el("select"); modeSel.id = "cw-mode"; modeSel.setAttribute("aria-label","Learning Center Mode");
    LC_OPTIONS.forEach((name) => {
      const o = el("option"); o.value = name; o.textContent = name;
      modeSel.appendChild(o);
    });

    // defaults from prefs or cfg
    const initialMode = INTERNAL_TO_LC[currentMode] || (INTERNAL_TO_LC[(cfg?.defaultMode||"sales-simulation")] || "Sales Simulation");
    modeSel.value = initialMode;
    currentMode = LC_TO_INTERNAL[modeSel.value];
    refs.modeSel = modeSel;

    const coachLabel = el("label", "", "Coach");
    coachLabel.htmlFor = "cw-coach";
    const coachSel = el("select"); coachSel.id = "cw-coach"; coachSel.setAttribute("aria-label","Coach On Off");
    [{v:"on",t:"Coach On"},{v:"off",t:"Coach Off"}].forEach(({v,t})=>{
      const o = el("option"); o.value=v; o.textContent=t; coachSel.appendChild(o);
    });
    coachSel.value = coachOn ? "on" : "off";
    coachSel.onchange = () => { coachOn = coachSel.value === "on"; renderCoach(); savePrefs(); };
    refs.coachSel = coachSel;

    const diseaseLabel = el("label", "", "Disease State");
    diseaseLabel.htmlFor = "cw-disease";
    const diseaseSelect = el("select"); diseaseSelect.id = "cw-disease"; diseaseSelect.setAttribute("aria-label","Disease State");
    refs.diseaseSel = diseaseSelect;

    const hcpLabel = el("label","","HCP Profile");
    hcpLabel.htmlFor="cw-hcp";
    const hcpSelect = el("select"); hcpSelect.id="cw-hcp"; hcpSelect.setAttribute("aria-label","HCP Profile");
    refs.hcpSel = hcpSelect;

    // EI Persona/EI Feature
    const personaLabel = el("label", "", "HCP Persona");
    personaLabel.htmlFor = "cw-ei-persona";
    const personaSelect = el("select"); personaSelect.id = "cw-ei-persona"; personaSelect.setAttribute("aria-label","HCP Persona");
    personaSelectElem = personaSelect;
    personaLabelElem = personaLabel;
    personaSelect.addEventListener("change", ()=>{ generateFeedback(); savePrefs(); });

    const featureLabel = el("label", "", "EI Feature");
    featureLabel.htmlFor = "cw-ei-feature";
    const featureSelect = el("select"); featureSelect.id = "cw-ei-feature"; featureSelect.setAttribute("aria-label","EI Feature");
    eiFeatureSelectElem = featureSelect;
    featureLabelElem = featureLabel;
    featureSelect.addEventListener("change", ()=>{ generateFeedback(); savePrefs(); });

    // mount sim controls
    simControls.appendChild(lcLabel);      simControls.appendChild(modeSel);
    simControls.appendChild(coachLabel);   simControls.appendChild(coachSel);
    simControls.appendChild(diseaseLabel); simControls.appendChild(diseaseSelect);
    simControls.appendChild(hcpLabel);     simControls.appendChild(hcpSelect);
    simControls.appendChild(personaLabel); simControls.appendChild(personaSelect);
    simControls.appendChild(featureLabel); simControls.appendChild(featureSelect);
    row1.appendChild(simControls);

    // Row 2: Prefs and quick actions
    const row2 = el("div","toolbar-row");

    const prefControls = el("div","pref-controls");

    const compactWrap = el("label",""); // control group
    const compactChk = document.createElement("input");
    compactChk.type = "checkbox"; compactChk.checked = prefCompact; compactChk.id = "cw-compact";
    compactChk.setAttribute("aria-label","Compact view");
    compactWrap.appendChild(compactChk); compactWrap.appendChild(document.createTextNode(" Compact view"));
    compactChk.addEventListener("change",()=>{
      prefCompact = compactChk.checked;
      mount.classList.toggle("compact", prefCompact);
      savePrefs();
    });
    refs.compactChk = compactChk;

    const autoscrollWrap = el("label","");
    const autoscrollChk = document.createElement("input");
    autoscrollChk.type = "checkbox"; autoscrollChk.checked = prefAutoscroll; autoscrollChk.id = "cw-autoscroll";
    autoscrollChk.setAttribute("aria-label","Autoscroll");
    autoscrollWrap.appendChild(autoscrollChk); autoscrollWrap.appendChild(document.createTextNode(" Autoscroll"));
    autoscrollChk.addEventListener("change",()=>{ prefAutoscroll = autoscrollChk.checked; savePrefs(); });
    refs.autoscrollChk = autoscrollChk;

    const debugWrap = el("label","");
    const debugChk = document.createElement("input");
    debugChk.type = "checkbox"; debugChk.checked = prefDebug; debugChk.id = "cw-debug";
    debugChk.setAttribute("aria-label","Debug mode");
    debugWrap.appendChild(debugChk); debugWrap.appendChild(document.createTextNode(" Debug"));
    debugChk.addEventListener("change",()=>{ prefDebug = debugChk.checked; savePrefs(); });
    refs.debugChk = debugChk;

    prefControls.appendChild(compactWrap);
    prefControls.appendChild(autoscrollWrap);
    prefControls.appendChild(debugWrap);

    // quick action buttons
    const btn = (txt, cls="toolbar-btn") => { const b = el("button",cls,txt); b.type="button"; return b; };
    const evaluateBtn = btn("Evaluate","toolbar-btn primary");
    const copyBtn = btn("Copy Transcript");
    const exportBtn = btn("Export .txt");
    const resetBtn = btn("Reset");

    evaluateBtn.addEventListener("click", ()=> evaluateTranscript());
    copyBtn.addEventListener("click", ()=> copyToClipboard(transcriptText()));
    exportBtn.addEventListener("click", ()=> downloadFile(`reflectiv-transcript-${Date.now()}.txt`,"text/plain", transcriptText()));
    resetBtn.addEventListener("click", ()=> resetSession());

    refs.evalBtn = evaluateBtn;
    refs.copyBtn = copyBtn;
    refs.exportBtn = exportBtn;
    refs.resetBtn = resetBtn;

    row2.appendChild(prefControls);
    row2.appendChild(evaluateBtn);
    row2.appendChild(copyBtn);
    row2.appendChild(exportBtn);
    row2.appendChild(resetBtn);

    bar.appendChild(row1);
    bar.appendChild(row2);

    // Meta card
    const meta = el("div", "scenario-meta");
    meta.setAttribute("aria-live","polite");

    // Messages
    const msgs = el("div", "chat-messages");
    msgs.setAttribute("role","log");
    msgs.setAttribute("aria-label","Chat transcript");
    msgs.setAttribute("aria-live","polite");
    refs.msgs = msgs;

    // Input
    const inp = el("div", "chat-input");
    const ta = el("textarea"); ta.placeholder = "Type your message…";
    ta.setAttribute("aria-label","Message input");
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); refs.sendBtn.click(); }
      if (e.key.toLowerCase() === "e" && (e.ctrlKey || e.metaKey) && e.shiftKey){ e.preventDefault(); evaluateTranscript(); }
      if (e.key.toLowerCase() === "r" && (e.ctrlKey || e.metaKey) && e.shiftKey){ e.preventDefault(); resetSession(); }
      if (e.key.toLowerCase() === "c" && (e.ctrlKey || e.metaKey) && e.shiftKey){ e.preventDefault(); copyToClipboard(transcriptText()); }
      if (e.altKey){
        const n = Number(e.key);
        if (n>=1 && n<=4){
          const name = LC_OPTIONS[n-1];
          refs.modeSel.value = name;
          applyModeVisibility();
          savePrefs();
        }
      }
    });
    const send = el("button", "btn", "Send");
    send.setAttribute("aria-label","Send message");
    send.onclick = () => {
      const t = ta.value.trim();
      if (!t) return;
      ta.value = "";
      debouncedSend(t);
    };
    refs.ta = ta; refs.sendBtn = send;

    inp.appendChild(ta); inp.appendChild(send);

    // Coach panel
    const coach = el("div", "coach-section");
    const coachHdr = el("h3","", "Coach Feedback");
    const coachBody = el("div","coach-body muted");
    coachBody.textContent = "Awaiting the first assistant reply…";
    coach.appendChild(coachHdr);
    coach.appendChild(coachBody);
    refs.coach = coach;
    refs.coachBody = coachBody;

    // EI feedback area (below coach header)
feedbackDisplayElem = el("div", "ei-feedback");
feedbackDisplayElem.id = "feedback-display";
feedbackDisplayElem.setAttribute("role","region");
feedbackDisplayElem.setAttribute("aria-live","polite");
feedbackDisplayElem.setAttribute("aria-label","Emotional intelligence feedback");
feedbackDisplayElem.style.marginTop = "8px";
feedbackDisplayElem.style.padding = "8px";
feedbackDisplayElem.style.borderTop = "1px solid #e1e6ef";
feedbackDisplayElem.style.fontSize = "14px";
coach.appendChild(feedbackDisplayElem);

    shell.appendChild(bar);
    shell.appendChild(meta);
    shell.appendChild(msgs);
    shell.appendChild(inp);
    shell.appendChild(coach);
    mount.appendChild(shell);

    // hydrate EI selects
    hydrateEISelects();

    // helpers
    function getDiseaseStates() {
      let ds = Array.isArray(cfg?.diseaseStates) ? cfg.diseaseStates.slice() : [];
      if (!ds.length && Array.isArray(scenarios) && scenarios.length){
        ds = Array.from(new Set(scenarios.map(s => (s.therapeuticArea || s.diseaseState || "").trim()))).filter(Boolean);
      }
      ds = ds.map(x => x.replace(/\bhiv\b/ig,"HIV"));
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
      setSelectOptions(refs.diseaseSel, ds, true);
      if (prefDebug) console.debug("[coach] diseases:", ds);
    }

    function populateHcpForDisease(ds) {
      const dsKey = (ds || "").trim();
      const scen = scenarios.filter(s => {
        const area = (s.therapeuticArea || s.diseaseState || "").trim();
        return area.toLowerCase() === dsKey.toLowerCase();
      });

      if (scen.length) {
        const opts = scen.map(s => ({ value: s.id, label: s.label || s.id }));
        setSelectOptions(refs.hcpSel, opts, true);
        refs.hcpSel.disabled = false;
      } else {
        setSelectOptions(refs.hcpSel, [{ value:"", label:"No scenarios for this disease" }], true);
        refs.hcpSel.disabled = true;
      }
    }

    function renderMeta() {
      const sc = scenariosById.get(currentScenarioId);
      const container = meta;
      if (!sc || !currentScenarioId || (currentMode !== "sales-simulation" && currentMode !== "role-play")) { container.innerHTML = ""; return; }
      container.innerHTML = `
        <div class="meta-card">
          <div><strong>Therapeutic Area:</strong> ${esc(sc.therapeuticArea || sc.diseaseState || "—")}</div>
          <div><strong>HCP Role:</strong> ${esc(sc.hcpRole || "—")}</div>
          <div><strong>Background:</strong> ${esc(sc.background || "—")}</div>
          <div><strong>Today’s Goal:</strong> ${esc(sc.goal || "—")}</div>
        </div>`;
    }

    function renderMessages() {
      const msgsEl = refs.msgs;
      const atBottom = (msgsEl.scrollTop + msgsEl.clientHeight + 6) >= msgsEl.scrollHeight;
      msgsEl.innerHTML = "";
      for (const m of conversation) {
        const row = el("div", `message ${m.role}`);
        const c = el("div", "content");
        c.innerHTML = md(m.content);
        row.appendChild(c);
        msgsEl.appendChild(row);
      }
      if (prefAutoscroll && atBottom) msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    function orderedPills(scores) {
      const order = ["accuracy","empathy","clarity","compliance","discovery","objection_handling"];
      return order
        .filter(k => k in (scores || {}))
        .map(k => `<span class="pill">${esc(k)}: ${scores[k]}</span>`)
        .join(" ");
    }

    function renderCoach() {
      const body = refs.coachBody;
      const coachPanel = refs.coach;
      if (!coachOn || currentMode === "product-knowledge") {
        coachPanel.style.display = "none";
        return;
      }
      coachPanel.style.display = "";

      const last = conversation[conversation.length - 1];
      if (!(last && last.role === "assistant" && last._coach)) {
        body.innerHTML = `<span class="muted">Awaiting the first assistant reply…</span>`;
        return;
      }
      const fb = last._coach;
      const scores = fb.scores || fb.subscores || {};
      const workedStr = (fb.worked && fb.worked.length)
        ? fb.worked.join(". ") + "."
        : "—";
      const improveStr = (fb.improve && fb.improve.length)
        ? fb.improve.join(". ") + "."
        : (fb.feedback || "—");
      body.innerHTML = `
        <div class="coach-score">Score: <strong>${fb.overall ?? fb.score ?? "—"}</strong>/100</div>
        <div class="coach-subs">${orderedPills(scores)}</div>
        <ul class="coach-list">
          <li><strong>What worked:</strong> ${esc(workedStr)}</li>
          <li><strong>What to improve:</strong> ${esc(improveStr)}</li>
          <li><strong>Suggested phrasing:</strong> ${esc(fb.phrasing || "—")}</li>
        </ul>`;
    }

    // Save visible renderers
    shell._renderMessages = renderMessages;
    shell._renderCoach = renderCoach;
    shell._renderMeta = renderMeta;

    function applyModeVisibility() {
      const lc = refs.modeSel.value;
      currentMode = LC_TO_INTERNAL[lc];
      const pk = currentMode === "product-knowledge";

      // Show diseases/HCP for sales-simulation AND role-play
      const showDiseaseHcp = (currentMode === "sales-simulation" || currentMode === "role-play");

      // coach visibility toggle for PK
      coachLabel.classList.toggle("hidden", pk);
      coachSel.classList.toggle("hidden", pk);

      // Disease/HCP
      diseaseLabel.classList.toggle("hidden", !showDiseaseHcp);
      refs.diseaseSel.classList.toggle("hidden", !showDiseaseHcp);
      hcpLabel.classList.toggle("hidden", !showDiseaseHcp);
      refs.hcpSel.classList.toggle("hidden", !showDiseaseHcp);

      // EI fields
      const showEI = currentMode === "emotional-intelligence";
      personaLabelElem.classList.toggle("hidden", !showEI);
      personaSelectElem.classList.toggle("hidden", !showEI);
      featureLabelElem.classList.toggle("hidden", !showEI);
      eiFeatureSelectElem.classList.toggle("hidden", !showEI);
      if (!showEI) feedbackDisplayElem.innerHTML = "";

      // Reset conversation on mode change to avoid cross-mode bleed
conversation = [];
if (currentMode !== "sales-simulation" && currentMode !== "role-play") currentScenarioId = null;
// Only repopulate when relevant to avoid clobbering selection in other modes
if (currentMode === "sales-simulation" || currentMode === "role-play") populateDiseases();

refs.shell._renderMessages();
refs.shell._renderCoach();
refs.shell._renderMeta();
savePrefs();

    // wire handlers
    refs.modeSel.addEventListener("change", applyModeVisibility);
    refs.diseaseSel.addEventListener("change", ()=>{
      const ds = refs.diseaseSel.value || "";
      if (!ds) return;
      populateHcpForDisease(ds);
      conversation=[]; refs.shell._renderMessages(); refs.shell._renderCoach(); refs.shell._renderMeta();
      savePrefs();
    });

    refs.hcpSel.addEventListener("change", ()=>{
      const sel = refs.hcpSel.value || "";
      if (!sel) return;
      const sc = scenariosById.get(sel);
      currentScenarioId = sc ? sc.id : null;
      conversation=[]; refs.shell._renderMessages(); refs.shell._renderCoach(); refs.shell._renderMeta();
      savePrefs();
    });

    // initial hydration
    populateDiseases();
    applyModeVisibility();

    // focus trap and initial focus
    setupFocusTrap(shell);
    setTimeout(()=> refs.ta && refs.ta.focus(), 0);

    // public for other functions
    mount._refs = refs;
  }

  // ===========================
  // EI selects hydration
  // ===========================
  function hydrateEISelects(){
    const personaSel = personaSelectElem;
    const featureSel = eiFeatureSelectElem;
    if (!personaSel || !featureSel) return;

    personaSel.innerHTML = "";
    featureSel.innerHTML = "";
    personaSel.disabled = false; featureSel.disabled = false;

    const opt = (txt, val = "") => { const o = document.createElement("option"); o.value=val; o.textContent = txt; return o; };
    personaSel.appendChild(opt("Select...", ""));
    featureSel.appendChild(opt("Select...", ""));

    const PERSONAS_ALL =
      Array.isArray(cfg?.eiProfiles) && cfg.eiProfiles.length
        ? cfg.eiProfiles
        : DEFAULT_PERSONAS;

    const FEATURES_ALL_RAW =
      (Array.isArray(cfg?.eiFeatures) && cfg.eiFeatures.length && cfg.eiFeatures) ||
      (Array.isArray(cfg?.features) && cfg.features.length && cfg.features) ||
      DEFAULT_EI_FEATURES;

    const FEATURES_ALL = FEATURES_ALL_RAW.map(f =>
      typeof f === "string"
        ? { key: f.toLowerCase().replace(/\s+/g, "-"), label: f }
        : f
    );

    PERSONAS_ALL.forEach(p => {
      const o = document.createElement("option");
      const val = p.key || p.value || p.id || String(p).toLowerCase().replace(/\s+/g, "-");
      const lab = p.label || p.name || p.title || String(p);
      o.value = val; o.textContent = lab;
      personaSel.appendChild(o);
    });

    FEATURES_ALL.forEach(f => {
      const o = document.createElement("option");
      const val = f.key || f.value || f.id || String(f).toLowerCase().replace(/\s+/g, "-");
      const lab = f.label || f.name || f.title || String(f);
      o.value = val; o.textContent = lab;
      featureSel.appendChild(o);
    });

    if (!FEATURES_ALL.length)
      console.warn("EI features list is empty; check config keys (eiFeatures/features).");
  }

  // ===========================
  // Request queue with backoff + timeout
  // ===========================
  function enqueue(task){
    return new Promise((resolve,reject)=>{
      queue.push({task,resolve,reject});
      pump();
    });
  }

  async function pump(){
    if (queueBusy) return;
    queueBusy = true;
    while (queue.length){
      const {task, resolve, reject} = queue.shift();
      try {
        const out = await task();
        resolve(out);
      } catch (e){
        reject(e);
      }
    }
    queueBusy = false;
  }

  async function withTimeout(promise, ms, controller){
    return new Promise((resolve, reject)=>{
      const t = setTimeout(()=>{ try{ controller && controller.abort(); }catch{}; reject(new Error("Timeout")); }, ms);
      promise.then(v=>{ clearTimeout(t); resolve(v); }).catch(e=>{ clearTimeout(t); reject(e); });
    });
  }

  async function backoff(fn, {retries=2, base=500}={}){
    let attempt=0;
    while(true){
      try { return await fn(); }
      catch(e){
        if (attempt >= retries) throw e;
        const wait = base * Math.pow(2, attempt) + Math.random()*200;
        await new Promise(r=>setTimeout(r, wait));
        attempt++;
      }
    }
  }

  // ===========================
  // Transport
  // ===========================
  async function callModel(messages, {timeoutMs=30000}={}){
    const url = (cfg?.apiBase || cfg?.workerUrl || window.COACH_ENDPOINT || "").trim();

    // Safe fallback if no endpoint
    if (!url){
      if (prefDebug) console.debug("[coach] no endpoint; using fallback");
      return fallbackModel(messages);
    }

    // request
    const controller = new AbortController();
    activeController = controller;
    const run = async () => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
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
    };

    try {
      const result = await withTimeout(backoff(run, {retries:2, base:600}), timeoutMs, controller);
      return result;
    } finally {
      activeController = null;
    }
  }

  // ===========================
  // Fallback model (no network)
  // ===========================
  function fallbackModel(messages){
    // Simple heuristic echo as HCP or guidance depending on mode/system cues.
    const lastUser = messages.slice().reverse().find(m => m.role === "user")?.content || "";
    const mode = currentMode;
    if (mode === "role-play"){
      const reply = "I have a few minutes. What’s your key point, and how would this help one of my next patients?";
      return `${reply}\n\n<coach>${JSON.stringify(scoreReply(lastUser, reply))}</coach>`;
    }
    if (mode === "product-knowledge"){
      const reply = "Key takeaways: focus on indication fit, safety profile, and access workflow. Check current label for specifics. Avoid off-label claims.";
      return `${reply}\n\n<coach>${JSON.stringify(scoreReply(lastUser, reply))}</coach>`;
    }
    if (mode === "emotional-intelligence"){
      const reply = "Keep it concise. Recognize the HCP’s context in one line, then ask a single clarifying question to move forward.";
      return `${reply}\n\n<coach>${JSON.stringify(scoreReply(lastUser, reply))}</coach>`;
    }
    // sales-simulation default
    const reply = "Short summary, one patient-fit point, and a direct question to end. Which patients would you consider first?";
    return `${reply}\n\n<coach>${JSON.stringify(scoreReply(lastUser, reply))}</coach>`;
  }

  // ===========================
  // Conversation helpers
  // ===========================
  function buildChatHistory(limit=16){
    // Keep up to N last exchanges to control token use
    const hist = [];
    for (let i=Math.max(0, conversation.length - limit); i<conversation.length; i++){
      const m = conversation[i];
      if (m.role === "system") continue;
      hist.push({ role: m.role, content: m.content });
    }
    return hist;
  }

  function pushUser(text){
    conversation.push({ role: "user", content: text });
    renderAll();
  }

  function pushAssistant(text, coachBlock){
    conversation.push({ role: "assistant", content: text, _coach: coachBlock });
    renderAll();
  }

  function renderAll(){
    const r = mount._refs;
    if (!r) return;
    r.shell._renderMessages();
    r.shell._renderCoach();
    r.shell._renderMeta();
  }

  function resetSession(){
    if (activeController) try { activeController.abort(); } catch {}
    conversation = [];
    renderAll();
    liveAnnounce("Session reset.");
  }

  // ===========================
  // Send message flow (debounced)
  // ===========================
  const debouncedSend = debounce((t)=>{ sendMessage(t); }, 10);

  async function sendMessage(userText) {
    const r = mount._refs;
    if (!r) return;

    lastUserMessage = userText;
    // Detect explicit evaluation command typed by user
    if (EVAL_ALIASES.some(a => userText.trim().toLowerCase().includes(a))){
      return evaluateTranscript();
    }

    pushUser(userText);
    if (currentMode === "emotional-intelligence") generateFeedback();

    const sc = scenariosById.get(currentScenarioId);
    const preface = buildPreface(currentMode, sc);

    // Messages: include systemPrompt, preface, scenario context meta, and prior chat
    const messages = [];
    if (currentMode !== "role-play" && systemPrompt) {
  messages.push({ role: "system", content: systemPrompt });
}
messages.push({ role: "system", content: preface });

    // inject minimal scenario breadcrumb for role-play and sales-simulation
    if ((currentMode === "sales-simulation" || currentMode === "role-play") && sc){
      messages.push({ role: "system", content:
        `Context: Therapeutic Area=${sc.therapeuticArea||sc.diseaseState||"—"}; HCP Role=${sc.hcpRole||"—"}; Goal=${sc.goal||"—"}; Background=${sc.background||"—"}` });
    }

    // Role Play rails
    if (currentMode === "role-play") {
      const rails =
`You are simulating a real-world conversation between a Life Sciences Sales Representative and a Healthcare Provider (HCP).
Respond ONLY as the HCP, maintaining realism, brevity, and emotional nuance.
Reflect common HCP behaviors—curiosity, skepticism, empathy, or time constraint.
If the user types "Evaluate this exchange" or "Give feedback", switch out of character and provide a concise EI-based reflection using the internal doctrine.
Avoid meta-commentary. Keep it conversational and human.`;
      messages.unshift({ role: "system", content: rails });
    }

    // EI context extras
    const sys = await EIContext.getSystemExtras().catch(()=> "");
    if (sys) messages.unshift({ role: "system", content: sys });

    // history
buildChatHistory(16).forEach(m => messages.push(m));
// add the new turn
messages.push({ role: "user", content: userText })

    try {
      const raw = await enqueue(()=> callModel(messages, {timeoutMs: 35000}));
      const { coach, clean } = extractCoach(raw);
      const computed = scoreReply(userText, clean);
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

      pushAssistant(clean, finalCoach);

      if (currentMode === "emotional-intelligence") generateFeedback();

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
      pushAssistant(`Model error: ${String(e.message || e)}`);
    }
  }

  // ===========================
  // Evaluation flow
  // ===========================
  async function evaluateTranscript(){
    const r = mount._refs;
    if (!r) return;

    const lines = [];
    for (const m of conversation){
      if (m.role === "user") lines.push(`Rep: ${m.content}`);
      else if (m.role === "assistant") lines.push(`HCP: ${m.content}`);
    }
    const convo = lines.join("\n");

    const evalPrompt =
`Evaluate this rep–HCP dialogue for: Accuracy, Compliance, Discovery, Objection Handling, Clarity, Empathy.
Return a compact summary, 3 wins, 3 priorities, and one next-step line the rep can say.
Keep it practical, label-aligned, and scenario-aware.
Then include the <coach>{...}</coach> block using the established contract with numeric subscores.`;

    const sc = scenariosById.get(currentScenarioId);
    const preface = buildPreface("sales-simulation", sc); // reuse scoring rubric

    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "system", content: preface });
    if (sc){
      messages.push({ role: "system", content:
        `Context: Therapeutic Area=${sc.therapeuticArea||sc.diseaseState||"—"}; HCP Role=${sc.hcpRole||"—"}; Goal=${sc.goal||"—"}; Background=${sc.background||"—"}` });
    }
    messages.push({ role: "user", content: evalPrompt });
    messages.push({ role: "user", content: `Dialogue:\n${convo}` });

    try {
      const raw = await enqueue(()=> callModel(messages, {timeoutMs: 45000}));
      const { coach, clean } = extractCoach(raw);
      const computed = scoreReply("Final evaluation", clean);
      const finalCoach = coach ? coach : computed;
      pushAssistant(clean, finalCoach);
      liveAnnounce("Evaluation complete.");
    } catch (e) {
      pushAssistant(`Evaluation error: ${String(e.message || e)}`);
    }
  }

  // ===========================
  // Scenarios loader
  // ===========================
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
    scenarios.forEach(s => {
      if (s.therapeuticArea) s.therapeuticArea = s.therapeuticArea.replace(/\bhiv\b/ig, "HIV");
    });
    scenariosById = new Map(scenarios.map((s)=>[s.id,s]));
  }

  // ===========================
  // EI Context shim
  // ===========================
  const EIContext = {
    async getSystemExtras(){
      try {
        // Optional external config. Safe if missing.
        if (cfg && cfg.eiSystemUrl){
          const txt = await fetchLocal(cfg.eiSystemUrl);
          if (typeof txt === "string" && txt.trim()) return txt;
        }
      } catch {}
      // Construct minimal extras from current EI persona/feature selections
      if (currentMode === "emotional-intelligence"){
        const persona = personaSelectElem?.value || "";
        const feature = eiFeatureSelectElem?.value || "";
        if (persona || feature){
          return `EI Persona=${persona||"—"}; EI Feature=${feature||"—"}; Provide brief, targeted coaching aligned to this selection.`;
        }
      }
      return "";
    }
  };

  // ===========================
  // Keyboard shortcuts help (for debug)
  // ===========================
  function appendShortcutsHelp(){
    if (!prefDebug) return;
    const p = document.createElement("div");
    p.style.fontSize = "12px";
    p.style.color = "#334155";
    p.style.padding = "0 16px 8px";
    p.innerHTML = `
      Shortcuts:
      <span class="kbd">Enter</span> send,
      <span class="kbd">Ctrl/⌘+Shift+E</span> evaluate,
      <span class="kbd">Ctrl/⌘+Shift+C</span> copy,
      <span class="kbd">Ctrl/⌘+Shift+R</span> reset,
      <span class="kbd">Alt+1..4</span> switch mode.`;
    const tb = mount.querySelector(".chat-toolbar");
    if (tb) tb.appendChild(p);
  }

  // ===========================
  // Init
  // ===========================
  async function init() {
    loadPrefs();

    try {
      try { cfg = await fetchLocal("./assets/chat/config.json"); }
      catch { cfg = await fetchLocal("./config.json"); }
    } catch (e) {
      console.error("config load failed:", e);
      cfg = { defaultMode: "sales-simulation" };
    }

    // set mode from prefs or cfg
    currentMode = currentMode || (cfg?.defaultMode || "sales-simulation");

    try {
      systemPrompt = await fetchLocal("./assets/chat/system.md");
    } catch (e) {
      console.error("system.md load failed:", e);
      systemPrompt = "";
    }

    await loadScenarios();
    buildUI();
    appendShortcutsHelp();
    mount.classList.toggle("compact", prefCompact);

    // restore persisted disease/hcp if available
    try {
      const raw = localStorage.getItem("reflectiv-coach-prefs");
      const p = raw ? JSON.parse(raw) : null;
      if (p && p.disease && mount._refs?.diseaseSel){
        const sel = mount._refs.diseaseSel;
        if ([...sel.options].some(o=>o.value===p.disease)){
          sel.value = p.disease;
          sel.dispatchEvent(new Event("change"));
        }
      }
      if (p && p.hcp && mount._refs?.hcpSel){
        const sel = mount._refs.hcpSel;
        if ([...sel.options].some(o=>o.value===p.hcp)){
          sel.value = p.hcp;
          sel.dispatchEvent(new Event("change"));
        }
      }
    } catch {}

    savePrefs();
  }

  // ===========================
  // Start
  // ===========================
  waitForMount(init);

  // ===========================
  // Expose minimal API on window for launcher buttons if needed
  // ===========================
  window.ReflectivCoach = window.ReflectivCoach || {
    open(){ try { document.getElementById("reflectiv-widget").scrollIntoView({behavior:"smooth"}); } catch {} },
    close(){ /* no-op in inline mode */ },
    reset(){ resetSession(); },
    evaluate(){ evaluateTranscript(); },
    send(text){ if (!text) return; const ta = mount?._refs?.ta; if (ta){ ta.value = text; } debouncedSend(text); }
  };

  // ===========================
  // Helpers used above but defined after to keep file cohesive
  // ===========================
  function renderAllIfReady(){
    if (!mount?._refs) return;
    mount._refs.shell._renderMessages();
    mount._refs.shell._renderCoach();
    mount._refs.shell._renderMeta();
  }

})();
