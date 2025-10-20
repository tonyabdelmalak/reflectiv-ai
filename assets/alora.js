/* =====================================================
   Alora — ReflectivAI Agent (site assistant)
   - Always-visible launcher bubble (uses provided icon if present)
   - Two header actions: Launch AI Coach, Schedule Demo
   - Answers about site modules, ethics, pricing, EI, etc. from static logic
   ===================================================== */
(function(){
  // ---------- helpers ----------
  function el(t,c,txt){ const e=document.createElement(t); if(c) e.className=c; if(txt!=null) e.textContent=txt; return e; }
  function byId(id){ return document.getElementById(id); }
  function md(s){ return String(s||"").replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>").replace(/\n{2,}/g,"<br><br>"); }

  // ---------- inject UI ----------
  function ensureUI(){
    if(byId("aloraFab")) return;

    // bubble
    const fab = el("button"); fab.id="aloraFab"; fab.setAttribute("aria-label","Open Alora");
    // try to use provided bubble icon if available
    const img = document.createElement("img");
    img.src = "assets/alora-bubble-icon.png"; // replace with your provided circle icon path
    img.alt = "";
    img.onerror = () => { fab.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path fill="#fff" d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9.4L5 19.9V16H5a2 2 0 0 1-2-2V5z"/></svg>`; };
    img.onload = () => { fab.appendChild(img); };
    document.body.appendChild(fab);

    // panel
    const panel = el("div"); panel.id="aloraPanel";
    panel.innerHTML = `
      <div class="head">
        <div class="title">Alora, ReflectivAI Agent</div>
        <div class="actions">
          <button class="icon-btn" id="aloraLaunchCoach" title="Launch AI Coach">💬</button>
          <a class="icon-btn" id="aloraDemo" title="Schedule Demo" href="mailto:ReflectivEI.AI@gmail.com">📅</a>
          <button class="close" id="aloraClose" aria-label="Close">×</button>
        </div>
      </div>
      <div class="body" id="aloraBody"></div>
      <div class="input">
        <textarea id="aloraInput" placeholder="Ask about ReflectivAI…"></textarea>
        <button class="btn" id="aloraSend">Send</button>
      </div>
    `;
    document.body.appendChild(panel);

    // open/close
    function open(){ panel.classList.add("open"); greet(); }
    function close(){ panel.classList.remove("open"); }
    byId("aloraFab").onclick = open;
    byId("aloraClose").onclick = close;

    // actions
    byId("aloraLaunchCoach").onclick = ()=> {
      // open separate Coach modal
      const coachBtn = document.querySelector("[data-open-coach]"); 
      if(coachBtn){ coachBtn.click(); } else {
        // fallback event
        const evt = new CustomEvent("open-coach"); document.dispatchEvent(evt);
      }
    };

    // send
    byId("aloraSend").onclick = () => {
      const t = byId("aloraInput").value.trim(); if(!t) return;
      byId("aloraInput").value="";
      user(t);
      setTimeout(()=> bot(answer(t)), 150);
    };

    // greeting on first open
    function greet(){
      if(panel._greeted) return;
      panel._greeted = true;
      bot("Hey there 👋. I’m Alora. Ask about **platform modules**, **simulations**, **EI**, **pricing**, **ethics**, **security**, or launch the **AI Coach**.");
    }

    // render helpers
    function add(role, html){
      const row = el("div","msg "+role);
      const b = el("div","bubble"); b.innerHTML = html;
      byId("aloraBody").appendChild(row).appendChild(b);
      byId("aloraBody").scrollTop = byId("aloraBody").scrollHeight;
    }
    function user(t){ add("user", md(t)); }
    function bot(t){ add("assistant", md(t)); }

    // simple site-knowledge answers
    function answer(q){
      const s=q.toLowerCase();

      // quick intents
      if(/\b(launch|open).*(coach|sim)/.test(s)) { setTimeout(()=>byId("aloraLaunchCoach").click(),50); return "Opening the **AI Coach**…"; }
      if(/\b(schedule|book|demo|contact)\b/.test(s)) { setTimeout(()=>byId("aloraDemo").click(),50); return "Opening your mail app to **schedule a demo**."; }

      // pricing
      if(/\bprice|pricing|cost|quote\b/.test(s))
        return "Pricing scales by team size and selected modules. Use **Schedule Demo** so we can scope the modules you need.";

      // security / ethics
      if(/\bsecurity|hipaa|privacy|ethic|compliance|governance\b/.test(s))
        return "Designed for life-sciences training. PHI is off by default. When enabled, we work under BAA with encryption, RBAC, and purge-on-expiration. We align to NIST AI RMF, ISO 27001/42001, OPDP, and PhRMA Code.";

      // modules
      if(/\bmodule|platform\b/.test(s))
        return "Core modules: **Product Knowledge**, **Sales Simulation**, **Relationship Intelligence**, and **Analytics**. See *Platform Modules* for details.";

      // EI
      if(/\bei|emotional intelligence|empathy\b/.test(s))
        return "EI coaching measures empathy and stress cues and offers listening and validation tips. Try **AI Coach** to see EI Persona and Feature controls.";

      // personas / disease states
      if(/\b(disease|therapeutic|persona|hcp)\b/.test(s))
        return "Train by therapeutic area such as **HIV PrEP, Vaccines, Hepatitis B, Oncology, Cardiology, Pulmonology**. Personas include **Internal Medicine, NP, PA, ID Specialist, Oncologist, Pulmonologist, Cardiologist**.";

      // simulations
      if(/\bsim(ulation|)\b/.test(s))
        return "Interactive simulations use adaptive HCP personas, a scenario library, territory scoring, and compliance guardrails. Click **Launch AI Coach** to try it.";

      // analytics
      if(/\banalytics|metric|index|score\b/.test(s))
        return "Analytics include **Empathy Index, Accuracy Index, Confidence Delta, Compliance Guard, Readiness Velocity** with team and territory rollups.";

      // faq
      if(/\bf(aq|requently)|questions\b/.test(s))
        return "FAQs: What sets us apart? **AI simulations + EI coaching under strict compliance**. Does it replace managers? **No**—it scales practice and insight.";

      // default
      return "I can help with **simulations**, **personas**, **EI coaching**, **analytics**, **pricing**, and **security**. Try **Launch AI Coach** or **Schedule Demo**.";
    }
  }

  // init
  ensureUI();

  // also open on custom links with [data-open-alora]
  document.querySelectorAll("[data-open-alora]").forEach(n=> n.addEventListener("click", e=>{
    e.preventDefault(); byId("aloraFab").click();
  }));
})();
