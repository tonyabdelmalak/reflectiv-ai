/*
 * ReflectivEI AI widget — prioritized layout (drop-in)
 * - Modes dropdown: emotional-assessment, hiv-product-knowledge, sales-simulation (+ scenario select)
 * - Streaming with Stop button (enable via config.stream=true)
 * - Minimal, sanitized Markdown
 * - Coach Feedback as a separate section BELOW chat. No "Tone".
 * - Coach returns tailored feedback via <coach>{...}</coach> with scoring + subscores.
 * - Optional analytics beacon if cfg.analyticsEndpoint is set.
 * - Hides "What’s Next for Reflectiv?" section and adds breathing room above footer.
 * - No emoji or file-attach.
 */

(function () {
  const container = document.getElementById("reflectiv-widget");
  if (!container) return;
  if (!container.classList.contains("cw")) container.classList.add("cw");

  // ---------- State ----------
  let cfg = null, systemPrompt = "", knowledge = "", personas = {};
  let scenariosList = [], scenariosById = new Map();
  let currentMode = "sales-simulation", currentScenarioId = null;
  let conversation = [], coachEnabled = true;
  let streamAbort = null;

  // ---------- Utils ----------
  async function fetchLocal(path){ const r=await fetch(path,{cache:"no-store"}); if(!r.ok) throw new Error(`load ${path}`); const ct=r.headers.get("content-type")||""; return ct.includes("application/json")?r.json():r.text(); }
  function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
  function renderMarkdown(t){
    if(!t) return "";
    let s=esc(t).replace(/\r\n?/g,"\n");
    s=s.replace(/\*\*([^*\n]+?\([^()\n]+?\))\*\*:/g,"$1:")
       .replace(/^\s*##\s+(.+)$/gm,"<h4>$1</h4>").replace(/^\s*#\s+(.+)$/gm,"<h3>$1</h3>")
       .replace(/^\s*>\s?(.*)$/gm,"<blockquote>$1</blockquote>")
       .replace(/\*\*([^*\n]+)\*\*/g,"<strong>$1</strong>")
       .replace(/`([^`]+)`/g,"<code>$1</code>")
       .replace(/```([\s\S]*?)```/g,(m,c)=>`<pre><code>${esc(c)}</code></pre>`)
       .replace(/(?:^|\n)(\d+\.\s+[^\n]+(?:\n\d+\.\s+[^\n]+)*)/g,m=>"\n<ol>"+m.trim().split(/\n/).map(l=>`<li>${l.replace(/^\d+\.\s+/,"").trim()}</li>`).join("")+"</ol>")
       .replace(/(?:^|\n)([-*]\s+[^\n]+(?:\n[-*]\s+[^\n]+)*)/g,m=>"\n<ul>"+m.trim().split(/\n/).map(l=>`<li>${l.replace(/^[-*]\s+/,"").trim()}</li>`).join("")+"</ul>");
    return s.split(/\n{2,}/).map(c=>/^\s*<(h3|h4|ul|ol|li|blockquote|pre|code)/i.test(c)?c:`<p>${c.replace(/\n/g,"<br>")}</p>`).join("\n");
  }
  function parseLegacyScenarios(text){
    const out=[], lines=String(text||"").split(/\r?\n/); let key=null,obj=null;
    for(const raw of lines){ const line=raw.trim();
      if(line.startsWith("# Scenario:")){ if(key&&obj) out.push(obj); key=line.slice(11).trim(); obj={id:key,label:key,therapeuticArea:"",background:"",goal:"",personaKey:""}; continue; }
      if(!key||!line) continue; const i=line.indexOf(":"); if(i>0){ const k=line.slice(0,i).trim().toLowerCase(), v=line.slice(i+1).trim();
        if(k==="background") obj.background=v; else if(k==="goal"||k==="goal for today") obj.goal=v;
        else if(k==="area"||k==="therapeutic area") obj.therapeuticArea=v; else if(k==="persona"||k==="personakey") obj.personaKey=v;
      }
    }
    if(key&&obj) out.push(obj); return out;
  }
  function el(tag, cls, text){ const e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; }

  // ---------- Coach Feedback helpers ----------
  function extractCoach(raw){
    const m=String(raw||"").match(/<coach>([\s\S]*?)<\/coach>/i);
    if(!m) return {coach:null,clean:raw};
    let coach=null; try{ coach=JSON.parse(m[1]); }catch{}
    return {coach, clean:String(raw).replace(m[0],"").trim()};
  }
  function heuristicCoach(conv=[], mode=currentMode){
    if(!conv.length) return null;
    const lastUser=[...conv].reverse().find(m=>m.role==="user")?.content||"";
    const lastAI=[...conv].reverse().find(m=>m.role==="assistant")?.content||"";
    const qCount=(lastUser.match(/\?/g)||[]).length;
    const asks=/commit|agree|can we|will you|let's|next step/i.test(lastUser);
    const obj=/\b(concern|barrier|issue|risk|denied|side effect|cost|coverage|pa|prior auth)\b/i.test(lastUser);
    const val=/\bbenefit|outcome|impact|why|evidence|data|guideline|access|coverage|pa|prior auth\b/i.test(lastUser);
    const long=lastAI.split(/\s+/).length>160, unstructured=!(/<ol>|<ul>|<h3>|<h4>|•|- |\d\./i.test(lastAI)), noCTA=!/\b(next step|commit|plan|consider|agree|schedule|start|switch)\b/i.test(lastAI);
    const worked=[]; if(qCount>0) worked.push("You asked a focused question."); if(val) worked.push("You referenced evidence/access/outcomes."); if(obj) worked.push("You named a barrier.");
    const improve=[]; if(qCount===0) improve.push("Ask 1–2 specific questions."); if(!asks&&mode==="sales-simulation") improve.push("Seek a small commitment."); if(unstructured||long) improve.push("Use concise bullets."); if(noCTA) improve.push("End with a clear action.");
    let phr="“Could we align on one next step for your eligible patients?”"; if(obj) phr="“What would address that top concern so we can proceed?”"; if(mode==="hiv-product-knowledge") phr="“Give 3 bullets and one clinical caveat.”";
    // simple scoring fallback
    const subs={question_quality:Math.min(5,qCount?4:2), objection_handling:obj?4:2, value_articulation:val?4:2, cta_clarity:noCTA?2:4, compliance:4, empathy:3};
    const score=Math.round((subs.question_quality+subs.objection_handling+subs.value_articulation+subs.cta_clarity+subs.compliance+subs.empathy)/30*100);
    return { worked, improve, phrasing:phr, score, subscores:subs };
  }

  // ---------- UI ----------
  function buildUI() {
    container.innerHTML="";
    const stack = el("div","reflectiv-stack");

    // Chat wrapper
    const wrapper = el("div","reflectiv-chat");

    // Toolbar
    const toolbar = el("div","chat-toolbar");

    // Mode select
    const modeSelect = el("select");
    (cfg.modes||[]).forEach(m=>{ const o=el("option"); o.value=m; o.textContent=m.replace(/-/g," ").replace(/\b(\w)/g,c=>c.toUpperCase()); modeSelect.appendChild(o); });
    modeSelect.value=currentMode;
    modeSelect.onchange=()=>{ currentMode=modeSelect.value; currentScenarioId=null; conversation=[]; coachEnabled=true; renderMessages(); updateScenarioSelector(); updateScenarioMeta(); renderCoach(); };
    toolbar.appendChild(modeSelect);

    // Scenario select
    const scenarioSelect = el("select"); scenarioSelect.style.display="none"; scenarioSelect.setAttribute("aria-label","Select Physician Profile");
    scenarioSelect.onchange=()=>{ currentScenarioId=scenarioSelect.value||null; conversation=[]; coachEnabled=true; renderMessages(); updateScenarioMeta(); renderCoach(); };
    toolbar.appendChild(scenarioSelect);

    // Coach toggle
    const coachBtn = el("button","btn","Coach: On");
    coachBtn.onclick=()=>{ coachEnabled=!coachEnabled; coachBtn.textContent=coachEnabled?"Coach: On":"Coach: Off"; renderCoach(); };
    toolbar.appendChild(coachBtn);

    wrapper.appendChild(toolbar);

    // Scenario meta
    const metaEl = el("div","scenario-meta"); wrapper.appendChild(metaEl);

    // Messages
    const messagesEl = el("div","chat-messages"); wrapper.appendChild(messagesEl);

    // Input
    const inputArea = el("div","chat-input");
    const textarea = el("textarea"); textarea.placeholder="Type your message…";
    textarea.addEventListener("keydown",e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); const t=textarea.value.trim(); if(t) sendMessage(t); textarea.value=""; } });
    const sendBtn=el("button","btn primary","Send"); sendBtn.onclick=()=>{ const t=textarea.value.trim(); if(t){ sendMessage(t); textarea.value=""; } };
    const stopBtn=el("button","btn warn","Stop"); stopBtn.style.display="none"; stopBtn.onclick=()=>{ if(streamAbort){ streamAbort.abort(); streamAbort=null; stopBtn.style.display="none"; } };
    inputArea.appendChild(textarea); inputArea.appendChild(sendBtn); inputArea.appendChild(stopBtn);
    wrapper.appendChild(inputArea);

    // Coach section (separate)
    const coachSection = el("div","coach-section");
    coachSection.innerHTML=`<h3>Coach Feedback</h3><div class="coach-body muted">No feedback yet.</div>`;

    // Mount
    stack.appendChild(wrapper);
    stack.appendChild(coachSection);
    container.appendChild(stack);

    // --- helpers ---
    function updateScenarioSelector(){
      if(currentMode==="sales-simulation"){
        scenarioSelect.style.display="";
        scenarioSelect.innerHTML="<option value=''>Select Physician Profile</option>";
        scenariosList.forEach(sc=>{ const o=el("option"); o.value=sc.id; o.textContent=sc.label||sc.id; scenarioSelect.appendChild(o); });
      }else{ scenarioSelect.style.display="none"; }
    }
    function updateScenarioMeta(){
      const sc=scenariosById.get(currentScenarioId);
      if(!sc||currentMode!=="sales-simulation"){ metaEl.innerHTML=""; return; }
      const persona=sc.personaKey?(personas[sc.personaKey]||{}):{};
      metaEl.innerHTML=
        `<div class="meta-card">
           <div><strong>Therapeutic Area:</strong> ${esc(sc.therapeuticArea||"—")}</div>
           <div><strong>Background:</strong> ${esc(sc.background||"—")}</div>
           <div><strong>Today’s Goal:</strong> ${esc(sc.goal||"—")}</div>
           <div><strong>Persona:</strong> ${esc(persona.displayName||"—")}</div>
         </div>`;
    }
    function renderMessages(){
      messagesEl.innerHTML="";
      for(const m of conversation){ const d=el("div",`message ${m.role}`); const c=el("div","content"); c.innerHTML=renderMarkdown(m.content); d.appendChild(c); messagesEl.appendChild(d); }
      messagesEl.scrollTop=messagesEl.scrollHeight;
    }
    function renderCoach(){
      const body=coachSection.querySelector(".coach-body");
      if(!coachEnabled){ coachSection.style.display="none"; return; }
      coachSection.style.display="";
      const last=conversation[conversation.length-1];
      if(!(last&&last.role==="assistant"&&last._coach)){ body.innerHTML=`<span class="muted">Awaiting the first assistant reply…</span>`; return; }
      const fb=last._coach;
      const score = typeof fb.score==="number" ? Math.max(0,Math.min(100,Math.round(fb.score))) : null;
      const subs  = fb.subscores||{};
      body.innerHTML =
        `${score!=null?`<div class="coach-score">Score: <strong>${score}</strong>/100</div>`:""}
         ${Object.keys(subs).length?`<div class="coach-subs">
            ${Object.entries(subs).map(([k,v])=>`<span class="pill">${esc(k.replace(/_/g," "))}: ${esc(v)}</span>`).join(" ")}
          </div>`:""}
         <ul class="coach-list">
           <li><strong>What worked:</strong> ${esc((fb.worked||[]).join(" ")||"—")}</li>
           <li><strong>What to improve:</strong> ${esc((fb.improve||[]).join(" ")||"—")}</li>
           <li><strong>Suggested stronger phrasing:</strong> ${esc(fb.phrasing||"—")}</li>
         </ul>`;
    }

    updateScenarioSelector(); updateScenarioMeta(); renderMessages(); renderCoach();

    // ---------- Messaging ----------
    async function sendMessage(userText){
      conversation.push({role:"user",content:userText});
      renderMessages(); renderCoach();

      const messages=[{role:"system",content:systemPrompt}];
      if(currentMode==="hiv-product-knowledge"){ messages.push({role:"system",content:"You are answering questions about HIV medications using the provided evidence-based knowledge."}); messages.push({role:"system",content:knowledge}); }
      else if(currentMode==="emotional-assessment"){ messages.push({role:"system",content:"You are helping the user reflect on their emotional intelligence and communication style."}); }
      else if(currentMode==="sales-simulation"&&currentScenarioId){
        const sc=scenariosById.get(currentScenarioId); if(sc){ const p=sc.personaKey?(personas[sc.personaKey]||{}):{};
          messages.push({role:"system",content:
`Act as the healthcare provider for a sales simulation.
${p.displayName?`Persona: ${p.displayName} (${p.role||"HCP"}). Style: ${p.style||"concise"}.\n`:""}Therapeutic Area: ${sc.therapeuticArea||"HCP"}.
Background: ${sc.background||"N/A"}
Today’s Goal: ${sc.goal||"N/A"}
Respond in character and keep answers realistic and compliant.`});
        }
      }

      // Coach directive with scoring
      messages.push({ role:"system", content:
`After you produce your reply, output tailored coaching strictly about:
- The user's most recent message, and
- The assistant reply you just wrote.

Return coaching ONLY as JSON wrapped in tags:
<coach>{
  "worked": ["bullet 1","bullet 2"],
  "improve": ["bullet 1","bullet 2"],
  "phrasing": "one concise rewrite for a stronger ask or next step",
  "score": 0-100,
  "subscores": {
    "question_quality": 0-5,
    "objection_handling": 0-5,
    "value_articulation": 0-5,
    "cta_clarity": 0-5,
    "compliance": 0-5,
    "empathy": 0-5
  }
}</coach>

Rules: No "Tone". Be specific. Quote short fragments when useful. Keep lists 1–3 items.` });

      try{
        const endpoint=(cfg.apiBase||cfg.workerEndpoint||"").trim(); if(!endpoint) throw new Error("Missing apiBase/workerEndpoint");
        const useStream=cfg.stream===true;
        if(useStream){
          const assist={role:"assistant",content:""}; conversation.push(assist); renderMessages();
          const controller=new AbortController(); streamAbort=controller;
          const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages,model:cfg.model||"llama-3.1-8b-instant",temperature:0.2,stream:true}),signal:controller.signal});
          if(!r.ok||!r.body) throw new Error(`Upstream ${r.status}`);
          const stopBtn=container.querySelector(".btn.warn"); if(stopBtn) stopBtn.style.display="inline-block";
          const reader=r.body.getReader(); const decoder=new TextDecoder(); let acc="";
          while(true){ const {value,done}=await reader.read(); if(done) break; const chunk=decoder.decode(value,{stream:true}); acc+=chunk; assist.content=acc; renderMessages(); }
          const {coach,clean}=extractCoach(acc); assist.content=clean||""; assist._coach=coach||heuristicCoach(conversation); renderMessages(); renderCoach();
          if(stopBtn) stopBtn.style.display="none"; streamAbort=null;
          sendCoachAnalytics(assist._coach,{mode:currentMode,scenarioId:currentScenarioId,turn:conversation.length});
        }else{
          const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages,model:cfg.model||"llama-3.1-8b-instant",temperature:0.2,stream:false})});
          if(!r.ok) throw new Error(`Upstream ${r.status}`);
          const data=await r.json().catch(()=>({})); const reply=data.reply||data.content||data?.choices?.[0]?.message?.content||data?.message?.content||"";
          const {coach,clean}=extractCoach(String(reply)); const assist={role:"assistant",content:String(clean||"").trim(),_coach:coach||heuristicCoach(conversation)};
          conversation.push(assist); renderMessages(); renderCoach();
          sendCoachAnalytics(assist._coach,{mode:currentMode,scenarioId:currentScenarioId,turn:conversation.length});
        }
      }catch(e){
        console.error("AI call failed:",e); conversation.push({role:"assistant",content:"I couldn’t reach the AI service. Try again later."}); renderMessages(); renderCoach();
      }
    }
  }

  // ---------- Analytics ----------
  function sendCoachAnalytics(fb, {mode, scenarioId, turn}) {
    if (!cfg || !cfg.analyticsEndpoint || !fb) return;
    const payload = { ts: Date.now(), mode, scenarioId, turn, score: fb.score ?? null, subscores: fb.subscores ?? null };
    try {
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      if (navigator.sendBeacon) navigator.sendBeacon(cfg.analyticsEndpoint, blob);
      else fetch(cfg.analyticsEndpoint, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
    } catch {}
  }

  // ---------- Layout tweaks ----------
  function pruneLayoutAndPlaceWidget(){
    // Hide “What’s Next for Reflectiv?”
    const headings=[...document.querySelectorAll("h1,h2,h3")];
    const nextHdr=headings.find(h=>h.textContent.trim().toLowerCase().startsWith("what’s next for reflectiv"));
    if(nextHdr){ const sec=nextHdr.closest("section")||nextHdr.parentElement; if(sec) sec.style.display="none"; }
    // Add space above footer
    const footer=document.querySelector("footer"); if(footer) footer.style.marginTop="28px";
  }

  // ---------- Init ----------
  async function init(){
    try{
      cfg = await fetchLocal("./assets/chat/config.json");
      systemPrompt = await fetchLocal("./assets/chat/system.md");
      knowledge = await fetchLocal("./assets/chat/about-ei.md");
      try{ personas = await fetchLocal("./assets/chat/persona.json"); }catch{ personas = {}; }

      if(Array.isArray(cfg.scenarios)&&cfg.scenarios.length){
        scenariosList = cfg.scenarios.map(s=>({id:s.id,label:s.label||s.id,therapeuticArea:s.therapeuticArea||"",background:s.background||"",goal:s.goal||"",personaKey:s.personaKey||""}));
      }else{
        const legacy = await fetchLocal("./assets/chat/data/hcp_scenarios.txt");
        scenariosList = parseLegacyScenarios(legacy);
      }
      scenariosById = new Map(scenariosList.map(s=>[s.id,s]));

      buildUI();
      pruneLayoutAndPlaceWidget();
    }catch(e){
      console.error(e);
      container.textContent="Failed to load ReflectivEI Coach. Check console.";
    }
  }

  // ---------- Styles ----------
  const style = document.createElement("style");
  style.textContent = `
  .cw .reflectiv-stack{display:flex;flex-direction:column;gap:10px}
  .cw .reflectiv-chat{--bg:#ffffff;--fg:#111827;--muted:#6b7280;--card:#f9fafc;--line:#e5e7eb;--accent:#3e5494;--warn:#9b1c1c}
  .cw .chat-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
  .cw select{padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
  .cw .btn{padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);cursor:pointer}
  .cw .btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
  .cw .btn.warn{background:var(--warn);color:#fff;border-color:var(--warn)}

  .cw .scenario-meta .meta-card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:8px;font-size:.95rem}

  /* Taller viewport to reduce inner scrolling */
  .cw .chat-messages{min-height:280px;max-height:62vh;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--bg);margin-bottom:10px}
  .cw .message{margin:8px 0}
  .cw .message.user .content{background:#eef2ff;border-radius:8px;padding:10px}
  .cw .message.assistant .content{background:var(--card);border-radius:8px;padding:10px}
  .cw .message .content h3,.cw .message .content h4{margin:0 0 8px 0;color:var(--fg);font-weight:700}
  .cw .message .content p{margin:8px 0;line-height:1.5}
  .cw .message .content ul,.cw .message .content ol{margin:8px 0 8px 22px}
  .cw .message .content blockquote{margin:8px 0;padding:8px 10px;border-left:3px solid var(--line);background:var(--card);color:var(--fg)}
  .cw pre{background:#0b1020;color:#d1d5db;border-radius:8px;padding:8px;overflow:auto;border:1px solid #1f2937}

  .cw .chat-input{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:start}
  .cw .chat-input textarea{width:100%;min-height:48px;max-height:220px;padding:10px;border:1px solid var(--line);border-radius:8px;resize:vertical;background:var(--bg);color:var(--fg)}

  /* Separate Coach Section with extra bottom space above footer */
  .cw .coach-section{background:#fffbea;border:1px solid #fde68a;border-radius:10px;padding:14px;margin:14px 0 42px}
  .cw .coach-section h3{margin:0 0 6px 0;font-size:1rem;color:#111827;font-weight:700}
  .cw .coach-section .muted{color:#6b7280}
  .cw .coach-section .coach-list{margin:0;padding-left:20px}
  .cw .coach-section li{margin:4px 0;color:#374151}
  .cw .coach-score{margin:0 0 6px 0;font-size:.95rem}
  .cw .coach-subs{margin:0 0 6px 0;display:flex;gap:6px;flex-wrap:wrap}
  .cw .coach-subs .pill{border:1px solid #e5e7eb;border-radius:999px;padding:2px 8px;font-size:.8rem;background:#fff}
  `;
  document.head.appendChild(style);

  init();
})();
