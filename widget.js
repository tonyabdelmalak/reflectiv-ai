/* ReflectivAI – site bootstrap + Coach loader (v12) */
(() => {
  /* ---------- shared utilities used by coach.js ---------- */
  const S = {
    qs: (sel, root = document) => root.querySelector(sel),
    qsa: (sel, root = document) => [...root.querySelectorAll(sel)],
    on: (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts),
    el: (tag, attrs = {}, children = []) => {
      const n = document.createElement(tag);
      Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'class') n.className = v;
        else if (k === 'html') n.innerHTML = v;
        else n.setAttribute(k, v);
      });
      (Array.isArray(children) ? children : [children]).forEach(c => c && n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
      return n;
    },
    async fetchJSON(url, init) {
      const r = await fetch(url, init);
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return r.json();
    }
  };
  window.ReflectivShared = S;

  /* ---------- modal helpers ---------- */
  function openModal(id)   { S.qs(id)?.classList.add('open'); }
  function closeModal(id)  { S.qs(id)?.classList.remove('open'); }
  S.qsa('.modal-close').forEach(b => S.on(b, 'click', () => closeModal(b.getAttribute('data-close'))));
  S.qsa('.modal').forEach(m => S.on(m, 'click', e => { if (e.target === m) m.classList.remove('open'); }));

  /* ---------- Coach mounting ---------- */
  const coachBtn   = S.qs('#openCoach');
  const coachModal = S.qs('#coachModal');
  const coachRoot  = S.qs('#reflectiv-widget');   // target container inside modal
  const coachMsg   = (txt) => {
    const box = S.qs('#coachBody');
    if (!box) return;
    const note = S.el('div', { style: 'padding:12px 14px' }, S.el('p', {}, txt));
    box.appendChild(note);
  };

  async function ensureCoachLoaded() {
    if (window.ReflectivCoach?.mount) return;
    // cache-bust to avoid stale Pages cache
    const v = String(Date.now());
    try {
      await import(`./assets/chat/coach.js?v=${v}`);
    } catch (e) {
      coachMsg(`Coach module failed to load.\nTried: ${location.origin}${location.pathname.replace(/index\.html$/, '')}assets/chat/coach.js?v=${v}\nConfirm assets/chat/coach.js is published by GitHub Pages and cache is clear.`);
      throw e;
    }
  }

  async function openCoach(e) {
    if (e) e.preventDefault();
    if (!coachModal || !coachRoot) return;
    // fresh session each open
    coachRoot.innerHTML = '';
    try {
      await ensureCoachLoaded();
      if (typeof window.ReflectivCoach?.mount !== 'function') {
        coachMsg('ReflectivAI Coach mount function not found. Ensure coach.js assigns window.ReflectivCoach = { mount }.');
        return;
      }
      window.ReflectivCoach.mount(coachRoot);
    } catch (_) { /* message already printed */ }
    openModal('#coachModal');
  }

  S.on(coachBtn, 'click', openCoach);

  /* Optional: open if URL hash carries #coach */
  if (location.hash.toLowerCase().includes('coach')) openCoach();

  /* ---------- Mobile nav (kept minimal) ---------- */
  const navToggle = S.qs('#navToggle');
  const navMenu   = S.qs('#navMenu');
  if (navToggle && navMenu) {
    S.on(navToggle, 'click', () => {
      const open = !navMenu.classList.contains('active');
      navMenu.classList.toggle('active', open);
      navToggle.classList.toggle('active', open);
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    S.qsa('a', navMenu).forEach(a => S.on(a, 'click', () => {
      navMenu.classList.remove('active'); navToggle.classList.remove('active');
      navToggle.setAttribute('aria-expanded', 'false');
    }));
  }
})();
