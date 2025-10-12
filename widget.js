// Floating chat widget with Disease State → Mode → HCP Scenario selector
// - Coach feedback auto-applies ONLY for Sales Simulation
// - Product Knowledge mode removes coach feedback
// - "Emotional Intelligence" removed from disease list
// - "HIV" rendered in ALL CAPS
// - HCP scenarios populated by disease state selection
// Works under subpaths (GitHub Pages) via relative URLs.

(function () {
  // ===== Config =====
  var CONFIG = {
    workerUrl: "https://my-chat-agent.tonyabdelmalak.workers.dev/chat",
    systemUrl: "./assets/chat/system.md",
    model: "llama-3.1-8b-instant",
    temperature: 0.2,
    title: "Practice Coach",
    brand: { accent: "#3e5494", radius: "14px" }
  };

  // Disease states and scenarios (curated from your doc)
  // Keys are the display labels. “HIV” forced to CAPS.
  var DATA = {
    "HIV": {
      scenarios: [
        // PrEP — low Descovy share
        {
          id: "hiv_prep_lowshare_im_decile3",
          label: "PrEP — IM Decile 3, low Descovy share",
          summary:
            "IM Decile 3. Descovy TRx 32%, NBRx 20%. Team prefers Descovy but only given on request. Rising STI testing in young MSM. Goal: create urgency and gain commitment to prescribe Descovy for PrEP."
        },
        // PrEP — high performer, accelerate
        {
          id: "hiv_prep_np_decile10_accelerate",
          label: "PrEP — NP Decile 10, accelerate growth",
          summary:
            "NP Decile 10. Descovy TRx 59%, NBRx 64%, access 75%. Bottleneck is PAs. Goal: commit to broad prescribing for appropriate patients incl. naïve and eligible revisits."
        },
        // Treatment — switches slowing
        {
          id: "hiv_tx_pa_switch_slow",
          label: "Treatment — PA with switch slowdown",
          summary:
            "PA in busy HIV clinic. Early Biktarvy switches strong; last 13 weeks 1–2 switches. Share: BIK 50%, DVY/TVY 12%, TRQ 9%. Goal: reinforce Biktarvy evidence and patient education."
        },
        // Treatment — favoring CAB
        {
          id: "hiv_tx_np_cab_growth",
          label: "Treatment — NP favoring CAB (LAI)",
          summary:
            "NP ~3 years. Uses Biktarvy for naïve; CAB share 7% and growing due to patient requests. Goal: discuss resistance risk and long-term journey implications."
        }
      ]
    },
    "HBV": {
      scenarios: [
        {
          id: "hbv_vemlidy_denials",
          label: "HBV — Vemlidy step-edit denials",
          summary:
            "Vemlidy appropriate but denied due to plan step-edit. Goal: access strategy and evidence positioning."
        },
        {
          id: "hbv_upgrade_from_tdf",
          label: "HBV — Upgrade from TDF",
          summary:
            "High TDF share. Agrees to upgrade but data not moving. Goal: close intent-to-action gap."
        }
      ]
    },
    "COVID": {
      scenarios: [
        {
          id: "covid_remd_order_set_shift",
          label: "COVID — Order set shift to Paxlovid",
          summary:
            "Historically consistent remdesivir prescriber; institution shifted order sets. Goal: clarify criteria and pathway for appropriate remdesivir use."
        },
        {
          id: "covid_wait_and_see",
          label: "COVID — Wait-and-see prescriber",
          summary:
            "Prefers to delay initiation. Goal: align on risk windows and outcomes to reduce progression."
        }
      ]
    },
    "Flu Vaccine": {
      scenarios: [
        {
          id: "flu_idn_prebook_decline",
          label: "Flu — IDN pre-book decline two seasons",
          summary:
            "Pre-book down 10–15% YoY while incidence up. Goal: raise coverage and deploy programs/resources."
        },
        {
          id: "flu_peds_competitor_locked",
          label: "Flu — Pediatrics account locked with competitor",
          summary:
            "Competing supplier across vaccines. Goal: relationship build, value pathway, future pre-book."
        }
      ]
    }
  };

  // Mode definitions
  var MODES = [
    { id: "product_knowledge", label: "Product Knowledge" },
    { id: "sales_simulation", label: "Sales Simulation" }
  ];

  // ===== Utilities =====
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function escapeHTML(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    }[c]));
  }
  async function fetchText(url) {
    var res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load " + url);
    return await res.text();
  }

  // ===== Coach instruction only for Sales Simulation =====
  var COACH_INSTRUCTIONS = `
# Coach Feedback (private to the model)
After the role-play response, add:
---
Coach Feedback
- Tone:
- What worked: (1–3 bullets)
- Improve: (1–3 bullets)
- Stronger rewrite (2–4 sentences)
Keep it concise and specific to THIS turn.`.trim();

  // ===== Minimal styles for the selector bar =====
  var STYLE = `
.tcw-wrap{position:fixed;right:20px;bottom:20px;z-index:2147483001;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.tcw-btn{display:flex;align-items:center;gap:.5rem;padding:.6rem .8rem;border-radius:999px;border:1px solid #d7d9e0;background:#fff;color:#1b2540;box-shadow:0 10px 26px rgba(0,0,0,.2);cursor:pointer}
.tcw-open .tcw-btn{opacity:.0;pointer-events:none}
.tcw-panel{position:fixed;right:20px;bottom:94px;width:420px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #d7d9e0;border-radius:14px;box-shadow:0 18px 40px rgba(0,0,0,.18);display:none;overflow:hidden}
.tcw-open .tcw-panel{display:block}
.tcw-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #e6e9f2}
.tcw-title{font-weight:700;color:#1b2540}
.tcw-close{background:transparent;border:none;font-size:22px;cursor:pointer}
.tcw-bar{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 12px;border-bottom:1px solid #eef1f6;background:#fafbfe}
.tcw-bar .full{grid-column:1/-1}
.tcw-bar select{width:100%;padding:8px 10px;border:1px solid #d7d9e0;border-radius:10px;font-size:14px;background:#fff}
.tcw-body{height:320px;max-height:60vh;overflow:auto;padding:12px;background:#fff}
.tcw-msg{max-width:85%;margin:8px 0;padding:10px 12px;border:1px solid #e6e9f2;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.tcw-bot{background:#3e5494;color:#fff;border-color:#354a85}
.tcw-user{background:#eef1f6;color:#0b1022;border-color:#e0e4ef;margin-left:auto}
.tcw-footer{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid #eef1f6;background:#fff}
.tcw-input{flex:1;resize:none;border:1px solid #d7d9e0;border-radius:12px;padding:10px 12px;max-height:120px;font-size:15px}
.tcw-send{min-width:64px;height:40px;border-radius:999px;border:1px solid transparent;color:#fff;background:${CONFIG.brand.accent};cursor:pointer}
@media (max-width:520px){.tcw-panel{right:12px;left:12px;width:auto}}
`;

  // ===== Chat core =====
  var state = {
    messages: [],
    sending: false,
    injected: false,
    selectedDisease: "HIV",
    selectedMode: "product_knowledge",
    selectedScenarioId: null
  };

  function appendMessage(role, text) {
    var box = el("div", "tcw-msg " + (role === "user" ? "tcw-user" : "tcw-bot"));
    box.innerHTML = escapeHTML(text);
    ui.body.appendChild(box);
    ui.body.scrollTop = ui.body.scrollHeight;
  }

  async function ensureBaselineSystem() {
    if (state.messages.some(m => m.role === "system")) return;
    try {
      var sys = await fetchText(CONFIG.systemUrl);
      state.messages.unshift({ role: "system", content: sys });
    } catch (e) {
      console.warn("No baseline system.md loaded:", e);
    }
  }

  function buildModeSystem() {
    var disease = state.selectedDisease || "HIV";
    var mode = state.selectedMode || "product_knowledge";
    var scenario = getScenarioById(disease, state.selectedScenarioId);

    var hdr = `# Context\nDisease State: ${disease}\nMode: ${mode === "product_knowledge" ? "Product Knowledge" : "Sales Simulation"}`;
    var scen = scenario ? `\n\n## HCP Profile / Scenario\nLabel: ${scenario.label}\nSummary: ${scenario.summary}` : "";

    // Product Knowledge: no coach instructions
    if (mode === "product_knowledge") {
      var pk = `
## Output Requirements
- Educational, unbiased, non-promotional.
- Cite high-quality sources (FDA label, CDC/NIH/WHO, peer-reviewed) when making claims.
- Structure: 1) Key takeaways, 2) Mechanism/indications, 3) Safety/contraindications, 4) Efficacy data, 5) Coverage/access notes, 6) References.
- Be concise and factual.`.trim();
      return `${hdr}${scen}\n\n${pk}`;
    }

    // Sales Simulation: include coach feedback
    var sim = `
## Simulation Requirements
- Role-play as the HCP based on scenario details.
- Keep responses realistic and specific to the last user turn.
- Do NOT fabricate clinical claims; if unsure, say what you'd need to know.

${COACH_INSTRUCTIONS}
`.trim();

    return `${hdr}${scen}\n\n${sim}`;
  }

  async function sendToWorker(payload) {
    var res = await fetch(CONFIG.workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Upstream error: " + res.status);
    var data = await res.json().catch(() => ({}));
    var txt =
      (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ||
      data.output || data.content || data.reply || "";
    return String(txt || "");
  }

  async function sendMessage(userText) {
    if (state.sending || !userText.trim()) return;
    state.sending = true;

    appendMessage("user", userText);
    state.messages.push({ role: "user", content: userText });

    // Inject baseline + mode system once, right before first send
    if (!state.injected) {
      await ensureBaselineSystem();
      state.messages.unshift({ role: "system", content: buildModeSystem() });
      state.injected = true;
    }

    var payload = {
      model: CONFIG.model,
      temperature: CONFIG.temperature,
      messages: state.messages
    };

    try {
      var reply = await sendToWorker(payload);
      appendMessage("assistant", reply || "(no response)");
      state.messages.push({ role: "assistant", content: reply || "" });
    } catch (e) {
      console.error(e);
      appendMessage("assistant", "Sorry — I hit an upstream error.");
    } finally {
      state.sending = false;
    }
  }

  // ===== UI =====
  var ui;

  function buildUI() {
    // styles
    var style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);

    var wrap = el("div", "tcw-wrap");
    var btn = el("button", "tcw-btn");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" width="20" height="20"><path d="M4 5h16M4 12h16M4 19h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Chat</span>';

    var panel = el("div", "tcw-panel");
    var head = el("div", "tcw-head");
    var title = el("div", "tcw-title");
    title.textContent = CONFIG.title || "Chat";
    var x = el("button", "tcw-close");
    x.innerHTML = "×";
    head.appendChild(title);
    head.appendChild(x);

    // Selector bar: Disease State → Mode → HCP Scenario
    var bar = el("div", "tcw-bar");
    var dsSel = el("select");            // Disease State
    var modeSel = el("select");          // Mode
    var scenSel = el("select", "full");  // HCP Profiles/Scenarios (full width)

    // Populate Disease State (exclude "Emotional Intelligence" if present)
    Object.keys(DATA).forEach(function (ds) {
      if (ds.toLowerCase() === "emotional intelligence") return; // removed
      var opt = el("option");
      opt.value = ds;
      opt.textContent = ds; // HIV already CAPS in key
      dsSel.appendChild(opt);
    });
    dsSel.value = "HIV";

    // Populate Mode
    MODES.forEach(function (m) {
      var opt = el("option");
      opt.value = m.id;
      opt.textContent = m.label;
      modeSel.appendChild(opt);
    });

    // Populate scenario list for current disease
    function refreshScenarios() {
      var ds = dsSel.value;
      scenSel.innerHTML = "";
      var items = (DATA[ds] && DATA[ds].scenarios) || [];
      items.forEach(function (s) {
        var opt = el("option");
        opt.value = s.id;
        opt.textContent = s.label;
        scenSel.appendChild(opt);
      });
      // Remember selection in state
      state.selectedScenarioId = items.length ? items[0].id : null;
    }

    // Keep state in sync and reset injection when selectors change
    function onAnyChange() {
      state.selectedDisease = dsSel.value;
      state.selectedMode = modeSel.value;
      // Reset system injection so next send picks up the new mode/context
      state.injected = false;
    }

    dsSel.onchange = function () {
      refreshScenarios();
      onAnyChange();
    };
    modeSel.onchange = onAnyChange;
    scenSel.onchange = function () {
      state.selectedScenarioId = scenSel.value || null;
      state.injected = false;
    };

    // Initial fill
    refreshScenarios();

    // Compose bar
    bar.appendChild(dsSel);
    bar.appendChild(modeSel);
    bar.appendChild(scenSel);

    var body = el("div", "tcw-body");
    var footer = el("div", "tcw-footer");
    var ta = el("textarea", "tcw-input");
    ta.placeholder = "Type a message…";
    var send = el("button", "tcw-send");
    send.textContent = "Send";

    footer.appendChild(ta);
    footer.appendChild(send);

    panel.appendChild(head);
    panel.appendChild(bar);
    panel.appendChild(body);
    panel.appendChild(footer);

    wrap.appendChild(btn);
    wrap.appendChild(panel);
    document.body.appendChild(wrap);

    // Events
    btn.onclick = function () { wrap.classList.add("tcw-open"); };
    x.onclick = function () { wrap.classList.remove("tcw-open"); };

    send.onclick = function () {
      var t = ta.value;
      ta.value = "";
      sendMessage(t);
    };
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send.click();
      }
    });

    // Brand accents
    panel.style.borderRadius = CONFIG.brand?.radius || "16px";
    var accent = CONFIG.brand?.accent || "#3e5494";
    var brandCss = document.createElement("style");
    brandCss.textContent =
      `.tcw-send{background:${accent};border-color:${accent}} .tcw-head{border-bottom-color:${accent}22}`;
    document.head.appendChild(brandCss);

    return { wrap, panel, body, ta, send, title, dsSel, modeSel, scenSel };
  }

  function getScenarioById(ds, id) {
    var list = (DATA[ds] && DATA[ds].scenarios) || [];
    return list.find(s => s.id === id) || null;
  }

  // Expose minimal API for legacy callers
  window.TonyChatWidget = {
    init: function (cfg) {
      if (cfg) Object.assign(CONFIG, cfg);
      ui = buildUI();
    },
    sendMessage: function (t) { return sendMessage(t); }
  };

  // Autostart
  var ui;
  document.addEventListener("DOMContentLoaded", function () {
    if (!window.__TONY_CHAT_AUTOINIT) {
      window.__TONY_CHAT_AUTOINIT = true;
      if (!ui) window.TonyChatWidget.init();
    }
  });
})();
