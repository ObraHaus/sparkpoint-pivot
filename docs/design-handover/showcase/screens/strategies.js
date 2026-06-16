/* ===== strategies.js — Strategy Recommendations (ranked vs mandate) ===== */
(function(){
  const {icon,riskChip,data,money,navigate}=SP;
  const css=`
.strat{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:18px;margin-bottom:14px;}
.strat.best{border-color:color-mix(in srgb,var(--primary) 40%,transparent);box-shadow:0 0 0 1px var(--spark-subtle);}
.strat .sh{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:11px;}
.strat .st{font-size:16px;font-weight:600;margin-bottom:8px;}
.strat .sd{font-size:13.5px;line-height:1.55;color:var(--muted-foreground);margin-bottom:14px;}
.strat .smetrics{display:flex;gap:24px;flex-wrap:wrap;align-items:center;margin-bottom:14px;}
.strat .whybd{font-size:12.5px;line-height:1.6;color:var(--muted-foreground);margin-top:10px;max-height:0;overflow:hidden;transition:max-height .3s;}
.strat .whybd.open{max-height:240px;}
`;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

  SP.registerScreen('strategies',{render(host){
    const cards=data.recs.map((r,i)=>`
      <div class="strat ${i===0?'best':''}">
        <div class="sh"><span style="font-size:11px;font-weight:600;background:${i===0?'var(--spark-subtle)':'var(--muted)'};color:${i===0?'var(--primary)':'var(--foreground)'};border-radius:999px;padding:3px 10px">${r.rank}</span>
          <span class="badge badge-ai">AI suggestion — you approve &amp; sign</span></div>
        <div class="st">${r.title}</div>
        <div class="sd">${r.thesis}</div>
        <div class="smetrics">
          ${r.apy>0?`<div><div style="font-size:22px;font-weight:600" class="tnum">${r.apy}%</div><div style="font-size:11px;color:var(--muted-foreground)">net APY · estimate</div></div>`:`<div><div style="font-size:22px;font-weight:600" class="tnum">—</div><div style="font-size:11px;color:var(--muted-foreground)">no yield (cash)</div></div>`}
          ${riskChip(r.risk)}
          <div style="font-size:12.5px;color:var(--muted-foreground);max-width:200px">${r.fit}</div>
        </div>
        <div style="font-size:11.5px;color:var(--muted-foreground);margin-bottom:14px">Estimates, not guarantees.</div>
        <div style="display:flex;gap:9px;align-items:center">
          ${r.apy>0?`<button class="btn btn-primary btn-md" onclick="SP.navigate('confirm/deposit')">Review this move</button>`:`<button class="btn btn-outline btn-md" disabled>Already your posture</button>`}
          <button class="btn btn-ghost btn-md" data-why>${icon('info',15)} Why this?</button></div>
        <div class="whybd">Ranked against your mandate (lower risk, capital-preservation-first, steady yield). ${i===0?'Raises yield without changing your risk tier; stays 100% in the audited Aave vault; satisfies your beta cap and slippage guardrails.':'A conservative posture — less earning, more flexibility. Honest tradeoff, shown so you can choose.'}</div>
      </div>`).join('');
    host.innerHTML=`<div class="page page-narrow">
      <div class="pagehead"><div><h1>Strategies</h1><div class="sub">Ranked against your plan — lower risk, steady yield</div></div>
        <button class="btn btn-outline btn-md" onclick="SP.navigate('settings')">${icon('sliders',16)} Edit mandate</button></div>
      <div class="card card-pad" style="margin-bottom:16px;display:flex;align-items:center;gap:12px;background:var(--spark-subtle);border-color:color-mix(in srgb,var(--primary) 22%,transparent)">
        ${icon('info',18)}<span style="font-size:13px;color:var(--muted-foreground)">Only the lower-risk Aave vault is live today. Higher-risk strategies will rank here as more vaults open.</span></div>
      ${cards}
    </div>`;
    host.querySelectorAll('[data-why]').forEach(b=>b.onclick=()=>b.closest('.strat').querySelector('.whybd').classList.toggle('open'));
  }});
})();
