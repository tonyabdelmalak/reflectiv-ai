/*
 * ReflectivAI Chat/Coach — drop-in
 * Spec: Learning Center = ["Emotional Intelligence", "Product Knowledge", "Sales Simulation"]
 * PK => show only Disease State dropdown
 * Sales Simulation => Disease State then HCP Profiles/Scenarios for that disease
 * Hide “Coach On” when in Product Knowledge
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

  // ---------- MODE-SPECIFIC scoring fallback ----------
  function scoreReply(userText, replyText, mode) {
    const t = (replyText || "").toLowerCase();
    const words = (replyText || "").split(/\s+/).filter(Boolean).length;
    const endsWithQuestion = /\?\s*$/.test(replyText || "");
    const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));

    if (mode === "emotional-assessment") {
      const empathyCue = /(i understand|it makes sense|given your|acknowledge|appreciate|valid|thanks for|i hear)/i.test(replyText || "");
      const activeListenCue = /(reflect|notice|it sounds like|what i’m hearing|you’re saying|let’s pause|check[- ]?in)/i.test(replyText || "");
      const behaviorCue = /(try|practice|use|choose|focus|set|ask yourself|next time)/i.test(replyText || "");
      const nonJudgmentCue = /(non[- ]?judgmental|curious|open|neutral)/i.test(replyText || "");
      const containsDrugs = /(descovy|tdf|taf|biktarvy|cabenuva|cabotegravir|rilpivirine|dolutegravir|triumeq)/i.test(replyText || "");

      const question_quality = clamp(endsWithQuestion ? 3 + (activeListenCue ? 1 : 0) : 2, 1, 4);
      const empathy = clamp((empathyCue ? 3 : 2) + (nonJudgmentCue ? 1 : 0), 1, 4);
      const objection_handling = clamp((behaviorCue ? 3 : 2) + (activeListenCue ? 1 : 0), 1, 4);
      const compliance = clamp(containsDrugs ? 2 : 4, 1, 4);
      const brevityBonus = words >= 40 && words <= 140 ? 6 : words < 40 ? 2 : 0;
      const askBonus = endsWithQuestion ? 6 : 0;

      const score = clamp(Math.round(55 + question_quality*6 + empathy*6 + objection_handling*5 + compliance*5 + brevityBonus + askBonus),55,98);
      const worked = [empathyCue?"Validated emotions":null,activeListenCue?"Demonstrated active listening":null,endsWithQuestion?"Closed with a reflective question":null].filter(Boolean);
      const improve = [behaviorCue?null:"Offer one concrete, low-effort behavior",words>140?"Tighten to 3–5 sentences":null,containsDrugs?"Avoid drug or regimen references in EI mode":null].filter(Boolean);
      if(!improve.length) improve.push("Summarize in one sentence before your question");
      return {score,subscores:{question_quality,objection_handling,empathy,compliance},worked,improve,phrasing:"Given what you’re managing, what small action this week would help you feel more in control for your next HCP conversation?"};
    }

    const cues=[/renal|kidney|egfr|creatinine|crcl/,/bone|bmd|osteopor/,/label|indication|contraindication|boxed warning|guideline/,/adherence|missed[- ]dose|workflow|injection/,/resistance|drug[- ]drug|interaction|ddis?/,/coverage|prior auth|access|formulary|step[- ]?edit/,/prep|ta(f|v)|tdf|emtricitabine|bictegravir|rilpivirine|cabotegravir|biktarvy|descovy|cabenuva/];
    const hits=cues.reduce((n,re)=>n+(re.test(t)?1:0),0);
    const isSim = mode==="sales-simulation";
    const accuracy=Math.max(1,Math.min(4,Math.floor(hits/2)));
    const objection=Math.max(1,Math.min(4, /concern|barrier|risk|coverage|auth|denied|cost|workflow|adherence/i.test(t)?3+(hits>3?1:0):(hits>2?2:1)));
    const empathy=Math.max(1,Math.min(4, /understand|appreciate|given your time|brief|thanks for|let’s/i.test(t)?3:2));
    const compliance=Math.max(1,Math.min(4, /label|guideline|per label|approved/i.test(t)?3+(hits>3?1:0):2));
    const brevityBonus=words>40&&words<160?6:words<=40?2:0;
    const askBonus=endsWithQuestion?6:0;
    const base=isSim?52:50;
    const score=Math.max(55,Math.min(98,Math.round(base+accuracy*6+objection*5+empathy*4+compliance*6+brevityBonus+askBonus)));
    return {score,subscores:{question_quality:Math.max(1,Math.min(4,endsWithQuestion?3+(hits>3?1:0):2)),objection_handling:objection,empathy,compliance},worked:[hits>=3?"Grounded in relevant clinical cues":"Kept it concise",endsWithQuestion?"Ended with an engagement question":null].filter(Boolean),improve:[hits<3?"Reference renal/bone, resistance, or DDI where relevant":null,endsWithQuestion?null:"Close with a single, clear next-step ask"].filter(Boolean),phrasing:isSim?"Would aligning on criteria for eligible patients and a quick follow-up next week be helpful?":"Would it help to compare renal and bone safety differences for eligible patients?"};
  }

  // ---------- system prefaces ----------
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

    if (mode === "product-knowledge") {
      return `
Return a concise educational overview with reputable citations. Structure: key takeaways; mechanism/indications; safety/contraindications; efficacy; access notes; references.
`.trim();
    }

    return `
Provide brief, practical self-reflection tips tied to communication with HCPs. No clinical or drug guidance.
- 3–5 sentences, then one reflective question.

${COMMON}`.trim();
  }

  // ---------- UI ----------
  function buildUI() {
    mount.innerHTML = "";
    if (!mount.classList.contains("cw")) mount.classList.add("cw");

    // Injected styles additions to ensure no overlap and proper layout
    const style = document.createElement("style");
    style.textContent = `
      #reflectiv-widget .reflectiv-chat{ display:flex; flex-direction:column; gap:12px; border:3px solid #bfc7d4; border-radius:14px; background:#fff; overflow:hidden; }
      #reflectiv-widget .chat-toolbar{ display:block; padding:14px 16px; background:#f6f8fb; border-bottom:1px solid #e1e6ef; }
      #reflectiv-widget .sim-controls{ display:grid; grid-template-columns:220px 1fr 200px 1fr; gap:12px 16px; align-items:center; }
      #reflectiv-widget .sim-controls label{ font-size:13px; font-weight:600; color:#2f3a4f; justify-self:end; white-space:nowrap; }
      #reflectiv-widget .sim-controls select{ width:100%; height:38px; padding:6px 10px; font-size:14px; border:1px solid #cfd6df; border-radius:8px; background:#fff; }
      #reflectiv-widget .chat-messages{ min-height:260px; height:320px; max-height:50vh; overflow:auto; padding:12px 14px; background:#fafbfd; }
      #reflectiv-widget .message{ margin:8px 0; display:flex; }
      #reflectiv-widget .message.user{ justify-content:flex-end; }
      #reflectiv-widget .message.assistant{ justify-content:flex-start; }
      #reflectiv-widget .message .content{ max-width:85%; line-height:1.45; font-size:14px; padding:10px 12px; border-radius:14px; border:1px solid #d6dbe3; color:#0f1522; background:#e9edf3; }
      #reflectiv-widget .message.user .content{ background:#e0e0e0; color:#000; }
      #reflectiv-widget .chat-input{ display:flex; gap:8px; padding:10px 12px; border-top:1px solid #e1e6ef; background:#fff; }
      #reflectiv-widget .chat-input textarea{ flex:1; resize:none; min-height:44px; max-height:120px; padding:10px 12px; border:1px solid #cfd6df; border-radius:10px; outline:none; }
      #reflectiv-widget .chat-input .btn{ min-width:86px; border:0; border-radius:999px; background:#2f3a4f; color:#fff; font-weight:600; }
      #reflectiv-widget .coach-section{ margin-top:0; padding:12px 14px; border:1px solid #e1e6ef; border-radius:12px; background:#fffbe8; }
      #reflectiv-widget .coach-subs .pill{ display:inline-block; padding:2px 8px; margin-right:6px; font-size:12px; background:#f1f3f7; border:1px solid #d6dbe3; border-radius:999px; }
      #reflectiv-widget .scenario-meta .meta-card{ padding:10px 12px; background:#f7f9fc; border:1px solid #e1e6ef; border-radius:10px; }
      @media (max-width:900px){ #reflectiv-widget .sim-controls{ grid-template-columns:1fr; gap:8px; } #reflectiv-widget .sim-controls label{ justify-self:start; } }
      @media (max-width:520px){ #reflectiv-widget .chat-messages{ height:46vh; } }
      #reflectiv-widget .hidden{ display:none !important; }
    `;
    document.head.appendChild(style);

    const shell = el("div", "reflectiv-chat");

    // toolbar
    const bar = el("div", "chat-toolbar");
    const simControls = el("div","sim-controls");

    // Learning Center
    const lcLabel = el("label", "", "Learning Center");
    lcLabel.htmlFor = "cw-mode";
    const modeSel = el("select"); modeSel.id = "cw-mode";
    LC_OPTIONS.forEach((name) => {
      const o = el("option"); o.value = name; o.textContent = name;
      modeSel.appendChild(o);
    });
    // default mode from cfg or fallback
    const initialLc = Object.keys(LC_TO_INTERNAL).find(k => LC_TO_INTERNAL[k] === (cfg?.defaultMode || "sales-simulation")) || "Sales Simulation";
    modeSel.value = initialLc;
    currentMode = LC_TO_INTERNAL[modeSel.value];

    // Coach toggle
    const coachLabel = el("label", "", "Coach");
    coachLabel.htmlFor = "cw-coach";
    const coachSel = el("select"); coachSel.id = "cw-coach";
    [{v:"on",t:"Coach On"},{v:"off",t:"Coach Off"}].forEach(({v,t})=>{
      const o = el("option"); o.value=v; o.textContent=t; coachSel.appendChild(o);
    });
    coachSel.value = coachOn ? "on" : "off";
    coachSel.onchange = () => { coachOn = coachSel.value === "on"; renderCoach(); };

    // Disease State
    const diseaseLabel = el("label", "", "Disease State");
    diseaseLabel.htmlFor = "cw-disease";
    const diseaseSelect = el("select"); diseaseSelect.id = "cw-disease";

    // HCP Profiles / Scenarios
    const hcpLabel = el("label","","HCP Profiles");
    hcpLabel.htmlFor="cw-hcp";
    const hcpSelect = el("select"); hcpSelect.id="cw-hcp";

    // Assemble controls
    simControls.appendChild(lcLabel);    simControls.appendChild(modeSel);
    simControls.appendChild(coachLabel); simControls.appendChild(coachSel);
    simControls.appendChild(diseaseLabel); simControls.appendChild(diseaseSelect);
    simControls.appendChild(hcpLabel);     simControls.appendChild(hcpSelect);

    bar.appendChild(simControls);
    shell.appendChild(bar);

    // Meta
    const meta = el("div", "scenario-meta");
    shell.appendChild(meta);

    // Messages
    const msgs = el("div", "chat-messages");
    shell.appendChild(msgs);

    // Input
    const inp = el("div", "chat-input");
    const ta = el("textarea"); ta.placeholder = "Type your message…";
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send.click(); } });
    const send = el("button", "btn", "Send");
    send.onclick = () => { const t = ta.value.trim(); if (!t) return; sendMessage(t); ta.value = ""; };
    inp.appendChild(ta); inp.appendChild(send);
    shell.appendChild(inp);

    mount.appendChild(shell);

    // Coach section
    const coach = el("div", "coach-section");
    coach.innerHTML = `<h3>Coach Feedback</h3><div class="coach-body muted">Awaiting the first assistant reply…</div>`;
    mount.appendChild(coach);

    // helpers: populate disease states and hcp/scenario options
    function getDiseaseStates() {
      let ds = Array.isArray(cfg?.diseaseStates) ? cfg.diseaseStates.slice() : [];
      if (!ds.length && Array.isArray(scenarios) && scenarios.length){
        ds = Array.from(new Set(scenarios.map(s => (s.therapeuticArea || s.diseaseState || "").trim()))).filter(Boolean);
      }
      // normalize casing, enforce HIV uppercase
      ds = ds.map(x => x.replace(/\bHiv\b/gi,"HIV"));
      return ds;
    }

    function setSelectOptions(select, values, withPlaceholder) {
      select.innerHTML = "";
      if (withPlaceholder) {
        const p = el("option","", "Select…");
        p.value = ""; p.selected = true; p.disabled = true;
        select.appendChild(p);
      }
      values.forEach(v => {
        if (!v) return;
        const o = el("option","", typeof v === "string" ? v : (v.label || v.value));
        o.value = typeof v === "string" ? v : (v.value || v.id || v.label);
        select.appendChild(o);
      });
    }

    function populateDiseases() {
      const ds = getDiseaseStates();
      setSelectOptions(diseaseSelect, ds, true);
    }

    function populateHcpForDisease(ds) {
      // Prefer scenarios-based HCP/Scenario list when available
      const dsKey = (ds || "").trim();
      const scen = scenarios.filter(s => {
        const area = (s.therapeuticArea || s.diseaseState || "").trim();
        return area.toLowerCase() === dsKey.toLowerCase();
      });

      if (scen.length) {
        // Use scenario labels as “HCP Profiles” choices
        const opts = scen.map(s => ({ value: s.id, label: s.label || s.id }));
        setSelectOptions(hcpSelect, opts, true);
        hcpSelect.disabled = false;
      } else {
        // Fallback empty
        setSelectOptions(hcpSelect, [], true);
        hcpSelect.disabled = true;
      }
    }

    function applyModeVisibility() {
      const lc = modeSel.value;
      currentMode = LC_TO_INTERNAL[lc];

      // Hide Coach in Product Knowledge
      const pk = currentMode === "product-knowledge";
      coachLabel.classList.toggle("hidden", pk);
      coachSel.classList.toggle("hidden", pk);

      // Controls
      if (currentMode === "sales-simulation") {
        diseaseLabel.classList.remove("hidden");
        diseaseSelect.classList.remove("hidden");
        hcpLabel.classList.remove("hidden");
        hcpSelect.classList.remove("hidden");
        populateDiseases();
      } else if (currentMode === "product-knowledge") {
        diseaseLabel.classList.remove("hidden");
        diseaseSelect.classList.remove("hidden");
        hcpLabel.classList.add("hidden");
        hcpSelect.classList.add("hidden");
        populateDiseases();
      } else { // Emotional Intelligence
        diseaseLabel.classList.add("hidden");
        diseaseSelect.classList.add("hidden");
        hcpLabel.classList.add("hidden");
        hcpSelect.classList.add("hidden");
      }

      // reset selection-dependent state
      currentScenarioId = null;
      conversation = [];
      renderMessages(); renderCoach(); renderMeta();
    }

    // events
    modeSel.addEventListener("change", applyModeVisibility);

    diseaseSelect.addEventListener("change", ()=>{
      const ds = diseaseSelect.value || "";
      if (!ds) return;

      if (currentMode === "sales-simulation") {
        populateHcpForDisease(ds);
      } else if (currentMode === "product-knowledge") {
        // PK: no HCP dropdown, just set scenario context off the disease
        currentScenarioId = null;
      }

      conversation=[]; renderMessages(); renderCoach(); renderMeta();
    });

    hcpSelect.addEventListener("change", ()=>{
      const sel = hcpSelect.value || "";
      if (!sel) return;
      // map selected scenario id
      const sc = scenariosById.get(sel);
      currentScenarioId = sc ? sc.id : null;
      conversation=[]; renderMessages(); renderCoach(); renderMeta();
    });

    function renderMeta() {
      const sc = scenariosById.get(currentScenarioId);
      if (!sc || !currentScenarioId || currentMode !== "sales-simulation") { meta.innerHTML = ""; return; }
      meta.innerHTML = `
        <div class="meta-card">
          <div><strong>Therapeutic Area:</strong> ${esc(sc.therapeuticArea || sc.diseaseState || "—")}</div>
          <div><strong>HCP Role:</strong> ${esc(sc.hcpRole || "—")}</div>
          <div><strong>Background:</strong> ${esc(sc.background || "—")}</div>
          <div><strong>Today’s Goal:</strong> ${esc(sc.goal || "—")}</div>
        </div>`;
    }

    function renderMessages() {
      msgs.innerHTML = "";
      for (const m of conversation) {
        const row = el("div", `message ${m.role}`);
        const c = el("div", "content");
        c.innerHTML = md(m.content);
        row.appendChild(c);
        msgs.appendChild(row);
      }
      msgs.scrollTop = msgs.scrollHeight;
    }

    function renderCoach() {
      const body = coach.querySelector(".coach-body");
      if (!coachOn || currentMode === "product-knowledge") { coach.style.display = "none"; return; }
      coach.style.display = "";
      const last = conversation[conversation.length - 1];
      if (!(last && last.role === "assistant" && last._coach)) {
        body.innerHTML = `<span class="muted">Awaiting the first assistant reply…</span>`;
        return;
      }
      const fb = last._coach, subs = fb.subscores || {};
      body.innerHTML = `
        <div class="coach-score">Score: <strong>${fb.score ?? "—"}</strong>/100</div>
        <div class="coach-subs">${Object.entries(subs).map(([k,v])=>`<span class="pill">${esc(k)}: ${v}</span>`).join(" ")}</div>
        <ul class="coach-list">
          <li><strong>What worked:</strong> ${esc((fb.worked||[]).join(" ")||"—")}</li>
          <li><strong>What to improve:</strong> ${esc((fb.improve||[]).join(" ")||"—")}</li>
          <li><strong>Suggested phrasing:</strong> ${esc(fb.phrasing||"—")}</li>
        </ul>`;
    }

    shell._renderMessages = renderMessages;
    shell._renderCoach = renderCoach;
    shell._renderMeta = renderMeta;

    // initial visibility
    applyModeVisibility();
  }

  // ---------- transport ----------
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

  // ---------- send ----------
  async function sendMessage(userText) {
    const shell = mount.querySelector(".reflectiv-chat");
    const renderMessages = shell._renderMessages;
    const renderCoach = shell._renderCoach;

    conversation.push({ role: "user", content: userText });
    renderMessages(); renderCoach();

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
      renderMessages(); renderCoach();

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
    // Normalize HIV casing in scenarios
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

  // ---------- start ----------
  waitForMount(init);
})();
