/* ===== support.js — Outcomes, Learn, SRK, Settings, Notifications ===== */
(function(){
  const {icon,riskChip,data,money,navigate}=SP;
  const css=`
.settabs{display:flex;gap:4px;border-bottom:1px solid var(--border-soft);margin-bottom:22px;overflow-x:auto;}
.settab{padding:11px 14px;font-size:13.5px;font-weight:500;color:var(--muted-foreground);cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;}
.settab.active{color:var(--foreground);border-bottom-color:var(--primary);}
.setrow{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:15px 0;border-bottom:1px solid var(--border-soft);}
.setrow:last-child{border-bottom:none;}
.learn-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.learn-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;cursor:pointer;transition:.15s;}
.learn-card:hover{border-color:var(--primary);}
@media(max-width:1023px){.learn-grid{grid-template-columns:1fr;}}
`;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

  SP.registerScreen('outcomes',{render(host){
    const rows=data.outcomes.map(o=>`<tr style="cursor:pointer"><td><div style="font-weight:600">${o.from.replace('the ','').replace(' recommendation','')}</div><div class="muted" style="font-size:12px">${o.cause}</div></td>
      <td class="num"><span class="delta ${o.kind==='gain'?'up':'down'}" style="font-size:13px">${icon(o.kind==='gain'?'up':'down',13)}${o.pnl} (${o.pct}, ${o.win})</span></td>
      <td class="num"><a class="cite" style="cursor:pointer">tx ${icon('ext',10)}</a></td></tr>`).join('');
    host.innerHTML=`<div class="page page-narrow">
      <div class="pagehead"><div><h1>Outcome Log</h1><div class="sub">Every move you acted on — wins and losses — tied to the advice that caused it.</div></div></div>
      <div class="card card-pad">
        <div style="display:flex;gap:18px;margin-bottom:18px">
          <div class="stat"><span class="k">Net realized</span><span class="v tnum" style="color:var(--gain)">−$27.86</span></div>
          <div class="stat"><span class="k">Wins</span><span class="v tnum">2</span></div>
          <div class="stat"><span class="k">Losses</span><span class="v tnum">1</span></div>
        </div>
        <table class="tbl"><thead><tr><th>From the recommendation</th><th class="num">Realized PnL</th><th class="num">Proof</th></tr></thead><tbody>${rows}</tbody></table>
      </div>
      <div style="font-size:12px;color:var(--muted-foreground);margin-top:14px;text-align:center">We show losses as plainly as gains — no flattering windows, no euphemism.</div>
    </div>`;
  }});

  SP.registerScreen('learn',{render(host){
    const topics=[['What\'s net APY?','Your estimated yearly return after all costs, if the current rate held.'],
      ['What are vault shares?','Your slice of the vault — count stays fixed, value grows as it earns.'],
      ['What\'s slippage?','How much price can move against you before a trade lands. We cap it.'],
      ['What is self-custody?','You stay in full control of your funds at all times. SparkPoint can direct strategy, never take, move, or hold your money.'],
      ['What are guardrails?','Deterministic rules that check every AI suggestion before you sign.'],
      ['What\'s a session key?','A scoped, time-limited permission for hands-off rebalancing — revocable instantly.']];
    host.innerHTML=`<div class="page page-narrow">
      <div class="pagehead"><div><h1>Learn</h1><div class="sub">Plain explanations, so you can judge our recommendations — not just trust them.</div></div></div>
      <div class="learn-grid">${topics.map(t=>`<div class="learn-card"><div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;color:var(--info)">${icon('info',16)}<span style="font-size:14px;font-weight:600;color:var(--foreground)">${t[0]}</span></div><div style="font-size:13px;color:var(--muted-foreground);line-height:1.55">${t[1]}</div></div>`).join('')}</div>
    </div>`;
  }});

  SP.registerScreen('srk',{render(host){
    host.innerHTML=`<div class="page page-narrow">
      <div class="pagehead"><div><h1>SRK</h1><div class="sub">A non-essential utility token. Nothing core depends on it.</div></div></div>
      <div class="card card-pad" style="margin-bottom:16px;display:flex;align-items:center;gap:14px">
        <span style="width:46px;height:46px;border-radius:50%;background:var(--spark-subtle);color:var(--primary);display:grid;place-items:center">${icon('coins',22)}</span>
        <div style="flex:1"><div style="font-size:12px;color:var(--muted-foreground)">Your balance</div><div style="font-size:22px;font-weight:600" class="tnum">0 SRK</div></div>
        <button class="btn btn-outline btn-md">How to earn</button>
      </div>
      <div class="card card-pad" style="background:var(--info-subtle);border-color:color-mix(in srgb,var(--info) 22%,transparent);display:flex;gap:10px">
        ${icon('info',16)}<span style="font-size:13px;color:var(--muted-foreground);line-height:1.5">SRK never gates the vault, onboarding, or chat. The product works fully without it — this surface is informational only.</span></div>
    </div>`;
  }});

  SP.registerScreen('notifications',{render(host){
    host.innerHTML=`<div class="page page-narrow">
      <div class="pagehead"><div><h1>Notifications</h1><div class="sub">Transaction results and important alerts.</div></div></div>
      <div class="card card-pad">${data.notifications.map(n=>`<div class="setrow"><div style="display:flex;gap:12px;align-items:flex-start">
        <span style="width:34px;height:34px;border-radius:9px;background:var(--spark-subtle);color:var(--primary);display:grid;place-items:center;flex:none">${icon(n.icon,16)}</span>
        <div><div style="font-size:13.5px;font-weight:600">${n.t}</div><div style="font-size:12.5px;color:var(--muted-foreground);margin-top:2px">${n.s}</div></div></div>
        <span style="font-size:11.5px;color:var(--muted-foreground);white-space:nowrap">${n.time}</span></div>`).join('')}</div>
    </div>`;
  }});

  const SETTABS=[['account','Account'],['mandate','Mandate'],['notifications','Notifications'],['appearance','Appearance'],['security','Security']];
  function settings(host,tab){
    tab=tab||'account';
    const tabsHTML=SETTABS.map(t=>`<div class="settab ${t[0]===tab?'active':''}" data-t="${t[0]}">${t[1]}</div>`).join('');
    let body='';
    if(tab==='account') body=`
      <div class="setrow"><div><div style="font-weight:600">Connected wallet</div><div class="muted" style="font-size:12.5px">Smart account on Base</div></div><span class="mono">${data.wallet}</span></div>
      <div class="setrow"><div><div style="font-weight:600">Network</div></div><span class="pill ghosty" style="cursor:default">Base</span></div>
      <div class="setrow"><div><div style="font-weight:600">Disconnect</div><div class="muted" style="font-size:12.5px">Your funds are untouched — you can reconnect anytime.</div></div><button class="btn btn-outline btn-md" onclick="SP.toast('Disconnected — funds untouched');SP.navigate('landing')">${icon('logout',15)} Disconnect</button></div>`;
    else if(tab==='mandate') body=`
      <div class="setrow"><div><div style="font-weight:600">Risk tier</div><div class="muted" style="font-size:12.5px">Lower · 1/5 · capital-preservation-first</div></div>${riskChip(1)}</div>
      <div class="setrow"><div><div style="font-weight:600">Goal</div></div><span>Steady USDC yield</span></div>
      <div class="setrow"><div><div style="font-weight:600">Timeline</div></div><span>1–3 years</span></div>
      <div class="setrow"><div><div style="font-weight:600">Edit your plan</div><div class="muted" style="font-size:12.5px">Re-runs the review &amp; confirm steps.</div></div><a class="btn btn-primary btn-md" href="flows/Onboarding.html">Edit mandate</a></div>`;
    else if(tab==='notifications') body=['Transaction results','Rate changes &amp; recommendations','Caps near limit','Session-key expiry','Outcome updates'].map((l,i)=>`<div class="setrow"><div style="font-weight:600">${l}</div><button class="switch ${i<3?'on':''}" data-sw></button></div>`).join('');
    else if(tab==='appearance') body=`
      <div class="setrow"><div><div style="font-weight:600">Theme</div><div class="muted" style="font-size:12.5px">Dark is the default canvas.</div></div><div class="seg"><button class="active">Dark</button><button>Light</button></div></div>
      <div class="setrow"><div><div style="font-weight:600">Density</div></div><div class="seg"><button class="active">Comfortable</button><button>Compact</button></div></div>
      <div class="setrow"><div><div style="font-weight:600">Reduced motion</div><div class="muted" style="font-size:12.5px">Follows your system setting.</div></div><button class="switch" data-sw></button></div>`;
    else if(tab==='security') body=`
      <div class="setrow"><div><div style="font-weight:600">Active session keys</div><div class="muted" style="font-size:12.5px">None — you sign every move.</div></div><button class="btn btn-outline btn-md" onclick="SP.navigate('automation')">Manage</button></div>
      <div class="setrow"><div><div style="font-weight:600">View exact permissions</div></div><button class="btn btn-outline btn-md" onclick="SP.navigate('trust/permissions')">${icon('shieldcheck',15)} Prove it</button></div>
      <div class="setrow"><div><div style="font-weight:600">Withdraw / Exit</div><div class="muted" style="font-size:12.5px">Always available, even if we're offline.</div></div><button class="btn btn-outline btn-md" onclick="SP.navigate('trust/exit')">${icon('door',15)} Exit</button></div>`;
    host.innerHTML=`<div class="page page-narrow">
      <div class="pagehead"><div><h1>Settings</h1></div><button class="btn btn-ghost btn-md" onclick="SP.toast('Logged out — funds untouched');SP.navigate('landing')">${icon('logout',15)} Log out</button></div>
      <div class="settabs">${tabsHTML}</div>
      <div class="card card-pad">${body}</div>
    </div>`;
    host.querySelectorAll('[data-t]').forEach(t=>t.onclick=()=>settings(host,t.getAttribute('data-t')));
    host.querySelectorAll('[data-sw]').forEach(s=>s.onclick=()=>s.classList.toggle('on'));
    host.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>{b.parentElement.querySelectorAll('button').forEach(x=>x.classList.remove('active'));b.classList.add('active');});
  }
  SP.registerScreen('settings',{render(h,ctx){ settings(h, (ctx.route.split('/')[1]||'account')); }});
})();
