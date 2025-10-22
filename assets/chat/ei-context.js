// assets/chat/ei-context.js
// Loads EI knowledgebase and builds a system context block for the Reflectiv Coach.
// Works on GitHub Pages (uses relative paths, no leading slash).

(function () {
  const EI = { loaded: false, text: "", rubric: null, persona: null };

  // ---- Load all EI resources (Markdown, rubric, persona) ----
  async function load() {
    if (EI.loaded) return EI;
    const [md, rubric, persona] = await Promise.all([
      fetch("assets/chat/about-ei.md", { cache: "no-store" })
        .then(r => r.text())
        .catch(() => "EI knowledgebase not found."),
      fetch("assets/chat/config.json", { cache: "no-store" })
        .then(r => r.json())
        .catch(() => null),
      fetch("assets/chat/persona.json", { cache: "no-store" })
        .then(r => r.json())
        .catch(() => null),
    ]);
    EI.text = md;
    EI.rubric = rubric;
    EI.persona = persona;
    EI.loaded = true;
    return EI;
  }

  // ---- Build compact system context string for the AI Coach ----
  async function getSystemExtras() {
    await load();
    const md = EI.text.slice(0, 7000); // limit to safe token length
    const rubric = EI.rubric ? JSON.stringify(EI.rubric).slice(0, 4000) : "{}";
    const persona = EI.persona ? JSON.stringify(EI.persona).slice(0, 2000) : "{}";

    return [
      "### EI KNOWLEDGEBASE (ReflectivAI Emotional Intelligence Doctrine)",
      md,
      "### EI RUBRIC (Behavioral markers and weighting schema)",
      rubric,
      "### PERSONA RAILS (Contextual tone/behavior modifiers)",
      persona,
      "### COACH OUTPUT SPEC",
      "Respond as Reflectiv Coach integrating EI context. " +
      "Frame all guidance with empathy, clarity, and behavioral insight. " +
      "Return <EIMETA>{ack,warmth,clarity,regulation,compliance,question_ratio,next_step,risk}</EIMETA>."
    ].join("\n");
  }

  // Expose globally
  window.EIContext = { load, getSystemExtras };
})();
