/* widget.js — ReflectivAI chat/coach (drop-in, self-contained)
 * - Scopes all DOM to #reflectiv-widget.cw
 * - Loads config.json and scenarios.merged.json
 * - Chat via config.apiBase
 * - Coach panel toggles in-flow below composer
 * - Prevents page scroll and wrong focus when toggling coach
 */

(function () {
  // ---------- safe bootstrapping ----------
  let mount = null;
  function onReady(fn){
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once:true });
    else fn();
  }
  function waitForMount(cb){
    const tryGet = () => {
      mount = document.getElementById("reflectiv-widget");
      if (mount) return cb();
      const obs = new MutationObserver(() => {
        mount = document.getElementById("reflectiv-widget");
        if (mount) { obs.disconnect(); cb(); }
      });
      obs.observe(document.documentElement, { childList:true, subtree:true });
      setTimeout(() => obs.disconnect(), 15000);
    };
    onReady(tryGet);
  }

  // ---------- helpers scoped to widget ----------
  let cfg = null;
  let scenarios = [];
  const qs  = sel => mount.querySelector(sel);
  const qsa = sel => mount.querySelectorAll(sel);

  function focusMsg() {
    const el = qs('textarea.cw-input, textarea[data-role="cw-input"]');
    if (el) el.focus({ preventScroll:true });
  }

  function el(tag, attrs={}, children=[]) {
    const n = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "dataset") Object.entries(v).forEach(([dk,dv]) => n.dataset[dk]=dv);
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) n.setAttribute(k, v);
    }
    (Array.isArray(children)?children:[children]).forEach(c => {
      if (c == null) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  async function fetchJSON(path){
    const r = await fetch(path, { cache:"no-store" });
    if (!r.ok) throw new Error(`Failed to load ${path} (${r.status})`);
    return r.json();
  }

  // ---------- UI render ----------
  function renderShell() {
    mount.classList.add("cw");
    mount.innerHTML = "";

    const shell = el("div", { class:"cw-shell" });

    const controls = el("div", { class:"cw-controls" }, [
      el("select", { class:"cw-select", id:"dsSelect", "aria-label":"Disease State" }, []),
      el("select", { class:"cw-select", id:"modeSelect", "aria-label":"Mode" }, []),
      el("select", { class:"cw-select", id:"profileSelect", "aria-label":"HCP Profile" }, [])
    ]);

    const transcript = el("div", { class:"cw-transcript", id:"transcript" });

    const composer = el("div", { class:"cw-composer" }, [
      el("textarea", { class:"cw-input", id:"msgInput", placeholder:"Type your message…" }),
      el("button", { class:"cw-send", id:"sendBtn", type:"button" }, "Send")
    ]);

    const toggleRow = el("div", { class:"cw-toggle-row" }, [
      el("button", { "data-coach-toggle":"", "aria-expanded":"false", type:"button" }, "Open Coach")
    ]);

    const coachPanel = el("div", { class:"coach-panel", id:"coachPanel" }, [
      el("div", { class:"coach-title" }, "Coach"),
      el("div", { class:"coach-tip", id:"coachTip" }, "Coach is listening for tone. Tips will appear after your next message."),
      el("div", { class:"coach-muted" }, "Feedback is scenario-aware.")
    ]);

    shell.appendChild(controls);
    shell.appendChild(transcript);
    shell.appendChild(composer);
    shell.appendChild(toggleRow);
    shell.appendChild(coachPanel);
    mount.appendChild(shell);
  }

  // ---------- options + state ----------
  let current = {
    disease: "",
    mode: "sales-simulation",
    profile: "",
    conversation: []
  };

  function populateControls() {
    const ds = qs("#dsSelect");
    const mode = qs("#modeSelect");
    const prof = qs("#profileSelect");

    // Disease states from scenarios list
    const diseaseList = Array.from(new Set(scenarios.map(s => s.disease || s.therapy || s.area || "General")));
    ds.innerHTML = "";
    ds.appendChild(el("option", { value:"", disabled:"", selected:"" }, "Disease State"));
    diseaseList.forEach(name => ds.appendChild(el("option", { value:name }, name.toUpperCase()==="HIV"?"HIV":name)));

    // Modes from config
    mode.innerHTML = "";
    const modes = cfg?.modes?.length ? cfg.modes : ["sales-simulation","product-knowledge","emotional-assessment"];
    modes.forEach(m => {
      const label = m.replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase());
      mode.appendChild(el("option", { value:m, selected: m===cfg?.defaultMode }, label));
    });

    // Profiles depend on disease
    prof.innerHTML = "";
    prof.appendChild(el("option", { value:"", disabled:"", selected:"" }, "HCP Profile"));
  }

  function refreshProfiles() {
    const prof = qs("#profileSelect");
    const chosen = current.disease;
    const list = scenarios.filter(s => (s.disease||s.therapy||s.area||"General") === chosen);
    const unique = new Map();
    list.forEach(s => {
      const label = s.profile || s.hcpTitle || s.title || "Generalist";
      if (!unique.has(label)) unique.set(label, s.id || label);
    });
    prof.innerHTML = "";
    prof.appendChild(el("option", { value:"", disabled:"", selected:"" }, "HCP Profile"));
    unique.forEach((id,label) => prof.appendChild(el("option", { value:id }, label)));
  }

  // ---------- transcript ----------
  function addMsg(role, text){
    const row = el("div", { class:`msg ${role}` }, [
      el("div", { class:"bubble" }, text)
    ]);
    qs("#transcript").appendChild(row);
    qs("#transcript").scrollTop = qs("#transcript").scrollHeight;
  }

  // ---------- coach ----------
  function wireCoachToggle(){
    qsa('[data-coach-toggle]').forEach(elm => {
      elm.setAttribute('role','button');
      elm.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const panel = qs('.coach-panel');
        if (!panel) return;
        const open = panel.classList.toggle('is-open');
        elm.setAttribute('aria-expanded', String(open));
        focusMsg();
      });
    });
  }

  function coachFeedback(userText, aiText){
    // Lightweight heuristic tuned for sales-sim and PK
    const tips = [];
    const t = userText.toLowerCase();

    // compliance
    if (/\b(cure|guarantee|100%|no side effects)\b/.test(t)) {
      tips.push("Avoid absolute claims. Reframe to evidence levels and labeled indications.");
    }
    // tone
    if (/(you should|you need to|must)/.test(t)) {
      tips.push("Use collaborative language. Ask permission and offer options.");
    }
    // HIV PrEP specific
    if ((current.disease||"").toUpperCase()==="HIV" && !/\b(adherence|creatinine|sti|risk|prep|screen)\b/.test(t)) {
      tips.push("Mention adherence support, baseline labs, and risk counseling for PrEP.");
    }
    // objection handling
    if (/cost|price|expensive|coverage/.test(t)) {
      tips.push("Surface access resources and payer support. Offer benefits investigation.");
    }
    // empathy marker
    if (!/sorry|understand|appreciate|thanks|thank you/.test(t)) {
      tips.push("Acknowledge the HCP's perspective briefly before offering information.");
    }

    if (!tips.length) tips.push("Good structure. Keep questions open-ended and reference labeled data when comparing.");

    qs("#coachTip").textContent = "• " + tips.join(" • ");
  }

  // ---------- chat ----------
  async function sendToModel(prompt){
    const api = cfg?.apiBase || cfg?.workerUrl;
    if (!api) return "API endpoint missing in config.json.";
    try{
      const body = {
        model: cfg?.model || "llama-3.1-8b-instant",
        stream: false,
        messages: [
          { role:"system", content:`Mode=${current.mode}; Disease=${current.disease}; Profile=${current.profile || "General"}; Respond concisely.` },
          ...current.conversation,
          { role:"user", content: prompt }
        ]
      };
      const r = await fetch(api, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(body) });
      if (!r.ok) return `Upstream error ${r.status}`;
      const data = await r.json();
      const content = data?.choices?.[0]?.message?.content ?? data?.content ?? "(no content)";
      return content;
    } catch(err){
      return String(err.message || err);
    }
  }

  function wireSend(){
    const btn = qs("#sendBtn");
    const ta  = qs("#msgInput");
    const coachPanel = qs("#coachPanel");

    async function actSend(){
      const val = ta.value.trim();
      if (!val) return;
      addMsg("user", val);
      current.conversation.push({ role:"user", content: val });
      ta.value = "";
      btn.disabled = true;

      const reply = await sendToModel(val);
      addMsg("ai", reply);
      current.conversation.push({ role:"assistant", content: reply });

      // coach updates in place but does not overlay input
      coachFeedback(val, reply);
      coachPanel.classList.add("is-open");
      qsa('[data-coach-toggle]').forEach(t => t.setAttribute('aria-expanded','true'));

      btn.disabled = false;
      focusMsg();
    }

    btn.addEventListener("click", actSend);
    ta.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        actSend();
      }
    });
  }

  // ---------- wiring ----------
  async function init(){
    renderShell();

    // load config + scenarios
    try{
      cfg = await fetchJSON("./config.json");
    } catch{ cfg = { modes:["sales-simulation","product-knowledge","emotional-assessment"], defaultMode:"sales-simulation" }; }

    try{
      const url = cfg?.scenariosUrl || "./assets/chat/data/scenarios.merged.json";
      scenarios = await fetchJSON(url);
      if (!Array.isArray(scenarios)) scenarios = [];
    } catch { scenarios = []; }

    populateControls();

    // select wiring
    qs("#dsSelect").addEventListener("change", e => {
      current.disease = e.target.value;
      refreshProfiles();
      current.conversation = [];
      qs("#transcript").innerHTML = "";
    });
    qs("#modeSelect").addEventListener("change", e => {
      current.mode = e.target.value;
      current.conversation = [];
      qs("#transcript").innerHTML = "";
    });
    qs("#profileSelect").addEventListener("change", e => {
      current.profile = e.target.value;
      current.conversation = [];
      qs("#transcript").innerHTML = "";
    });

    wireSend();
    wireCoachToggle();
    focusMsg();
  }

  waitForMount(init);
})();
