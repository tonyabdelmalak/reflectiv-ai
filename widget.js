/* Core loader + shared utils. Safe to replace. */
(() => {
  const NAVY = "#0b2a55";
  const ACCENT = "#06B6D4";

  // ---- shared utils
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, props = {}, children = []) => {
    const n = Object.assign(document.createElement(tag), props);
    (children || []).forEach(c => n.append(c));
    return n;
  };
  const on = (t, ev, fn, o) => t.addEventListener(ev, fn, o);

  // fetch helpers with JSON fallbacks
  const fetchJSON = async (url, opt = {}) => {
    const r = await fetch(url, opt);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  const postJSON = async (url, body, opt = {}) =>
    fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(opt.headers || {}) },
      body: JSON.stringify(body),
      ...opt
    });

  // expose to coach
  window.ReflectivShared = { qs, qsa, el, on, fetchJSON, postJSON, NAVY, ACCENT };

  // dynamic load of coach module when modal is opened or widget exists
  const ensureCoach = async () => {
    if (window.__coachLoaded) return;
    window.__coachLoaded = true;
    try {
      await import("/assets/chat/coach.js");
      if (window.ReflectivCoach && window.ReflectivCoach.initCoach) {
        window.ReflectivCoach.initCoach();
      }
    } catch (e) {
      console.error("coach.js load failed", e);
    }
  };

  // load immediately if container is present at boot
  if (qs("#reflectiv-widget")) ensureCoach();

  // also hook the “Explore the Platform” -> coach modal open button if present
  const openCoachBtn = qs("#openCoach");
  if (openCoachBtn) on(openCoachBtn, "click", () => setTimeout(ensureCoach, 0));

})();
