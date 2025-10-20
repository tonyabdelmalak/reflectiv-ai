/* ReflectivAI Coach — UI + logic (modular). */
(() => {
  const S = window.ReflectivShared;
  if (!S) return console.error("Shared utilities missing");

  const RAW = {
    config:  "https://raw.githubusercontent.com/ReflectivEI/reflectiv-ai/refs/heads/main/assets/chat/config.json",
    personas:"https://raw.githubusercontent.com/ReflectivEI/reflectiv-ai/refs/heads/main/assets/chat/persona.json",
    scenarios:"https://raw.githubusercontent.com/ReflectivEI/reflectiv-ai/refs/heads/main/assets/chat/data/scenarios.merged.json",
    system: "https://raw.githubusercontent.com/ReflectivEI/reflectiv-ai/refs/heads/main/assets/chat/system.md"
  };

  // constants
  const MODES = [
    { key:"emotional-intelligence", label:"Emotional Intelligence" },
    { key:"product-knowledge",      label:"Product Knowledge" },
    { key:"role-play",              label:"Role Play w/ AI Agent" } // replaces Sales Simulation
  ];
  const EI_PROFILES = [
    { key:"difficult", label:"Difficult HCP" },
    { key:"busy",      label:"Busy HCP" },
    { key:"engaged",   label:"Highly Engaged HCP" },
    { key:"indifferent",label:"Indifferent HCP" }
  ];
  const EI_FEATURES = [
    { key:"empathy",   label:"Empathy" },
    { key:"objection", label:"Objection Handling" },
    { key:"clarity",   label:"Clarity & Confidence" },
    { key:"accuracy",  label:"Accuracy & Compliance" },
    { key:"discovery", label:"Discovery" }
  ];

  // UI state
  const state = {
    cfg:null, personas:[], scenarios:[],
    workerUrl:"", analyticsEndpoint:"",
    mode:null, eiProfile:null, eiFeature:null,
    disease:null, hcp:null,
    scoring:true, // per mode default adjusted later
    sessions:[] // persisted history (not reloaded into canvas)
  };

  // helpers
  const loadData = async () => {
    const [cfg, personas, scenarios] = await Promise.all([
      S.fetchJSON(RAW.config),
      S.fetchJSON(RAW.personas),
      S.fetchJSON(RAW.scenarios)
    ]);
    state.cfg = cfg;
    state.personas = (personas.personas || personas || []);
    state.scenarios = (scenarios.scenarios || scenarios || []);
    state.workerUrl = (cfg.workerUrl || cfg.apiBaseUrl || "").trim();
    state.analyticsEndpoint = (cfg.analyticsEndpoint || "").trim();
  };

  const findPersona = (therapeuticArea, hcpProfile) => {
    const p = state.personas.find(p =>
      (p.therapeuticAreas || []).includes(therapeuticArea) &&
      (p.role === hcpProfile || p.displayName?.includes(hcpProfile))
    );
    return p || null;
  };

  const findScenario = (therapeuticArea, hcpProfile) => {
    const s = state.scenarios.find(s =>
      s.therapeuticArea === therapeuticArea && s.hcpProfile === hcpProfile
    );
    return s || null;
  };

  const compress = arr => (arr || []).filter(Boolean).join(" • ");

  const headerLinesFor = (mode) => {
    if (mode === "product-knowledge" || mode === "role-play") {
      const p = findPersona(state.disease, state.hcp);
      const s = findScenario(state.disease, state.hcp);
      const background = compress([
        p?.setting, p?.decision_style, (p?.style && `Style: ${p.style}`),
        p?.clinical_priorities && `Priorities: ${p.clinical_priorities.join(", ")}`
      ]);
      const strategies = (s
        ? [s.summary, s.goal, s.approach, s.objection]
        : []
      ).filter(Boolean).slice(0,3);
      const goalLine = compress(strategies);
      return {
        title1:"HCP Background",
        line1: background || "—",
        title2: mode==="role-play" ? "Today’s Goal" : "Key Takeaways",
        line2: goalLine || "—"
      };
    }
    if (mode === "emotional-intelligence") {
      return {
        title1:"EI Profile",
        line1: (EI_PROFILES.find(x=>x.key===state.eiProfile)?.label)||"—",
        title2:"EI Feature",
        line2: (EI_FEATURES.find(x=>x.key===state.eiFeature)?.label)||"—"
      };
    }
    return {title1:"",line1:"",title2:"",line2:""};
  };

  // worker calls
  const silentInit = async () => {
    if (!state.workerUrl) return;
    const payload = {
      type:"init",
      mode:state.mode,
      eiProfile:state.eiProfile,
      eiFeature:state.eiFeature,
      disease:state.disease,
      hcp:state.hcp,
      scoring:state.scoring
    };
    try { await S.postJSON(state.workerUrl, payload); }
    catch { /* ignore */ }
  };

  const askWorker = async (text) => {
    const payload = {
      type:"chat",
      text, mode:state.mode,
      context:{
        eiProfile:state.eiProfile, eiFeature:state.eiFeature,
        disease:state.disease, hcp:state.hcp, scoring:state.scoring
      }
    };
    try {
      if (!state.workerUrl) throw new Error("No worker");
      return await S.postJSON(state.workerUrl, payload);
    } catch (e) {
      // stub fallback
      return {
        stub:true,
        reply: [
          "**Challenge:** Practice context loaded. ",
          "**My Approach:** Use concise benefit + evidence + check-back.",
          "**Suggested Phrasing:** “Doctor, given your focus on outcomes, may I share a 30-second summary of how this option impacted adherence and visits? What would you want to explore first?”"
        ].join("\n")
      };
    }
  };

  // UI build
  const initUI = () => {
    const root = S.qs("#reflectiv-widget");
    if (!root) return;

    root.innerHTML = "";
    root.classList.add("rfx-coach-wrap");

    // header bar
    const head = S.el("div",{className:"coach-header", style:`--rfx-navy:${S.NAVY}`},[
      S.el("div",{className:"title", textContent:"ReflectivAI Coach"}),
      S.el("button",{className:"close-btn", type:"button", textContent:"Close"})
    ]);

    // controls + scores
    const controls = S.el("div",{className:"coach-controls"});
    const scores = S.el("div",{className:"coach-scores"});
    const chat = S.el("div",{className:"coach-chat"});

    // controls: mode
    const fld = (label,node) => {
      const w = S.el("div",{className:"field"});
      w.append(S.el("label",{textContent:label}), node);
      return w;
    };

    const selMode = S.el("select",{className:"input"});
    selMode.append(S.el("option",{value:"",textContent:"Select Mode"}));
    MODES.forEach(m=>selMode.append(S.el("option",{value:m.key,textContent:m.label})));

    const selEIProfile = S.el("select",{className:"input"});
    const selEIFeature = S.el("select",{className:"input"});
    const selDisease = S.el("select",{className:"input"});
    const selHcp = S.el("select",{className:"input"});
    const scoreToggle = S.el("label",{className:"toggle"});
    scoreToggle.innerHTML = `<input type="checkbox" id="scoreT" checked>
      <span>Scoring</span>`;

    controls.append(
      fld("Learning Center Mode", selMode),
      fld("EI Profile", selEIProfile),
      fld("EI Feature", selEIFeature),
      fld("Disease State", selDisease),
      fld("HCP Profile", selHcp),
      scoreToggle
    );

    // scores column
    const metric = name => {
      const c = S.el("div",{className:"score"});
      c.innerHTML = `<div class="score-name">${name}</div><div class="score-val">—</div>`;
      return c;
    };
    const scoreEls = {
      Empathy: metric("Empathy"),
      Accuracy: metric("Accuracy"),
      Confidence: metric("Confidence"),
      Compliance: metric("Compliance"),
      Readiness: metric("Readiness")
    };
    scores.append(...Object.values(scoreEls));

    // chat area
    const header = S.el("div",{className:"chat-header"});
    const canvas = S.el("div",{className:"chat-stream"});
    const form = S.el("form",{className:"chat-form"});
    const input = S.el("input",{className:"chat-input", placeholder:"Type your message..."});
    const send = S.el("button",{className:"btn", textContent:"Send", type:"submit"});
    form.append(input, send);
    chat.append(header, canvas, form);

    root.append(head, S.el("div",{className:"coach-body"},[controls, chat, scores]));

    // close button integrates with site modal close if present
    head.querySelector(".close-btn").onclick = () => {
      // try site modal button
      document.querySelector('[data-close="#coachModal"]')?.click();
    };

    // populate static dropdowns
    const setOptions = (sel, list, placeholder) => {
      sel.innerHTML = "";
      sel.append(S.el("option",{value:"",textContent:placeholder||"Select"}));
      list.forEach(o => sel.append(S.el("option",{value:o.key || o, textContent:o.label || o})));
    };

    // dynamic data for disease/hcp from repo or config
    const DISEASES = ["Oncology","Vaccines","HIV","Cardiology","Pulmonology","Hepatitis B"];
    const HCPs     = ["Internal Medicine MD","Nurse Practitioner (NP)","Physician Assistant (PA)","Infectious Disease Specialist","Oncologist","Pulmonologist","Cardiologist"];

    // mode switcher
    const applyMode = () => {
      const m = selMode.value || null;
      state.mode = m;

      // clear chat for new session
      header.innerHTML = ""; canvas.innerHTML = "";
      state.sessions.push({ts:Date.now(), mode:m}); // persisted, not shown

      // visibility logic
      const showEI = m === "emotional-intelligence";
      const showPK = m === "product-knowledge" || m === "role-play";

      selEIProfile.parentElement.style.display = showEI ? "" : "none";
      selEIFeature.parentElement.style.display = showEI ? "" : "none";
      selDisease.parentElement.style.display   = showPK ? "" : "none";
      selHcp.parentElement.style.display       = showPK ? "" : "none";

      // scoring defaults per mode
      const defScore = m === "product-knowledge" ? false : true;
      scoreToggle.style.display = m === "emotional-intelligence" ? "" : (m==="role-play" ? "" : "");
      const scoreInput = scoreToggle.querySelector("#scoreT");
      scoreInput.checked = defScore;
      state.scoring = defScore;

      // prepare selects
      if (showEI) {
        setOptions(selEIProfile, EI_PROFILES, "Select EI Profile");
        setOptions(selEIFeature, EI_FEATURES, "Select EI Feature");
      }
      if (showPK) {
        setOptions(selDisease, DISEASES, "Select Disease");
        setOptions(selHcp, HCPs, "Select HCP Profile");
      }

      drawHeader(); silentInit();
    };

    const drawHeader = () => {
      const h = headerLinesFor(state.mode);
      header.innerHTML = `
        <div class="hline"><strong>${h.title1}:</strong> ${h.line1}</div>
        <div class="hline"><strong>${h.title2}:</strong> ${h.line2}</div>
      `;
    };

    // select handlers
    S.on(selMode,"change",applyMode);
    S.on(selEIProfile,"change", e => { state.eiProfile = e.target.value || null; drawHeader(); silentInit(); });
    S.on(selEIFeature,"change", e => { state.eiFeature = e.target.value || null; drawHeader(); silentInit(); });
    S.on(selDisease,"change", e => { state.disease = e.target.value || null; drawHeader(); silentInit(); });
    S.on(selHcp,"change", e => { state.hcp = e.target.value || null; drawHeader(); silentInit(); });
    S.on(scoreToggle.querySelector("#scoreT"),"change", e => { state.scoring = !!e.target.checked; silentInit(); });

    // chat send
    const pushMsg = (who, text) => {
      const b = S.el("div",{className:`msg ${who}`});
      b.innerHTML = text;
      canvas.append(b);
      canvas.scrollTop = canvas.scrollHeight;
    };

    S.on(form,"submit", async e => {
      e.preventDefault();
      const t = input.value.trim();
      if (!t) return;
      input.value = "";
      pushMsg("user", t);

      // call worker
      const res = await askWorker(t);

      // update scores if present
      if (res.scores && typeof res.scores === "object") {
        const s = res.scores;
        const upd = (k, v) => { const n = scoreEls[k]?.querySelector(".score-val"); if (n) n.textContent = `${v}`; };
        upd("Empathy",    s.empathy ?? "—");
        upd("Accuracy",   s.accuracy ?? "—");
        upd("Confidence", s.confidence ?? "—");
        upd("Compliance", s.compliance ?? "—");
        upd("Readiness",  s.readiness ?? "—");
      }

      const md = (res.reply || "—")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g,"<br>");
      pushMsg("bot", md);
    });

    // defaults
    selMode.value = ""; // “Select Mode”
    applyMode();
  };

  // public
  window.ReflectivCoach = {
    initCoach: async () => {
      try { await loadData(); } catch(e){ console.warn("Coach data load failed", e); }
      initUI();
    }
  };

  // --- expose global mount for widget.js ---
window.ReflectivCoach = window.ReflectivCoach || {};
window.ReflectivCoach.mount = function (targetId = "reflectiv-widget") {
  try {
    const el = document.getElementById(targetId);
    if (!el) throw new Error("Target container not found");
    // basic UI render confirmation
    el.innerHTML = `
      <div style="padding:18px;border-radius:12px;border:1px solid #d6dbe3;background:#fff">
        <h3 style="margin:0 0 6px;color:#0c2740;">ReflectivAI Coach</h3>
        <p style="margin:0;color:#314159;">Coach module initialized successfully. (Placeholder UI)</p>
      </div>
    `;
    console.info("[ReflectivAI] Coach widget mounted.");
  } catch (err) {
    console.error("[ReflectivAI] mount failed:", err);
  }
};

})();
