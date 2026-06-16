/* ===== chat.js — Chat AI Assistant (primary hub) ===== */
(function(){
  const {icon,sparkmark,riskChip,data,money,fmt,navigate,reduce} = SP;
  const SMARK = sparkmark(16);

  const css = `
.chatwrap{display:flex;height:100%;}
.threadrail{width:226px;flex:none;border-right:1px solid var(--border-soft);padding:14px 10px;overflow-y:auto;display:flex;flex-direction:column;gap:3px;}
.threadrail .newchat{display:flex;align-items:center;gap:8px;padding:9px 11px;border-radius:9px;border:1px solid var(--border);
  font-size:13px;font-weight:600;color:var(--foreground);cursor:pointer;margin-bottom:8px;background:var(--card);}
.threadrail .newchat:hover{border-color:var(--primary);}
.threaditem{padding:9px 11px;border-radius:9px;cursor:pointer;}
.threaditem:hover{background:var(--muted);}
.threaditem.active{background:var(--spark-subtle);}
.threaditem .tt{font-size:13px;font-weight:500;color:var(--foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.threaditem .ts{font-size:11px;color:var(--muted-foreground);margin-top:2px;}
.chatcol{flex:1;min-width:0;display:flex;flex-direction:column;}
.chatscroll{flex:1;overflow-y:auto;padding:24px 24px 8px;}
.chatstream{max-width:680px;margin:0 auto;display:flex;flex-direction:column;gap:18px;}
.ctx{width:290px;flex:none;border-left:1px solid var(--border-soft);padding:18px;overflow-y:auto;display:flex;flex-direction:column;gap:14px;}
.ctx .ctx-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px;}
.ctx .ck{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted-foreground);margin-bottom:9px;}

.cturn{display:flex;gap:11px;}
.cturn.user{justify-content:flex-end;}
.cturn .cav{width:28px;height:28px;border-radius:50%;background:var(--spark-subtle);display:grid;place-items:center;flex:none;border:1px solid color-mix(in srgb,var(--primary) 25%,transparent);}
.cbubble-user{background:var(--card-2);border:1px solid var(--border);border-radius:14px 14px 4px 14px;padding:10px 14px;font-size:14.5px;max-width:78%;}
.cname{font-size:11.5px;font-weight:600;color:var(--primary);margin-bottom:5px;}
.ctext{font-size:15px;line-height:1.55;}
.ctext .soft{color:var(--muted-foreground);}

.ccard{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;margin-top:6px;max-width:600px;}
.ccard .ch{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:11px;}
.ccard .rank{font-size:11px;font-weight:600;background:var(--muted);border-radius:999px;padding:3px 9px;color:var(--foreground);}
.ccard .cthesis{font-size:14px;line-height:1.55;margin-bottom:13px;}
.ccard .crow{display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:13px;}
.ccard .capy .big{font-size:24px;font-weight:600;letter-spacing:-.01em;line-height:1;}
.ccard .capy .lbl{font-size:11px;color:var(--muted-foreground);margin-top:4px;}
.cite{display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--primary);border:1px solid color-mix(in srgb,var(--primary) 28%,transparent);background:var(--spark-subtle);border-radius:999px;padding:2px 6px;cursor:pointer;}
.cact{display:flex;gap:9px;margin-top:4px;}
.cnote{font-size:11.5px;color:var(--muted-foreground);margin-bottom:12px;}
.whyrow{margin-top:12px;border-top:1px solid var(--border-soft);padding-top:11px;font-size:13px;}
.whytrig{display:flex;align-items:center;gap:7px;color:var(--primary);cursor:pointer;font-weight:500;background:none;border:none;font-family:inherit;padding:0;}
.whybd{font-size:12.5px;line-height:1.6;color:var(--muted-foreground);margin-top:9px;max-height:0;overflow:hidden;transition:max-height .3s;}
.whybd.open{max-height:260px;}
.feedback{display:flex;gap:6px;margin-top:8px;}
.fbtn{width:28px;height:28px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--muted-foreground);cursor:pointer;display:grid;place-items:center;}
.fbtn:hover{border-color:var(--primary);color:var(--foreground);}
.fbtn.on{border-color:var(--primary);background:var(--spark-subtle);color:var(--primary);}

.chips{display:flex;gap:8px;overflow-x:auto;padding:10px 0;}
.chips .chip{flex:none;}
.composer-wrap{padding:8px 24px 16px;}
.composer{max-width:680px;margin:0 auto;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:8px 8px 8px 16px;display:flex;align-items:flex-end;gap:10px;}
.composer:focus-within{border-color:var(--primary);box-shadow:0 0 0 3px var(--spark-subtle);}
.composer textarea{flex:1;background:none;border:none;outline:none;resize:none;color:var(--foreground);font-size:15px;font-family:inherit;line-height:1.5;max-height:120px;padding:8px 0;}
.sendbtn{width:38px;height:38px;border-radius:10px;background:var(--primary);color:var(--primary-foreground);border:none;cursor:pointer;display:grid;place-items:center;flex:none;}
.sendbtn:disabled{opacity:.4;cursor:not-allowed;}
.cdisc{max-width:680px;margin:8px auto 0;font-size:11px;color:var(--muted-foreground);text-align:center;}
.qlink{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:8px;cursor:pointer;font-size:13px;color:var(--muted-foreground);}
.qlink:hover{background:var(--muted);color:var(--foreground);}
.qlink svg{width:16px;height:16px;}
@media(max-width:1279px){.ctx{display:none;}}
@media(max-width:1023px){.threadrail{display:none;}.chatscroll{padding:16px 14px 4px;}.composer-wrap{padding:6px 14px 12px;}.ccard{max-width:100%;}}
`;
  const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

  let stream, scroller;
  function scrollDown(){ scroller && scroller.scrollTo({top:scroller.scrollHeight,behavior:reduce?'auto':'smooth'}); }
  function animIn(n){ if(reduce||typeof gsap==='undefined'){n.style.opacity=1;return;} gsap.fromTo(n,{opacity:0,y:12},{opacity:1,y:0,duration:.4,ease:'power2.out'}); setTimeout(()=>{n.style.opacity=1;n.style.transform='none';},650); }
  function aiTurn(html){ const t=document.createElement('div'); t.className='cturn ai';
    t.innerHTML=`<div class="cav">${SMARK}</div><div style="flex:1;min-width:0"><div class="cname">SparkPoint AI</div>${html}</div>`;
    stream.appendChild(t); animIn(t); scrollDown(); return t; }
  function userTurn(text){ const t=document.createElement('div'); t.className='cturn user';
    t.innerHTML=`<div class="cbubble-user">${text}</div>`; stream.appendChild(t); animIn(t); scrollDown(); return t; }
  function thinking(steps,done){
    const t=document.createElement('div'); t.className='cturn ai';
    t.innerHTML=`<div class="cav">${SMARK}</div><div style="flex:1"><div class="cname">SparkPoint AI</div><div class="think"></div></div>`;
    stream.appendChild(t); animIn(t); const box=t.querySelector('.think'); let i=0;
    (function next(){ if(i>=steps.length){setTimeout(()=>{t.remove();done&&done();},240);return;}
      const r=document.createElement('div'); r.style.cssText='display:flex;align-items:center;gap:9px;font-size:13px;color:var(--muted-foreground);padding:3px 0';
      r.innerHTML=`<span class="ai-dot"></span><span>${steps[i].a}…</span>`; box.appendChild(r); scrollDown();
      setTimeout(()=>{ r.querySelector('.ai-dot').outerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gain)" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>`;
        r.querySelector('span:last-child').textContent=steps[i].b; i++; setTimeout(next,reduce?60:220); }, reduce?120:480);
    })();
  }

  // ----- cards -----
  function recCard(){
    return `<div class="ccard" data-card="rec">
      <div class="ch"><span class="rank">Best fit · #1 vs your goal</span><span class="badge badge-ai">AI suggestion — you approve &amp; sign</span></div>
      <div class="cthesis">Aave's USDC rate rose to <b>4.3% net APY</b>. Moving your idle <span class="tnum">2,150 USDC</span> in could earn more, at the same low risk.</div>
      <div class="crow">
        <div class="capy"><div class="big tnum">4.3% <span class="cite" data-cite>${icon('check',10)} Based on Aave · 2m</span></div><div class="lbl">net APY · = 4.3% Aave supply − 0% fee</div></div>
        ${riskChip(1)}
      </div>
      <div class="cnote">Fits your plan: lower risk, steady yield. · Estimates, not guarantees.</div>
      <div class="cact"><button class="btn btn-primary btn-md" data-act="review">Review this move</button><button class="btn btn-ghost btn-md" data-act="notnow">Not now</button></div>
      <div class="whyrow"><button class="whytrig" data-why>${icon('info',14)} Why this?</button><div class="whybd">Your mandate is lower-risk, capital-preservation-first. This keeps 100% in the audited Aave vault (Risk 1), satisfies your beta cap and slippage guardrails, and raises yield without changing your risk tier. The tradeoff: yield floats with the Aave rate.</div></div>
      <div class="feedback"><button class="fbtn" data-fb="up">${icon('up',15)}</button><button class="fbtn" data-fb="down">${icon('down',15)}</button></div>
    </div>`;
  }
  function snapshotCard(){
    const a=data.allocation, total=a.reduce((s,x)=>s+x.v,0);
    const bars=a.map(x=>`<div style="height:8px;border-radius:4px;background:var(${x.risk===0?'--muted-foreground':SP.TIER[x.risk].v});flex:${x.v}" title="${x.k}"></div>`).join('');
    return `<div class="ccard" data-card="snap">
      <div class="ch"><span style="font-size:13px;font-weight:600">Your portfolio</span><span style="font-size:11px;color:var(--muted-foreground)" class="grow" >as of 2m ago</span></div>
      <div style="display:flex;align-items:flex-end;gap:14px;margin-bottom:12px">
        <div><div style="font-size:26px;font-weight:600" class="tnum">${money(data.netWorth)}</div><div style="font-size:11px;color:var(--muted-foreground)">net worth</div></div>
        <div class="delta up" style="margin-bottom:3px">${icon('up',14)}+${money(data.pnl.abs)} (+${data.pnl.pct}%, ${data.pnl.window})</div>
      </div>
      <div style="display:flex;gap:4px;margin-bottom:8px">${bars}</div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted-foreground);margin-bottom:13px">
        <span>Aave vault ${money(data.allocation[0].v)}</span><span>Idle ${money(data.allocation[1].v)}</span></div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:13px">${riskChip(1)}<span style="font-size:12.5px;color:var(--muted-foreground)">On plan — steady, capital-preservation-first.</span></div>
      <div class="cact"><button class="btn btn-outline btn-md" onclick="SP.navigate('portfolio')">Open portfolio</button><button class="btn btn-ghost btn-md" data-chip="Find steady, lower-risk yield">Improve my yield</button></div>
    </div>`;
  }
  function tipCard(){
    return `<div class="ccard" data-card="tip" style="background:var(--info-subtle);border-color:color-mix(in srgb,var(--info) 22%,transparent)">
      <div class="ch"><span style="color:var(--info);display:flex">${icon('info',16)}</span><span style="font-size:13.5px;font-weight:600">What's net APY?</span></div>
      <div style="font-size:13.5px;line-height:1.55;color:var(--muted-foreground);margin-bottom:12px">Your estimated yearly return after all costs, if the current rate held and earnings compounded. Rates change — it's an estimate, not a promise.</div>
      <div class="cact"><button class="btn btn-ghost btn-md" onclick="SP.navigate('learn')">How this works</button></div>
    </div>`;
  }
  function outcomeCard(){
    const o=data.outcomes[1];
    return `<div class="ccard" data-card="out">
      <div class="ch"><span style="font-size:13px;font-weight:600">Outcome</span><span style="font-size:11px;color:var(--muted-foreground)">from ${o.from}</span></div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span class="delta down" style="font-size:18px">${icon('down',16)}${o.pnl} (${o.pct}, ${o.win})</span></div>
      <div style="font-size:13px;color:var(--muted-foreground);margin-bottom:12px">${o.cause} <a class="cite" style="cursor:pointer">View tx ${icon('ext',10)}</a></div>
      <div class="cact"><button class="btn btn-outline btn-md" onclick="SP.navigate('outcomes')">See the original advice</button><button class="btn btn-ghost btn-md" data-chip="What changed?">What changed?</button></div>
    </div>`;
  }

  function wireCard(t){
    t.querySelectorAll('[data-why]').forEach(b=>b.onclick=()=>b.parentElement.querySelector('.whybd').classList.toggle('open'));
    t.querySelectorAll('[data-act="review"]').forEach(b=>b.onclick=()=>navigate('confirm/deposit'));
    t.querySelectorAll('[data-act="notnow"]').forEach(b=>b.onclick=()=>{b.closest('.ccard').style.opacity='.5';SP.toast('Dismissed — nothing moved.');});
    t.querySelectorAll('[data-fb]').forEach(b=>b.onclick=()=>{t.querySelectorAll('[data-fb]').forEach(x=>x.classList.remove('on'));b.classList.add('on');});
    t.querySelectorAll('[data-cite]').forEach(b=>b.onclick=()=>SP.openSheet('Source',`<div style="font-size:13px;line-height:1.6"><b>Based on Aave v3 (Base)</b><div class="muted" style="margin-top:6px">USDC supply rate · 4.3% · as of 2 min ago</div><a class="cite" style="margin-top:10px;display:inline-flex">View on Basescan ${icon('ext',10)}</a></div>`));
    t.querySelectorAll('[data-chip]').forEach(b=>b.onclick=()=>send(b.getAttribute('data-chip')));
  }

  // ----- intents -----
  function respond(text){
    const q=text.toLowerCase();
    if(q.includes('portfolio')||q.includes('how am i')||q.includes('doing')){
      thinking([{a:'Reading your wallet',b:'Read your wallet'},{a:'Pricing your positions',b:'Priced your positions'}],()=>{
        const t=aiTurn(`<div class="ctext">Here's your position. You're <span class="soft">on plan</span> — steady and lower-risk.</div>${snapshotCard()}`); wireCard(t); followups(['Where\'s my risk concentrated?','Improve my yield']);});
    } else if(q.includes('yield')||q.includes('apy')||q.includes('earn')||q.includes('recommend')||q.includes('move')){
      thinking([{a:'Reading your wallet',b:'Read your wallet'},{a:'Checking current Aave rates',b:'Checked current Aave rates'},{a:'Scanning the Base vault',b:'Scanned the Base vault'}],()=>{
        const t=aiTurn(`<div class="ctext">Your idle USDC could be earning. Here's the move I'd suggest — tied to your goal.</div>${recCard()}`); wireCard(t); followups(['Compare options','What\'s the risk?','Explain net APY']);});
    } else if(q.includes('net apy')||q.includes('explain')||q.includes('what')){
      thinking([{a:'Pulling a plain explanation',b:'Ready'}],()=>{ const t=aiTurn(`<div class="ctext">Quick version — and you can always go deeper.</div>${tipCard()}`); wireCard(t); followups(['How does this affect me?','Show my portfolio']);});
    } else if(q.includes('past')||q.includes('outcome')||q.includes('changed')||q.includes('advice')){
      thinking([{a:'Loading your outcome log',b:'Loaded your outcome log'}],()=>{ const t=aiTurn(`<div class="ctext">Here's a recent one — I show losses as plainly as wins.</div>${outcomeCard()}`); wireCard(t); followups(['See all outcomes','Show my portfolio']);});
    } else if(q.includes('safe')||q.includes('custod')||q.includes('keep my funds')){
      const t=aiTurn(`<div class="ctext">Your funds never touch us. SparkPoint can direct strategy but has <b>no code path</b> to take, move, or hold your money — and you can withdraw anytime, even if we're offline. Tap <b>Non-custodial</b> up top to see exactly what we can and can't do.</div>`);
      followups(['Show me the proof','Withdraw anytime']);
    } else {
      thinking([{a:'Thinking',b:'Ready'}],()=>{ aiTurn(`<div class="ctext">I can help you understand your position, find lower-risk yield, explain a concept, or review a move — you approve and sign anything that moves funds. Try one of the suggestions below.</div>`); followups(EMPTY_CHIPS);});
    }
  }

  const EMPTY_CHIPS=['Show my portfolio','Find steady, lower-risk yield','Explain net APY','How did past advice do?','How do you keep my funds safe?'];
  let chipRow;
  function followups(list){ if(!chipRow)return; chipRow.innerHTML=list.map(c=>`<button class="chip" data-c="${c}">${c}</button>`).join('');
    chipRow.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>send(b.dataset.c)); }

  function send(text){ if(!text||!text.trim())return; userTurn(text); respond(text.trim());
    const ta=document.querySelector('.composer textarea'); if(ta){ta.value='';ta.style.height='auto';} }

  SP.registerScreen('chat',{render(host){
    host.innerHTML=`<div class="chatwrap fullbleed">
      <aside class="threadrail">
        <button class="newchat">${icon('plus',16)} New chat</button>
        <div class="threaditem active"><div class="tt">Your plan &amp; first deposit</div><div class="ts">just now</div></div>
        <div class="threaditem"><div class="tt">Is the Aave vault safe?</div><div class="ts">yesterday</div></div>
        <div class="threaditem"><div class="tt">Explain vault shares</div><div class="ts">2 days ago</div></div>
      </aside>
      <div class="chatcol">
        <div class="chatscroll" id="chatscroll"><div class="chatstream" id="chatstream"></div></div>
        <div class="composer-wrap">
          <div class="chips" id="chips"></div>
          <div class="composer">
            <textarea id="composer" rows="1" placeholder="Ask about your wallet, or tell me your goal…"></textarea>
            <button class="sendbtn" id="send">${icon('up',18)}</button>
          </div>
          <div class="cdisc">AI suggests — you approve &amp; sign. Not financial advice · capital at risk · SparkPoint can't move your funds.</div>
        </div>
      </div>
      <aside class="ctx">
        <div class="ctx-card"><div class="ck">Your mandate</div>
          <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px">${riskChip(1)}</div>
          <div style="font-size:12.5px;color:var(--muted-foreground);line-height:1.5">Steady USDC yield · capital-preservation-first. <a style="color:var(--primary);cursor:pointer" onclick="SP.navigate('settings')">Edit</a></div>
        </div>
        <div class="ctx-card"><div class="ck">Portfolio</div>
          <div style="font-size:20px;font-weight:600" class="tnum">${money(data.netWorth)}</div>
          <div class="delta up" style="font-size:12.5px;margin-top:3px">${icon('up',13)}+${money(data.pnl.abs)} (+${data.pnl.pct}%, ${data.pnl.window})</div>
        </div>
        <div class="ctx-card"><div class="ck">Quick links</div>
          <div class="qlink" onclick="SP.navigate('portfolio')">${icon('portfolio')} Portfolio</div>
          <div class="qlink" onclick="SP.navigate('vault')">${icon('vault')} Vault</div>
          <div class="qlink" onclick="SP.navigate('strategies')">${icon('strategies')} Strategies</div>
          <div class="qlink" onclick="SP.navigate('trust')">${icon('shieldcheck')} Trust Center</div>
        </div>
        <div class="ctx-card"><div class="ck">Automation</div>
          <div style="font-size:12.5px;color:var(--muted-foreground);line-height:1.5">No active session keys. You sign every move. <a style="color:var(--primary);cursor:pointer" onclick="SP.navigate('automation')">Set up</a></div>
        </div>
      </aside>
    </div>`;
    stream=host.querySelector('#chatstream'); scroller=host.querySelector('#chatscroll'); chipRow=host.querySelector('#chips');
    // primed first message (post-onboarding)
    aiTurn(`<div class="ctext">Your plan: <b>lower risk (1/5)</b>, capital-preservation-first, steady USDC yield. Want to put your idle USDC to work, or look at the vault first?</div>`);
    followups(['Find steady, lower-risk yield','Show my portfolio','How do you keep my funds safe?']);
    // composer wiring
    const ta=host.querySelector('#composer'), sb=host.querySelector('#send');
    ta.addEventListener('input',()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,120)+'px';});
    ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send(ta.value);}});
    sb.onclick=()=>send(ta.value);
    host.querySelector('.newchat').onclick=()=>{stream.innerHTML='';aiTurn(`<div class="ctext">Hi — I'm SparkPoint's AI. Tell me your goal, or ask me anything about your wallet. I suggest; you approve and sign.</div>`);followups(EMPTY_CHIPS);};
  }});
})();
