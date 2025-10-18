/* assets/chat/widget.js
 * ReflectivAI Chat/Coach — final consolidated version (coach-v2, deterministic scoring v3, EI support)
 * Modes: emotional-assessment | product-knowledge | sales-simulation
 */

(function () {
  // ---------- safe bootstrapping ----------
  let mount = null;
  function onReady(fn){ if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",fn,{once:true});else fn(); }
  function waitForMount(cb){
    const tryGet=()=>{ mount=document.getElementById("reflectiv-widget"); if(mount)return cb();
      const obs=new MutationObserver(()=>{ mount=document.getElementById("reflectiv-widget"); if(mount){obs.disconnect();cb();}});
      obs.observe(document.documentElement,{childList:true,subtree:true});
      setTimeout(()=>obs.disconnect(),15000);
    };
    onReady(tryGet);
  }

  // ---------- config/state ----------
  const LC_OPTIONS=["Emotional Intelligence","Product Knowledge","Sales Simulation"];
  const LC_TO_INTERNAL={
    "Emotional Intelligence":"emotional-assessment",
    "Product Knowledge":"product-knowledge",
    "Sales Simulation":"sales-simulation"
  };

  let cfg=null, systemPrompt="", scenarios=[], scenariosById=new Map();
  let currentMode="sales-simulation", currentScenarioId=null, conversation=[];
  let coachOn=true;

  // ---------- utils ----------
  async function fetchLocal(path){
    const r=await fetch(path,{cache:"no-store"});
    if(!r.ok)throw new Error(`Failed to load ${path} (${r.status})`);
    const ct=r.headers.get("content-type")||"";
    return ct.includes("application/json")?r.json():r.text();
  }

  const esc=s=>String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");
  function sanitizeLLM(raw){
    let s=String(raw||"");
    s=s.replace(/``````/g,"").replace(/<pre[\\s\\S]*?<\\/pre>/gi,"");
    s=s.replace(/^\\s*#{1,6}\\s+/gm,"").replace(/^\\s*(hi|hello|hey)[^\\n]*\\n+/i,"");
    return s.replace(/\\n{3,}/g,"\\n\\n").trim();
  }

  function md(text){
    if(!text)return\"\";let s=esc(text).replace(/\\r\\n?/g,\"\\n\");
    s=s.replace(/\\*\\*([^*\\n]+)\\*\\*/g,\"<strong>$1</strong>\").replace(/`([^`]+)`/g,\"<code>$1</code>\");
    s=s.replace(/^(?:-\\s+|\\*\\s+).+(?:\\n(?:-\\s+|\\*\\s+).+)*/gm,blk=>`<ul>${blk.split(\"\\n\").map(l=>l.replace(/^(?:-\\s+|\\*\\s+)(.+)$/,'<li>$1</li>')).join(\"\")}</ul>`);
    return s.split(/\\n{2,}/).map(p=>p.startsWith(\"<ul>\")?p:`<p>${p.replace(/\\n/g,\"<br>\")}</p>`).join(\"\\n\");
  }

  function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function extractCoach(raw){
    const m=String(raw||\"\").match(/<coach>([\\s\\S]*?)<\\/coach>/i);
    if(!m)return{coach:null,clean:sanitizeLLM(raw)};
    let coach=null;try{coach=JSON.parse(m[1]);}catch{}
    const clean=sanitizeLLM(String(raw).replace(m[0],\"\").trim());
    return{coach,clean};
  }

  // ---------- deterministic local scoring rule ----------
  function scoreReply(userText,replyText,mode){
    const text=String(replyText||\"\"),t=text.toLowerCase(), words=text.split(/\\s+/).filter(Boolean).length, endsWithQ=/\\?\\s*$/.test(text);
    const sig={
      label:/(per label|fda\\s*label|indication|contraindication|boxed warning|guideline|fda)/i.test(text),
      discovery:endsWithQ||/(how|what|could you|can you|help me understand|clarify)\\b/i.test(t),
      objection:/(concern|barrier|risk|coverage|auth|denied|cost|workflow|adherence|side effect|safety)/i.test(t),
      empathy:/(i understand|appreciate|given your time|thanks for|i hear|it sounds like)/i.test(t),
      accuracyCue:/(renal|egfr|creatinine|bmd|ddi|interaction|efficacy|formulary|access|prep|tdf|taf|biktarvy|cabenuva)/i.test(t),
      tooLong:words>180, idealLen:words>=45&&words<=120
    };

    const accuracy=sig.accuracyCue?(sig.label?5:4):3;
    const compliance=sig.label?5:3;
    const discovery=sig.discovery?4:2;
    const objection_handling=sig.objection?(sig.accuracyCue?4:3):2;
    const empathy=sig.empathy?3:2;
    const clarity=sig.tooLong?2:(sig.idealLen?4:3);

    const W={accuracy:.26,compliance:.22,discovery:.16,objection_handling:.14,clarity:.12,empathy:.10};
    const toPct=v=>v*20;
    let overall=(toPct(accuracy)*W.accuracy+
      toPct(compliance)*W.compliance+
      toPct(discovery)*W.discovery+
      toPct(objection_handling)*W.objection_handling+
      toPct(clarity)*W.clarity+
      toPct(empathy)*W.empathy);
    if(sig.idealLen)overall+=3;if(endsWithQ)overall+=3;if(sig.tooLong)overall-=6;
    overall=Math.max(0,Math.min(100,Math.round(overall)));

    const worked=[sig.empathy?\"Acknowledged HCP context\":null,sig.discovery?\"Closed with discovery question\":null,sig.label?\"Referenced label\":null,sig.accuracyCue?\"Tied points to cues\":null].filter(Boolean);
    const improve=[sig.tooLong?\"Tighten to 3–5 sentences\":null,!sig.discovery?\"End with one question\":null,!sig.label?\"Anchor to label\":null,clarity<4?\"Use one idea per sentence\":null].filter(Boolean);
    const phrasing=sig.discovery?\"Given your criteria, which patients would best fit and what next step might you take?\":\"Would it help to align on eligibility criteria and agree on the next step?\";

    return{overall,scores:{accuracy,empathy,clarity,compliance,discovery,objection_handling},feedback:\"Be concise, cite label-guidelines, ask one clear discovery question.\",worked,improve,phrasing,context:{rep_question:String(userText||\"\"),hcp_reply:String(replyText||\"\")},score:overall,subscores:{accuracy,empathy,clarity,compliance,discovery,objection_handling}};
  }

  // ---------- prompt builder ----------
  function buildPreface(mode,sc){
    const COMMON=`# ReflectivAI Output Contract\\nReturn two parts.\\n1) Sales Guidance ...\\n2) <coach>{...}</coach>`.trim();
    if(mode===\"sales-simulation\"){return`# Role\\nYou are a virtual pharma coach ...\\n${COMMON}`;}
    if(mode===\"product-knowledge\"){return`Return concise educational overview. ${COMMON}`;}
    return`Provide reflection guidance on communication. ${COMMON}`;
  }

  // ---------- build UI ----------
  function buildUI(){
    mount.innerHTML=\"\"; if(!mount.classList.contains(\"cw\"))mount.classList.add(\"cw\");
    const shell=el(\"div\",\"reflectiv-chat\");

    const bar=el(\"div\",\"chat-toolbar\"),simControls=el(\"div\",\"sim-controls\");
    const lcLabel=el(\"label\",\"\",\"Learning Center\"); const modeSel=el(\"select\"); modeSel.id=\"cw-mode\";
    LC_OPTIONS.forEach(n=>{const o=el(\"option\");o.value=n;o.textContent=n;modeSel.appendChild(o);});
    const initialLC=Object.keys(LC_TO_INTERNAL).find(k=>LC_TO_INTERNAL[k]===(cfg?.defaultMode||\"sales-simulation\"))||\"Sales Simulation\";
    modeSel.value=initialLC; currentMode=LC_TO_INTERNAL[modeSel.value];
    const coachLabel=el(\"label\",\"\",\"Coach\"),coachSel=el(\"select\");[{v:\"on\",t:\"Coach On\"},{v:\"off\",t:\"Coach Off\"}].forEach(({v,t})=>{const o=el(\"option\");o.value=v;o.textContent=t;coachSel.appendChild(o);});
    coachSel.value=coachOn?\"on\":\"off\"; coachSel.onchange=()=>{coachOn=coachSel.value===\"on\";renderCoach();};

    const diseaseLabel=el(\"label\",\"\",\"Disease State\"),diseaseSelect=el(\"select\");diseaseSelect.id=\"cw-disease\";
    const hcpLabel=el(\"label\",\"\",\"HCP Profiles\"),hcpSelect=el(\"select\");hcpSelect.id=\"cw-hcp\";
    const eiLabel=el(\"label\",\"\",\"EI Profiles\"),eiSelect=el(\"select\");eiSelect.id=\"cw-ei\";

    simControls.append(lcLabel,modeSel,coachLabel,coachSel,diseaseLabel,diseaseSelect,hcpLabel,hcpSelect,eiLabel,eiSelect);
    bar.appendChild(simControls); shell.appendChild(bar);
    const meta=el(\"div\",\"scenario-meta\"); shell.appendChild(meta);
    const msgs=el(\"div\",\"chat-messages\"); shell.appendChild(msgs);
    const inp=el(\"div\",\"chat-input\"),ta=el(\"textarea\"); ta.placeholder=\"Type your message…\"; 
    ta.addEventListener(\"keydown\",e=>{if(e.key===\"Enter\"&&!e.shiftKey){e.preventDefault();send.click();}});
    const send=el(\"button\",\"btn\",\"Send\"); send.onclick=()=>{const t=ta.value.trim();if(!t)return;sendMessage(t);ta.value=\"\";};
    inp.append(ta,send); shell.appendChild(inp);
    mount.appendChild(shell);

    const coachDiv=el(\"div\",\"coach-section\"); coachDiv.innerHTML=\"<h3>Coach Feedback</h3><div class='coach-body muted'>Awaiting first reply…</div>\"; mount.appendChild(coachDiv);

    // ---------- EI dropdown ----------
    const EI_FEATURES=[\"Empathy Cues\",\"Clarity\",\"Confidence\",\"Self-Awareness\",\"Listening Skills\"];
    function populateEI(){eiSelect.innerHTML=\"\";setSelectOptions(eiSelect,EI_FEATURES,true);}
    populateEI();

    // ---------- helpers ----------
    function getDiseaseStates(){
      let ds=Array.isArray(cfg?.diseaseStates)?cfg.diseaseStates.slice():[];
      if(!ds.length&&Array.isArray(scenarios)&&scenarios.length)ds=Array.from(new Set(scenarios.map(s=>(s.therapeuticArea||s.diseaseState||\"\").trim()))).filter(Boolean);
      return ds.map(x=>x.replace(/\\bHiv\\b/gi,\"HIV\"));}
    function setSelectOptions(sel,vals,withPlaceholder){sel.innerHTML=\"\";if(withPlaceholder){const p=el(\"option\",\"\","Select…");p.value=\"\";p.selected=true;p.disabled=true;sel.appendChild(p);}vals.forEach(v=>{if(!v)return;const o=el(\"option\",\"\",typeof v===\"string\"?v:(v.label||v.value));o.value=typeof v===\"string\"?v:(v.value||v.id||v.label);sel.appendChild(o);});}
    function populateDiseases(){setSelectOptions(diseaseSelect,getDiseaseStates(),true);}
    function populateHcpForDisease(ds){const dsKey=(ds||\"\").trim();const scen=scenarios.filter(s=>(s.therapeuticArea||s.diseaseState||\"\").trim().toLowerCase()===dsKey.toLowerCase());if(scen.length){setSelectOptions(hcpSelect,scen.map(s=>({value:s.id,label:s.label||s.id})),true);hcpSelect.disabled=false;}else{setSelectOptions(hcpSelect,[],true);hcpSelect.disabled=true;}}

    function renderMeta(){const sc=scenariosById.get(currentScenarioId);if(!sc||!currentScenarioId||currentMode!==\"sales-simulation\"){meta.innerHTML=\"\";return;}meta.innerHTML=`<div class=\"meta-card\"><div><strong>Therapeutic Area:</strong> ${esc(sc.therapeuticArea||\"—\")}</div><div><strong>HCP Role:</strong> ${esc(sc.hcpRole||\"—\")}</div><div><strong>Background:</strong> ${esc(sc.background||\"—\")}</div><div><strong>Today's Goal:</strong> ${esc(sc.goal||\"—\")}</div></div>`;}
    function renderMessages(){msgs.innerHTML=\"\";for(const m of conversation){const row=el(\"div\",`message ${m.role}`),c=el(\"div\",\"content\");c.innerHTML=md(m.content);row.appendChild(c);msgs.appendChild(row);}msgs.scrollTop=msgs.scrollHeight;}
    function orderedPills(scores){const order=[\"accuracy\",\"empathy\",\"clarity\",\"compliance\",\"discovery\",\"objection_handling\"];return order.filter(k=>k in(scores||{})).map(k=>`<span class=\"pill\">${esc(k)}: ${scores[k]}</span>`).join(\" \");}
    function renderCoach(){const body=coachDiv.querySelector(\".coach-body\"); if(!coachOn||currentMode===\"product-knowledge\"){coachDiv.style.display=\"none\";return;} coachDiv.style.display=\"\"; const last=conversation.at(-1); if(!(last&&last.role===\"assistant\"&&last._coach)){body.innerHTML=\"<span class='muted'>Awaiting first assistant reply…</span>\";return;} const fb=last._coach,scores=fb.scores||fb.subscores||{}; body.innerHTML=`<div class='coach-score'>Score: <strong>${fb.overall??fb.score??\"—\"}</strong>/100</div><div class='coach-subs'>${orderedPills(scores)}</div><ul><li><strong>What worked:</strong> ${esc(fb.worked?.join(\". \")||\"—\")}</li><li><strong>What to improve:</strong> ${esc(fb.improve?.join(\". \")||fb.feedback||\"—\")}</li><li><strong>Suggested phrasing:</strong> ${esc(fb.phrasing||\"—\")}</li></ul>`;}

    function applyModeVisibility(){
      currentMode=LC_TO_INTERNAL[modeSel.value];
      const pk=currentMode===\"product-knowledge\";
      coachLabel.classList.toggle(\"hidden\",pk);coachSel.classList.toggle(\"hidden\",pk);
      if(currentMode===\"sales-simulation\"){diseaseLabel.classList.remove(\"hidden\");hcpLabel.classList.remove(\"hidden\");eiLabel.classList.remove(\"hidden\");diseaseSelect.classList.remove(\"hidden\");hcpSelect.classList.remove(\"hidden\");eiSelect.classList.remove(\"hidden\");populateDiseases();}
      else if(currentMode===\"product-knowledge\"){diseaseLabel.classList.remove(\"hidden\");diseaseSelect.classList.remove(\"hidden\");hcpLabel.classList.add(\"hidden\");hcpSelect.classList.add(\"hidden\");eiLabel.classList.add(\"hidden\");eiSelect.classList.add(\"hidden\");populateDiseases();}
      else{diseaseLabel.classList.add(\"hidden\");hcpLabel.classList.add(\"hidden\");eiLabel.classList.remove(\"hidden\");diseaseSelect.classList.add(\"hidden\");hcpSelect.classList.add(\"hidden\");eiSelect.classList.remove(\"hidden\");}
      currentScenarioId=null;conversation=[];renderMessages();renderCoach();renderMeta();
    }

    modeSel.addEventListener(\"change\",applyModeVisibility);
    diseaseSelect.addEventListener(\"change\",()=>{const ds=diseaseSelect.value||\"\";if(!ds)return;if(currentMode===\"sales-simulation\")populateHcpForDisease(ds);else if(currentMode===\"product-knowledge\")currentScenarioId=null;conversation=[];renderMessages();renderCoach();renderMeta();});
    hcpSelect.addEventListener(\"change\",()=>{const sel=hcpSelect.value||\"\",sc=scenariosById.get(sel);currentScenarioId=sc?sc.id:null;conversation=[];renderMessages();renderCoach();renderMeta();});

    shell._renderMessages=renderMessages; shell._renderCoach=renderCoach; shell._renderMeta=renderMeta;
    applyModeVisibility();
  }

  // ---------- transport ----------
  async function callModel(messages){
    const r=await fetch((cfg?.apiBase||cfg?.workerUrl||\"\").trim(),{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({model:cfg?.model||\"llama-3.1-8b-instant\",temperature:0.2,stream:!!cfg?.stream,messages})});
    if(!r.ok){const txt=await r.text().catch(()=>\"\");throw new Error(`HTTP ${r.status}: ${txt||\"no body\"}`);}
    const d=await r.json().catch(()=>({}));return d?.content||d?.reply||d?.choices?.[0]?.message?.content||\"\";
  }

  // ---------- send ----------
  async function sendMessage(userText){
    const shell=mount.querySelector(\".reflectiv-chat\"),renderMessages=shell._renderMessages,renderCoach=shell._renderCoach;
    conversation.push({role:\"user\",content:userText}); renderMessages(); renderCoach();

    const sc=scenariosById.get(currentScenarioId),preface=buildPreface(currentMode,sc);
    const messages=[]; if(systemPrompt)messages.push({role:\"system\",content:systemPrompt});
    messages.push({role:\"system\",content:preface}); messages.push({role:\"user\",content:userText});

    try{
      const raw=await callModel(messages); const {coach,clean}=extractCoach(raw);
      const computed=scoreReply(userText,clean,currentMode);
      const finalCoach=coach&&(coach.scores||coach.subscores)?{...coach,overall:coach.overall??coach.score??computed.overall,scores:coach.scores||coach.subscores,feedback:coach.feedback||computed.feedback,worked:coach.worked?.length?coach.worked:computed.worked,improve:coach.improve?.length?coach.improve:computed.improve,phrasing:coach.phrasing||computed.phrasing,context:coach.context||{rep_question:userText,hcp_reply:clean},score:coach.overall??coach.score??computed.overall,subscores:coach.scores||coach.subscores}:computed;
      conversation.push({role:\"assistant\",content:clean,_coach:finalCoach}); renderMessages(); renderCoach();

      if(cfg?.analyticsEndpoint){
        fetch(cfg.analyticsEndpoint,{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({ts:Date.now(),schema:cfg.schemaVersion||\"coach-v2\",mode:currentMode,scenarioId:currentScenarioId,turn:conversation.length,context:finalCoach.context,overall:finalCoach.overall,scores:finalCoach.scores})}).catch(()=>{});
      }
    }catch(e){conversation.push({role:\"assistant\",content:`Model error: ${e.message||e}`});renderMessages();}
  }

  // ---------- scenarios loader ----------
  async function loadScenarios(){
    if(cfg?.scenariosUrl){
      const payload=await fetchLocal(cfg.scenariosUrl);
      const arr=Array.isArray(payload)?payload:(payload.scenarios||[]);
      scenarios=arr.map(s=>({id:s.id,label:s.label||s.id,therapeuticArea:s.therapeuticArea||s.diseaseState||\"\",hcpRole:s.hcpRole||\"\",background:s.background||\"\",goal:s.goal||\"\"}));
    }else if(Array.isArray(cfg?.scenarios)){
      scenarios=cfg.scenarios.map(s=>({id:s.id,label:s.label||s.id,therapeuticArea:s.therapeuticArea||s.diseaseState||\"\",hcpRole:s.hcpRole||\"\",background:s.background||\"\",goal:s.goal||\"\"}));
    }else scenarios=[];
    scenarios.forEach(s=>{if(/^hiv\\b/i.test(s.therapeuticArea))s.therapeuticArea=\"HIV\";});
    scenariosById=new Map(scenarios.map(s=>[s.id,s]));
  }

  // ---------- init ----------
  async function init(){
    try{cfg=await fetchLocal(\"./assets/chat/config.json\");}catch(e){console.error(\"config.json load failed\",e);cfg={defaultMode:\"sales-simulation\"};}
    try{systemPrompt=await fetchLocal(\"./assets/chat/system.md\");}catch{systemPrompt=\"\";}
    await loadScenarios(); buildUI();
  }

  waitForMount(init);
})();

