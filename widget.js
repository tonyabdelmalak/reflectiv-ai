<script>
/* ReflectivAI Coach Widget — v4 (layout preserved)
 * Goals implemented:
 * - Correct dropdown relationships: Disease -> HCP filtered; Mode = ["Product Knowledge","Sales Simulation"]
 * - Coach toggle hidden in Product Knowledge (preserves your dropdown UI)
 * - Deterministic, per-turn coach feedback (JSON contract) tied to the user’s latest turn + active scenario
 * - Weighted scoring (0–10) + rolling average; hard-fail gates on Accuracy/Compliance
 * - Subtle EI: empathy score, tone label, evidence quote in Coach (not a separate mode)
 * - State resets on any control change; localStorage persistence
 * - Mobile-safe: no input overlap; panel scrolls
 * - Zero layout edits: script locates your existing controls by their headings/labels
 */

(function(){
  "use strict";

  // -------- Config --------
  const CFG = {
    workerUrl: "https://my-chat-agent.tonyabdelmalak.workers.dev/chat",
    model: "llama-3.1-8b-instant",
    temperature: 0.2,
    systemUrl: "assets/chat/system.md",
    storeKey: "reflectivai:coach:v4"
  };

  // -------- Catalog (Disease -> HCP/Scenario) --------
  // Keep names matching your site content. Expand as needed.
  const CATALOG = {
    "HIV": [
      { id:"hiv_fp_prep", label:"Internal Medicine MD", brief:"Busy IM who initiates PrEP occasionally. Goal: confirm screening workflow, initiation criteria, and set coverage follow-up." },
      { id:"hiv_np", label:"Nurse Practitioner", brief:"Primary care NP managing prevention counseling. Goal: align on eligibility, adherence support, access steps." },
      { id:"hiv_pa", label:"Physician Assistant", brief:"PA triaging new PrEP interest. Goal: streamline baseline labs and start workflow." },
      { id:"hiv_id", label:"Infectious Disease Specialist", brief:"ID clinic with stable oral PrEP pts. Goal: address barriers and safety language." }
    ],
    "Cancer": [
      { id:"onc_mo", label:"Oncologist", brief:"Med Onc raises safety-signal concerns. Goal: cite label language and reframe benefit–risk in approved terms." },
      { id:"onc_np", label:"Nurse Practitioner", brief:"Heme/Onc infusion NP. Goal: coordinate on-label education and AE monitoring language." },
      { id:"onc_pa", label:"Physician Assistant", brief:"MO PA focuses on workflow. Goal: clarify consult flow and payer basics." }
    ],
    "Vaccines": [
      { id:"vax_im", label:"Internal Medicine Doctor", brief:"Adult hesitancy in IM clinic. Goal: brief MI approach and resources." },
      { id:"vax_np", label:"Nurse Practitioner", brief:"Community NP with storage limits. Goal: confirm storage, schedule, and workflow impacts." },
      { id:"vax_pa", label:"Physician Assistant", brief:"PA handles vaccine days. Goal: address throughput and reminders." }
    ],
    "COVID": [
      { id:"covid_pulm", label:"Pulmonologist", brief:"Post-acute clinic triages long COVID. Goal: on-label timing and candidate selection." },
      { id:"covid_pa", label:"Physician Assistant", brief:"PA coordinates discharges to outpatient therapy. Goal: reduce readmissions with clear criteria." },
      { id:"covid_np", label:"Nurse Practitioner", brief:"NP in respiratory clinic. Goal: safe counseling and access flow." }
    ],
    "Cardiovascular": [
      { id:"cv_np", label:"Nurse Practitioner", brief:"Risk-factor clinic. Goal: elicit pathway and align on on-label statements." },
      { id:"cv_im", label:"Internal Medicine MD", brief:"IM managing multiple comorbidities. Goal: concise on-label value framing." }
    ]
  };

  // Modes are fixed for clarity. Do NOT read legacy config modes.
  const MODES = ["Product Knowledge","Sales Simulation"];

  // -------- Locate existing controls by headings/labels (preserves layout) --------
  const q = (sel) => document.querySelector(sel);
  function norm(s){ return String(s||"").trim().toLowerCase(); }
  function findSelectByHeading(text){
    const heads = [...document.querySelectorAll("label, h4, h5, .control-label, .field label")];
    const hit = heads.find(h => norm(h.textContent).startsWith(norm(text)));
    if (!hit) return null;
    const sel = hit.parentElement?.querySelector("select") || hit.nextElementSibling?.querySelector?.("select");
    return sel && sel.tagName === "SELECT" ? sel : null;
  }

  const ui = {
    mode:    findSelectByHeading("learning center") || findSelectByHeading("mode"),
    coach:   findSelectByHeading("coach"),
    disease: findSelectByHeading("disease / product knowledge") || findSelectByHeading("disease state") || findSelectByHeading("disease"),
    hcp:     findSelectByHeading("hcp profile") || findSelectByHeading("hcp profiles / scenarios")
  };

  // Message area + input + send button; create safe fallbacks if missing
  const log    = q(".cw-messages") || q("#chat-log") || createFallbackLog();
  const input  = q(".chat-input textarea") || q("#message") || q("textarea") || createFallbackInput();
  const send   = q("button[type=submit]") || q(".chat-send") || createFallbackSend();

  // Coach panel creation if not present
  const coachPanel = ensureCoachPanel();

  // -------- State --------
  let state = {
    systemPrimer: "",
    messages: [],
    sending: false,
    scores: { turns: [], avg: 0 }
  };

  // -------- Boot: hydrate controls, restore persisted values --------
  hydrateModes();
  hydrateDiseases();
  hydrateHcps(get(ui.disease));

  // Restore persisted
  try {
    const saved = JSON.parse(localStorage.getItem(CFG.storeKey) || "{}");
    if (saved.mode && MODES.includes(saved.mode)) set(ui.mode, saved.mode);
    if (saved.disease && CATALOG[saved.disease]) set(ui.disease, saved.disease);
    hydrateHcps(get(ui.disease));
    if (saved.hcp && [...ui.hcp.options].some(o=>o.value===saved.hcp)) set(ui.hcp, saved.hcp);
    if (typeof saved.coachOn === "boolean") setCoachDropdown(saved.coachOn);
  } catch {}

  syncCoachVisibility();
  renderBrief();

  // -------- Events --------
  ui.mode?.addEventListener("change", () => { syncCoachVisibility(); persist(); resetContext(); });
  ui.coach?.addEventListener("change", () => { persist(); });
  ui.disease?.addEventListener("change", () => {
    hydrateHcps(get(ui.disease));
    persist(); resetContext(); renderBrief();
  });
  ui.hcp?.addEventListener("change", () => { persist(); resetContext(); renderBrief(); });

  send?.addEventListener("click", onSubmit);
  input?.form?.addEventListener("submit", (e)=>{ e.preventDefault(); onSubmit(); });

  // -------- Helpers: get/set/selects --------
  function get(sel){ return sel?.value || ""; }
  function set(sel, val){ if (sel) sel.value = val; }
  function setOptions(selectEl, items, values){
    // keep a disabled placeholder for clarity (does not alter layout structure)
    const html = items.map((lab,i)=>`<option value="${values?values[i]:lab}">${lab}</option>`).join("");
    selectEl.innerHTML = html;
  }
  function setCoachDropdown(on){
    if (![...ui.coach.options].length) {
      ui.coach.innerHTML = `<option value="on">Coach On</option><option value="off">Coach Off</option>`;
    }
    ui.coach.value = on ? "on" : "off";
  }
  function coachOn(){ return get(ui.mode) === "Sales Simulation" && get(ui.coach) !== "off"; }

  // -------- Hydration --------
  function hydrateModes(){
    if (!ui.mode) return;
    setOptions(ui.mode, MODES);
    if (!get(ui.mode)) set(ui.mode, "Sales Simulation"); // default to Sim as in screenshots
  }
  function hydrateDiseases(){
    if (!ui.disease) return;
    setOptions(ui.disease, Object.keys(CATALOG));
    if (!get(ui.disease)) set(ui.disease, Object.keys(CATALOG)[0]);
  }
  function hydrateHcps(disease){
    if (!ui.hcp) return;
    const list = CATALOG[disease] || [];
    setOptions(ui.hcp, list.map(x=>x.label), list.map(x=>x.id));
    if (list[0]) set(ui.hcp, list[0].id);
  }

  // -------- Brief card under controls --------
  function renderBrief(){
    const d = get(ui.disease);
    const it = (CATALOG[d]||[]).find(x=>x.id===get(ui.hcp));
    const brief = ensureBrief();
    if (!it){ brief.style.display="none"; brief.innerHTML=""; return; }
    brief.style.display="";
    brief.innerHTML = `
      <div class="brief-card">
        <p><strong>Therapeutic Area:</strong> ${d}</p>
        <p><strong>HCP Role:</strong> ${it.label}</p>
        <p><strong>Background:</strong> ${it.brief.split("Goal:")[0].trim()}</p>
        <p><strong>Today’s Goal:</strong> ${it.brief.includes("Goal:") ? it.brief.split("Goal:")[1].trim() : ""}</p>
      </div>`;
  }
  function ensureBrief(){
    let n = document.getElementById("scenario-brief");
    if (!n){
      n = document.createElement("section");
      n.id = "scenario-brief";
      n.className = "scenario-brief";
      log.parentElement.insertBefore(n, log);
    }
    return n;
  }

  // -------- Coach panel / visibility --------
  function ensureCoachPanel(){
    let panel = document.getElementById("coach-panel");
    if (!panel){
      panel = document.createElement("section");
      panel.id = "coach-panel";
      panel.className = "coach-panel";
      panel.innerHTML = `
        <div class="coach-head">
          <strong>Coach Feedback</strong>
          <span class="coach-score" id="coach-score"></span>
        </div>
        <div id="coach-body"><p>Awaiting the first assistant reply…</p></div>`;
      log.parentElement.appendChild(panel);
    }
    return panel;
  }
  function syncCoachVisibility(){
    const show = get(ui.mode) === "Sales Simulation";
    const wrap = ui.coach?.closest("label, .field, .form-group") || ui.coach?.parentElement;
    if (wrap) wrap.style.display = show ? "" : "none";
    coachPanel.hidden = !show || !coachOn();
  }

  // -------- Render chat rows --------
  function addRow(role, text){
    const row = document.createElement("div");
    row.className = "row " + role;
    const b = document.createElement("div");
    b.className = "bubble " + role;
    b.textContent = String(text || "");
    row.appendChild(b);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  // -------- Persistence --------
  function persist(){
    try{
      localStorage.setItem(CFG.storeKey, JSON.stringify({
        mode: get(ui.mode),
        coachOn: get(ui.coach) !== "off",
        disease: get(ui.disease),
        hcp: get(ui.hcp)
      }));
    } catch {}
  }
  function resetContext(){
    state.messages = [];
    state.scores = { turns: [], avg: 0 };
    const body = document.getElementById("coach-body"); if (body) body.innerHTML = "<p>Awaiting the first assistant reply…</p>";
    const score = document.getElementById("coach-score"); if (score) score.textContent = "";
  }

  // -------- LLM utilities --------
  async function fetchText(url){
    try{ const r = await fetch(url, {cache:"no-store"}); if(!r.ok) throw 0; return await r.text(); } catch { return ""; }
  }
  async function ensureSystem(){
    if (state.systemPrimer) return state.systemPrimer;
    const base = await fetchText(CFG.systemUrl);
    state.systemPrimer = (base || "You are a compliant pharma sales enablement assistant. Use on-label only. Refuse PHI.").trim();
    return state.systemPrimer;
  }
  async function callLLM(messages){
    const body = { model: CFG.model, temperature: CFG.temperature, messages };
    const r = await fetch(CFG.workerUrl, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`LLM ${r.status}`);
    const j = await r.json().catch(()=>null);
    return j?.content || j?.choices?.[0]?.message?.content || "";
  }
  function parseJSONLoose(raw){
    try{
      const m = String(raw||"").match(/\{[\s\S]*\}$/);
      const s = m ? m[0] : raw;
      return JSON.parse(s);
    } catch { return null; }
  }

  // -------- Scoring --------
  // Weights: Accuracy×3, Compliance×3, Discovery×2, Objection×2, Value×2, Empathy×1, Clarity×1
  function scoreTurn(r){
    const w = { acc:3, comp:3, need:2, obj:2, val:2, emp:1, clr:1 };
    const s = w.acc*r.accuracy + w.comp*r.compliance + w.need*r.discovery + w.obj*r.objection + w.val*r.value + w.emp*r.empathy + w.clr*r.clarity;
    const turn = Math.round(((s / (5*(w.acc+w.comp+w.need+w.obj+w.val+w.emp+w.clr))) * 10) * 10) / 10; // 0.0–10.0
    state.scores.turns.push(turn);
    state.scores.avg = state.scores.turns.reduce((a,b)=>a+b,0)/state.scores.turns.length;
    return { turn, avg: state.scores.avg };
  }

  // -------- Submit flow --------
  async function onSubmit(){
    if (state.sending) return;
    const text = String(input.value || "").trim();
    if (!text) return;

    state.sending = true;
    addRow("user", text);
    input.value = "";

    try{
      const system = await ensureSystem();
      const disease = get(ui.disease);
      const it = (CATALOG[disease]||[]).find(x=>x.id===get(ui.hcp));
      const scenario = it ? it.brief : "";
      const isSim = get(ui.mode) === "Sales Simulation";

      const preface = isSim
        ? `You are role-playing as an HCP in ${disease}. Use only on-label language. Keep replies concise. Scenario: ${scenario}`
        : `You are answering Product Knowledge questions in ${disease}. Use only on-label language. Provide concise, source-named support when relevant.`;

      const messages = [
        { role:"system", content: system },
        { role:"system", content: preface },
        ...state.messages,
        { role:"user", content: text }
      ];

      const reply = await callLLM(messages);
      addRow("assistant", reply || "(no response)");
      state.messages.push({role:"user",content:text},{role:"assistant",content:reply||""});

      if (isSim && coachOn()){
        const evalMsgs = buildEvalMessages(text, reply||"", disease, scenario);
        let obj = parseJSONLoose(await callLLM(evalMsgs));
        // one retry if bad JSON
        if (!obj) obj = parseJSONLoose(await callLLM(evalMsgs));

        let html="", sc=null;

        if (obj && obj.rubric){
          const r = {
            accuracy:+obj.rubric.accuracy||0,
            compliance:+obj.rubric.compliance||0,
            discovery:+obj.rubric.discovery||0,
            objection:+obj.rubric.objection||0,
            value:+obj.rubric.value||0,
            empathy:+obj.rubric.empathy||0,
            clarity:+obj.rubric.clarity||0
          };
          sc = scoreTurn(r);

          // Hard-fail gates: if either is 0, prepend compliance alert
          const complianceAlert = (r.accuracy===0 || r.compliance===0)
            ? `<p class="coach-alert">Compliance/Accuracy risk detected — lead with on-label, fair-balance language.</p>`
            : "";

          // EI badges
          const ei = obj.ei || {};
          const eiHtml = renderEi(ei);

          html = complianceAlert + eiHtml + (obj.feedback_html || "");
        } else {
          html = "<p>Evaluator could not parse a score. Keep it compliant and specific.</p>";
        }
        setCoach(html, sc);
      } else {
        setCoach("", null);
      }

    } catch (e){
      console.error(e);
      addRow("assistant","Upstream error. Try again.");
    } finally {
      state.sending = false;
      log.scrollTop = log.scrollHeight;
    }
  }

  // -------- Evaluator prompt --------
  function buildEvalMessages(userUtterance, assistantReply, disease, scenario){
    const system = [
      "You are a strict coaching evaluator for compliant pharma sales role-plays.",
      "Score ONLY the user's latest message relative to the active scenario.",
      "Rubric 0–5: accuracy, compliance, discovery, objection, value, empathy, clarity.",
      "If any compliance or accuracy risk exists, set that dimension to 0.",
      "Return pure JSON (no preface):",
      "{",
      '  "feedback_html": "<p>...</p>",',
      '  "rubric": {"accuracy":0-5,"compliance":0-5,"discovery":0-5,"objection":0-5,"value":0-5,"empathy":0-5,"clarity":0-5},',
      '  "ei": {"empathy_score":0-5,"tone_label":"supportive|neutral|transactional","evidence_quote":"4–18 word excerpt"}',
      "}",
      "feedback_html must include sections Tone, What worked, Tighten, Suggested rewrite, tailored to THIS message and scenario."
    ].join(" ");

    const user = [
      `DISEASE: ${disease}`,
      `SCENARIO: ${scenario}`,
      `USER_MSG: ${userUtterance}`,
      `ASSISTANT_REPLY_FOR_CONTEXT: ${assistantReply}`
    ].join("\n");

    return [{ role:"system", content: system }, { role:"user", content: user }];
  }

  // -------- Coach render --------
  function setCoach(html, score){
    const body = document.getElementById("coach-body");
    const scoreEl = document.getElementById("coach-score");
    if (!coachOn()){ coachPanel.hidden = true; return; }
    coachPanel.hidden = false;
    body.innerHTML = html || "<p>Awaiting the first assistant reply…</p>";
    scoreEl.textContent = score ? `Turn: ${score.turn.toFixed(1)} | Avg: ${score.avg.toFixed(1)}` : "";
  }
  function renderEi(ei){
    const emp = Number(ei.empathy_score ?? 0).toFixed(1);
    const tone = String(ei.tone_label||"neutral").toLowerCase();
    const quote = ei.evidence_quote ? ` <span class="ei-evidence">“${ei.evidence_quote}”</span>` : "";
    return `<div class="ei-badges"><span class="badge">Empathy ${emp}/5</span><span class="chip ${tone}">${tone}</span>${quote}</div>`;
  }

  // -------- Fallback elements (only used if page lacks them) --------
  function createFallbackLog(){
    const s = document.createElement("section");
    s.className = "cw-messages";
    document.body.appendChild(s);
    return s;
  }
  function createFallbackInput(){
    const t = document.createElement("textarea");
    t.placeholder = "Type your message…";
    document.body.appendChild(t);
    return t;
  }
  function createFallbackSend(){
    const b = document.createElement("button");
    b.type = "button"; b.textContent = "Send";
    document.body.appendChild(b);
    return b;
  }
})();
</script>
