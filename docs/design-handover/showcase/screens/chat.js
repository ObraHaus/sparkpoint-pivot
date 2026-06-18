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
      <div class="cthesis">Aave's USDC rate is <b>4.3%</b>. After our <b>10% performance fee on yield</b> that's <b>3.87% net APY</b> — moving your idle <span class="tnum">2,150 USDC</span> in could earn more, at the same low risk.</div>
      <div class="crow">
        <div class="capy"><div class="big tnum">3.87% <span class="cite" data-cite>${icon('check',10)} Based on Aave · 2m</span></div><div class="lbl">net APY · 4.3% Aave − 10% perf fee on yield</div></div>
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

  // ----- inline confirm + sign (stays in chat; no page navigation) -----
  const CONFIRM={
    deposit:{ title:'Confirm: Deposit', badge:false,
      sub:'You\u2019re depositing <b>2,150 USDC</b> into the Aave Yield Vault \u2014 you\u2019ll receive \u2248 2,118.4 spvUSDC.',
      sim:[['Building the transaction','Built the transaction'],['Simulating against Base state','Simulated against Base state'],['Checking your guardrails','Checked your guardrails']],
      bc:[['USDC out','\u22122,150.00 USDC','--loss'],['spvUSDC in','+2,118.40 spvUSDC','--gain'],['Network fee (gas)','\u2248 $0.01',''],['Fee on this deposit','0% — none','--gain'],['Performance fee','10% of yield (over HWM)',''],['Net APY on new shares','3.87%','']],
      guards:['Within your beta cap','Slippage under your max (0.5%)','Allowlisted protocol \u2014 Aave v3 (Base)','Simulation passed \u2014 no risks detected'],
      ack:'This uses your full idle balance, leaving no USDC buffer in your wallet.',
      signLabel:'Sign deposit',
      okTitle:'Deposit confirmed.', okBody:'You now hold 11,952.9 spvUSDC (\u2248 $12,152.82).', chain:null },
    swap:{ title:'Confirm: Swap', badge:true,
      sub:'You\u2019re swapping <b>0.1 ETH</b> for \u2248 <b>312.40 USDC</b> on Aerodrome.',
      sim:[['Building the swap','Built the swap'],['Simulating on Aerodrome','Simulated on Aerodrome'],['Checking your guardrails','Checked your guardrails']],
      bc:[['ETH out','\u2212 0.1000 ETH \u00b7 \u2212$500.00','--loss'],['USDC in','+ 312.40 USDC','--gain'],['Network fee (gas)','\u2248 $0.05',''],['Min received (0.5% slip)','310.84 USDC',''],['SparkPoint routing fee \u00b7 0.20%','$0.62',''],['Net USDC received','\u2248 311.78 USDC','--gain']],
      guards:['Route allowlisted \u2014 Aerodrome (Base)','Slippage under your max (0.5%)','Policy approved','Simulation passed \u2014 no risks detected'],
      ack:null, signLabel:'Sign transaction',
      okTitle:'Swap confirmed.', okBody:'You received \u2248 311.78 USDC via Aerodrome. Routing fee paid: $0.62 (0.20%).', chain:'deposit' },
    bridge:{ title:'Confirm: Bridge', badge:false,
      sub:'You\u2019re bridging <b>500 USDC</b> from <b>Base</b> to <b>Sui</b>.',
      sim:[['Building the bridge message','Built the bridge message'],['Simulating lock on Base','Simulated lock on Base'],['Checking your guardrails','Checked your guardrails']],
      bc:[['USDC out \u00b7 Base','\u2212 500.00 USDC','--loss'],['USDC in \u00b7 Sui','+ 500.00 USDC','--gain'],['Bridge fee','\u2248 $0.40',''],['Est. settlement','~3\u20135 min','']],
      guards:['Canonical bridge route \u2014 allowlisted','Destination is your own Sui wallet','Within your bridge cap','Simulation passed \u2014 no risks detected'],
      ack:null, signLabel:'Sign bridge',
      okTitle:'Bridge initiated.', okBody:'500 USDC is on its way from Base to Sui \u2014 usually 3\u20135 minutes. You\u2019ll be notified when it lands in your Sui wallet.', chain:null }
  };
  function inlineConfirm(kind){
    const cfg=CONFIRM[kind];
    const bcRows=cfg.bc.map(r=>`<div class="bc-row"><span class="muted">${r[0]}</span><span class="tnum"${r[2]?` style="color:var(${r[2]})"`:''}>${r[1]}</span></div>`).join('');
    const guardRows=cfg.guards.map(g=>`<div class="guard pass"><span class="gi">${icon('check',16)}</span><span class="gt">${g}</span></div>`).join('');
    const ackHtml=cfg.ack?`<div class="ackbox"><div class="ackcheck" data-ack>${icon('check',13)}</div>
        <div style="flex:1"><div style="font-size:13.5px;font-weight:600">Requires your acknowledgement</div>
        <div style="font-size:12.5px;color:var(--muted-foreground);margin-top:2px">${cfg.ack}</div>
        <div style="font-size:12px;color:var(--caution);margin-top:6px;font-weight:600">I understand this is above my usual buffer.</div></div></div>`:'';
    const t=aiTurn(`<div class="ctext">Here\u2019s the full preview \u2014 review every change and sign right here. <b>Nothing moves until you sign.</b></div>
      <div class="ccard cf-card" data-confirm style="padding:0;overflow:hidden;max-width:600px">
        <div class="cf-hd"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div style="font-size:16px;font-weight:600">${cfg.title}</div>${cfg.badge?'<span class="badge badge-ai">AI suggestion \u2014 you approve &amp; sign</span>':icon('flask',18)}</div>
          <div style="font-size:13px;color:var(--muted-foreground);margin-top:6px;line-height:1.5">${cfg.sub}</div></div>
        <div class="cf-sec" data-sim><div class="cf-lbl">Pre-trade simulation</div><div data-simbody></div></div>
        <div class="cf-sec" data-bc style="display:none"><div class="cf-lbl">Balance changes (simulated)</div>${bcRows}</div>
        <div class="cf-sec" data-guard style="display:none"><div class="cf-lbl">Guardrail checklist</div>${guardRows}${ackHtml}</div>
        <div class="cf-sec" data-ctrl style="display:none"><div style="display:flex;gap:9px;align-items:flex-start;font-size:13px;color:var(--muted-foreground);line-height:1.5">${icon('shieldcheck',16)}<span><b style="color:var(--foreground)">Nothing moves until you sign.</b> You can cancel now with no effect. SparkPoint never holds your funds.</span></div></div>
        <div class="cf-sec" data-sign style="display:none">
          <div data-signhelp style="font-size:12px;color:var(--caution);margin-bottom:10px;${cfg.ack?'':'display:none'}">${icon('alert',13)} Acknowledge the item above to enable signing.</div>
          <div style="display:flex;gap:10px"><button class="btn btn-outline btn-md" data-cancel style="flex:none">Cancel</button>
            <button class="btn btn-primary btn-md" data-sign-btn style="flex:1" ${cfg.ack?'disabled':''}>${icon('key',16)} ${cfg.signLabel}</button></div>
        </div>
      </div>`);
    const card=t.querySelector('[data-confirm]');
    const sim=card.querySelector('[data-simbody]'); let i=0;
    (function go(){
      if(i>=cfg.sim.length){
        sim.innerHTML=`<div class="simbar pass">${icon('check',16)} Simulation passed \u2014 no risks detected.</div>`;
        ['[data-bc]','[data-guard]','[data-ctrl]','[data-sign]'].forEach((s,k)=>{const el=card.querySelector(s);setTimeout(()=>{el.style.display='block';if(!reduce&&typeof gsap!=='undefined')gsap.fromTo(el,{opacity:0,y:8},{opacity:1,y:0,duration:.3});scrollDown();},k*120);});
        wireInline(card,cfg,kind);
        return;
      }
      const r=document.createElement('div');r.style.cssText='display:flex;align-items:center;gap:9px;font-size:13px;color:var(--muted-foreground);padding:4px 0';
      r.innerHTML=`<span class="ai-dot"></span><span>${cfg.sim[i][0]}\u2026</span>`;sim.appendChild(r);
      setTimeout(()=>{r.querySelector('.ai-dot').outerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gain)" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>`;r.querySelector('span:last-child').textContent=cfg.sim[i][1];i++;setTimeout(go,reduce?80:280);},reduce?120:520);
    })();
  }
  function wireInline(card,cfg,kind){
    const signbtn=card.querySelector('[data-sign-btn]'), help=card.querySelector('[data-signhelp]'), ack=card.querySelector('[data-ack]');
    if(cfg.ack&&ack){ ack.onclick=()=>{ack.classList.toggle('on');const ok=ack.classList.contains('on');signbtn.disabled=!ok;if(help)help.style.display=ok?'none':'block';}; }
    card.querySelector('[data-cancel]').onclick=()=>{card.style.opacity='.5';SP.toast('Cancelled \u2014 nothing moved.');};
    signbtn.onclick=()=>{
      if(signbtn.disabled){const g=card.querySelector('[data-guard]');g.classList.add('shake');setTimeout(()=>g.classList.remove('shake'),320);return;}
      signbtn.innerHTML=`<span class="ai-dot" style="background:var(--primary-foreground)"></span> Waiting for your wallet\u2026`;signbtn.disabled=true;
      setTimeout(()=>{
        card.innerHTML=`<div style="padding:30px 22px;text-align:center">
          <div style="width:56px;height:56px;border-radius:50%;background:var(--gain-subtle);display:grid;place-items:center;margin:0 auto 14px"><span style="color:var(--gain)">${icon('check',28,2.5)}</span></div>
          <div style="font-size:18px;font-weight:600;margin-bottom:7px">${cfg.okTitle}</div>
          <div style="font-size:13.5px;color:var(--muted-foreground);line-height:1.5;max-width:380px;margin:0 auto 6px">${cfg.okBody}</div>
          <a class="cite" style="cursor:pointer;display:inline-flex;margin-bottom:16px">View transaction ${icon('ext',11)}</a>
          <div style="display:flex;gap:9px;justify-content:center;flex-wrap:wrap"><button class="btn btn-outline btn-md" onclick="SP.navigate('portfolio')">See it in your portfolio</button>${cfg.chain?`<button class="btn btn-primary btn-md" data-chainbtn>Put USDC to work</button>`:''}</div>
        </div>`;
        SP.toast(cfg.okTitle+' \u00b7 View tx \u2197'); scrollDown();
        const cb=card.querySelector('[data-chainbtn]'); if(cb) cb.onclick=()=>{ const t2=aiTurn(`<div class="ctext">Nice \u2014 your <b>\u2248 311.78 USDC</b> is ready. Here\u2019s the vault deposit, slippage-free at <b>3.87% net APY</b>. Same rule: you sign, nothing moves before that.</div>`); inlineConfirm('deposit'); };
      },1400);
    };
  }

  function wireCard(t){
    t.querySelectorAll('[data-why]').forEach(b=>b.onclick=()=>b.parentElement.querySelector('.whybd').classList.toggle('open'));
    t.querySelectorAll('[data-act="review"]').forEach(b=>b.onclick=()=>inlineConfirm('deposit'));
    t.querySelectorAll('[data-act="reviewswap"]').forEach(b=>b.onclick=()=>inlineConfirm('swap'));
    t.querySelectorAll('[data-act="reviewbridge"]').forEach(b=>b.onclick=()=>inlineConfirm('bridge'));
    t.querySelectorAll('[data-act="notnow"]').forEach(b=>b.onclick=()=>{b.closest('.ccard').style.opacity='.5';SP.toast('Dismissed — nothing moved.');});
    t.querySelectorAll('[data-fb]').forEach(b=>b.onclick=()=>{t.querySelectorAll('[data-fb]').forEach(x=>x.classList.remove('on'));b.classList.add('on');});
    t.querySelectorAll('[data-cite]').forEach(b=>b.onclick=()=>SP.openSheet('Source',`<div style="font-size:13px;line-height:1.6"><b>Based on Aave v3 (Base)</b><div class="muted" style="margin-top:6px">USDC supply rate · 4.3% · as of 2 min ago</div><a class="cite" style="margin-top:10px;display:inline-flex">View on Basescan ${icon('ext',10)}</a></div>`));
    t.querySelectorAll('[data-chip]').forEach(b=>b.onclick=()=>send(b.getAttribute('data-chip')));
  }

  // ----- intents -----
  function bridgeCard(){
    return `<div class="ccard" data-card="bridge">
      <div class="ch"><span class="rank">Bridge · Base → Sui</span><span class="badge badge-ai">AI suggestion — you approve &amp; sign</span></div>
      <div class="cthesis">Move <b>500 USDC</b> from Base to <b>Sui</b> via the canonical bridge. You keep custody the whole way — funds land in your own Sui wallet.</div>
      <div class="crow">
        <div class="capy"><div class="big tnum">500</div><div class="lbl">USDC · from Base</div></div>
        <div class="capy"><div class="big tnum">~3–5m</div><div class="lbl">settlement · fee ≈ $0.40</div></div>
      </div>
      <div class="cnote">Non-custodial bridge: you sign a lock on Base, receive on Sui. SparkPoint never holds funds in transit.</div>
      <div class="cact"><button class="btn btn-primary btn-md" data-act="reviewbridge">Review bridge</button><button class="btn btn-ghost btn-md" data-act="notnow">Not now</button></div>
    </div>`;
  }
  function walletCard(){
    const rows=[['USDC','2,150.00','$2,150','idle · earning nothing','--caution'],
      ['ETH','0.42','$2,100','+1.8% (24h)','--gain'],
      ['cbBTC','0.045','$4,275','−0.6% (24h)','--loss'],
      ['Aave Vault','9,834.50 spv','$10,034','+0.3% accruing','--gain']];
    return `<div class="ccard" data-card="wallet">
      <div class="ch"><span style="font-size:13px;font-weight:600">Your wallet · Base</span><span style="font-size:11px;color:var(--muted-foreground)" class="grow">total ≈ $18,559</span></div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
        ${rows.map(r=>`<tr><td style="padding:7px 0;font-size:13px;font-weight:600">${r[0]}</td>
          <td style="padding:7px 0;font-size:12.5px;color:var(--muted-foreground);text-align:right" class="tnum">${r[1]}</td>
          <td style="padding:7px 8px;font-size:13px;text-align:right" class="tnum">${r[2]}</td>
          <td style="padding:7px 0;font-size:11.5px;text-align:right;color:var(${r[4]})">${r[3]}</td></tr>`).join('')}
      </table>
      <div class="cact"><button class="btn btn-primary btn-md" data-chip="Put my USDC to work">Put USDC to work</button><button class="btn btn-ghost btn-md" onclick="SP.navigate('portfolio')">Open portfolio</button></div>
    </div>`;
  }
  function swapCard(){
    return `<div class="ccard" data-card="swap">
      <div class="ch"><span class="rank">Swap · ETH → USDC</span><span class="badge badge-ai">AI suggestion — you approve &amp; sign</span></div>
      <div class="cthesis">Best swap route on Base: <b>ETH → USDC via Aerodrome</b> (highest liquidity). Slippage protection is built into the route.</div>
      <div class="crow">
        <div class="capy"><div class="big tnum">0.1 ETH</div><div class="lbl">you swap · you hold 0.42 ETH</div></div>
        <div class="capy"><div class="big tnum">≈ 312.40</div><div class="lbl">USDC out · max slippage 0.5%</div></div>
      </div>
      <div class="cnote">Includes a SparkPoint routing fee of 0.20% (≈ $0.62), shown in full before you sign. USDC you can then deposit into the vault.</div>
      <div class="cact"><button class="btn btn-primary btn-md" data-act="reviewswap">Review swap</button><button class="btn btn-ghost btn-md" data-act="notnow">Not now</button></div>
    </div>`;
  }
  function respond(text){
    const q=text.toLowerCase();
    if(q.includes('bridge')||q.includes('sui')||q.includes('cross-chain')||q.includes('cross chain')||q.includes('other network')||q.includes('move to')){
      thinking([{a:'Reading balances on Base & Sui',b:'Read balances on Base & Sui'},{a:'Finding the canonical route',b:'Found the canonical route'}],()=>{
        const t=aiTurn(`<div class="ctext">You can move assets between <b>Base</b> and <b>Sui</b> without giving up custody. Here's a bridge I'd set up — you sign, funds land in your own wallet on the other side.</div>${bridgeCard()}`); wireCard(t); followups(['Why bridge to Sui?','Is bridging safe?','Show my portfolio']);});
    } else if(q.includes('swap')||q.includes('convert')||(q.includes('eth')&&q.includes('usdc'))){
      thinking([{a:'Reading your wallet',b:'Read your wallet'},{a:'Finding the best route on Base',b:'Found the best route on Base'},{a:'Checking slippage',b:'Checked slippage'}],()=>{
        const t=aiTurn(`<div class="ctext">Here's the best route I found — slippage-protected, with the fee shown up front.</div>${swapCard()}`); wireCard(t); followups(['Explain the routing fee','What\'s slippage?','Deposit to vault after']);});
    } else if(q.includes('deposit')||q.includes('confirm')||q.includes('sign')||q.includes('to work')||q.includes('put usdc')||q.includes('put my usdc')){
      thinking([{a:'Reading your idle USDC',b:'Read your idle USDC'},{a:'Building the vault deposit',b:'Built the vault deposit'},{a:'Checking your guardrails',b:'Checked your guardrails'}],()=>{
        aiTurn(`<div class="ctext">Let's put your idle <b>2,150 USDC</b> into the Aave Yield Vault. Review every change and sign right here — you never leave the chat.</div>`); inlineConfirm('deposit'); followups(['What\'s the risk?','Explain net APY','Show my portfolio']);});
    } else if(q.includes('wallet')||q.includes('balance')||q.includes('hold')||q.includes('what.s in')||q.includes('what do i')){
      thinking([{a:'Reading your wallet on Base',b:'Read your wallet on Base'},{a:'Pricing your assets',b:'Priced your assets'}],()=>{
        const t=aiTurn(`<div class="ctext">Here's everything in your wallet right now. Your <span class="soft">idle USDC is the obvious lever</span> — it's earning nothing.</div>${walletCard()}`); wireCard(t); followups(['Put my USDC to work','Swap ETH → USDC','Bridge to Sui']);});
    } else if(q.includes('aave')||q.includes('supply')||q.includes('lend')){
      thinking([{a:'Reading your wallet',b:'Read your wallet'},{a:'Checking the Aave v3 rate on Base',b:'Checked the Aave v3 rate on Base'},{a:'Simulating against current state',b:'Simulated against current state'}],()=>{
        const t=aiTurn(`<div class="ctext">You can supply USDC straight to Aave v3 on Base — the same engine behind the vault, here as a direct position.</div>${recCard()}`); wireCard(t); followups(['Vault vs direct supply?','What\'s the risk?','Review this move']);});
    } else if(q.includes('portfolio')||q.includes('how am i')||q.includes('doing')){
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
      const t=aiTurn(`<div class="ctext">Your funds never touch us. SparkPoint can direct strategy but has <b>no code path</b> to take, move, or hold your money — and you can withdraw anytime, even if we're offline. Tap <b>Fully self-custodial</b> up top to see exactly what we can and can't do.</div>`);
      followups(['Show me the proof','Withdraw anytime']);
    } else {
      thinking([{a:'Thinking',b:'Ready'}],()=>{ aiTurn(`<div class="ctext">I can help you understand your position, find lower-risk yield, explain a concept, or review a move — you approve and sign anything that moves funds. Try one of the suggestions below.</div>`); followups(EMPTY_CHIPS);});
    }
  }

  const EMPTY_CHIPS=['What\'s in my wallet?','Find steady, lower-risk yield','Swap ETH → USDC','Deposit & sign 2,150 USDC','Bridge to Sui','How do you keep my funds safe?'];
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
        <div class="threaditem" data-seed="Deposit and sign 2,150 USDC into the vault"><div class="tt">Deposit &amp; sign — vault</div><div class="ts">just now</div></div>
        <div class="threaditem" data-seed="Swap ETH for USDC then deposit"><div class="tt">Confirm + sign a swap</div><div class="ts">1h ago</div></div>
        <div class="threaditem" data-seed="What's in my wallet?"><div class="tt">What's in my wallet?</div><div class="ts">2h ago</div></div>
        <div class="threaditem" data-seed="Swap ETH for USDC"><div class="tt">Swap ETH → USDC</div><div class="ts">yesterday</div></div>
        <div class="threaditem" data-seed="Bridge USDC to Sui"><div class="tt">Bridge USDC to Sui</div><div class="ts">yesterday</div></div>
        <div class="threaditem" data-seed="Is the Aave vault safe?"><div class="tt">Is the Aave vault safe?</div><div class="ts">2 days ago</div></div>
        <div class="threaditem" data-seed="Explain vault shares"><div class="tt">Explain vault shares</div><div class="ts">3 days ago</div></div>
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
    host.querySelectorAll('[data-seed]').forEach(el=>el.onclick=()=>{
      host.querySelectorAll('.threaditem').forEach(x=>x.classList.remove('active')); el.classList.add('active');
      stream.innerHTML=''; send(el.getAttribute('data-seed'));
    });
  }});
})();
