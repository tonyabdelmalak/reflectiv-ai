// ReflectivAI modernized widget script
//
// This script powers the chat widget on the modernized ReflectivAI site.  It
// preserves the existing public API (init, updateState, send) and dispatches
// CustomEvents (`rw:ready`, `rw:state`, `rw:error`) so that external code
// or analytics listeners can hook into the widget lifecycle.  It preloads
// dropdown options from JSON files if available and falls back to embedded
// defaults to ensure the UI remains functional offline or on network failure.

(() => {
  // Internal state storing dropdown options and selections.  Defaults are
  // provided inline; if remote data exists, it will replace these values.
  const state = {
    personas: [],
    eiFeatures: [],
    scenarios: [],
    coaches: [],
    modes: [
      { key: 'training', label: 'Training' },
      { key: 'assessment', label: 'Assessment' }
    ],
    therapyAreas: [
      { key: 'oncology', label: 'Oncology' },
      { key: 'vaccines', label: 'Vaccines' },
      { key: 'cardiology', label: 'Cardiology' }
    ],
    diseaseStates: [
      { key: 'hiv', label: 'HIV' },
      { key: 'hepb', label: 'Hepatitis B' },
      { key: 'breast_cancer', label: 'Breast Cancer' }
    ],
    hcpProfiles: [
      { key: 'busy_md', label: 'Busy MD' },
      { key: 'collaborative_np', label: 'Collaborative NP' },
      { key: 'skeptical_do', label: 'Skeptical DO' }
    ],
    selections: {}
  };

  /**
   * Attempt to fetch JSON from a relative path.  On failure, return null.
   * @param {string} path
   * @returns {Promise<null|any>}
   */
  async function fetchJSON(path) {
    try {
      const res = await fetch(path);
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      // swallow network errors
    }
    return null;
  }

  /**
   * Preload all data files. If files are unavailable, the function keeps
   * existing fallback values. When complete, a rw:state event is dispatched
   * with the populated state.
   */
  async function preloadData() {
    // Personas
    const personasData = await fetchJSON('data/personas.json');
    if (Array.isArray(personasData)) {
      state.personas = personasData;
    } else {
      // Fallback personas
      state.personas = [
        { key: 'busy_md', label: 'Busy MD', traits: ['time‑poor', 'direct'], prompts: ['Keep it tight'] },
        { key: 'nice_np', label: 'Nice NP', traits: ['warm', 'collaborative'], prompts: ['Empathize first'] }
      ];
    }

    // EI features
    const eiData = await fetchJSON('data/ei-features.json');
    if (Array.isArray(eiData)) {
      state.eiFeatures = eiData;
    } else {
      state.eiFeatures = [
        { key: 'empathy_index', label: 'Empathy Index', rubric: ['0–5 scale'] },
        { key: 'confidence_delta', label: 'Confidence Delta', rubric: ['-2 to +2'] }
      ];
    }

    // Scenarios
    const scenarioData = await fetchJSON('data/scenarios.json');
    if (Array.isArray(scenarioData)) {
      state.scenarios = scenarioData;
    } else {
      state.scenarios = [
        { key: 'hiv_refill_push', personaKey: 'busy_md', diseaseState: 'hiv', title: 'Refill Conversation', brief: 'Short, outcome‑focused', goals: ['Refill OK'], objections: ['No time'] },
        { key: 'vax_hesitant_parent', personaKey: 'nice_np', diseaseState: 'vaccines', title: 'Vaccine Hesitancy', brief: 'Build trust', goals: ['Address concerns'], objections: ['Safety'] }
      ];
    }

    // Coaches
    const coachData = await fetchJSON('data/coaches.json');
    if (Array.isArray(coachData)) {
      state.coaches = coachData;
    } else {
      state.coaches = [
        { key: 'direct', label: 'Direct Coach', style: 'succinct' },
        { key: 'supportive', label: 'Supportive Coach', style: 'encouraging' }
      ];
    }

    // Once all data is loaded, notify listeners
    document.dispatchEvent(new CustomEvent('rw:state', { detail: { ...state } }));
  }

  /**
   * Initialize the widget. This function preloads data and signals readiness
   * once complete. It should be called by external code when the widget
   * container is mounted, but the script will also auto‑init on DOM ready.
   */
  async function init() {
    try {
      await preloadData();
      document.dispatchEvent(new CustomEvent('rw:ready'));
    } catch (err) {
      document.dispatchEvent(new CustomEvent('rw:error', { detail: { code: 'INIT_FAILED', msg: err.message } }));
    }
  }

  /**
   * Merge partial state updates and notify listeners. Use this to update
   * selections when the user chooses options from dropdowns. The function
   * does not re‑fetch data.
   * @param {Object} partial
   */
  function updateState(partial) {
    Object.assign(state.selections, partial);
    document.dispatchEvent(new CustomEvent('rw:state', { detail: { ...state } }));
  }

  /**
   * Send a message to the assistant. In this placeholder, it simply logs
   * the user message. In production, it would call a backend and stream
   * the assistant response. Emits an analytics event for every send.
   * @param {string} text
   */
  function send(text) {
    if (typeof text === 'string' && text.trim() !== '') {
      console.log('User message:', text);
      // Example analytics dispatch (real implementation would push to dataLayer)
      document.dispatchEvent(new CustomEvent('rw:analytics', {
        detail: {
          ts: Date.now(),
          path: window.location.pathname,
          event: 'widget_send',
          props: { messageLength: text.length }
        }
      }));
    }
  }

  // Expose the public API
  window.ReflectivWidget = {
    init,
    updateState,
    send
  };

  // Auto‑init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();