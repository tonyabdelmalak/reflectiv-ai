/* ReflectivAI — widget bootstrap with resilient coach loader */

(() => {
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  // endpoints (worker)
  const COACH_ENDPOINT = window.COACH_ENDPOINT || "/coach";
  const ALORA_ENDPOINT = window.ALORA_ENDPOINT || "/alora";

  // shared helpers exposed for coach.js
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

  // compute bases
  const scriptSrc = document.currentScript?.src || location.href;
  const ORIGIN = location.origin; // https://reflectivei.github.io
  const REPO = "/reflectiv-ai/";  // GitHub Pages repo base

  function join(base, rel) {
    return new URL(rel, base).toString();
  }

  // candidate URLs to try for coach.js, in order
  function coachCandidates() {
    const v = `?v=${Date.now()}`;
    return [
      // under repo base
      join(ORIGIN + REPO, "assets/chat/coach.js" + v),
      // relative to current page
      join(location.href, "assets/chat/coach.js" + v),
      // origin root (if site moved to apex)
      join(ORIGIN + "/", "assets/chat/coach.js" + v),
    ];
  }

  // expose shared utilities
  window.ReflectivShared = {
    BASE: ORIGIN + REPO,
    COACH_ENDPOINT,
    ALORA_ENDPOINT,
    fetchJSON,
    debounce,
    bus,
    join,
  };

  // simple error panel
  function renderLoadError(host, tried) {
    host.innerHTML = `
      <div style="border:1px solid #e6ecf3;border-radius:12px;padding:16px;background:#fff">
        <div style="font-weight:800;color:#0c2740;margin-bottom:8px">ReflectivAI Coach</div>
        <p style="margin:0 0 6px;color:#314159">Coach module failed to load.</p>
        <div style="font-family:ui-monospace,Consolas,monaco,monospace;font-size:12px;color:#223">
          Tried:<br>${tried.map(u=>`<div>${u}</div>`).join("")}
        </div>
        <p style="margin-top:8px;color:#314159">
          Ensure <code>assets/chat/coach.js</code> exists in the published branch and that GitHub Pages has finished building.
        </p>
      </div>`;
  }

  // try dynamic imports sequentially
  async function importFirst(urls) {
    const errs = [];
    for (const u of urls) {
      try {
        // HEAD first to avoid opaque import errors on 404
        const head = await fetch(u, { method: "HEAD" });
        if (!head.ok) throw new Error(`HTTP ${head.status}`);
        // then import
        return { mod: await import(/* @vite-ignore */ u), url: u };
      } catch (e) {
        errs.push(`${u} → ${e.message || e}`);
      }
    }
    throw new Error(errs.join(" | "));
  }

  // mount
  ready(async () => {
    const host = document.getElementById("reflectiv-widget");
    if (!host) {
      console.warn("[ReflectivAI] #reflectiv-widget not found.");
      return;
    }

    const tries = coachCandidates();
    try {
      const { mod, url } = await importFirst(tries);
      const mount =
        (mod.default && (mod.default.mountCoach || mod.default)) ||
        mod.mountCoach ||
        mod.mount;

      if (typeof mount !== "function")
        throw new Error("coach.js missing exported mount function");

      mount("reflectiv-widget");
      console.info("[ReflectivAI] coach.js loaded from", url);
    } catch (e) {
      console.error("[ReflectivAI] coach loader error:", e);
      renderLoadError(host, tries);
    }
  });
})();
