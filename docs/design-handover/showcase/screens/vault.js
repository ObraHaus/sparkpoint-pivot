/* ===== vault.js — Vault overview / deposit / withdraw ===== */
(function(){
  const {icon,riskChip,data,money,fmt,navigate} = SP;
  const v=data.vault;
  const css=`
.vault-grid{display:grid;grid-template-columns:1.5fr 1fr;gap:18px;}
.capmeter{height:9px;border-radius:999px;background:var(--muted);overflow:hidden;}
.capmeter>i{display:block;height:100%;border-radius:999px;background:var(--primary);}
.apybreak{display:flex;flex-direction:column;gap:7px;font-size:13px;}
.apybreak .br{display:flex;justify-content:space-between;}
.amtbox{background:var(--background);border:1px solid var(--input);border-radius:var(--radius);padding:16px;}
.amtbox.focus{border-color:var(--primary);box-shadow:0 0 0 3px var(--spark-subtle);}
.preview-row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border-soft);font-size:13.5px;}
.preview-row:last-child{border-bottom:none;}
@media(max-width:1023px){.vault-grid{grid-template-columns:1fr;}}
`;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

  SP.registerScreen('vault',{render(host){
    const capPct=(v.capUsed/v.capUser*100);
    host.innerHTML=`<div class="page page-wide">
      <div class="pagehead"><div><h1>Aave Yield Vault</h1><div class="sub">Conservative, capital-preservation-first yield on USDC · Base</div></div>
        <div class="actions">${riskChip(1)}<button class="btn btn-outline btn-md" onclick="SP.navigate('vault/withdraw')">${icon('door',16)} Withdraw</button>
        <button class="btn btn-primary btn-md" onclick="SP.navigate('vault/deposit')">Review deposit</button></div></div>
      <div class="vault-grid">
        <div class="card card-pad">
          <div class="card-hd"><span class="lbl">Net APY</span><span class="badge badge-ai">AI-managed</span></div>
          <div style="display:flex;align-items:flex-end;gap:10px"><div style="font-size:38px;font-weight:600;letter-spacing:-.02em" class="tnum">${v.netApy}%</div><div class="muted" style="font-size:13px;margin-bottom:7px">net APY · estimate</div></div>
          <div class="apybreak" style="margin-top:16px">
            <div class="br"><span class="muted">Aave supply rate</span><span class="tnum">${v.supplyApy}%</span></div>
            <div class="br"><span class="muted">Performance fee · ${v.perfFee}% of yield <span style="font-size:11px">(over high-water mark)</span></span><span class="tnum">−${(v.supplyApy-v.netApy).toFixed(2)}%</span></div>
            <div class="divider" style="margin:4px 0"></div>
            <div class="br" style="font-weight:600"><span>Net APY</span><span class="tnum">${v.netApy}%</span></div>
          </div>
          <div style="margin-top:14px;font-size:12px;color:var(--muted-foreground);line-height:1.5">Estimates, not guarantees. Rates change; historical and current only — no projections.</div>
          <div class="divider"></div>
          <div class="card-hd"><span class="t">APY history</span><div class="seg">${['7d','30d','90d'].map((r,i)=>`<button class="${i===1?'active':''}">${r}</button>`).join('')}</div></div>
          <svg width="100%" height="80" viewBox="0 0 520 80" preserveAspectRatio="none"><path d="${apyPath(data.apyHist,520,80)}" fill="none" stroke="var(--info)" stroke-width="2"/></svg>
        </div>
        <div class="card card-pad">
          <div class="card-hd"><span class="lbl">Your position</span></div>
          <div class="stat" style="margin-bottom:14px"><span class="k">Shares held</span><span class="v tnum">${fmt(v.shares,4)}</span><span class="muted" style="font-size:11px">spvUSDC ≈ ${money(v.shareValue)}</span></div>
          <div class="preview-row"><span class="muted">Accrued yield</span><span class="tnum" style="color:var(--gain)">+${money(v.accrued)}</span></div>
          <div class="preview-row"><span class="muted">Idle USDC available</span><span class="tnum">${money(data.idleUSDC)}</span></div>
          <div class="divider"></div>
          <div class="card-hd"><span class="lbl">Your beta cap</span><span class="tnum" style="font-size:12px">${money(v.capUsed,0)} / ${money(v.capUser,0)}</span></div>
          <div class="capmeter"><i style="width:${capPct}%"></i></div>
          <div style="font-size:12px;color:var(--muted-foreground);margin-top:8px">${(100-capPct).toFixed(0)}% of your beta cap remaining. You can always withdraw, regardless of caps.</div>
          <div class="divider"></div>
          <div style="display:flex;gap:8px"><span class="pill ghosty" style="cursor:default">${icon('shieldcheck',13)} Audited</span><span class="pill ghosty" style="cursor:default">${icon('lock',13)} Non-upgradeable</span></div>
        </div>
      </div>
    </div>`;
    host.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>{b.parentElement.querySelectorAll('button').forEach(x=>x.classList.remove('active'));b.classList.add('active');});
  }});

  function apyPath(vals,W,H){const min=Math.min(...vals)-.1,max=Math.max(...vals)+.1,r=(max-min)||1,p=6;
    return 'M'+vals.map((v,i)=>(p+(i/(vals.length-1))*(W-p*2)).toFixed(1)+' '+(p+(1-(v-min)/r)*(H-p*2)).toFixed(1)).join(' L');}

  function amountScreen(host,mode){
    const isDep=mode==='deposit';
    host.innerHTML=`<div class="page page-narrow">
      <a class="qlink" style="display:inline-flex;margin-bottom:14px" onclick="SP.navigate('vault')">${icon('chevr',15)} Back to vault</a>
      <div class="pagehead"><div><h1>${isDep?'Deposit USDC':'Withdraw'}</h1><div class="sub">${isDep?`Into the Aave Yield Vault · ${v.netApy}% net APY (estimate)`:'Withdraw anytime — even if SparkPoint is offline'}</div></div>${riskChip(1)}</div>
      <div class="card card-pad">
        <div class="field" style="margin-bottom:16px"><label>${isDep?'Amount to deposit':'Amount to withdraw'}</label>
          <div class="amtbox" id="amtbox"><div style="display:flex;align-items:center;gap:10px">
            <input class="input big" id="amt" inputmode="decimal" placeholder="0.00" style="border:none;box-shadow:none;padding:0;background:none" value="${isDep?'2,150.00':'5,000.00'}"/>
            <span style="font-size:18px;font-weight:600;color:var(--muted-foreground)">${isDep?'USDC':'USDC'}</span>
            <button class="btn btn-ghost btn-sm" id="maxbtn">Max</button></div></div>
          <div class="hint">${isDep?`Max ${money(data.idleUSDC)} (idle) · ${money(v.capUser,0)} beta cap`:`You hold ${money(v.shareValue)} · withdraw any amount`}</div>
        </div>
        <div style="background:var(--background);border:1px solid var(--border-soft);border-radius:var(--radius);padding:14px;margin-bottom:8px">
          ${isDep?`
          <div class="preview-row"><span class="muted">You'll receive ≈</span><span class="tnum">2,118.4 spvUSDC</span></div>
          <div class="preview-row"><span class="muted">Net APY</span><span class="tnum">${v.netApy}% <a class="cite" style="cursor:pointer">breakdown</a></span></div>
          <div class="preview-row"><span class="muted">Beta cap after</span><span class="tnum">${money(v.capUsed+2150,0)} / ${money(v.capUser,0)}</span></div>`:`
          <div class="preview-row"><span class="muted">You'll redeem ≈</span><span class="tnum">4,902.1 spvUSDC</span></div>
          <div class="preview-row"><span class="muted">You'll receive</span><span class="tnum">≈ 5,000.00 USDC</span></div>
          <div class="preview-row"><span class="muted">Remaining position</span><span class="tnum">${money(v.shareValue-5000)}</span></div>`}
        </div>
        <div style="font-size:12px;color:var(--muted-foreground);line-height:1.5;margin-bottom:16px">${isDep?'Estimates, not guarantees. Shares: your fixed slice of the vault; its USDC value grows as the vault earns.':'No fees to exit. Nothing moves until you sign.'}</div>
        <button class="btn btn-primary btn-lg" style="width:100%" onclick="SP.navigate('confirm/${mode}')">${isDep?'Review deposit':'Review withdrawal'}</button>
        <div style="text-align:center;font-size:11px;color:var(--muted-foreground);margin-top:10px">Next: simulation + guardrail check, then you sign.</div>
      </div>
    </div>`;
    const amtbox=host.querySelector('#amtbox'),amt=host.querySelector('#amt');
    amt.addEventListener('focus',()=>amtbox.classList.add('focus'));
    amt.addEventListener('blur',()=>amtbox.classList.remove('focus'));
    host.querySelector('#maxbtn').onclick=()=>{amt.value=isDep?fmt(data.idleUSDC):fmt(v.shareValue);};
  }
  SP.registerScreen('vault/deposit',{render(h){amountScreen(h,'deposit');}});
  SP.registerScreen('vault/withdraw',{render(h){amountScreen(h,'withdraw');}});
})();
