/*
 * ReflectivAI Chat/Coach — drop-in
 * Modes: Product Knowledge | Sales Simulation/* widget.js — transport layer only. Safe for both sites.
 * Exposes window.sendChat(cfg, userInput, transcript?, mode?)
 * - cfg.workerUrl must point to your Worker /chat endpoint
 * - transcript is an array of {role, content} or leave []
 * - mode defaults to "sales-simulation"
 * Returns: { reply, coach, raw }  where raw is the full HTTP JSON
 */

(function () {
  async function sendChat(cfg, userInput, transcript = [], mode = "sales-simulation", coachOn = true) {
    if (!cfg || !cfg.workerUrl) throw new Error("Missing cfg.workerUrl");
    const payload = {
      message: String(userInput || ""),
      transcript: Array.isArray(transcript) ? transcript : [],
      mode,
      coachOn
    };
    if (!payload.message) throw new Error("Empty message");

    const res = await fetch(cfg.workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (json && json.error) ? json.error : `HTTP ${res.status}`;
      throw new Error(msg);
    }

    // Dual-shape support: Prefer top-level reply, fallback to OpenAI choices
    const reply =
      (json && typeof json.reply === "string" && json.reply) ||
      (json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) ||
      "";

    const coach = json && json.coach ? json.coach : null;

    return { reply, coach, raw: json };
  }

  // Minimal UI glue for common cases. No-op if elements not found.
  async function wireSimpleUI(cfg) {
    const $input = document.querySelector("[data-chat-input]") || document.getElementById("chat-input");
    const $send  = document.querySelector("[data-chat-send]")  || document.getElementById("chat-send");
    const $log   = document.querySelector("[data-chat-log]")   || document.getElementById("chat-log");
    const $coach = document.querySelector("[data-coach]")      || document.getElementById("coach");

    if (!$input || !$send) return; // site has its own wiring

    let transcript = [];

    async function handleSend() {
      const text = ($input.value || "").trim();
      if (!text) return;

      // render user bubble if container exists
      if ($log) appendBubble($log, "user", text);

      // push to transcript for context
      transcript.push({ role: "user", content: text });

      // call Worker
      try {
        const { reply, coach } = await sendChat(cfg, text, transcript, cfg.defaultMode || "sales-simulation", true);

        // render assistant bubble
        if ($log) appendBubble($log, "assistant", reply);

        // update coach panel if present
        if ($coach && coach) renderCoach($coach, coach);

        // also push assistant turn into transcript
        transcript.push({ role: "assistant", content: reply });
      } catch (e) {
        if ($log) appendBubble($log, "error", `Error: ${e.message}`);
        console.error(e);
      } finally {
        $input.value = "";
        $input.focus();
      }
    }

    $send.addEventListener("click", handleSend);
    $input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        handleSend();
      }
    });
  }

  function appendBubble(container, role, text) {
    const div = document.createElement("div");
    div.className = `bubble ${role}`;
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function renderCoach(node, coach) {
    const { scores = {}, summary = "", tips = [], risks = [] } = coach || {};
    node.innerHTML = `
      <div class="coach-summary">${summary}</div>
      <ul class="coach-scores">
        <li>Empathy: ${score(scores.empathy)}</li>
        <li>Accuracy: ${score(scores.accuracy)}</li>
        <li>Confidence Δ: ${score(scores.confidenceDelta)}</li>
        <li>Compliance: ${score(scores.compliance)}</li>
        <li>Readiness: ${score(scores.readiness)}</li>
      </ul>
      ${tips.length ? `<div class="coach-tips"><strong>Tips</strong><ul>${tips.map(t=>`<li>${t}</li>`).join("")}</ul></div>` : ""}
      ${risks && risks.length ? `<div class="coach-risks"><strong>Risks</strong><ul>${risks.map(r=>`<li>${r}</li>`).join("")}</ul></div>` : ""}
    `;
    function score(v){ return typeof v === "number" ? v : "—"; }
  }

  // Expose
  window.sendChat = sendChat;
  window.wireSimpleUI = wireSimpleUI;
})();

 * Controls: Mode, Therapeutic Area, HCP Profile/Scenario, Coach (static)
 * Sources:
 *   - config.json: { apiBase, workerUrl?, model?, scenariosUrl, areasUrl? }
 *   - scenariosUrl: array or {items|scenarios}[]
 *   - areasUrl (optional): ["HIV","Oncology",...]
 */

(function () {
  // -------- boot --------
  let mount = null;
  const onReady = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();
  function waitForMount(cb) {
    const run = () => {
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
    onReady(run);
  }

  // -------- state --------
  let cfg = null;
  let scenarios = []; // normalized
  const scenariosById = new Map();
  let areas = []; // TA list
  const current = { mode: "Sales Simulation", area: "", scenarioId: "" };
  let conversation = []; // [{role:"user"|"assistant", content}]
  let coachVisible = false;

  // -------- utils --------
  const el = (t, c, h) => {
    const n = document.createElement(t);
    if (c) n.className = c;
    if (h != null) n.innerHTML = h;
    return n;
  };
  const uniq = (a) => [...new Set(a.filter(Boolean))];

  async function loadJSON(path) {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(`Failed to load ${path} (${r.status})`);
    return r.json();
  }
  async function loadConfig() {
    return loadJSON("./config.json");
  }

  // ---- area mapping tolerant to many schemas ----
  function pickArea(s) {
    let a =
      s.area ??
      s.therapeutic_area ??
      s.ta ??
      s.therapeuticArea ??
      s["therapeutic-area"] ??
      s.disease_state ??
      s.disease ??
      s.area_name ??
      s.ta_name ??
      (Array.isArray(s.tags) &&
        s.tags.find((t) =>
          /hiv|onco|oncology|vaccin|hepat|hbv|cardio|pulmo|diabet|endocr|resp/i.test(
            String(t)
          )
        )) ??
      "General";
    a = String(a).trim();

    if (/^hiv$/i.test(a)) a = "HIV";
    else if (/^(hbv|hepatitis\s*b)$/i.test(a)) a = "Hepatitis B";
    else if (/^cvd|cardio/i.test(a)) a = "Cardiology";
    else if (/^pulm|resp/i.test(a)) a = "Pulmonology";
    else if (/^onco/i.test(a)) a = "Oncology";
    else if (/^vaccin/i.test(a)) a = "Vaccines";
    else if (/^gen/i.test(a)) a = "General";
    return a;
  }

  async function loadScenarios(url) {
    const raw = await loadJSON(url);
    const arr = Array.isArray(raw)
      ? raw
      : Array.isArray(raw.items)
      ? raw.items
      : Array.isArray(raw.scenarios)
      ? raw.scenarios
      : [];

    scenariosById.clear();
    arr.forEach((s) => {
      const area = pickArea(s);
      const id =
        s.id ||
        s.scenario_id ||
        `${area}:${s.title || s.name || "untitled"}`.replace(/\s+/g, "_");
      const title = s.title || s.name || `${area} scenario`;
      const hcp = s.hcp || s.profile || s.persona || "HCP";
      const objection = s.objection || s.objections || "";
      const goal = s.goal || s.objective || "";
      const rep = s.rep || s.approach || s.rep_approach || "";
      const rubric = s.rubric || s.scoring || {};
      const norm = { ...s, id, area, title, hcp, objection, goal, rep, rubric };
      scenariosById.set(id, norm);
    });
    return [...scenariosById.values()];
  }

  async function loadAreas(areasUrl) {
    if (areasUrl) {
      try {
        const a = await loadJSON(areasUrl);
        if (Array.isArray(a) && a.length) return a.map(String);
      } catch (_) {}
    }
    return uniq(scenarios.map((s) => s.area)).sort((a, b) => a.localeCompare(b));
  }

  function filterScenariosByArea(area) {
    return scenarios.filter((s) => s.area === area);
  }

  // -------- compliance prompt --------
  function complianceSystemPrompt(mode, area, s) {
    const cites =
      "NEJM, JAMA, The Lancet, BMJ, Nature Medicine, Annals of Internal Medicine, CDC, NIH, FDA label, EMA, WHO, IDSA, ASCO, AHA, GOLD, ADA";
    const base = `You are an AI assistant for life-sciences field training. Follow strict medical accuracy and regulatory compliance.
Rules:
- Cite primary sources with inline numeric markers and full references at the end of each answer.
- Prefer peer-reviewed journals, guidelines, and regulator labels: ${cites}.
- No promotion, no off-label claims, ensure fair-balance including efficacy limits, safety, and contraindications.
- If uncertain, state uncertainty and what data is required.
- Use precise language. Include dates of trials/guidelines.`;
    if (mode === "Product Knowledge") {
      return `${base}
Task: Answer evidence-based questions for Therapeutic Area: ${area}. Provide concise referenced responses.`;
    }
    const banner = s
      ? `TA: ${s.area} | HCP: ${s.hcp} | Scenario: ${s.title} | Goal: ${s.goal} | Objection: ${s.objection}`
      : "";
    return `${base}
Task: Role-play the HCP for a sales simulation consistent with the persona. Keep replies short. After each user turn, emit a machine-readable "coach" object with rubric scores (0-5) for: Needs Assessment, Clinical Accuracy, Compliance/Fair-Balance, Objection Handling, Close/Next Step, plus two bullet tips. Context: ${banner}`;
  }

  // -------- UI --------
  function render() {
    mount.classList.add("cw");
    mount.innerHTML = "";
    const shell = el("div", "cw-shell");

    // persona banner (hidden until full selection)
    const banner = el("div", "cw-banner hidden");
    banner.innerHTML = `<h4 id="bn-title"></h4>
      <p id="bn-objection"></p><p id="bn-goal"></p><p id="bn-rep"></p>`;
    shell.appendChild(banner);

    // controls
    const controls = el("div", "cw-controls");
    const grid = el("div", "grid");

    // Mode
    const fMode = el("div", "field");
    const lbMode = el("label", null, "Mode");
    const selMode = el("select");
    ["Product Knowledge", "Sales Simulation"].forEach((v) => {
      const o = el("option");
      o.value = v;
      o.textContent = v;
      selMode.appendChild(o);
    });
    selMode.value = current.mode;
    fMode.append(lbMode, selMode);

    // Therapeutic Area
    const fTA = el("div", "field");
    const lbTA = el("label", null, "Therapeutic Area");
    const selTA = el("select");
    const taPh = el("option");
    taPh.value = "";
    taPh.textContent = "Select Therapeutic Area";
    taPh.disabled = true;
    taPh.selected = true;
    selTA.appendChild(taPh);
    fTA.append(lbTA, selTA);

    // HCP Profile/Scenario
    const fHCP = el("div", "field");
    const lbHCP = el("label", null, "HCP Profile/Scenario");
    const selHCP = el("select");
    const hcpPh = el("option");
    hcpPh.value = "";
    hcpPh.textContent = "Select HCP Profile/Scenario";
    hcpPh.disabled = true;
    hcpPh.selected = true;
    selHCP.appendChild(hcpPh);
    fHCP.append(lbHCP, selHCP);

    // Coach (static look-alike)
    const fCoach = el("div", "field");
    const lbCoach = el("label", null, "Coach");
    const coachStatic = el(
      "div",
      "static",
      "Hi! I'm here to provide feedback during your simulated conversation. Ready?"
    );
    fCoach.append(lbCoach, coachStatic);

    grid.append(fMode, fTA, fHCP, fCoach);
    controls.appendChild(grid);
    shell.appendChild(controls);

    // chat + input
    const chat = el("div", "cw-chat");
    const log = el("div", "cw-log");
    const input = el("div", "cw-input");
    const ta = el("textarea");
    ta.placeholder = "Type your message…";
    const btn = el("button", "btn", "Send");
    input.append(ta, btn);
    chat.append(log, input);
    shell.appendChild(chat);

    // coach panel
    const coach = el("div", "coach hidden");
    coach.innerHTML = `<div class="coach-h">Coach Feedback</div>
      <div class="coach-b"><div id="coach-text">Active. I will score each turn.</div>
      <div class="score" id="coach-score"></div></div>`;
    shell.appendChild(coach);

    mount.appendChild(shell);

    // populate controls
    function populateAreas() {
      selTA.innerHTML = "";
      selTA.appendChild(taPh.cloneNode(true));
      areas.forEach((a) => {
        const o = el("option");
        o.value = a;
        o.textContent = a;
        selTA.appendChild(o);
      });
      current.area = "";
      selTA.value = "";
      populateHCP(true);
    }
    function populateHCP(clearOnly) {
      selHCP.innerHTML = "";
      selHCP.appendChild(hcpPh.cloneNode(true));
      current.scenarioId = "";
      selHCP.value = "";
      if (clearOnly || !current.area) return;
      filterScenariosByArea(current.area).forEach((s) => {
        const o = el("option");
        o.value = s.id;
        o.textContent = `${s.hcp}: ${s.title}`;
        selHCP.appendChild(o);
      });
    }

    populateAreas();
    applyVisibility();
    updateBanner();

    // events
    selMode.addEventListener("change", () => {
      current.mode = selMode.value;
      applyVisibility();
      updateBanner();
    });
    selTA.addEventListener("change", () => {
      current.area = selTA.value;
      populateHCP(false);
      updateBanner();
    });
    selHCP.addEventListener("change", () => {
      current.scenarioId = selHCP.value;
      updateBanner();
    });
    btn.addEventListener("click", () => send(ta, log, coach));
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        btn.click();
      }
    });

    function applyVisibility() {
      const pk = current.mode === "Product Knowledge";
      fHCP.classList.toggle("hidden", pk);
      fCoach.classList.toggle("hidden", pk);
      coachVisible = !pk;
      coach.classList.toggle("hidden", pk);
      if (!pk) {
        selTA.value = current.area || "";
        selHCP.value = current.scenarioId || "";
      }
    }

    function updateBanner() {
      const pk = current.mode === "Product Knowledge";
      const ready = !pk && current.area && current.scenarioId;
      banner.classList.toggle("hidden", !ready);
      if (!ready) return;
      const s = scenariosById.get(current.scenarioId);
      if (!s) return;
      banner.querySelector("#bn-title").textContent = `${s.hcp} — ${s.title}`;
      banner.querySelector("#bn-objection").textContent = `Objection: ${
        s.objection || "—"
      }`;
      banner.querySelector("#bn-goal").textContent = `Today’s Goal: ${
        s.goal || "—"
      }`;
      banner.querySelector("#bn-rep").textContent = `Rep Approach: ${
        s.rep || "—"
      }`;
    }
  }

  // -------- messaging (API-compatible) --------
  async function callApi(payload) {
    const url = cfg.apiBase || cfg.workerUrl;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`API ${r.status}`);
    return r.json();
  }

  function extractReply(data) {
    return (
      data.reply ||
      data.text ||
      data.message ||
      (data.choices && data.choices[0] && data.choices[0].message?.content) ||
      data.data?.reply ||
      ""
    );
  }
  function extractCoach(data) {
    return data.coach || data.meta?.coach || null;
  }

  function renderMsg(log, role, text) {
    const m = el("div", "msg " + (role === "user" ? "me" : ""));
    m.innerHTML = `<span>${text}</span>`;
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
  }

  function renderCoach(coachEl, fb) {
    if (!fb) return;
    const text = coachEl.querySelector("#coach-text");
    const score = coachEl.querySelector("#coach-score");
    text.textContent = (fb.tips && fb.tips.join(" • ")) || "—";
    score.innerHTML = "";
    const parts = [
      ["Needs", "needs_assessment"],
      ["Accuracy", "clinical_accuracy"],
      ["Compliance", "compliance"],
      ["Objection", "objection_handling"],
      ["Close", "close_next_step"],
    ];
    parts.forEach(([lbl, key]) => {
      const v = fb[key];
      if (typeof v === "number") {
        score.appendChild(el("div", "pill", `${lbl}: ${v}/5`));
      }
    });
  }

  async function send(ta, log, coachEl) {
    const content = ta.value.trim();
    if (!content) return;
    ta.value = "";
    renderMsg(log, "user", content);

    const mode = current.mode;
    const area = current.area;
    const scenario = current.scenarioId
      ? scenariosById.get(current.scenarioId)
      : null;

    const system = complianceSystemPrompt(mode, area, scenario);

    // Build OpenAI-like "messages" while also passing our explicit fields.
    const messages = [
      { role: "system", content: system },
      ...conversation,
      { role: "user", content },
    ];

    const payload = {
      model: cfg.model || "gpt-4o-mini",
      system,
      messages,
      mode,
      area,
      scenario: scenario || null,
      scenarioId: scenario?.id || null,
      request_citations: true,
      request_coach: mode === "Sales Simulation",
      stream: false,
    };

    try {
      const data = await callApi(payload);
      const reply = extractReply(data) || "[no response]";
      conversation.push({ role: "user", content }, { role: "assistant", content: reply });
      renderMsg(log, "assistant", reply);
      if (coachVisible) {
        const fb = extractCoach(data);
        if (fb) renderCoach(coachEl, fb);
      }
    } catch (e) {
      renderMsg(
        log,
        "assistant",
        `Error contacting model API. ${e.message}. Check config.json apiBase/workerUrl and CORS.`
      );
    }
  }

  // -------- init --------
  waitForMount(async () => {
    try {
      cfg = await loadConfig();
      scenarios =
        await loadScenarios(
          cfg.scenariosUrl || "./assets/chat/data/scenarios.merged.json"
        );
      areas = await loadAreas(cfg.areasUrl);
      render();
    } catch (e) {
      const err = el("div", "cw");
      err.textContent = `Widget failed to load: ${e.message}`;
      mount.replaceWith(err);
    }
  });
})();
