/*
 * ReflectivAI Chat/Coach — FULL DROP-IN widget.js
 * Implements:
 * 1) Persona panel mapping: shows Therapeutic Area, HCP, Background, Today’s Goal.
 *    - HCP comes from persona fields: hcp_role|hcpRole|hcp|role, or parsed from id/key.
 *    - Background prefers: background|personaBackground|notes; or parsed “Decile #”.
 * 2) Coach Feedback metric labels aligned to 5 analytics:
 *    Empathy Index, Accuracy Index, Confidence Delta, Compliance Guard, Readiness Velocity.
 *    - Accepts old keys and remaps. Missing values render as "N/A".
 *
 * Preserves existing behaviors: config load, scenarios load, dropdown wiring,
 * chat send, streaming optional, coach on/off, analytics beacon.
 */

(function () {
  // ----------------------------
  // Boot helpers
  // ----------------------------
  let mount = null;
  function onReady(fn){
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once:true });
    } else { fn(); }
  }
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

  // ----------------------------
  // State
  // ----------------------------
  const S = {
    cfg: null,
    scenarios: [],
    scenarioByKey: new Map(),
    ui: {},
    chat: [],
    coachOn: true,
    mode: "",
    disease: "",
    profileKey: "",
    systemPrompt: "",
    controller: null
  };

  // ----------------------------
  // Utilities
  // ----------------------------
  const q = (el, s) => el.querySelector(s);
  const qa = (el, s) => Array.from(el.querySelectorAll(s));
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  async function safeFetch(url, init){
    const r = await fetch(url, init);
    if (!r.ok) throw new Error(`${init?.method||"GET"} ${url} ${r.status}`);
    return r;
  }
  function debounce(fn, ms){
    let t = 0;
    return (...a)=>{ clearTimeout(t); t = setTimeout(()=>fn(...a), ms); };
  }
  function title(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : ""; }

  // ----------------------------
  // Config + data loading
  // ----------------------------
  async function loadConfig() {
    const cfgHref = (mount.getAttribute("data-config") || "./assets/chat/config.json");
    const r = await safeFetch(cfgHref);
    const cfg = await r.json();
    S.cfg = cfg;
    S.mode = cfg.defaultMode || (cfg.modes && cfg.modes[0]) || "sales-simulation";
    S.coachOn = cfg.ui?.showCoach !== false;
    return cfg;
  }

  async function loadScenarios() {
    const url = S.cfg.scenariosUrl || "./assets/chat/data/scenarios.json";
    const r = await safeFetch(url);
    const arr = await r.json();
    S.scenarios = Array.isArray(arr) ? arr : (arr.scenarios || []);
    S.scenarioByKey.clear();
    for (const s of S.scenarios) {
      const key = scenarioKey(s);
      S.scenarioByKey.set(key, s);
    }
  }

  function scenarioKey(s){
    return (
      s.key || s.id || [
        (s.therapeuticArea || s.area || s.ta || "unknown").toString().toLowerCase().replace(/\s+/g,'_'),
        (s.hcp_role || s.hcpRole || s.hcp || s.role || "hcp").toString().toLowerCase().replace(/\s+/g,''),
        (s.decile || s.background || "bg").toString().toLowerCase().replace(/\s+/g,'')
      ].join("__")
    );
  }

  // ----------------------------
  // Persona extractors
  // ----------------------------
  function extractHcpRole(s, fallbackKey) {
    let v = s.hcp_role || s.hcpRole || s.hcp || s.role || "";
    if (!v && (s.persona || s.profile)) {
      v = s.persona?.hcp_role || s.persona?.role || s.profile?.hcp_role || s.profile?.role || "";
    }
    if (!v && fallbackKey) {
      // parse tokens like "hiv_im_decile3_prep_lowshare"
      const im = fallbackKey.match(/(^|_)im(_|$)/i);
      const fm = fallbackKey.match(/(^|_)fm(_|$)/i);
      const idm = fallbackKey.match(/(^|_)id(_|$)/i);
      if (im) v = "IM";
      else if (fm) v = "FM";
      else if (idm) v = "ID";
    }
    return v ? v.toString().toUpperCase() : "—";
  }

  function extractBackground(s, fallbackKey) {
    // Prefer explicit fields
    let bg = s.decile || s.background || s.personaBackground || s.notes || "";
    // Normalize common patterns
    if (/^decile\s*\d+/i.test(bg)) {
      const n = bg.match(/decile\s*\d+/i)[0];
      return title(n.toLowerCase()); // "Decile 3"
    }
    if (/^d\d+$/i.test(bg)) {
      return "Decile " + bg.replace(/[^0-9]/g, "");
    }
    // Try parse from key like "...decile3..."
    if (!bg && fallbackKey) {
      const m = fallbackKey.match(/decile\s*([0-9])/i) || fallbackKey.match(/decile([0-9])/i);
      if (m) return "Decile " + m[1];
    }
    // Last resort
    if (!bg && s.persona && typeof s.persona === "object") {
      if (typeof s.persona.decile === "number") return "Decile " + s.persona.decile;
      if (typeof s.persona.decile === "string") {
        const mm = s.persona.decile.match(/\d+/);
        if (mm) return "Decile " + mm[0];
      }
    }
    return bg ? String(bg) : "—";
  }

  function extractGoal(s) {
    return s.goal || s.todayGoal || s.objective || s.persona?.goal || "—";
  }

  function extractTherapeuticArea(s) {
    return s.therapeuticArea || s.area || s.ta || "—";
  }

  // ----------------------------
  // UI build
  // ----------------------------
  function buildUI(){
    mount.innerHTML = "";

    const shell = el("div","cw cw-shell");
    shell.style.borderRadius = "14px";

    // Controls
    const controls = el("div","cw cw-controls");
    controls.innerHTML = `
      <div class="cw-field">
        <label>Learning Center</label>
        <select id="cwMode"></select>
      </div>
      <div class="cw-field">
        <label>Coach</label>
        <select id="cwCoachToggle">
          <option value="on">Coach On</option>
          <option value="off">Coach Off</option>
        </select>
      </div>
      <div class="cw-field">
        <label>Disease State</label>
        <select id="cwDisease"></select>
      </div>
      <div class="cw-field">
        <label>HCP Profiles</label>
        <select id="cwProfile"></select>
      </div>
    `;

    // Persona summary panel
    const persona = el("div","cw persona");
    persona.innerHTML = `
      <div class="cw-card">
        <div class="cw-card-title">Scenario</div>
        <div class="cw-kv"><span>Therapeutic Area:</span><b id="kvArea">—</b></div>
        <div class="cw-kv"><span>HCP:</span><b id="kvHcp">—</b></div>
        <div class="cw-kv"><span>Background:</span><b id="kvBg">—</b></div>
        <div class="cw-kv"><span>Today’s Goal:</span><b id="kvGoal">—</b></div>
      </div>
    `;

    // Transcript
    const transcript = el("div","cw transcript");
    transcript.innerHTML = `
      <div id="cwStream" class="cw-stream" aria-live="polite"></div>
      <div class="cw-input">
        <textarea id="cwMsg" rows="2" placeholder="Type your message…"></textarea>
        <button id="cwSend" type="button">Send</button>
      </div>
      <div id="cwCoach" class="cw-coach cw-card soft">
        <div class="cw-card-title">Coach Feedback</div>
        <div id="cwScore" class="cw-score">Score: —</div>
        <div id="cwTags" class="cw-tags"></div>
        <ul id="cwBullets" class="cw-bullets"></ul>
      </div>
    `;

    shell.appendChild(controls);
    shell.appendChild(persona);
    shell.appendChild(transcript);
    mount.appendChild(shell);

    // Store refs
    S.ui.mode = q(mount, "#cwMode");
    S.ui.coach = q(mount, "#cwCoachToggle");
    S.ui.disease = q(mount, "#cwDisease");
    S.ui.profile = q(mount, "#cwProfile");

    S.ui.kvArea = q(mount, "#kvArea");
    S.ui.kvHcp  = q(mount, "#kvHcp");
    S.ui.kvBg   = q(mount, "#kvBg");
    S.ui.kvGoal = q(mount, "#kvGoal");

    S.ui.stream = q(mount, "#cwStream");
    S.ui.msg = q(mount, "#cwMsg");
    S.ui.send = q(mount, "#cwSend");

    S.ui.coachCard = q(mount, "#cwCoach");
    S.ui.score = q(mount, "#cwScore");
    S.ui.tags = q(mount, "#cwTags");
    S.ui.bullets = q(mount, "#cwBullets");

    // Populate controls
    fillModes();
    fillDisease();
    fillProfilesForDisease();
    applyPersonaPanel();

    // Wire events
    S.ui.mode.addEventListener("change", () => {
      S.mode = S.ui.mode.value;
    });

    S.ui.coach.value = S.coachOn ? "on" : "off";
    S.ui.coach.addEventListener("change", () => {
      S.coachOn = S.ui.coach.value === "on";
      S.ui.coachCard.style.display = S.coachOn ? "" : "none";
    });
    S.ui.coachCard.style.display = S.coachOn ? "" : "none";

    S.ui.disease.addEventListener("change", () => {
      S.disease = S.ui.disease.value;
      fillProfilesForDisease();
      applyPersonaPanel();
    });

    S.ui.profile.addEventListener("change", () => {
      S.profileKey = S.ui.profile.value;
      applyPersonaPanel();
    });

    S.ui.send.addEventListener("click", onSend);
    S.ui.msg.addEventListener("keydown", (e)=>{
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
    });
  }

  function fillModes(){
    const modes = Array.isArray(S.cfg.modes) ? S.cfg.modes : [S.mode];
    S.ui.mode.innerHTML = modes.map(m=>`<option value="${m}">${labelMode(m)}</option>`).join("");
    S.ui.mode.value = S.mode;
  }
  function labelMode(m){
    if (m === "sales-simulation") return "Sales Simulation";
    if (m === "emotional-assessment") return "Emotional Assessment";
    if (m.includes("product")) return "Product Knowledge";
    return title(m.replace(/[-_]/g," "));
  }

  function fillDisease(){
    const diseases = unique(S.scenarios.map(s=>String(extractTherapeuticArea(s))));
    S.ui.disease.innerHTML = diseases.map(d=>`<option value="${d}">${d}</option>`).join("");
    // Preserve previous selection if valid
    if (S.disease && diseases.includes(S.disease)) {
      S.ui.disease.value = S.disease;
    } else {
      S.disease = S.ui.disease.value || diseases[0] || "";
    }
  }

  function fillProfilesForDisease(){
    const list = S.scenarios.filter(s => String(extractTherapeuticArea(s)) === S.disease);
    S.ui.profile.innerHTML = list.map(s=>{
      const key = scenarioKey(s);
      const label = s.name || s.title || key;
      return `<option value="${key}">${label}</option>`;
    }).join("");
    if (list.length) {
      const firstKey = scenarioKey(list[0]);
      if (!S.profileKey || !list.some(s=>scenarioKey(s)===S.profileKey)) {
        S.profileKey = firstKey;
      }
      S.ui.profile.value = S.profileKey;
    } else {
      S.profileKey = "";
    }
  }

  function applyPersonaPanel(){
    const s = S.scenarioByKey.get(S.profileKey) || S.scenarios.find(x => String(extractTherapeuticArea(x)) === S.disease) || null;
    if (!s) return;
    const key = scenarioKey(s);
    const ta  = extractTherapeuticArea(s);
    const hcp = extractHcpRole(s, key);
    const bg  = extractBackground(s, key);
    const goal= extractGoal(s);

    S.ui.kvArea.textContent = ta || "—";
    S.ui.kvHcp.textContent  = hcp || "—";
    S.ui.kvBg.textContent   = bg || "—";
    S.ui.kvGoal.textContent = goal || "—";
  }

  function unique(arr){ return Array.from(new Set(arr)); }

  // ----------------------------
  // Chat rendering
  // ----------------------------
  function pushBubble(role, text){
    const wrap = el("div", `cw-bubble ${role}`);
    wrap.innerHTML = `<div class="cw-b">${escapeHtml(text)}</div>`;
    S.ui.stream.appendChild(wrap);
    S.ui.stream.scrollTop = S.ui.stream.scrollHeight;
  }
  function escapeHtml(s){
    return String(s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  // ----------------------------
  // Send logic
  // ----------------------------
  async function onSend(){
    const msg = S.ui.msg.value.trim();
    if (!msg) return;
    S.ui.msg.value = "";
    pushBubble("user", msg);

    // Compose payload
    const scenario = S.scenarioByKey.get(S.profileKey) || null;
    const personaCard = {
      therapeutic_area: extractTherapeuticArea(scenario || {}),
      hcp: extractHcpRole(scenario || {}, scenarioKey(scenario || { key: "" })),
      background: extractBackground(scenario || {}, scenarioKey(scenario || { key: "" })),
      goal: extractGoal(scenario || {})
    };

    const payload = {
      mode: S.mode,
      message: msg,
      coach: S.coachOn ? "on" : "off",
      persona: personaCard,
      context: { profileKey: S.profileKey, disease: S.disease },
      stream: !!S.cfg.stream
    };

    try {
      S.controller?.abort?.();
      S.controller = new AbortController();

      const r = await safeFetch((S.cfg.apiBase || S.cfg.workerUrl || "/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: S.controller.signal
      });

      // Accept both streaming=false JSON and text
      const ct = r.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const data = await r.json();
        handleAssistantMessage(data);
      } else {
        const text = await r.text();
        handleAssistantMessage({ text });
      }
    } catch (err) {
      handleAssistantMessage({ text: "Error contacting model.", error: String(err) });
    }
  }

  function handleAssistantMessage(res){
    const text = res.text || res.reply || res.message || "";
    pushBubble("assistant", text || "—");

    // Feedback panel population
    if (S.coachOn) {
      const metrics = computeAlignedMetrics(res);
      renderCoach(metrics, res.feedback);
      // optional analytics beacon
      postCoachMetrics(metrics);
    }
  }

  // ----------------------------
  // Metrics alignment
  // ----------------------------
  const METRIC_ORDER = [
    "Empathy Index",
    "Accuracy Index",
    "Confidence Delta",
    "Compliance Guard",
    "Readiness Velocity"
  ];

  function computeAlignedMetrics(res){
    // Accept shapes:
    // res.metrics  or  res.feedback.metrics  or  res.scores
    const raw = res.metrics || res.feedback?.metrics || res.scores || res.feedback || {};
    const m = {};

    // Map old keys -> new names
    const mapPairs = [
      // empathy
      [["empathy_index","empathy","rapport","tone"], "Empathy Index"],
      // accuracy
      [["accuracy_index","accuracy","medical_precision","regulatory_precision"], "Accuracy Index"],
      // confidence delta
      [["confidence_delta","confidence_gap","self_assessment_gap","question_quality"], "Confidence Delta"],
      // compliance
      [["compliance_guard","compliance","risk"], "Compliance Guard"],
      // readiness velocity
      [["readiness_velocity","readiness","velocity","ramp_speed"], "Readiness Velocity"],
    ];

    for (const [keys, label] of mapPairs) {
      let val = undefined;
      for (const k of keys) {
        if (raw && raw[k] != null) { val = raw[k]; break; }
        if (raw && typeof raw === "object") {
          // Some servers return arrays of {name,score}
          const arrHit = Array.isArray(raw)
            ? raw.find(o => (o.name||o.label||"").toLowerCase().replace(/\s+/g,'_') === k)
            : null;
          if (arrHit) { val = arrHit.score ?? arrHit.value; break; }
        }
      }
      if (typeof val === "object" && val?.value != null) val = val.value;
      if (typeof val === "string" && /^\d+(\.\d+)?$/.test(val)) val = Number(val);
      m[label] = (val != null) ? val : "N/A";
    }

    // Score 0-100 if provided
    let total = res.score ?? res.feedback?.score ?? res.metrics?.total ?? null;
    if (total == null) {
      // compute naive if numeric submetrics available
      const nums = METRIC_ORDER.map(k => typeof m[k] === "number" ? m[k] : null).filter(v=>v!=null);
      if (nums.length) {
        const mean5 = (nums.reduce((a,b)=>a+b,0) / nums.length);
        // Normalize if on 0..5 scale
        total = mean5 <= 5 ? Math.round(mean5/5*100) : Math.round(mean5);
      }
    }
    return { metrics: m, total: total==null ? "—" : `${total}/100` };
  }

  function renderCoach(aligned, feedback){
    S.ui.score.textContent = `Score: ${aligned.total}`;
    // tags
    S.ui.tags.innerHTML = "";
    for (const name of METRIC_ORDER) {
      const v = aligned.metrics[name];
      const chip = el("span","cw-chip", `${name.replace(/\s+/g,'_').toLowerCase()}: ${v}`);
      S.ui.tags.appendChild(chip);
    }
    // bullets
    S.ui.bullets.innerHTML = "";
    const bullets = [
      feedback?.positives || feedback?.what_worked,
      feedback?.improvements || feedback?.what_to_improve,
      feedback?.suggested || feedback?.suggested_phrasing || feedback?.phrasing
    ].flat().filter(Boolean);

    const labels = ["What worked:", "What to improve:", "Suggested phrasing:"];
    for (let i=0;i<3;i++){
      const text = typeof bullets[i] === "string" ? bullets[i] : null;
      if (!text) continue;
      const li = el("li","");
      li.textContent = `${labels[i]} ${text}`;
      S.ui.bullets.appendChild(li);
    }
  }

  function postCoachMetrics(aligned){
    const url = S.cfg.analyticsEndpoint;
    if (!url) return;
    try {
      const body = {
        ts: Date.now(),
        mode: S.mode,
        disease: S.disease,
        profileKey: S.profileKey,
        metrics: aligned.metrics,
        total: aligned.total
      };
      navigator.sendBeacon?.(url, new Blob([JSON.stringify(body)], { type:"application/json" }));
    } catch (_) {}
  }

  // ----------------------------
  // Init sequence
  // ----------------------------
  async function init(){
    await loadConfig();
    await loadScenarios();
    buildUI();
  }

  waitForMount(init);

  // ----------------------------
  // Minimal styles (kept in JS so this file is self-contained)
  // ----------------------------
  const css = `
.cw{ --cw-accent:#2f3a4f; --cw-line:#e5e7eb; --cw-muted:#6b7280; font-family: system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; }
.cw *{ box-sizing:border-box; }
.cw.cw-shell{ border:1px solid rgba(0,0,0,.12); border-radius:14px; background:#fff; overflow:hidden; }
.cw .cw-controls{ display:grid; grid-template-columns:1fr; gap:8px; padding:12px; border-bottom:1px solid var(--cw-line); background:#f8fafc; }
@media(min-width:720px){ .cw .cw-controls{ grid-template-columns:repeat(4,1fr); } }
.cw .cw-field label{ display:block; font-size:12px; color:var(--cw-muted); margin:0 0 4px; }
.cw .cw-field select{ width:100%; padding:10px 12px; border:1px solid var(--cw-line); border-radius:10px; background:#fff; }
.cw .cw-card{ margin:12px; padding:12px; border:1px solid var(--cw-line); border-radius:12px; background:#fff; }
.cw .cw-card.soft{ background:#fff8dc; }
.cw .cw-card-title{ font-weight:700; color:#1f2937; margin-bottom:8px; }
.cw .cw-kv{ display:flex; gap:8px; padding:4px 0; }
.cw .cw-kv span{ width:160px; color:#374151; }
.cw .cw-kv b{ color:#111827; font-weight:600; }
.cw .cw-stream{ max-height:320px; overflow:auto; padding:12px; }
.cw .cw-bubble{ display:flex; margin:8px 12px; }
.cw .cw-bubble.user{ justify-content:flex-end; }
.cw .cw-bubble .cw-b{ max-width:80%; padding:10px 12px; border-radius:12px; border:1px solid var(--cw-line); }
.cw .cw-bubble.user .cw-b{ background:#eef2ff; }
.cw .cw-bubble.assistant .cw-b{ background:#f3f4f6; }
.cw .cw-input{ display:flex; gap:8px; padding:12px; border-top:1px solid var(--cw-line); }
.cw .cw-input textarea{ flex:1; padding:10px 12px; border:1px solid var(--cw-line); border-radius:10px; resize:vertical; }
.cw .cw-input button{ padding:10px 14px; border:0; border-radius:10px; background:var(--cw-accent); color:#fff; cursor:pointer; }
.cw .cw-tags{ display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
.cw .cw-chip{ display:inline-block; padding:6px 10px; border-radius:999px; background:#e5e7eb; font-size:12px; }
`;
  const style = document.createElement("style");
  style.appendChild(document.createTextNode(css));
  document.head.appendChild(style);
})();
