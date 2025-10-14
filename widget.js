/* widget.js — ReflectivAI chat/coach (drop-in, self-contained) */
(function () {
  // boot
  let mount=null;
  function onReady(fn){ if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",fn,{once:true}); else fn(); }
  function waitForMount(cb){
    const tryGet=()=>{ mount=document.getElementById("reflectiv-widget"); if(mount)return cb();
      const obs=new MutationObserver(()=>{ mount=document.getElementById("reflectiv-widget"); if(mount){obs.disconnect(); cb();} });
      obs.observe(document.documentElement,{childList:true,subtree:true}); setTimeout(()=>obs.disconnect(),15000);
    }; onReady(tryGet);
  }

  // helpers
  const qs  = s=>mount.querySelector(s);
  const qsa = s=>mount.querySelectorAll(s);
  function focusMsg(){ const el=qs('textarea.cw-input,textarea[data-role="cw-input"]'); if(el) el.focus({preventScroll:true}); }
  function el(tag,attrs={},kids=[]){ const n=document.createElement(tag);
    for(const [k,v] of Object.entries(attrs)){
      if(k==="class") n.className=v;
      else if(k==="dataset") Object.entries(v).forEach(([dk,dv])=>n.dataset[dk]=dv);
      else if(k.startsWith("on") && typeof v==="function") n.addEventListener(k.slice(2),v);
      else if(v!==null && v!==undefined) n.setAttribute(k,v);
    }
    (Array.isArray(kids)?kids:[kids]).forEach(c=>n.appendChild(typeof c==="string"?document.createTextNode(c):c));
    return n;
  }
  async function fetchJSON(path){ const r=await fetch(path,{cache:"no-store"}); if(!r.ok) throw new Error(`${path} ${r.status}`); return r.json(); }

  // state
  let cfg=null, scenarios=[];
  const state={ disease:"", mode:"sales-simulation", profile:"", conversation:[] };

  // UI
  function render(){
    mount.classList.add("cw"); mount.innerHTML="";
    const shell=el("div",{class:"cw-shell"});
    const controls=el("div",{class:"cw-controls"},[
      el("select",{class:"cw-select",id:"dsSelect","aria-label":"Disease State"}),
      el("select",{class:"cw-select",id:"modeSelect","aria-label":"Mode"}),
      el("select",{class:"cw-select",id:"profileSelect","aria-label":"HCP Profile"})
    ]);
    const transcript=el("div",{class:"cw-transcript",id:"transcript"});
    const composer=el("div",{class:"cw-composer"},[
      el("textarea",{class:"cw-input",id:"msgInput",placeholder:"Type your message…"}),
      el("button",{class:"cw-send",id:"sendBtn",type:"button"},"Send"),
      el("button",{class:"cw-coach-toggle",id:"coachToggle","data-coach-toggle":"",type:"button","aria-expanded":"false"},"Open Coach")
    ]);
    const coachPanel=el("div",{class:"coach-panel",id:"coachPanel"},[
      el("div",{class:"coach-title"},"Coach"),
      el("div",{class:"coach-tip",id:"coachTip"},"Coach is listening for tone. Tips will appear after your next message."),
      el("div",{class:"coach-muted"},"Feedback is scenario-aware.")
    ]);
    shell.appendChild(controls);
    shell.appendChild(transcript);
    shell.appendChild(composer);
    shell.appendChild(coachPanel);
    mount.appendChild(shell);
  }

  function populateControls(){
    const ds=qs("#dsSelect"), mode=qs("#modeSelect"), prof=qs("#profileSelect");
    const modes=["sales-simulation","product-knowledge"];
    mode.innerHTML="";
    modes.forEach(m=>mode.appendChild(el("option",{value:m,selected:m===(cfg?.defaultMode||"sales-simulation")},m.replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase()))));
    const derived=Array.from(new Set(scenarios.map(s=>s.disease||s.therapy||s.area).filter(Boolean)));
    const diseases=derived.length?derived:["HIV","Oncology","Vaccines","Hepatitis B","Cardiology","Pulmonology"];
    ds.innerHTML="";
    ds.appendChild(el("option",{value:"",disabled:"",selected:""},"Disease State"));
    diseases.forEach(name=>ds.appendChild(el("option",{value:name},name.toUpperCase()==="HIV"?"HIV":name)));
    prof.innerHTML="";
    prof.appendChild(el("option",{value:"",disabled:"",selected:""},"HCP Profile"));
  }

  function refreshProfiles(){
    const prof=qs("#profileSelect");
    const chosen=state.disease;
    let list=scenarios.filter(s=>(s.disease||s.therapy||s.area)===chosen);
    if(!list.length){
      const fb={
        "HIV":[{id:"im-md",label:"Internal Medicine MD"},{id:"fp-md",label:"Family Practice MD"}],
        "Oncology":[{id:"hemonc",label:"Hematology/Oncology MD"}],
        "Vaccines":[{id:"peds",label:"Pediatrics MD"}],
        "Hepatitis B":[{id:"gi",label:"Gastroenterology MD"}],
        "Cardiology":[{id:"cards",label:"Cardiology MD"}],
        "Pulmonology":[{id:"pulm",label:"Pulmonology MD"}]
      };
      list=(fb[chosen]||[]).map(x=>({id:x.id,profile:x.label,disease:chosen}));
    }
    const unique=new Map();
    list.forEach(s=>{ const label=s.profile||s.hcpTitle||s.title||"Generalist"; const id=s.id||label; if(!unique.has(label)) unique.set(label,id); });
    prof.innerHTML="";
    prof.appendChild(el("option",{value:"",disabled:"",selected:""},"HCP Profile"));
    unique.forEach((id,label)=>prof.appendChild(el("option",{value:id},label)));
  }

  // transcript
  function addMsg(role,text){
    const row=el("div",{class:`msg ${role}`},[ el("div",{class:"bubble"},text) ]);
    const t=qs("#transcript"); t.appendChild(row); t.scrollTop=t.scrollHeight;
  }

  // coach
  function bindCoachToggle(){
    const btn=qs("#coachToggle"), panel=qs("#coachPanel");
    btn.addEventListener("click",e=>{
      e.preventDefault(); e.stopPropagation();
      const open=panel.classList.toggle("is-open");
      btn.setAttribute("aria-expanded",String(open));
      btn.textContent=open?"Close Coach":"Open Coach";
      focusMsg();
    });
  }

  function coachFeedback(userText, aiText){
    const tips=[]; const t=(userText||"").toLowerCase();
    if (/\b(cure|guarantee|100%|no side effects)\b/.test(t)) tips.push("Avoid absolutes. Use labeled indications and evidence levels.");
    if (/(you should|you need to|must)\b/.test(t)) tips.push("Use collaborative phrasing and ask permission.");
    if ((state.disease||"").toUpperCase()==="HIV" && !/\b(adherence|prep|sti|screen|creatinine|renal|risk)\b/.test(t)) tips.push("Include adherence support, baseline labs, and risk counseling for PrEP.");
    if (/cost|price|coverage|expensive/.test(t)) tips.push("Offer payer resources and benefits investigation.");
    if (!/sorry|understand|appreciate|thanks|thank you/.test(t)) tips.push("Acknowledge the HCP perspective before providing data.");
    if(!tips.length) tips.push("Good structure. Keep questions open-ended and cite labeled data.");
    qs("#coachTip").textContent="• "+tips.join(" • ");
  }

  // chat
  async function sendToModel(prompt){
    const api=cfg?.apiBase||cfg?.workerUrl;
    if(!api) return "API endpoint missing in config.json.";
    try{
      const body={
        model:cfg?.model||"llama-3.1-8b-instant",
        stream:false,
        messages:[
          {role:"system",content:`Mode=${state.mode}; Disease=${state.disease}; Profile=${state.profile||"General"}; Respond concisely and compliantly.`},
          ...state.conversation,
          {role:"user",content:prompt}
        ]
      };
      const r=await fetch(api,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      if(!r.ok) return `Upstream error ${r.status}`;
      const data=await r.json();
      return data?.choices?.[0]?.message?.content ?? data?.content ?? "(no content)";
    }catch(err){ return String(err.message||err); }
  }

  function bindSend(){
    const btn=qs("#sendBtn"), ta=qs("#msgInput"), panel=qs("#coachPanel"), toggle=qs("#coachToggle");
    async function act(){
      const val=ta.value.trim(); if(!val) return;
      addMsg("user",val); state.conversation.push({role:"user",content:val});
      ta.value=""; btn.disabled=true;
      const reply=await sendToModel(val);
      addMsg("ai",reply); state.conversation.push({role:"assistant",content:reply});
      coachFeedback(val,reply); panel.classList.add("is-open"); toggle.setAttribute("aria-expanded","true"); toggle.textContent="Close Coach";
      btn.disabled=false; focusMsg();
    }
    btn.addEventListener("click",act);
    ta.addEventListener("keydown",e=>{ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); act(); }});
  }

  // init
  async function init(){
    render();
    try{ cfg=await fetchJSON("./config.json"); }catch{ cfg={ defaultMode:"sales-simulation" }; }
    try{
      const url=cfg?.scenariosUrl||"./assets/chat/data/scenarios.merged.json";
      const data=await fetchJSON(url);
      scenarios=Array.isArray(data)?data:[];
    }catch{ scenarios=[]; }
    populateControls();

    qs("#dsSelect").addEventListener("change",e=>{ state.disease=e.target.value; refreshProfiles(); state.conversation=[]; qs("#transcript").innerHTML=""; });
    qs("#modeSelect").addEventListener("change",e=>{ state.mode=e.target.value; state.conversation=[]; qs("#transcript").innerHTML=""; });
    qs("#profileSelect").addEventListener("change",e=>{ state.profile=e.target.value; state.conversation=[]; qs("#transcript").innerHTML=""; });

    bindSend();
    bindCoachToggle();
    focusMsg();
  }

  waitForMount(init);
})();
