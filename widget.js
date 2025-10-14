<script>
/*
 * ReflectivAI Chat/Coach — drop-in
 * Modes come from ./assets/chat/config.json
 * Expects:
 *   - ./assets/chat/config.json  (apiBase/workerUrl, modes, defaultMode, scenariosUrl, analyticsEndpoint)
 *   - ./assets/chat/system.md    (optional)
 *   - scenarios via config.scenariosUrl (array or {scenarios:[]})
 *
 * Relies on site styles in widget.css. No JS-injected CSS.
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
  let cfg = null;
  let systemPrompt = "";
  let scenarios = [];
  let scenariosById = new Map();

  let currentMode = "sales-simulation";
  let currentScenarioId = null;
  let conversation = [];
  let coachOn = true;

  // Disease registry for dependent dropdowns
  const DISEASE_STATES = {
    "HIV": {
      productKnowledgeMode: "hiv-product-knowledge",
      hcpRoles: ["Internal Medicine MD","Internal Medicine Doctor","Nurse Practitioner","Physician Assistant"]
    },
    "Cancer": {
      productKnowledgeMode: "oncology-product-knowledge",
      hcpRoles: ["Medical Oncologist","Nurse Practitioner","Physician Assistant"]
    },
    "Vaccines": {
      productKnowledgeMode: "vaccines-product-knowledge",
      hcpRoles: ["Infectious Disease Specialist","Nurse Practitioner","Physician Assistant"]
    },
    "COVID": {
      productKnowledgeMode: "covid-product-knowledge",
      hcpRoles: ["Pulmonologist","Nurse Practitioner","Physician Assistant"]
    },
    "Cardiovascular": {
      productKnowledgeMode: "cardio-product-knowledge",
      hcpRoles: ["Cardiologist","Nurse Practitioner","Physician Assistant"]
    }
  };

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
      const items = blk.split("\n").map((l) => l.replace(/^(?:-\s+|\*\s+)(.+)$/, "<li>$1</li>")).join("");
      return `<ul>${items}</ul>`;
    });
    return s.split(/\n{2,}/).map((p) => (p.startsWith("<ul>") ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`)).join("\n");
  }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function extractCoach(raw) {
    const m = String(raw || "").match(/<coach>([\s\S]*?)<\/coach>/i);
    if (!m) return { coach: null, clean: sanitizeLLM(raw) };
    let coach = null;
    try { coach = JSON.parse(m[1]); } catch {}
    const clean = sanitizeLLM(String(raw).replace(m[0], "").trim());
    return { coach, clean };
  }
  function normalizeMode(mode) {
    if (/product-knowledge$/i.test(mode)) return "product_knowledge";
    if (/sales-simulation/i.test(mode)) return "sales-simulation";
    return mode; // emotional-assessment etc.
  }

  // ---------- MODE-SPECIFIC scoring fallback ----------
  function scoreReply(userText, replyText, mode) {
    const norm = normalizeMode(mode);
    const t = (replyText || "").toLowerCase();
    const words = (replyText || "").split(/\s+/).filter(Boolean).length;
    const endsWithQuestion = /\?\s*$/.test(replyText || "");
    const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));

    if (norm === "emotional-assessment") {
      const empathyCue = /(i understand|it makes sense|given your|acknowledge|appreciate|valid|thanks for|i hear)/i.test(replyText || "");
      const activeListenCue = /(reflect|notice|it sounds like|what i’m hearing|you’re saying|let’s pause|check[- ]?in)/i.test(replyText || "");
      const behaviorCue = /(try|practice|use|choose|focus|set|ask yourself|next time)/i.test(replyText || "");
      const nonJudgmentCue = /(non[- ]?judgmental|curious|open|neutral)/i.test(replyText || "");

      const question_quality = clamp(endsWithQuestion ? 3 + (activeListenCue ? 1 : 0) : 2, 1, 4);
      const empathy = clamp((empathyCue ? 3 : 2) + (nonJudgmentCue ? 1 : 0), 1, 4);
      const objection_handling = clamp((behaviorCue ? 3 : 2) + (activeListenCue ? 1 : 0), 1, 4);
      const compliance = 4;
      const brevityBonus = words >= 40 && words <= 140 ? 6 : words < 40 ? 2 : 0;
      const askBonus = endsWithQuestion ? 6 : 0;

      const score = clamp(Math.round(55 + question_quality*6 + empathy*6 + objection_handling*5 + compliance*5 + brevityBonus + askBonus),55,98);
      const worked = [empathyCue?"Validated emotions":null,activeListenCue?"Active listening":null,endsWithQuestion?"Closed with a reflective question":null].filter(Boolean);
      const improve = [behaviorCue?null:"Offer one concrete, low-effort behavior",words>140?"Tighten to 3–5 sentences":null].filter(Boolean);
      if(!improve.length) improve.push("Summarize in one sentence before your question");
      return {score,subscores:{question_quality,objection_handling,empathy,compliance},worked,improve,phrasing:"Given what you’re managing, what small action this week would help you feel more in control for your next HCP conversation?"};
    }

    if (norm === "product_knowledge") {
      const labelCue = /(label|indication|contraindication|boxed warning|approved|per label)/i.test(t);
      const efficacyCue = /(efficacy|trial|study|hazard ratio|non[- ]inferior|endpoint|ci\b|p-?value)/i.test(t);
      const safetyCue = /(safety|adverse|ae\b|renal|bone|egfr|creatinine|bmd|interaction|ddis?)/i.test(t);
      const accessCue = /(coverage|prior auth|formulary|step[- ]?edit|access)/i.test(t);
      const citations = /(doi\.org|pubmed|nejm|thelancet|jama|idsa|who|cdc|fda|ema)/i.test(t);

      const question_quality = clamp(endsWithQuestion ? 3 : 2, 1, 4);
      const empathy = 2;
      const objection_handling = clamp((safetyCue?1:0)+(accessCue?1:0)+(efficacyCue?1:0),1,4);
      const compliance = clamp(2 + (labelCue?2:0),1,4);
      const brevityBonus = words > 60 && words < 180 ? 6 : words <= 60 ? 2 : 0;
      const citeBonus = citations ? 6 : 0;

      const score = clamp(Math.round(52 + question_quality*5 + objection_handling*5 + compliance*7 + brevityBonus + citeBonus),55,98);
      const worked = [labelCue?"Label-aligned":"",efficacyCue?"Included efficacy context":"",safetyCue?"Covered safety/risks":"",accessCue?"Noted access":"",citations?"Cited reputable sources":""].filter(Boolean);
      const improve = [citations?null:"Add one credible citation",endsWithQuestion?null:"Offer one prompt for next-step learning"].filter(Boolean);
      return {score,subscores:{question_quality,objection_handling,empathy,compliance},worked,improve,phrasing:"Would you like a brief summary of indications, key safety points, and a primary-source citation to review with your team?"};
    }

    // sales-simulation
    const cues=[/renal|kidney|egfr|creatinine|crcl/,/bone|bmd|osteopor/,/label|indication|contraindication|boxed warning|guideline/,/adherence|missed[- ]dose|workflow|injection/,/resistance|drug[- ]drug|interaction|ddis?/,/coverage|prior auth|access|formulary|step[- ]?edit/,/prep|ta(f|v)|tdf|emtricitabine|bictegravir|rilpivirine|cabotegravir|biktarvy|descovy|cabenuva/];
    const hits=cues.reduce((n,re)=>n+(re.test(t)?1:0),0);
    const accuracy=Math.max(1,Math.min(4,Math.floor(hits/2)));
    const objection=Math.max(1,Math.min(4, /concern|barrier|risk|coverage|auth|denied|cost|workflow|adherence/i.test(t)?3+(hits>3?1:0):(hits>2?2:1)));
    const empathy=Math.max(1,Math.min(4, /understand|appreciate|given your time|brief|thanks for|let’s/i.test(t)?3:2));
    const compliance=Math.max(1,Math.min(4, /label|guideline|per label|approved/i.test(t)?3+(hits>3?1:0):2));
    const brevityBonus=words>40&&words<160?6:words<=40?2:0;
    const askBonus=endsWithQuestion?6:0;
    const score=Math.max(55,Math.min(98,Math.round(52+accuracy*6+objection*5+empathy*4+compliance*6+brevityBonus+askBonus)));
    return {score,subscores:{question_quality:Math.max(1,Math.min(4,endsWithQuestion?3+(hits>3?1:0):2)),objection_handling:objection,empathy,compliance},worked:[hits>=3?"Grounded in relevant clinical cues":"Kept it concise",endsWithQuestion?"Ended with an engagement question":null].filter(Boolean),improve:[hits<3?"Reference renal/bone, resistance, or DDI where relevant":null,endsWithQuestion?null:"Close with a single, clear next-step ask"].filter(Boolean),phrasing:"Would aligning on criteria for eligible patients and a quick follow-up next week be helpful?"};
  }

  // ---------- system prefaces ----------
  function buildPreface(mode, sc) {
    const norm = normalizeMode(mode);
    const COMMON = `
# ReflectivAI — Output Contract
Return two parts only. No code blocks. No markdown headings.
1) Sales Guidance: short, actionable, accurate guidance.
2) <coach>{ "worked":[…], "improve":[…], "phrasing":"…", "score":int, "subscores":{"question_quality":0-4,"objection_handling":0-4,"empathy":0-4,"compliance":0-4} }</coach>
`.trim();

    if (norm === "sales-simulation") {
      return `
# Role
You are a virtual pharma coach prepping a sales rep for a 30-second interaction with an HCP. Be direct, safe, label-aligned.

# Scenario
${sc ? [
  `Therapeutic Area: ${sc.therapeuticArea || "—"}`,
  `HCP Role: ${sc.hcpRole || "—"}`,
  `Background: ${sc.background || "—"}`,
  `Today’s Goal: ${sc.goal || "—"}`
].join("\n") : ""}

# Style
- 3–6 sentences max, plus one closing question.
- Mention only appropriate, publicly known, label-aligned facts.
- No pricing advice or PHI. No off-label.

${COMMON}`.trim();
    }

    if (norm === "product_knowledge") {
      return `
Return a concise educational overview with reputable citations. Structure: key takeaways; mechanism/indications; safety/contraindications; efficacy; access notes; references. End with one clarifying question.
${COMMON}`.trim();
    }

    // emotional-assessment
    return `
Provide brief, practical self-reflection tips tied to communication with HCPs. No clinical or drug guidance.
- 3–5 sentences, then one reflective question.

${COMMON}`.trim();
  }

  // ---------- UI ----------
  function buildUI() {
    mount.innerHTML = "";
    if (!mount.classList.contains("cw")) mount.classList.add("cw");

    const shell = el("div", "reflectiv-chat");

    // toolbar
    const bar = el("div", "chat-toolbar");
    const simControls = el("div","sim-controls");

    // Mode
    const lcLabel = el("label", "", "Learning Center"); lcLabel.htmlFor = "cw-mode";
    const modeSel = el("select","select"); modeSel.id = "cw-mode";
    (cfg?.modes || []).forEach((m) => {
      const o = el("option"); o.value = m;
      o.textContent = m.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      modeSel.appendChild(o);
    });
    modeSel.value = currentMode;

    // Coach toggle
    const coachLabel = el("label", "", "Coach"); coachLabel.htmlFor = "cw-coach";
    const coachSel = el("select","select"); coachSel.id = "cw-coach";
    [{v:"on",t:"Coach On"},{v:"off",t:"Coach Off"}].forEach(({v,t})=>{
      const o = el("option"); o.value=v; o.textContent=t; coachSel.appendChild(o);
    });
    coachSel.value = coachOn ? "on" : "off";

    // Disease / Product Knowledge combined select
    const diseaseLabel = el("label", "", "Disease / Product Knowledge"); diseaseLabel.htmlFor = "cw-disease";
    const diseaseSelect = el("select","select"); diseaseSelect.id = "cw-disease";
    const defaultOpt = el("option", "", "Select…");
    defaultOpt.value = ""; defaultOpt.selected = true; defaultOpt.disabled = true;
    diseaseSelect.appendChild(defaultOpt);
    const og1 = document.createElement("optgroup"); og1.label = "Disease State";
    Object.keys(DISEASE_STATES).forEach(ds=>{
      const o=el("option","",ds); o.value=`disease::${ds}`; og1.appendChild(o);
    });
    const og2 = document.createElement("optgroup"); og2.label = "Product Knowledge";
    Object.keys(DISEASE_STATES).forEach(ds=>{
      const o=el("option","",`${ds}: Product Knowledge`); o.value=`pk::${ds}`; og2.appendChild(o);
    });
    diseaseSelect.appendChild(og1); diseaseSelect.appendChild(og2);

    // HCP Profile
    const hcpLabel = el("label","","HCP Profile"); hcpLabel.htmlFor="cw-hcp";
    const hcpSelect = el("select","select"); hcpSelect.id="cw-hcp";
    const hcpDef = el("option","","Select HCP…"); hcpDef.value=""; hcpDef.selected=true; hcpDef.disabled=true;
    hcpSelect.appendChild(hcpDef); hcpSelect.disabled = true;

    // Assemble controls
    simControls.appendChild(lcLabel);    simControls.appendChild(modeSel);
    simControls.appendChild(coachLabel); simControls.appendChild(coachSel);
    simControls.appendChild(diseaseLabel); simControls.appendChild(diseaseSelect);
    simControls.appendChild(hcpLabel);     simControls.appendChild(hcpSelect);
    bar.appendChild(simControls);
    shell.appendChild(bar);

    // meta + messages + input
    const meta = el("div", "scenario-meta"); shell.appendChild(meta);
    const msgs = el("div", "chat-messages"); shell.appendChild(msgs);

    const inp = el("div", "chat-input");
    const ta = el("textarea"); ta.placeholder = "Type your message…";
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send.click(); } });
    const send = el("button", "btn", "Send");
    send.onclick = () => { const t = ta.value.trim(); if (!t) return; sendMessage(t); ta.value = ""; };
    inp.appendChild(ta); inp.appendChild(send);
    shell.appendChild(inp);

    mount.appendChild(shell);

    // coach section
    const coach = el("div", "coach-section");
    coach.innerHTML = `<h3>Coach Feedback</h3><div class="coach-body muted">Awaiting the first assistant reply…</div>`;
    mount.appendChild(coach);

    // helpers
    function updateVisibility() {
      const norm = normalizeMode(currentMode);
      const isSim = norm === "sales-simulation";
      const isPK  = norm === "product_knowledge";

      // Disease/HCP shown only for sales-simulation
      diseaseLabel.style.display = isSim ? "" : "none";
      diseaseSelect.style.display = isSim ? "" : "none";
      hcpLabel.style.display = isSim ? "" : "none";
      hcpSelect.style.display = isSim ? "" : "none";

      // Coach hidden for product-knowledge
      const showCoach = !isPK;
      coachLabel.style.display = showCoach ? "" : "none";
      coachSel.style.display   = showCoach ? "" : "none";
      coachOn = showCoach ? (coachSel.value === "on") : false;

      // Coach panel visibility
      const coachPanel = mount.querySelector(".coach-section");
      coachPanel.style.display = coachOn ? "" : "none";
    }

    function populateHcpForDisease(ds){
      hcpSelect.innerHTML = "";
      const def = el("option","","Select HCP…"); def.value=""; def.selected=true; def.disabled=true;
      hcpSelect.appendChild(def);
      const roles = DISEASE_STATES[ds]?.hcpRoles || [];
      roles.forEach(role=>{ const o=el("option","",role); o.value=role; hcpSelect.appendChild(o); });
      hcpSelect.disabled = roles.length===0;
    }

    // events
    modeSel.onchange = () => {
      currentMode = modeSel.value;
      currentScenarioId = null;
      conversation = [];
      renderMessages(); renderCoach(); renderMeta();
      updateVisibility();
    };

    coachSel.onchange = () => { coachOn = coachSel.value === "on"; renderCoach(); updateVisibility(); };

    diseaseSelect.addEventListener("change", ()=>{
      const val = diseaseSelect.value; if(!val) return;
      const [kind, ds] = val.split("::");
      if(kind === "pk"){
        const pkMode = DISEASE_STATES[ds]?.productKnowledgeMode;
        if(pkMode && (cfg?.modes||[]).includes(pkMode)){ currentMode = pkMode; }
        modeSel.value = currentMode;
        // PK: no HCP, coach off
        hcpSelect.disabled = true; hcpSelect.value="";
      } else {
        currentMode = "sales-simulation"; modeSel.value = currentMode;
        populateHcpForDisease(ds);
      }
      conversation=[]; renderMessages(); renderCoach(); renderMeta(); updateVisibility();
    });

    hcpSelect.addEventListener("change", ()=>{
      const dsv = diseaseSelect.value.startsWith("disease::") ? diseaseSelect.value.split("::")[1] : null;
      const role = hcpSelect.value || null; if(!dsv || !role) return;
      const filtered = scenarios.filter(s => (s.therapeuticArea === dsv) && (s.hcpRole === role));
      if(filtered.length >= 1){ currentScenarioId = filtered[0].id; }
      conversation=[]; renderMessages(); renderCoach(); renderMeta();
    });

    function renderMeta() {
      const sc = scenariosById.get(currentScenarioId);
      const norm = normalizeMode(currentMode);
      if (!sc || !currentScenarioId || norm !== "sales-simulation") { meta.innerHTML = ""; return; }
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
      if (!coachOn) { coach.style.display = "none"; return; }
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

    // expose for sendMessage
    shell._renderMessages = renderMessages;
    shell._renderCoach = renderCoach;
    shell._renderMeta = renderMeta;

    renderMeta(); renderMessages(); renderCoach();
    updateVisibility();
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
        therapeuticArea: s.therapeuticArea,
        hcpRole: s.hcpRole || "",
        background: s.background || "",
        goal: s.goal || ""
      }));
    } else if (Array.isArray(cfg?.scenarios)) {
      scenarios = cfg.scenarios.map((s)=>({
        id: s.id,
        label: s.label || s.id,
        therapeuticArea: (s.therapeuticArea||"").split(" - ")[0],
        hcpRole: s.hcpRole || "",
        background: s.background || "",
        goal: s.goal || ""
      }));
    } else {
      scenarios = [];
    }
    scenariosById = new Map(scenarios.map((s)=>[s.id,s]));
  }

  // ---------- init ----------
  async function init() {
    try {
      cfg = await fetchLocal("./assets/chat/config.json");
    } catch (e) {
      console.error("config.json load failed:", e);
      cfg = { modes:["emotional-assessment","hiv-product-knowledge","sales-simulation"], defaultMode:"sales-simulation" };
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
  }

  // ---------- start ----------
  waitForMount(init);
})();
</script>
