/*
 * ReflectivEI AI widget
 *
 * This script builds a chat interface with three modes: emotional assessment,
 * HIV product knowledge and sales simulation. It loads configuration and
 * content files, manages conversation state, and communicates with the
 * upstream worker endpoint defined in config.json. When run on the ReflectivEI
 * site it attaches itself to an element with id="reflectiv-widget".
 */

(function () {
  const container = document.getElementById('reflectiv-widget');
  if (!container) return;

  // Internal state
  let config = null;
  let systemPrompt = '';
  let knowledge = '';
  let scenarios = {};
  let currentMode = 'emotional-assessment';
  let currentScenarioKey = null;
  let conversation = [];
  let coachEnabled = false;

  // Helper to fetch JSON or text
  async function fetchLocal(path) {
    const resp = await fetch(path);
    if (!resp.ok) throw new Error(`Failed to load ${path}`);
    const contentType = resp.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return resp.json();
    }
    return resp.text();
  }

  // Parse scenarios file into a simple object
  function parseScenarios(text) {
    const lines = text.split(/\r?\n/);
    const result = {};
    let key = null;
    let obj = null;
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('# Scenario:')) {
        if (key && obj) {
          result[key] = obj;
        }
        key = trimmed.substring('# Scenario:'.length).trim();
        obj = {};
      } else if (key) {
        const idx = trimmed.indexOf(':');
        if (idx > 0) {
          const k = trimmed.substring(0, idx).trim();
          const v = trimmed.substring(idx + 1).trim();
          obj[k] = v;
        }
      }
    });
    if (key && obj) {
      result[key] = obj;
    }
    return result;
  }

  // Build UI once files are loaded
  function buildUI() {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'reflectiv-chat';
    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'chat-toolbar';
    // Mode selector
    const modeSelect = document.createElement('select');
    config.modes.forEach(mode => {
      const opt = document.createElement('option');
      opt.value = mode;
      opt.textContent = mode
        .replace(/-/g, ' ')
        .replace(/\b(\w)/g, c => c.toUpperCase());
      modeSelect.appendChild(opt);
    });
    modeSelect.value = currentMode;
    modeSelect.addEventListener('change', () => {
      currentMode = modeSelect.value;
      currentScenarioKey = null;
      conversation = [];
      coachEnabled = false;
      renderMessages();
      updateScenarioSelector();
    });
    toolbar.appendChild(modeSelect);
    // Scenario selector (populated later for sales simulation)
    const scenarioSelect = document.createElement('select');
    scenarioSelect.style.display = 'none';
    scenarioSelect.addEventListener('change', () => {
      currentScenarioKey = scenarioSelect.value || null;
      conversation = [];
      coachEnabled = false;
      renderMessages();
    });
    toolbar.appendChild(scenarioSelect);
    // Coach toggle
    const coachButton = document.createElement('button');
    coachButton.textContent = 'Enable Coach';
    coachButton.addEventListener('click', () => {
      coachEnabled = !coachEnabled;
      coachButton.textContent = coachEnabled ? 'Disable Coach' : 'Enable Coach';
    });
    toolbar.appendChild(coachButton);

    wrapper.appendChild(toolbar);
    // Messages
    const messagesContainer = document.createElement('div');
    messagesContainer.className = 'chat-messages';
    wrapper.appendChild(messagesContainer);
    // Input area
    const inputArea = document.createElement('div');
    inputArea.className = 'chat-input';
    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Type your message…';
    textarea.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(textarea.value.trim());
        textarea.value = '';
      }
    });
    const sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send';
    sendBtn.addEventListener('click', () => {
      const text = textarea.value.trim();
      if (text) {
        sendMessage(text);
        textarea.value = '';
      }
    });
    inputArea.appendChild(textarea);
    inputArea.appendChild(sendBtn);
    wrapper.appendChild(inputArea);
    container.appendChild(wrapper);

    // Helper to update scenario select options
    function updateScenarioSelector() {
      if (currentMode === 'sales-simulation') {
        scenarioSelect.style.display = '';
        scenarioSelect.innerHTML = '<option value="">Select Scenario</option>';
        Object.keys(scenarios).forEach(key => {
          const opt = document.createElement('option');
          opt.value = key;
          opt.textContent = key;
          scenarioSelect.appendChild(opt);
        });
      } else {
        scenarioSelect.style.display = 'none';
      }
    }
    updateScenarioSelector();

    // Render messages and (optionally) coach feedback
    function renderMessages() {
      messagesContainer.innerHTML = '';
      conversation.forEach(msg => {
        const div = document.createElement('div');
        div.className = 'message ' + msg.role;
        div.textContent = msg.content;
        messagesContainer.appendChild(div);
      });
      // Coach feedback
      const existingFeedback = container.querySelector('.coach-feedback');
      if (existingFeedback) existingFeedback.remove();
      if (coachEnabled && conversation.length > 0) {
        const feedback = generateCoachFeedback();
        if (feedback) {
          const fbDiv = document.createElement('div');
          fbDiv.className = 'coach-feedback';
          const h3 = document.createElement('h3');
          h3.textContent = 'Coach Feedback';
          fbDiv.appendChild(h3);
          const list = document.createElement('ul');
          ['Tone', 'What worked', 'What to improve', 'Suggested stronger phrasing'].forEach(field => {
            const li = document.createElement('li');
            li.innerHTML = `<strong>${field}:</strong> ${feedback[field.toLowerCase()]}`;
            list.appendChild(li);
          });
          fbDiv.appendChild(list);
          container.appendChild(fbDiv);
        }
      }
      // Scroll to bottom
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Send message to upstream
    async function sendMessage(content) {
      if (!content) return;
      conversation.push({ role: 'user', content });
      renderMessages();
      // Build system message
      const messages = [];
      messages.push({ role: 'system', content: systemPrompt });
      // Mode specific context
      if (currentMode === 'hiv-product-knowledge') {
        messages.push({ role: 'system', content: 'You are answering questions about HIV medications using the provided evidence-based knowledge.' });
        messages.push({ role: 'system', content: knowledge });
      } else if (currentMode === 'emotional-assessment') {
        messages.push({ role: 'system', content: 'You are helping the user reflect on their emotional intelligence and communication style.' });
      } else if (currentMode === 'sales-simulation' && currentScenarioKey && scenarios[currentScenarioKey]) {
        const sc = scenarios[currentScenarioKey];
        messages.push({ role: 'system', content: `Act as a healthcare provider for simulation. Background: ${sc.Background}. Goal: ${sc['Goal for Today']}. Respond as this provider would.` });
      }
      // Add previous conversation turns
      conversation.forEach(msg => messages.push(msg));
      try {
        const resp = await fetch(config.workerEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages })
        });
        if (resp.ok) {
          const data = await resp.json();
          // Expect { reply: string }
          const reply = data?.reply || data?.choices?.[0]?.message?.content;
          if (reply) {
            conversation.push({ role: 'assistant', content: reply.trim() });
            renderMessages();
            return;
          }
        }
        throw new Error('Invalid response');
      } catch (err) {
        conversation.push({ role: 'assistant', content: 'I’m sorry, I couldn’t reach the AI service. Please try again later.' });
        renderMessages();
      }
    }

    // Generate simple coach feedback based on the conversation
    function generateCoachFeedback() {
      if (conversation.length === 0) return null;
      // Basic heuristics: count user vs assistant messages
      let tone = 'neutral';
      let worked = 'You engaged with the chat and explored the content.';
      let improve = 'Try asking more specific questions to get detailed answers.';
      let phrasing = 'Use open‑ended questions such as “Can you tell me more about…?” to encourage richer responses.';
      return { tone, 'what worked': worked, 'what to improve': improve, 'suggested stronger phrasing': phrasing };
    }

    // Initial render
    renderMessages();
  }

  async function init() {
    try {
      // When serving from file:// or GitHub Pages the working directory is the
      // project root. Prefix relative paths with './' to ensure they resolve.
      config = await fetchLocal('./assets/chat/config.json');
      systemPrompt = await fetchLocal('./assets/chat/system.md');
      knowledge = await fetchLocal('./assets/chat/about-ei.md');
      const scenarioText = await fetchLocal('./assets/chat/data/hcp_scenarios.txt');
      scenarios = parseScenarios(scenarioText);
      buildUI();
    } catch (err) {
      console.error(err);
      container.textContent = 'Failed to load ReflectivEI Coach. Check the console for details.';
    }
  }
  init();
})();