/* widget.js
 * ReflectivAI Chat/Coach — drop-in (coach-v2, deterministic scoring v3)
 * Modes: emotional-assessment | product-knowledge | sales-simulation | role-play
 * PROACTIVE SAFEGUARDS:
 * - duplicate-cycle guard (ring buffer)        - double-send lock
 * - Enter throttling                           - stricter HCP-only sanitizer & leak detection
 * - fixes malformed “walk me through …”        - conversation trimming
 * - empty-reply fallback                       - time-outed model calls
 * - length clamps                              - anti-echo of the user’s text
 */
(function () {
  // ---------- safe bootstrapping ----------
  let mount = null;

  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function waitForMount(cb) {
    const findMount = () =>
      document.getElementById("reflectiv-widget") ||
      document.querySelector("#coach-widget, [data-coach-mount], .reflectiv-widget");

    const tryGet = () => {
      mount = findMount();
      if (mount) return cb();

      const obs = new MutationObserver(() => {
        mount = findMount();
        if (mount) {
          obs.disconnect();
          cb();
        }
      });

      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => obs.disconnect(), 15000);
    };

    onReady(tryGet);
  }

  // ---------- config/state ----------
  const LC_OPTIONS = ["Emotional Intelligence", "Product Knowledge", "Sales Simulation", "Role Play"];
  const LC_TO_INTERNAL = {
    "Emotional Intelligence": "emotional-assessment",
    "Product Knowledge": "product-knowledge",
    "Sales Simulation": "sales-simulation",
    "Role Play": "role-play"
  };

  let cfg = null;
  let systemPrompt = "";
  let eiHeuristics = "";
  let scenarios = [];
  let scenariosById = new Map();

  let currentMode = "sales-simulation";
  let currentScenarioId = null;
  let conversation = [];
  let coachOn = true;

  // ---------- EI globals ----------
  let personaSelectElem = null;
  let eiFeatureSelectElem = null;
  let feedbackDisplayElem = null;
  let personaLabelElem = null;
  let featureLabelElem = null;
  let lastUserMessage = "";

  // ---------- Rep-only eval panel store ----------
  let repOnlyPanelHTML = "";

  // ---------- EI defaults ----------
  const DEFAULT_PERSONAS = [
    { key: "difficult", label: "Difficult HCP" },
    { key: "busy", label: "Busy HCP" },
    { key: "engaged", label: "Engaged HCP" },
    { key: "indifferent", label: "Indifferent HCP" }
  ];
  const DEFAULT_EI_FEATURES = [
    { key: "empathy", label: "Empathy Rating" },
    { key: "stress", label: "Stress Level Indicator" },
    { key: "listening", label: "Active Listening Hints" },
    { key: "validation", label: "Validation & Reframing Tips" }
  ];

  // ---------- utils ----------
  async function fetchLocal(path) {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(`Failed to load ${path} (${r.status})`);
    const ct = r.headers.get("content-type") || "";
    return ct.includes("application/json") ? r.json() : r.text();
  }

  const esc = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  function sanitizeLLM(raw) {
    let s = String(raw || "");
    s = s.replace(/```[\s\S]*?```/g, "");
    s = s.replace(/<pre[\s\S]*?<\/pre>/gi, "");
    s = s.replace(/^\s*#{1,6}\s+/gm, "");
    s = s.replace(/^\s*(hi|hello|hey)[^\n]*\n+/i, "");
    s = s.replace(/\n{3,}/g, "\n\n").trim();
    return s;
  }

  function clampLen(s, max) {
    s = String(s || "");
    if (s.length <= max) return s;
    return s.slice(0, max).replace(/\s+\S*$/, "").trim() + "…";
  }

  // sentence helpers
  function splitSentences(text) {
    const t = String(text || "");
    return t.replace(/\s+/g, " ").match(/[^.!?]+[.!?]?/g) || [];
  }

  // --- shared leak patterns
  const BRAND_RE = /\b(descovy|biktarvy|cabenuva|truvada|prep)\b/i;
  const PROMO_ARTIFACTS_RE =
    /\b(educational (resources?|materials?)|training session|in-?service|lunch-?and-?learn|handout|one-?pager|brochure|leave-?behind|job aid|script|slide deck|webinar|office hours)\b/i;
  const FIRST_PERSON_OFFER_RE =
    /\b((?:i|we)\s+(?:can\s+)?(?:provide|offer|arrange|conduct|deliver|send|share|supply|set up|schedule|organize|host|walk (?:you|your team) through|train|educate))\b/i;
  const OFFER_OR_TRAINING_WORD_RE =
    /\b(offer|provide|train|training|educate|education|materials?|resources?|handouts?|brochures?|one-?pagers?|scripts?)\b/i;

  // ---------- Role-play sanitizer ----------
  function sanitizeRolePlayOnly(text) {
    let s = String(text || "");

    // drop everything after accidental <coach>
    const coachIdx = s.indexOf("<coach>");
    if (coachIdx >= 0) s = s.slice(0, coachIdx);

    s = s.replace(/<coach>[\s\S]*?<\/coach>/gi, "");
    s = s.replace(
      /(?:^|\n)\s*(?:\*\*)?\s*(?:Sales\s*Guidance|Challenge|(?:My|Rep)\s*Approach|Impact)\s*(?:\*\*)?\s*:\s*[\s\S]*?(?=\n\s*\n|$)/gmi,
      ""
    );

    // strip speaker/meta
    s = s.replace(/^(?:Assistant|Coach|System|Rep|User|Sales Rep)\s*:\s*/gmi, "");
    s = s.replace(/^\s*["“']?\s*(hi|hello|hey)\b.*$/gmi, "");

    // markdown cleanup
    s = s.replace(/^\s*[-*]\s+/gm, "");
    s = s.replace(/^\s*#{1,6}\s+.*$/gm, "");
    s = s.replace(/^\s*>\s?/gm, "");

    // POV convert “your clinic” nouns
    const nouns =
      "(patients?|panel|clinic|practice|workflow|nurses?|staff|team|MA|MAs|prescribing|prescriptions|criteria|approach)";
    s = s.replace(new RegExp(`\\byour\\s+${nouns}\\b`, "gi"), (m) => m.replace(/\byour\b/i, "my"));

    const IMPERATIVE_START =
      /^(ask|emphasize|consider|provide|offer|educate|ensure|recommend|suggest|discuss|address|reinforce|encourage|support)\b/i;

    const sentences = splitSentences(s)
      .map((sentRaw) => {
        let sent = sentRaw.trim();
        if (!sent) return "";

        const isQ = /\?\s*$/.test(sent);
        const hasYou = /\byou(r)?\b/i.test(sent);
        const repDiscoveryCue =
          /(how\s+do\s+you|can\s+we\s+review\s+your|can\s+you\s+(?:share|explain|present|go over)|help\s+me\s+understand\s+your|what\s+do\s+you\s+do|how\s+are\s+you\s+identif|walk\s+me\s+through)/i.test(
            sent
          );

        // Normalize rep-facing asks to HCP statements
        if (isQ && (hasYou || /walk\s+me\s+through/i.test(sent)) && repDiscoveryCue) {
          sent = sent
            .replace(/\bcan\s+we\s+review\s+your\s+approach\b/i, "In my clinic, we review our approach")
            .replace(/\bhow\s+do\s+you\s+identif(?:y|ies)\b/gi, "Here is how I identify")
            .replace(/\bhelp\s+me\s+understand\s+your\b/gi, "I consider my")
            .replace(/\b(can|could)\s+you\s+(share|explain|present|go over)\b/gi, "I would like to review")
            .replace(/\bwalk\s+me\s+through\b/gi, "review")
            .replace(/\byour\b/gi, "my")
            .replace(/\byou\b/gi, "I")
            .replace(/\?\s*$/, ".")
            .trim();
        }

        // convert imperative openings to first-person
        if (IMPERATIVE_START.test(sent)) {
          const rest = sent.replace(IMPERATIVE_START, "").replace(/^[:,\s]+/, "");
          sent = `In my clinic, I ${rest}`.replace(/\?\s*$/, ".").trim();
        }

        // rewrite first-person offers or training talk
        if (FIRST_PERSON_OFFER_RE.test(sent) || (/(?:^|\b)(?:i|we)\b/i.test(sent) && OFFER_OR_TRAINING_WORD_RE.test(sent))) {
          sent =
            "In my clinic, I rely on our internal processes and current guidelines; my focus is on patient selection and follow-up.";
        }

        // repair malformed pronouns from rewrites
        sent = sent
          .replace(/\bcan\s+i\s+walk\s+me\s+through\b/gi, "I would like to review")
          .replace(/\bi\s+walk\s+me\s+through\b/gi, "I review")
          .replace(/\bwalk\s+me\s+through\b/gi, "review")
          .replace(/\bcan\s+i\s+(share|explain|present|go\s+over)\b/gi, "I would like to review");

        if (/I would like to review/i.test(sent)) sent = sent.replace(/\?\s*$/, ".").trim();

        return sent;
      })
      .filter(Boolean);

    s = sentences.join(" ").trim();

    // de-coachify generic prompts
    s = s.replace(/\bcan you tell me\b/gi, "I’m considering");
    s = s.replace(/\bhelp me understand\b/gi, "I want to understand");
    s = s.replace(/\bwhat would it take to\b/gi, "Here’s what I’d need to");

    s = s.replace(/\*\*(?=\s|$)/g, "");
    s = s.replace(/^[“"']|[”"']$/g, "");
    s = s.replace(/\s{2,}/g, " ").trim();

    if (!s) s = "From my perspective, we evaluate high-risk patients using history, behaviors, and adherence context.";
    return s;
  }

  // --------- COACH/GUIDANCE LEAK GUARD (Role Play only) ----------
  function isGuidanceLeak(txt) {
    const t = String(txt || "");

    const imperativeStart =
      /(?:^|\s[.“"'])\s*(ask|emphasize|consider|provide|offer|educate|ensure|recommend|suggest|discuss|address|reinforce|encourage|support)\b/i;

    const secondPersonGuidance = /\b(emphasize|ensure|educate|recommend|suggest|encourage|support|provide|offer)\b.*\b(you|your)\b/i;

    const cues = [
      /\b(you should|you can|i recommend|i suggest|best practice|here'?s how|you’ll want to)\b/i,
      /\b(coaching|guidance|sales guidance|coach)\b/i,
      secondPersonGuidance,
      /^[-*]\s/m,
      /<coach>|\bworked:|\bimprove:/i,
      imperativeStart
    ];

    const generalHits = cues.filter((re) => re.test(t)).length >= 2;

    const offerHit =
      FIRST_PERSON_OFFER_RE.test(t) ||
      ((/^(?:i|we)\b/i.test(t)) && OFFER_OR_TRAINING_WORD_RE.test(t) && /staff|team|your\s+staff/i.test(t));

    const artifactHit = PROMO_ARTIFACTS_RE.test(t) || BRAND_RE.test(t);

    return generalHits || offerHit || artifactHit;
  }

  function correctiveRails(sc) {
    const personaLine =
      sc && (sc.hcpRole || sc.label)
        ? `HCP Persona: ${sc.hcpRole || sc.label}. Disease: ${sc.therapeuticArea || sc.diseaseState || "—"}.`
        : "";
    return [
      `Rewrite strictly as the HCP.`,
      `First-person. 2–5 sentences. No advice to the rep. No “you/your” guidance.`,
      `No lists, no headings, no rubric, no JSON, no "<coach>".`,
      `Do not make offers like "I can provide/offer/arrange training, resources, handouts, or scripts," and do not propose to educate the rep or their staff.`,
      `Describe your own clinical approach. If you ask a question, it must be about your clinic/patients.`,
      personaLine
    ].join("\n");
  }

  async function enforceHcpOnly(replyText, sc, messages, callModelFn) {
    let out = sanitizeRolePlayOnly(replyText);
    if (!isGuidanceLeak(out)) return out;

    // Pass 1: rewrite under stricter rails
    const rewriteMsgs = [
      { role: "system", content: correctiveRails(sc) },
      { role: "user", content: out }
    ];
    try {
      const r1 = await callModelFn(rewriteMsgs);
      out = sanitizeRolePlayOnly(r1);
      if (!isGuidanceLeak(out)) return out;
    } catch (_) {}

    // Pass 2: fresh completion with corrective rails prepended to original convo
    try {
      const hardened = [{ role: "system", content: correctiveRails(sc) }, ...messages];
      const r2 = await callModelFn(hardened);
      out = sanitizeRolePlayOnly(r2);
      if (!isGuidanceLeak(out)) return out;
    } catch (_) {}

    // Pass 3: last-ditch strip
    out = out.replace(
      new RegExp(
        String.raw`(?:^|\s)(?:I|We)\s+(?:can\s+)?(?:provide|offer|arrange|conduct|deliver|send|share|supply|set up|schedule|organize|host|walk (?:you|your team) through|train|educate)\b[^.!?]*[.!?]\s*`,
        "gi"
      ),
      ""
    );
    out = out.replace(new RegExp(String.raw`${PROMO_ARTIFACTS_RE.source}[^.!?]*[.!?]\s*`, "gi"), "");
    out = out
      .replace(/\b(i recommend|i suggest|consider|you should|you can|best practice)\b[^.!?]*[.!?]\s*/gi, "")
      .replace(/\b(emphasize|ensure|educate|recommend|suggest|encourage|support|provide|offer)\b[^.!?]*\b(you|your)\b[^.!?]*[.!?]\s*/gi, "")
      .replace(
        /^(ask|emphasize|consider|provide|offer|educate|ensure|recommend|suggest|discuss|address|reinforce|encourage|support)\b[^.!?]*[.!?]\s*/gim,
        ""
      )
      .trim();

    if (!out) {
      const variants = [
        "From my perspective, we review patient histories and behaviors to understand risk patterns.",
        "In my clinic, we evaluate adherence and lifestyle to assess patient risk.",
        "I typically consider history, behavior, and adherence when identifying high-risk patients."
      ];
      out = variants[Math.floor(Math.random() * variants.length)];
    }
    return out;
  }

  // --- label normalizer: convert any “My Approach” text to “Rep Approach”
  function normalizeGuidanceLabels(text) {
    if (!text) return "";
    return String(text).replace(/\bMy\s*Approach\b/gi, "Rep Approach");
  }

  function md(text) {
    if (!text) return "";
    let s = esc(String(text)).replace(/\r\n?/g, "\n");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(
      /^(?:-\s+|\*\s+).+(?:\n(?:-\s+|\*\s+).+)*/gm,
      (blk) => {
        const items = blk
          .split("\n")
          .map((l) => l.replace(/^(?:-\s+|\*\s+)(.+)$/, "<li>$1</li>"))
          .join("");
        return `<ul>${items}</ul>`;
      }
    );
    return s
      .split(/\n{2,}/)
      .map((p) => (p.startsWith("<ul>") ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`))
      .join("\n");
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // --- robust extractor: tolerates missing </coach> and truncation
  function extractCoach(raw) {
    const s = String(raw || "");
    const openIdx = s.indexOf("<coach>");
    if (openIdx === -1) return { coach: null, clean: sanitizeLLM(s) };

    const head = s.slice(0, openIdx);
    const tail = s.slice(openIdx + "<coach>".length);

    const closeIdx = tail.indexOf("</coach>");
    let block = closeIdx >= 0 ? tail.slice(0, closeIdx) : tail;

    const braceStart = block.indexOf("{");
    if (braceStart === -1) return { coach: null, clean: sanitizeLLM(head) };

    let depth = 0, end = -1;
    for (let i = braceStart; i < block.length; i++) {
      const ch = block[i];
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    if (end === -1) return { coach: null, clean: sanitizeLLM(head) };

    // parse JSON inside <coach>…</coach>
    const jsonTxt = block.slice(braceStart, end + 1);
    let coach = {};
    try {
      coach = JSON.parse(jsonTxt);
    } catch (e) {
      console.warn("Coach JSON parse error", e);
    }
    const after = closeIdx >= 0 ? tail.slice(closeIdx + "</coach>".length) : "";
    const clean = sanitizeLLM((head + " " + after).trim());
    return { coach, clean };
  }

  // ---------- local scoring (deterministic v3) ----------
  function scoreReply(userText, replyText) {
    const text = String(replyText || "");
    const t = text.toLowerCase();
    const words = text.split(/\s+/).filter(Boolean).length;
    const endsWithQ = /\?\s*$/.test(text);
    const inRange = (n, a, b) => n >= a && n <= b;

    const sig = {
      label: /(per label|fda\s*label|indication|contraindication|boxed warning|guideline|fda)/i.test(text),
      discovery: endsWithQ || /(how|what|could you|can you|help me understand|walk me|clarify)\b/i.test(t),
      objection: /(concern|barrier|risk|coverage|auth|denied|cost|workflow|adherence|side effect|safety)/i.test(t),
      empathy: /(i understand|appreciate|given your time|thanks for|i hear|it sounds like)/i.test(t),
      accuracyCue:
        /(renal|egfr|creatinine|bmd|resistance|ddi|interaction|efficacy|safety|adherence|formulary|access|prior auth|prep|tdf|taf|bictegravir|cabotegravir|rilpivirine|descovy|biktarvy|cabenuva)/i.test(
          t
        ),
      tooLong: words > 220,           // widened for Sales Simulation
      idealLen: inRange(words, 45, 160)
    };

    const accuracy = sig.accuracyCue ? (sig.label ? 5 : 4) : 3;
    const compliance = sig.label ? 5 : 3;
    const discovery = sig.discovery ? 4 : 2;
    const objection_handling = sig.objection ? (sig.accuracyCue ? 4 : 3) : 2;
    const empathy = sig.empathy ? 3 : 2;
    const clarity = sig.tooLong ? 2 : sig.idealLen ? 4 : 3;

    const W = { accuracy: 0.26, compliance: 0.22, discovery: 0.16, objection_handling: 0.14, clarity: 0.12, empathy: 0.1 };
    const toPct = (v) => v * 20;

    let overall =
      toPct(accuracy) * W.accuracy +
      toPct(compliance) * W.compliance +
      toPct(discovery) * W.discovery +
      toPct(objection_handling) * W.objection_handling +
      toPct(clarity) * W.clarity +
      toPct(empathy) * W.empathy;
    if (sig.idealLen) overall += 3;
    if (endsWithQ) overall += 3;
    if (sig.tooLong) overall -= 6;
    overall = Math.max(0, Math.min(100, Math.round(overall)));

    // --- present-tense feedback text for yellow panel
    const worked = [
      sig.empathy ? "Acknowledge HCP context" : null,
      sig.discovery ? "Close with a clear discovery question" : null,
      sig.label ? "Reference label or guidelines" : null,
      sig.accuracyCue ? "Tie points to clinical cues" : null
    ].filter(Boolean);

    const improve = [
      sig.tooLong ? "Keep to 3–5 sentences" : null,
      sig.discovery ? null : "End with one specific question",
      sig.label ? null : "Anchor claims to label or guideline",
      clarity < 4 ? "Use one idea per sentence" : null
    ].filter(Boolean);

    const phrasing = sig.discovery
      ? "Given your criteria, which patients would be the best fit to start, and what would help you try one this month?"
      : "Would it help to align on eligibility criteria and agree on one next step for your earliest appropriate patient?";

    return {
      overall,
      scores: { accuracy, empathy, clarity, compliance, discovery, objection_handling },
      feedback:
        "Be concise, cite label or guidelines for clinical points, ask one focused discovery question, and propose a concrete next step.",
      worked,
      improve,
      phrasing,
      context: { rep_question: String(userText || ""), hcp_reply: String(replyText || "") },
      score: overall,
      subscores: { accuracy, empathy, clarity, compliance, discovery, objection_handling }
    };
  }

  // ---------- EI scoring ----------
  function calculateEmpathyRating(personaKey, message) {
    if (!message) return 0;
    const text = String(message || "").toLowerCase();
    let score = 0;
    switch (personaKey) {
      case "difficult":
        score = 1;
        break;
      case "busy":
        score = 2;
        break;
      case "engaged":
        score = 4;
        break;
      case "indifferent":
        score = 3;
        break;
      default:
        score = 3;
    }
    const empathyKeywords = [
      "understand",
      "appreciate",
      "concern",
      "feel",
      "sorry",
      "hear",
      "sounds like",
      "empathize",
      "thanks",
      "acknowledge"
    ];
    empathyKeywords.forEach((kw) => {
      if (text.includes(kw)) score++;
    });
    return Math.min(5, score);
  }

  function calculateStressRating(personaKey, message) {
    if (!message) return 0;
    const text = String(message || "").toLowerCase();
    let score = 0;
    switch (personaKey) {
      case "difficult":
        score = 4;
        break;
      case "busy":
        score = 5;
        break;
      case "engaged":
        score = 2;
        break;
      case "indifferent":
        score = 3;
        break;
      default:
        score = 3;
    }
    const stressWords = ["stress", "busy", "overwhelmed", "frustrated", "tired", "pressure", "deadline"];
    stressWords.forEach((kw) => {
      if (text.includes(kw)) score++;
    });
    return Math.min(5, score);
  }

  // ---------- EI feedback text ----------
  function generateDynamicFeedback(personaKey, featureKey) {
    if (!personaKey || !featureKey) return "";
    let feedback = "";

    if (featureKey === "empathy") {
      switch (personaKey) {
        case "difficult":
          feedback = "Acknowledge frustration and keep voice calm. Use short validating phrases before you propose next steps.";
          break;
        case "busy":
          feedback = "Empathize in one line, then get to the point. Lead with the outcome and time saved.";
          break;
        case "engaged":
          feedback = "Reinforce collaboration. Thank them for input and ask one specific next question.";
          break;
        case "indifferent":
          feedback = "Validate neutrality, then pivot to patient impact and one meaningful benefit.";
          break;
        default:
          feedback = "Match tone to the HCP and show you understand their context before offering guidance.";
      }
    } else if (featureKey === "stress") {
      switch (personaKey) {
        case "difficult":
          feedback = "Stress likely high. Keep it brief and reassuring. Remove jargon.";
          break;
        case "busy":
          feedback = "Time pressure high. Bottom line first. Offer one low-effort next step.";
          break;
        case "engaged":
          feedback = "Moderate stress. Provide clear info and invite collaboration.";
          break;
        case "indifferent":
          feedback = "Average stress. Build rapport through patient-centered framing.";
          break;
        default:
          feedback = "Adjust tone to stress level. Reduce cognitive load and give clear choices.";
      }
    } else if (featureKey === "listening") {
      switch (personaKey) {
        case "difficult":
          feedback = "Reflect back their words. Confirm you got it right, then ask a short clarifier.";
          break;
        case "busy":
          feedback = "Summarize their point in one sentence. Ask one yes or no clarifier.";
          break;
        case "engaged":
          feedback = "Affirm insights and build on them. Use clarifying questions to deepen trust.";
          break;
        case "indifferent":
          feedback = "Use light affirmations to draw them in. Ask a simple patient-impact question.";
          break;
        default:
          feedback = "Use reflective and clarifying questions. Keep it concise.";
      }
    } else if (featureKey === "validation") {
      switch (personaKey) {
        case "difficult":
          feedback = "Validate frustration first. Reframe around shared goals and patient outcomes.";
          break;
        case "busy":
          feedback = "Validate time constraints. Reframe to efficiency and workflow fit.";
          break;
        case "engaged":
          feedback = "Validate expertise. Reframe to partnership and quick experimentation.";
          break;
        case "indifferent":
          feedback = "Validate neutrality. Reframe to meaningful benefits for a typical patient.";
          break;
        default:
          feedback = "Validate perspective and reframe to collaboration and patient value.";
      }
    } else {
      feedback = "Select a valid EI feature for targeted guidance.";
    }

    return feedback;
  }

  // ---------- EI feedback render ----------
  function generateFeedback() {
    if (!feedbackDisplayElem) return;

    if (currentMode !== "emotional-assessment") {
      feedbackDisplayElem.innerHTML = "";
      return;
    }

    const personaKey = personaSelectElem && personaSelectElem.value;
    const featureKey = eiFeatureSelectElem && eiFeatureSelectElem.value;

    if (!personaKey || !featureKey || !lastUserMessage) {
      feedbackDisplayElem.innerHTML = `<span class="muted">Select a persona and EI feature, then send a message to see feedback.</span>`;
      return;
    }

    let rating = null;
    if (featureKey === "empathy") rating = calculateEmpathyRating(personaKey, lastUserMessage);
    else if (featureKey === "stress") rating = calculateStressRating(personaKey, lastUserMessage);

    const featureList = (cfg?.eiFeatures && cfg.eiFeatures.length ? cfg.eiFeatures : DEFAULT_EI_FEATURES);
    const featureObj = featureList.find((f) => f.key === featureKey || f.value === featureKey || f.id === featureKey);
    const featureLabel = featureObj ? featureObj.label || featureKey : featureKey;
    const fbTxt = generateDynamicFeedback(personaKey, featureKey);

    feedbackDisplayElem.innerHTML =
      rating == null
        ? `<strong>${esc(featureLabel)}</strong><br><p>${esc(fbTxt)}</p>`
        : `<strong>${esc(featureLabel)}: ${rating}/5</strong><br><p>${esc(fbTxt)}</p>`;
  }

  // ---------- persona context ----------
  function currentPersonaHint() {
    const sc = scenariosById.get(currentScenarioId);
    if (sc && (sc.hcpRole || sc.label)) {
      const dz = sc.therapeuticArea || sc.diseaseState || "—";
      const who = sc.hcpRole || sc.label;
      return `HCP Persona: ${who}. Disease: ${dz}.`;
    }
    const p = personaSelectElem && personaSelectElem.value;
    if (p) return `HCP Persona: ${p}.`;
    return "";
  }

  // ---------- prompt preface ----------
  function buildPreface(mode, sc) {
    const COMMON = `# ReflectivAI — Output Contract
Return exactly two parts. No code blocks. No markdown headings.
1) Sales Guidance: short, actionable, accurate guidance.
2) <coach>{
     "overall": 0-100,
     "scores": { "accuracy":0-5,"empathy":0-5,"clarity":0-5,"compliance":0-5,"discovery":0-5,"objection_handling":0-5 },
     "worked": ["…"],
     "improve": ["…"],
     "phrasing": "…",
     "feedback": "one concise paragraph",
     "context": { "rep_question":"...", "hcp_reply":"..." }
   }</coach>`;

    const personaLine = currentPersonaHint();

    if (mode === "sales-simulation") {
      return (
        `# Role
You are a virtual pharma coach. Be direct, label-aligned, and safe.

# Scenario
${personaLine}
${
  sc
    ? [
        `Therapeutic Area: ${sc.therapeuticArea || "—"}`,
        `HCP Role: ${sc.hcpRole || "—"}`,
        `Background: ${sc.background || "—"}`,
        `Today’s Goal: ${sc.goal || "—"}`
      ].join("\n")
    : ""
}

# Style
- 4–8 sentences and one closing question.
- Only appropriate, publicly known, label-aligned facts.
- No pricing advice or PHI. No off-label.
- Include a clearly labeled "Suggested Phrasing:" section as part of the chat response.

${COMMON}`
      ).trim();
    }

    if (mode === "product-knowledge") {
      return `Return a concise educational overview with reputable citations. Structure: key takeaways; mechanism/indications; safety/contraindications; efficacy; access notes; references.`.trim();
    }

    if (mode === "role-play") {
      return (
        `# Role Play Contract — HCP Only
You are the Healthcare Provider. Reply ONLY as the HCP. First-person. Realistic, concise clinical dialogue.
${personaLine}
If the user types "Evaluate this exchange" or "Give feedback", step out of role and return EI-based reflection.

Hard bans:
- Do NOT output coaching, rubrics, scores, JSON, or any "<coach>" block.
- Do NOT output headings or bullet lists.
- Do NOT ask the rep about the rep’s process, approach, or clinic metrics.
- Do NOT interview the rep with sales-discovery prompts.
- Do NOT make offers like "I can provide/offer/arrange training, resources, handouts, or scripts," and do NOT propose to educate the rep or their staff.
- Do NOT propose support, resources, training, education, materials, webinars, or handouts for the rep or their staff.

Allowable questions from HCP:
- Clarify therapy, safety, logistics, coverage, workflow impact.
- Questions must reflect HCP’s POV (“my clinic”, “my patients”, “our team”).

Output only the HCP utterance.`
      ).trim();
    }

    // emotional-assessment
    return (
      `Provide brief self-reflection tips tied to HCP communication.
- 3–5 sentences, then one reflective question.

${COMMON}`
    ).trim();
  }

  // ---------- UI ----------
  function buildUI() {
    mount.innerHTML = "";
    if (!mount.classList.contains("cw")) mount.classList.add("cw");

    const STYLE_ID = "reflectiv-widget-inline-style";
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
#reflectiv-widget .reflectiv-chat{display:flex;flex-direction:column;gap:12px;border:3px solid #bfc7d4;border-radius:14px;background:#fff;overflow:hidden}
#reflectiv-widget .chat-toolbar{display:block;padding:14px 16px;background:#f6f8fb;border-bottom:1px solid #e1e6ef}
#reflectiv-widget .sim-controls{display:grid;grid-template-columns:220px 1fr 220px 1fr;gap:12px 16px;align-items:center}
#reflectiv-widget .sim-controls label{font-size:13px;font-weight:600;color:#2f3a4f;justify-self:end;white-space:nowrap}
#reflectiv-widget .sim-controls select{width:100%;height:38px;padding:6px 10px;font-size:14px;border:1px solid #cfd6df;border-radius:8px;background:#fff}
#reflectiv-widget .chat-messages{min-height:220px;height:auto;max-height:none;overflow:auto;padding:12px 14px;background:#fafbfd}
#reflectiv-widget .message{margin:8px 0;display:flex}
#reflectiv-widget .message.user{justify-content:flex-end}
#reflectiv-widget .message.assistant{justify-content:flex-start}
#reflectiv-widget .message .content{max-width:85%;line-height:1.45;font-size:14px;padding:10px 12px;border-radius:14px;border:1px solid #d6dbe3;color:#0f1522;background:#e9edf3}
#reflectiv-widget .message.user .content{background:#e0e0e0;color:#000}
#reflectiv-widget .chat-input{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #e1e6ef;background:#fff}
#reflectiv-widget .chat-input textarea{flex:1;resize:none;min-height:44px;max-height:120px;padding:10px 12px;border:1px solid #cfd6df;border-radius:10px;outline:none}
#reflectiv-widget .chat-input .btn{min-width:86px;border:0;border-radius:999px;background:#2f3a4f;color:#fff;font-weight:600}
#reflectiv-widget .coach-section{margin-top:0;padding:12px 14px;border:1px solid #e1e6ef;border-radius:12px;background:#fffbe8}
#reflectiv-widget .coach-subs .pill{display:inline-block;padding:2px 8px;margin-right:6px;font-size:12px;background:#f1f3f7;border:1px solid #d6dbe3;border-radius:999px}
#reflectiv-widget .scenario-meta .meta-card{padding:10px 12px;background:#f7f9fc;border:1px solid #e1e6ef;border-radius:10px}
#reflectiv-widget .hidden{display:none!important}
#reflectiv-widget .speaker{display:inline-block;margin:0 0 6px 2px;padding:2px 8px;font-size:11px;font-weight:700;border-radius:999px;border:1px solid #cfd6df}
#reflectiv-widget .speaker.hcp{background:#eef4ff;color:#0f2a6b;border-color:#c9d6ff}
#reflectiv-widget .speaker.rep{background:#e8fff2;color:#0b5a2a;border-color:#bfeacc}
#reflectiv-widget .speaker.coach{background:#fff0cc;color:#5a3d00;border-color:#ffe3a1}
@media (max-width:900px){#reflectiv-widget .sim-controls{grid-template-columns:1fr;gap:8px}#reflectiv-widget .sim-controls label{justify-self:start}}
@media (max-width:520px){#reflectiv-widget .chat-messages{height:46vh}}
      `;
      document.head.appendChild(style);
    }

    // shell + skeleton
    const shell = el("div", "reflectiv-chat");
    shell.innerHTML = `
      <div class="chat-toolbar"><div class="sim-controls"></div></div>
      <div class="scenario-meta"></div>
      <div class="chat-messages">
        <div class="message assistant"><div class="content">Loading ReflectivAI Coach…</div></div>
      </div>
      <div class="chat-input">
        <textarea placeholder="Type your message…"></textarea>
        <button class="btn">Send</button>
      </div>
    `;
    mount.appendChild(shell);

    // rebuild real UI
    const bar = el("div", "chat-toolbar");
    const simControls = el("div", "sim-controls");

    const lcLabel = el("label", "", "Learning Center");
    lcLabel.htmlFor = "cw-mode";
    const modeSel = el("select");
    modeSel.id = "cw-mode";
    LC_OPTIONS.forEach((name) => {
      const o = el("option");
      o.value = name;
      o.textContent = name;
      modeSel.appendChild(o);
    });
    const initialLc =
      Object.keys(LC_TO_INTERNAL).find((k) => LC_TO_INTERNAL[k] === (cfg?.defaultMode || "sales-simulation")) ||
      "Sales Simulation";
    modeSel.value = initialLc;
    currentMode = LC_TO_INTERNAL[modeSel.value];

    const coachLabel = el("label", "", "Coach");
    coachLabel.htmlFor = "cw-coach";
    const coachSel = el("select");
    coachSel.id = "cw-coach";
    [
      { v: "on", t: "Coach On" },
      { v: "off", t: "Coach Off" }
    ].forEach(({ v, t }) => {
      const o = el("option");
      o.value = v;
      o.textContent = t;
      coachSel.appendChild(o);
    });
    coachSel.value = coachOn ? "on" : "off";
    coachSel.onchange = () => {
      coachOn = coachSel.value === "on";
      renderCoach();
    };

    const diseaseLabel = el("label", "", "Disease State");
    diseaseLabel.htmlFor = "cw-disease";
    const diseaseSelect = el("select");
    diseaseSelect.id = "cw-disease";

    const hcpLabel = el("label", "", "HCP Profiles");
    hcpLabel.htmlFor = "cw-hcp";
    const hcpSelect = el("select");
    hcpSelect.id = "cw-hcp";

    // EI Persona/EI Feature
    const personaLabel = el("label", "", "HCP Persona");
    personaLabel.htmlFor = "cw-ei-persona";
    const personaSelect = el("select");
    personaSelect.id = "cw-ei-persona";
    personaSelectElem = personaSelect;
    personaLabelElem = personaLabel;
    personaSelect.addEventListener("change", generateFeedback);

    const featureLabel = el("label", "", "EI Feature");
    featureLabel.htmlFor = "cw-ei-feature";
    const featureSelect = el("select");
    featureSelect.id = "cw-ei-feature";
    eiFeatureSelectElem = featureSelect;
    featureLabelElem = featureLabel;
    featureSelect.addEventListener("change", generateFeedback);

    const PERSONAS_ALL =
      Array.isArray(cfg?.eiProfiles) && cfg.eiProfiles.length ? cfg.eiProfiles : DEFAULT_PERSONAS;

    const FEATURES_ALL_RAW =
      (Array.isArray(cfg?.eiFeatures) && cfg.eiFeatures.length && cfg.eiFeatures) ||
      (Array.isArray(cfg?.features) && cfg.features.length && cfg.features) ||
      DEFAULT_EI_FEATURES;

    const FEATURES_ALL = FEATURES_ALL_RAW.map((f) =>
      typeof f === "string" ? { key: f.toLowerCase().replace(/\s+/g, "-"), label: f } : f
    );

    function hydrateEISelects() {
      if (!personaSelectElem || !eiFeatureSelectElem) return;
      personaSelectElem.innerHTML = "";
      eiFeatureSelectElem.innerHTML = "";
      personaSelectElem.disabled = false;
      eiFeatureSelectElem.disabled = false;

      const opt = (txt, val = "") => {
        const o = document.createElement("option");
        o.value = val;
        o.textContent = txt;
        return o;
      };
      personaSelectElem.appendChild(opt("Select...", ""));
      eiFeatureSelectElem.appendChild(opt("Select...", ""));

      PERSONAS_ALL.forEach((p) => {
        const o = document.createElement("option");
        const val = p.key || p.value || p.id || String(p).toLowerCase().replace(/\s+/g, "-");
        const lab = p.label || p.name || p.title || String(p);
        o.value = val;
        o.textContent = lab;
        personaSelectElem.appendChild(o);
      });

      FEATURES_ALL.forEach((f) => {
        const o = document.createElement("option");
        const val = f.key || f.value || f.id || String(f).toLowerCase().replace(/\s+/g, "-");
        const lab = f.label || f.name || f.title || String(f);
        o.value = val;
        o.textContent = lab;
        eiFeatureSelectElem.appendChild(o);
      });

      if (!FEATURES_ALL.length) console.warn("EI features list is empty; check config keys (eiFeatures/features).");
    }

    // mount controls
    simControls.appendChild(lcLabel);
    simControls.appendChild(modeSel);
    simControls.appendChild(coachLabel);
    simControls.appendChild(coachSel);
    simControls.appendChild(diseaseLabel);
    simControls.appendChild(diseaseSelect);
    simControls.appendChild(hcpLabel);
    simControls.appendChild(hcpSelect);
    simControls.appendChild(personaLabel);
    simControls.appendChild(personaSelect);
    simControls.appendChild(featureLabel);
    simControls.appendChild(featureSelect);

    bar.appendChild(simControls);
    shell.innerHTML = "";
    shell.appendChild(bar);

    const meta = el("div", "scenario-meta");
    shell.appendChild(meta);

    const msgs = el("div", "chat-messages");
    shell.appendChild(msgs);

    const inp = el("div", "chat-input");
    const ta = el("textarea");
    ta.placeholder = "Type your message…";

    // Enter throttle
    let lastKeyTs = 0;
    ta.addEventListener("keydown", (e) => {
      const now = Date.now();
      if (e.key === "Enter" && !e.shiftKey) {
        if (now - lastKeyTs < 250) return; // throttle
        lastKeyTs = now;
        e.preventDefault();
        send.click();
      }
    });
    const send = el("button", "btn", "Send");
    send.onclick = () => {
      const t = ta.value.trim();
      if (!t) return;
      sendMessage(t);
      ta.value = "";
    };
    inp.appendChild(ta);
    inp.appendChild(send);
    shell.appendChild(inp);

    const coach = el("div", "coach-section");
    coach.innerHTML = `<h3>Coach Feedback</h3><div class="coach-body muted">Awaiting the first assistant reply…</div>`;
    shell.appendChild(coach);

    feedbackDisplayElem = el("div", "ei-feedback");
    feedbackDisplayElem.id = "feedback-display";
    feedbackDisplayElem.style.marginTop = "8px";
    feedbackDisplayElem.style.padding = "8px";
    feedbackDisplayElem.style.borderTop = "1px solid #e1e6ef";
    feedbackDisplayElem.style.fontSize = "14px";
    coach.appendChild(feedbackDisplayElem);

    function getDiseaseStates() {
      let ds = Array.isArray(cfg?.diseaseStates) ? cfg.diseaseStates.slice() : [];
      if (!ds.length && Array.isArray(scenarios) && scenarios.length) {
        ds = Array.from(
          new Set(scenarios.map((s) => (s.therapeuticArea || s.diseaseState || "").trim()))
        ).filter(Boolean);
      }
      ds = ds.map((x) => x.replace(/\bhiv\b/gi, "HIV"));
      return ds;
    }

    function elOption(select, val, label) {
      const o = document.createElement("option");
      o.value = val;
      o.textContent = label;
      select.appendChild(o);
    }

    function setSelectOptions(select, values, withPlaceholder) {
      select.innerHTML = "";
      if (withPlaceholder) {
        const p = document.createElement("option");
        p.value = "";
        p.textContent = "Select…";
        p.disabled = true;
        p.selected = true;
        select.appendChild(p);
      }
      values.forEach((v) => {
        if (!v) return;
        if (typeof v === "string") elOption(select, v, v);
        else elOption(select, v.value || v.id || v.key || v.label, v.label || v.value || v.id || v.key);
      });
    }

    function populateDiseases() {
      const ds = getDiseaseStates();
      setSelectOptions(diseaseSelect, ds, true);
    }

    function populateHcpForDisease(ds) {
      const dsKey = (ds || "").trim();
      const scen = scenarios.filter((s) => {
        const area = (s.therapeuticArea || s.diseaseState || "").trim();
        return area.toLowerCase() === dsKey.toLowerCase();
      });

      if (scen.length) {
        const opts = scen.map((s) => ({ value: s.id, label: s.label || s.id }));
        setSelectOptions(hcpSelect, opts, true);
        hcpSelect.disabled = false;
      } else {
        setSelectOptions(hcpSelect, [{ value: "", label: "No scenarios for this disease" }], true);
        hcpSelect.disabled = true;
      }
    }

    function renderMeta() {
      const sc = scenariosById.get(currentScenarioId);
      const showMeta = currentMode === "sales-simulation" || currentMode === "role-play";
      if (!sc || !currentScenarioId || !showMeta) {
        meta.innerHTML = "";
        return;
      }
      meta.innerHTML = `
        <div class="meta-card">
          <div><strong>Today’s Goal:</strong> ${esc(sc.goal || "—")}</div>
        </div>`;
    }

    function renderMessages() {
      const msgsEl = shell.querySelector(".chat-messages");
      msgsEl.innerHTML = "";

      for (const m of conversation) {
        const row = el("div", `message ${m.role}`);
        const c = el("div", "content");

        // Speaker chips: Role Play = HCP/Rep. Sales Simulation = Sales Coach/Rep.
        if (currentMode === "role-play") {
          const chipText =
            m._speaker === "hcp" ? "HCP" : m._speaker === "rep" ? "Rep" : m.role === "assistant" ? "HCP" : "Rep";
          const chipCls = m._speaker === "hcp" || m.role === "assistant" ? "speaker hcp" : "speaker rep";
          const chip = el("div", chipCls, chipText);
          c.appendChild(chip);
        } else if (currentMode === "sales-simulation") {
          const isCoach = m.role === "assistant";
          const chip = el("div", isCoach ? "speaker coach" : "speaker rep", isCoach ? "Sales Coach" : "Rep");
          c.appendChild(chip);
        }

        const body = el("div");
        const normalized = normalizeGuidanceLabels(m.content);
        body.innerHTML = md(normalized);
        c.appendChild(body);

        row.appendChild(c);
        msgsEl.appendChild(row);
      }
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    function orderedPills(scores) {
      const order = ["accuracy", "empathy", "clarity", "compliance", "discovery", "objection_handling"];
      return order
        .filter((k) => k in (scores || {}))
        .map((k) => `<span class="pill">${esc(k)}: ${scores[k]}</span>`)
        .join(" ");
    }

    function renderCoach() {
      const body = coach.querySelector(".coach-body");
      if (!coachOn || currentMode === "product-knowledge") {
        coach.style.display = "none";
        return;
      }
      coach.style.display = "";

      // Role Play: hide until final eval
      if (currentMode === "role-play") {
        const last = conversation[conversation.length - 1];
        if (!last || !last._finalEval) {
          const extra = repOnlyPanelHTML
            ? `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed #e1e6ef">${repOnlyPanelHTML}</div>`
            : "";
          body.innerHTML = `<span class="muted">Final evaluation will appear after you request it by typing “Evaluate this exchange”.</span>${extra}`;
          return;
        }
      }

      const last = conversation[conversation.length - 1];
      if (!(last && last.role === "assistant" && last._coach)) {
        body.innerHTML = `<span class="muted">Awaiting the first assistant reply…</span>`;
        return;
      }
      const fb = last._coach;
      const scores = fb.scores || fb.subscores || {};

      // Sales Simulation yellow panel spec:
      if (currentMode === "sales-simulation") {
        const workedStr = fb.worked && fb.worked.length ? `<ul>${fb.worked.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>` : "—";
        const improveStr = fb.improve && fb.improve.length ? `<ul>${fb.improve.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>` : "—";
        body.innerHTML = `
          <div class="coach-subs" style="display:none">${orderedPills(scores)}</div>
          <ul class="coach-list">
            <li><strong>Focus:</strong> ${workedStr}</li>
            <li><strong>Strategy:</strong> ${improveStr}</li>
          </ul>
          ${repOnlyPanelHTML ? `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed #e1e6ef">${repOnlyPanelHTML}</div>` : ""}`;
        return;
      }

      // Emotional-assessment and Role Play final eval keep score view
      const workedStr = fb.worked && fb.worked.length ? fb.worked.join(". ") + "." : "—";
      const improveStr = fb.improve && fb.improve.length ? fb.improve.join(". ") + "." : fb.feedback || "—";
      body.innerHTML = `
        <div class="coach-score">Score: <strong>${fb.overall ?? fb.score ?? "—"}</strong>/100</div>
        <div class="coach-subs">${orderedPills(scores)}</div>
        <ul class="coach-list">
          <li><strong>What worked:</strong> ${esc(workedStr)}</li>
          <li><strong>What to improve:</strong> ${esc(improveStr)}</li>
          <li><strong>Suggested phrasing:</strong> ${esc(fb.phrasing || "—")}</li>
        </ul>
        ${repOnlyPanelHTML ? `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed #e1e6ef">${repOnlyPanelHTML}</div>` : ""}`;
    }

    function applyModeVisibility() {
      const lc = modeSel.value;
      currentMode = LC_TO_INTERNAL[lc];
      const pk = currentMode === "product-knowledge";

      coachLabel.classList.toggle("hidden", pk);
      coachSel.classList.toggle("hidden", pk);

      if (currentMode === "sales-simulation") {
        diseaseLabel.classList.remove("hidden");
        diseaseSelect.classList.remove("hidden");
        hcpLabel.classList.remove("hidden");
        hcpSelect.classList.remove("hidden");
        personaLabelElem.classList.add("hidden");
        personaSelectElem.classList.add("hidden");
        featureLabelElem.classList.add("hidden");
        eiFeatureSelectElem.classList.add("hidden");
        feedbackDisplayElem.innerHTML = "";
        repOnlyPanelHTML = "";
        populateDiseases();
      } else if (currentMode === "product-knowledge") {
        diseaseLabel.classList.remove("hidden");
        diseaseSelect.classList.remove("hidden");
        hcpLabel.classList.add("hidden");
        hcpSelect.classList.add("hidden");
        personaLabelElem.classList.add("hidden");
        personaSelectElem.classList.add("hidden");
        featureLabelElem.classList.add("hidden");
        eiFeatureSelectElem.classList.add("hidden");
        feedbackDisplayElem.innerHTML = "";
        repOnlyPanelHTML = "";
        populateDiseases();
      } else if (currentMode === "role-play") {
        diseaseLabel.classList.remove("hidden");
        diseaseSelect.classList.remove("hidden");
        hcpLabel.classList.remove("hidden");
        hcpSelect.classList.remove("hidden");
        personaLabelElem.classList.add("hidden");
        personaSelectElem.classList.add("hidden");
        featureLabelElem.classList.add("hidden");
        eiFeatureSelectElem.classList.add("hidden");
        repOnlyPanelHTML = "";
        feedbackDisplayElem.innerHTML = `
          <div class="coach-note">
            <strong>Role Play Mode:</strong> You chat with an HCP persona selected by Disease + HCP.
            Type <em>"Evaluate this exchange"</em> for a full assessment, or <em>"Evaluate Rep"</em> for a Rep-only review.
          </div>`;
        populateDiseases();
        if (diseaseSelect.value) populateHcpForDisease(diseaseSelect.value);
        renderMessages();
        renderCoach();
        renderMeta();
      } else {
        // emotional-assessment
        diseaseLabel.classList.add("hidden");
        diseaseSelect.classList.add("hidden");
        hcpLabel.classList.add("hidden");
        hcpSelect.classList.add("hidden");
        personaLabelElem.classList.remove("hidden");
        personaSelectElem.classList.remove("hidden");
        featureLabelElem.classList.remove("hidden");
        eiFeatureSelectElem.classList.remove("hidden");
        feedbackDisplayElem.innerHTML = "";
        repOnlyPanelHTML = "";
        currentScenarioId = null;
        conversation = [];
        renderMessages();
        renderCoach();
        renderMeta();
      }

      if (currentMode === "product-knowledge" || currentMode === "emotional-assessment") {
        currentScenarioId = null;
        conversation = [];
        renderMessages();
        renderCoach();
        renderMeta();
      }
    }

    modeSel.addEventListener("change", applyModeVisibility);

    diseaseSelect.addEventListener("change", () => {
      const ds = diseaseSelect.value || "";
      if (!ds) return;
      if (currentMode === "sales-simulation" || currentMode === "role-play") {
        populateHcpForDisease(ds);
      } else if (currentMode === "product-knowledge") {
        currentScenarioId = null;
      }
      renderMessages();
      renderCoach();
      renderMeta();
    });

    hcpSelect.addEventListener("change", () => {
      const sel = hcpSelect.value || "";
      if (!sel) return;
      const sc = scenariosById.get(sel);
      currentScenarioId = sc ? sc.id : null;
      renderMessages();
      renderCoach();
      renderMeta();
    });

    // expose for sendMessage
    shell._renderMessages = renderMessages;
    shell._renderCoach = renderCoach;
    shell._renderMeta = renderMeta;
    shell._sendBtn = send;
    shell._ta = ta;

    populateDiseases();
    hydrateEISelects();
    applyModeVisibility();
  }

  // ---------- callModel (hardened with retries, timeout, and backoff) ----------
  function rid() {
    return Math.random().toString(36).slice(2);
  }

  async function callModel(messages) {
    const url = (cfg?.apiBase || cfg?.workerUrl || window.COACH_ENDPOINT || window.WORKER_URL || "").trim();

    const attempt = async (n, delayMs) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort("timeout"), 45000); // up to 45s
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Req-Id": rid()
          },
          body: JSON.stringify({
            model: (cfg?.model) || "llama-3.1-8b-instant",
            temperature: 0.2,
            stream: !!cfg?.stream,
            max_output_tokens: (cfg?.max_output_tokens || cfg?.maxTokens) || 1400,
            messages
          }),
          signal: controller.signal
        });

        if (!r.ok) throw new Error("HTTP " + r.status);

        const data = await r.json().catch(() => ({}));
        return (
          data?.content ||
          data?.reply ||
          data?.choices?.[0]?.message?.content ||
          ""
        );
      } catch (e) {
        // retry only on backend/network errors
        if (n > 0 && /HTTP 5\d\d|timeout|TypeError|NetworkError/i.test(String(e))) {
          await new Promise((res) => setTimeout(res, delayMs));
          return attempt(n - 1, delayMs * 2);
        }
        console.warn("Model call failed:", e);
        return ""; // fallback empty
      } finally {
        clearTimeout(timeout);
      }
    };

    return attempt(2, 400); // up to 3 total tries
  }

  // ---------- final-eval helper ----------
  async function evaluateConversation() {
    const sc = scenariosById.get(currentScenarioId);
    const turns = conversation.length ? conversation : [{ role: "system", content: "No prior turns." }];
    const convoText = turns.map((m) => `${m.role}: ${m.content}`).join("\n").slice(0, 24000);

    const evalMsgs = [
      systemPrompt ? { role: "system", content: systemPrompt } : null,
      { role: "system", content: buildPreface("role-play", sc) + "\nEvaluate the whole exchange now." },
      {
        role: "user",
        content:
          `Evaluate this entire exchange for EI, clarity, accuracy, compliance, discovery, and objection handling. ` +
          `Provide specific, actionable feedback and a 0-100 score.\n\nConversation:\n${convoText}`
      }
    ].filter(Boolean);

    const raw = await callModel(evalMsgs);
    const { coach, clean } = extractCoach(raw);
    const finalCoach = coach || scoreReply("", clean);
    conversation.push({ role: "assistant", content: clean, _coach: finalCoach, _finalEval: true });
  }

  /* ---------- Rep-only evaluation helpers ---------- */
  function repTurns(history, max = 12) {
    const repLike = ["rep", "user"]; // Rep messages stored as _speaker:'rep' or role:'user'
    const seq = (history || []).filter(
      (m) => repLike.includes(String(m._speaker || "").toLowerCase()) || repLike.includes(String(m.role || "").toLowerCase())
    );
    return seq.slice(-max).map(({ role, content, _speaker }) => ({
      role: (role || _speaker || "user"),
      content: String(content || "")
    }));
  }

  async function evaluateRepOnly({ history, personaLabel, goal }) {
    const transcript = repTurns(history);

    const sys = [
      "You are the ReflectivAI Coach.",
      "Evaluate ONLY the Rep’s utterances.",
      "Ignore HCP content except as context.",
      `Persona: ${personaLabel || "unspecified persona"}.`,
      `Scenario Goal: ${goal || "unspecified goal"}.`,
      "Rubric: Accuracy, Compliance, Discovery, Clarity, Objection Handling, Empathy.",
      "Return JSON with keys: scores{accuracy,compliance,discovery,clarity,objectionHandling,empathy}, summary, strengths[], improvements[], actionable[]. Scores 1–5 integers."
    ].join(" ");

    const user = {
      role: "user",
      content: JSON.stringify({
        mode: "rep_only",
        rubric: ["Accuracy", "Compliance", "Discovery", "Clarity", "Objection Handling", "Empathy"],
        transcript
      })
    };

    let raw = "";
    try {
      raw = await callModel([{ role: "system", content: sys }, user]);
    } catch (e) {
      return { html: `<div class='coach-panel'><h4>Rep-only Evaluation</h4><p>Unavailable now. Try again.</p></div>` };
    }

    let data = null;
    try { data = JSON.parse(raw); } catch (_) {}

    // Fallback to simple text if JSON not returned
    if (!data || !data.scores) {
      const safe = sanitizeLLM(raw || "Rep-only evaluation unavailable.");
      return { html: `<div class='coach-panel'><h4>Rep-only Evaluation</h4><p>${esc(safe)}</p></div>` };
    }

    const s = data.scores || {};
    const list = (arr) => Array.isArray(arr) && arr.length ? `<ul>${arr.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>` : "—";
    const html = `
      <div class="coach-panel">
        <h4>Rep-only Evaluation</h4>
        <div class="coach-subs">
          <span class="pill">Accuracy: ${s.accuracy ?? "—"}</span>
          <span class="pill">Compliance: ${s.compliance ?? "—"}</span>
          <span class="pill">Discovery: ${s.discovery ?? "—"}</span>
          <span class="pill">Clarity: ${s.clarity ?? "—"}</span>
          <span class="pill">Objection Handling: ${s.objectionHandling ?? "—"}</span>
          <span class="pill">Empathy: ${s.empathy ?? "—"}</span>
        </div>
        ${data.summary ? `<p>${esc(data.summary)}</p>` : ""}
        <h5>Strengths</h5>${list(data.strengths)}
        <h5>Improvements</h5>${list(data.improvements)}
        <h5>Actionable Feedback</h5>${list(data.actionable)}
      </div>`;
    return { html };
  }

  // ---------- send ----------
  function norm(txt){return String(txt||"").toLowerCase().replace(/\s+/g," ").trim();}
  let lastAssistantNorm = "";
  let recentAssistantNorms = [];
  function pushRecent(n){ recentAssistantNorms.push(n); if(recentAssistantNorms.length>3) recentAssistantNorms.shift(); }
  function isRecent(n){ return recentAssistantNorms.includes(n); }

  let isSending = false;

  function trimConversationIfNeeded() {
    // keep last 30 turns to avoid runaway context
    if (conversation.length <= 30) return;
    conversation = conversation.slice(-30);
  }

  async function sendMessage(userText) {
    if (isSending) return;            // double-send lock
    isSending = true;

    const shellEl = mount.querySelector(".reflectiv-chat");
    const renderMessages = shellEl._renderMessages;
    const renderCoach = shellEl._renderCoach;
    const sendBtn = shellEl._sendBtn;
    const ta = shellEl._ta;
    if (sendBtn) sendBtn.disabled = true;
    if (ta) ta.disabled = true;

    try {
      // normalize input
      userText = clampLen((userText || "").trim(), 1600);
      if (!userText) return;
      lastUserMessage = userText;

      // intercept evaluation intents
      const evalRe =
        /\b(evaluate|assessment|assess|grade|score)\b.*\b(conversation|exchange|dialog|dialogue|chat)\b|\bfinal (eval|evaluation|assessment)\b/i;
      if (evalRe.test(userText)) {
        await evaluateConversation();
        trimConversationIfNeeded();
        renderMessages();
        renderCoach();
        return;
      }

      // Rep-only evaluation trigger
      const repEvalRe = /^\s*(evaluate\s+rep|rep\s+only\s+eval(?:uation)?|evaluate\s+the\s+rep)\s*$/i;
      if (repEvalRe.test(userText)) {
        const sc = scenariosById.get(currentScenarioId);
        const persona = sc?.hcpRole || sc?.label || "";
        const goal = sc?.goal || "";
        const res = await evaluateRepOnly({ history: conversation, personaLabel: persona, goal });
        repOnlyPanelHTML = res?.html || "<div class='coach-panel'><h4>Rep-only Evaluation</h4><p>Unavailable.</p></div>";
        // show note, but do not add a new assistant message
        renderCoach();
        return;
      }

      // normal turn
      conversation.push({
        role: "user",
        content: userText,
        _speaker: currentMode === "role-play" ? "rep" : "user"
      });
      trimConversationIfNeeded();
      renderMessages();
      renderCoach();

      if (currentMode === "emotional-assessment") generateFeedback();

      const sc = scenariosById.get(currentScenarioId);
      const messages = [];

      // 1) Core runtime rules (system.md) + EI layer
      if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
      if ((currentMode === "sales-simulation" || currentMode === "role-play") && eiHeuristics) {
        messages.push({ role: "system", content: eiHeuristics });
      }

      // 2) Mode/scenario preface
      if (currentMode === "role-play") {
        const personaLine = currentPersonaHint();
        const detail = sc
          ? `Therapeutic Area: ${sc.therapeuticArea || sc.diseaseState || "—"}. HCP Role: ${sc.hcpRole || "—"}. ${
              sc.background ? `Background: ${sc.background}. ` : ""
            }${sc.goal ? `Today’s Goal: ${sc.goal}.` : ""}`
          : "";
        const roleplayRails = buildPreface("role-play", sc) + `

Context:
${personaLine}
${detail}`;
        messages.push({ role: "system", content: roleplayRails });
      } else {
        messages.push({ role: "system", content: buildPreface(currentMode, sc) });
      }

      // 3) User turn
      messages.push({ role: "user", content: userText });

      try {
        if (currentMode !== "role-play") {
          const sysExtras =
            typeof EIContext !== "undefined" && EIContext?.getSystemExtras
              ? await EIContext.getSystemExtras().catch(() => null)
              : null;
          if (sysExtras) messages.unshift({ role: "system", content: sysExtras });
        }

        let raw = await callModel(messages);
        if (!raw) raw = "From my perspective, we review patient histories and adherence to guide decisions.";

        const { coach, clean } = extractCoach(raw);
        let replyText = currentMode === "role-play" ? sanitizeRolePlayOnly(clean) : sanitizeLLM(clean);

        // enforce HCP-only in RP
        if (currentMode === "role-play") {
          replyText = await enforceHcpOnly(replyText, sc, messages, callModel);
        }

        // anti-echo: if assistant equals user prompt
        if (norm(replyText) === norm(userText)) {
          replyText = "From my perspective, we evaluate high-risk patients using history, behaviors, and adherence context.";
        }

        // prevent duplicate/cycling assistant replies (ring buffer)
        let candidate = norm(replyText);
        if (candidate && (candidate === lastAssistantNorm || isRecent(candidate))) {
          const alts = [
            "In my clinic, we review history, behaviors, and adherence to understand risk.",
            "I rely on history and follow-up patterns to guide decisions.",
            "We focus on adherence and recent exposures when assessing candidacy."
          ];
          replyText = alts[Math.floor(Math.random()*alts.length)];
          candidate = norm(replyText);
        }
        lastAssistantNorm = candidate;
        pushRecent(candidate);

        // allow longer Sales Coach responses
        replyText = clampLen(replyText, currentMode === "sales-simulation" ? 2200 : 1400);

        const computed = scoreReply(userText, replyText, currentMode);

        const finalCoach = (() => {
          if (coach && (coach.scores || coach.subscores) && currentMode !== "role-play") {
            const scores = coach.scores || coach.subscores;
            const overall =
              typeof coach.overall === "number" ? coach.overall : typeof coach.score === "number" ? coach.score : undefined;
            return {
              overall: overall ?? computed.overall,
              scores,
              feedback: coach.feedback || computed.feedback,
              worked: coach.worked && coach.worked.length ? coach.worked : computed.worked,
              improve: coach.improve && coach.improve.length ? coach.improve : computed.improve,
              phrasing: typeof coach.phrasing === "string" && coach.phrasing ? coach.phrasing : computed.phrasing,
              context: coach.context || { rep_question: userText, hcp_reply: replyText },
              score: overall ?? computed.overall,
              subscores: scores
            };
          }
          return computed;
        })();

        conversation.push({
          role: "assistant",
          content: replyText,
          _coach: finalCoach,
          _speaker: currentMode === "role-play" ? "hcp" : "assistant"
        });
        trimConversationIfNeeded();
        renderMessages();
        renderCoach();

        if (currentMode === "emotional-assessment") generateFeedback();

        if (cfg && cfg.analyticsEndpoint) {
          fetch(cfg.analyticsEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ts: Date.now(),
              schema: cfg.schemaVersion || "coach-v2",
              mode: currentMode,
              scenarioId: currentScenarioId,
              turn: conversation.length,
              context: finalCoach.context || { rep_question: userText, hcp_reply: replyText },
              overall: finalCoach.overall,
              scores: finalCoach.scores
            })
          }).catch(() => {});
        }
      } catch (e) {
        conversation.push({ role: "assistant", content: `Model error: ${String(e.message || e)}` });
        trimConversationIfNeeded();
        renderMessages();
      }
    } finally {
      const shellEl2 = mount.querySelector(".reflectiv-chat");
      const sendBtn2 = shellEl2?._sendBtn;
      const ta2 = shellEl2?._ta;
      if (sendBtn2) sendBtn2.disabled = false;
      if (ta2) { ta2.disabled = false; ta2.focus(); }
      isSending = false;
    }
  }

  // ---------- scenarios loader ----------
  async function loadScenarios() {
    try {
      if (cfg && cfg.scenariosUrl) {
        const payload = await fetchLocal(cfg.scenariosUrl);
        const arr = Array.isArray(payload) ? payload : payload.scenarios || [];
        scenarios = arr.map((s) => ({
          id: String(s.id),
          label: s.label || String(s.id),
          therapeuticArea: s.therapeuticArea || s.diseaseState || "",
          hcpRole: s.hcpRole || "",
          background: s.background || "",
          goal: s.goal || ""
        }));
      } else if (Array.isArray(cfg?.scenarios)) {
        scenarios = cfg.scenarios.map((s) => ({
          id: String(s.id),
          label: s.label || String(s.id),
          therapeuticArea: s.therapeuticArea || s.diseaseState || "",
          hcpRole: s.hcpRole || "",
          background: s.background || "",
          goal: s.goal || ""
        }));
      } else {
        scenarios = [];
      }
    } catch (e) {
      console.error("scenarios load failed:", e);
      scenarios = [];
    }

    scenarios.forEach((s) => {
      if (s.therapeuticArea) s.therapeuticArea = s.therapeuticArea.replace(/\bhiv\b/gi, "HIV");
    });

    const byId = new Map();
    for (const s of scenarios) byId.set(s.id, s);
    scenarios = Array.from(byId.values());
    scenariosById = byId;
  }

  // ---------- init ----------
  async function init() {
    try {
      try {
        cfg = await fetchLocal("./assets/chat/config.json");
      } catch (e) {
        cfg = await fetchLocal("./config.json");
      }
    } catch (e) {
      console.error("config load failed:", e);
      cfg = { defaultMode: "sales-simulation" };
    }

    // Ensure endpoint is set even without config.json
    if (!cfg.apiBase && !cfg.workerUrl) {
      cfg.apiBase = (window.COACH_ENDPOINT || window.WORKER_URL || "").trim();
    }

    try {
      systemPrompt = await fetchLocal("./assets/chat/system.md");
    } catch (e) {
      console.error("system.md load failed:", e);
      systemPrompt = "";
    }

    // EI foundation (about-ei.md)
    try {
      eiHeuristics = await fetchLocal("./assets/chat/about-ei.md");
    } catch (e) {
      console.warn("about-ei.md load failed:", e);
      eiHeuristics = "";
    }

    await loadScenarios();
    buildUI();
  }

  // ---------- start ----------
  waitForMount(init);
})();
