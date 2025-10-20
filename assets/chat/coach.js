/* ReflectivAI Coach — full modular UI + logic.
   File: /assets/chat/coach.js
   Mount target: <div id="reflectiv-widget"></div>
*/
(() => {
  // ---------- shared ----------
  const S = window.ReflectivShared || {
    // tiny helper set used by widget.js; keep local fallback here to be self-contained
    el(tag, attrs = {}, ...kids) {
      const n = document.createElement(tag);
      for (const k in attrs) {
        const v = attrs[k];
        if (k === "class") n.className = v;
        else if (k === "style") n.style.cssText = v;
        else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v);
      }
      for (const kid of kids) n.append(kid?.nodeType ? kid : document.createTextNode(kid ?? ""));
      return n;
    },
    qs(s, r = document) { return r.querySelector(s); },
    qsa(s, r = document) { return [...r.querySelectorAll(s)]; },
    sleep(ms) { return new Promise(r => setTimeout(r, ms)); },
    async fetchJSON(url) {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
      return r.json();
    },
    // worker call with simple retry + timeout
    async postJSON(url, body, { timeout = 15000, retries = 1 } = {}) {
      for (let i = 0; i <= retries; i++) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), timeout);
          const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: ctrl.signal
          });
          clearTimeout(t);
          if (r.ok) return await r.json();
        } catch (_) { /* retry once */ }
      }
      return null;
    }
  };

  // ---------- constants ----------
  const RAW = {
    config:   "https://raw.githubusercontent.com/ReflectivEI/reflectiv-ai/refs/heads/main/assets/chat/config.json",
    personas: "https://raw.githubusercontent.com/ReflectivEI/reflectiv-ai/refs/heads/main/assets/chat/persona.json",
    scenarios:"https://raw.githubusercontent.com/ReflectivEI/reflectiv-ai/refs/heads/main/assets/chat/data/scenarios.merged.json",
    system:   "https://raw.githubusercontent.com/ReflectivEI/reflectiv-ai/refs/heads/main/assets/chat/system.md"
  };

  const MODES = [
    { key: "emotional-intelligence", label: "Emotional Intelligence" },
    { key: "product-knowledge",      label: "Product Knowledge" },
    { key: "role-play",              label: "Role Play w/ AI Agent" }, // replaces Sales Simulation
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

  // starting score suggestions (can adjust later)
  const STARTING_SCORES = { Empathy: 72, Accuracy: 80, Confidence: 68, Compliance: 84, Readiness: 60 };

  // ---------- state ----------
  const state = {
    cfg: null,
    personas: [],
    scenarios: [],
    // UI selections
    mode: "",
    disease: "",
    hcp: "",
    eiProfile: "",
    eiFeature: "",
    scoringOn: false,
    // session buffers per mode (persist for reference, not loaded into new sessions)
    sessions: {
      "emotional-intelligence": [],
      "product-knowledge": [],
      "role-play": []
    },
    // active chat
    chat: [],
    headerA: "", // "HCP Background:"
    headerB: "", // "Key Takeaways:" or "Today’s Goal:"
  };

  // ---------- boot ----------
  async function loadData() {
    const [cfg, personas, scenarios] = await Promise.all([
      S.fetchJSON(RAW.config).catch(() => ({})),
      S.fetchJSON(RAW.personas).catch(() => ({ personas: [] })),
      S.fetchJSON(RAW.scenarios).catch(() => ({ scenarios: [] })),
    ]);
    state.cfg = cfg || {};
    state.personas = personas.personas || [];
    state.scenarios = scenarios.scenarios || [];
  }

  // ---------- mapping helpers ----------
  const DISEASES = ["Oncology", "Vaccines", "HIV", "Cardiology", "Pulmonology", "Hepatitis B"];
  const HCPs = [
    "Internal Medicine MD",
    "Nurse Practitioner (NP)",
    "Physician Assistant (PA)",
    "Infectious Disease Specialist",
    "Oncologist",
    "Pulmonologist",
    "Cardiologist"
  ];

  function pickPersonaSummary(dz, hcp) {
    // simple compress from persona.json fields if match exists; otherwise generic
    const p = state.personas.find(x =>
      (x.therapeuticAreas || []).includes(dz) &&
      (x.displayName || "").toLowerCase().includes((hcp.split(" ")[0] || "").toLowerCase())
    );
    if (!p) return "Concise, evidence-focused; values workflow simplicity; sensitive to access and safety.";
    const bits = [];
    if (p.style) bits.push(p.style);
    if (p.decision_style) bits.push(p.decision_style);
    if (p.clinical_priorities?.length) bits.push(`Priorities: ${p.clinical_priorities.slice(0,2).join(", ")}`);
    if (p.historical_objections?.length) bits.push(`Objections: ${p.historical_objections.slice(0,1).join(", ")}`);
    return bits.join(" • ");
  }

  function pickGoalOrTakeaways(modeKey, dz, hcp) {
    // derive from scenarios.merged.json when possible
    const s = state.scenarios.find(x =>
      x.therapeuticArea?.toLowerCase().includes(dz.toLowerCase()) &&
      (x.hcpProfile?.toLowerCase().includes(hcp.toLowerCase().split(" ")[0]) || true)
    );
    const items = [];
    if (s?.goal) items.push(s.goal);
    if (s?.approach) items.push(s.approach);
    // add a practice question
    const q = "Ask: “What would change your confidence in adopting this approach for your next 3 patients?”";
    items.push(q);
    const line = items
      .map(t => t.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(" • ");
    return modeKey === "role-play" ? { label: "Today’s Goal", text: line } : { label: "Key Takeaways", text: line };
  }

  // ---------- session control ----------
  function startFreshSession() {
    // push prior session buffer for reference
    if (state.mode) state.sessions[state.mode].push({ at: Date.now(), chat: state.chat.slice() });
    // reset active
    state.chat = [];
  }

  // ---------- UI ----------
  function mount(container) {
    container.innerHTML = "";
    container.append(
      // header bar
      S.el("div", { class: "coach-header", style: "background:#0c2740;color:#fff;display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:10px 10px 0 0" },
        S.el("div", { class: "title" }, "ReflectivAI Coach"),
        S.el("button", {
          class: "close-btn",
          onclick: () => {
            // bubble to modal close if present
            const btn = document.querySelector('#coachModal .modal-close');
            btn?.click();
          }
        }, "Close")
      ),
      // body
      S.el("div", { class: "coach-body" },
        // left controls
        S.el("div", { class: "coach-controls" },
          field("Learning Center Mode", select("Select Mode", MODES.map(m => m.label), async (label) => {
            const m = MODES.find(x => x.label === label);
            state.mode = m?.key || "";
            // defaults and toggles
            state.scoringOn = state.mode === "emotional-intelligence" || state.mode === "role-play";
            // clear subsequent selections
            state.disease = ""; state.hcp = ""; state.eiProfile = ""; state.eiFeature = "";
            startFreshSession();
            render(container);
            await preloadHeaders(); // silent init call
          })),
          // conditional stacks
          S.el("div", { id: "mode-specific" })
        ),
        // center chat
        S.el("div", { class: "coach-chat" },
          S.el("div", { class: "chat-header" },
            S.el("div", { id: "hlineA", class: "hline" }),
            S.el("div", { id: "hlineB", class: "hline", style: "margin-top:4px" })
          ),
          S.el("div", { id: "chatStream", class: "chat-stream" }),
          S.el("form", {
            id: "chatForm", class: "chat-form", onsubmit: onSend
          },
            S.el("input", { id: "chatInput", class: "chat-input", placeholder: "Type your message…" }),
            S.el("button", { class: "btn", type: "submit" }, "Send")
          )
        ),
        // right scores
        S.el("div", { class: "coach-scores" },
          ...["Empathy", "Accuracy", "Confidence", "Compliance", "Readiness"].map(name =>
            S.el("div", { class: "score" },
              S.el("div", { class: "score-name" }, name),
              S.el("div", { id: `score-${name.toLowerCase()}`, class: "score-val" }, state.scoringOn ? (STARTING_SCORES[name] ?? "—") : "—")
            )
          ),
          S.el("label", { class: "toggle" },
            S.el("input", {
              type: "checkbox",
              checked: state.scoringOn ? true : false,
              onchange: (e) => {
                state.scoringOn = !!e.target.checked;
                // reset to starting scores or dashes
                for (const k of ["Empathy","Accuracy","Confidence","Compliance","Readiness"]) {
                  S.qs(`#score-${k.toLowerCase()}`)?.replaceChildren(state.scoringOn ? (STARTING_SCORES[k] ?? "—") : "—");
                }
              }
            }),
            "Scoring"
          )
        )
      )
    );
    render(container);
  }

  function field(label, inputEl) {
    return S.el("div", { class: "field" },
      S.el("label", {}, label),
      inputEl
    );
  }

  function select(placeholder, options, onChange) {
    const sel = S.el("select", { class: "input" }, S.el("option", { value: "" }, placeholder));
    for (const o of options) sel.append(S.el("option", { value: o }, o));
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  }

  function render(container) {
    // Mode-specific control stack
    const slot = S.qs("#mode-specific", container);
    slot.innerHTML = "";

    if (!state.mode) {
      slot.append(S.el("div", { class: "hint" }, "Select a mode to begin."));
      // disable chat until a mode is picked
      S.qs("#chatInput").disabled = true;
      S.qs("#chatInput").placeholder = "Select a mode to start…";
      setHeaders("", "");
      return;
    }

    S.qs("#chatInput").disabled = false;
    S.qs("#chatInput").placeholder = "Type your message…";

    if (state.mode === "emotional-intelligence") {
      // EI: profile, feature
      slot.append(
        field("EI Profiles", select("Select EI Profile", EI_PROFILES.map(x => x.label), async (v) => {
          const f = EI_PROFILES.find(x => x.label === v);
          state.eiProfile = f?.key || "";
          startFreshSession();
          await preloadHeaders();
          renderChat();
        })),
        field("EI Feature", select("Select EI Feature", EI_FEATURES.map(x => x.label), async (v) => {
          const f = EI_FEATURES.find(x => x.label === v);
          state.eiFeature = f?.key || "";
          startFreshSession();
          await preloadHeaders();
          renderChat();
        })),
      );
      // scoring ON by default, but toggle allowed
      setToggleVisibility(true);
    }

    if (state.mode === "product-knowledge") {
      slot.append(
        field("Disease State", select("Select Disease", DISEASES, async (v) => {
          state.disease = v || "";
          state.hcp = "";
          startFreshSession();
          await preloadHeaders();
          render(container);
        })),
        field("HCP Profile", select("Select HCP Profile", HCPs, async (v) => {
          state.hcp = v || "";
          startFreshSession();
          await preloadHeaders();
          renderChat();
        })),
      );
      // scoring OFF by default, but hidden toggle? requirement says coach still replies and scoring off. Toggle should remain OFF but visible.
      setToggleVisibility(true);
    }

    if (state.mode === "role-play") {
      slot.append(
        field("Disease State", select("Select Disease", DISEASES, async (v) => {
          state.disease = v || "";
          state.hcp = "";
          startFreshSession();
          await preloadHeaders();
          render(container);
        })),
        field("HCP Profile", select("Select HCP Profile", HCPs, async (v) => {
          state.hcp = v || "";
          startFreshSession();
          await preloadHeaders();
          renderChat();
        })),
      );
      // scoring ON by default
      setToggleVisibility(true);
    }
  }

  function setToggleVisibility(show) {
    const t = S.qs(".coach-scores .toggle");
    if (show) t.style.display = "flex"; else t.style.display = "none";
  }

  function setHeaders(a, b) {
    S.qs("#hlineA")?.replaceChildren(a || "");
    S.qs("#hlineB")?.replaceChildren(b || "");
  }

  async function preloadHeaders() {
    // when selections change, compute header lines and send a silent init to worker
    let background = "";
    let second = { label: "Key Takeaways", text: "" };

    if (state.mode === "emotional-intelligence") {
      background = `EI Profile: ${labelFrom(EI_PROFILES, state.eiProfile) || "—"} • Feature: ${labelFrom(EI_FEATURES, state.eiFeature) || "—"}`;
      second = { label: "Key Takeaways", text: tipFromFeature(state.eiFeature) };
    } else {
      // PK and Role-play use disease + hcp
      if (state.disease) background = `HCP Background: ${pickPersonaSummary(state.disease, state.hcp || "MD")}`;
      const gt = pickGoalOrTakeaways(state.mode, state.disease || "Oncology", state.hcp || "Internal Medicine MD");
      second = gt;
    }

    setHeaders(background, second.text ? `${second.label}: ${second.text}` : "");

    // silent init ping
    const payload = {
      mode: state.mode,
      disease: state.disease,
      hcp: state.hcp,
      eiProfile: state.eiProfile,
      eiFeature: state.eiFeature,
      init: true
    };
    // not blocking; ignore result
    S.postJSON(window.COACH_ENDPOINT || "/coach", payload, { timeout: 4000, retries: 0 });
  }

  function labelFrom(list, key) { return (list.find(x => x.key === key) || {}).label || ""; }

  function tipFromFeature(key) {
    switch (key) {
      case "empathy":   return "Mirror key phrases • validate feelings • ask permission before advising • end with a check-back question.";
      case "objection": return "Surface the root cause • align on criteria • respond with brief evidence • confirm if addressed.";
      case "clarity":   return "Lead with headline • state one benefit • one data point • one action; avoid hedging words.";
      case "accuracy":  return "Use label language • cite source and population • avoid implied superiority without head-to-head.";
      case "discovery": return "Open with purpose • ask who/what/why/impact • quantify current approach • listen and reflect.";
      default: return "";
    }
  }

  // ---------- chat ----------
  function renderChat() {
    const stream = S.qs("#chatStream");
    stream.innerHTML = "";
    for (const m of state.chat) {
      stream.append(S.el("div", { class: `msg ${m.role === "user" ? "user" : "bot"}` }, m.text));
    }
    stream.scrollTop = stream.scrollHeight;
  }

  async function onSend(e) {
    e.preventDefault();
    const inp = S.qs("#chatInput");
    const q = inp.value.trim();
    if (!q) return;

    // guard: require minimal selection based on mode
    if (state.mode === "emotional-intelligence" && (!state.eiProfile || !state.eiFeature)) {
      enqueueBot("Select EI Profile and EI Feature first.");
      return;
    }
    if ((state.mode === "product-knowledge" || state.mode === "role-play") && (!state.disease || !state.hcp)) {
      enqueueBot("Select Disease State and HCP Profile first.");
      return;
    }

    inp.value = "";
    enqueueUser(q);

    // call worker
    const payload = {
      mode: state.mode,
      disease: state.disease,
      hcp: state.hcp,
      eiProfile: state.eiProfile,
      eiFeature: state.eiFeature,
      message: q,
      scoring: !!state.scoringOn
    };
    const res = await S.postJSON(window.COACH_ENDPOINT || "/coach", payload, { timeout: 20000, retries: 1 });

    if (!res || !(res.reply || res.output)) {
      // fallback local stub
      enqueueBot(localFallbackReply(q));
      if (state.scoringOn) applyScoreNudge(q);
      return;
    }

    const reply = res.reply || res.output || "";
    enqueueBot(reply);

    if (state.scoringOn && res.scores) {
      for (const k of ["Empathy","Accuracy","Confidence","Compliance","Readiness"]) {
        if (k.toLowerCase() in res.scores) {
          S.qs(`#score-${k.toLowerCase()}`)?.replaceChildren(Math.round(res.scores[k.toLowerCase()]));
        }
      }
    } else if (state.scoringOn) {
      applyScoreNudge(q);
    }
  }

  function enqueueUser(t) {
    state.chat.push({ role: "user", text: t }); renderChat();
  }
  function enqueueBot(t) {
    state.chat.push({ role: "bot", text: t }); renderChat();
  }

  function localFallbackReply(q) {
    const s = q.toLowerCase();
    if (state.mode === "product-knowledge") {
      return `Key points for ${state.disease} with ${state.hcp}: keep claims label-aligned, give a concise outcome stat, then ask one check-back question.`;
    }
    if (state.mode === "role-play") {
      return `Sim agent is online locally. Try handling an objection, then summarize plan and ask for next-step commitment.`;
    }
    // EI
    if (/\b(objection|pushback|concern)\b/.test(s)) {
      return "Acknowledge, ask a brief clarifier, respond with one data point, and confirm if addressed.";
    }
    return "Got it. Provide your opening line or objection you want to practice.";
  }

  function applyScoreNudge(text) {
    // crude heuristic: question improves empathy and discovery a bit; long monologue reduces clarity
    const len = text.length;
    const isQuestion = /\?\s*$/.test(text);
    bump("Empathy", isQuestion ? +2 : 0);
    bump("Confidence", +1);
    bump("Readiness", +1);
    if (len > 240) bump("Confidence", -1);
  }
  function bump(name, delta) {
    if (!delta) return;
    const el = S.qs(`#score-${name.toLowerCase()}`);
    if (!el) return;
    const cur = parseInt(el.textContent, 10);
    if (Number.isFinite(cur)) el.textContent = Math.max(0, Math.min(100, cur + delta));
  }

  // ---------- public mount called by widget.js ----------
  window.ReflectivCoach = {
    async mount(target) {
      const host = typeof target === "string" ? S.qs(target) : target;
      if (!host) throw new Error("ReflectivAI coach mount target not found");
      try {
        await loadData();
      } catch {
        // continue with empty datasets
      }
      // default placeholder per requirements
      state.mode = "";
      state.scoringOn = false;
      mount(host);
    }
  };
})();
