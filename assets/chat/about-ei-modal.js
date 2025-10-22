<script>
/* About-EI Modal loader — zero-dep, non-destructive
 * Loads /assets/chat/about-ei.md and renders to a modal.
 * Works even if your page has no frameworks.
 */
(function(){
  // ---- inject minimal styles (scoped via #about-ei-modal) ----
  const css = `
#about-ei-modal{position:fixed;inset:0;z-index:9999;display:none}
#about-ei-modal.show{display:block}
#about-ei-modal .backdrop{position:absolute;inset:0;background:rgba(0,0,0,.5)}
#about-ei-modal .panel{position:relative;max-width:900px;margin:5vh auto;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(12,39,64,.25);padding:24px}
#about-ei-modal .close{position:absolute;top:10px;right:12px;background:#0c2740;color:#fff;border:none;border-radius:8px;padding:6px 10px;cursor:pointer}
#about-ei-modal .body{max-height:75vh;overflow:auto;color:#1e2a3a;line-height:1.6}
#about-ei-modal h1{font-size:24px;margin:8px 0 12px}
#about-ei-modal h2{font-size:20px;margin:16px 0 8px}
#about-ei-modal h3{font-size:16px;margin:12px 0 6px}
#about-ei-modal p{margin:10px 0}
#about-ei-modal ul{padding-left:20px;margin:8px 0}
#about-ei-modal li{margin:4px 0}
#about-ei-modal code{background:#ecf3fb;padding:2px 6px;border-radius:6px}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  // ---- create modal shell once ----
  const modal = document.createElement('div');
  modal.id = 'about-ei-modal';
  modal.innerHTML = `
    <div class="backdrop" data-close></div>
    <div class="panel">
      <button class="close" data-close aria-label="Close">Close</button>
      <article class="body" id="about-ei-body">Loading…</article>
    </div>`;
  document.body.appendChild(modal);

  // ---- tiny Markdown → HTML (headings, bold, lists, code, paragraphs) ----
  function mdToHtml(t){
    let s = String(t||'').replace(/\r\n?/g,'\n');
    s = s.replace(/^```([\s\S]*?)^```/gm, (_,code)=>`<pre><code>${code.replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]))}</code></pre>`);
    s = s.replace(/^### (.*)$/gm,'<h3>$1</h3>')
         .replace(/^## (.*)$/gm,'<h2>$1</h2>')
         .replace(/^# (.*)$/gm,'<h1>$1</h1>')
         .replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>')
         .replace(/^- (.*)$/gm,'<li>$1</li>');
    // wrap contiguous <li> into <ul>
    s = s.replace(/(?:^|\n)(<li>[\s\S]*?<\/li>)(?=\n(?!<li>)|$)/g, (m,grp)=>`\n<ul>\n${grp}\n</ul>`);
    // paragraphs
    s = s.split(/\n{2,}/).map(p => /^(<h\d|<ul>|<li>|<pre>|<strong>)/.test(p)? p : `<p>${p}</p>`).join('\n');
    return s;
  }

  async function loadAndShow(){
    const body = document.getElementById('about-ei-body');
    body.innerHTML = 'Loading…';
    try{
      const r = await fetch('/assets/chat/about-ei.md', {cache:'no-store'});
      if(!r.ok) throw new Error('HTTP '+r.status);
      const md = await r.text();
      body.innerHTML = mdToHtml(md);
    }catch(e){
      body.innerHTML = `<p>Failed to load About EI content.</p><p><code>${String(e.message||e)}</code></p>`;
    }
    modal.classList.add('show');
  }

  function hide(){ modal.classList.remove('show'); }

  // global entrypoint so any button can open it
  window.openAboutEI = loadAndShow;

  modal.addEventListener('click', (e)=>{ if(e.target.dataset.close!==undefined) hide(); });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') hide(); });

})();
</script>
