/* widget.js — ReflectivAI chat/coach (drop-in, robust loader) */
(function () {
  // mount
  let mount=null;
  function onReady(fn){ if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",fn,{once:true}); else fn(); }
  function waitForMount(cb){
    const tryGet=()=>{ mount=document.getElementById("reflectiv-widget"); if(mount) return cb();
      const obs=new MutationObserver(()=>{ mount=document.getElementById("reflectiv-widget"); if(mount){obs.disconnect(); cb();} });
      obs.observe(document.documentElement,{childList:true,subtree:true}); setTimeout(()=>obs.disconnect(),15000);
    }; onReady(tryGet);
  }

  // helpers
  const qs=s=>mount.querySelector(s), qsa=s=>mount.querySelectorAll(s);
  const el=(t,a={},k=[])=>{ const n=document.createElement(t);
    for(const [k1,v] of Object.entries(a)){
      if(k1==="class") n.className=v;
      else if(k1==="dataset") Object.entries(v).forEach(([dk,dv])=>n.dataset[dk]=dv);
      else if(k1.startsWith("on") && typeof v==="function") n.addEventListener(k1.slice(2),v);
      else if(v!==null && v!==undefined) n.setAttribute(k1,v);
    }
    (Array.isArray(k)?k:[k]).forEach(c=>n.appendChild(typeof c==="string"?document.createTextNode(c):c));
    return n;
  };
  async function fetchJSON(p){ const r=await fetch(p,{cache:"no-store"}); if(!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); }
  function focusMsg(){ const t=qs('textarea.cw-input,textarea[data-role="cw-input"]'); if(t) t.focus({preventScroll:true}); }

  // state
  let cfg=null;
  /** normalized scenarios: {id,disease,profile,title,goal,intro,system} */
  let SC=[];

  const S={ disease:"", mode:"sales-simulation", profileId:"", convo:[], activeScenario:null };

  // normalize various JSON shapes into SC[]
  function normalize(raw){
    const out=[];
    if(Array.isArray(raw)){ raw.forEach(x=>pushOne(x)); }
    else if(raw && Array.isArray(raw.scenarios)){ raw.scenarios.forEach(x=>pushOne(x)); }
    else if(raw && Array.isArray(raw.diseaseStates)){
      raw.diseaseStates.forEach(ds=>{
        const d=ds.name||ds.title||"General";
        (ds.profiles||[]).forEach(p=>{
          const prof=p.name||p.title||"Generalist";
          (p.scenarios||[{}]).forEach(sc=>{
            pushOne({ ...sc, disease:d, profile:prof });
          });
        });
      });
    } else if(raw && raw.byDisease){
      Object.entries(raw.byDisease).forEach(([d,blk])=>{
        const profiles=blk.profiles||blk;
        Object.entries(profiles).forEach(([prof,list])=>{
          (list||[{}]).forEach(sc=>pushOne({ ...sc, disease:d, profile:prof }));
        });
      });
    }
    function pushOne(x){
      const id = x.id || [x.disease||x.therapy||x.area||"General", x.profile||x.hcpTitle||x.title||"Generalist", x.slug||"default"].join("::");
      out.push({
        id,
        disease: x.disease || x.therapy || x.area || "General",
        profile: x.profile || x.hcpTitle || x.title || "Generalist",
        title:   x.title   || x.name || `${(x.profile||"HCP")} — ${(x.disease||"General")}`,
        goal:    x.goal    || x.objective || "",
        intro:   x.intro   || x.opening || "",
        system:  x.system  || x.systemPrompt || ""
      });
    }
    // minimal fallbacks if nothing parsed
    if(!out.length){
      [
        {disease:"HIV",profile:"Internal Medicine MD",title:"Assess PrEP candidate",goal:"Eligibility + adherence support"},
        {disease:"Vaccines",profile:"Pediatrics MD",title:"Address schedule concerns",goal:"ACIP-aligned answers"}
      ].forEach((x,i)=>out.push({id:`fallback::${i}`,...x,intro:"",system:""}));
    }
    return out;
  }

  // UI
  function render(){
    mount.classList.add("cw"); mount.innerHTML="";
    const shell=el("div",{class:"cw-shell"});

    const controls=el("div",{class:"cw-controls"},[
      el("select",{class:"cw-select",id:"ds","aria-label":"Disease State"}),
      el("select",{class:"cw-select",id:"mode","aria-label":"Mode"}),
      el("select",{class:"cw-select",id:"prof","aria-label":"HCP Profile"})
    ]);

    const scen=el("div",{class:"cw-scenario",id:"scenarioBanner"},[
      el("h4",{}, "Scenario"),
      el("p",{id:"scenarioText"},"")
    ]);

    const transcript=el("div",{class:"cw-transcript",id:"t"});

    const composer=el("div",{class:"cw-composer"},[
      el("textarea",{class:"cw-input",id:"msg",placeholder:"Type your message…"}),
      el("button",{class:"cw-btn cw-send",id:"send",type:"button"},"Send"),
      el("button",{class:"cw-btn cw-coach-toggle",id:"coachToggle",type:"button","aria-expanded":"false"},"Open Coach")
    ]);

    const coach=el("div",{class:"coach-panel",id:"coach"},[
      el("div",{class:"coach-title"},"Coach"),
      el("div",{class:"coach-tip",id:"tip"},"Coach is listening for tone. Tips will appear after your next message."),
      el("div",{class:"coach-muted"},"Feedback is scenario-aware.")
    ]);

    shell.appendChild(controls);
    shell.appendChild(scen);
    shell.appendChild(transcript);
    shell.appendChild(composer);
    shell.appendChild(coach);
    mount.appendChild(shell);
  }

  function fillControls(){
    const ds=qs("#ds"), mode=qs("#mode"), prof=qs("#prof");
    // modes
    const modes=(cfg?.modes||["sales-simulation","product-knowledge"]).filter(m=>["sales-simulation","product-knowledge","emotional-assessment"].includes(m));
    mode.innerHTML=""; modes.forEach(m=>mode.appendChild(el("option",{value:m,selected:m===(cfg?.defaultMode||"sales-simulation")},m.replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase()))));

    // diseases
    const diseases=[...new Set(SC.map(s=>s.disease))];
    ds.innerHTML="";
    ds.appendChild(el("option",{value:"",disabled:"",selected:""},"Disease State"));
    diseases.forEach(d=>ds.appendChild(el("option",{value:d}, d.toUpperCase()==="HIV"?"HIV":d)));

    // profiles
    prof.innerHTML="";
    prof.appendChild(el("option",{value:"",disabled:"",selected:""},"HCP Profile"));
  }

  function refreshProfiles(){
    const prof=qs("#prof");
    const list=SC.filter(s=>s.disease===S.disease);
    const unique=new Map();
    list.forEach(s=>{ if(!unique.has(s.profile)) unique.set(s.profile, s.id); });
    prof.innerHTML="";
    prof.appendChild(el("option",{value:"",disabled:"",selected:""},"HCP Profile"));
    unique.forEach((id,label)=>prof.appendChild(el("option",{value:id},label)));
  }

  function setScenario(id){
    S.profileId=id;
    S.activeScenario=SC.find(s=>s.id===id)||null;
    const b=qs("#scenarioBanner"), txt=qs("#scenarioText");
    if(S.activeScenario){
      const s=S.activeScenario;
      const parts=[`${s.disease} · ${s.profile} — ${s.title}`];
      if(s.goal) parts.push(`Goal: ${s.goal}`);
      txt.textContent=parts.join(" | ");
      b.classList.add("show");
    } else {
      b.classList.remove("show");
      txt.textContent="";
    }
    // reset convo
    S.convo=[]; qs("#t").innerHTML="";
  }

  // transcript
  function addMsg(role, text){
    const row=el("div",{class:`msg ${role}`},[ el("div",{class:"bubble"},text) ]);
    const t=qs("#t"); t.appendChild(row); t.scrollTop=t.scrollHeight;
  }

  // coach
  function bindCoach(){
    const btn=qs("#coachToggle"), panel=qs("#coach");
    btn.addEventListener("click",e=>{
      e.preventDefault(); e.stopPropagation();
      const open=panel.classList.toggle("is-open");
      btn.setAttribute("aria-expanded",String(open));
      btn.textContent=open?"Close Coach":"Open Coach";
      focusMsg();
    });
  }
  function coachFeedback(user, ai){
    const tips=[], u=(user||"").toLowerCase(), disease=(S.disease||"").toUpperCase();
    if (/\b(cure|guarantee|100%|no side effects)\b/.test(u)) tips.push("Avoid absolutes. Use labeled indications and evidence levels.");
    if (/(you should|you need to|must)\b/.test(u)) tips.push("Use collaborative phrasing and ask permission.");
    if (disease==="HIV" && !/\b(adherence|prep|sti|screen|creatinine|renal|risk)\b/.test(u)) tips.push("Include adherence support, baseline labs, and risk counseling for PrEP.");
    if (/cost|price|coverage|expensive/.test(u)) tips.push("Offer payer resources and benefits investigation.");
    if (!/sorry|understand|appreciate|thanks|thank you/.test(u)) tips.push("Brief empathy statement before data.");
    if(!tips.length) tips.push("Good structure. Keep questions open-ended and cite labeled data.");
    qs("#tip").textContent="• "+tips.join(" • ");
  }

  // chat
  async function callModel(prompt){
    const api=cfg?.apiBase||cfg?.workerUrl;
    if(!api) return "API endpoint missing in config.json.";
    const systemBase = `Mode=${S.mode}; Disease=${S.disease}; Profile=${S.activeScenario?.profile||"General"}; Respond concisely and compliantly.`;
    const system = S.activeScenario?.system ? `${systemBase}\n${S.activeScenario.system}` : systemBase;
    try{
      const body={ model:cfg?.model||"llama-3.1-8b-instant", stream:false,
        messages:[ {role:"system",content:system}, ...S.convo, {role:"user",content:prompt} ] };
      const r=await fetch(api,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      if(!r.ok) return `Upstream error ${r.status}`;
      const data=await r.json();
      return data?.choices?.[0]?.message?.content ?? data?.content ?? "(no content)";
    }catch(e){ return String(e.message||e); }
  }
  function bindSend(){
    const btn=qs("#send"), ta=qs("#msg"), coach=qs("#coach"), toggle=qs("#coachToggle");
    async function act(){
      const v=ta.value.trim(); if(!v) return;
      addMsg("user",v); S.convo.push({role:"user",content:v});
      ta.value=""; btn.disabled=true;
      const reply=await callModel(v);
      addMsg("ai",reply); S.convo.push({role:"assistant",content:reply});
      coachFeedback(v,reply); coach.classList.add("is-open"); toggle.setAttribute("aria-expanded","true"); toggle.textContent="Close Coach";
      btn.disabled=false; focusMsg();
    }
    btn.addEventListener("click",act);
    ta.addEventListener("keydown",e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); act(); }});
  }

  // init
  async function init(){
    render();
    try{ cfg=await fetchJSON("./config.json"); }catch{ cfg={defaultMode:"sales-simulation"}; }
    try{
      const url=cfg?.scenariosUrl || "./assets/chat/data/scenarios.merged.json";
      const raw=await fetchJSON(url);
      SC=normalize(raw);
    }catch{ SC=normalize([]); }
    // controls
    fillControls();

    // events
    qs("#ds").addEventListener("change",e=>{ S.disease=e.target.value; refreshProfiles(); setScenario(""); });
    qs("#mode").addEventListener("change",e=>{ S.mode=e.target.value; S.convo=[]; qs("#t").innerHTML=""; });
    qs("#prof").addEventListener("change",e=>setScenario(e.target.value));

    bindSend();
    bindCoach();
    focusMsg();
  }

  waitForMount(init);
})();
