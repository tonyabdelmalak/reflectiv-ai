(function () {
  const scriptEl = document.currentScript || document.querySelector('script[data-chat][src*="widget.js"]');
  const enabled = !scriptEl || scriptEl.dataset.chat !== 'disabled';
  if (!enabled) return;

  const CONFIG_URL = '/assets/chat/config.json';
  const SYSTEM_URL = '/assets/chat/system.md';

  const defaults = {
    title: "Ask Tony’s Copilot",
    greeting: "How can I help you explore Tony’s journey, dashboards, or career?",
    brand: { accent: '#4f46e5', radius: '12px' },
    proxyUrl: null,
    model: 'llama3-8b-8192',
    rateLimit: 10,
    scenariosUrl: '/assets/chat/data/scenarios.merged.json'
  };

  const state = {
    config: null,
    system: '',
    scenarios: [],
    messages: [],
    open: false,
    loading: false,
    sentTimestamps: [],
    selections: {
      scenarioId: ''
    }
  };

  const el = {};

  async function fetchJSON(url) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('Failed to fetch JSON', url, err);
      return null;
    }
  }

  async function fetchText(url) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      console.error('Failed to fetch text', url, err);
      return '';
    }
  }

  function applyTheme() {
    const accent = state.config?.brand?.accent || defaults.brand.accent;
    const radius = state.config?.brand?.radius || defaults.brand.radius;
    const root = document.documentElement;
    root.style.setProperty('--chat-accent', accent);
    root.style.setProperty('--chat-radius', radius);
  }

  function buildShell() {
    const bubble = document.createElement('button');
    bubble.className = 'chat-fab';
    bubble.type = 'button';
    bubble.setAttribute('aria-label', 'Open ReflectivAI chat');
    bubble.innerHTML = '💬';
    bubble.addEventListener('click', toggleOpen);

    const container = document.createElement('div');
    container.className = 'chat-window';
    container.innerHTML = `
      <div class="chat-header">
        <div>
          <div class="chat-title">${(state.config?.title || defaults.title)}</div>
          <div class="chat-sub">${(state.config?.greeting || defaults.greeting)}</div>
        </div>
        <button class="chat-close" type="button" aria-label="Close chat">×</button>
      </div>
      <div class="chat-controls">
        <label>
          <span>Scenario</span>
          <select class="chat-select" aria-label="Scenario select"></select>
        </label>
      </div>
      <div class="chat-messages" aria-live="polite"></div>
      <div class="chat-input">
        <textarea placeholder="Type your message" rows="2"></textarea>
        <button class="btn-send" type="button">Send</button>
      </div>
    `;

    document.body.appendChild(bubble);
    document.body.appendChild(container);

    el.bubble = bubble;
    el.container = container;
    el.close = container.querySelector('.chat-close');
    el.messages = container.querySelector('.chat-messages');
    el.textarea = container.querySelector('textarea');
    el.send = container.querySelector('.btn-send');
    el.scenarioSelect = container.querySelector('.chat-select');

    el.close.addEventListener('click', toggleOpen);
    el.send.addEventListener('click', handleSend);
    el.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    renderGreeting();
  }

  function toggleOpen() {
    state.open = !state.open;
    el.container.classList.toggle('open', state.open);
    el.bubble.setAttribute('aria-expanded', state.open ? 'true' : 'false');
    if (state.open) {
      el.textarea.focus();
    }
  }

  function renderGreeting() {
    const greeting = state.config?.greeting || defaults.greeting;
    addMessage('assistant', greeting);
  }

  function addMessage(role, content, meta = {}) {
    const msg = { role, content, meta };
    state.messages.push(msg);
    if (!el.messages) return;

    const wrapper = document.createElement('div');
    wrapper.className = `message ${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'content';
    bubble.textContent = content;
    wrapper.appendChild(bubble);

    if (role === 'coach' && meta.feedback) {
      const coach = document.createElement('div');
      coach.className = 'coach-panel';
      coach.innerHTML = `
        <div class="coach-heading">Coach Feedback</div>
        <div class="coach-text">${meta.feedback}</div>
      `;
      wrapper.appendChild(coach);
    }

    el.messages.appendChild(wrapper);
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  async function loadConfigAndData() {
    const cfg = await fetchJSON(CONFIG_URL);
    state.config = cfg ? { ...defaults, ...cfg } : { ...defaults };
    state.system = await fetchText(SYSTEM_URL);
    applyTheme();
    await loadScenarios();
    hydrateScenarioSelect();
  }

  async function loadScenarios() {
    const url = state.config?.scenariosUrl || defaults.scenariosUrl;
    const data = await fetchJSON(url);
    if (!data) return;
    if (Array.isArray(data)) {
      state.scenarios = data;
    } else if (Array.isArray(data.scenarios)) {
      state.scenarios = data.scenarios;
    }
    if (!state.selections.scenarioId && state.scenarios.length > 0) {
      state.selections.scenarioId = state.scenarios[0].id;
    }
  }

  function hydrateScenarioSelect() {
    if (!el.scenarioSelect) return;
    el.scenarioSelect.innerHTML = '';
    if (!state.scenarios.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No scenarios available';
      el.scenarioSelect.appendChild(opt);
      el.scenarioSelect.disabled = true;
      return;
    }
    for (const scenario of state.scenarios) {
      const opt = document.createElement('option');
      opt.value = scenario.id;
      opt.textContent = `${scenario.title || scenario.id} (${scenario.therapeuticArea || 'N/A'})`;
      if (scenario.id === state.selections.scenarioId) opt.selected = true;
      el.scenarioSelect.appendChild(opt);
    }
    el.scenarioSelect.disabled = false;
    el.scenarioSelect.addEventListener('change', (e) => {
      state.selections.scenarioId = e.target.value;
    });
  }

  function buildPayload(userText) {
    const messages = [];
    const scenario = state.scenarios.find(s => s.id === state.selections.scenarioId);
    let systemPrompt = state.system || '';
    if (scenario) {
      const summary = `\n\n[Scenario]\nTitle: ${scenario.title}\nArea: ${scenario.therapeuticArea}\nHCP: ${scenario.hcpProfile}\nObjection: ${scenario.objection}\nGoal: ${scenario.goal}\nApproach: ${scenario.approach}`;
      systemPrompt += summary;
    }
    messages.push({ role: 'system', content: systemPrompt.trim() });

    for (const msg of state.messages) {
      if (msg.role === 'coach') continue;
      messages.push({ role: msg.role, content: msg.content });
    }
    messages.push({ role: 'user', content: userText });

    const model = state.config?.model || defaults.model;
    return { messages, model, temperature: 0.2 };
  }

  function proxyUrl() {
    return state.config?.proxyUrl || state.config?.workerUrl || state.config?.apiBase || defaults.proxyUrl || '';
  }

  function withinRateLimit() {
    const limit = Number(state.config?.rateLimit ?? defaults.rateLimit);
    if (!limit || Number.isNaN(limit) || limit <= 0) return true;

    const now = Date.now();
    state.sentTimestamps = state.sentTimestamps.filter(ts => now - ts < 60_000);
    if (state.sentTimestamps.length >= limit) {
      addMessage('assistant', 'You have reached the message limit for the past minute. Please wait a moment and try again.');
      return false;
    }

    state.sentTimestamps.push(now);
    return true;
  }

  async function handleSend() {
    if (state.loading) return;
    const text = (el.textarea.value || '').trim();
    if (!text) return;
    if (!withinRateLimit()) return;
    addMessage('user', text);
    el.textarea.value = '';
    await sendToProxy(text);
  }

  async function sendToProxy(text) {
    const url = proxyUrl();
    if (!url) {
      addMessage('assistant', 'Chat service is not configured.');
      return;
    }
    state.loading = true;
    setBusy(true);
    const payload = buildPayload(text);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Upstream ${res.status}: ${body}`);
      }
      const data = await res.json();
      if (data.assistant || data.content) {
        addMessage('assistant', data.assistant || data.content || '');
      } else if (data.choices?.[0]?.message?.content) {
        addMessage('assistant', data.choices[0].message.content);
      } else {
        addMessage('assistant', 'Received an unexpected response.');
      }
      if (data.coach && (data.coach.feedback || data.coach.scores)) {
        const feedbackParts = [];
        if (data.coach.feedback) feedbackParts.push(data.coach.feedback);
        if (data.coach.scores) feedbackParts.push(JSON.stringify(data.coach.scores));
        addMessage('coach', feedbackParts.join('\n'), { feedback: data.coach.feedback });
      }
    } catch (err) {
      console.error('Send failed', err);
      addMessage('assistant', 'Sorry, I could not reach the chat service. Please try again.');
    } finally {
      state.loading = false;
      setBusy(false);
    }
  }

  function setBusy(isBusy) {
    el.send.disabled = isBusy;
    el.textarea.disabled = isBusy;
    el.container.classList.toggle('loading', isBusy);
  }

  async function init() {
    buildShell();
    await loadConfigAndData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
