(() => {
  const script = document.currentScript;
  if (!script || script.dataset.chat !== 'enabled') {
    return;
  }

  const CONFIG_URL = '/assets/chat/config.json';
  const SYSTEM_URL = '/assets/chat/system.md';

  const DEFAULT_CONFIG = {
    proxyUrl: '',
    title: 'Reflectiv Copilot',
    greeting: 'Hi there! How can I help you today?',
    brand: { accent: '#4f46e5', radius: '12px' },
    rateLimit: 10,
    model: 'llama3-8b-8192'
  };

  const DEFAULT_SCENARIOS = [
    { id: 'oncology_consult', label: 'Oncology Consult' },
    { id: 'cardio_followup', label: 'Cardiology Follow Up' },
    { id: 'vaccines_parent', label: 'Vaccine Hesitancy Parent' }
  ];

  let config = { ...DEFAULT_CONFIG };
  let systemPrompt = '';
  let conversation = [];
  let currentMode = 'role-play';
  let currentScenarioId = null;
  let sendInProgress = false;
  let typingNode = null;
  let fallbackTimer = null;
  let messagesContainer = null;
  let textarea = null;
  let panel = null;
  let scenarioRow = null;
  let modeSelect = null;
  let scenarioSelect = null;

  async function init() {
    currentMode = sessionStorage.getItem('reflectiv_last_mode') || 'role-play';
    currentScenarioId = sessionStorage.getItem('reflectiv_last_scenario') || DEFAULT_SCENARIOS[0].id;

    await Promise.all([loadConfig(), loadSystemPrompt()]);
    createWidget();
    applyModeVisibility();
    addMessage('assistant', config.greeting, { skipContext: true });
  }

  async function loadConfig() {
    try {
      const res = await fetch(CONFIG_URL, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        config = {
          ...DEFAULT_CONFIG,
          ...data,
          brand: { ...DEFAULT_CONFIG.brand, ...(data.brand || {}) }
        };
      }
    } catch (error) {
      console.warn('[ReflectivAI] Failed to load config.json, falling back to defaults.', error);
    }
  }

  async function loadSystemPrompt() {
    try {
      const res = await fetch(SYSTEM_URL, { cache: 'no-store' });
      if (res.ok) {
        systemPrompt = await res.text();
        return;
      }
    } catch (error) {
      console.warn('[ReflectivAI] Failed to load system.md, using fallback prompt.', error);
    }
    systemPrompt = 'You are Reflectiv Copilot, a professional guide who answers clearly and safely.';
  }

  function createWidget() {
    const launcherWrapper = document.createElement('div');
    launcherWrapper.className = 'reflectiv-chat-launcher';

    const launcherButton = document.createElement('button');
    launcherButton.setAttribute('type', 'button');
    launcherButton.setAttribute('aria-label', 'Open Reflectiv chat');
    launcherButton.innerHTML = '&#128172;';
    launcherWrapper.appendChild(launcherButton);

    panel = document.createElement('div');
    panel.className = 'reflectiv-chat-panel';

    applyBrand(panel);

    const header = document.createElement('div');
    header.className = 'reflectiv-chat-header';
    const title = document.createElement('h2');
    title.textContent = config.title;
    const subtitle = document.createElement('p');
    subtitle.textContent = 'Powered by Groq + Reflectiv AI';
    header.append(title, subtitle);

    const body = document.createElement('div');
    body.className = 'reflectiv-chat-body';

    const modeRow = document.createElement('div');
    modeRow.className = 'reflectiv-mode-row';
    const modeLabel = document.createElement('label');
    modeLabel.textContent = 'Mode';
    modeSelect = document.createElement('select');
    [
      { value: 'role-play', label: 'Role Play (HCP)' },
      { value: 'product', label: 'Product Q&A' },
      { value: 'insights', label: 'Coaching Insights' }
    ].forEach((option) => {
      const opt = document.createElement('option');
      opt.value = option.value;
      opt.textContent = option.label;
      if (option.value === currentMode) {
        opt.selected = true;
      }
      modeSelect.appendChild(opt);
    });
    modeRow.append(modeLabel, modeSelect);

    scenarioRow = document.createElement('div');
    scenarioRow.className = 'reflectiv-scenario-row';
    const scenarioLabel = document.createElement('label');
    scenarioLabel.textContent = 'Scenario';
    scenarioSelect = document.createElement('select');
    DEFAULT_SCENARIOS.forEach((scenario) => {
      const opt = document.createElement('option');
      opt.value = scenario.id;
      opt.textContent = scenario.label;
      scenarioSelect.appendChild(opt);
    });
    if (currentScenarioId) {
      scenarioSelect.value = currentScenarioId;
    }
    scenarioRow.append(scenarioLabel, scenarioSelect);

    messagesContainer = document.createElement('div');
    messagesContainer.className = 'reflectiv-chat-messages';

    const footer = document.createElement('div');
    footer.className = 'reflectiv-chat-footer';
    const form = document.createElement('form');
    textarea = document.createElement('textarea');
    textarea.setAttribute('placeholder', 'Type your message…');
    textarea.setAttribute('rows', '2');
    const sendButton = document.createElement('button');
    sendButton.setAttribute('type', 'submit');
    sendButton.textContent = 'Send';
    form.append(textarea, sendButton);
    footer.appendChild(form);

    body.append(modeRow, scenarioRow, messagesContainer);
    panel.append(header, body, footer);

    document.body.append(launcherWrapper, panel);

    launcherButton.addEventListener('click', () => {
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) {
        textarea.focus({ preventScroll: true });
      }
      renderConversation();
    });

    modeSelect.addEventListener('change', () => {
      currentMode = modeSelect.value;
      applyModeVisibility();
    });

    scenarioSelect.addEventListener('change', () => {
      currentScenarioId = scenarioSelect.value;
      sessionStorage.setItem('reflectiv_last_scenario', currentScenarioId);
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      sendMessage();
    });

    renderConversation();
  }

  function applyBrand(rootNode) {
    const accent = config.brand?.accent || DEFAULT_CONFIG.brand.accent;
    const radius = config.brand?.radius || DEFAULT_CONFIG.brand.radius;
    const target = rootNode || document.documentElement;
    target.style.setProperty('--reflectiv-accent', accent);
    target.style.setProperty('--reflectiv-radius', radius);
    document.documentElement.style.setProperty('--reflectiv-accent', accent);
    document.documentElement.style.setProperty('--reflectiv-radius', radius);
  }

  function applyModeVisibility() {
    if (!scenarioRow) return;
    const showScenario = currentMode === 'role-play';
    scenarioRow.style.display = showScenario ? 'flex' : 'none';
    sessionStorage.setItem('reflectiv_last_mode', currentMode);
    sessionStorage.setItem('reflectiv_last_scenario', currentScenarioId || '');
  }

  function renderConversation() {
    if (!messagesContainer) return;
    messagesContainer.innerHTML = '';

    const visibleMessages = conversation.filter((message) => !message.hidden);
    if (!visibleMessages.length) {
      const empty = document.createElement('div');
      empty.className = 'reflectiv-chat-empty';
      empty.textContent = 'Say hello to start the conversation.';
      messagesContainer.appendChild(empty);
    } else {
      visibleMessages.forEach((message) => {
        const wrapper = document.createElement('div');
        wrapper.className = `reflectiv-message ${message.role}`;

        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.textContent = message.content;
        wrapper.appendChild(bubble);

        if (message.meta) {
          const meta = document.createElement('div');
          meta.className = 'meta';
          meta.textContent = message.meta;
          wrapper.appendChild(meta);
        }

        messagesContainer.appendChild(wrapper);
      });
    }

    if (typingNode) {
      messagesContainer.appendChild(typingNode);
    }

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function addMessage(role, content, options = {}) {
    const entry = {
      role,
      content,
      hidden: options.hidden || false,
      skipContext: options.skipContext || false,
      includeInContext: options.includeInContext !== false,
      meta: options.meta || '',
      scenarioId: options.scenarioId ?? currentScenarioId,
      mode: options.mode || currentMode,
      timestamp: Date.now()
    };
    conversation.push(entry);

    if (currentMode === 'role-play' && role !== 'system' && !entry.hidden && conversation.length % 10 === 0) {
      conversation.push({
        role: 'system',
        content: 'Reminder: you are the HCP in this simulated clinical conversation. Stay in first-person and continue from your last answer.',
        hidden: true,
        skipContext: false,
        includeInContext: true,
        timestamp: Date.now()
      });
    }

    renderConversation();
    return entry;
  }

  function showTyping() {
    if (typingNode) return;
    typingNode = document.createElement('div');
    typingNode.className = 'reflectiv-message assistant';
    const bubble = document.createElement('div');
    bubble.className = 'reflectiv-typing';
    bubble.innerHTML = '<span></span><span></span><span></span>';
    typingNode.appendChild(bubble);
    messagesContainer.appendChild(typingNode);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function hideTyping() {
    if (typingNode && typingNode.parentNode) {
      typingNode.parentNode.removeChild(typingNode);
    }
    typingNode = null;
  }

  function buildMessagesPayload() {
    const messages = [];
    const contextParts = [];

    if (systemPrompt) {
      contextParts.push(systemPrompt.trim());
    }

    contextParts.push(`Current mode: ${currentMode}.`);

    if (currentMode === 'role-play') {
      contextParts.push('You are role-playing as a healthcare provider responding naturally to the user. Speak in the first person, stay in character, and maintain continuity.');
      if (currentScenarioId) {
        contextParts.push(`Scenario ID: ${currentScenarioId}. Use any scenario details available to stay consistent.`);
      }
    }

    messages.push({
      role: 'system',
      content: contextParts.join('\n\n')
    });

    conversation.forEach((entry) => {
      if (!entry.includeInContext || entry.skipContext) {
        return;
      }
      messages.push({ role: entry.role, content: entry.content });
    });

    if (currentMode === 'role-play') {
      messages.unshift({
        role: 'system',
        content: "Stay fully in character as the healthcare provider. Speak as 'I', never as a coach or assistant. Continue naturally from the last HCP reply."
      });
    }

    return messages;
  }

  async function callModel(messages) {
    const payload = {
      model: currentMode === 'role-play' ? 'llama-3.1-8b-instant' : 'llama-3.1-8b',
      temperature: currentMode === 'role-play' ? 0.1 : 0.2,
      messages
    };

    showTyping();

    try {
      const response = await fetch(config.proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Proxy error: ${response.status}`);
      }

      const data = await response.json();
      const assistantContent = (data && typeof data.content === 'string' ? data.content : '').trim();

      if (!assistantContent) {
        addMessage('assistant', "I didn't receive a response. Could you try again?");
      } else {
        addMessage('assistant', assistantContent);
      }
    } catch (error) {
      console.error('[ReflectivAI] callModel failed', error);
      addMessage('assistant', 'I ran into a connection issue. Let’s pick up from your last point.');
    } finally {
      hideTyping();
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      sendInProgress = false;
    }
  }

  function sendMessage() {
    if (sendInProgress) {
      return;
    }
    sendInProgress = true;
    setTimeout(() => {
      sendInProgress = false;
    }, 3000);

    const text = textarea.value.trim();
    if (!text) {
      sendInProgress = false;
      return;
    }

    textarea.value = '';

    addMessage('user', text, { includeInContext: true });

    fallbackTimer = setTimeout(() => {
      if (conversation.length && conversation[conversation.length - 1].role === 'user') {
        addMessage('assistant', 'Let’s continue where we left off—what’s next?');
        sendInProgress = false;
      }
    }, 25000);

    if (currentMode === 'role-play' && conversation.length > 35) {
      conversation = conversation.slice(-30);
      console.warn('[ReflectivAI] Conversation auto-trimmed to last 30 turns.');
      renderConversation();
    }

    const messages = buildMessagesPayload();
    callModel(messages);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
