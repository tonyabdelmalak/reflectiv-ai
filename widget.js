/*
 * ReflectivAI Chat/Coach — drop-in
 * Learning Center: Emotional Intelligence | Product Knowledge | Sales Simulation
 */
(function () {
  // ---------- boot ----------
  let mount = null;
  function onReady(fn){ if (document.readyState==="loading") document.addEventListener("DOMContentLoaded", fn, {once:true}); else fn(); }
  function waitForMount(cb){
    const go = () => {
      mount = document.getElementById("reflectiv-widget");
      if (mount) return cb();
      const obs = new MutationObserver(() => {
        mount = document.getElementById("reflectiv-widget");
        if (mount){ obs.disconnect(); cb(); }
      });
      obs.observe(document.documentElement, { childList:true, subtree:true });
      setTimeout(()=>obs.disconnect(),15000);
    };
    onReady(go);
  }

  // ---------- constants ----------
  const LC_OPTIONS = ["Emotional Intelligence","Product Knowledge","Sales Simulation"];
  const LC_MAP = {
    "Emotional Intelligence":"emotional-assessment",
    "Product Knowledge":"product-knowledge",
    "Sales Simulation":"sales-simulation"
  };

  // ---------- state ----------
  let cfg = { apiBase:"", workerUrl:"", defaultMode:"sales-simulation" };
  let systemPrompt = "";
  let scenarios = [];
  let scenariosById = new Map();

  let currentMode = "sales-simulation";
  let currentScenarioId = null;
  let conversation = [];
  let coachOn = true;

  // ---------- utils ----------
  async function fetchLocal(path){
    const r = await fetch(path, { cache:"no-store" });
    if(!r.ok) throw new Error(`Failed to load ${path} (${r.status})`);
    const ct = r.headers.get("content-type")||"";
    return ct.includes("application/json") ? r.json() : r.text();
  }

  const esc = s => String(s||"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");

  function md(text){
    if(!text) return "";
    let s = esc(text).replace(/\r\n?/g,"\n");
    s = s.replace(/\*\*([^*\n]+)\*\*/g,"<strong>$1</strong>")
         .replace(/`([^`]+)`/g,"<code>$1</code>");
    s = s.replace(/^(?:-\s+|\*\s+).+(?:\n(?:-\s+|\*\s+).+)*/gm, blk=>{
      const items = blk.split("\n").map(l=>l.replace(/^(?:-\s+|\*\s+)(.+)$/, "<li>$1</li>")).join("");
      return `<ul>${items}</ul>`;
    });
    return s.split(/\n{2,}/).map(p=>p.startsWith("<ul>")?p:`<p>${p.replace(/\n/g,"<br>")}</p>`).join("\n");
  }

  function el(tag, cls, text){ const n=document.createElement(tag); if(cls) n.className=cls; if(text!=null) n.textContent=text; return n; }

  function sanitizeLLM(raw){
    let s = String(raw||"");
    s = s.replace(/```[\s\S]*?```/g,"")
         .replace(/<pre[\s\S]*?<\/pre>/gi,"")
         .replace(/^\s*#{1,6}\s+/gm,"");
    s = s.replace(/\n{3,}/g,"\n\n").trim();
    return s;
  }

  function extractCoach(raw){
    const m = String(raw||"").match(/<coach>([\s\S]*?)<\/coach>/i);
    if(!m) return { coach:null, clean:sanitizeLLM(raw) };
    let coach=null; try{ coach=JSON.parse(m[1]); }catch{}
    return { coach, clean:sanitizeLLM(String(raw).replace(m[0],"").trim()) };
  }

  function normalizeDS(x){
    if(!x) return "";
    const base = String(x).replace(/\bHiv\b/ig,"HIV").trim();
    return base.split(/[–—-:]/)[0].trim(); // "HIV - PrEP" -> "HIV"
  }

  // ---------- scoring fallback ----------
  function scoreReply(userText, replyText, mode){
    const t=(replyText||"").toLowerCase();
    const words=(replyText||"").split(/\s+/).filter(Boolean).length;
    const endsWithQuestion=/\?\s*$/.test(replyText||"");
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

    if(mode==="emotional-assessment"){
      const empathy=/(i understand|it makes sense|acknowledge|appreciate|valid|i hear)/i.test(t);
      const active=/(it sounds like|what i’m hearing|let’s pause|check[- ]?in)/i.test(t);
      const behavior=/(try|practice|choose|focus|set|next time)/i.test(t);
      const drugs=/(descovy|biktarvy|cabenuva|tdf|taf)/i.test(t);
      const q=clamp(endsWithQuestion?3+(active?1:0):2,1,4);
      const e=clamp((empathy?3:2)+(active?1:0),1,4);
      const obj=clamp((behavior?3:2),1,4);
      const comp=clamp(drugs?2:4,1,4);
      const score=clamp(Math.round(55+q*6+e*6+obj*5+comp*5+(words>=40&&words<=140?6:words<40?2:0)+(endsWithQuestion?6:0)),55,98);
      return { score, subscores:{question_quality:q, objection_handling:obj, empathy:e, compliance:comp},
        worked:[empathy?"Validated emotions":null,active?"Active listening":null,endsWithQuestion?"Closed with a question":null].filter(Boolean),
        improve:[behavior?null:"Offer one concrete, low-effort behavior",words>140?"Tighten to 3–5 sentences":null,drugs?"Avoid drug references in EI mode":null].filter(Boolean),
        phrasing:"Given all that, what small action this week would help you feel more in control before your next HCP discussion?"
      };
    }

    const cues=[/renal|egfr|crcl/,/bone|osteopor/,/label|indication|guideline/,/adherence|workflow|injection/,/resistance|interaction|ddi/,/coverage|prior auth|formulary/,/prep|taf|tdf|bictegravir|rilpivirine|cabotegravir|biktarvy|descovy|cabenuva/];
    const hits=cues.reduce((n,re)=>n+(re.test(t)?1:0),0);
    const accuracy=Math.max(1,Math.min(4,Math.floor(hits/2)));
    const objection=Math.max(1,Math.min(4,/concern|barrier|risk|coverage|auth|denied|cost|workflow|adherence/i.test(t)?3+(hits>3?1:0):(hits>2?2:1)));
    const empathy=Math.max(1,Math.min(4,/understand|appreciate|thanks for|let’s/i.test(t)?3:2));
    const compliance=Math.max(1,Math.min(4,/label|guideline|per label|approved/i.test(t)?3+(hits>3?1:0):2));
    const score=Math.max(55,Math.min(98,Math.round((mode==="sales-simulation"?52:50)+accuracy*6+objection*5+empathy*4+compliance*6+(words>40&&words<160?6:words<=40?2:0)+(endsWithQuestion?6:0))));
    return { score, subscores:{question_quality:Math.max(1,Math.min(4,endsWithQuestion?3+(hits>3?1:0):2)), objection_handling:objection, empathy, compliance},
      worked:[hits>=3?"Grounded in clinical cues":"Kept it concise", endsWithQuestion?"Asked for alignment":null].filter(Boolean),
      improve:[hits<3?"Add renal/bone, resistance, or DDI context when relevant":null, endsWithQuestion?null:"End with a clear next-step ask"].filter(Boolean),
      phrasing: mode==="sales-simulation" ? "Would aligning on eligible-patient criteria and a brief follow-up next week work?" : "Want a quick compare of renal and bone safety differences?"
    };
  }

  // ---------- prompts ----------
  function buildPreface(mode, sc){
    const COMMON = `# ReflectivAI — Output Contract
Return two parts only. No code blocks. No markdown headings.
1) Sales Guidance: short, actionable, accurate guidance.
2) <coach>{ "worked":[…], "improve":[…], "phrasing":"…", "score":int, "subscores":{"question_quality":0-4,"objection_handling":0-4,"empathy":0-4,"compliance":0-4} }</coach>`.trim();

    if(mode==="sales-simulation"){
      return `
# Role
You are a virtual pharma coach for a 30-second HCP interaction. Be direct and label-aligned.

# Scenario
${sc ? [
  `Therapeutic Area: ${sc.therapeuticArea||"—"}`,
  `Background: ${sc.background||"—"}`,
  `Today’s Goal: ${sc.goal||"—"}`
].join("\n") : ""}

# Style
- 3–6 sentences plus one closing question.
- Only appropriate, publicly known, label-aligned facts. No PHI. No off-label.

${COMMON}`.trim();
    }

    if(mode==="product-knowledge"){
      return `Return a concise educational overview with citations: key takeaways; mechanism/indications; safety/contraindications; efficacy; access notes; references.`.trim();
    }

    return `Provide brief, practical self-reflection tips tied to HCP communication. 3–5 sentences and one reflective question.\n\n${COMMON}`;
  }

  // ---------- UI ----------
  function buildUI(){
    mount.innerHTML = "";
    if(!mount.classList.contains("cw")) mount.classList.add("cw");

    const style = document.createElement("style");
    style.textContent = `
      #reflectiv-widget .reflectiv-chat{display:flex;flex-direction:column;gap:12px;border:3px solid #bfc7d4;border-radius:14px;background:#fff;overflow:hidden;}
      #reflectiv-widget .chat-toolbar{display:block;padding:14px 16px;background:#f6f8fb;border-bottom:1px solid #e1e6ef;}
      #reflectiv-widget .sim-controls{display:grid;grid-template-columns:220px 1fr 200px 1fr;gap:12px 16px;align-items:center;}
      #reflectiv-widget .sim-controls label{font-size:13px;font-weight:600;color:#2f3a4f;justify-self:end;white-space:nowrap;}
      #reflectiv-widget .sim-controls select{width:100%;height:38px;padding:6px 10px;font-size:14px;border:1px solid #cfd6df;border-radius:8px;background:#fff;}
      #reflectiv-widget .chat-messages{min-height:260px;height:320px;max-height:50vh;overflow:auto;padding:12px 14px;background:#fafbfd;}
      #reflectiv-widget .message{margin:8px 0;display:flex;}
      #reflectiv-widget .message.user{justify-content:flex-end;}
      #reflectiv-widget .message.assistant{justify-content:flex-start;}
      #reflectiv-widget .message .content{max-width:85%;line-height:1.45;font-size:14px;padding:10px 12px;border-radius:14px;border:1px solid #d6dbe3;color:#0f1522;background:#e9edf3;}
      #reflectiv-widget .message.user .content{background:#e0e0e0;color:#000;}
      #reflectiv-widget .chat-input{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #e1e6ef;background:#fff;}
      #reflectiv-widget .chat-input textarea{flex:1;resize:none;min-height:44px;max-height:120px;padding:10px 12px;border:1px solid #cfd6df;border-radius:10px;outline:none;}
      #reflectiv-widget .chat-input .btn{min-width:86px;border:0;border-radius:999px;background:#2f3a4f;color:#fff;font-weight:600;}
      #reflectiv-widget .coach-section{margin-top:0;padding:12px 14px;border:1px solid #e1e6ef;border-radius:12px;background:#fffbe8;}
      #reflectiv-widget .scenario-meta .meta-card{padding:10px 12px;background:#f7f9fc;border:1px solid #e1e6ef;border-radius:10px;}
      @media (max-width:900px){#reflectiv-widget .sim-controls{grid-template-columns:1fr;gap:8px}#reflectiv-widget .sim-controls label{justify-self:start}}
      @media (max-width:520px){#reflectiv-widget .chat-messages{height:46vh}}
      #reflectiv-widget .hidden{display:none!important}
      #reflectiv-widget .muted{opacity:.75}
    `;
    document.head.appendChild(style);

    const shell = el("div","reflectiv-chat");
    const bar = el("div","chat-toolbar");
    const controls = el("div","sim-controls");

    // Learning Center
    const lcLabel = el("label","", "Learning Center"); lcLabel.htmlFor = "lc-mode";
    const lcSel = el("select"); lcSel.id="lc-mode";
    LC_OPTIONS.forEach(txt=>{ const o=el("option"); o.value=txt; o.textContent=txt; lcSel.appendChild(o); });
    const initialLC = Object.keys(LC_MAP).find(k=>LC_MAP[k]===(cfg.defaultMode||"sales-simulation")) || "Sales Simulation";
    lcSel.value = initialLC;
    currentMode = LC_MAP[lcSel.value];

    // Coach
    const coachLbl = el("label","", "Coach"); coachLbl.htmlFor = "cw-coach";
    const coachSel = el("select"); coachSel.id="cw-coach";
    [{v:"on",t:"Coach On"},{v:"off",t:"Coach Off"}].forEach(({v,t})=>{ const o=el("option"); o.value=v; o.textContent=t; coachSel.appendChild(o);});
    coachSel.value = coachOn ? "on" : "off";
    coachSel.onchange = ()=>{ coachOn = coachSel.value==="on"; renderCoach(); };

    // Disease State
    const dsLabel = el("label","", "Disease State"); dsLabel.htmlFor = "cw-ds";
    const dsSel = el("select"); dsSel.id="cw-ds";

    // HCP Profiles
    const hcpLabel = el("label","", "HCP Profiles"); hcpLabel.htmlFor = "cw-hcp";
    const hcpSel = el("select"); hcpSel.id="cw-hcp";

    controls.appendChild(lcLabel); controls.appendChild(lcSel);
    controls.appendChild(coachLbl); controls.appendChild(coachSel);
    controls.appendChild(dsLabel);  controls.appendChild(dsSel);
    controls.appendChild(hcpLabel); controls.appendChild(hcpSel);
    bar.appendChild(controls);
    shell.appendChild(bar);

    const meta = el("div","scenario-meta"); shell.appendChild(meta);
    const msgs = el("div","chat-messages"); shell.appendChild(msgs);

    const input = el("div","chat-input");
    const ta = el("textarea"); ta.placeholder="Type your message…";
    ta.addEventListener("keydown",e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); send.click(); }});
    const send = el("button","btn","Send");
    send.onclick = ()=>{ const t=ta.value.trim(); if(!t) return; sendMessage(t); ta.value=""; };
    input.appendChild(ta); input.appendChild(send);
    shell.appendChild(input);

    mount.appendChild(shell);

    const coachBox = el("div","coach-section");
    coachBox.innerHTML = `<h3>Coach Feedback</h3><div class="coach-body muted">Awaiting the first assistant reply…</div>`;
    mount.appendChild(coachBox);

    // helpers
    function setOpts(sel, arr, placeholder=true){
      sel.innerHTML = "";
      if(placeholder){ const p=el("option","", "Select…"); p.value=""; p.selected=true; p.disabled=true; sel.appendChild(p); }
      (arr||[]).forEach(v=>{
        if(!v) return;
        const o=el("option","", typeof v==="string"?v:(v.label||v.value||v.id));
        o.value = typeof v==="string"?v:(v.value||v.id||v.label);
        sel.appendChild(o);
      });
      sel.disabled = !arr || !arr.length;
    }

    function diseaseStates(){
      if(Array.isArray(cfg.diseaseStates) && cfg.diseaseStates.length) return cfg.diseaseStates.map(normalizeDS);
      const ds = Array.from(new Set(scenarios.map(s=>normalizeDS(s.therapeuticArea||s.diseaseState)))).filter(Boolean);
      return ds.length ? ds : ["HIV","Oncology","Vaccines","Hepatitis B","Pulmonology","Cardiology"];
    }

    function populateDiseases(){ setOpts(dsSel, diseaseStates()); }
    function populateHCP(ds){
      const key = normalizeDS(ds).toLowerCase();
      const list = scenarios
        .filter(s => normalizeDS(s.therapeuticArea||s.diseaseState).toLowerCase().startsWith(key))
        .map(s => ({ value:s.id, label:s.label||s.id }));
      setOpts(hcpSel, list);
    }

    function applyLC(){
      currentMode = LC_MAP[lcSel.value];
      const pk = currentMode==="product-knowledge";
      coachLbl.classList.toggle("hidden", pk);
      coachSel.classList.toggle("hidden", pk);

      if(currentMode==="sales-simulation"){
        dsLabel.classList.remove("hidden"); dsSel.classList.remove("hidden");
        hcpLabel.classList.remove("hidden"); hcpSel.classList.remove("hidden");
        populateDiseases();
      } else if(pk){
        dsLabel.classList.remove("hidden"); dsSel.classList.remove("hidden");
        hcpLabel.classList.add("hidden");   hcpSel.classList.add("hidden");
        populateDiseases();
      } else { // EI
        dsLabel.classList.add("hidden"); dsSel.classList.add("hidden");
        hcpLabel.classList.add("hidden"); hcpSel.classList.add("hidden");
      }

      currentScenarioId=null; conversation=[]; renderMessages(); renderCoach(); renderMeta();
    }

    lcSel.addEventListener("change", applyLC);
    dsSel.addEventListener("change", ()=>{
      const ds = dsSel.value||"";
      if(!ds) return;
      if(currentMode==="sales-simulation"){ populateHCP(ds); }
      else { currentScenarioId=null; }
      conversation=[]; renderMessages(); renderCoach(); renderMeta();
    });
    hcpSel.addEventListener("change", ()=>{
      currentScenarioId = hcpSel.value || null;
      conversation=[]; renderMessages(); renderCoach(); renderMeta();
    });

    function renderMeta(){
      const sc = scenariosById.get(currentScenarioId);
      if(!sc || currentMode!=="sales-simulation"){ meta.innerHTML=""; return; }
      meta.innerHTML = `
        <div class="meta-card">
          <div><strong>Therapeutic Area:</strong> ${esc(sc.therapeuticArea||"—")}</div>
          <div><strong>HCP Role:</strong> ${esc(sc.hcpRole||"—")}</div>
          <div><strong>Background:</strong> ${esc(sc.background||"—")}</div>
          <div><strong>Today’s Goal:</strong> ${esc(sc.goal||"—")}</div>
        </div>`;
    }
    function renderMessages(){
      msgs.innerHTML="";
      for(const m of conversation){
        const row = el("div",`message ${m.role}`); const c=el("div","content"); c.innerHTML=md(m.content);
        row.appendChild(c); msgs.appendChild(row);
      }
      msgs.scrollTop = msgs.scrollHeight;
    }
    function renderCoach(){
      const body = coachBox.querySelector(".coach-body");
      if(!coachOn || currentMode==="product-knowledge"){ coachBox.style.display="none"; return; }
      coachBox.style.display="";
      const last = conversation[conversation.length-1];
      if(!(last && last.role==="assistant" && last._coach)){ body.innerHTML=`<span class="muted">Awaiting the first assistant reply…</span>`; return; }
      const fb = last._coach, subs=fb.subscores||{};
      body.innerHTML = `
        <div class="coach-score">Score: <strong>${fb.score??"—"}</strong>/100</div>
        <div class="coach-subs">${Object.entries(subs).map(([k,v])=>`<span class="pill">${esc(k)}: ${v}</span>`).join(" ")}</div>
        <ul class="coach-list">
          <li><strong>What worked:</strong> ${esc((fb.worked||[]).join(" ")||"—")}</li>
          <li><strong>What to improve:</strong> ${esc((fb.improve||[]).join(" ")||"—")}</li>
          <li><strong>Suggested phrasing:</strong> ${esc(fb.phrasing||"—")}</li>
        </ul>`;
    }

    shell._renderMessages=renderMessages;
    shell._renderCoach=renderCoach;
    shell._renderMeta=renderMeta;

    applyLC(); // set initial visibility
  }

  // ---------- transport ----------
  async function callModel(messages){
    const url = (cfg.apiBase||cfg.workerUrl||"").trim();
    if(!url) return "(no model endpoint configured)";
    const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ model: cfg.model||"llama-3.1-8b-instant", temperature:0.2, stream:false, messages }) });
    if(!r.ok){ const txt=await r.text().catch(()=> ""); throw new Error(`HTTP ${r.status}: ${txt||"no body"}`); }
    const data = await r.json().catch(()=> ({}));
    return data?.content || data?.reply || data?.choices?.[0]?.message?.content || "";
  }

  // ---------- send ----------
  async function sendMessage(userText){
    const shell = mount.querySelector(".reflectiv-chat");
    const renderMessages = shell._renderMessages;
    const renderCoach = shell._renderCoach;

    conversation.push({ role:"user", content:userText });
    renderMessages(); renderCoach();

    const sc = scenariosById.get(currentScenarioId);
    const preface = buildPreface(currentMode, sc);

    const messages = [];
    if(systemPrompt) messages.push({ role:"system", content: systemPrompt });
    messages.push({ role:"system", content: preface });
    messages.push({ role:"user", content: userText });

    try{
      const raw = await callModel(messages);
      const { coach, clean } = extractCoach(raw);
      const computed = scoreReply(userText, clean, currentMode, sc);
      const finalCoach = coach && coach.score && coach.subscores ? coach : computed;
      conversation.push({ role:"assistant", content: clean, _coach: finalCoach });
      renderMessages(); renderCoach();
      if(cfg.analyticsEndpoint){
        fetch(cfg.analyticsEndpoint,{ method:"POST", headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ ts:Date.now(), mode:currentMode, scenarioId:currentScenarioId, turn:conversation.length, score:finalCoach.score, subscores:finalCoach.subscores })}).catch(()=>{});
      }
    }catch(e){
      conversation.push({ role:"assistant", content:`Model error: ${String(e.message||e)}` });
      renderMessages();
    }
  }

  // ---------- data ----------
  async function loadScenarios(){
    try{
      if(cfg && cfg.scenariosUrl){
        const payload = await fetchLocal(cfg.scenariosUrl);
        const arr = Array.isArray(payload)?payload:(payload.scenarios||[]);
        scenarios = arr.map(s=>({
          id:s.id,
          label:s.label||s.id,
          therapeuticArea: normalizeDS(s.therapeuticArea||s.diseaseState||""),
          hcpRole:s.hcpRole||"",
          background:s.background||"",
          goal:s.goal||""
        }));
      } else if (Array.isArray(cfg?.scenarios)){
        scenarios = cfg.scenarios.map(s=>({
          id:s.id,
          label:s.label||s.id,
          therapeuticArea: normalizeDS(s.therapeuticArea||s.diseaseState||""),
          hcpRole:s.hcpRole||"",
          background:s.background||"",
          goal:s.goal||""
        }));
      } else {
        scenarios = [];
      }
    }catch(e){
      console.warn("scenarios load failed:", e);
      scenarios = [];
    }
    scenariosById = new Map(scenarios.map(s=>[s.id,s]));
  }

  // ---------- init ----------
  async function init(){
    try{ cfg = await fetchLocal("./assets/chat/config.json"); }
    catch(e){ console.warn("config.json load failed:", e); cfg = { defaultMode:"sales-simulation" }; }
    try{ systemPrompt = await fetchLocal("./assets/chat/system.md"); }catch{ systemPrompt=""; }
    await loadScenarios();
    try{ buildUI(); }catch(e){
      console.error(e);
      mount.innerHTML = `<div style="border:1px solid #d6dbe3;border-radius:12px;padding:12px;font-family:Poppins,system-ui,sans-serif">
        <strong>Widget error</strong><br>${esc(String(e.message||e))}
      </div>`;
    }
  }

  waitForMount(init);
})();
