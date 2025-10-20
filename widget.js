/* ReflectivAI — widget bootstrap with resilient coach loader (auto repo base) */

(() => {
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  const COACH_ENDPOINT = window.COACH_ENDPOINT || "/coach";
  const ALORA_ENDPOINT = window.ALORA_ENDPOINT || "/alora";

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

  // auto-detect GitHub Pages repo base: "/<repo>/" or "/" for apex
  function detectRepoBase() {
    // pathname like "/reflectiv-ai/index.html" -> "/reflectiv-ai/"
    const seg = location.pathname.split("/").filter(Boolean);
    if (seg.length > 0) return `/${seg[0]}/`;
    return "/";
  }
  const ORIGIN = location.origin;
  const REPO = detectRepoBase();

  function join(base, rel) {
    return new URL(rel, base).toString();
  }

  function coachCandidates() {
    const v = `?v=${Date.now()}`;
    return [
      join(ORIGIN + REPO, "assets/chat/coach.js" + v),
      join(location.href, "assets/chat/coach.js" + v),
      join(ORIGIN + "/", "assets/chat/coach.js" + v),
    ];
  }

  window.ReflectivShared = {
    BASE: ORIGIN + REPO,
    COACH_ENDPOINT,
    ALORA_ENDPOINT,
    fetchJSON,
    debounce,
    bus,
    join,
  };

  function renderLoadError(host, tried) {
    host.innerHTML = `
      <div style="border:1px solid #e6ecf3;border-radius:12px;padding:16px;background:#fff">
        <div style="font-weight:800;color:#0c2740;margin-bottom:8px">ReflectivAI Coach</div>
        <p style="margin:0 0 6px;color:#314159">Coach module failed to load.</p>
        <div style="font-family:ui-monospace,Consolas,monaco,monospace;font-size:12px;color:#223">
          Tried:<br>${tried.map(u=>`<div>${u}</div>`).join("")}
        </div>
        <p style="margin-top:8px;color:#314159">
          Ensure <code>assets/chat/coach.js</code> exists in the published branch and Pages cache is clear.
        </p>
      </div>`;
  }

  async function importFirst(urls) {
    const errs = [];
    for (const u of urls) {
      try {
        const head = await fetch(u, { method: "HEAD", cache: "no-store" });
        if (!head.ok) throw new Error(`HTTP ${head.status}`);
        return { mod: await import(/* @vite-ignore */ u), url: u };
      } catch (e) {
        errs.push(`${u} → ${e.message || e}`);
      }
    }
    throw new Error(errs.join(" | "));
  }

  ready(async () => {
    const host = document.getElementById("reflectiv-widget");
    if (!host) return;

    const tries = coachCandidates();
    try {
      const { mod, url } = await importFirst(tries);
      const mount =
        (mod.default && (mod.default.mountCoach || mod.default)) ||
        mod.mountCoach ||
        mod.mount;
      if (typeof mount !== "function") throw new Error("coach.js missing mount()");
      mount("reflectiv-widget");
      console.info("[ReflectivAI] coach.js loaded from", url);
    } catch (e) {
      console.error("[ReflectivAI] coach loader error:", e);
      renderLoadError(host, tries);
    }
  });
})();
