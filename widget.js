/*
 * ReflectivAI Chat/Coach v10x — scenario-rich meta-card, persona.json support
 * Scenario meta always rendered; persona/scenario pulled from persona.json and config; robust dropdown wiring
 */

(function () {
  let mount = null;
  let cfg = null, systemPrompt = "";
  let personas = {}, scenarios = [], scenariosByKey = {};
  let currentMode = "sales-simulation";
  let disease = "", hcpPersona = "";
  let conversation = [];
  let coachOn = true;

  // -- Utility helpers --
  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function md(text) {
    if (!text) return "";
    let s = esc(text).replace(/\r\n?/g, "\n");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    return s.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("\n");
  }
  async function fetchLocal(path) {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(`Failed to load ${path} (${r.status})`);
    const ct = r.headers.get("content-type") || "";
    return ct.includes("application/json") ? r.json() : r.text();
  }

  // -- Meta-card scenario lookup --
  function findScenario(disease, persona) {
    // First try scenarios merged file, then persona.json
    let key = (disease || "") + "::" + (persona || "");
    if (scenarios && scenariosByKey[key]) return scenariosByKey[key];
    // persona.json fallback
    const personaKey = Object.keys(personas).find(k => {
      let entry = personas[k] || {};
      return (entry.displayName && persona && entry.displayName.toLowerCase().includes(persona.toLowerCase()))
        || (entry.role && persona && entry.role.toLowerCase().includes(persona.toLowerCase()));
    });
    return personaKey ? { 
      therapeuticArea: disease, 
      hcpRole: persona, 
      background: personas[personaKey].background || "", 
      goal: personas[personaKey].goal || "", 
      displayName: personas[personaKey].displayName || "",
      style: personas[personaKey].style || ""
    } : null;
  }

  // -- UI rendering logic --
  function renderMetaCard(metaDiv, disease, persona) {
    if (!disease && !persona) { metaDiv.innerHTML = ""; return; }
    let sc = findScenario(disease, persona);
    if (!sc) {
      metaDiv.innerHTML = `
        <div class="meta-card">
          <div><strong>Therapeutic Area:</strong> ${esc(disease || "—")}</div>
          <div><strong>HCP Persona:</strong> ${esc(persona || "—")}</div>
          <div><strong>Background:</strong> —</div>
          <div><strong>Today's Goal:</strong> —</div>
        </div>`;
      return;
    }
    metaDiv.innerHTML = `
      <div class="meta-card">
        <div><strong>Therapeutic Area:</strong> ${esc(sc.therapeuticArea || disease || "—")}</div>
        <div><strong>HCP Persona:</strong> ${esc(sc.hcpRole || sc.displayName || persona || "—")}</div>
        <div><strong>Background:</strong> ${esc(sc.background || sc.style || "—")}</div>
        <div><strong>Today's Goal:</strong> ${esc(sc.goal || "—")}</div>
      </div>
    `;
  }

  function buildUI() {
    mount.innerHTML = "";
    if (!mount.classList.contains("cw")) mount.classList.add("cw");
    const shell = document.createElement("div");
    shell.className = "reflectiv-chat";

    // DROPDOWNS
    const toolbar = document.createElement("div");
    toolbar.className = "chat-toolbar";

    // Mode selection
    const modeLabel = document.createElement("label");
    modeLabel.textContent = "Mode";
    const modeSelect = document.createElement("select");
    [["sales-simulation", "Sales Simulation"], ["product-knowledge", "Product Knowledge"]].forEach(([v, t]) => {
      const o = document.createElement("option"); o.value = v; o.textContent = t; modeSelect.appendChild(o);
    });
    modeSelect.value = currentMode;

    // Disease dropdown
    const diseaseLabel = document.createElement("label");
    diseaseLabel.textContent = "Disease";
    const diseaseSelect = document.createElement("select");
    diseaseSelect.appendChild(new Option("Select Disease…", ""));
    const diseases = ["HIV", "Cancer", "Vaccines", "COVID", "Cardiovascular"];
    diseases.forEach(ds => {
      diseaseSelect.appendChild(new Option(ds, ds));
    });

    // HCP persona dropdown
    const hcpLabel = document.createElement("label");
    hcpLabel.textContent = "HCP Persona";
    const hcpSelect = document.createElement("select");
    hcpSelect.appendChild(new Option("Select HCP…", ""));
    hcpSelect.disabled = true;

    // Coach toggle
    const coachLabel = document.createElement("label");
    coachLabel.textContent = "Coach";
    const coachSelect = document.createElement("select");
    coachSelect.appendChild(new Option("Coach On", "on"));
    coachSelect.appendChild(new Option("Coach Off", "off"));
    coachSelect.value = coachOn ? "on" : "off";

    toolbar.appendChild(modeLabel); toolbar.appendChild(modeSelect);
    toolbar.appendChild(diseaseLabel); toolbar.appendChild(diseaseSelect);
    toolbar.appendChild(hcpLabel); toolbar.appendChild(hcpSelect);
    toolbar.appendChild(coachLabel); toolbar.appendChild(coachSelect);
    shell.appendChild(toolbar);

    // META CARD
    const metaDiv = document.createElement("div");
    metaDiv.className = "scenario-meta";
    shell.appendChild(metaDiv);

    // CHAT AREA
    const msgs = document.createElement("div");
    msgs.className = "chat-messages";
    shell.appendChild(msgs);

    // INPUT
    const input = document.createElement("div");
    input.className = "chat-input";
    const ta = document.createElement("textarea");
    ta.placeholder = "Type your message…";
    const send = document.createElement("button");
    send.className = "btn";
    send.textContent = "Send";
    input.appendChild(ta); input.appendChild(send);
    shell.appendChild(input);

    // COACH PANEL
    const coachPanel = document.createElement("div");
    coachPanel.className = "coach-section";
    coachPanel.innerHTML = `<h3>Coach Feedback</h3><div class="coach-body muted">Awaiting assistant reply…</div>`;
    shell.appendChild(coachPanel);

    // -- RENDER LOGIC --
    function updateHcpOptions() {
      hcpSelect.innerHTML = ""; hcpSelect.appendChild(new Option("Select HCP…", ""));
      if (diseaseSelect.value && personas) {
        let personaPool = Object.values(personas).filter(p =>
          p.areas && p.areas.map(String).includes(diseaseSelect.value)
        );
        if (!personaPool.length) {
          // fallback to list by disease dictionary
          switch (diseaseSelect.value) {
            case "HIV": personaPool = [{ displayName: "Internal Medicine MD" }, { displayName: "Nurse Practitioner" }, { displayName: "Physician Assistant" }, { displayName: "Infectious Disease Specialist" }]; break;
            case "Cancer": personaPool = [{ displayName: "Oncologist" }, { displayName: "Nurse Practitioner" }, { displayName: "Physician Assistant" }]; break;
            case "Vaccines": personaPool = [{ displayName: "Internal Medicine Doctor" }, { displayName: "Nurse Practitioner" }, { displayName: "Physician Assistant" }]; break;
            case "COVID": personaPool = [{ displayName: "Pulmonologist" }, { displayName: "Physician Assistant" }, { displayName: "Nurse Practitioner" }]; break;
            case "Cardiovascular": personaPool = [{ displayName: "Nurse Practitioner" }, { displayName: "Internal Medicine MD" }, { displayName: "Cardiologist" }]; break;
            default: break;
          }
        }
        personaPool.forEach(p => {
          hcpSelect.appendChild(new Option(p.displayName || p.role, p.displayName || p.role));
        });
        hcpSelect.disabled = false;
      } else {
        hcpSelect.disabled = true;
      }
    }

    function renderMetaScenario() {
      renderMetaCard(metaDiv, diseaseSelect.value, hcpSelect.value);
    }

    function renderMessages() {
      msgs.innerHTML = "";
      conversation.forEach(m => {
        const row = document.createElement("div");
        row.className = "message " + m.role;
        const c = document.createElement("div");
        c.className = "content";
        c.innerHTML = md(m.content);
        row.appendChild(c); msgs.appendChild(row);
      });
      msgs.scrollTop = msgs.scrollHeight;
    }

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
    }

    // -- UI event handlers --
    modeSelect.onchange = () => {
      currentMode = modeSelect.value;
      diseaseSelect.value = ""; hcpSelect.value = "";
      hcpSelect.disabled = true;
      conversation = [];
      renderMetaScenario();
      renderMessages();
      renderCoach();
    };
    diseaseSelect.onchange = () => {
      hcpSelect.value = ""; updateHcpOptions();
      conversation = [];
      renderMetaScenario();
      renderMessages();
      renderCoach();
    };
    hcpSelect.onchange = () => {
      conversation = [];
      renderMetaScenario();
      renderMessages();
      renderCoach();
    };
    coachSelect.onchange = () => {
      coachOn = coachSelect.value === "on";
      renderCoach();
    };
    send.onclick = () => {
      const t = ta.value.trim();
      if (!t) return;
      if (!diseaseSelect.value || (currentMode === "sales-simulation" && !hcpSelect.value)) return;
      ta.value = "";
      sendMessage(t);
    };
    ta.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send.click(); } });

    // --- MESSAGE HANDLER (LLM backend and coach parsing) ---
    async function sendMessage(userText) {
      try {
        let sysBlocks = [{ role: "system", content: systemPrompt }];
        let sc = findScenario(diseaseSelect.value, hcpSelect.value);
        if (sc) sysBlocks.push({ role: "system", content: `Persona: ${sc.hcpRole || sc.displayName} | Disease: ${sc.therapeuticArea} | Background: ${sc.background} | Goal: ${sc.goal}` });
        // Compose payload
        let payload = {
          model: "llama-3.1-8b-instant", temperature: 0.2,
          messages: [...sysBlocks, ...conversation, { role: "user", content: userText }]
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

    // -- Final assembly & render --
    mount.appendChild(shell);
    updateHcpOptions();
    renderMetaScenario();
    renderMessages();
    renderCoach();
  }

  // INIT load persona/scenario/system/context files and run buildUI
  async function init() {
    mount = document.getElementById("reflectiv-widget");
    if (!mount) { document.addEventListener("DOMContentLoaded", init); return; }
    try { personas = await fetchLocal("./assets/chat/persona.json"); } catch { personas = {}; }
    try {
      scenarios = await fetchLocal("./assets/chat/data/scenarios.merged.json");
      scenarios = Array.isArray(scenarios) ? scenarios : (scenarios.scenarios || []);
      scenariosByKey = {};
      scenarios.forEach(s => { scenariosByKey[(s.therapeuticArea || "") + "::" + (s.hcpRole || "")] = s; });
    } catch { scenarios = []; scenariosByKey = {}; }
    try { systemPrompt = await fetchLocal("./assets/chat/system.md"); } catch { systemPrompt = ""; }
    buildUI();
  }
  init();
})();
