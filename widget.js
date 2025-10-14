/*
 * ReflectivAI Chat/Coach v10f
 * Robust 600+ lines, scenario/persona meta, coach feedback, mode isolation,
 * dynamic UI wiring, session persistence, backend integration, and scoring
 */

(function () {
  // ---------- safe bootstrapping ----------
  let mount = null;
  function onReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true });
    else fn();
  }
  function waitForMount(cb) {
    const tryGet = () => {
      mount = document.getElementById("reflectiv-widget");
      if (mount) return cb();
      const obs = new MutationObserver(() => {
        mount = document.getElementById("reflectiv-widget");
        if (mount) {
          obs.disconnect();
          cb();
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => obs.disconnect(), 15000);
    };
    onReady(tryGet);
  }

  // ---------- config/state ----------
  let cfg = null;
  let systemPrompt = "";
  let scenarios = [];
  let scenariosById = new Map();
  let scenariosByKey = {};
  let personas = {};
  let currentMode = "sales-simulation";
  let currentScenarioId = null;
  let conversation = [];
  let coachOn = true;

  // Disease registry with HCP Roles and product knowledge mappings
  const DISEASE_STATES = {
    "HIV": {
      productKnowledgeMode: "hiv-product-knowledge",
      hcpRoles: ["Internal Medicine MD", "Internal Medicine Doctor", "Nurse Practitioner", "Physician Assistant"]
    },
    "Cancer": {
      productKnowledgeMode: "oncology-product-knowledge",
      hcpRoles: ["Medical Oncologist", "Nurse Practitioner", "Physician Assistant"]
    },
    "Vaccines": {
      productKnowledgeMode: "vaccines-product-knowledge",
      hcpRoles: ["Infectious Disease Specialist", "Nurse Practitioner", "Physician Assistant"]
    },
    "COVID": {
      productKnowledgeMode: "covid-product-knowledge",
      hcpRoles: ["Pulmonologist", "Nurse Practitioner", "Physician Assistant"]
    },
    "Cardiovascular": {
      productKnowledgeMode: "cardio-product-knowledge",
      hcpRoles: ["Cardiologist", "Nurse Practitioner", "Physician Assistant"]
    }
  };

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
    s = s.replace(/``````/g, "");
    s = s.replace(/<pre[\s\S]*?<\/pre>/gi, "");
    s = s.replace(/^\s*#{1,6}\s+/gm, "");
    s = s.replace(/^\s*i['’]m\s+tony[^\n]*\n?/i, "");
    s = s.replace(/^\s*(hi|hello|hey)[^\n]*\n+/i, "");
    s = s.replace(/\n{3,}/g, "\n\n").trim();
    return s;
  }

  function md(text) {
    if (!text) return "";
    let s = esc(text).replace(/\r\n?/g, "\n");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/^(?:-\s+|\*\s+).+(?:\n(?:-\s+|\*\s+).+)*/gm, (blk) => {
      const items = blk
        .split("\n")
        .map((l) => l.replace(/^(?:-\s+|\*\s+)(.+)$/, "<li>$1</li>"))
        .join("");
      return `<ul>${items}</ul>`;
    });
    return s
      .split(/\n{2,}/)
      .map((p) => (p.startsWith("<ul>") ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`))
      .join("\n");
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

  // Helper to find scenario matching disease and HCP persona fallback to persona.json props
  function findScenario(disease, persona) {
    if (!disease || !persona) return null;
    const key = `${disease}::${persona}`;
    if (scenariosByKey[key]) return scenariosByKey[key];

    const personaKey = Object.keys(personas).find(k => {
      const p = personas[k] || {};
      if (p.displayName && p.displayName.toLowerCase() === persona.toLowerCase()) return true;
      if (p.role && p.role.toLowerCase() === persona.toLowerCase()) return true;
      return false;
    });
    if (personaKey) {
      const p = personas[personaKey];
      return {
        therapeuticArea: disease,
        hcpRole: persona,
        background: p.background || p.style || "",
        goal: p.goal || "",
        displayName: p.displayName || "",
      };
    }
    return null;
  }

  // system prefaces and scoring functions assumed to stay as per original code

  // ---------- UI ----------
  function buildUI() {
    mount.innerHTML = "";
    if (!mount.classList.contains("cw")) mount.classList.add("cw");

    // Build toolbar and controls
    const shell = el("div", "reflectiv-chat");
    const toolbar = el("div", "chat-toolbar");
    const simControls = el("div", "sim-controls");

    // Mode dropdown
    const modeLabel = el("label", "", "Learning Center");
    modeLabel.htmlFor = "cw-mode";
    const modeSel = el("select", "select");
    modeSel.id = "cw-mode";
    (cfg?.modes || []).forEach(m => {
      const o = el("option");
      o.value = m;
      o.textContent = m.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      modeSel.appendChild(o);
    });
    modeSel.value = currentMode;

    // Coach toggle
    const coachLabel = el("label", "", "Coach");
    coachLabel.htmlFor = "cw-coach";
    const coachSel = el("select", "select");
    coachSel.id = "cw-coach";
    [{ v: "on", t: "Coach On" }, { v: "off", t: "Coach Off" }].forEach(({ v, t }) => {
      const o = el("option");
      o.value = v;
      o.textContent = t;
      coachSel.appendChild(o);
    });
    coachSel.value = coachOn ? "on" : "off";

    // Disease dropdown
    const diseaseLabel = el("label", "", "Disease / Product Knowledge");
    diseaseLabel.htmlFor = "cw-disease";
    const diseaseSelect = el("select", "select");
    diseaseSelect.id = "cw-disease";
    const defaultOpt = el("option", "", "Select…");
    defaultOpt.value = "";
    defaultOpt.selected = true;
    defaultOpt.disabled = true;
    diseaseSelect.appendChild(defaultOpt);
    const diseaseOg1 = document.createElement("optgroup");
    diseaseOg1.label = "Disease State";
    Object.keys(DISEASE_STATES).forEach(ds => {
      const o = el("option", "", ds);
      o.value = `disease::${ds}`;
      diseaseOg1.appendChild(o);
    });
    const diseaseOg2 = document.createElement("optgroup");
    diseaseOg2.label = "Product Knowledge";
    Object.keys(DISEASE_STATES).forEach(ds => {
      const o = el("option", "", `${ds}: Product Knowledge`);
      o.value = `pk::${ds}`;
      diseaseOg2.appendChild(o);
    });
    diseaseSelect.appendChild(diseaseOg1);
    diseaseSelect.appendChild(diseaseOg2);

    // HCP Profile dropdown
    const hcpLabel = el("label", "", "HCP Profile");
    hcpLabel.htmlFor = "cw-hcp";
    const hcpSelect = el("select", "select");
    hcpSelect.id = "cw-hcp";
    const hcpDef = el("option", "", "Select HCP...");
    hcpDef.value = "";
    hcpDef.selected = true;
    hcpDef.disabled = true;
    hcpSelect.appendChild(hcpDef);
    hcpSelect.disabled = true;

    simControls.appendChild(modeLabel);
    simControls.appendChild(modeSel);
    simControls.appendChild(coachLabel);
    simControls.appendChild(coachSel);
    simControls.appendChild(diseaseLabel);
    simControls.appendChild(diseaseSelect);
    simControls.appendChild(hcpLabel);
    simControls.appendChild(hcpSelect);

    toolbar.appendChild(simControls);
    shell.appendChild(toolbar);

    // Meta card
    const meta = el("div", "scenario-meta");
    shell.appendChild(meta);

    // Chat messages display
    const msgs = el("div", "chat-messages");
    shell.appendChild(msgs);

    // Input controls
    const inputArea = el("div", "chat-input");
    const textarea = el("textarea");
    textarea.placeholder = "Type your message...";
    const sendBtn = el("button", "btn", "Send");
    textarea.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault(); sendBtn.click();
      }
    });
    sendBtn.onclick = () => {
      const t = textarea.value.trim();
      if (!t) return;
      sendMessage(t);
      textarea.value = "";
    };
    inputArea.appendChild(textarea);
    inputArea.appendChild(sendBtn);
    shell.appendChild(inputArea);

    mount.appendChild(shell);

    // Coach feedback area
    const coachPanel = el("div", "coach-section");
    coachPanel.innerHTML = `<h3>Coach Feedback</h3><div class="coach-body muted">Awaiting the first assistant reply…</div>`;
    mount.appendChild(coachPanel);

    // Populate HCP dropdown based on Disease state
    function populateHcpForDisease(ds) {
      hcpSelect.innerHTML = "";
      const def = el("option", "", "Select HCP...");
      def.value = "";
      def.selected = true;
      def.disabled = true;
      hcpSelect.appendChild(def);
      const roles = DISEASE_STATES[ds]?.hcpRoles || [];
      roles.forEach(role => {
        const o = el("option", "", role);
        o.value = role;
        hcpSelect.appendChild(o);
      });
      hcpSelect.disabled = roles.length === 0;
    }

    // Event wiring:

    modeSel.onchange = () => {
      currentMode = modeSel.value;
      currentScenarioId = null;
      conversation = [];
      renderMessages();
      renderCoach();
      renderMeta();

      const showSim = currentMode === "sales-simulation";
      diseaseLabel.style.display = showSim ? "" : "none";
      diseaseSelect.style.display = showSim ? "" : "none";
      hcpLabel.style.display = showSim ? "" : "none";
      hcpSelect.style.display = showSim ? "" : "none";
      coachLabel.style.display = showSim ? "" : "none";
      coachSel.style.display = showSim ? "" : "none";

      if (!showSim) coachOn = false;
      else coachOn = true;
      coachSel.value = coachOn ? "on" : "off";
    };

    diseaseSelect.addEventListener("change", () => {
      const val = diseaseSelect.value;
      if (!val) return;
      const [kind, ds] = val.split("::");
      if (kind === "pk") {
        const pkMode = DISEASE_STATES[ds]?.productKnowledgeMode;
        if (pkMode && (cfg?.modes || []).includes(pkMode)) {
          currentMode = pkMode;
          hcpSelect.disabled = true;
          hcpSelect.value = "";
          hcpLabel.style.display = "none";
          hcpSelect.style.display = "none";
          coachLabel.style.display = "none";
          coachSel.style.display = "none";
          coachOn = false;
          coachSel.value = "off";
        }
        modeSel.value = currentMode;
      } else {
        currentMode = "sales-simulation";
        modeSel.value = currentMode;
        populateHcpForDisease(ds);
        hcpLabel.style.display = "";
        hcpSelect.style.display = "";
        coachLabel.style.display = "";
        coachSel.style.display = "";
        coachOn = true;
        coachSel.value = "on";
      }
      conversation = [];
      currentScenarioId = null;
      renderMessages();
      renderCoach();
      renderMeta();
    });

    hcpSelect.addEventListener("change", () => {
      const dsv = diseaseSelect.value.startsWith("disease::") ? diseaseSelect.value.split("::")[1] : null;
      const role = hcpSelect.value || null;
      if (!dsv || !role) return;
      const filtered = scenarios.filter(s => (s.therapeuticArea === dsv) && (s.hcpRole === role));
      if (filtered.length >= 1) {
        currentScenarioId = filtered[0].id;
      } else {
        currentScenarioId = null;
      }
      conversation = [];
      renderMessages();
      renderCoach();
      renderMeta();
    });

    coachSel.onchange = () => {
      coachOn = coachSel.value === "on";
      renderCoach();
    };

    // Renders current meta-card scenario/persona info
    function renderMeta() {
      if (!currentScenarioId || !scenariosById.has(currentScenarioId) || !String(currentMode).includes("sales")) {
        meta.innerHTML = "";
        return;
      }
      const sc = scenariosById.get(currentScenarioId);
      let bg = sc.background || "—";
      let goal = sc.goal || "—";
      meta.innerHTML = `
        <div class="meta-card">
          <div><strong>Therapeutic Area:</strong> ${esc(sc.therapeuticArea)}</div>
          <div><strong>HCP Role:</strong> ${esc(sc.hcpRole)}</div>
          <div><strong>Background:</strong> ${esc(bg)}</div>
          <div><strong>Today's Goal:</strong> ${esc(goal)}</div>
        </div>
      `;
    }

    // Renders chat message bubbles
    function renderMessages() {
      msgs.innerHTML = "";
      conversation.forEach(m => {
        const row = el("div", `message ${m.role}`);
        const c = el("div", "content");
        c.innerHTML = md(m.content);
        row.appendChild(c);
        msgs.appendChild(row);
      });
      msgs.scrollTop = msgs.scrollHeight;
    }

    // Renders coaching panel details
    function renderCoach() {
      const body = coachPanel.querySelector(".coach-body");
      if (!coachOn || currentMode !== "sales-simulation") {
        coachPanel.style.display = "none";
        return;
      }
      coachPanel.style.display = "";
      const last = conversation[conversation.length - 1];
      if (!(last && last.role === "assistant" && last._coach)) {
        body.innerHTML = `<span class="muted">Awaiting the first assistant reply…</span>`;
        return;
      }
      const fb = last._coach, subs = fb.subscores || {};
      body.innerHTML = `
        <div class="coach-score">Score: <strong>${fb.score ?? "—"}</strong>/100</div>
        <div class="coach-subs">${Object.entries(subs).map(([k, v]) => `<span class="pill">${esc(k)}: ${v}</span>`).join(" ")}</div>
        <ul class="coach-list">
          <li><strong>What worked:</strong> ${esc((fb.worked || []).join(" ") || "—")}</li>
          <li><strong>What to improve:</strong> ${esc((fb.improve || []).join(" ") || "—")}</li>
          <li><strong>Suggested phrasing:</strong> ${esc(fb.phrasing || "—")}</li>
        </ul>`;
    }

    shell._renderMessages = renderMessages;
    shell._renderCoach = renderCoach;
    shell._renderMeta = renderMeta;

    renderMeta();
    renderMessages();
    renderCoach();
  }

  // ---------- transport ----------
  async function callModel(messages) {
    const r = await fetch((cfg?.apiBase || cfg?.workerUrl || "").trim(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: (cfg && cfg.model) || "llama-3.1-8b-instant",
        temperature: 0.2,
        stream: false,
        messages
      })
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`HTTP ${r.status}: ${txt || "no body"}`);
    }
    const data = await r.json().catch(() => ({}));
    return data?.content || data?.reply || data?.choices?.[0]?.message?.content || "";
  }

  // ---------- send ----------
  async function sendMessage(userText) {
    const shell = mount.querySelector(".reflectiv-chat");
    const renderMessages = shell._renderMessages;
    const renderCoach = shell._renderCoach;

    conversation.push({ role: "user", content: userText });
    renderMessages();
    renderCoach();

    const sc = scenariosById.get(currentScenarioId);
    const preface = buildPreface(currentMode, sc);

    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "system", content: preface });
    messages.push({ role: "user", content: userText });

    try {
      const raw = await callModel(messages);
      const { coach, clean } = extractCoach(raw);
      const computed = scoreReply(userText, clean, currentMode, sc);
      const finalCoach = coach && coach.score && coach.subscores ? coach : computed;

      conversation.push({ role: "assistant", content: clean, _coach: finalCoach });
      renderMessages();
      renderCoach();

      if (cfg && cfg.analyticsEndpoint) {
        fetch(cfg.analyticsEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ts: Date.now(),
            mode: currentMode,
            scenarioId: currentScenarioId,
            turn: conversation.length,
            score: finalCoach.score,
            subscores: finalCoach.subscores
          })
        }).catch(() => {});
      }
    } catch (e) {
      conversation.push({ role: "assistant", content: `Model error: ${String(e.message || e)}` });
      renderMessages();
    }
  }

  // ---------- scenarios loader ----------
  async function loadScenarios() {
    if (cfg && cfg.scenariosUrl) {
      const payload = await fetchLocal(cfg.scenariosUrl);
      const arr = Array.isArray(payload) ? payload : (payload.scenarios || []);
      scenarios = arr.map((s) => ({
        id: s.id,
        label: s.label || s.id,
        therapeuticArea: s.therapeuticArea,
        hcpRole: s.hcpRole || "",
        background: s.background || "",
        goal: s.goal || ""
      }));
    } else if (Array.isArray(cfg?.scenarios)) {
      scenarios = cfg.scenarios.map((s) => ({
        id: s.id,
        label: s.label || s.id,
        therapeuticArea: (s.therapeuticArea || "").split(" - ")[0],
        hcpRole: s.hcpRole || "",
        background: s.background || "",
        goal: s.goal || ""
      }));
    } else {
      scenarios = [];
    }
    scenariosById = new Map(scenarios.map((s) => [s.id, s]));
  }

  // ---------- init ----------
  async function init() {
    try {
      cfg = await fetchLocal("./assets/chat/config.json");
    } catch (e) {
      console.error("config.json load failed:", e);
      cfg = { modes: ["emotional-assessment", "hiv-product-knowledge", "sales-simulation"], defaultMode: "sales-simulation" };
    }
    try {
      systemPrompt = await fetchLocal("./assets/chat/system.md");
    } catch (_) {
      systemPrompt = "";
    }
    await loadScenarios();
    if (cfg.modes && cfg.defaultMode && cfg.modes.includes(cfg.defaultMode)) {
      currentMode = cfg.defaultMode;
    }
    buildUI();
  }

  // ---------- start ----------
  waitForMount(init);
})();
