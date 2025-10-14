/*
 * ReflectivAI Chat/Coach — drop-in
 * Modes: Product Knowledge | Sales Simulation
 * Controls: Mode, Therapeutic Area, HCP Profile/Scenario, Coach (static)
 * Data: loads scenarios from cfg.scenariosUrl, infers Therapeutic Areas and HCP items
 * API: posts to cfg.apiBase with strict compliance guardrails
 */

(function () {
  // ---------- boot ----------
  let mount = null;
  const onReady = (fn) => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else fn();
  };
  function waitForMount(cb){
    const go = () => {
      mount = document.getElementById("reflectiv-widget");
      if (mount) return cb();
      const obs = new MutationObserver(() => {
        mount = document.getElementById("reflectiv-widget");
        if (mount){ obs.disconnect(); cb(); }
      });
      obs.observe(document.documentElement,{childList:true,subtree:true});
      setTimeout(()=>obs.disconnect(),15000);
    };
    onReady(go);
  }

  // ---------- state ----------
  let cfg = null;
  let scenarios = [];             // as loaded
  let scenariosById = new Map();  // id -> scenario
  let areas = [];                 // unique therapeutic areas
  let current = {
    mode: "Sales Simulation",     // default
    area: "",
    scenarioId: "",
  };
  let conversation = [];
  let coachVisible = false;

  // ---------- utils ----------
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];

  async function loadConfig() {
    // default path works with your repo root
    const path = "./config.json";
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(`Failed to load ${path} (${r.status})`);
    return r.json();
  }

  async function loadScenarios(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`Failed to load scenarios (${r.status})`);
    const data = await r.json();

    // normalize to a flat array "items"
    const items = Array.isArray(data) ? data :
      Array.isArray(data.items) ? data.items :
      Array.isArray(data.scenarios) ? data.scenarios : [];

    // infer fields with fallbacks
    items.forEach(s => {
      const id =
        s.id || s.scenario_id || `${(s.area||s.therapeutic_area||"GEN")}:${(s.title||s.name||"untitled")}`;
      const area = s.area || s.therapeutic_area || s.ta || "General";
      const title = s.title || s.name || `${area} scenario`;
      const hcp = s.hcp || s.profile || s.persona || "HCP";
      const objection = s.objection || s.objections || "";
      const goal = s.goal || s.objective || "";
      const rep = s.rep || s.approach || s.rep_approach || "";
      const rubric = s.rubric || s.scoring || {};
      const meta = { ...s, id, area, title, hcp, objection, goal, rep, rubric };
      scenariosById.set(id, meta);
    });

    return [...scenariosById.values()];
  }

  function buildAreas() {
    areas = uniq(scenarios.map(s => s.area)).sort((a,b)=>a.localeCompare(b));
  }

  function filterScenariosByArea(area) {
    return scenarios.filter(s => s.area === area);
  }

  // ---------- compliance guardrails ----------
  function complianceSystemPrompt(mode, area, s) {
    const cites = [
      "NEJM","JAMA","The Lancet","BMJ","Nature Medicine","Annals of Internal Medicine",
      "CDC","NIH","FDA label","EMA","WHO","IDSA","ASCO","AHA","GOLD","ADA"
    ].join(", ");
    const shared =
`You are an AI assistant for life-sciences field training. Respond with strict medical accuracy and regulatory compliance.
Rules:
- Cite primary sources with inline numeric markers and full references at the end of each answer.
- Prefer peer-reviewed journals, guidelines, and regulator labels: ${cites}.
- No promotion, no off-label claims, fair-balance required: include efficacy limits, safety, contraindications.
- If uncertain, say so and state what data would be required.
- Use plain language and avoid sensational adjectives.
- Include dates of trials or guidelines when cited.`;

    if (mode === "Product Knowledge") {
      return `${shared}
Task: Answer product/disease questions for Therapeutic Area: ${area}. Provide concise, referenced, evidence-based responses with citations.`;
    }

    // Sales Simulation
    const banner = s ? `TA: ${s.area} | HCP: ${s.hcp} | Scenario: ${s.title} | Goal: ${s.goal} | Objection: ${s.objection}` : "";
    return `${shared}
Task: Role-play the HCP in a sales simulation. Keep answers consistent with the persona and objection. Do not invent data. Provide short HCP replies. After each user turn, emit a machine-readable "coach" object with rubric scores (0-5) for: Needs Assessment, Clinical Accuracy, Compliance/Fair-Balance, Objection Handling, Close/Next Step. Also emit two bullet coaching tips. Context: ${banner}`;
  }

  // ---------- UI ----------
  function render() {
    mount.classList.add("cw");
    mount.innerHTML = "";

    const shell = el("div","cw-shell");

    // persona banner
    const banner = el("div","cw-banner hidden");
    banner.innerHTML = `<h4 id="bn-title"></h4>
      <p id="bn-objection"></p>
      <p id="bn-goal"></p>
      <p id="bn-rep"></p>`;
    shell.appendChild(banner);

    // controls
    const controls = el("div","cw-controls");
    const grid = el("div","grid");

    // Mode
    const fMode = el("div","field");
    const lbMode = el("label",null,"Mode");
    const selMode = el("select");
    ["Product Knowledge","Sales Simulation"].forEach(v=>{
      const o = el("option"); o.value=v; o.textContent=v; selMode.appendChild(o);
    });
    selMode.value = current.mode;
    fMode.append(lbMode, selMode);

    // Therapeutic Area
    const fTA = el("div","field");
    const lbTA = el("label",null,"Therapeutic Area");
    const selTA = el("select");
    fTA.append(lbTA, selTA);

    // HCP Profile/Scenario
    const fHCP = el("div","field");
    const lbHCP = el("label",null,"HCP Profile/Scenario");
    const selHCP = el("select");
    fHCP.append(lbHCP, selHCP);

    // Coach (static)
    const fCoach = el("div","field");
    const lbCoach = el("label",null,"Coach");
    const coachStatic = el("div","static",
      "I’ll provide feedback as we work through the HCP profile/scenario. Ready when you are!");
    fCoach.append(lbCoach, coachStatic);

    grid.append(fMode,fTA,fHCP,fCoach);
    controls.appendChild(grid);
    shell.appendChild(controls);

    // chat log + input
    const chat = el("div","cw-chat");
    const log = el("div","cw-log");
    const inputRow = el("div","cw-input");
    const ta = el("textarea"); ta.placeholder="Type your message…";
    const btnSend = el("button","btn","Send");
    inputRow.append(ta, btnSend);
    chat.append(log, inputRow);
    shell.appendChild(chat);

    // coach panel
    const coach = el("div","coach hidden");
    coach.innerHTML = `<div class="coach-h">Coach Feedback</div>
      <div class="coach-b">
        <div id="coach-text">Active. I will score each turn.</div>
        <div class="score" id="coach-score"></div>
      </div>`;
    shell.appendChild(coach);

    mount.appendChild(shell);

    // populate controls
    function populateAreas() {
      selTA.innerHTML = "";
      areas.forEach(a=>{
        const o = el("option"); o.value=a; o.textContent=a; selTA.appendChild(o);
      });
      if (!current.area) current.area = areas[0] || "";
      selTA.value = current.area;
    }
    function populateHCP() {
      selHCP.innerHTML = "";
      const list = filterScenariosByArea(current.area);
      list.forEach(s=>{
        const o = el("option");
        o.value = s.id;
        o.textContent = `${s.hcp}: ${s.title}`;
        selHCP.appendChild(o);
      });
      current.scenarioId = list[0]?.id || "";
      selHCP.value = current.scenarioId;
    }

    populateAreas();
    populateHCP();
    applyVisibility();
    updateBanner();

    // events
    selMode.addEventListener("change", ()=>{
      current.mode = selMode.value;
      applyVisibility();
      updateBanner();
    });
    selTA.addEventListener("change", ()=>{
      current.area = selTA.value;
      populateHCP();
      updateBanner();
    });
    selHCP.addEventListener("change", ()=>{
      current.scenarioId = selHCP.value;
      updateBanner();
    });
    btnSend.addEventListener("click", ()=> send(ta, log, coach));
    ta.addEventListener("keydown",(e)=>{ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); btnSend.click(); }});

    // helpers
    function applyVisibility(){
      const pk = current.mode === "Product Knowledge";
      // PK: show Mode + TA, hide HCP, hide Coach block
      fHCP.classList.toggle("hidden", pk);
      fCoach.classList.toggle("hidden", pk); // static coach hidden in PK
      // Sales Sim: show all, coach panel visible
      coachVisible = !pk;
      coach.classList.toggle("hidden", pk);
    }

    function updateBanner(){
      const pk = current.mode === "Product Knowledge";
      const s = scenariosById.get(current.scenarioId);
      banner.classList.toggle("hidden", pk || !s);
      if (!pk && s){
        banner.querySelector("#bn-title").textContent = `${s.hcp} — ${s.title}`;
        banner.querySelector("#bn-objection").textContent = `Objection: ${s.objection || "—"}`;
        banner.querySelector("#bn-goal").textContent = `Today’s Goal: ${s.goal || "—"}`;
        banner.querySelector("#bn-rep").textContent = `Rep Approach: ${s.rep || "—"}`;
      }
    }
  }

  // ---------- messaging ----------
  async function callApi(payload){
    const r = await fetch(cfg.apiBase, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error(`API ${r.status}`);
    return r.json();
  }

  function renderMsg(log, role, text){
    const m = el("div","msg "+(role==="user"?"me":""));
    m.innerHTML = `<span>${text}</span>`;
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
  }

  function renderCoach(coachEl, feedback){
    if (!feedback) return;
    const text = coachEl.querySelector("#coach-text");
    const scoreWrap = coachEl.querySelector("#coach-score");
    text.textContent = feedback.tips?.join(" • ") || "—";
    scoreWrap.innerHTML = "";
    const parts = [
      ["Needs","needs_assessment"],
      ["Accuracy","clinical_accuracy"],
      ["Compliance","compliance"],
      ["Objection","objection_handling"],
      ["Close","close_next_step"]
    ];
    parts.forEach(([label,key])=>{
      const v = feedback[key];
      if (typeof v === "number") {
        scoreWrap.appendChild(el("div","pill",`${label}: ${v}/5`));
      }
    });
  }

  async function send(ta, log, coachEl){
    const content = ta.value.trim();
    if (!content) return;
    ta.value = "";
    renderMsg(log,"user",content);

    const mode = current.mode;
    const area = current.area;
    const scenario = scenariosById.get(current.scenarioId) || null;

    // build guardrailed system
    const sys = complianceSystemPrompt(mode, area, scenario);

    const payload = {
      mode,
      area,
      scenarioId: scenario?.id || null,
      system: sys,
      conversation: [
        ...conversation,
        { role:"user", content }
      ],
      request_citations: true,
      request_coach: mode === "Sales Simulation"
    };

    try{
      const data = await callApi(payload);
      // expected: { reply: "...", citations:[...], coach:{...} }
      const reply = data.reply || "[no response]";
      conversation.push({ role:"user", content }, { role:"assistant", content: reply });
      renderMsg(log,"assistant", reply);

      if (coachVisible && data.coach) renderCoach(coachEl, data.coach);
    }catch(e){
      renderMsg(log,"assistant", `Error: ${e.message}`);
    }
  }

  // ---------- init ----------
  waitForMount(async ()=>{
    try{
      cfg = await loadConfig();
      scenarios = await loadScenarios(cfg.scenariosUrl || "./assets/chat/data/scenarios.merged.json");
      buildAreas();
      // default selections
      if (areas.length) {
        // prefer HIV capitalization “HIV” if present
        current.area = areas.includes("HIV") ? "HIV" : areas[0];
      }
      render();
    }catch(e){
      const err = el("div","cw");
      err.textContent = `Widget failed to load: ${e.message}`;
      mount.replaceWith(err);
    }
  });
})();
