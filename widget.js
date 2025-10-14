/* widget.js v4c — deterministic coach, EI badges, mobile-safe; keep layout unchanged */
(function () {
  // ---------- constants ----------
  const STORE_KEY = "reflectivai:coach:v4c";
  const DEFAULT_MODE = "sales-simulation"; // other: "product-knowledge"
  const COACH_VALUES = ["Coach On", "Coach Off"];
  const MODEL_NAME = "llama-3.1-8b-instant";
  const TEMP = 0.2;

  // Disease → HCP catalog
  const CATALOG = {
    "HIV": [
      { id: "im_md", label: "Internal Medicine MD", brief: "Primary care physician managing prevention and chronic care. Goal: assess PrEP suitability and adherence support." },
      { id: "np", label: "Nurse Practitioner", brief: "NP balances prevention counseling with workflow realities. Goal: clarify risk screening and follow-up cadence." },
      { id: "pa", label: "Physician Assistant", brief: "PA focuses on practical initiation steps. Goal: reduce process friction for starts and refills." },
      { id: "id", label: "Infectious Disease Specialist", brief: "Specialist prioritizes risk stratification and resistance. Goal: remain squarely on-label, cite guideline-aligned data." }
    ],
    "Cancer": [
      { id: "onco", label: "Oncologist", brief: "Treats solid and hematologic tumors. Goal: concise, on-label efficacy and safety balanced for tumor type." },
      { id: "np_onc", label: "Nurse Practitioner", brief: "Coordinates adverse event management. Goal: practical monitoring and dose-mod guidance per label." },
      { id: "pa_onc", label: "Physician Assistant", brief: "Executes protocols and logistics. Goal: ensure prior-auth and infusion flow are clear." }
    ],
    "Vaccines": [
      { id: "im_doc", label: "Internal Medicine Doctor", brief: "Manages adult immunization catch-up. Goal: eligibility, timing, and co-admin clarity." },
      { id: "np_vax", label: "Nurse Practitioner", brief: "Addresses hesitancy and access. Goal: concise risk/benefit aligned to ACIP." },
      { id: "pa_vax", label: "Physician Assistant", brief: "Focus on screening and contraindications. Goal: quick green-light criteria." }
    ],
    "COVID": [
      { id: "pulm", label: "Pulmonologist", brief: "Manages post-acute respiratory impacts. Goal: on-label data for indicated populations." },
      { id: "pa_covid", label: "Physician Assistant", brief: "Coordinates testing and triage. Goal: eligibility decision tree clarity." },
      { id: "np_covid", label: "Nurse Practitioner", brief: "Covers counseling and follow-up. Goal: clear adverse event guidance per label." }
    ],
    "Cardiovascular": [
      { id: "np_cv", label: "Nurse Practitioner", brief: "Manages risk factors and titration. Goal: crisp benefit-risk framed by guidelines." },
      { id: "im_cv", label: "Internal Medicine MD", brief: "Balances comorbidities and polypharmacy. Goal: indication fit and drug-drug awareness." }
    ]
  };

  // ---------- minimal config loader ----------
  let CFG = {
    apiBase: "",
    workerEndpoint: "",
    model: MODEL_NAME,
    stream: false,
  };
  (async function loadCfg() {
    try {
      if (window.REFLECTIV_CFG) {
        CFG = { ...CFG, ...window.REFLECTIV_CFG };
        return;
      }
      const r = await fetch("./config.json", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        CFG = { ...CFG, ...j, apiBase: j.apiBase || j.workerEndpoint || "" };
      }
    } catch (_) { /* silent */ }
  })();

  // ---------- DOM helpers ----------
  function byLabel(prefixes) {
    const all = Array.from(document.querySelectorAll("label, h2, h3, h4, p, span, strong"));
    const match = all.find(el => {
      const t = (el.textContent || "").trim().toLowerCase();
      return prefixes.some(p => t.startsWith(p));
    });
    if (!match) return null;
    // try for label->control
    if (match.tagName === "LABEL") {
      const forId = match.getAttribute("for");
      if (forId) {
        const sel = document.getElementById(forId);
        if (sel && sel.tagName === "SELECT") return sel;
      }
      // next sibling select
      const nextSel = match.parentElement && match.parentElement.querySelector("select");
      if (nextSel) return nextSel;
    }
    // look around for a select in the same section
    let scope = match.closest("section, form, .container, .field, .row") || document;
    const s = scope.querySelector("select");
    return s || null;
  }

  function ensureMessagesContainer() {
    let box = document.querySelector(".cw-messages") || document.getElementById("chat-log");
    if (box) return box;
    // safe fallback section
    const sec = document.createElement("section");
    sec.className = "cw-fallback";
    sec.innerHTML = `
      <div class="scenario-brief" aria-live="polite"></div>
      <div class="cw-messages" role="log" aria-live="polite"></div>
      <div class="coach-panel" data-hidden="true">
        <div class="coach-head">
          <strong>Coach</strong>
          <div class="ei-badges"></div>
        </div>
        <div class="coach-body"></div>
        <div class="coach-score"></div>
      </div>
    `;
    document.body.appendChild(sec);
    return sec.querySelector(".cw-messages");
  }

  function getInputElements() {
    const ta = document.querySelector(".chat-input textarea") ||
               document.getElementById("message") ||
               document.querySelector("textarea");
    let btn = document.querySelector('button[type="submit"]') ||
              document.querySelector(".chat-send");
    if (!btn) {
      btn = document.createElement("button");
      btn.className = "chat-send";
      btn.type = "button";
      btn.textContent = "Send";
      (ta && ta.parentElement ? ta.parentElement : document.body).appendChild(btn);
    }
    return { ta, btn };
  }

  function coachPanel() {
    const host = document.querySelector(".coach-panel");
    if (host) return host;
    // if fallback container created earlier, it exists; else create minimal
    const panel = document.createElement("div");
    panel.className = "coach-panel";
    panel.innerHTML = `
      <div class="coach-head">
        <strong>Coach</strong>
        <div class="ei-badges"></div>
      </div>
      <div class="coach-body"></div>
      <div class="coach-score"></div>
    `;
    (messagesEl.parentElement || document.body).appendChild(panel);
    return panel;
  }

  // ---------- state ----------
  const persisted = safeParse(localStorage.getItem(STORE_KEY)) || {};
  let mode = persisted.mode || DEFAULT_MODE;
  let coachOn = persisted.coachOn !== undefined ? persisted.coachOn : true;
  let disease = persisted.disease || "HIV";
  let hcpId = persisted.hcp || (CATALOG[disease] ? CATALOG[disease][0].id : "");
  let conversation = []; // {role:'user'|'assistant', content:string}
  let scores = { turns: [], avg: 0 };

  function persist() {
    localStorage.setItem(STORE_KEY, JSON.stringify({ mode, coachOn, disease, hcp: hcpId }));
  }

  function resetContext(keepBrief = true) {
    conversation = [];
    scores = { turns: [], avg: 0 };
    // clear coach body + score only
    const panel = coachPanel();
    const body = panel.querySelector(".coach-body");
    const badges = panel.querySelector(".ei-badges");
    const score = panel.querySelector(".coach-score");
    if (body) body.innerHTML = "";
    if (badges) badges.innerHTML = "";
    if (score) score.textContent = "";
    if (!keepBrief) {
      const brief = document.querySelector(".scenario-brief");
      if (brief) brief.innerHTML = "";
    }
  }

  // ---------- UI wiring ----------
  const messagesEl = ensureMessagesContainer();
  const { ta: inputEl, btn: sendBtn } = getInputElements();

  const modeSel = byLabel(["learning center", "mode"]);
  const coachSel = byLabel(["coach"]);
  const diseaseSel = byLabel(["disease / product knowledge", "disease state", "disease"]);
  const hcpSel = byLabel(["hcp profile", "hcp profiles / scenarios"]);

  // Populate Mode and Coach if present
  if (modeSel) {
    // enforce exactly two items
    setOptions(modeSel, [
      { v: "sales-simulation", t: "Sales Simulation" },
      { v: "product-knowledge", t: "Product Knowledge" }
    ]);
    modeSel.value = mode;
    modeSel.addEventListener("change", () => {
      mode = modeSel.value;
      persist();
      handleCoachVisibility();
      resetContext();
      updateScenarioBrief();
    });
  }

  if (coachSel) {
    setOptions(coachSel, COACH_VALUES.map(v => ({ v, t: v })));
    coachSel.value = coachOn ? "Coach On" : "Coach Off";
    coachSel.addEventListener("change", () => {
      coachOn = coachSel.value === "Coach On";
      persist();
      resetContext();
    });
  }

  // Populate Disease and HCP
  if (diseaseSel) {
    setOptions(diseaseSel, Object.keys(CATALOG).map(k => ({ v: k, t: k })));
    diseaseSel.value = disease;
    diseaseSel.addEventListener("change", () => {
      disease = diseaseSel.value;
      rehydrateHCP();
      persist();
      resetContext(false);
      updateScenarioBrief();
    });
  }

  function rehydrateHCP() {
    if (!hcpSel) return;
    const list = CATALOG[disease] || [];
    setOptions(hcpSel, list.map(item => ({ v: item.id, t: item.label })));
    // ensure valid selection
    const exists = list.some(x => x.id === hcpId);
    if (!exists) hcpId = list.length ? list[0].id : "";
    hcpSel.value = hcpId;
  }

  if (hcpSel) {
    rehydrateHCP();
    hcpSel.addEventListener("change", () => {
      hcpId = hcpSel.value;
      persist();
      resetContext(false);
      updateScenarioBrief();
    });
  }

  function handleCoachVisibility() {
    const panel = coachPanel();
    const hide = mode !== "sales-simulation";
    if (coachSel) coachSel.parentElement.style.display = hide ? "none" : "";
    panel.setAttribute("data-hidden", hide || !coachOn ? "true" : "false");
  }
  handleCoachVisibility();

  // ---------- scenario brief ----------
  function currentBrief() {
    const list = CATALOG[disease] || [];
    const found = list.find(x => x.id === hcpId) || list[0];
    return found ? found.brief : "";
  }

  function updateScenarioBrief() {
    const host = document.querySelector(".scenario-brief");
    if (!host) return;
    const list = CATALOG[disease] || [];
    const found = list.find(x => x.id === hcpId);
    const name = found ? found.label : "";
    const brief = found ? found.brief : "";
    host.innerHTML = `
      <div class="card">
        <div class="row">
          <div class="col">
            <strong>${escapeHtml(disease)}</strong> · <span>${escapeHtml(name || "HCP")}</span>
          </div>
        </div>
        <p>${escapeHtml(brief)}</p>
      </div>`;
  }
  updateScenarioBrief();

  // ---------- message rendering ----------
  function addBubble(role, text) {
    const row = document.createElement("div");
    row.className = "row";
    const b = document.createElement("div");
    b.className = "bubble " + (role === "user" ? "user" : "assistant");
    b.innerHTML = linkify(escapeHtml(text));
    row.appendChild(b);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ---------- chat flow ----------
  sendBtn?.addEventListener("click", onSend);
  inputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  });

  async function onSend() {
    const txt = (inputEl?.value || "").trim();
    if (!txt) return;
    addBubble("user", txt);
    inputEl.value = "";
    conversation.push({ role: "user", content: txt });

    const sys = await loadSystemPrimer();
    const preface = mode === "sales-simulation"
      ? `You are role-playing as an HCP in ${disease}. Use only on-label language. Keep replies concise. Scenario: ${currentBrief()}`
      : `You are answering Product Knowledge questions in ${disease}. Use only on-label language. Provide concise, source-named support when relevant.`;

    const msgs = [
      { role: "system", content: sys },
      { role: "system", content: preface },
      ...conversation
    ];

    const typing = addTyping();
    let assistant = "Upstream error. Try again.";
    try {
      assistant = await chatCall(msgs);
    } catch (_) { /* handled */ }
    removeTyping(typing);
    addBubble("assistant", assistant);
    conversation.push({ role: "assistant", content: assistant });

    if (mode === "sales-simulation" && coachOn) {
      await runCoach(txt);
    }
  }

  function addTyping() {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<div class="bubble assistant"><span class="dots"><i></i><i></i><i></i></span></div>`;
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return row;
  }
  function removeTyping(node) { if (node && node.parentNode) node.parentNode.removeChild(node); }

  // ---------- coach evaluator ----------
  async function runCoach(latestUserMsg) {
    const panel = coachPanel();
    const body = panel.querySelector(".coach-body");
    const badges = panel.querySelector(".ei-badges");
    const scoreEl = panel.querySelector(".coach-score");
    panel.setAttribute("data-hidden", "false");

    const sys = `You are a strict coaching evaluator for compliant pharma sales role-plays.
Score ONLY the user's latest message relative to the active scenario.
Rubric 0–5: accuracy, compliance, discovery, objection, value, empathy, clarity.
If any compliance or accuracy risk exists, set that dimension to 0.
Return pure JSON (no preface):
{
  "feedback_html": "<p>...</p>",
  "rubric": {"accuracy":0-5,"compliance":0-5,"discovery":0-5,"objection":0-5,"value":0-5,"empathy":0-5,"clarity":0-5},
  "ei": {"empathy_score":0-5,"tone_label":"supportive|neutral|transactional","evidence_quote":"4–18 word excerpt"}
}
feedback_html must include sections Tone, What worked, Tighten, Suggested rewrite, tailored to THIS message and scenario.`;

    const scenarioCtx = `Disease: ${disease}. HCP: ${(CATALOG[disease]||[]).find(x=>x.id===hcpId)?.label||"HCP"}.
Brief: ${currentBrief()}
User message: """${latestUserMsg}"""`;

    const evalMsgs = [
      { role: "system", content: sys },
      { role: "user", content: scenarioCtx }
    ];

    let out = null;
    try {
      const raw = await chatCall(evalMsgs);
      out = looseJson(raw);
      if (!out) {
        // retry once
        const raw2 = await chatCall(evalMsgs);
        out = looseJson(raw2);
      }
    } catch (_) { /* handled */ }

    if (!out || !out.rubric || !out.ei) {
      body.innerHTML = `<div class="coach-card"><p>Coach unavailable. Using neutral fallback.</p><ul><li>Lead with on-label, fair-balance language.</li><li>Ask one clarifying question.</li><li>Close with clear next step.</li></ul></div>`;
      badges.innerHTML = "";
      scoreEl.textContent = "";
      return;
    }

    // hard-fail notice
    const fail = (out.rubric.accuracy === 0 || out.rubric.compliance === 0);
    const weights = { accuracy:3, compliance:3, discovery:2, objection:2, value:2, empathy:1, clarity:1 };
    const sum = Object.entries(out.rubric).reduce((a,[k,v]) => a + (v * (weights[k]||0)), 0);
    const turnScore = Math.round(((sum / 70) * 10) * 10) / 10;
    scores.turns.push(turnScore);
    const avg = Math.round((scores.turns.reduce((a,b)=>a+b,0) / scores.turns.length) * 10) / 10;
    scores.avg = isFinite(avg) ? avg : 0;

    const alertHtml = fail ? `<div class="coach-alert">Compliance/Accuracy risk detected — lead with on-label, fair-balance language.</div>` : "";

    body.innerHTML = `
      <div class="coach-card">
        ${alertHtml}
        ${sanitizeHtml(out.feedback_html)}
      </div>
    `;

    badges.innerHTML = `
      <span class="chip tone-${escapeHtml(out.ei.tone_label||'neutral')}">${escapeHtml(cap(out.ei.tone_label||'neutral'))}</span>
      <span class="chip emp">Empathy ${num(out.ei.empathy_score)}/5</span>
      <span class="snippet">“${escapeHtml(out.ei.evidence_quote||"") }”</span>
    `;
    scoreEl.textContent = `Score — Turn: ${turnScore.toFixed(1)} | Avg: ${scores.avg.toFixed(1)}`;
  }

  // ---------- API calls ----------
  async function chatCall(messages) {
    const url = CFG.apiBase || CFG.workerEndpoint;
    if (!url) throw new Error("No API endpoint configured.");
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: CFG.model || MODEL_NAME,
        temperature: TEMP,
        messages
      })
    });
    if (!res.ok) throw new Error("Upstream error");
    const data = await res.json().catch(()=>null);
    // expect { content } or OpenAI-like { choices[0].message.content }
    const content = data?.content ||
                    data?.choices?.[0]?.message?.content ||
                    data?.output_text ||
                    "";
    if (!content) throw new Error("Empty response");
    return String(content);
  }

  // ---------- system primer loader ----------
  async function loadSystemPrimer() {
    try {
      const r = await fetch("assets/chat/system.md", { cache: "no-store" });
      if (r.ok) return await r.text();
    } catch(_) { /* ignore */ }
    return "You are a compliant, on-label pharma conversational agent. Avoid PHI. Provide concise, balanced information.";
  }

  // ---------- utilities ----------
  function setOptions(sel, items) {
    if (!sel) return;
    const v = sel.value;
    sel.innerHTML = items.map(o => `<option value="${escapeAttr(o.v)}">${escapeHtml(o.t)}</option>`).join("");
    if (items.some(o => o.v === v)) sel.value = v;
  }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function escapeAttr(s){ return escapeHtml(s).replace(/"/g, "&quot;"); }
  function cap(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : ""; }
  function num(x){ return Math.max(0, Math.min(5, Number(x)||0)).toFixed(1).replace(/\.0$/,""); }
  function linkify(t){
    return t.replace(/(https?:\/\/[^\s)]+)|(www\.[^\s)]+)/g, m => `<a href="${m.startsWith('http')?m:'https://'+m}" target="_blank" rel="noopener">${m}</a>`);
  }
  function looseJson(text) {
    if (!text) return null;
    // try direct parse
    try { return JSON.parse(text); } catch {}
    // try to extract first {...}
    const i = text.indexOf("{");
    const j = text.lastIndexOf("}");
    if (i>=0 && j>i) {
      try { return JSON.parse(text.slice(i, j+1)); } catch {}
    }
    return null;
  }
  function sanitizeHtml(s) {
    // allow basic tags used in feedback_html
    const div = document.createElement("div");
    div.innerHTML = s || "";
    // strip scripts and styles
    div.querySelectorAll("script,style,iframe,object").forEach(n=>n.remove());
    // remove event handlers
    div.querySelectorAll("*").forEach(el=>{
      [...el.attributes].forEach(a=>{ if (a.name.startsWith("on")) el.removeAttribute(a.name); });
    });
    return div.innerHTML;
  }
  function safeParse(s){ try { return JSON.parse(s); } catch { return null; } }

  // ---------- messaging & EI microcopy hooks ----------
  // Subtle copy to set relational framing on load (no layout change)
  (function seedEIIntro() {
    const panel = coachPanel();
    const body = panel.querySelector(".coach-body");
    if (!body.innerHTML) {
      body.innerHTML = `<div class="coach-card muted">
        <p><strong>Coach is listening for tone.</strong> You’ll see tips on empathy, clarity, and objection handling as you practice.</p>
        <ul><li>Ask one clarifying question before recommending.</li><li>Mirror the HCP’s concern in your own words.</li><li>Close with a next step agreed by both.</li></ul>
      </div>`;
    }
    const badges = panel.querySelector(".ei-badges");
    if (badges && !badges.innerHTML) {
      badges.innerHTML = `<span class="chip">Empathy 0/5</span><span class="chip tone-neutral">Neutral</span>`;
    }
    handleCoachVisibility();
  })();

  // expose minimal for debugging without logs
  window.__ReflectivWidgetV4c = { resetContext, persist };
})();
