/* ReflectivAI — widget bootstrap (GitHub Pages-safe, Cloudflare-safe) */

(() => {
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  // ---------- compute correct base ----------
  const scriptSrc = document.currentScript?.src || location.href;
  // force-trim until the repo root (reflectiv-ai)
  const BASE = scriptSrc.includes("/reflectiv-ai/")
    ? scriptSrc.split("/reflectiv-ai/")[0] + "/reflectiv-ai/"
    : scriptSrc.replace(/\/[^/]*$/, "/");

  const COACH_ENDPOINT = window.COACH_ENDPOINT || "/coach";
  const ALORA_ENDPOINT = window.ALORA_ENDPOINT || "/alora";

  // ---------- shared helpers ----------
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

  // expose to coach.js
  window.ReflectivShared = {
    BASE,
    COACH_ENDPOINT,
    ALORA_ENDPOINT,
    fetchJSON,
    debounce,
    bus,
    join: (rel) => new URL(rel, BASE).toString(),
  };

  // ---------- mount ----------
  ready(() => {
    const host = document.getElementById("reflectiv-widget");
    if (!host) {
      console.warn("[ReflectivAI] no #reflectiv-widget element found.");
      return;
    }

    // construct full URL safely under /reflectiv-ai/
    const coachUrl = `${BASE}assets/chat/coach.js`;

    import(coachUrl)
      .then((mod) => {
        const mount =
          (mod.default && mod.default.mountCoach) ||
          mod.mountCoach ||
          mod.default ||
          mod.mount;
        if (typeof mount !== "function")
          throw new Error("coach.js missing mount function");
        mount("reflectiv-widget");
      })
      .catch((err) => {
        console.error("[ReflectivAI] coach.js load failed:", err);
        host.innerHTML = `
          <div style="border:1px solid #e6ecf3;border-radius:12px;padding:16px;background:#fff">
            <div style="font-weight:800;color:#0c2740;margin-bottom:6px">ReflectivAI Coach</div>
            <p style="margin:0;color:#314159">
              Coach module failed to load.<br>
              Path tried: <code>${coachUrl}</code><br>
              Check that file exists in <code>assets/chat/coach.js</code>
              and that you committed + published main branch.
            </p>
          </div>`;
      });
  });
})();
