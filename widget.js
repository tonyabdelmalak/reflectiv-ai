/* ReflectivAI — widget bootstrap (loader + shared utils). */
(() => {
  const ready = (fn) => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  };

  // base beside this script (works on GitHub Pages /reflectiv-ai/)
  const scriptSrc = document.currentScript && document.currentScript.src ? document.currentScript.src : location.href;
  const BASE = scriptSrc.replace(/\/[^/]*$/, '/');

  const COACH_ENDPOINT = window.COACH_ENDPOINT || '/coach';
  const ALORA_ENDPOINT = window.ALORA_ENDPOINT || '/alora';

  const cache = new Map();
  async function fetchJSON(url, opts = {}) {
    const key = `${url}|${opts.method || 'GET'}`;
    if (!opts.noCache && cache.has(key)) return cache.get(key);
    const res = await fetch(url, { headers: { 'Accept': 'application/json', ...(opts.headers || {}) }, ...opts });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const json = await res.json();
    if (!opts.noCache) cache.set(key, json);
    return json;
  }
  const debounce = (fn, ms = 200) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms);} };
  const bus = (()=>{ const m=new Map(); return { on:(e,f)=>{if(!m.has(e))m.set(e,new Set());m.get(e).add(f);return()=>m.get(e).delete(f)}, emit:(e,p)=>{(m.get(e)||[]).forEach(f=>f(p))} };})();

  window.ReflectivShared = {
    BASE, COACH_ENDPOINT, ALORA_ENDPOINT, fetchJSON, debounce, bus,
    join: (rel) => (new URL(rel, BASE)).toString()
  };

  ready(() => {
    const host = document.getElementById('reflectiv-widget');
    if (!host) return;

    const coachUrl = new URL('assets/chat/coach.js', BASE).toString();

    import(coachUrl).then((mod) => {
      const mount = (mod.default && mod.default.mountCoach) ? mod.default.mountCoach
                  : (mod.mountCoach || mod.default || mod.mount);
      if (typeof mount !== 'function') throw new Error('coach.js missing mount function');
      mount('reflectiv-widget'); // mount into the modal body
    }).catch((err) => {
      console.error('[ReflectivAI] coach.js load failed:', err);
      host.innerHTML = `
        <div style="border:1px solid #e6ecf3;border-radius:12px;padding:16px;background:#fff">
          <div style="font-weight:800;color:#0c2740;margin-bottom:6px">ReflectivAI Coach</div>
          <p style="margin:0;color:#314159">
            The coach module failed to load. Hard refresh with cache disabled.
            Verify <code>assets/chat/coach.js</code> exists and widget.js uses a relative import.
          </p>
        </div>`;
    });
  });
})();
