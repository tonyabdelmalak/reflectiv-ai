/*
 * ReflectivAI Chat/Coach — drop-in
 * - Modes: emotional-assessment | hiv-product-knowledge | sales-simulation
 * - Pre-call guidance + structured Coach JSON
 * - Robust parser + deterministic, MODE-SPECIFIC scoring fallback
 * - Coach panel separated from input; no overlap on mobile
 */

(function () {
  const mount = document.getElementById("reflectiv-widget");
  if (!mount) return;
  if (!mount.classList.contains("cw")) mount.classList.add("cw");

  // ---------- config/state ----------
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

  // remove triple-fence blocks and <pre>…</pre>; collapse headings and greetings
  function sanitizeLLM(raw) {
    let s = String(raw || "");

    // strip fenced code
    s = s.replace(/```[\s\S]*?```/g, "");
    // strip inline code blocks that are large
    s = s.replace(/<pre[\s\S]*?<\/pre>/gi, "");

    // remove self-intros and headings
    s = s.replace(/^\s*#{1,6}\s+/gm, "");
    s = s.replace(/^\s*i['’]m\s+tony[^\n]*\n?/i, "");
    s = s.replace(/^\s*(hi|hello|hey)[^\n]*\n+/i, "");

    // trim duplicate blank lines
    s = s.replace(/\n{3,}/g, "\n\n").trim();
    return s;
  }

  // minimal markdown for bubbles
  function md(text) {
    if (!text) return "";
    let s = esc(text).replace(/\r\n?/g, "\n");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    // lists
    s = s.replace(/^(?:-\s+|\*\s+).+(?:\n(?:-\s+|\*\s+).+)*/gm, (blk) => {
      const items = blk
        .split("\n")
        .map((l) => l.replace(/^(?:-\s+|\*\s+)(.+)$/, "<li>$1</li>"))
        .join("");
      return `<ul>${items}</ul>`;
    });
    // paragraphs
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

  // Extract model-supplied coach JSON wrapped in <coach>…</coach>
  function extractCoach(raw) {
    const m = String(raw || "").match(/<coach>([\s\S]*?)<\/coach>/i);
    if (!m) return { coach: null, clean: sanitizeLLM(raw) };
    let coach = null;
    try { coach = JSON.parse(m[1]); } catch {}
    const clean = sanitizeLLM(String(raw).replace(m[0], "").trim());
    return { coach, clean };
  }

  // ---------- MODE-SPECIFIC scoring fallback ----------
  function scoreReply(userText, replyText, mode, sc) {
    const t = (replyText || "").toLowerCase();
    const words = (replyText || "").split(/\s+/).filter(Boolean).length;
    const endsWithQuestion = /\?\s*$/.test(replyText || "");

    // helper
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    if (mode === "emotional-assessment") {
      // EI cues
      const empathyCue = /(i understand|it makes sense|given your|acknowledge|appreciate|valid|thanks for|i hear)/i.test(replyText || "");
      const activeListenCue = /(reflect|notice|it sounds like|what i’m hearing|you’re saying|let’s pause|check[- ]?in)/i.test(replyText || "");
      const behaviorCue = /(try|practice|use|choose|focus|set|ask yourself|next time)/i.test(replyText || "");
      const nonJudgmentCue = /(non[- ]?judgmental|curious|open|neutral)/i.test(replyText || "");
      const containsDrugs = /(descovy|tdf|taf|biktarvy|cabenuva|cabotegravir|rilpivirine|dolutegravir|tri[uú]meq)/i.test(replyText || "");

      const question_quality = clamp(endsWithQuestion ? 3 + (activeListenCue ? 1 : 0) : 2, 1, 4);
      const empathy = clamp((empathyCue ? 3 : 2) + (nonJudgmentCue ? 1 : 0), 1, 4);
      // objection_handling for EI = addresses feelings + proposes one action
      const objection_handling = clamp((behaviorCue ? 3 : 2) + (activeListenCue ? 1 : 0), 1, 4);
      // compliance high if avoids clinical treatment talk
      const compliance = clamp(containsDrugs ? 2 : 4, 1, 4);

      // brevity window 40–140 words
      const brevityBonus = words >= 40 && words <= 140 ? 6 : words < 40 ? 2 : 0;
      const askBonus = endsWithQuestion ? 6 : 0;

      const score = clamp(
        Math.round(55 + question_quality * 6 + empathy * 6 + objection_handling * 5 + compliance * 5 + brevityBonus + askBonus),
        55, 98
      );

      const worked = [
        empathyCue ? "Validated emotions" : null,
        activeListenCue ? "Demonstrated active listening" : null,
        endsWithQuestion ? "Closed with a reflective question" : null
      ].filter(Boolean);

      const improve = [
        behaviorCue ? null : "Offer one concrete, low-effort behavior",
        words > 140 ? "Tighten to 3–5 sentences" : null,
        containsDrugs ? "Avoid drug or regimen references in EI mode" : null
      ].filter(Boolean);
      if (!improve.length) improve.push("Summarize in one sentence before your question");

      return {
        score,
        subscores: { question_quality, objection_handling, empathy, compliance },
        worked,
        improve,
        phrasing: "Given what you’re managing, what small action this week would help you feel more in control for your next HCP conversation?"
      };
    }

    // Shared cues for HIV knowledge and simulation
    const cues = [
      /renal|kidney|egfr|creatinine|crcl/,
      /bone|bmd|osteopor/,
      /label|per label|indication|contraindication|boxed warning|guideline/,
      /adherence|missed[- ]dose|workflow|injection/,
      /resistance|drug[- ]drug|interaction|ddis?/,
      /coverage|prior auth|access|formulary|step[- ]?edit/,
      /prep|ta(f|v)|tdf|emtricitabine|bictegravir|rilpivirine|cabotegravir|biktarvy|descovy|cabenuva/
    ];
    const hits = cues.reduce((n, re) => n + (re.test(t) ? 1 : 0), 0);

    // weights differ slightly by mode
    const isSim = mode === "sales-simulation";

    const accuracy = clamp(Math.floor(hits / 2), 1, 4);
    const objection = clamp(
      /concern|barrier|risk|coverage|auth|denied|cost|workflow|adherence/i.test(t) ? 3 + (hits > 3 ? 1 : 0) : (hits > 2 ? 2 : 1),
      1, 4
    );
    const empathy = clamp(/understand|appreciate|given your time|brief|thanks for|happy to|let’s/i.test(t) ? 3 : 2, 1, 4);
    const compliance = clamp(/label|guideline|per label|approved/i.test(t) ? 3 + (hits > 3 ? 1 : 0) : 2, 1, 4);

    const brevityBonus = words > 40 && words < 160 ? 6 : words <= 40 ? 2 : 0;
    const askBonus = endsWithQuestion ? 6 : 0;

    const base = isSim ? 52 : 50;
    const score = clamp(
      Math.round(base + accuracy * 6 + objection * 5 + empathy * 4 + compliance * 6 + brevityBonus + askBonus),
      55, 98
    );

    return {
      score,
      subscores: {
        question_quality: clamp(endsWithQuestion ? 3 + (hits > 3 ? 1 : 0) : 2, 1, 4),
        objection_handling: objection,
        empathy,
        compliance
      },
      worked: [
        hits >= 3 ? "Grounded in relevant clinical cues" : "Kept it concise",
        endsWithQuestion ? "Ended with an engagement question" : null
      ].filter(Boolean),
      improve: [
        hits < 3 ? "Reference renal/bone, resistance, or DDI where relevant" : null,
        endsWithQuestion ? null : "Close with a single, clear next-step ask"
      ].filter(Boolean),
      phrasing: isSim
        ? "Would aligning on criteria for eligible patients and a quick follow-up next week be helpful?"
        : "Would it help to compare renal and bone safety differences for eligible patients?"
    };
  }

  // ---------- system prefaces ----------
  function buildPreface(mode, sc) {
    const COMMON = `
# ReflectivAI — Output Contract
Return two parts only. No code blocks. No markdown headings.
1) Sales Guidance: short, actionable, accurate guidance.
2) <coach>{ "worked":[…], "improve":[…], "phrasing":"…", "score":int, "subscores":{"question_quality":0-4,"objection_handling":0-4,"empathy":0-4,"compliance":0-4} }</coach>
`;

    if (mode === "sales-simulation") {
      return `
# Role
You are a virtual pharma coach prepping a sales rep for a 30-second interaction with an HCP. Be direct, safe, label-aligned.

# Scenario
${sc ? [
  `Therapeutic Area: ${sc.therapeuticArea || "—"}`,
  `Background: ${sc.background || "—"}`,
  `Today’s Goal: ${sc.goal || "—"}`
].join("\n") : ""}

# Style
- 3–6 sentences max, plus one closing question.
- Mention only appropriate, publicly known, label-aligned facts.
- Do not include pricing advice or PHI. No off-label.

${COMMON}`.trim();
    }

    // Product Knowledge: no coach instructions
    if (mode === "product_knowledge") {
      var pk = `
## Output Requirements
- Educational, unbiased, non-promotional.
- Cite high-quality sources (FDA label, CDC/NIH/WHO, peer-reviewed) when making claims.
- Structure: 1) Key takeaways, 2) Mechanism/indications, 3) Safety/contraindications, 4) Efficacy data, 5) Coverage/access notes, 6) References.
- Avoid exhaustive monographs.
- Be concise and factual.`.trim();
      return `${hdr}${scen}\n\n${pk}`;
    }

    // emotional-assessment
    return `
# Role
Provide brief, practical self-reflection tips tied to communication with HCPs. No clinical or drug guidance.

# Style
- 3–5 sentences, then one reflective question.
- Use empathy, active listening language, and a single concrete behavior.

${COMMON}`.trim();
  }

  // ---------- UI ----------
  function buildUI() {
    mount.innerHTML = "";

    // Inject layout CSS to prevent overlap on narrow screens.
    const style = document.createElement("style");
    style.textContent = `
      .reflectiv-chat{display:flex;flex-direction:column;gap:8px;border:1px solid #d6dbe3;border-radius:12px;overflow:hidden;background:#fff}
      .chat-toolbar{display:flex;gap:8px;flex-wrap:wrap;padding:10px;background:#f7f9fc;border-bottom:1px solid #e5e9f0}
      .chat-messages{height:320px;max-height:50vh;overflow:auto;padding:12px;background:#fafbfd}
      .message{margin:8px 0;display:flex}
      .message.user{justify-content:flex-end}
      .message.assistant{justify-content:flex-start}
      .message .content{max-width:85%;border-radius:14px;padding:10px 12px;border:1px solid #d6dbe3;line-height:1.45;font-size:14px;background:#e9edf3;color:#0f1522}
      .message.user .content{background:#e0e0e0;color:#000}
      .chat-input{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e9f0;background:#fff}
      .chat-input textarea{flex:1;resize:none;min-height:44px;max-height:120px;padding:10px 12px;border:1px solid #cfd6df;border-radius:10px;outline:none}
      .chat-input .btn{min-width:84px;border:0;border-radius:999px;background:#2f3a4f;color:#fff;font-weight:600}
      .coach-section{margin-top:10px;padding:12px;border:1px solid #e5e9f0;border-radius:12px;background:#fffbe8}
      .coach-score{margin-bottom:8px}
      .coach-subs .pill{display:inline-block;background:#f1f3f7;border:1px solid #d6dbe3;border-radius:999px;padding:2px 8px;margin-right:6px;font-size:12px}
      .scenario-meta .meta-card{padding:10px 12px;background:#f7f9fc;border:1px solid #e5e9f0;border-radius:10px}
      @media (max-width:520px){.chat-messages{height:46vh}}
    `;
    document.head.appendChild(style);

    const shell = el("div", "reflectiv-chat");

    // toolbar
    const bar = el("div", "chat-toolbar");
    const modeSel = el("select");
    (cfg.modes || []).forEach((m) => {
      const o = el("option");
      o.value = m;
      o.textContent = m.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      modeSel.appendChild(o);
    });
    modeSel.value = currentMode;
    modeSel.onchange = () => {
      currentMode = modeSel.value;
      currentScenarioId = null;
      conversation = [];               // hard reset so coach panel cannot reuse old scores
      renderMessages();
      refreshScenarioSel();
      renderMeta();
      renderCoach();
    };
    bar.appendChild(modeSel);

    const scSel = el("select");
    scSel.style.display = "none";
    scSel.onchange = () => {
      currentScenarioId = scSel.value || null;
      conversation = [];
      renderMessages();
      renderMeta();
      renderCoach();
    };
    bar.appendChild(scSel);

    const coachBtn = el("button", "btn", "Coach: On");
    coachBtn.onclick = () => {
      coachOn = !coachOn;
      coachBtn.textContent = coachOn ? "Coach: On" : "Coach: Off";
      renderCoach();
    };
    bar.appendChild(coachBtn);

    shell.appendChild(bar);

    // meta
    const meta = el("div", "scenario-meta");
    shell.appendChild(meta);

    // messages
    const msgs = el("div", "chat-messages");
    shell.appendChild(msgs);

    // input
    const inp = el("div", "chat-input");
    const ta = el("textarea");
    ta.placeholder = "Type your message…";
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send.click(); }
    });
    const send = el("button", "btn", "Send");
    send.onclick = () => {
      const t = ta.value.trim();
      if (!t) return;
      sendMessage(t);
      ta.value = "";
    };
    inp.appendChild(ta);
    inp.appendChild(send);
    shell.appendChild(inp);

    mount.appendChild(shell);

    // coach section outside scroll to avoid overlap
    const coach = el("div", "coach-section");
    coach.innerHTML = `<h3>Coach Feedback</h3><div class="coach-body muted">Awaiting the first assistant reply…</div>`;
    mount.appendChild(coach);

    // helpers
    function refreshScenarioSel() {
      if (currentMode !== "sales-simulation") {
        scSel.style.display = "none";
        return;
      }
      scSel.style.display = "";
      scSel.innerHTML = "<option value=''>Select Physician Profile</option>";
      scenarios.forEach((s) => {
        const o = el("option");
        o.value = s.id;
        o.textContent = s.label || s.id;
        scSel.appendChild(o);
      });
    }

    function renderMeta() {
      const sc = scenariosById.get(currentScenarioId);
      if (!sc || currentMode !== "sales-simulation") { meta.innerHTML = ""; return; }
      meta.innerHTML = `
        <div class="meta-card">
          <div><strong>Therapeutic Area:</strong> ${esc(sc.therapeuticArea || "—")}</div>
          <div><strong>Background:</strong> ${esc(sc.background || "—")}</div>
          <div><strong>Today’s Goal:</strong> ${esc(sc.goal || "—")}</div>
        </div>`;
    }

    function renderMessages() {
      msgs.innerHTML = "";
      for (const m of conversation) {
        const row = el("div", `message ${m.role}`);
        const c = el("div", "content");
        c.innerHTML = md(m.content);
        row.appendChild(c);
        msgs.appendChild(row);
      }
      msgs.scrollTop = msgs.scrollHeight;
    }

    function renderCoach() {
      const body = coach.querySelector(".coach-body");
      if (!coachOn) { coach.style.display = "none"; return; }
      coach.style.display = "";
      const last = conversation[conversation.length - 1];
      if (!(last && last.role === "assistant" && last._coach)) {
        body.innerHTML = `<span class="muted">Awaiting the first assistant reply…</span>`;
        return;
      }
      const fb = last._coach, subs = fb.subscores || {};
      body.innerHTML = `
        <div class="coach-score">Score: <strong>${fb.score ?? "—"}</strong>/100</div>
        <div class="coach-subs">${Object.entries(subs).map(([k,v])=>`<span class="pill">${esc(k)}: ${v}</span>`).join(" ")}</div>
        <ul class="coach-list">
          <li><strong>What worked:</strong> ${esc((fb.worked||[]).join(" ")||"—")}</li>
          <li><strong>What to improve:</strong> ${esc((fb.improve||[]).join(" ")||"—")}</li>
          <li><strong>Suggested phrasing:</strong> ${esc(fb.phrasing||"—")}</li>
        </ul>`;
    }

    // expose closures
    shell._renderMessages = renderMessages;
    shell._renderCoach = renderCoach;
    shell._refreshScenarioSel = refreshScenarioSel;
    shell._renderMeta = renderMeta;

    // first paint
    refreshScenarioSel();
    renderMeta();
    renderMessages();
    renderCoach();
  }

  // ---------- transport ----------
  async function callModel(messages) {
    const r = await fetch((cfg.apiBase || cfg.workerUrl || "").trim(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.model || "llama-3.1-8b-instant",
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
    return (
      data?.content ||
      data?.reply ||
      data?.choices?.[0]?.message?.content ||
      ""
    );
  }

  // ---------- send ----------
  async function sendMessage(userText) {
    const shell = mount.querySelector(".reflectiv-chat");
    const renderMessages = shell._renderMessages;
    const renderCoach = shell._renderCoach;

    conversation.push({ role: "user", content: userText });
    renderMessages();
    renderCoach();

    // build system preface
    const sc = scenariosById.get(currentScenarioId);
    const preface = buildPreface(currentMode, sc);

    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "system", content: preface });
    messages.push({ role: "user", content: userText });

    try {
      const raw = await callModel(messages);
      const { coach, clean } = extractCoach(raw);

      // fallback or merge
      const computed = scoreReply(userText, clean, currentMode, sc);
      const finalCoach = coach && coach.score && coach.subscores ? coach : computed;

      conversation.push({ role: "assistant", content: clean, _coach: finalCoach });
      renderMessages();
      renderCoach();

      // optional analytics
      if (cfg.analyticsEndpoint) {
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

  // ---------- init ----------
  async function init() {
    // config + system
    cfg = await fetchLocal("./assets/chat/config.json");
    systemPrompt = await fetchLocal("./assets/chat/system.md").catch(() => "");

    // scenarios
    scenarios = Array.isArray(cfg.scenarios) ? cfg.scenarios.map((s) => ({
      id: s.id,
      label: s.label || s.id,
      therapeuticArea: s.therapeuticArea || "",
      background: s.background || "",
      goal: s.goal || ""
    })) : [];
    scenariosById = new Map(scenarios.map((s) => [s.id, s]));

    // default mode if provided
    if (cfg.modes && cfg.defaultMode && cfg.modes.includes(cfg.defaultMode)) {
      currentMode = cfg.defaultMode;
    }

    buildUI();
  }

  init();
})();
