/* ReflectivAI Chat/Coach — drop-in widget (v20251020-7) */
/* No auto-open. Esc/backdrop close. Worker optional (stub fallback). */

(function(){
  function onReady(fn){ if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",fn,{once:true}); else fn(); }
  const WORKER = window.WORKER_URL || '';                                // set in index.html
  const CHAT_ENDPOINT = window.COACH_ENDPOINT || (WORKER ? WORKER+'/chat' : '');

  function el(tag, cls, txt){ const n=document.createElement(tag); if(cls) n.className=cls; if(txt!=null) n.textContent=txt; return n; }

  function buildModal(){
    let modal = document.getElementById('reflectiv-modal');
    if(modal) return modal;

    modal = el('div'); modal.id='reflectiv-modal'; modal.hidden=true;

    const backdrop = el('div'); backdrop.id='reflectiv-modal-backdrop';
    const chat = el('div','reflectiv-chat');

    const title = el('div','coach-titlebar');
    title.append(el('div','', 'Reflectiv Coach'));
    const closeBtn = el('button','close-btn','Close');
    closeBtn.onclick = () => close();
    title.append(closeBtn);

    const sub = el('div','coach-subbar','ReflectivAI Coach');

    const body = el('div','coach-body');

    // left controls
    const controls = el('aside','controls-slab');
    controls.innerHTML = `
      <div><div class="label">Learning Center Mode</div>
        <select id="cw-mode">
          <option>Role Play w/ AI Agent</option>
          <option>Product Knowledge</option>
          <option>Emotional Assessment</option>
        </select>
      </div>
      <div><div class="label">Disease State</div>
        <select id="cw-disease">
          <option>Oncology</option>
          <option>HIV</option>
          <option>Vaccines</option>
        </select>
      </div>
      <div><div class="label">HCP Profile</div>
        <select id="cw-hcp">
          <option>Internal Medicine MD</option>
          <option>Nurse Practitioner</option>
          <option>Oncologist</option>
        </select>
      </div>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px;">
        <input type="checkbox" id="cw-scoring" checked> Scoring
      </label>
    `;

    // center chat
    const chatSlab = el('section','chat-slab');
    const brief = el('div','brief');
    brief.innerHTML = `
      <div class="row"><strong>HCP Background:</strong> <span id="brief-bg">Practical, time-constrained.</span></div>
      <div class="row"><strong>Today’s Goal:</strong> <span id="brief-goal">Practice concise value, ask 1 needs question.</span></div>
    `;
    const transcript = el('div','transcript');
    const composer = el('div','composer');
    const input = document.createElement('textarea'); input.placeholder = 'Type your message...';
    const send = el('button','send-btn','Send');
    composer.append(input, send);
    chatSlab.append(brief, transcript, composer);

    // right metrics
    const metrics = el('aside','metrics-slab');
    metrics.innerHTML = `
      <div class="metric"><h5>Empathy</h5><div class="value" id="m-empathy">—</div></div>
      <div class="metric"><h5>Accuracy</h5><div class="value" id="m-accuracy">—</div></div>
      <div class="metric"><h5>Confidence</h5><div class="value" id="m-confidence">—</div></div>
      <div class="metric"><h5>Compliance</h5><div class="value" id="m-compliance">—</div></div>
      <div class="metric"><h5>Readiness</h5><div class="value" id="m-readiness">—</div></div>
    `;

    body.append(controls, chatSlab, metrics);
    chat.append(title, sub, body);

    // coach feedback
    const panel = el('div','coach-panel');
    panel.innerHTML = `<h6>Coach Feedback</h6><ul id="coach-tips"><li>Start with a single-value opener.</li><li>Ask one needs question.</li></ul>`;
    chatSlab.append(panel);

    modal.append(backdrop, chat);
    document.body.appendChild(modal);

    // close mechanics
    function close(){ modal.hidden = true; }
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', (e)=>{ if(!modal.hidden && e.key==='Escape') close(); });

    // height guard
    const setH=()=>{ chat.style.maxHeight=Math.floor(window.innerHeight*0.78)+'px'; };
    setH(); window.addEventListener('resize', setH, { passive:true });

    // brief updater
    function updateBrief(){
      const mode = document.getElementById('cw-mode').value;
      const disease = document.getElementById('cw-disease').value;
      const profile = document.getElementById('cw-hcp').value;
      const bgMap = { Oncology:'Practical, time-constrained.', HIV:'Evidence-seeking, cautious.', Vaccines:'Community-minded, throughput-focused.' };
      const goalMap = {
        'Role Play w/ AI Agent':'Practice concise value, ask 1 needs question.',
        'Product Knowledge':'State one on-label benefit accurately.',
        'Emotional Assessment':'Demonstrate empathy and clarify one concern.'
      };
      document.getElementById('brief-bg').textContent = bgMap[disease] || 'Professional, efficiency-focused.';
      document.getElementById('brief-goal').textContent = goalMap[mode] || 'Deliver concise value and one clear ask.';
      return { mode, disease, profile };
    }
    ['cw-mode','cw-disease','cw-hcp'].forEach(id=>{
      controls.querySelector('#'+id).addEventListener('change', updateBrief);
    });
    updateBrief();

    // chat helpers
    function pushBubble(text, who){
      const b = el('div','bubble '+(who==='user'?'user':'bot'));
      b.textContent = text; transcript.append(b); transcript.scrollTop = transcript.scrollHeight;
    }
    function pushCoachTips(tips){
      const list=document.getElementById('coach-tips'); if(!list) return;
      list.innerHTML = tips.map(t=>`<li>${t}</li>`).join('');
    }
    function deriveTips(userMsg, respText){
      const t=[]; if(!/question\??/i.test(userMsg)) t.push('Ask a single needs question to invite dialogue.');
      if(userMsg.length>220) t.push('Tighten your opener to <15s. Lead with value.');
      if(!/on[- ]label|indication|safety|isi/i.test(respText)) t.push('Anchor to on-label language and safety context.');
      if(t.length===0) t.push('Good pacing. Confirm understanding, then propose a short follow-up.');
      return t;
    }
    function setMetrics(obj){
      const set=(id,v)=>{ const n=document.getElementById(id); if(n) n.textContent=String(v ?? '—'); };
      set('m-empathy', obj.empathy);
      set('m-accuracy', obj.accuracy);
      set('m-confidence', obj.confidence);
      set('m-compliance', obj.compliance);
      set('m-readiness', obj.readiness);
    }

    async function callCoach(messages){
      if(!CHAT_ENDPOINT){ return { role:'assistant', content:'[Stub] No worker endpoint configured.' }; }
      try{
        const r = await fetch(CHAT_ENDPOINT, {
          method:'POST',
          headers:{'content-type':'application/json'},
          body: JSON.stringify({ site:'reflectivai', messages, model:'llama-3.1-8b-instant', temperature:0.5 }),
          mode:'cors', credentials:'omit'
        });
        if(!r.ok) throw new Error('HTTP '+r.status);
        return await r.json();
      }catch(e){
        console.error('Coach call failed:', e);
        return { role:'assistant', content:'[Stub] Worker unreachable. Using local coaching rules.' };
      }
    }

    async function sendNow(){
      const input = composer.querySelector('textarea');
      const msg = (input.value || '').trim(); if(!msg) return;
      pushBubble(msg,'user'); input.value='';

      const ctx = updateBrief();
      const sys = [
        { role:'system', content:'You are ReflectivAI, a Life Sciences Sales Coach. Keep responses concise and compliant.' },
        { role:'system', content:`Context: Mode=${ctx.mode}; Disease=${ctx.disease}; HCP=${ctx.profile}.` }
      ];

      const resp = await callCoach(sys.concat([{ role:'user', content: msg }]));
      const text = resp && resp.content ? String(resp.content) : 'No response.';
      pushBubble(text,'bot');
      pushCoachTips(deriveTips(msg, text));

      const scores = {
        empathy: 70 + (msg.match(/feel|concern|understand/i)?10:0),
        accuracy: 60,
        confidence: 80,
        compliance: /label|isi|indication/i.test(text) ? 78 : 70,
        readiness: 64
      };
      setMetrics(scores);
    }

    send.addEventListener('click', sendNow);
    composer.querySelector('textarea').addEventListener('keydown', (e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendNow(); }});

    // public API
    function open(){ modal.hidden=false; setTimeout(()=>composer.querySelector('textarea').focus(),0); }
    function close(){ modal.hidden=true; }

    window.ReflectivCoach = { open, close };
    return modal;
  }

  onReady(()=>{
    buildModal();                           // builds, does not open
    // Optional launcher support: any element with data-coach-launch
    const trigger = document.querySelector('[data-coach-launch]');
    if(trigger) trigger.addEventListener('click', ()=>window.ReflectivCoach.open());
  });
})();
