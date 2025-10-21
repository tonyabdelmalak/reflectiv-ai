/* ReflectivAI Coach — self-contained UI + logic (no external deps). */
(() => {
  // ---------- small utils ----------
  const qs = (sel, el = document) => el.querySelector(sel);
  const qsa = (sel, el = document) => [...el.querySelectorAll(sel)];
  const h = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else n.setAttribute(k, v);
    });
    children.forEach(c => n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return n;
  };
  const fetchJSON = async (url) => {
    const r = await fetch(url, { credentials: "omit", cache: "no-store" });
    if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
    return r.json();
  };

  // ---------- data sources (site-relative, avoids CORS surprises) ----------
  const DATA = {
    config:      "/assets/chat/config.json",
    personas:    "/assets/chat/persona.json",
    scenarios:   "/assets/chat/data/scenarios.merged.json",
    system:      "/assets/chat/system.md"
  };

  // ---------- constants ----------
  const MODES = [
    { key: "emotional-intelligence", label: "Emotional Intelligence" },
    { key: "product-knowledge",      label: "Product Knowledge" },
    { key: "role-play",              label: "Role Play w/ AI Agent" }
  ];
  const EI_PROFILES = [
    { key: "difficult",  label: "Difficult HCP" },
    { key: "busy",       label: "Busy HCP" },
    { key: "engaged",    label: "Highly Engaged HCP" },
    { key: "indifferent",label: "Indifferent HCP" }
  ];
  const EI_FEATURES = [
    { key: "empathy",    label: "Empathy" },
    { key: "objection",  label: "Objection Handling" },
    { key: "clarity",    label: "Clarity & Confidence" },
    { key: "accuracy",   label: "Accuracy & Compliance" },
    { key: "discovery",  label: "Discovery" }
  ];

  // ---------- state ----------
  const state = {
    cfg: null, personas: [], scenarios: [],
    mode: null, eiProfile: null, eiFeature: null,
    disease: null, hcp: null, scoring: false, sessionId: null
  };

  // ---------- safe boot with stub fallback ----------
  async function loadData() {
    try {
      const [cfg, personas, scenarios] = await Promise.all([
        fetchJSON(DATA.config),
        fetchJSON(DATA.personas),
        fetchJSON(DATA.scenarios)
      ]);
      state.cfg = cfg; state.personas = personas.personas || []; state.scenarios = scenarios.scenarios || [];
    } catch (e) {
      console.warn("[Coach] data fetch failed, using stub", e);
      state.cfg = { ui: { showCoach: true }, brand: { accent: "#22f3a4" } };
      state.personas = [];
      state.scenarios = [];
    }
  }

  // ---------- UI ----------
  function buildShell(root) {
    root.innerHTML = "";
    const wrap = h("div", { class: "rfx-coach-wrap" }, [
      h("div", { class: "coach-header" }, [
        h("div", { class: "title" }, [ "ReflectivAI Coach" ]),
        h("button", { class: "close-btn", type: "button" }, [ "Close" ])
      ]),
      h("div", { class: "coach-body" }, [
        // left controls
        h("div", { class: "coach-controls" }, [
          field("Learning Center Mode", select("mode", [ { value: "", label: "Select Mode" }, ...MODES.map(m=>({value:m.key,label:m.label})) ])),
          h("div", { id: "modeFields" })
        ]),
        // chat
        h("div", { class: "coach-chat" }, [
          h("div", { class: "chat-header" }, [
            h("div", { class: "hline", id: "hdr1" }, []),
            h("div", { class: "hline", id: "hdr2" }, [])
          ]),
          h("div", { class: "chat-stream", id: "chat" }),
          h("form", { class: "chat-form", id: "chatForm" }, [
            h("input", { class: "chat-input", id: "chatInput", placeholder: "Type your message…" }),
            h("button", { class: "btn", type: "submit" }, [ "Send" ])
          ])
        ]),
        // scores right column
        h("div", { class: "coach-scores", id: "scoresCol" }, [
          scoreItem("Empathy", "—"),
          scoreItem("Accuracy", "—"),
          scoreItem("Confidence", "—"),
          scoreItem("Compliance", "—"),
          scoreItem("Readiness", "—")
        ])
      ])
    ]);
    root.appendChild(wrap);
    // close
    qs(".close-btn", wrap).addEventListener("click", () => {
      // find outer modal and close
      const modal = root.closest(".modal");
      if (modal) modal.classList.remove("open");
    });
    // wire selects
    qs('select[name="mode"]', wrap).addEventListener("change", onModeChange);
    qs("#chatForm", wrap).addEventListener("submit", onSend);
  }

  const field = (label, input) => h("div", { class: "field" }, [ h("label", {}, [ label ]), input ]);
  function select(name, options) {
    const sel = h("select", { name, class: "input" });
    options.forEach(o => sel.appendChild(h("option", { value: o.value }, [ o.label ])));
    return sel;
  }
  const scoreItem = (name, val) =>
    h("div", { class: "score" }, [ h("div", { class: "score-name" }, [ name ]), h("div", { class: "score-val", "data-score": name.toLowerCase() }, [ val ]) ]);

  // ---------- interactions ----------
  function onModeChange(e) {
    state.mode = e.target.value || null;
    // fresh session per mode
    state.sessionId = `${Date.now()}`;
    qs("#chat").innerHTML = "";
    // populate dependent fields
    const host = qs("#modeFields");
    host.innerHTML = "";
    if (state.mode === "emotional-intelligence") {
      host.appendChild(field("EI Profile", select("eiProfile", [ {value:"",label:"Select EI Profile"}, ...EI_PROFILES.map(x=>({value:x.key,label:x.label})) ])));
      host.appendChild(field("EI Feature", select("eiFeature", [ {value:"",label:"Select EI Feature"}, ...EI_FEATURES.map(x=>({value:x.key,label:x.label})) ])));
      host.appendChild(toggleScoring(true)); // ON by default, can be toggled off
      qs('select[name="eiProfile"]').addEventListener("change", (ev)=> state.eiProfile = ev.target.value || null);
      qs('select[name="eiFeature"]').addEventListener("change", (ev)=> state.eiFeature = ev.target.value || null);
      preloadHeaders("HCP Background: Time-pressured; direct; workflow sensitive.", "Key Takeaways: Lead with relevance; 1 question on barriers.");
    } else if (state.mode === "product-knowledge") {
      host.appendChild(field("Disease State", select("disease", [
        {value:"",label:"Select Disease"},
        {value:"oncology",label:"Oncology"},
        {value:"vaccines",label:"Vaccines"},
        {value:"hiv",label:"HIV"},
        {value:"pulmonology",label:"Pulmonology"},
        {value:"hepb",label:"Hepatitis B"},
        {value:"cardiology",label:"Cardiology"}
      ])));
      host.appendChild(field("HCP Profile", select("hcp", [
        {value:"",label:"Select HCP"},
        {value:"im",label:"Internal Medicine MD"},
        {value:"np",label:"Nurse Practitioner (NP)"},
        {value:"pa",label:"Physician Assistant (PA)"},
        {value:"id",label:"Infectious Disease Specialist"},
        {value:"onc",label:"Oncologist"},
        {value:"pulm",label:"Pulmonologist"},
        {value:"card",label:"Cardiologist"}
      ])));
      host.appendChild(toggleScoring(false)); // OFF by default
      qs('select[name="disease"]').addEventListener("change", (ev)=> state.disease = ev.target.value || null);
      qs('select[name="hcp"]').addEventListener("change", (ev)=> state.hcp = ev.target.value || null);
      preloadHeaders("HCP Background: Evidence-focused; prior-auth burden; limited time.", "Key Takeaways: Lead with guideline tie; include 1 targeted question.");
    } else if (state.mode === "role-play") {
      // same selects as PK
      onModeChange({ target: { value: "product-knowledge" } });
      state.mode = "role-play";
      toggleScoring(true, true); // ensure ON
      preloadHeaders("HCP Background: Practical, time-constrained.", "Today’s Goal: Practice concise value, ask 1 needs question.");
    }
  }

  function toggleScoring(defaultOn, forceOn) {
    const w = h("div", { class: "toggle" }, []);
    const id = `score_${Math.random().toString(36).slice(2)}`;
    const cb = h("input", { type: "checkbox", id, checked: defaultOn ? "" : null });
    cb.checked = !!defaultOn;
    cb.addEventListener("change", () => { state.scoring = cb.checked; });
    if (forceOn) { cb.checked = true; cb.disabled = true; state.scoring = true; }
    w.appendChild(cb);
    w.appendChild(h("label", { for: id }, [ "Scoring" ]));
    return w;
  }

  function preloadHeaders(line1, line2) {
    qs("#hdr1").textContent = line1 || "";
    qs("#hdr2").textContent = line2 || "";
  }

  async function onSend(ev) {
    ev.preventDefault();
    const inp = qs("#chatInput"); const msg = (inp.value || "").trim();
    if (!msg) return;
    inp.value = "";
    push("user", msg);
    // silent init ping per selection change is already implied by sessionId flip
    const reply = await askCoach(msg);
    push("bot", reply);
    if (state.scoring) updateScores(); // simple demo change
  }

  function push(who, text) {
    const row = h("div", { class: `msg ${who}` }, [ text ]);
    qs("#chat").appendChild(row);
    qs("#chat").scrollTop = qs("#chat").scrollHeight;
  }

  async function askCoach(text) {
    // worker endpoint or local stub
    try {
      const r = await fetch((window.COACH_ENDPOINT||"/coach"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: state.mode, eiProfile: state.eiProfile, eiFeature: state.eiFeature,
          disease: state.disease, hcp: state.hcp, message: text, sessionId: state.sessionId
        })
      });
      if (r.ok) {
        const j = await r.json();
        return j.reply || "OK.";
      }
    } catch (_) {}
    // local stub
    return "Stub reply: I parsed your intent and will tailor guidance once the worker responds.";
  }

  function updateScores() {
    const bump = () => 60 + Math.floor(Math.random()*35); // 60–94
    qsa("[data-score]").forEach(n => n.textContent = bump());
  }

  // ---------- public API ----------
  async function mount(root) {
    // fresh session every time mount is called
    state.sessionId = `${Date.now()}`;
    await loadData();       // tolerant boot
    buildShell(root);       // render
    // initial headers
    preloadHeaders("", "");
  }

  window.ReflectivCoach = { mount };
})();
