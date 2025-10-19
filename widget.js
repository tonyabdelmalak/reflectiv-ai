/* assets/chat/widget.js
 * ReflectivAI Chat/Coach — drop-in (coach-v2, deterministic scoring v3)
 * Modes: emotional-assessment | product-knowledge | sales-simulation
 */

(function () {
  // ---------- safe bootstrapping ----------
  let mount = null;
  function onReady(fn) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true }); else fn(); }
  function waitForMount(cb) {
    const tryGet = () => {
      mount = document.getElementById("reflectiv-widget");
      if (mount) return cb();
      const obs = new MutationObserver(() => {
        mount = document.getElementById("reflectiv-widget");
        if (mount) { obs.disconnect(); cb(); }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => obs.disconnect(), 15000);
    };
    onReady(tryGet);
  }

  // ---------- config/state ----------
  const LC_OPTIONS = ["Emotional Intelligence", "Product Knowledge", "Sales Simulation"];
  const LC_TO_INTERNAL = {
    "Emotional Intelligence": "emotional-assessment",
    "Product Knowledge": "product-knowledge",
    "Sales Simulation": "sales-simulation"
  };

  let cfg = null;
  let systemPrompt = "";
  let scenarios = [];
  let scenariosById = new Map();

  let currentMode = "sales-simulation";
  let currentScenarioId = null;
  let conversation = [];
  let coachOn = true;

  // ---------- utils ----------
  async function fetchLocal(path) {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(`Failed to load ${path} (${r.status})`);
    const ct = r.headers.get("content-type") || "";
    return ct.includes("application/json") ? r.json() : r.text();
  }

  const esc = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  function sanitizeLLM(raw) {
    let s = String(raw || "");
    s = s.replace(/```[\s\S]*?```/g, "");
    s = s.replace(/<pre[\s\S]*?<\/pre>/gi, "");
    s = s.replace(/^\s*#{1,6}\s+/gm, "");
    s = s.replace(/^\s*(hi|hello|hey)[^\n]*\n+/i, "");
    s = s.replace(/\n{3,}/g, "\n\n").trim();
    return s;
  }

  // ---------- Real-time EI Feedback Logic ----------
  const personaSelect = document.getElementById("cw-hcp");
  const eiSelect = document.getElementById("cw-ei");
  const eiFeatureSelect = document.getElementById("cw-ei-feature");
  const feedbackDisplay = document.getElementById("feedback-display");

  // Fetch personas and EI profiles from config.json
  fetch('https://raw.githubusercontent.com/ReflectivEI/reflectiv-ai/refs/heads/main/assets/chat/config.json')
    .then(response => response.json())
    .then(data => {
      const personas = data.personas;  // Corrected path for personas
      const eiProfiles = data.eiProfiles || [];
      const eiFeatures = data.eiFeatures || [];

      // Populate Persona Dropdown
      personas.forEach(persona => {
        const option = document.createElement('option');
        option.value = persona.key;
        option.textContent = persona.label;
        personaSelect.appendChild(option);
      });

      // Populate EI Profile Dropdown
      eiProfiles.forEach(profile => {
        const option = document.createElement('option');
        option.value = profile.key;
        option.textContent = profile.label;
        eiSelect.appendChild(option);
      });

      // Populate EI Feature Dropdown
      eiFeatures.forEach(feature => {
        const option = document.createElement('option');
        option.value = feature.key;
        option.textContent = feature.label;
        eiFeatureSelect.appendChild(option);
      });

      // Add change listener to Persona and EI Feature dropdowns
      personaSelect.addEventListener("change", generateFeedback);
      eiSelect.addEventListener("change", generateFeedback);
      eiFeatureSelect.addEventListener("change", generateFeedback);
    })
    .catch(error => console.error('Error loading config:', error));

  // Empathy Rating Logic
  function calculateEmpathy(persona, eiFeature) {
    let empathyRating = 0;

    // Empathy calculation based on persona and feature
    switch (persona.key) {
      case 'difficult':
        empathyRating = eiFeature === 'empathy' ? 1 : 0; // Lower empathy threshold for difficult personas
        break;
      case 'engaged':
        empathyRating = eiFeature === 'empathy' ? 4 : 3; // High empathy for engaged personas
        break;
      case 'indifferent':
        empathyRating = eiFeature === 'empathy' ? 2 : 1; // Average empathy for indifferent personas
        break;
      default:
        empathyRating = 3; // Default to a neutral empathy rating
    }

    return empathyRating;
  }

  // Dynamic Feedback Generation based on Persona and EI Feature
  function generateFeedback() {
    const selectedPersonaKey = personaSelect.value;
    const selectedEIKey = eiSelect.value;
    const selectedEIFeatureKey = eiFeatureSelect.value;

    fetch('https://raw.githubusercontent.com/ReflectivEI/reflectiv-ai/refs/heads/main/assets/chat/config.json')
      .then(response => response.json())
      .then(data => {
        const personas = data.personas;
        const selectedPersona = personas.find(p => p.key === selectedPersonaKey);

        const empathyRating = calculateEmpathy(selectedPersona, selectedEIFeatureKey);

        // Display the Empathy Rating and Feedback
        const feedback = generateContextAwareFeedback(selectedPersona, empathyRating);
        feedbackDisplay.innerHTML = `
          <strong>Empathy Rating: ${empathyRating}/5</strong><br />
          <p>${feedback}</p>
        `;
      });
  }

  // Context-Aware Feedback based on Persona and Empathy Rating
  function generateContextAwareFeedback(persona, empathyRating) {
    switch (persona.key) {
      case 'difficult':
        return `For Difficult HCPs, try to remain calm and patient. Empathy: ${empathyRating}/5 — Approach with reassurance and acknowledge their concerns before proceeding.`;
      case 'engaged':
        return `For Engaged HCPs, maintain a collaborative approach. Empathy: ${empathyRating}/5 — Focus on asking insightful questions and showing appreciation for their engagement.`;
      case 'indifferent':
        return `For Indifferent HCPs, focus on discussing the personal impact of treatment options. Empathy: ${empathyRating}/5 — Try to emotionally connect by addressing their concerns with understanding.`;
      default:
        return `Empathy Rating: ${empathyRating}/5 — Tailor your approach based on the HCP’s emotional needs to increase engagement.`;
    }
  }

  // ---------- UI ----------
  function buildUI() {
    mount.innerHTML = "";
    if (!mount.classList.contains("cw")) mount.classList.add("cw");

    const style = document.createElement("style");
    style.textContent = `
      #reflectiv-widget .reflectiv-chat{ display:flex; flex-direction:column; gap:12px; border:3px solid #bfc7d4; border-radius:14px; background:#fff; overflow:hidden; }
      #reflectiv-widget .chat-toolbar{ display:block; padding:14px 16px; background:#f6f8fb; border-bottom:1px solid #e1e6ef; }
      #reflectiv-widget .sim-controls{ display:grid; grid-template-columns:220px 1fr 200px 1fr; gap:12px 16px; align-items:center; }
      #reflectiv-widget .sim-controls label{ font-size:13px; font-weight:600; color:#2f3a4f; justify-self:end; white-space:nowrap; }
      #reflectiv-widget .sim-controls select{ width:100%; height:38px; padding:6px 10px; font-size:14px; border:1px solid #cfd6df; border-radius:8px; background:#fff; }
      #reflectiv-widget .chat-messages{ min-height:260px; height:320px; max-height:50vh; overflow:auto; padding:12px 14px; background:#fafbfd; }
      #reflectiv-widget .message{ margin:8px 0; display:flex; }
      #reflectiv-widget .message.user{ justify-content:flex-end; }
      #reflectiv-widget .message.assistant{ justify-content:flex-start; }
      #reflectiv-widget .message .content{ max-width:85%; line-height:1.45; font-size:14px; padding:10px 12px; border-radius:14px; border:1px solid #d6dbe3; color:#0f1522; background:#e9edf3; }
      #reflectiv-widget .message.user .content{ background:#e0e0e0; color:#000; }
      #reflectiv-widget .chat-input{ display:flex; gap:8px; padding:10px 12px; border-top:1px solid #e1e6ef; background:#fff; }
      #reflectiv-widget .chat-input textarea{ flex:1; resize:none; min-height:44px; max-height:120px; padding:10px 12px; border:1px solid #cfd6df; border-radius:10px; outline:none; }
      #reflectiv-widget .chat-input .btn{ min-width:86px; border:0; border-radius:999px; background:#2f3a4f; color:#fff; font-weight:600; }
      #reflectiv-widget .coach-section{ margin-top:0; padding:12px 14px; border:1px solid #e1e6ef; border-radius:12px; background:#fffbe8; }
      #reflectiv-widget .coach-subs .pill{ display:inline-block; padding:2px 8px; margin-right:6px; font-size:12px; background:#f1f3f7; border:1px solid #d6dbe3; border-radius:999px; text-transform:unset; }
      #reflectiv-widget .scenario-meta .meta-card{ padding:10px 12px; background:#f7f9fc; border:1px solid #e1e6ef; border-radius:10px; }
      @media (max-width:900px){ #reflectiv-widget .sim-controls{ grid-template-columns:1fr; gap:8px; } #reflectiv-widget .sim-controls label{ justify-self:start; } }
      @media (max-width:520px){ #reflectiv-widget .chat-messages{ height:46vh; } }
      #reflectiv-widget .hidden{ display:none !important; }
    `;
    document.head.appendChild(style);

    const shell = el("div", "reflectiv-chat");

    const bar = el("div", "chat-toolbar");
    const simControls = el("div", "sim-controls");

    const lcLabel = el("label", "", "Learning Center");
    lcLabel.htmlFor = "cw-mode";
    const modeSel = el("select"); modeSel.id = "cw-mode";
    LC_OPTIONS.forEach((name) => {
      const o = el("option"); o.value = name; o.textContent = name;
      modeSel.appendChild(o);
    });
    const initialLc = Object.keys(LC_TO_INTERNAL).find(k => LC_TO_INTERNAL[k] === (cfg?.defaultMode || "sales-simulation")) || "Sales Simulation";
    modeSel.value = initialLc;
    currentMode = LC_TO_INTERNAL[modeSel.value];

    const coachLabel = el("label", "", "Coach");
    coachLabel.htmlFor = "cw-coach";
    const coachSel = el("select"); coachSel.id = "cw-coach";
    [{ v: "on", t: "Coach On" }, { v: "off", t: "Coach Off" }].forEach(({ v, t }) => {
      const o = el("option"); o.value = v; o.textContent = t; coachSel.appendChild(o);
    });
    coachSel.value = coachOn ? "on" : "off";
    coachSel.onchange = () => { coachOn = coachSel.value === "on"; renderCoach(); };

    const diseaseLabel = el("label", "", "Disease State");
    diseaseLabel.htmlFor = "cw-disease";
    const diseaseSelect = el("select"); diseaseSelect.id = "cw-disease";

    const hcpLabel = el("label", "", "HCP Profiles");
    hcpLabel.htmlFor = "cw-hcp";
    const hcpSelect = el("select"); hcpSelect.id = "cw-hcp";

    // New EI Profiles Dropdown
    const eiLabel = el("label", "", "EI Profiles");
    eiLabel.htmlFor = "cw-ei";
    const eiSelect = el("select"); eiSelect.id = "cw-ei";

    // New EI Features Dropdown
    const eiFeatureLabel = el("label", "", "EI Features");
    eiFeatureLabel.htmlFor = "cw-ei-feature";
    const eiFeatureSelect = el("select"); eiFeatureSelect.id = "cw-ei-feature";

    // Add dropdowns to UI layout
    simControls.appendChild(lcLabel); simControls.appendChild(modeSel);
    simControls.appendChild(coachLabel); simControls.appendChild(coachSel);
    simControls.appendChild(diseaseLabel); simControls.appendChild(diseaseSelect);
    simControls.appendChild(hcpLabel); simControls.appendChild(hcpSelect);
    simControls.appendChild(eiLabel); simControls.appendChild(eiSelect);
    simControls.appendChild(eiFeatureLabel); simControls.appendChild(eiFeatureSelect);

    bar.appendChild(simControls);
    shell.appendChild(bar);

    const meta = el("div", "scenario-meta");
    shell.appendChild(meta);

    const msgs = el("div", "chat-messages");
    shell.appendChild(msgs);

    const inp = el("div", "chat-input");
    const ta = el("textarea"); ta.placeholder = "Type your message…";
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send.click(); } });
    const send = el("button", "btn", "Send");
    send.onclick = () => { const t = ta.value.trim(); if (!t) return; sendMessage(t); ta.value = ""; };
    inp.appendChild(ta); inp.appendChild(send);
    shell.appendChild(inp);

    mount.appendChild(shell);

    const coach = el("div", "coach-section");
    coach.innerHTML = `<h3>Coach Feedback</h3><div class="coach-body muted">Awaiting the first assistant reply…</div>`;
    mount.appendChild(coach);
  }

  // ---------- send ----------
  async function sendMessage(userText) {
    // Your existing message handling logic here...
  }

  // ---------- init ----------
  async function init() {
    // Initialize the widget and UI...
  }

  // ---------- start ----------
  waitForMount(init);
})();
