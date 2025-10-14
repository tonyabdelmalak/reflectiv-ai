/* widget.js v4c4 — baked-in fallback + floating launcher + never-disappear */
(function () {
  function onReady(fn){ if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",fn,{once:true}); else fn(); }
  onReady(init);

  function init(){
    const banner = mkBanner();
    status("booting…");

    try{
      // ---- constants ----
      const STORE_KEY="reflectivai:coach:v4c";
      const DEFAULT_MODE="sales-simulation";
      const MODEL_NAME="llama-3.1-8b-instant";
      const TEMP=0.2;
      const COACH_VALUES=["Coach On","Coach Off"];
      const CATALOG={
        "HIV":[{id:"im_md",label:"Internal Medicine MD",brief:"Primary care physician managing prevention and chronic care. Goal: assess PrEP suitability and adherence support."},{id:"np",label:"Nurse Practitioner",brief:"NP balances prevention counseling with workflow realities. Goal: clarify risk screening and follow-up cadence."},{id:"pa",label:"Physician Assistant",brief:"PA focuses on practical initiation steps. Goal: reduce process friction for starts and refills."},{id:"id",label:"Infectious Disease Specialist",brief:"Specialist prioritizes risk stratification and resistance. Goal: remain on-label, cite guideline data."}],
        "Cancer":[{id:"onco",label:"Oncologist",brief:"Treats tumors. Goal: concise on-label efficacy with fair balance."},{id:"np_onc",label:"Nurse Practitioner",brief:"Coordinates AE management. Goal: practical monitoring per label."},{id:"pa_onc",label:"Physician Assistant",brief:"Executes protocols/logistics. Goal: clarify prior-auth and infusion flow."}],
        "Vaccines":[{id:"im_doc",label:"Internal Medicine Doctor",brief:"Adult immunization catch-up. Goal: eligibility, timing, co-admin clarity."},{id:"np_vax",label:"Nurse Practitioner",brief:"Hesitancy and access. Goal: ACIP-aligned risk/benefit."},{id:"pa_vax",label:"Physician Assistant",brief:"Screening and contraindications. Goal: green-light criteria."}],
        "COVID":[{id:"pulm",label:"Pulmonologist",brief:"Respiratory impacts. Goal: on-label data for indicated groups."},{id:"pa_covid",label:"Physician Assistant",brief:"Testing and triage. Goal: eligibility decision clarity."},{id:"np_covid",label:"Nurse Practitioner",brief:"Counseling and follow-up. Goal: AE guidance per label."}],
        "Cardiovascular":[{id:"np_cv",label:"Nurse Practitioner",brief:"Risk factors and titration. Goal: guideline-framed benefit-risk."},{id:"im_cv",label:"Internal Medicine MD",brief:"Comorbidities and polypharmacy. Goal: indication fit and DDI awareness."}]
      };

      // ---- config with baked-in fallback ----
      let CFG={ apiBase:"https://my-chat-agent.tonyabdelmalak.workers.dev/chat", workerEndpoint:"", model:MODEL_NAME, stream:false };
      (async()=>{
        try{
          const r=await fetch("./config.json",{cache:"no-store"});
          if(r.ok){ const j=await r.json(); CFG={...CFG,...j, apiBase:j.apiBase||j.workerEndpoint||j.workerUrl||CFG.apiBase}; status("config loaded", true); }
          else status("config 404, using baked-in", false);
        }catch{ status("config load failed, using baked-in", false); }
      })();

      // ---- utils ----
      const esc=s=>String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
      const escAttr=s=>esc(s).replace(/"/g,"&quot;");
      const linkify=t=>String(t).replace(/(https?:\/\/[^\s)]+|www\.[^\s)]+)/g,m=>`<a href="${m.startsWith('http')?m:'https://'+m}" target="_blank" rel="noopener">${m}</a>`);
      const looseJson=t=>{try{return JSON.parse(t);}catch{} const i=t.indexOf("{"),j=t.lastIndexOf("}"); if(i>=0&&j>i){try{return JSON.parse(t.slice(i,j+1));}catch{}} return null;};
      const sanitize=s=>{ const d=document.createElement("div"); d.innerHTML=s||""; d.querySelectorAll("script,style,iframe,object").forEach(n=>n.remove()); d.querySelectorAll("*").forEach(el=>{[...el.attributes].forEach(a=>{if(a.name.startsWith("on")) el.removeAttribute(a.name);});}); return d.innerHTML; };
      const num=x=>Math.max(0,Math.min(5,Number(x)||0)).toFixed(1).replace(/\.0$/,"");
      const byLabel=pfx=>{const all=[...document.querySelectorAll("label, h2, h3, h4, p, span, strong")]; const n=all.find(el=>pfx.some(p=>(el.textContent||"").trim().toLowerCase().startsWith(p))); if(!n) return null; if(n.tagName==="LABEL"){const id=n.getAttribute("for"); if(id){const t=document.getElementById(id); if(t&&t.tagName==="SELECT") return t;} const s=n.parentElement&&n.parentElement.querySelector&&n.parentElement.querySelector("select"); if(s) return s;} const scope=n.closest("section, form, .container, .field, .row")||document; return scope.querySelector("select");};
      const setOptions=(sel,items)=>{ if(!sel) return; const v=sel.value; sel.innerHTML=items.map(o=>`<option value="${escAttr(o.v)}">${esc(o.t)}</option>`).join(""); if(items.some(o=>o.v===v)) sel.value=v; };

      // ---- shell + launcher ----
      const messagesEl = ensureShell(); // appends at body end if absent
      const launcher = ensureLauncher(); // fixed button to jump to shell

      function ensureShell(){
        let box=document.querySelector(".cw-messages")||document.getElementById("chat-log");
        if(box) return box;
        const sec=document.createElement("section");
        sec.className="cw-fallback";
        sec.id="cw-fallback";
        sec.innerHTML=`<div class="scenario-brief"></div><div class="cw-messages" role="log" aria-live="polite"></div><div class="coach-panel" data-hidden="true"><div class="coach-head"><strong>Coach</strong><div class="ei-badges"></div></div><div class="coach-body"></div><div class="coach-score"></div></div>`;
        document.body.appendChild(sec);
        return sec.querySelector(".cw-messages");
      }
      function ensureLauncher(){
        let b=document.getElementById("cw-launch");
        if(b) return b;
        b=document.createElement("button");
        b.id="cw-launch";
        b.type="button";
        b.textContent="Open Coach";
        b.addEventListener("click", ()=>{
          const host=document.getElementById("cw-fallback")||messagesEl?.parentElement;
          if(host){ host.style.display="block"; host.scrollIntoView({behavior:"smooth",block:"end"}); }
          const ta=document.querySelector(".chat-input textarea")||document.getElementById("message")||document.querySelector("textarea");
          if(ta) ta.focus();
        });
        document.body.appendChild(b);
        return b;
      }

      // ---- IO ----
      const {ta:inputEl, btn:sendBtn} = getIO();
      function getIO(){
        const ta=document.querySelector(".chat-input textarea")||document.getElementById("message")||document.querySelector("textarea")||createInput();
        let btn=document.querySelector('button[type="submit"]')||document.querySelector(".chat-send")||createBtn(ta);
        return {ta,btn};
      }
      function createInput(){ const ta=document.createElement("textarea"); ta.placeholder="Type here…"; ta.style.cssText="width:100%;min-height:44px;margin-top:8px;"; const a=document.querySelector(".cw-messages"); (a?a.parentElement:document.body).appendChild(ta); return ta; }
      function createBtn(ta){ const b=document.createElement("button"); b.type="button"; b.className="chat-send"; b.textContent="Send"; b.style.cssText="min-height:44px;margin-top:6px;"; (ta&&ta.parentElement?ta.parentElement:document.body).appendChild(b); return b; }
      function coachPanel(){ let p=document.querySelector(".coach-panel"); if(p) return p; p=document.createElement("div"); p.className="coach-panel"; p.setAttribute("data-hidden","true"); p.innerHTML=`<div class="coach-head"><strong>Coach</strong><div class="ei-badges"></div></div><div class="coach-body"></div><div class="coach-score"></div>`; const a=document.querySelector(".cw-messages"); (a?a.parentElement:document.body).appendChild(p); return p; }

      // ---- state ----
      const persisted=(()=>{try{return JSON.parse(localStorage.getItem(STORE_KEY)||"{}");}catch{return {};}})();
      let mode=persisted.mode||DEFAULT_MODE;
      let coachOn=persisted.coachOn!==undefined?persisted.coachOn:true;
      let disease=persisted.disease||"HIV";
      let hcpId=persisted.hcp||(CATALOG[disease]?CATALOG[disease][0].id:"");
      let conversation=[]; let scores={turns:[],avg:0};
      const persist=()=>{try{localStorage.setItem(STORE_KEY,JSON.stringify({mode,coachOn,disease,hcp:hcpId}));}catch{}};

      // ---- controls ----
      const modeSel=byLabel(["learning center","mode"]);
      const coachSel=byLabel(["coach"]);
      const diseaseSel=byLabel(["disease / product knowledge","disease state","disease"]);
      const hcpSel=byLabel(["hcp profile","hcp profiles / scenarios"]);

      if(modeSel){ setOptions(modeSel,[{v:"sales-simulation",t:"Sales Simulation"},{v:"product-knowledge",t:"Product Knowledge"}]); modeSel.value=mode; modeSel.addEventListener("change",()=>{mode=modeSel.value; persist(); vis(); reset(true); brief();}); }
      if(coachSel){ setOptions(coachSel, COACH_VALUES.map(v=>({v,t:v}))); coachSel.value=coachOn?"Coach On":"Coach Off"; coachSel.addEventListener("change",()=>{coachOn=coachSel.value==="Coach On"; persist(); reset(); vis();}); }
      if(diseaseSel){ setOptions(diseaseSel,Object.keys(CATALOG).map(k=>({v:k,t:k}))); diseaseSel.value=disease; diseaseSel.addEventListener("change",()=>{disease=diseaseSel.value; reHCP(); persist(); reset(false); brief();}); }
      function reHCP(){ if(!hcpSel) return; const list=CATALOG[disease]||[]; setOptions(hcpSel,list.map(i=>({v:i.id,t:i.label}))); if(!list.some(x=>x.id===hcpId)) hcpId=list[0]?list[0].id:""; hcpSel.value=hcpId; }
      if(hcpSel){ reHCP(); hcpSel.addEventListener("change",()=>{hcpId=hcpSel.value; persist(); reset(false); brief();}); }

      function vis(){ const panel=coachPanel(); const hide=mode!=="sales-simulation"; if(coachSel&&coachSel.parentElement) coachSel.parentElement.style.display=hide?"none":""; panel.setAttribute("data-hidden", hide||!coachOn ? "true":"false"); }
      function reset(keepBrief=true){ conversation=[]; scores={turns:[],avg:0}; const p=coachPanel(); const b=p.querySelector(".coach-body"); const bd=p.querySelector(".ei-badges"); const s=p.querySelector(".coach-score"); if(b) b.innerHTML=""; if(bd) bd.innerHTML=""; if(s) s.textContent=""; if(!keepBrief){ const sb=document.querySelector(".scenario-brief"); if(sb) sb.innerHTML=""; } }
      function curBrief(){ const list=CATALOG[disease]||[]; const f=list.find(x=>x.id===hcpId)||list[0]; return f?f.brief:""; }
      function brief(){ const host=document.querySelector(".scenario-brief"); if(!host) return; const list=CATALOG[disease]||[]; const f=list.find(x=>x.id===hcpId); host.innerHTML=`<div class="card"><div class="row"><div class="col"><strong>${esc(disease)}</strong> · <span>${esc(f?f.label:"HCP")}</span></div></div><p>${esc(f?f.brief:"")}</p></div>`; }
      brief(); vis();

      // ---- chat ----
      function bubble(role,text){ const r=document.createElement("div"); r.className="row"; const b=document.createElement("div"); b.className="bubble "+(role==="user"?"user":"assistant"); b.innerHTML=linkify(esc(text)); r.appendChild(b); messagesEl.appendChild(r); messagesEl.scrollTop=messagesEl.scrollHeight; }
      function typing(){ const r=document.createElement("div"); r.className="row"; r.innerHTML=`<div class="bubble assistant"><span class="dots"><i></i><i></i><i></i></span></div>`; messagesEl.appendChild(r); messagesEl.scrollTop=messagesEl.scrollHeight; return r; }

      sendBtn && sendBtn.addEventListener("click", onSend);
      inputEl && inputEl.addEventListener("keydown", e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); onSend(); } });

      async function onSend(){
        const txt=(inputEl&&inputEl.value||"").trim(); if(!txt) return;
        bubble("user",txt); if(inputEl) inputEl.value="";
        conversation.push({role:"user",content:txt});

        const sys=await sysPrimer();
        const pre = mode==="sales-simulation"
          ? `You are role-playing as an HCP in ${disease}. Use only on-label language. Keep replies concise. Scenario: ${curBrief()}`
          : `You are answering Product Knowledge questions in ${disease}. Use only on-label language. Provide concise, source-named support when relevant.`;
        const msgs=[{role:"system",content:sys},{role:"system",content:pre},...conversation];

        const t=typing();
        let a="Upstream error. Try again.";
        try{ a=await chatCall(msgs); }catch{}
        t.remove();
        bubble("assistant", a);
        conversation.push({role:"assistant",content:a});
        if(mode==="sales-simulation" && coachOn){ await coachRun(txt); }
      }

      async function coachRun(latest){
        const p=coachPanel(); const body=p.querySelector(".coach-body"); const badges=p.querySelector(".ei-badges"); const scoreEl=p.querySelector(".coach-score"); p.setAttribute("data-hidden","false");
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
        const ctx=`Disease: ${disease}. HCP: ${(CATALOG[disease]||[]).find(x=>x.id===hcpId)?.label||"HCP"}.
Brief: ${curBrief()}
User message: """${latest}"""`;
        const evalMsgs=[{role:"system",content:sys},{role:"user",content:ctx}];

        let out=null; try{ const raw=await chatCall(evalMsgs); out=looseJson(raw); if(!out){ const raw2=await chatCall(evalMsgs); out=looseJson(raw2); } }catch{}
        if(!out||!out.rubric||!out.ei){ body.innerHTML=`<div class="coach-card"><p>Coach unavailable. Neutral fallback:</p><ul><li>Lead with on-label, fair balance.</li><li>Ask one clarifier.</li><li>Agree next step.</li></ul></div>`; badges.innerHTML=""; scoreEl.textContent=""; return; }

        const fail=(out.rubric.accuracy===0||out.rubric.compliance===0);
        const W={accuracy:3,compliance:3,discovery:2,objection:2,value:2,empathy:1,clarity:1};
        const sum=Object.entries(out.rubric).reduce((a,[k,v])=>a+(v*(W[k]||0)),0);
        const turn=Math.round(((sum/70)*10)*10)/10; scores.turns.push(turn);
        const avg=Math.round((scores.turns.reduce((a,b)=>a+b,0)/scores.turns.length)*10)/10; scores.avg=isFinite(avg)?avg:0;

        const alert= fail ? `<div class="coach-alert">Compliance/Accuracy risk detected — lead with on-label, fair-balance language.</div>` : "";
        body.innerHTML=`<div class="coach-card">${alert}${sanitize(out.feedback_html)}</div>`;
        badges.innerHTML=`<span class="chip tone-${esc(out.ei.tone_label||'neutral')}">${(out.ei.tone_label||'neutral').replace(/^\w/,c=>c.toUpperCase())}</span><span class="chip emp">Empathy ${num(out.ei.empathy_score)}/5</span><span class="snippet">“${esc(out.ei.evidence_quote||"") }”</span>`;
        scoreEl.textContent=`Score — Turn: ${turn.toFixed(1)} | Avg: ${scores.avg.toFixed(1)}`;
      }

      async function chatCall(messages){
        const url = CFG.apiBase || CFG.workerEndpoint;
        if(!url){ status("no API endpoint", false); return "Upstream error. Try again."; }
        const res = await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model:CFG.model||MODEL_NAME,temperature:TEMP,messages})});
        if(!res.ok){ status(`upstream ${res.status}`, false); return "Upstream error. Try again."; }
        const data=await res.json().catch(()=>null);
        const content=data?.content || data?.choices?.[0]?.message?.content || data?.output_text || "";
        if(!content){ status("empty upstream", false); return "Upstream error. Try again."; }
        status("ready", true);
        setTimeout(()=>{const s=document.getElementById("cw-selfcheck"); if(s && s.textContent.includes("ready")) s.remove();},1500);
        return String(content);
      }

      async function sysPrimer(){
        try{ const r=await fetch("assets/chat/system.md",{cache:"no-store"}); if(r.ok) return await r.text(); }catch{}
        return "You are a compliant, on-label pharma conversational agent. Avoid PHI. Provide concise, balanced information.";
      }

      // seed coach text
      (function seed(){ const p=coachPanel(); const b=p.querySelector(".coach-body"); if(b&&!b.innerHTML){ b.innerHTML=`<div class="coach-card muted"><p><strong>Coach is listening for tone.</strong> Tips will appear after your next message.</p></div>`; } })();

    }catch(e){
      status("fatal boot error", false); console.error(e);
      try{ const s=document.createElement("section"); s.className="cw-fallback"; s.innerHTML=`<div class="cw-messages"><div class="row"><div class="bubble assistant">Widget boot error. Check console.</div></div></div>`; document.body.appendChild(s);}catch{}
    }

    // --- helpers: banner ---
    function mkBanner(){ const d=document.createElement("div"); d.id="cw-selfcheck"; d.style.cssText="position:fixed;bottom:8px;right:8px;z-index:2147483647;background:#111;color:#fff;padding:6px 8px;border-radius:8px;font:12px system-ui;opacity:.92"; document.body.appendChild(d); return d; }
    function status(t, ok){ const b=document.getElementById("cw-selfcheck"); if(!b) return; b.textContent=`Widget: ${t}`; b.style.background= ok===undefined ? "#111" : ok ? "#0a4" : "#b32"; }
  }
})();
