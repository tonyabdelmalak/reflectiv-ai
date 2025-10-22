// assets/chat/ei-context.js
// Loads EI knowledge and builds a system context string for the Coach.

(function () {
  const EI = { loaded: false, text: "", rubric: null, persona: null };

  async function load() {
    if (EI.loaded) return EI;
    const [md, rubric, persona] = await Promise.all([
      fetch("/assets/chat/about-ei.md", { cache: "no-store" }).then(r => r.text()),
      fetch("/assets/chat/config.json", { cache: "no-store" }).then(r => r.json()).catch(() => null),
      fetch("/assets/chat/persona.json", { cache: "no-store" }).then(r => r.json()).catch(() => null),
    ]);
    EI.text = md;
    EI.rubric = rubric;
    EI.persona = persona;
    EI.loaded = true;
    return EI;
  }

  // Build a compact system block. Truncate to keep tokens sane.
  async function getSystemExtras() {
    await load();
    const md = EI.text.slice(0, 7000); // safe chunk
    const rubric = EI.rubric ? JSON.stringify(EI.rubric).slice(0, 4000) : "{}";
    const persona = EI.persona ? JSON.stringify(EI.persona).slice(0, 2000) : "{}";

    return [
      "### EI KNOWLEDGEBASE (doctrine for coaching)",
      md,
      "### EI RUBRIC (markers/weights; obey if present)",
      rubric,
      "### PERSONA RAILS",
      persona,
      "### COACH OUTPUT SPEC",
      "Respond as coach. Then return <EIMETA>{ack,warmth,clarity,regulation,compliance,question_ratio,next_step,risk}</EIMETA>."
    ].join("\n");
  }

  window.EIContext = { load, getSystemExtras };
})();
