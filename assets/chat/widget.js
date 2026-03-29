(() => {
  const CONFIG_URL = '/assets/chat/config.json';
  const SYSTEM_URL = '/assets/chat/system.md';
  const SELECTOR = 'script[data-chat="enabled"]';

  const state = {
    config: null,
    systemPrompt: '',
    messages: [],
    sendCount: 0,
    busy: false,
    open: true,
  };

  const ui = {};

  const init = async () => {
    if (!document.querySelector(SELECTOR) || document.querySelector('.chat-widget-root')) return;

    render();
    setStatus('Loading chat…');
    setSendingDisabled(true);

    try {
      const [configRes, systemRes] = await Promise.all([
        fetch(CONFIG_URL, { credentials: 'same-origin' }),
        fetch(SYSTEM_URL, { credentials: 'same-origin' }),
      ]);

      if (!configRes.ok) throw new Error(`Config request failed (${configRes.status})`);
      if (!systemRes.ok) throw new Error(`System prompt request failed (${systemRes.status})`);

      state.config = await configRes.json();
      state.systemPrompt = await systemRes.text();
      updateHeader();
      applyTheme();
      appendMessage('assistant', state.config.greeting || 'Hi there — how can I help?');
      setStatus(`Connected to ${state.config.title || 'chat assistant'}.`);
      setSendingDisabled(false);
    } catch (error) {
      appendMessage('error', `The chat widget could not start. ${error.message}`);
      setStatus('Chat unavailable.');
      setSendingDisabled(true);
    }
  };

  const render = () => {
    const root = document.createElement('section');
    root.className = 'chat-widget-root';
    root.dataset.open = String(state.open);
    root.innerHTML = `
      <button class="chat-widget-launcher" type="button" aria-label="Toggle chat widget">💬</button>
      <div class="chat-widget-panel" role="dialog" aria-label="Chat widget">
        <div class="chat-widget-header">
          <div>
            <h2 class="chat-widget-title">Ask Tony’s Copilot</h2>
            <p class="chat-widget-subtitle">Groq-backed assistant for quick site Q&amp;A.</p>
          </div>
          <button class="chat-widget-close" type="button" aria-label="Close chat">×</button>
        </div>
        <div class="chat-widget-status" aria-live="polite">Starting…</div>
        <div class="chat-widget-messages" aria-live="polite"></div>
        <form class="chat-widget-form">
          <label>
            <span class="sr-only">Message</span>
            <textarea name="message" placeholder="Ask about Tony’s journey, dashboards, or career…" required></textarea>
          </label>
          <div class="chat-widget-actions">
            <div class="chat-widget-hint">Press Enter+Ctrl to send.</div>
            <button type="submit">Send</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(root);
    ui.root = root;
    ui.launcher = root.querySelector('.chat-widget-launcher');
    ui.close = root.querySelector('.chat-widget-close');
    ui.title = root.querySelector('.chat-widget-title');
    ui.subtitle = root.querySelector('.chat-widget-subtitle');
    ui.status = root.querySelector('.chat-widget-status');
    ui.messages = root.querySelector('.chat-widget-messages');
    ui.form = root.querySelector('.chat-widget-form');
    ui.textarea = root.querySelector('textarea');
    ui.submit = root.querySelector('button[type="submit"]');

    ui.launcher.addEventListener('click', toggleOpen);
    ui.close.addEventListener('click', toggleOpen);
    ui.form.addEventListener('submit', onSubmit);
    ui.textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault();
        ui.form.requestSubmit();
      }
    });
  };

  const updateHeader = () => {
    if (!ui.title || !ui.subtitle) return;
    ui.title.textContent = state.config?.title || 'Ask Tony’s Copilot';
    ui.subtitle.textContent = 'Groq-backed assistant for quick site Q&A.';
  };

  const applyTheme = () => {
    if (!state.config || !ui.root) return;
    const accent = state.config.brand?.accent || '#4f46e5';
    const radius = state.config.brand?.radius || '12px';
    ui.root.style.setProperty('--chat-accent', accent);
    ui.root.style.setProperty('--chat-radius', radius);
  };

  const toggleOpen = () => {
    state.open = !state.open;
    if (ui.root) ui.root.dataset.open = String(state.open);
  };

  const appendMessage = (role, content) => {
    state.messages.push({ role, content });
    if (!ui.messages) return;
    const el = document.createElement('article');
    const normalizedRole = role === 'error' ? 'error' : role;
    el.className = `chat-widget-message chat-widget-message--${normalizedRole}`;
    el.textContent = content;
    ui.messages.appendChild(el);
    ui.messages.scrollTop = ui.messages.scrollHeight;
  };

  const setStatus = (text) => {
    if (!ui.status) return;
    ui.status.textContent = text;
  };

  const setSendingDisabled = (disabled) => {
    if (!ui.submit || !ui.textarea || !ui.launcher) return;
    ui.submit.disabled = disabled;
    ui.textarea.disabled = disabled;
    ui.launcher.disabled = false;
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!state.config || state.busy) return;

    const text = ui.textarea.value.trim();
    if (!text) return;

    const limit = Number(state.config.rateLimit || 10);
    if (state.sendCount >= limit) {
      appendMessage('error', `This session reached its ${limit}-message limit. Refresh to continue.`);
      setStatus('Rate limit reached.');
      return;
    }

    appendMessage('user', text);
    ui.textarea.value = '';
    state.sendCount += 1;
    state.busy = true;
    setSendingDisabled(true);
    setStatus('Thinking…');

    try {
      const content = await requestAssistantReply();
      appendMessage('assistant', content || 'I’m sorry, but I do not have a reply yet.');
      setStatus('Ready for the next question.');
    } catch (error) {
      appendMessage('error', error.message);
      setStatus('Request failed.');
    } finally {
      state.busy = false;
      setSendingDisabled(false);
      ui.textarea.focus();
    }
  };

  const requestAssistantReply = async () => {
    const payload = {
      model: state.config.model || 'llama3-8b-8192',
      temperature: 0.2,
      messages: [
        { role: 'system', content: state.systemPrompt },
        ...state.messages
          .filter((message) => message.role === 'user' || message.role === 'assistant')
          .map(({ role, content }) => ({ role, content })),
      ],
    };

    const response = await fetch(state.config.proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Proxy request failed (${response.status}).`);
    }
    if (typeof data.content !== 'string') {
      throw new Error('Proxy response did not include `content`.');
    }
    return data.content.trim();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
