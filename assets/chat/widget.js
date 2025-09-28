// Floating chat widget with Persona + Coach mode (no backend changes required)
// Works under subpaths (GitHub Pages) via relative URLs.

(function(){
  var CONFIG = {
    workerUrl: "https://my-chat-agent.tonyabdelmalak.workers.dev/chat", // <- keep or change
    systemUrl: "./chat-widget/assets/chat/system.md",                   // <- baseline system
    model: "llama-3.1-8b-instant",
    temperature: 0.2,
    title: "Practice Coach",
    brand: { accent: "#3e5494", radius: "14px" }
  };

  // ----- Utilities -----
  function $(sel, root){ return (root||document).querySelector(sel); }
  function el(tag, cls, txt){ var n = document.createElement(tag); if(cls) n.className = cls; if(txt!=null) n.textContent = txt; return n; }
  function escapeHTML(s){ return s.replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }

  // ----- Create UI -----
  function buildUI(){
    var wrap = el("div","tcw-wrap");
    var btn  = el("button","tcw-btn");
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 5h16M4 12h16M4 19h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Chat</span>';
    var panel = el("div","tcw-panel");

    var head = el("div","tcw-head");
    var title = el("div","tcw-title"); title.textContent = CONFIG.title || "Chat";
    var x = el("button","tcw-close"); x.innerHTML = "×";
    head.appendChild(title); head.appendChild(x);

    var body = el("div","tcw-body");
    var footer = el("div","tcw-footer");
    var ta = el("textarea","tcw-input"); ta.placeholder = "Type a message…";
    var send = el("button","tcw-send"); send.textContent = "Send";
    footer.appendChild(ta); footer.appendChild(send);

    panel.appendChild(head);
    // Persona bar gets inserted right here by the add-on
    panel.appendChild(body);
    panel.appendChild(footer);

    wrap.appendChild(btn);
    wrap.appendChild(panel);
    document.body.appendChild(wrap);

    // Open/close
    btn.onclick = ()=> wrap.classList.add("tcw-open");
    x.onclick = ()=> wrap.classList.remove("tcw-open");

    return { wrap, panel, body, ta, send, title };
  }

  // ----- Chat core -----
  var state = {
    messages: [],
    _pendingSystem: null,
    _personaInjected: false,
    sending: false
  };

  function appendMessage(role, text){
    var box = el("div","tcw-msg " + (role==="user"?"tcw-user":"tcw-bot"));
    box.innerHTML = escapeHTML(text);
    ui.body.appendChild(box);
    ui.body.scrollTop = ui.body.scrollHeight;
  }

  async function fetchText(url){
    var res = await fetch(url, { cache: "no-store" });
    if(!res.ok) throw new Error("Failed to load "+url);
    return await res.text();
  }

  async function ensureBaselineSystem(){
    if (state.messages.some(m=>m.role==="system")) return;
    try {
      var sys = await fetchText(CONFIG.systemUrl);
      state.messages.unshift({ role:"system", content: sys });
    } catch(e){ console.warn("No baseline system.md loaded:", e); }
  }

  async function sendToWorker(payload){
    var res = await fetch(CONFIG.workerUrl, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });
    if(!res.ok) throw new Error("Upstream error: "+res.status);
    var data = await res.json().catch(()=> ({}));
    // Try common shapes
    var txt = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content)
           || data.output || data.content || data.reply || "";
    return String(txt || "");
  }

  async function sendMessage(userText){
    if (state.sending || !userText.trim()) return;
    state.sending = true;

    appendMessage("user", userText);
    state.messages.push({ role:"user", content:userText });

    // Inject persona system on first send (if pending)
    if (state._pendingSystem){
      state.messages.unshift({ role:"system", content: state._pendingSystem });
      state._pendingSystem = null;
    } else {
      await ensureBaselineSystem();
    }

    var payload = {
      model: CONFIG.model,
      temperature: CONFIG.temperature,
      messages: state.messages
    };

    try {
      var reply = await sendToWorker(payload);
      appendMessage("assistant", reply || "(no response)");
      state.messages.push({ role:"assistant", content: reply || "" });
    } catch (e){
      console.error(e);
      appendMessage("assistant", "Sorry — I hit an upstream error.");
    } finally {
      state.sending = false;
    }
  }

  // expose API
  var ui;
  window.TonyChatWidget = {
    init(cfg){
      if (cfg) Object.assign(CONFIG, cfg);
      ui = buildUI();
      // brand styling
      ui.panel.style.borderRadius = CONFIG.brand?.radius || "16px";
      var accent = CONFIG.brand?.accent || "#3e5494";
      var css = document.createElement("style");
      css.textContent = `.tcw-send{background:${accent};border-color:${accent}} .tcw-head{border-bottom-color:${accent}22}`;
      document.head.appendChild(css);

      // wiring
      ui.send.onclick = () => { var t = ui.ta.value; ui.ta.value = ""; sendMessage(t); };
      ui.ta.addEventListener("keydown", (e)=> {
        if (e.key==="Enter" && !e.shiftKey){ e.preventDefault(); ui.send.click(); }
      });
    },
    sendMessage, // used by persona add-on wrapper
    prependSystem(sys){ state._pendingSystem = sys; },
    _personaInjected: false,
    _pendingSystem: null
  };

  // Auto-init if script is included without manual init
  document.addEventListener("DOMContentLoaded", function(){
    if (!window.__TONY_CHAT_AUTOINIT){
      window.__TONY_CHAT_AUTOINIT = true;
      if (!ui) window.TonyChatWidget.init();
    }
  });

  // ===== Persona + Coach Add-On (embedded for convenience) =====
  // Adjust persona file paths for subpath hosting.
  var TONY_PERSONAS = [
  { name: "Coworker", url: "./chat-widget/assets/chat/personas/coworker.md" },
  { name: "Manager",  url: "./chat-widget/assets/chat/personas/manager.md"  },
  { name: "Family",   url: "./chat-widget/assets/chat/personas/family.md"   },
  { name: "Friend",   url: "./chat-widget/assets/chat/personas/friend.md"   },
];

  var COACH_INSTRUCTIONS = `
# Coach Mode (Private to the model — do not role-play this)
After your role-play response, add a section:
---
Coach Feedback
- Tone: (concise bullet)
- What worked: (1–3 bullets)
- What to tighten: (1–3 bullets)
- Suggest a stronger rewrite in 2–4 sentences.
Keep feedback crisp and actionable.
`.trim();

  function attachPersonaUI(){
    var host = document.querySelector(".tcw-panel");
    if (!host || host.querySelector(".persona-bar")) return;

    var bar = document.createElement("div");
    bar.className = "persona-bar";

    var sel = document.createElement("select");
    sel.title = "Choose persona";
    sel.style.flex = "1";
    TONY_PERSONAS.forEach(p=>{ var o=document.createElement("option"); o.value=p.url; o.textContent=p.name; sel.appendChild(o); });

    var scenario = document.createElement("input");
    scenario.type = "text";
    scenario.placeholder = "Scenario (e.g., ask for deadline extension)";
    scenario.style.flex = "2";

    var coachWrap = document.createElement("label");
    var coach = document.createElement("input"); coach.type = "checkbox";
    coachWrap.appendChild(coach);
    coachWrap.appendChild(document.createTextNode("Coach"));

    bar.appendChild(sel);
    bar.appendChild(scenario);
    bar.appendChild(coachWrap);

    // insert just above footer
    var footer = host.querySelector(".tcw-footer");
    host.insertBefore(bar, footer);

    // restore prefs
    var saved = JSON.parse(localStorage.getItem("tonyPersonaPrefs")||"{}");
    if (saved.personaUrl) sel.value = saved.personaUrl;
    if (saved.coach) coach.checked = true;
    if (saved.scenario) scenario.value = saved.scenario;

    function persist(){
      localStorage.setItem("tonyPersonaPrefs", JSON.stringify({
        personaUrl: sel.value, coach: coach.checked, scenario: scenario.value
      }));
    }
    sel.onchange = persist; coach.onchange = persist; scenario.oninput = persist;

    // Wrap sendMessage once
    var realSend = window.TonyChatWidget && window.TonyChatWidget.sendMessage;
    if (!realSend) return;

    async function fetchText(url){
      var r = await fetch(url, { cache: "no-store" });
      if(!r.ok) throw new Error("Persona load failed: " + url);
      return await r.text();
    }

    async function buildSystem(){
      var personaMd = await fetchText(sel.value);
      var scenarioTxt = scenario.value && scenario.value.trim()
        ? `\n\n## Scenario\n${scenario.value.trim()}\n` : "";
      var coachTxt = coach.checked ? "\n\n" + COACH_INSTRUCTIONS : "";
      return (personaMd.trim() + scenarioTxt + coachTxt).trim();
    }

    window.TonyChatWidget.sendMessage = async function(userText){
      if (!window.TonyChatWidget._personaInjected){
        try {
          var sys = await buildSystem();
          if (typeof window.TonyChatWidget.prependSystem === "function"){
            window.TonyChatWidget.prependSystem(sys);
          } else {
            window.TonyChatWidget._pendingSystem = sys;
          }
          window.TonyChatWidget._personaInjected = true;
        } catch(e){ console.error(e); }
      }
      return realSend.call(window.TonyChatWidget, userText);
    };
  }

  // When panel mounts, attach the persona UI
  document.addEventListener("DOMContentLoaded", function(){
    // wait a tick for panel
    setTimeout(attachPersonaUI, 100);
  });

})();
