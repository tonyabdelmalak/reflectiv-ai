
/* ReflectivAI Chat Widget â€” Full Drop-in Replacement with Scoring and Feedback Toggle */

/* CSS Variables for theming */
:root {
  --cw-accent: #2f3a4f;
  --cw-btn: #253044;
  --cw-radius: 14px;
  --cw-bg: #fff;
  --cw-muted: #6b7280;
  --cw-line: #e5e7eb;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
}

.cw {
  box-sizing: border-box;
}

.cw .hidden {
  display: none !important;
}

.cw .cw-shell {
  border: 1px solid rgba(0, 0, 0, .12);
  border-radius: var(--cw-radius);
  background: var(--cw-bg);
  overflow: hidden;
}

/* Chat Widget Shell */
.reflectiv-chat {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid #d6dbe3;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}

/* Toolbar and Controls Layout */
.chat-toolbar {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  align-items: end;
  padding: 10px;
  background: #f7f9fc;
  border-bottom: 1px solid #e5e9f0;
}

/* Dropdown Controls for Mode, Therapeutic Area, HCP Profile */
.sim-controls {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  align-items: end;
}

.sim-controls label {
  font-size: 14px;
  color: var(--cw-muted);
}

.sim-controls select {
  padding: 8px;
  font-size: 14px;
  border: 1px solid var(--cw-line);
  border-radius: 8px;
}

/* Scenario Feedback Toggle */
.feedback-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
}

.feedback-toggle label {
  font-size: 14px;
}

.feedback-toggle input[type="checkbox"] {
  transform: scale(1.2);
}

/* Coach Feedback Section */
.coach-feedback {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  background: #f7f9fc;
  border-top: 1px solid #e5e9f0;
}

.coach-feedback h3 {
  font-size: 18px;
  margin-bottom: 8px;
}

.coach-feedback p {
  font-size: 14px;
  line-height: 1.6;
}

.coach-feedback .feedback-message {
  background: var(--cw-btn);
  color: #fff;
  padding: 8px;
  border-radius: 8px;
  font-size: 14px;
}

.coach-feedback .feedback-message span {
  font-weight: bold;
}

.coach-feedback .feedback-message.emp-score {
  background: #ffcc00;
}

.coach-feedback .feedback-message.clarity-score {
  background: #4caf50;
}

.coach-feedback .feedback-message.objection-score {
  background: #e53935;
}

/* Widget Shell Controls */
.chat-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: #f7f9fc;
  border-top: 1px solid #e5e9f0;
}

.chat-controls .btn {
  padding: 8px 16px;
  background-color: var(--cw-btn);
  color: white;
  border-radius: 8px;
  cursor: pointer;
}

.chat-controls .btn:hover {
  background-color: #3457b1;
}

/* Chat message and interaction input area */
.chat-input {
  padding: 12px;
  font-size: 14px;
  border: 1px solid var(--cw-line);
  border-radius: 8px;
  background: #f7f9fc;
  color: var(--cw-muted);
}

.chat-message {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chat-message .msg {
  padding: 8px;
  background: #e5e9f0;
  border-radius: 8px;
  color: var(--cw-muted);
  font-size: 14px;
}

.chat-message .msg.agent {
  background: #4caf50;
  color: #fff;
}

/* Feedback Scoring Styles (Dynamic) */
.emp-score {
  background: #ffcc00;
}

.clarity-score {
  background: #4caf50;
}

.objection-score {
  background: #e53935;
}

.cw .coach-feedback.hidden {
  display: none;
}

// ---------- safe bootstrapping ----------
(function () {
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
    s = s.replace(/^\s*(hi|hello|hey)[^
]*
+/i, "");
    s = s.replace(/
{3,}/g, "

").trim();
    return s;
  }

  function md(text) {
    if (!text) return "";
    let s = esc(text).replace(/
?/g, "
");
    s = s.replace(/\*\*([^*
]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/^(?:-\s+|\*\s+).+(?:
(?:-\s+|\*\s+).+)*/gm, (blk) => {
      const items = blk
        .split("
")
        .map((l) => l.replace(/^(?:-\s+|\*\s+)(.+)$/, "<li>$1</li>"))
        .join("");
      return `<ul>${items}</ul>`;
    });
    return s
        .split(/
{2,}/)
        .map((p) => (p.startsWith("<ul>") ? p : `<p>${p.replace(/
/g, "<br>")}</p>`))
        .join("
");
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------- local scoring fallback (coach-v3 deterministic) ----------
  function scoreReply(userText, replyText) {
    const text = String(replyText || "");
    const t = text.toLowerCase();
    const words = text.split(/\s+/).filter(Boolean).length;
    const endsWithQ = /\?\s*$/.test(text);
    const inRange = (n, a, b) => n >= a && n <= b;

    const sig = {
        label: /(per label|fda\s*label|indication|contraindication|boxed warning|guideline|fda)/i.test(text),
        discovery: endsWithQ || /(how|what|could you|can you|help me understand|walk me|clarify)/i.test(t),
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
        sig.tooLong ? "Tighten to 3â€“5 sentences" : null,
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
