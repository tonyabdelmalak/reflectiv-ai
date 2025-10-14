/* widget.js v4c1 — defensive boot fix */
(function () {
  // ensure DOM ready even if defer is missing
  function onReady(fn){ if (document.readyState==="loading") document.addEventListener("DOMContentLoaded",fn,{once:true}); else fn(); }
  onReady(init);

  function init(){
  try {
    const STORE_KEY = "reflectivai:coach:v4c";
    const DEFAULT_MODE = "sales-simulation";
    const COACH_VALUES = ["Coach On", "Coach Off"];
    const MODEL_NAME = "llama-3.1-8b-instant";
    const TEMP = 0.2;

    const CATALOG = {
      "HIV":[
        {id:"im_md",label:"Internal Medicine MD",brief:"Primary care physician managing prevention and chronic care. Goal: assess PrEP suitability and adherence support."},
        {id:"np",label:"Nurse Practitioner",brief:"NP balances prevention counseling with workflow realities. Goal: clarify risk screening and follow-up cadence."},
        {id:"pa",label:"Physician Assistant",brief:"PA focuses on practical initiation steps. Goal: reduce process friction for starts and refills."},
        {id:"id",label:"Infectious Disease Specialist",brief:"Specialist prioritizes risk stratification and resistance. Goal: remain squarely on-label, cite guideline-aligned data."}
      ],
      "Cancer":[
        {id:"onco",label:"Oncologist",brief:"Treats solid and hematologic tumors. Goal: concise, on-label efficacy and safety balanced for tumor type."},
        {id:"np_onc",label:"Nurse Practitioner",brief:"Coordinates adverse event management. Goal: practical monitoring and dose-mod guidance per label."},
        {id:"pa_onc",label:"Physician Assistant",brief:"Executes protocols and logistics. Goal: ensure prior-auth and infusion flow are clear."}
      ],
      "Vaccines":[
        {id:"im_doc",label:"Internal Medicine Doctor",brief:"Manages adult immunization catch-up. Goal: eligibility, timing, and co-admin clarity."},
        {id:"np_vax",label:"Nurse Practitioner",brief:"Addresses hesitancy and access. Goal: concise risk/benefit aligned to ACIP."},
        {id:"pa_vax",label:"Physician Assistant",brief:"Focus on screening and contraindications. Goal: quick green-light criteria."}
      ],
      "COVID":[
        {id:"pulm",label:"Pulmonologist",brief:"Manages post-acute respiratory impacts. Goal: on-label data for indicated populations."},
        {id:"pa_covid",label:"Physician Assistant",brief:"Coordinates testing and triage. Goal: eligibility decision tree clarity."},
        {id:"np_covid",label:"Nurse Practitioner",brief:"Covers counseling and follow-up. Goal: clear adverse event guidance per label."}
      ],
      "Cardiovascular":[
        {id:"np_cv",label:"Nurse Practitioner",brief:"Manages risk factors and titration. Goal: crisp benefit-risk framed by guidelines."},
        {id:"im_cv",label:"Internal Medicine MD",brief:"Balances comorbidities and polypharmacy. Goal: indication fit and drug-drug awareness."}
      ]
    };

    // -------- config --------
    let CFG = { apiBase:"", workerEndpoint:"", model:MODEL_NAME, stream:false };
    (async () => {
      try {
        if (window.REFLECTIV_CFG) { CFG = {...CFG, ...window.REFLECTIV_CFG}; return; }
        const r = await fetch("./config.json",{cache:"no-store"});
        if (r.ok){ const j=await r.json(); CFG={...CFG,...j, apiBase:j.apiBase||j.workerEndpoint||""}; }
      } catch {}
    })();

    // -------- helpers --------
    function byLabel(prefixes){
      const all=[...document.querySelectorAll("label, h2, h3, h4, p, span, strong")];
      const node=all.find(el=>prefixes.some(p=>(el.textContent||"").trim().toLowerCase().startsWith(p)));
      if(!node) return null;
      if(node.tagName==="LABEL"){
        const id=node.getAttribute("for");
        if(id){ const t=document.getElementById(id); if(t && t.tagName==="SELECT") return t; }
        const s=node.parentElement && node.parentElement.querySelector && node.parentElement.querySelector("select");
        if(s) return s;
      }
      const scope=node.closest("section, form, .container, .field, .row")||document;
      return scope.querySelector("select");
    }
    function ensureShell(){
      let msgs=document.querySelector(".cw-messages")||document.getElementById("chat-log");
      if(msgs) return msgs;
      const sec=document.createElement("section");
      sec.className="cw-fallback";
      sec.innerHTML=`
        <div class="scenario-brief"></div>
        <div class="cw-messages" role="log" aria-live="polite"></div>
        <div class="coach-panel" data-hidden="true">
          <div class="coach-head"><strong>Coach</strong><div class="ei-badges"></div></div>
          <div class="coach-body"></div>
          <div class="coach-score"></div>
        </div>`;
      document.body.appendChild(sec);
      return sec.querySelector(".cw-messages");
    }
    function getIO(){
      const ta=document.querySelector(".chat-input textarea")||document.getElementById("message")||document.querySelector("textarea");
      let btn=document.querySelector('button[type="submit"]')||document.querySelector(".chat-send");
      if(!btn){ btn=document.createElement("button"); btn.className="chat-send"; btn.type="button"; btn.textContent="Send"; (ta&&ta.parentElement?ta.parentElement:document.body).appendChild(btn); }
      return {ta,btn};
    }
    function coachPanel(){
      let panel=document.querySelector(".coach-panel");
      if(panel) return panel;
      // attach next to messages if present, else body
      panel=document.createElement("div");
      panel.className="coach-panel";
      panel.setAttribute("data-hidden","true");
      panel.innerHTML=`<div class="coach-head"><strong>Coach</strong><div class="ei-badges"></div></div><div class="coach-body"></div><div class="coach-score"></div>`;
      const anchor=document.querySelector(".cw-messages");
      (anchor&&anchor.parentElement?anchor.parentElement:document.body).appendChild(panel);
      return panel;
    }
    function setOptions(sel, items){
      if(!sel) return;
      const prev=sel.value;
      sel.innerHTML=items.map(o=>`<option value="${escAttr(o.v)}">${esc(o.t)}</option>`).join("");
      if(items.some(o=>o.v===prev)) sel.value=prev;
    }
    function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m]));}
    function escAttr(s){return esc(s).replace(/"/g,"&quot;");}
    function linkify(t){return String(t).replace(/(https?:\/\/[^\s)]+|www\.[^\s)]+)/g,m=>`<a href="${m.startsWith('http')?m:'https://'+m}" target="_blank" rel="noopener">${m}</a>`);}
    function looseJson(text){ try{return JSON.parse(text);}catch{} const i=text.indexOf("{"), j=text.lastIndexOf("}"); if(i>=0&&j>i){ try{return JSON.parse(text.slice(i,j+1));}catch{} } return null; }
    function sanitizeHtml(s){ const d=document.createElement("div"); d.innerHTML=s||""; d.querySelectorAll("script,style,iframe,object").forEach(n=>n.remove()); d.querySelectorAll("*").forEach(el=>{[...el.attributes].forEach(a=>{if(a.name.startsWith("on")) el.removeAttribute(a.name);});}); return d.innerHTML;}
    function num(x){return Math.max(0,Math.min(5,Number(x)||0)).toFixed(1).replace(/\.0$/,"");}

    // -------- state --------
    const persisted = (()=>{try{return JSON.parse(localStorage.getItem(STORE_KEY)||"{}");}catch{return {};}})();
    let mode   = persisted.mode   || DEFAULT_MODE;
    let coachOn= persisted.coachOn!==undefined ? persisted.coachOn : true;
    let disease= persisted.disease|| "HIV";
    let hcpId  = persisted.hcp    || (CATALOG[disease]?CATALOG[disease][0].id:"");
    let conversation=[];
    let scores={turns:[],avg:0};
    function persist(){ try{localStorage.setItem(STORE_KEY, JSON.stringify({mode,coachOn,disease,hcp:hcpId}));}catch{} }
    function resetContext(keepBrief=true){
      conversation=[]; scores={turns:[],avg:0};
      const panel=coachPanel();
      const body=panel.querySelector(".coach-body"); const badges=panel.querySelector(".ei-badges"); const score=panel.querySelector(".coach-score");
      if(body) body.innerHTML=""; if(badges) badges.innerHTML=""; if(score) score.textContent="";
      if(!keepBrief){ const brief=document.querySelector(".scenario-brief"); if(brief) brief.innerHTML=""; }
    }

    // -------- mount shell early to avoid nulls --------
    const messagesEl = ensureShell();
    const {ta:inputEl, btn:sendBtn} = getIO();

    // -------- wiring --------
    const modeSel   = byLabel(["learning center","mode"]);
    const coachSel  = byLabel(["coach"]);
    const diseaseSel= byLabel(["disease / product knowledge","disease state","disease"]);
    const hcpSel    = byLabel(["hcp profile","hcp profiles / scenarios"]);

    if(modeSel){
      setOptions(modeSel,[{v:"sales-simulation",t:"Sales Simulation"},{v:"product-knowledge",t:"Product Knowledge"}]);
      modeSel.value=mode;
      modeSel.addEventListener("change",()=>{ mode=modeSel.value; persist(); handleCoachVisibility(); resetContext(); updateScenarioBrief(); });
    }
    if(coachSel){
      setOptions(coachSel, COACH_VALUES.map(v=>({v,t:v})));
      coachSel.value = coachOn?"Coach On":"Coach Off";
      coachSel.addEventListener("change",()=>{ coachOn = coachSel.value==="Coach On"; persist(); resetContext(); handleCoachVisibility(); });
    }
    if(diseaseSel){
      setOptions(diseaseSel, Object.keys(CATALOG).map(k=>({v:k,t:k})));
      diseaseSel.value=disease;
      diseaseSel.addEventListener("change",()=>{ disease=diseaseSel.value; rehydrateHCP(); persist(); resetContext(false); updateScenarioBrief(); });
    }
    function rehydrateHCP(){
      if(!hcpSel) return;
      const list=CATALOG[disease]||[];
      setOptions(hcpSel, list.map(i=>({v:i.id,t:i.label})));
      if(!list.some(x=>x.id===hcpId)) hcpId = list[0]?list[0].id:"";
      hcpSel.value = hcpId;
    }
    if(hcpSel){
      rehydrateHCP();
      hcpSel.addEventListener("change",()=>{ hcpId=hcpSel.value; persist(); resetContext(false); updateScenarioBrief(); });
    }

    function handleCoachVisibility(){
      const panel=coachPanel();
      const hide = mode!=="sales-simulation";
      if(coachSel && coachSel.parentElement) coachSel.parentElement.style.display = hide ? "none" : "";
      panel.setAttribute("data-hidden", hide || !coachOn ? "true" : "false");
    }
    handleCoachVisibility();

    function currentBrief(){
      const list=CATALOG[disease]||[]; const found=list.find(x=>x.id===hcpId)||list[0];
      return found?found.brief:"";
    }
    function updateScenarioBrief(){
      const host=document.querySelector(".scenario-brief"); if(!host) return;
      const list=CATALOG[disease]||[]; const found=list.find(x=>x.id===hcpId);
      host.innerHTML=`<div class="card"><div class="row"><div class="col"><strong>${esc(disease)}</strong> · <span>${esc(found?found.label:"HCP")}</span></div></div><p>${esc(found?found.brief:"")}</p></div>`;
    }
    updateScenarioBrief();

    function addBubble(role,text){
      const row=document.createElement("div"); row.className="row";
      const b=document.createElement("div"); b.className="bubble "+(role==="user"?"user":"assistant");
      b.innerHTML=linkify(esc(text)); row.appendChild(b); messagesEl.appendChild(row); messagesEl.scrollTop=messagesEl.scrollHeight;
    }
    function addTyping(){ const row=document.createElement("div"); row.className="row"; row.innerHTML=`<div class="bubble assistant"><span class="dots"><i></i><i></i><i></i></span></div>`; messagesEl.appendChild(row); messagesEl.scrollTop=messagesEl.scrollHeight; return row; }
    function removeTyping(n){ if(n&&n.parentNode) n.parentNode.removeChild(n); }

    sendBtn && sendBtn.addEventListener("click", onSend);
    inputEl && inputEl.addEventListener("keydown", e=>{ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); onSend(); } });

    async function onSend(){
      const txt=(inputEl&&inputEl.value||"").trim(); if(!txt) return;
      addBubble("user", txt); if(inputEl) inputEl.value="";
      conversation.push({role:"user",content:txt});

      const sys = await loadSystemPrimer();
      const preface = mode==="sales-simulation"
        ? `You are role-playing as an HCP in ${disease}. Use only on-label language. Keep replies concise. Scenario: ${currentBrief()}`
        : `You are answering Product Knowledge questions in ${disease}. Use only on-label language. Provide concise, source-named support when relevant.`;
      const msgs=[{role:"system",content:sys},{role:"system",content:preface},...conversation];

      const typing=addTyping();
      let assistant="Upstream error. Try again.";
      try { assistant = await chatCall(msgs); } catch {}
      removeTyping(typing);
      addBubble("assistant", assistant);
      conversation.push({role:"assistant",content:assistant});

      if(mode==="sales-simulation" && coachOn){ await runCoach(txt); }
    }

    async function runCoach(latestUserMsg){
      const panel=coachPanel();
      const body=panel.querySelector(".coach-body");
      const badges=panel.querySelector(".ei-badges");
      const scoreEl=panel.querySelector(".coach-score");
      panel.setAttribute("data-hidden","false");

      const sys=`You are a strict coaching evaluator for compliant pharma sales role-plays.
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

      const scenarioCtx=`Disease: ${disease}. HCP: ${(CATALOG[disease]||[]).find(x=>x.id===hcpId)?.label||"HCP"}.
Brief: ${currentBrief()}
User message: """${latestUserMsg}"""`;

      const evalMsgs=[{role:"system",content:sys},{role:"user",content:scenarioCtx}];

      let out=null;
      try{
        const raw=await chatCall(evalMsgs); out=looseJson(raw);
        if(!out){ const raw2=await chatCall(evalMsgs); out=looseJson(raw2); }
      }catch{}

      if(!out||!out.rubric||!out.ei){
        body.innerHTML=`<div class="coach-card"><p>Coach unavailable. Using neutral fallback.</p><ul><li>Lead with on-label, fair-balance language.</li><li>Ask one clarifying question.</li><li>Close with a clear next step.</li></ul></div>`;
        badges.innerHTML=""; scoreEl.textContent=""; return;
      }

      const fail = (out.rubric.accuracy===0 || out.rubric.compliance===0);
      const W={accuracy:3,compliance:3,discovery:2,objection:2,value:2,empathy:1,clarity:1};
      const sum=Object.entries(out.rubric).reduce((a,[k,v])=>a+(v*(W[k]||0)),0);
      const turnScore=Math.round(((sum/70)*10)*10)/10;
      scores.turns.push(turnScore);
      const avg=Math.round((scores.turns.reduce((a,b)=>a+b,0)/scores.turns.length)*10)/10; scores.avg=isFinite(avg)?avg:0;

      const alertHtml= fail ? `<div class="coach-alert">Compliance/Accuracy risk detected — lead with on-label, fair-balance language.</div>` : "";
      body.innerHTML=`<div class="coach-card">${alertHtml}${sanitizeHtml(out.feedback_html)}</div>`;

      badges.innerHTML=`<span class="chip tone-${esc(out.ei.tone_label||'neutral')}">${(out.ei.tone_label||'neutral').replace(/^\w/,c=>c.toUpperCase())}</span><span class="chip emp">Empathy ${num(out.ei.empathy_score)}/5</span><span class="snippet">“${esc(out.ei.evidence_quote||"") }”</span>`;
      scoreEl.textContent=`Score — Turn: ${turnScore.toFixed(1)} | Avg: ${scores.avg.toFixed(1)}`;
    }

    async function chatCall(messages){
      const url = CFG.apiBase || CFG.workerEndpoint;
      if(!url) throw new Error("No API endpoint configured");
      const res = await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model:CFG.model||MODEL_NAME,temperature:TEMP,messages})});
      if(!res.ok) throw new Error("Upstream error");
      const data = await res.json().catch(()=>null);
      const content = data?.content || data?.choices?.[0]?.message?.content || data?.output_text || "";
      if(!content) throw new Error("Empty response");
      return String(content);
    }

    async function loadSystemPrimer(){
      try{ const r=await fetch("assets/chat/system.md",{cache:"no-store"}); if(r.ok) return await r.text(); }catch{}
      return "You are a compliant, on-label pharma conversational agent. Avoid PHI. Provide concise, balanced information.";
    }

    // seed panel with EI framing safely
    (function seedEI(){
      const panel=coachPanel();
      const body=panel.querySelector(".coach-body");
      if(body && !body.innerHTML){
        body.innerHTML=`<div class="coach-card muted"><p><strong>Coach is listening for tone.</strong> You’ll see tips on empathy, clarity, and objection handling as you practice.</p><ul><li>Ask one clarifying question before recommending.</li><li>Mirror the HCP’s concern.</li><li>Close with a mutual next step.</li></ul></div>`;
      }
      const badges=panel.querySelector(".ei-badges");
      if(badges && !badges.innerHTML){ badges.innerHTML=`<span class="chip">Empathy 0/5</span><span class="chip tone-neutral">Neutral</span>`; }
      handleCoachVisibility();
    })();

    // expose minimal hooks
    window.__ReflectivWidgetV4c = { resetContext, persist };
  } catch (e) {
    // prevent total failure; show a small notice so the widget never "disappears"
    try{
      const sec=document.createElement("section"); sec.className="cw-fallback";
      sec.innerHTML=`<div class="cw-messages"><div class="row"><div class="bubble assistant">Widget boot error. Check console.</div></div></div>`;
      document.body.appendChild(sec);
    }catch{}
    console.error("[widget.js] fatal boot error:", e);
  }
  } // end init()
})();
