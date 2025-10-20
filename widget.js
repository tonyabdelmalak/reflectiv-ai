/* =====================================================
   ReflectivAI Coach — drop-in modal widget
   - Launch via elements with [data-open-coach]
   - Uses assets/chat/system.md and assets/chat/config.json
   - Separate from Alora agent
   ===================================================== */
(function(){
  const CFG_PATH = "./assets/chat/config.json";
  const SYS_PATH = "./assets/chat/system.md";

  // ---------- DOM bootstrap ----------
  function byId(id){ return document.getElementById(id); }
  function el(tag, cls, txt){ const e=document.createElement(tag); if(cls) e.className=cls; if(txt!=null) e.textContent=txt; return e; }

  // Create modal if not present
  function ensureModal(){
    if(byId("reflectiv-coach-overlay")) return;
    const overlay = el("div"); overlay.id="reflectiv-coach-overlay"; overlay.setAttribute("role","dialog");
    const modal = el("div"); modal.id="reflectiv-coach";
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Header
    const header = el("div","header");
    header.append(el("div","title","ReflectivAI Coach"));
    const x = el("button","close","×"); x.setAttribute("aria-label","Close");
    x.onclick = ()=> overlay.classList.remove("open");
    header.appendChild(x);
    modal.appendChild(header);

    // Toolbar
    const toolbar = el("div","toolbar");
    const controls = el("div","controls");
    toolbar.appendChild(controls);
    modal.appendChild(toolbar);

    // Controls: LC, Coach On/Off, Disease, HCP, EI Persona, EI Feature
    controls.innerHTML = `
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
      <select id="cw-hcp"><option value="" selected disabled>Select…</option></select>

      <label for="cw-ei-persona">EI Persona <span class="hint">(hover to learn)</span></label>
      <select id="cw-ei-persona"><option value="" selected disabled>Select…</option></select>

      <label for="cw-ei-feature">EI Feature <span class="hint">(hover to learn)</span></label>
      <select id="cw-ei-feature"><option value="" selected disabled>Select…</option></select>
    `;

    // Body
    const body = el("div","body");
    const messages = el("div","messages"); messages.id="cw-messages";
    const input = el("div","input");
    const ta = el("textarea"); ta.id="cw-input"; ta.placeholder="Type your message…";
    ta.addEventListener("keydown",(e)=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); send.click(); }});
    const send = el("button","btn","Send"); send.id="cw-send";
    input.append(ta,send);

    const coach = el("div","coach");
    coach.innerHTML = `
      <h4>Coach Feedback</h4>
      <div id="cw-feedback"><span class="hint">Awaiting first assistant reply…</span></div>
      <details>
        <summary>Scoring rubric & criteria</summary>
        <div id="cw-rubric" class="hint" style="margin-top:6px">
          Accuracy, Compliance, Discovery, Objection Handling, Clarity, Empathy (0–5 each). Weighted to compute a 0–100 overall score.
          Tip: keep 3–5 sentences, cite label or guideline, end with one discovery question.
        </div>
      </details>
    `;

    body.append(messages,input,coach);
    modal.appendChild(body);

    // Overlay click to close
    overlay.addEventListener("click",(e)=>{ if(e.target===overlay) overlay.classList.remove("open"); });
  }

  // ---------- State ----------
  let cfg = { defaultMode:"sales-simulation" };
  let systemPrompt = "";
  let scenarios = [];
  let scenariosById = new Map();

  let currentMode = "sales-simulation";
  let coachOn = true;
  let currentScenarioId = null;
  const convo = [];

  // ---------- Fetch helpers ----------
  async function fetchLocal(path){
    const r = await fetch(path,{cache:"no-store"});
    if(!r.ok) throw new Error(`Failed ${path} (${r.status})`);
    const ct=r.headers.get("content-type")||"";
    return ct.includes("application/json")? r.json(): r.text();
  }

  // ---------- Markdown-lite ----------
  function esc(s){ return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function md(text){
    if(!text) return "";
    let s = esc(text).replace(/\r\n?/g,"\n");
    s = s.replace(/\*\*([^*\n]+)\*\*/g,"<strong>$1</strong>").replace(/`([^`]+)`/g,"<code>$1</code>");
    return s.split(/\n{2,}/).map(p=>`<p>${p.replace(/\n/g,"<br>")}</p>`).join("");
  }

  // ---------- LLM hygiene ----------
  function cleanModel(raw){
    let s=String(raw||"");
    s=s.replace(/```[\s\S]*?```/g,"").replace(/<pre[\s\S]*?<\/pre>/gi,"");
    s=s.replace(/^\s*#{1,6}\s+/gm,"").replace(/\n{3,}/g,"\n\n").trim();
    return s;
  }
  function extractCoach(raw){
    const m=String(raw||"").match(/<coach>([\s\S]*?)<\/coach>/i);
    if(!m) return {coach:null, clean:cleanModel(raw)};
    let coach=null; try{ coach=JSON.parse(m[1]); }catch{}
    const clean=cleanModel(String(raw).replace(m[0],"").trim());
    return {coach, clean};
  }

  // ---------- Deterministic scoring ----------
  function scoreReply(userText, replyText){
    const text=String(replyText||"");
    const t=text.toLowerCase();
    const words=text.split(/\s+/).filter(Boolean).length;
    const q=/\?\s*$/.test(text);
    const sig={
      label:/(per label|fda\s*label|indication|contraindication|boxed warning|guideline|fda)/i.test(text),
      discovery:q||/(how|what|could you|can you|clarify|help me understand)\b/i.test(t),
      objection:/(concern|barrier|risk|coverage|auth|denied|cost|workflow|adherence|side effect|safety)/i.test(t),
      empathy:/(i understand|appreciate|thanks for|i hear|it sounds like)/i.test(t),
      accuracyCue:/(formulary|access|prior auth|efficacy|safety|ddi|interaction|renal|biomarker|endpoint)/i.test(t),
      idealLen: words>=45 && words<=120,
      tooLong: words>180
    };
    const accuracy = sig.accuracyCue ? (sig.label?5:4):3;
    const compliance = sig.label?5:3;
    const discovery = sig.discovery?4:2;
    const objection_handling = sig.objection?(sig.accuracyCue?4:3):2;
    const empathy = sig.empathy?3:2;
    const clarity = sig.tooLong?2:(sig.idealLen?4:3);
    const W={accuracy:.26,compliance:.22,discovery:.16,objection_handling:.14,clarity:.12,empathy:.10};
    const pct=v=>v*20;
    let overall = pct(accuracy)*W.accuracy + pct(compliance)*W.compliance + pct(discovery)*W.discovery +
                  pct(objection_handling)*W.objection_handling + pct(clarity)*W.clarity + pct(empathy)*W.empathy;
    if(sig.idealLen) overall+=3; if(q) overall+=3; if(sig.tooLong) overall-=6;
    overall=Math.round(Math.max(0,Math.min(100,overall)));
    return {
      overall,
      scores:{accuracy,empathy,clarity,compliance,discovery,objection_handling},
      feedback:"Be concise, anchor claims to label or guideline, ask one discovery question, and propose a concrete next step.",
      worked:[
        sig.empathy&&"Acknowledged HCP context",
        sig.discovery&&"Closed with a clear discovery question",
        sig.label&&"Referenced label/guidelines",
        sig.accuracyCue&&"Tied points to clinical cues"
      ].filter(Boolean),
      improve:[
        sig.tooLong&&"Tighten to 3–5 sentences",
        !sig.discovery&&"End with one specific question",
        !sig.label&&"Anchor claims to label or guideline",
        clarity<4&&"Use one idea per sentence"
      ].filter(Boolean),
      phrasing: sig.discovery
        ? "Given your criteria, which patients would be the best fit to start, and what would help you try one this month?"
        : "Would it help to align on eligibility criteria and agree on one next step for your earliest appropriate patient?",
      context:{rep_question:String(userText||""), hcp_reply:String(replyText||"")}
    };
  }

  // ---------- UI helpers ----------
  function pills(scores){
    const order=["accuracy","empathy","clarity","compliance","discovery","objection_handling"];
    return order.map(k=>`<span class="pill">${k}: ${scores[k]}</span>`).join(" ");
  }
  function renderMessages(){
    const box=byId("cw-messages"); box.innerHTML="";
    for(const m of convo){
      const row=el("div","msg "+m.role);
      const bubble=el("div","bubble"); bubble.innerHTML=md(m.content);
      row.appendChild(bubble); box.appendChild(row);
    }
    box.scrollTop=box.scrollHeight;
  }
  function renderFeedback(){
    const last=convo[convo.length-1];
    const panel=byId("cw-feedback");
    if(!(last&&last.role==="assistant"&&last._coach)){
      panel.innerHTML='<span class="hint">Awaiting first assistant reply…</span>'; return;
    }
    const fb=last._coach;
    panel.innerHTML = `
      <div><span class="score">${fb.overall}/100</span> overall</div>
      <div class="pills">${pills(fb.scores)}</div>
      <div><strong>What worked:</strong> ${fb.worked.join(". ")||"—"}.</div>
      <div><strong>Improve:</strong> ${fb.improve.join(". ")||fb.feedback}.</div>
      <div><strong>Suggested phrasing:</strong> ${fb.phrasing||"—"}</div>
    `;
  }

  // ---------- Scenario + EI population ----------
  function setOptions(sel, arr, placeholder="Select…"){
    sel.innerHTML = `<option value="" disabled selected>${placeholder}</option>`;
    arr.forEach(o=>{
      const opt=document.createElement("option");
      if(typeof o==="string"){ opt.value=o; opt.textContent=o; }
      else{ opt.value=o.value||o.id||o.key||o.label; opt.textContent=o.label||o.value||o.id||o.key; }
      sel.appendChild(opt);
    });
  }
  function populateDisease(){
    const ds = Array.isArray(cfg.diseaseStates)&&cfg.diseaseStates.length
      ? cfg.diseaseStates
      : Array.from(new Set(scenarios.map(s=>(s.therapeuticArea||s.diseaseState||"").trim()))).filter(Boolean);
    ds.sort();
    setOptions(byId("cw-disease"), ds);
  }
  function populateHcpFor(ds){
    const list = scenarios.filter(s=>{
      const area=(s.therapeuticArea||s.diseaseState||"").trim().toLowerCase();
      return area === String(ds||"").toLowerCase();
    });
    setOptions(byId("cw-hcp"), list.map(s=>({value:s.id,label:s.label||s.id})));
    byId("cw-hcp").disabled = !list.length;
  }
  function populateEI(){
    const personas = (cfg.personas&&cfg.personas.length? cfg.personas : [
      {key:"difficult",label:"Difficult HCP",description:"Resistant, emotional, argumentative"},
      {key:"busy",label:"Busy HCP",description:"Time-pressed, bottom-line focused"},
      {key:"engaged",label:"Highly Engaged HCP",description:"Collaborative, attentive"},
      {key:"indifferent",label:"Nice but Doesn’t Prescribe",description:"Pleasant, disengaged"}
    ]);
    const features = (cfg.eiFeatures&&cfg.eiFeatures.length? cfg.eiFeatures : [
      {key:"empathy",label:"Empathy Rating"},
      {key:"stress",label:"Stress Level Indicator"},
      {key:"listening",label:"Active Listening Hints"},
      {key:"validation",label:"Validation & Reframing Tips"}
    ]);
    setOptions(byId("cw-ei-persona"), personas.map(p=>({value:p.key,label:p.label})));
    setOptions(byId("cw-ei-feature"), features.map(f=>({value:f.key,label:f.label})));
    // tooltips via title attribute
    const pSel=byId("cw-ei-persona"), fSel=byId("cw-ei-feature");
    pSel.title = personas.map(p=>`${p.label}: ${p.description||""}`).join("\n");
    fSel.title = features.map(f=>f.label).join("\n");
  }

  // ---------- Transport ----------
  async function callModel(messages){
    const url=(cfg.apiBase||cfg.workerUrl||"").trim();
    if(!url) throw new Error("No API endpoint configured.");
    const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({model:cfg.model||"llama-3.1-8b-instant",temperature:0.2,stream:!!cfg.stream,messages})});
    if(!r.ok){ const t=await r.text().catch(()=> ""); throw new Error(`HTTP ${r.status}: ${t}`); }
    const data=await r.json().catch(()=> ({}));
    return data?.content || data?.reply || data?.choices?.[0]?.message?.content || "";
  }

  // ---------- Send ----------
  async function sendMessage(){
    const ta=byId("cw-input"); const text=ta.value.trim(); if(!text) return;
    ta.value="";
    convo.push({role:"user",content:text}); renderMessages(); renderFeedback();

    const sc = scenariosById.get(currentScenarioId);
    const preface = buildPreface(currentMode, sc);
    const msgs=[];
    if(systemPrompt) msgs.push({role:"system",content:systemPrompt});
    msgs.push({role:"system",content:preface});
    msgs.push({role:"user",content:text});

    try{
      const raw = await callModel(msgs);
      const {coach, clean} = extractCoach(raw);
      const computed = scoreReply(text, clean);
      const finalCoach = (()=> {
        if(coach && (coach.scores||coach.subscores)){
          const scores=coach.scores||coach.subscores;
          const overall = typeof coach.overall==="number"? coach.overall : (typeof coach.score==="number"? coach.score : computed.overall);
          return { overall, scores, worked:coach.worked&&coach.worked.length?coach.worked:computed.worked,
            improve:coach.improve&&coach.improve.length?coach.improve:computed.improve,
            feedback:coach.feedback||computed.feedback, phrasing:coach.phrasing||computed.phrasing,
            context:coach.context||computed.context, score:overall, subscores:scores };
        }
        return computed;
      })();
      convo.push({role:"assistant",content:clean,_coach:finalCoach});
      renderMessages(); renderFeedback();

      if(cfg.analyticsEndpoint){
        fetch(cfg.analyticsEndpoint,{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({ts:Date.now(),schema:cfg.schemaVersion||"coach-v2",mode:currentMode,
            scenarioId:currentScenarioId,turn:convo.length,context:finalCoach.context,overall:finalCoach.overall,scores:finalCoach.scores})});
      }
    }catch(e){
      convo.push({role:"assistant",content:`Model error: ${String(e.message||e)}`}); renderMessages();
    }
  }

  // ---------- Prompt preface ----------
  function buildPreface(mode, sc){
    const COMMON=`
Return exactly two parts. No code blocks. No markdown headings.
1) Sales Guidance: short, actionable, accurate guidance.
2) <coach>{"overall":0-100,"scores":{"accuracy":0-5,"empathy":0-5,"clarity":0-5,"compliance":0-5,"discovery":0-5,"objection_handling":0-5},"worked":["…"],"improve":["…"],"phrasing":"…","feedback":"one concise paragraph","context":{"rep_question":"...","hcp_reply":"..."}}</coach>
`.trim();

    if(mode==="sales-simulation"){
      return `
You are a virtual pharma coach. Be direct, label-aligned, and safe.

Scenario
${sc?[
`Therapeutic Area: ${sc.therapeuticArea||"—"}`,
`HCP Role: ${sc.hcpRole||"—"}`,
`Background: ${sc.background||"—"}`,
`Today’s Goal: ${sc.goal||"—"}`
].join("\n"):""}

Style
- 3–6 sentences and one closing question.
- Only appropriate, publicly known, label-aligned facts.
- No pricing advice or PHI. No off-label.

${COMMON}`.trim();
    }
    if(mode==="product-knowledge"){
      return `Return a concise educational overview with reputable citations. Structure: key takeaways; mechanism/indications; safety/contraindications; efficacy; access notes; references.`.trim();
    }
    return `
Provide brief self-reflection tips tied to HCP communication.
- 3–5 sentences, then one reflective question.

${COMMON}`.trim();
  }

  // ---------- Scenarios loader ----------
  async function loadScenarios(){
    if(cfg && cfg.scenariosUrl){
      const payload = await fetchLocal(cfg.scenariosUrl);
      const arr = Array.isArray(payload)? payload : (payload.scenarios||[]);
      scenarios = arr.map(s=>({ id:s.id, label:s.label||s.id, therapeuticArea:s.therapeuticArea||s.diseaseState||"", hcpRole:s.hcpRole||"", background:s.background||"", goal:s.goal||"" }));
    } else if (Array.isArray(cfg.scenarios)){
      scenarios = cfg.scenarios.map(s=>({ id:s.id, label:s.label||s.id, therapeuticArea:s.therapeuticArea||s.diseaseState||"", hcpRole:s.hcpRole||"", background:s.background||"", goal:s.goal||"" }));
    } else { scenarios=[]; }
    scenariosById = new Map(scenarios.map(s=>[s.id,s]));
  }

  // ---------- Init ----------
  async function init(){
    ensureModal();

    try{ cfg = await fetchLocal(CFG_PATH); }catch{ cfg={defaultMode:"sales-simulation"}; }
    try{ systemPrompt = await fetchLocal(SYS_PATH); }catch{ systemPrompt=""; }

    await loadScenarios();
    populateDisease(); populateEI();

    // Mode + select wiring
    byId("cw-mode").addEventListener("change",e=>{
      const v=e.target.value.toLowerCase();
      currentMode = v.includes("product")? "product-knowledge" : v.includes("emotional")? "emotional-assessment" : "sales-simulation";
    });
    byId("cw-coach").addEventListener("change",e=>{ coachOn = e.target.value==="on"; });
    byId("cw-disease").addEventListener("change",e=>{ populateHcpFor(e.target.value); currentScenarioId=null; });
    byId("cw-hcp").addEventListener("change",e=>{ currentScenarioId = e.target.value; });

    byId("cw-send").onclick = sendMessage;

    // Global triggers to open coach
    document.querySelectorAll("[data-open-coach]").forEach(btn=>{
      btn.addEventListener("click",(e)=>{ e.preventDefault(); byId("reflectiv-coach-overlay").classList.add("open"); });
    });
  }

  // start
  init();
})();
