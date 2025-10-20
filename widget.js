/* ReflectivAI — resilient bootstrap (classic script injection, no ESM) */
(() => {
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  // worker endpoints
  const COACH_ENDPOINT = window.COACH_ENDPOINT || "/coach";
  const ALORA_ENDPOINT = window.ALORA_ENDPOINT || "/alora";

  // shared helpers for coach.js
  const cache = new Map();
  async function fetchJSON(url, opts = {}) {
    const key = `${url}|${opts.method || "GET"}`;
    if (!opts.noCache && cache.has(key)) return cache.get(key);
    const res = await fetch(url, {
      headers: { Accept: "application/json", ...(opts.headers || {}) },
      ...opts,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const json = await res.json();
    if (!opts.noCache) cache.set(key, json);
    return json;
  }
  const debounce = (fn, ms = 200) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };
  const bus = (() => {
    const m = new Map();
    return {
      on: (e, f) => {
        if (!m.has(e)) m.set(e, new Set());
        m.get(e).add(f);
        return () => m.get(e).delete(f);
      },
      emit: (e, p) => (m.get(e) || []).forEach((f) => f(p)),
    };
  })();

  // expose to coach.js (IIFE reads window.ReflectivShared)
  window.ReflectivShared = {
    COACH_ENDPOINT,
    ALORA_ENDPOINT,
    fetchJSON,
    debounce,
    bus,
  };

  // ---------- classic script loader (tries multiple paths) ----------
  function coachCandidates() {
    const v = `?v=${Date.now()}`;
    const base = location.origin + "/reflectiv-ai/";
    return [
      base + "assets/chat/coach.js" + v, // GitHub Pages repo base
      location.origin + "/assets/chat/coach.js" + v, // origin root (just in case)
      "assets/chat/coach.js" + v, // relative to document
    ];
  }

  function injectScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve(src);
      s.onerror = () => reject(new Error(`load failed: ${src}`));
      document.head.appendChild(s);
    });
  }

  async function loadCoachClassic(urls) {
    const errors = [];
    for (const u of urls) {
      try {
        // quick existence check
        const h = await fetch(u, { method: "HEAD" });
        if (!h.ok) throw new Error(`HTTP ${h.status}`);
        await injectScript(u);
        return u;
      } catch (e) {
        errors.push(`${u} → ${e.message || e}`);
      }
    }
    throw new Error(errors.join(" | "));
  }

  function renderLoadError(host, tried) {
    host.innerHTML = `
      <div style="border:1px solid #e6ecf3;border-radius:12px;padding:16px;background:#fff">
        <div style="font-weight:800;color:#0c2740;margin-bottom:8px">ReflectivAI Coach</div>
        <p style="margin:0 0 6px;color:#314159">Coach module failed to load.</p>
        <div style="font-family:ui-monospace,Consolas,monaco,monospace;font-size:12px;color:#223">
          Tried:<br>${tried.map(u=>`<div>${u}</div>`).join("")}
        </div>
        <p style="margin-top:8px;color:#314159">
          Confirm <code>assets/chat/coach.js</code> is published by GitHub Pages. If this still 404s, push any small commit to trigger a Pages rebuild.
        </p>
      </div>`;
  }

  // call whichever global the coach registers
  function callMount(targetId) {
    const g =
      (window.ReflectivCoach && (window.ReflectivCoach.mount || window.ReflectivCoach.mountCoach)) ||
      window.mountCoach ||
      (window.COACH && window.COACH.mount);

    if (typeof g !== "function") throw new Error("mount function not found");
    g(targetId);
  }

  // ---------- mount on DOM ready ----------
  ready(async () => {
    const host = document.getElementById("reflectiv-widget");
    if (!host) return;

    const tries = coachCandidates();
    try {
      const url = await loadCoachClassic(tries);

      // give the IIFE a tick to attach globals, then mount
      setTimeout(() => {
        try {
          callMount("reflectiv-widget");
          console.info("[ReflectivAI] coach.js loaded from", url);
        } catch (e) {
          console.error("[ReflectivAI] coach mount error:", e);
          renderLoadError(host, tries);
        }
      }, 0);
    } catch (e) {
      console.error("[ReflectivAI] coach loader error:", e);
      renderLoadError(host, tries);
    }
  });
})();
