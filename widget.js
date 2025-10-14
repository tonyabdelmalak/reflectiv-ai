/*
 * ReflectivAI Chat/Coach v10x (robust, scenario-rich version)
 * Mode, Disease, HCP wiring; meta-card always shown; persona/scenario rich context support
 * Structured JSON feedback; session/persistence; mobile safe
 */

(function () {
  let mount = null;
  let cfg = null, systemPrompt = "";
  let scenarios = [], scenariosById = new Map();
  let currentMode = "sales-simulation";
  let currentScenarioId = null;
  let conversation = [];
  let coachOn = true;

  // -- Disease mapping and persona config fallbacks (overridden by loaded files)
  const DISEASE_STATES = {
    HIV: ["Internal Medicine MD", "Nurse Practitioner", "Physician Assistant", "Infectious Disease Specialist"],
    Cancer: ["Oncologist", "Nurse Practitioner", "Physician Assistant"],
    Vaccines: ["Internal Medicine Doctor", "Nurse Practitioner", "Physician Assistant"],
    COVID: ["Pulmonologist", "Physician Assistant", "Nurse Practitioner"],
    Cardiovascular: ["Nurse Practitioner", "Internal Medicine MD", "Cardiologist"]
  };

  // ----
  async function fetchLocal(path) {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(`Failed to load ${path} (${r.status})`);
    const ct = r.headers.get("content-type") || "";
    return ct.includes("application/json") ? r.json() : r.text();
  }
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  function md(text) {
    if (!text) return "";
    let s = esc(text).replace(/\r\n?/g, "\n");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/^(?:-\s+|\*\s+).+(?:\n(?:-\s+|\*\s+).+)*/gm, (blk) => {
      const items = blk.split("\n").map((l) => l.replace(/^(?:-\s+|\*\s+)(.+)$/, "<li>$1</li>")).join("");
      return `<ul>${items}</ul>`;
    });
    return s.split(/\n{2,}/).map((p) => (p.startsWith("<ul>") ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`)).join("\n");
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function extractCoach(raw) {
    const m = String(raw || "").match(/<coach>([\s\S]*?)<\/coach>/i);
    if (!m) return { coach: null, clean: sanitizeLLM(raw) };
    let coach = null;
    try { coach = JSON.parse(m[1]); } catch {}
    const clean = sanitizeLLM(String(raw).replace(m[0], "").trim());
    return { coach, clean };
  }
  function sanitizeLLM(raw) {
    let s = String(raw || "");
    s = s.replace(/``````/g, "");
    s = s.replace(/<pre[\s\S]*?<\/pre>/gi, "");
    s = s.replace(/^\s*#{1,6}\s+/gm, "");
    return s.replace(/\n{3,}/g, "\n\n").trim();
  }

  // --- meta card: show active context (always if available)
  function renderMeta(meta, sc, mode) {
    if (!sc) { meta.innerHTML = ""; return; }
    meta.innerHTML = `
      <div class="meta-card">
        <div><strong>Therapeutic Area:</strong> ${esc(sc.therapeuticArea || "—")}</div>
        <div><strong>HCP Persona:</strong> ${esc(sc.hcpRole || "—")}</div>
        <div><strong>Background:</strong> ${esc(sc.background || "—") || "—"}</div>
        <div><strong>Today’s Goal:</strong> ${esc(sc.goal || "—") || "—"}</div>
      </div>
    `;
  }

  function populateHcpForDisease(ds) {
    const roles = DISEASE_STATES[ds] || [];
    return roles;
  }

  // --- UI/Session core ---
  function buildUI() {
    mount.innerHTML = "";
    if (!mount.classList.contains("cw")) mount.classList.add("cw");
    const shell = el("div", "reflectiv-chat");

    // Toolbar/dropdowns
    const toolbar = el("div", "chat-toolbar");

    // Mode dropdown—only Sales Simulation and Product Knowledge
    const modeLabel = el("label", "", "Mode");
    modeLabel.htmlFor = "cw-mode";
    const modeSel = el("select", "select");
    modeSel.id = "cw-mode";
    [["sales-simulation", "Sales Simulation"], ["product-knowledge", "Product Knowledge"]].forEach(([v, t]) => {
      const o = el("option");
      o.value = v;
      o.textContent = t;
      modeSel.appendChild(o);
    });
    modeSel.value = currentMode;

    // Disease dropdown
    const diseaseLabel = el("label", "", "Disease");
    diseaseLabel.htmlFor = "cw-disease";
    const diseaseSelect = el("select", "select");
    diseaseSelect.id = "cw-disease";
    const diseaseOpt = el("option", "", "Select Disease…");
    diseaseOpt.value = ""; diseaseOpt.selected = true; diseaseOpt.disabled = true;
    diseaseSelect.appendChild(diseaseOpt);
    Object.keys(DISEASE_STATES).forEach(ds => {
      const o = el("option", "", ds);
      o.value = ds;
      o.textContent = ds;
      diseaseSelect.appendChild(o);
    });

    // HCP persona dropdown
    const hcpLabel = el("label", "", "HCP Persona");
    hcpLabel.htmlFor = "cw-hcp";
    const hcpSelect = el("select", "select");
    hcpSelect.id = "cw-hcp";
    const hcpDef = el("option", "", "Select HCP…");
    hcpDef.value = ""; hcpDef.selected = true; hcpDef.disabled = true;
    hcpSelect.appendChild(hcpDef); hcpSelect.disabled = true;

    // Coach toggle
    const coachLabel = el("label", "", "Coach");
    coachLabel.htmlFor = "cw-coach";
    const coachSel = el("select", "select");
    coachSel.id = "cw-coach";
    [["on", "Coach On"], ["off", "Coach Off"]].forEach(([v, t]) => {
      const o = el("option");
      o.value = v;
      o.textContent = t;
      coachSel.appendChild(o);
    });
    coachSel.value = coachOn ? "on" : "off";

    // Arrange controls based on mode
    function arrangeControls() {
      // Show/hide coach and hcp only in simulation
      coachLabel.style.display = coachSel.style.display = (currentMode === "sales-simulation") ? "" : "none";
      hcpLabel.style.display = hcpSelect.style.display = (currentMode === "sales-simulation") ? "" : "none";
      // Coach ON by default for simulation
      coachOn = currentMode === "sales-simulation";
      coachSel.value = coachOn ? "on" : "off";
      hcpSelect.disabled = !(currentMode === "sales-simulation" && diseaseSelect.value);
    }

    toolbar.appendChild(modeLabel); toolbar.appendChild(modeSel);
    toolbar.appendChild(diseaseLabel); toolbar.appendChild(diseaseSelect);
    toolbar.appendChild(hcpLabel); toolbar.appendChild(hcpSelect);
    toolbar.appendChild(coachLabel); toolbar.appendChild(coachSel);

    shell.appendChild(toolbar);

    // Meta card area (shown above chat always, updates with selection)
    const meta = el("div", "scenario-meta");
    shell.appendChild(meta);

    // Chat/messaging area
    const msgs = el("div", "chat-messages");
    shell.appendChild(msgs);

    // Chat input
    const inputArea = el("div", "chat-input");
    const textarea = el("textarea");
    textarea.placeholder = "Type your message…";
    const sendBtn = el("button", "btn", "Send");
    inputArea.appendChild(textarea); inputArea.appendChild(sendBtn);
    shell.appendChild(inputArea);

    // Coach feedback panel
    const coachPanel = el("div", "coach-section");
    coachPanel.innerHTML = `<h3>Coach Feedback</h3><div class="coach-body muted">Awaiting assistant reply…</div>`;
    shell.appendChild(coachPanel);

    mount.appendChild(shell);

    // Load scenarios JSON if present and prep scenario map
    async function loadScenarios() {
      try {
        const sc = await fetchLocal("./assets/chat/data/scenarios.merged.json");
        scenarios = Array.isArray(sc) ? sc : (sc.scenarios || []);
        scenariosById = new Map(scenarios.map(s => [s.id, s]));
      } catch { scenarios = []; scenariosById = new Map(); }
    }

    // Session stateful triggers
    modeSel.onchange = () => {
      currentMode = modeSel.value;
      diseaseSelect.value = "";
      hcpSelect.innerHTML = ""; hcpSelect.appendChild(hcpDef); hcpSelect.disabled = true;
      conversation = [];
      arrangeControls();
      displayMeta();
      renderMessages();
      renderCoach();
    };
    diseaseSelect.onchange = () => {
      // For simulation, force enable and populate HCP from disease
      hcpSelect.innerHTML = ""; hcpSelect.appendChild(hcpDef); hcpSelect.disabled = true;
      if (currentMode === "sales-simulation" && diseaseSelect.value) {
        const roles = populateHcpForDisease(diseaseSelect.value);
        roles.forEach(p => {
          const o = el("option", "", p);
          o.value = p; hcpSelect.appendChild(o);
        });
        hcpSelect.disabled = false;
      }
      conversation = [];
      displayMeta();
      renderMessages();
      renderCoach();
    };
    hcpSelect.onchange = () => {
      conversation = [];
      displayMeta();
      renderMessages();
      renderCoach();
    };
    coachSel.onchange = () => {
      coachOn = coachSel.value === "on";
      renderCoach();
    };

    // Input send
    sendBtn.onclick = () => {
      const t = textarea.value.trim();
      if (!t) return;
      if (!diseaseSelect.value || (currentMode === "sales-simulation" && !hcpSelect.value)) return;
      textarea.value = "";
      sendMessage(t);
    };
    textarea.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
    });

    // Pre-first-chat meta display logic
    function displayMeta() {
      let sc = null;
      if (currentMode === "sales-simulation" && diseaseSelect.value && hcpSelect.value) {
        // Find scenario with these selections if present
        sc = scenarios.find(s => String(s.therapeuticArea).toLowerCase() === diseaseSelect.value.toLowerCase()
          && String(s.hcpRole).toLowerCase() === hcpSelect.value.toLowerCase());
      }
      if (!sc && diseaseSelect.value) {
        sc = { therapeuticArea: diseaseSelect.value, hcpRole: hcpSelect.value || "—", background: "", goal: "" };
      }
      renderMeta(meta, sc, currentMode);
    }

    // Chat rendering
    function renderMessages() {
      msgs.innerHTML = "";
      conversation.forEach(m => {
        const row = el("div", `message ${m.role}`);
        const c = el("div", "content");
        c.innerHTML = md(m.content);
        row.appendChild(c); msgs.appendChild(row);
      });
      msgs.scrollTop = msgs.scrollHeight;
    }
    // Coach feedback rendering
    function renderCoach() {
      const body = coachPanel.querySelector(".coach-body");
      if (!coachOn || currentMode !== "sales-simulation") { coachPanel.style.display = "none"; return; }
      coachPanel.style.display = "";
      if (!(conversation.length && conversation[conversation.length - 1]._coach)) {
        body.innerHTML = `<span class="muted">Awaiting assistant reply…</span>`;
        return;
      }
      const fb = conversation[conversation.length - 1]._coach, subs = fb.subscores || {};
      body.innerHTML = `
        <div class="coach-score">Score: <strong>${fb.score ?? "—"}</strong>/100</div>
        <div class="coach-subs">${Object.entries(subs).map(([k, v]) => `<span class="pill">${esc(k)}: ${v}</span>`).join(" ")}</div>
        <ul class="coach-list">
          <li><strong>What worked:</strong> ${esc((fb.worked || []).join(" ") || "—")}</li>
          <li><strong>What to improve:</strong> ${esc((fb.improve || []).join(" ") || "—")}</li>
          <li><strong>Suggested phrasing:</strong> ${esc(fb.phrasing || "—")}</li>
        </ul>
      `;
      if (fb.ei) {
        const eiHtml = document.createElement("div");
        eiHtml.className = "ei-badges";
        eiHtml.innerHTML = `
          <span class="ei-badge">Empathy ${esc(fb.ei.empathy_score.toFixed(1))} / 5</span>
          <span class="ei-badge">Tone: ${esc(fb.ei.tone_label)}</span>
          <span class="ei-badge">Quote: "${esc(fb.ei.evidence_quote)}"</span>
        `;
        if (!body.querySelector(".ei-badges")) {
          body.appendChild(eiHtml);
        }
      }
    }

    // Main message handler: system prompt, scenario, persona, evidence...
    async function sendMessage(userText) {
      await loadScenarios(); // make sure scenarios loaded up to date
      try {
        let sysBlocks = [{ role: "system", content: systemPrompt }];
        // Attach scenario meta (disease/HCP/persona)
        let sc = null;
        if (currentMode === "sales-simulation") {
          sc = scenarios.find(s => String(s.therapeuticArea).toLowerCase() === diseaseSelect.value.toLowerCase()
            && String(s.hcpRole).toLowerCase() === hcpSelect.value.toLowerCase());
        }
        // Evidence context (minimal for demo—extend as needed)
        let evidenceContext = [];
        if (userText && diseaseSelect.value) {
          evidenceContext = [{
            cite: "CDC MMWR 2023", summary: "Relevant CDC summary...", url: "https://cdc.gov/"
          }];
        }
        if (evidenceContext.length) {
          sysBlocks.push({ role: "system", content: "EvidenceContext:\n" + evidenceContext.map((e, i) => `${i + 1}. ${e.cite}: ${e.summary}`).join("\n") });
        }
        // Compose prompt per mode
        sysBlocks.push({ role: "system", content: currentMode === "product-knowledge" ?
          "Product Knowledge mode. Provide concise, evidence-based educational overview of selected disease. Cite reputable guideline sources. No <coach> feedback." :
          "Sales Simulation mode. Simulate realistic HCP-Rep interaction. Use persona and scenario context in dialogue. End with required <coach> JSON block."
        });

        // Compose payload
        let payload = {
          model: "llama-3.1-8b-instant",
          temperature: 0.2,
          messages: [...sysBlocks,
          ...(sc ? [{ role: "system", content: `Persona: ${sc.hcpRole} | Disease: ${sc.therapeuticArea} | Background: ${sc.background} | Goal: ${sc.goal}` }] : []),
          ...conversation, { role: "user", content: userText }]
        };

        let reply = "", coach = null;
        let r = await fetch("https://my-chat-agent.tonyabdelmalak.workers.dev/chat", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
        });
        let j = await r.json(); reply = j.content || j.reply || "";
        let m = reply.match(/<coach>([\s\S]*?)<\/coach>/i);
        if (m) { try { coach = JSON.parse(m[1]); } catch { } reply = reply.replace(m[0], "").trim(); }

        conversation.push({ role: "user", content: userText });
        conversation.push({ role: "assistant", content: reply, _coach: coach });
        renderMessages();
        renderCoach();
      } catch (e) {
        conversation.push({ role: "assistant", content: "Model error. Please try again." }); renderMessages();
      }
    }

    // Initial render chain
    arrangeControls();
    displayMeta();
    renderMessages();
    renderCoach();
  }

  // Main init: load config, prompt, then run buildUI()
  async function init() {
    mount = document.getElementById("reflectiv-widget");
    if (!mount) {
      document.addEventListener("DOMContentLoaded", () => { mount = document.getElementById("reflectiv-widget"); buildUI(); });
    } else {
      buildUI();
    }
    try { cfg = await fetchLocal("./assets/chat/config.json"); } catch { }
    try { systemPrompt = await fetchLocal("./assets/chat/system.md"); } catch { systemPrompt = ""; }
  }
  init();
})();
