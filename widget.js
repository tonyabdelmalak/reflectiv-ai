/* ReflectivAI — widget bootstrap (loader + shared utils)
   Safe for GitHub Pages under /reflectiv-ai/ and Cloudflare static hosting.
   Loads assets/chat/coach.js RELATIVE to this file to avoid /assets 404s.
*/
(() => {
  // ---- tiny DOM ready ----
  const ready = (fn) => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  };

  // ---- where am I? compute a base URL beside this script ----
  // e.g. https://reflectivei.github.io/reflectiv-ai/widget.js -> base = https://reflectivei.github.io/reflectiv-ai/
  const scriptSrc = document.currentScript && document.currentScript.src ? document.currentScript.src : location.href;
  const BASE = scriptSrc.replace(/\/[^/]*$/, '/'); // drop file segment

  // ---- endpoints (allow page to override) ----
  const COACH_ENDPOINT = window.COACH_ENDPOINT || '/coach';
  const ALORA_ENDPOINT = window.ALORA_ENDPOINT || '/alora';

  // ---- shared helpers used by coach.js ----
  const cache = new Map();

  async function fetchJSON(url, opts = {}) {
    const key = `${url}|${opts.method || 'GET'}`;
    if (!opts.noCache && cache.has(key)) return cache.get(key);
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', ...(opts.headers || {}) },
      ...opts
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const json = await res.json();
    if (!opts.noCache) cache.set(key, json);
    return json;
  }

  const debounce = (fn, ms = 200) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  };

  // simple pub/sub for internal events if needed by coach.js
  const bus = (() => {
    const map = new Map();
    return {
      on(ev, fn) { if (!map.has(ev)) map.set(ev, new Set()); map.get(ev).add(fn); return () => map.get(ev).delete(fn); },
      emit(ev, payload) { (map.get(ev) || []).forEach(fn => fn(payload)); }
    };
  })();

  // expose to child module
  window.ReflectivShared = {
    BASE,               // folder where widget.js lives
    COACH_ENDPOINT,     // server endpoint
    ALORA_ENDPOINT,
    fetchJSON,
    debounce,
    bus,
    // helpers for absolute/relative joining if needed
    join: (rel) => (new URL(rel, BASE)).toString()
  };

  // ---- mount when DOM is ready ----
  ready(() => {
    const host = document.getElementById('reflectiv-widget');
    if (!host) {
      console.warn('[ReflectivAI] #reflectiv-widget not found. Nothing to mount.');
      return;
    }

    // Build a RELATIVE URL to assets/chat/coach.js next to the current BASE.
    // Works on: https://<user>.github.io/reflectiv-ai/
    const coachUrl = new URL('assets/chat/coach.js', BASE).toString();

    import(coachUrl)
      .then((mod) => {
        const mount = (mod.default && mod.default.mountCoach) ? mod.default.mountCoach
                    : (mod.mountCoach || mod.default || mod.mount);
        if (typeof mount !== 'function') throw new Error('coach.js missing mount function');
        // Provide host element id for mounting.
        mount('reflectiv-widget');
      })
      .catch((err) => {
        console.error('[ReflectivAI] coach.js load failed:', err);
        // graceful fallback UI
        host.innerHTML = [
          '<div style="border:1px solid #e6ecf3;border-radius:12px;padding:16px;background:#fff">',
          '<div style="font-weight:800;color:#0c2740;margin-bottom:6px">ReflectivAI Coach</div>',
          '<p style="margin:0;color:#314159">The coach module failed to load. Please refresh with cache disabled.',
          ' If this persists, verify that <code>assets/chat/coach.js</code> exists and that ',
          '<code>widget.js</code> imports it with a relative URL.</p>',
          '</div>'
        ].join('');
      });
  });
})();
