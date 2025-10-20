/*
 * ReflectivAI Site Stylesheet (drop-in)
 * Clean layout, modern cards, modal coach, Alora bubble.
 */

:root{
  --navy:#0f2747;
  --navy-2:#0b3954;
  --teal:#20bfa9;
  --ink:#1e2a3a;
  --slate:#596a82;
  --bg:#ffffff;
  --soft:#eef4fa;
  --card:#ecf3fb;
  --border:#d9e3ef;
  --shadow:0 8px 24px rgba(15,39,71,.12);
}

html{scroll-behavior:smooth}
body{
  margin:0;
  font-family:"Inter",system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  color:var(--ink);
  background:var(--bg);
  line-height:1.55;
}

/* ---------- Header / Nav ---------- */
.site-header{position:sticky;top:0;z-index:1000;background:var(--navy);color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.12)}
.nav{max-width:1220px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;padding:12px 16px;position:relative}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:#fff;font-weight:800;font-size:20px}
.brand img{width:28px;height:28px;display:block}
.nav-links{display:flex;gap:16px;align-items:center}
.nav-links a{color:#fff;text-decoration:none;font-weight:600;padding:8px 6px;border-radius:8px}
.nav-links a:hover{background:rgba(255,255,255,.08)}
.hamburger{display:none;flex-direction:column;gap:5px;width:34px;height:26px;background:transparent;border:0;cursor:pointer}
.hamburger span{display:block;height:3px;background:#fff;border-radius:2px;transition:.2s}
.hamburger.active span:nth-child(1){transform:translateY(9px) rotate(45deg)}
.hamburger.active span:nth-child(2){opacity:0}
.hamburger.active span:nth-child(3){transform:translateY(-9px) rotate(-45deg)}
@media (max-width:900px){
  .hamburger{display:flex}
  .nav-links{display:none;position:absolute;left:12px;right:12px;top:100%;background:var(--navy);flex-direction:column;padding:10px;border-radius:12px;box-shadow:var(--shadow)}
  .nav-links.active{display:flex}
  .nav-links a{width:100%}
}

/* ---------- Hero ---------- */
.hero{background:linear-gradient(140deg,#001d3d 0%, var(--navy-2) 42%, #1fa3a8 100%);color:#fff}
.hero-wrap{max-width:1160px;margin:0 auto;display:grid;grid-template-columns:1.1fr .9fr;gap:26px;align-items:center;padding:78px 16px}
.hero h1{margin:0 0 12px;font-size:clamp(32px,5vw,46px);line-height:1.06;letter-spacing:-.02em;font-weight:800}
.hero p{margin:0 0 22px;font-size:clamp(16px,2.4vw,18px);max-width:720px;font-weight:600}
.cta{display:flex;gap:12px;flex-wrap:wrap}
.btn{display:inline-block;border-radius:12px;padding:12px 18px;font-weight:800;text-decoration:none}
.btn.primary{background:#0f2747;color:#fff}
.btn.primary:hover{filter:brightness(.95)}
.btn.secondary{border:2px solid #0f2747;color:#fff}
.btn.secondary:hover{background:rgba(255,255,255,.12)}
.hero-img{border-radius:16px;overflow:hidden;box-shadow:var(--shadow)}
.hero-img img{width:100%;height:auto;display:block}

/* ---------- Why it matters strip ---------- */
.why{background:var(--navy);color:#fff}
.why-inner{max-width:1160px;margin:0 auto;padding:26px 16px;display:grid;grid-template-columns:auto 1fr;gap:16px 22px;align-items:center}
.why-title{font-family:"Pacifico",cursive;font-size:26px;transform:rotate(-3deg);margin:0}
.why-text{margin:0;font-weight:600}

/* ---------- Sections ---------- */
.section{padding:56px 16px}
.section-inner{max-width:1160px;margin:0 auto}
h2{font-size:clamp(26px,3.6vw,40px);margin:0 0 18px;font-weight:900;letter-spacing:-.01em;color:var(--ink)}
.muted{color:var(--slate)}

/* ---------- Cards / grids ---------- */
.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
@media (max-width:960px){.grid-3{grid-template-columns:1fr}}
.card{
  background:var(--card);
  border:1px solid var(--border);
  border-radius:14px;
  padding:18px;
  box-shadow:0 1px 2px rgba(0,0,0,.04);
}
.card h3{margin:.25rem 0 .5rem;font-size:20px}
.card p{margin:0}

/* Platform modules = denser rows */
.platform .grid-3 .card{display:grid;grid-template-columns:220px 1fr;gap:16px;align-items:center}
.platform .grid-3 .card h3{margin:0}
@media (max-width:720px){.platform .grid-3 .card{grid-template-columns:1fr}}

/* ---------- Split Lists (Therapeutic Area / Personas) ---------- */
.split{
  display:grid;
  grid-template-columns:1fr 12px 1fr;
  gap:18px;
  align-items:start;
}
.split .divider{background:#1c2738;opacity:.9;border-radius:2px}
.split .col h2{margin-bottom:10px}
.chips{display:grid;gap:10px}
.tag{
  display:block;background:var(--card);border:1px solid var(--border);
  padding:12px 14px;border-radius:12px;font-weight:700;color:var(--ink);
  text-decoration:none;cursor:pointer;
}
.tag:hover{filter:brightness(.98)}

/* ---------- Feature list (no bullets) ---------- */
.feature-list{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.feature-list li{list-style:none}
.feature-list li::marker{content:""}

/* ---------- Analytics metric links ---------- */
.metrics-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}

/* ---------- Modal (cards + coach) ---------- */
.modal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(3,14,24,.55);z-index:1200}
.modal.open{display:flex}
.modal-box{background:#fff;border-radius:18px;box-shadow:var(--shadow);max-width:980px;width:92vw;max-height:88vh;overflow:auto}
.modal-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border);background:#f6f9fe;border-radius:18px 18px 0 0}
.modal-title{font-weight:900}
.modal-close{background:#e7edf6;border:0;border-radius:10px;padding:6px 10px;cursor:pointer}

/* Large coach modal body sizing */
#coachModal .modal-box{max-width:1100px;width:96vw}
#coachBody{padding:0}

/* ---------- Alora bubble ---------- */
.alora-toggle{
  position:fixed;left:18px;bottom:18px;width:60px;height:60px;border-radius:50%;
  background:var(--navy);box-shadow:0 10px 24px rgba(15,39,71,.25);
  display:grid;place-items:center;color:#fff;cursor:pointer;z-index:1100;
}
.alora-toggle svg{width:26px;height:26px}
.alora{position:fixed;left:18px;bottom:90px;width:320px;max-height:60vh;background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);display:none;flex-direction:column;overflow:hidden;z-index:1100}
.alora.open{display:flex}
.alora-head{padding:10px 12px;background:#f6f9fe;border-bottom:1px solid var(--border);font-weight:800}
.alora-body{padding:10px 12px;display:flex;flex-direction:column;gap:8px;overflow:auto}
.alora-input{display:flex;gap:8px;padding:10px;border-top:1px solid var(--border)}
.alora-input input{flex:1;border:1px solid var(--border);border-radius:10px;padding:10px}
.alora-msg{border-radius:10px;padding:10px 12px;max-width:85%}
.alora-msg.user{background:#eef3fa;margin-left:auto}
.alora-msg.bot{background:#fff;border:1px solid var(--border)}


<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ReflectivAI – AI Sales Enablement for Life Sciences</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=Pacifico&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.css?v=20251019-1">
<link rel="stylesheet" href="widget.css?v=9"><!-- keep original widget styles -->
</head>
<body>

<header class="site-header">
  <nav class="nav">
    <a class="brand" href="#home">
      <img src="assets/reflectiv-logo.png" alt="ReflectivAI logo">
      <span>ReflectivAI</span>
    </a>

    <button id="navToggle" class="hamburger" aria-label="Toggle navigation" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>

    <div id="navMenu" class="nav-links">
      <a href="#platform">Platform</a>
      <a href="#platform-mods">Platform Modules</a>
      <a href="#therapy">Disease States</a>
      <a href="#personas">HCP Profiles</a>
      <a href="#simulations">Simulations</a>
      <a href="#analytics">Analytics</a>
      <a href="#ethics">Ethics</a>
      <a href="#faq">FAQ</a>
      <a href="#contact">Contact</a>
    </div>
  </nav>
</header>

<!-- Hero -->
<section id="home" class="hero">
  <div class="hero-wrap">
    <div>
      <h1>Empowering Life-Sciences Teams to Connect — and Convert — with Intelligence</h1>
      <p>ReflectivAI blends clinical accuracy, emotional intelligence, and adaptive AI coaching so every HCP conversation feels authentic, confident, and compliant.</p>
      <div class="cta">
        <a class="btn primary" href="#contact">Request a Demo</a>
        <a id="openCoach" class="btn secondary" href="#simulations">Explore the Platform</a>
      </div>
    </div>
    <div class="hero-img">
      <img src="assets/hero-image.png" alt="HCP conversation with analytics overlay">
    </div>
  </div>
</section>

<!-- Why it matters -->
<section class="why">
  <div class="why-inner">
    <h3 class="why-title">Why it matters</h3>
    <p class="why-text">Emotional intelligence drives connection. ReflectivAI helps reps practice active listening, empathy, and tone calibration—transforming compliance into confidence and insight into influence.</p>
  </div>
</section>

<!-- Platform Modules -->
<section id="platform-mods" class="section platform">
  <div class="section-inner">
    <h2>Platform Modules</h2>
    <div class="grid-3">
      <article class="card"><h3>Product Knowledge</h3><p>Train on complex data and regulatory messaging with confidence and compliance built in.</p></article>
      <article class="card"><h3>Sales Simulation</h3><p>Practice high-stakes calls in oncology, vaccines, and other therapeutic areas — anytime, anywhere.</p></article>
      <article class="card"><h3>Relationship Intelligence</h3><p>Understand behavioral blind spots. Track empathy, tone, and conversational agility.</p></article>
    </div>
  </div>
</section>

<!-- Split Lists: Therapeutic Areas / Personas -->
<section id="platform" class="section">
  <div class="section-inner split">
    <div class="col">
      <h2 id="therapy">Train by Therapeutic Area</h2>
      <div class="chips">
        <a class="tag" data-card="HIV PrEP">HIV PrEP</a>
        <a class="tag" data-card="Vaccines">Vaccines</a>
        <a class="tag" data-card="Hepatitis B">Hepatitis B</a>
        <a class="tag" data-card="Oncology">Oncology</a>
        <a class="tag" data-card="Cardiology">Cardiology</a>
        <a class="tag" data-card="Pulmonology">Pulmonology</a>
      </div>
      <p class="muted" style="margin-top:12px">Our scenario library grows continually — new therapeutic areas and objections are added with each launch.</p>
    </div>

    <div class="divider" aria-hidden="true"></div>

    <div class="col">
      <h2 id="personas">Practice with Realistic Personas</h2>
      <div class="chips">
        <a class="tag" data-card="Internal Medicine MD">Internal Medicine MD</a>
        <a class="tag" data-card="Nurse Practitioner (NP)">Nurse Practitioner (NP)</a>
        <a class="tag" data-card="Physician Assistant (PA)">Physician Assistant (PA)</a>
        <a class="tag" data-card="Infectious Disease Specialist">Infectious Disease Specialist</a>
        <a class="tag" data-card="Oncologist">Oncologist</a>
        <a class="tag" data-card="Pulmonologist">Pulmonologist</a>
        <a class="tag" data-card="Cardiologist">Cardiologist</a>
      </div>
    </div>
  </div>
</section>

<!-- Simulations bullets (no left dots any more) -->
<section id="simulations" class="section">
  <div class="section-inner">
    <h2>Interactive Sales Simulations</h2>
    <ul class="feature-list">
      <li><div class="card"><h3>AI role-play coach</h3><p>Responsive personas that adapt to your messaging, tone, and questions.</p></div></li>
      <li><div class="card"><h3>Scenario library</h3><p>Hundreds of practice calls mapped to disease states, objections, and profiles.</p></div></li>
      <li><div class="card"><h3>Territory scoring</h3><p>Benchmark by geography, team and rep; track certification status.</p></div></li>
      <li><div class="card"><h3>Compliance guardrails</h3><p>Real-time checks for fair balance and regulated language.</p></div></li>
    </ul>

    <!-- The coach widget will mount into this modal when Explore is clicked -->
  </div>
</section>

<!-- Analytics (links open cards) -->
<section id="analytics" class="section">
  <div class="section-inner">
    <h2>Performance Analytics & Coaching Intelligence</h2>
    <div class="metrics-grid">
      <a class="tag" data-card="Empathy Index">Empathy Index</a>
      <a class="tag" data-card="Accuracy Index">Accuracy Index</a>
      <a class="tag" data-card="Confidence Delta">Confidence Delta</a>
      <a class="tag" data-card="Compliance Guard">Compliance Guard</a>
      <a class="tag" data-card="Readiness Velocity">Readiness Velocity</a>
    </div>
  </div>
</section>

<!-- Ethics collapsible -->
<section id="ethics" class="section">
  <div class="section-inner">
    <h2>Ethics, Privacy & Governance</h2>
    <p class="muted">ReflectivAI is built for life-sciences training. We avoid PHI by default and apply strict safeguards when customers choose to integrate real data.</p>

    <details open>
      <summary><strong>Data privacy & security</strong></summary>
      <ul>
        <li>PHI is off by default; training uses synthetic or de-identified data.</li>
        <li>When a customer enables PHI, we operate under BAA, encryption in transit/at rest, role-based access, and purge on expiration.</li>
        <li>Vendor risk management with annual reviews and right-to-audit.</li>
      </ul>
    </details>

    <details>
      <summary><strong>Informed consent</strong></summary>
      <ul><li>If real patient data powers enablement, customers obtain explicit, documented consent and provide an opt-out.</li></ul>
    </details>

    <details>
      <summary><strong>Algorithmic bias & fairness</strong></summary>
      <ul>
        <li>Pre-deployment bias testing and periodic re-tests.</li>
        <li>Monitor disparate performance; publish remediation steps.</li>
        <li>Guardrails prohibit non-clinical proxies for targeting.</li>
      </ul>
    </details>

    <details>
      <summary><strong>Transparency & explainability</strong></summary>
      <ul>
        <li>In-product recommendations include reason codes.</li>
        <li>Model cards document data sources, limitations, cadence.</li>
        <li>AI-generated content clearly labeled.</li>
      </ul>
    </details>

    <details>
      <summary><strong>Human oversight & accountability</strong></summary>
      <ul>
        <li>Humans curate scenarios and rubrics; escalation paths defined.</li>
        <li>All message libraries versioned for MLR traceability.</li>
      </ul>
    </details>

    <details>
      <summary><strong>Doctor-patient relationship</strong></summary>
      <ul>
        <li>Training supports, not manipulates, HCP judgement.</li>
        <li>Off-label promotion prohibited; risky language flagged.</li>
      </ul>
    </details>
  </div>
</section>

<!-- References (collapsible list of all) -->
<section id="refs" class="section">
  <div class="section-inner">
    <h2>References</h2>
    <details>
      <summary><strong>Show all references</strong></summary>
      <ol>
        <li>HIPAA Privacy Rule — HHS overview and safeguards.</li>
        <li>NIST AI Risk Management Framework — trustworthy AI guidance.</li>
        <li>ISO/IEC 27001 — information security management.</li>
        <li>ISO/IEC 42001 — AI management system standard.</li>
        <li>OECD AI Principles — trustworthy AI recommendations.</li>
        <li>PhRMA Code — ethical interactions with HCPs.</li>
        <li>FDA OPDP — truthful, balanced promotion guidance.</li>
        <li>AI Adoption Survey (2025) — budgets, ROI, maturity.</li>
        <li>AI Value & Productivity — McKinsey estimates for LS.</li>
      </ol>
    </details>
  </div>
</section>

<!-- FAQ (collapsible) -->
<section id="faq" class="section">
  <div class="section-inner">
    <h2>Frequently Asked Questions</h2>
    <details>
      <summary><strong>What sets ReflectivAI apart?</strong></summary>
      <p>AI simulations + analytics with subtle EI coaching cues within strict compliance guardrails.</p>
    </details>
    <details>
      <summary><strong>Does it replace human coaching?</strong></summary>
      <p>No. It scales practice and insights; managers remain essential for interpretation and development.</p>
    </details>
    <details>
      <summary><strong>How do you handle PHI?</strong></summary>
      <p>PHI is off by default. When enabled, we operate under HIPAA controls and a signed BAA.</p>
    </details>
    <details>
      <summary><strong>Integrations?</strong></summary>
      <p>Export packs and APIs for Salesforce, Veeva, and major LMS platforms.</p>
    </details>
  </div>
</section>

<!-- Contact -->
<section id="contact" class="section">
  <div class="section-inner">
    <h2>Let’s Redefine Your Sales Training</h2>
    <form class="contact-form" onsubmit="return false;">
      <div class="form-group"><label for="name">Name</label><input id="name" required placeholder="Your name"></div>
      <div class="form-group"><label for="email">Email</label><input id="email" type="email" required placeholder="you@example.com"></div>
      <div class="form-group"><label for="message">Message</label><textarea id="message" rows="4" placeholder="Tell us about your team and goals"></textarea></div>
      <button class="btn primary" type="submit">Request Demo</button>
    </form>
  </div>
</section>

<!-- =================== Modals =================== -->
<!-- Generic Card Modal -->
<div id="cardModal" class="modal" aria-hidden="true">
  <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="cardTitle">
    <div class="modal-head">
      <div id="cardTitle" class="modal-title">Details</div>
      <button class="modal-close" data-close="#cardModal">Close</button>
    </div>
    <div id="cardBody" style="padding:14px"></div>
  </div>
</div>

<!-- Coach Modal (loads the existing widget) -->
<div id="coachModal" class="modal" aria-hidden="true">
  <div class="modal-box">
    <div class="modal-head">
      <div class="modal-title">Reflectiv Coach</div>
      <button class="modal-close" data-close="#coachModal">Close</button>
    </div>
    <div id="coachBody">
      <!-- Your widget mounts here -->
      <div id="reflectiv-widget" class="reflectiv-widget">
        <noscript>You need JavaScript to use the ReflectivAI Coach.</noscript>
      </div>
    </div>
  </div>
</div>

<!-- ============== Alora site-help bubble ============== -->
<button id="aloraToggle" class="alora-toggle" aria-label="Open Alora chat">
  <!-- thinking-bubbles icon -->
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path fill="#fff" d="M7 4h10a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-2l-3 3-3-3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"/>
  </svg>
</button>
<div id="alora" class="alora" aria-live="polite">
  <div class="alora-head">Alora — ReflectivAI Help</div>
  <div id="aloraBody" class="alora-body"></div>
  <form id="aloraForm" class="alora-input" autocomplete="off">
    <input id="aloraInput" placeholder="Ask about ReflectivAI…">
    <button class="btn primary" type="submit">Send</button>
  </form>
</div>

<!-- =================== Scripts =================== -->
<script defer src="widget.js?v=9"></script>
<script>
/* ---------- Mobile nav ---------- */
const navToggle=document.getElementById('navToggle');
const navMenu=document.getElementById('navMenu');
if(navToggle&&navMenu){
  navToggle.addEventListener('click',()=>{
    const open=!navMenu.classList.contains('active');
    navMenu.classList.toggle('active',open);
    navToggle.classList.toggle('active',open);
    navToggle.setAttribute('aria-expanded',open?'true':'false');
  });
  navMenu.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{
    navMenu.classList.remove('active');navToggle.classList.remove('active');navToggle.setAttribute('aria-expanded','false');
  }));
}

/* ---------- Helper: open/close modal ---------- */
function openModal(id){document.querySelector(id).classList.add('open')}
function closeModal(id){document.querySelector(id).classList.remove('open')}
document.querySelectorAll('.modal-close').forEach(btn=>{
  btn.addEventListener('click',()=>closeModal(btn.getAttribute('data-close')));
});
document.querySelectorAll('.modal').forEach(m=>{
  m.addEventListener('click',e=>{ if(e.target===m) m.classList.remove('open'); });
});

/* ---------- Explore the Platform -> open Coach modal ---------- */
document.getElementById('openCoach')?.addEventListener('click', (e)=>{
  e.preventDefault();
  openModal('#coachModal');    // widget.js auto-mounts into #reflectiv-widget
});

/* ---------- Clickable chips -> open content cards ---------- */
const CARD_COPY = {
  "HIV PrEP": "<div class='card'><h3>HIV PrEP</h3><ul><li>Urgency framing and prevention benefits</li><li>Stigma sensitivity and inclusive language</li><li>Adherence and risk reduction</li></ul></div>",
  "Vaccines": "<div class='card'><h3>Vaccines</h3><ul><li>Address hesitancy with evidence translation</li><li>Population and community impact</li><li>Schedules, safety, eligibility</li></ul></div>",
  "Hepatitis B": "<div class='card'><h3>Hepatitis B</h3><ul><li>Access & affordability</li><li>Resistance & safety framing</li><li>Screening & vaccination guidelines</li></ul></div>",
  "Oncology": "<div class='card'><h3>Oncology</h3><ul><li>Complex data with compassion</li><li>Payer concerns & value</li><li>Empathy for patients & caregivers</li></ul></div>",
  "Cardiology": "<div class='card'><h3>Cardiology</h3><ul><li>Evidence framing for new therapies</li><li>Comorbidities & patient complexity</li><li>Outcomes & guideline dialogue</li></ul></div>",
  "Pulmonology": "<div class='card'><h3>Pulmonology</h3><ul><li>Translate respiratory advances</li><li>Adherence & inhaler technique</li><li>Access barriers & chronic mgmt</li></ul></div>",

  "Internal Medicine MD":"<div class='card'><h3>Internal Medicine MD</h3><ul><li>Preventative care & chronic disease</li><li>Constraints: time, formulary</li><li>Needs: safety, comparative data</li></ul></div>",
  "Nurse Practitioner (NP)":"<div class='card'><h3>Nurse Practitioner (NP)</h3><ul><li>Holistic education, adherence</li><li>Constraints: workload, reimbursement</li><li>Needs: dosing, side effects, resources</li></ul></div>",
  "Physician Assistant (PA)":"<div class='card'><h3>Physician Assistant (PA)</h3><ul><li>Collaborative care, triage</li><li>Constraints: scope, admin burden</li><li>Needs: authority, samples</li></ul></div>",
  "Infectious Disease Specialist":"<div class='card'><h3>Infectious Disease Specialist</h3><ul><li>Evidence translation</li><li>Resistance, DDI concerns</li><li>Real-world data, emerging therapies</li></ul></div>",
  "Oncologist":"<div class='card'><h3>Oncologist</h3><ul><li>Research & precision medicine</li><li>Cost & QoL considerations</li><li>Trials, biomarkers, survivorship</li></ul></div>",
  "Pulmonologist":"<div class='card'><h3>Pulmonologist</h3><ul><li>Optimize function, reduce readmissions</li><li>Workflow & access logistics</li><li>Eligibility, DDI, initiation timing</li></ul></div>",
  "Cardiologist":"<div class='card'><h3>Cardiologist</h3><ul><li>CV outcomes & GDMT adherence</li><li>Polypharmacy, renal thresholds</li><li>Endpoints, CKD/HF safety</li></ul></div>",

  "Empathy Index":"<div class='card'><h3>Empathy Index</h3><p>Measures emotional attunement and conversational trust with HCPs.</p></div>",
  "Accuracy Index":"<div class='card'><h3>Accuracy Index</h3><p>Tracks medical and regulatory precision.</p></div>",
  "Confidence Delta":"<div class='card'><h3>Confidence Delta</h3><p>Compares self-perceived vs. actual skill growth.</p></div>",
  "Compliance Guard":"<div class='card'><h3>Compliance Guard</h3><p>Flags deviations from approved messaging and detects off-label or risky phrasing.</p></div>",
  "Readiness Velocity":"<div class='card'><h3>Readiness Velocity</h3><p>Quantifies ramp-up speed by rep, team, or territory.</p></div>"
};
document.querySelectorAll('[data-card]').forEach(el=>{
  el.addEventListener('click',()=>{
    const title=el.getAttribute('data-card');
    document.getElementById('cardTitle').textContent=title;
    document.getElementById('cardBody').innerHTML=CARD_COPY[title]||'<p>No details.</p>';
    openModal('#cardModal');
  });
});

/* ---------- Alora site-help (mini FAQ) ---------- */
const alora = document.getElementById('alora');
const aloraToggle = document.getElementById('aloraToggle');
const aloraBody = document.getElementById('aloraBody');
const aloraForm = document.getElementById('aloraForm');
const aloraInput = document.getElementById('aloraInput');

function aloraMsg(txt,who='bot'){
  const b=document.createElement('div'); b.className='alora-msg '+who; b.textContent=txt; aloraBody.appendChild(b); aloraBody.scrollTop=aloraBody.scrollHeight;
}
const KB = {
  "pricing":"We don’t publish pricing on the site; request a demo and we’ll tailor a plan to your team size and use cases.",
  "security":"We align to HIPAA, NIST AI RMF, ISO/IEC 27001 & 42001, and OPDP guidance. See Ethics for details.",
  "simulate":"Open “Explore the Platform” to launch the full coach with personas, EI scoring, and scenarios.",
  "persona":"Personas include Internal Medicine MD, NP, PA, ID, Oncology, Pulmonology and more.",
  "ei":"Our EI mode scores empathy (0–5), stress cues, and offers phrasing tips in real time.",
};
aloraToggle.addEventListener('click',()=>{
  alora.classList.toggle('open');
  if(alora.classList.contains('open') && !aloraBody.dataset.greet){
    aloraBody.dataset.greet = '1';
    aloraMsg("Hi, I’m Alora! I can answer questions about ReflectivAI’s platform, EI coaching, and what’s on this page. Ask me anything.");
  }
});
aloraForm.addEventListener('submit',e=>{
  e.preventDefault();
  const q = aloraInput.value.trim(); if(!q) return;
  aloraInput.value=''; aloraMsg(q,'user');
  const key = Object.keys(KB).find(k=>q.toLowerCase().includes(k));
  setTimeout(()=>aloraMsg(key?KB[key]:"I’m still learning. Try asking about “pricing”, “security”, “simulate”, “persona”, or “EI”. 😊"),300);
});

/* Start at top on load/back-forward cache */
if('scrollRestoration' in history){history.scrollRestoration='manual'}
window.scrollTo(0,0);window.addEventListener('pageshow',e=>{if(e.persisted)window.scrollTo(0,0)});
</script>
</body>
</html>
