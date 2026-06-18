/* ===== portfolio.js — Portfolio Overview + position detail ===== */
(function(){
  const {icon,riskChip,data,money,fmt,navigate} = SP;

  const css = `
.pf-hero{display:grid;grid-template-columns:1.6fr 1fr;gap:18px;margin-bottom:18px;}
.pf-net{font-size:38px;font-weight:600;letter-spacing:-.02em;line-height:1;}
.pf-spark-area{position:relative;height:160px;margin-top:16px;}
.pf-range{display:flex;gap:2px;}
.riskpanel .rp-row{display:flex;align-items:center;justify-content:space-between;padding:11px 0;border-bottom:1px solid var(--border-soft);font-size:13px;}
.riskpanel .rp-row:last-child{border-bottom:none;}
.donut{width:130px;height:130px;border-radius:50%;flex:none;}
.legend{display:flex;flex-direction:column;gap:9px;}
.legrow{display:flex;align-items:center;gap:9px;font-size:13px;}
.legrow .sw{width:11px;height:11px;border-radius:3px;flex:none;}
.legrow .lg{flex:1;color:var(--muted-foreground);}
.legrow .lv{font-variant-numeric:tabular-nums;font-weight:600;}
.pf-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
.posstats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;}
.posstats .v{overflow-wrap:anywhere;}
@media(max-width:1023px){.pf-hero{grid-template-columns:1fr;}.pf-grid{grid-template-columns:1fr;}.posstats{grid-template-columns:1fr;gap:12px;}}
`;
  const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

  function areaPath(vals,W,H,pad=6){
    const min=Math.min(...vals),max=Math.max(...vals),rng=(max-min)||1;
    const pts=vals.map((v,i)=>[pad+(i/(vals.length-1))*(W-pad*2), pad+(1-(v-min)/rng)*(H-pad*2)]);
    let d='M'+pts.map(p=>p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' L');
    const line=d; const area=d+` L${(W-pad).toFixed(1)} ${H} L${pad} ${H} Z`;
    return {line,area,last:pts[pts.length-1]};
  }

  SP.registerScreen('portfolio',{render(host){
    const {line,area,last}=areaPath(data.series1M,560,150);
    const total=data.allocation.reduce((s,x)=>s+x.v,0);
    const a0pct=(data.allocation[0].v/total*100), a1pct=100-a0pct;
    const donut=`conic-gradient(var(--risk-1) 0 ${a0pct}%, var(--muted-foreground) ${a0pct}% 100%)`;
    host.innerHTML=`<div class="page page-wide">
      <div class="pagehead"><div><h1>Portfolio</h1><div class="sub">Your position, performance, and risk — net of everything.</div></div>
        <div class="actions"><button class="btn btn-outline btn-md" onclick="SP.navigate('vault')">${icon('vault',16)} Open vault</button>
        <button class="btn btn-primary btn-md" onclick="SP.navigate('chat')">${icon('chat',16)} Ask AI</button></div></div>

      <div class="pf-hero">
        <div class="card card-pad">
          <div class="card-hd"><span class="lbl">Net worth</span>
            <div class="seg pf-range">${['1D','1W','1M','1Y','All'].map((r,i)=>`<button class="${i===2?'active':''}">${r}</button>`).join('')}</div></div>
          <div class="pf-net tnum">${money(data.netWorth)}</div>
          <div class="delta up" style="margin-top:8px">${icon('up',15)}+${money(data.pnl.abs)} (+${data.pnl.pct}%, ${data.pnl.window})</div>
          <div class="pf-spark-area">
            <svg width="100%" height="150" viewBox="0 0 560 150" preserveAspectRatio="none">
              <defs><linearGradient id="pfg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--primary)" stop-opacity=".26"/><stop offset="1" stop-color="var(--primary)" stop-opacity="0"/></linearGradient></defs>
              <path d="${area}" fill="url(#pfg)"/><path d="${line}" fill="none" stroke="var(--primary)" stroke-width="2"/>
              <circle cx="${last[0]}" cy="${last[1]}" r="4" fill="var(--primary)"/><circle cx="${last[0]}" cy="${last[1]}" r="8" fill="var(--primary)" opacity=".2"/>
            </svg>
          </div>
        </div>
        <div class="card card-pad riskpanel">
          <div class="card-hd"><span class="lbl">Risk panel</span>${riskChip(1)}</div>
          <div class="rp-row"><span class="muted">Portfolio risk</span><span style="font-weight:600">Lower · 1/5</span></div>
          <div class="rp-row"><span class="muted">Drift vs your plan</span><span style="color:var(--gain);font-weight:600;display:inline-flex;align-items:center;gap:5px">${icon('check',13)} On plan</span></div>
          <div class="rp-row"><span class="muted">Concentration</span><span style="font-weight:600">${a0pct.toFixed(0)}% single vault</span></div>
          <div class="rp-row"><span class="muted">Largest position</span><span style="font-weight:600">Aave Yield Vault</span></div>
          <div style="margin-top:12px;font-size:12px;color:var(--muted-foreground);line-height:1.5">Capital-preservation-first. The audited Aave vault is the lowest tier on our scale. <a style="color:var(--primary);cursor:pointer" onclick="SP.navigate('strategies')">Improve this</a></div>
        </div>
      </div>

      <div class="pf-grid">
        <div class="card card-pad">
          <div class="card-hd"><span class="t">Allocation by risk tier</span></div>
          <div style="display:flex;align-items:center;gap:24px">
            <div class="donut" style="background:${donut};position:relative"><div style="position:absolute;inset:18px;border-radius:50%;background:var(--card);display:grid;place-items:center;text-align:center"><div><div style="font-size:18px;font-weight:600" class="tnum">${money(total,0)}</div><div style="font-size:10px;color:var(--muted-foreground)">2 positions</div></div></div></div>
            <div class="legend" style="flex:1">
              <div class="legrow"><span class="sw" style="background:var(--risk-1)"></span><span class="lg">Aave Yield Vault · Risk 1</span><span class="lv tnum">${a0pct.toFixed(0)}%</span></div>
              <div class="legrow"><span class="sw" style="background:var(--muted-foreground)"></span><span class="lg">Idle USDC · uninvested</span><span class="lv tnum">${a1pct.toFixed(0)}%</span></div>
              <div class="divider"></div>
              <div style="font-size:12px;color:var(--muted-foreground)">Idle USDC earns nothing. <a style="color:var(--primary);cursor:pointer" onclick="SP.navigate('vault/deposit')">Put it to work</a></div>
            </div>
          </div>
        </div>
        <div class="card card-pad">
          <div class="card-hd"><span class="t">Positions</span><span class="lbl">net of fees</span></div>
          <table class="tbl"><thead><tr><th>Position</th><th class="num">Value</th><th class="num">PnL</th><th></th></tr></thead><tbody>
            <tr style="cursor:pointer" data-go="portfolio/vault"><td><div style="font-weight:600">Aave Yield Vault</div><div class="muted" style="font-size:12px">9,834.50 spvUSDC</div></td><td class="num tnum">${money(data.allocation[0].v)}</td><td class="num"><span class="delta up" style="font-size:12.5px">+$34.42</span></td><td>${icon('chevr',15)}</td></tr>
            <tr><td><div style="font-weight:600">Idle USDC</div><div class="muted" style="font-size:12px">in your wallet</div></td><td class="num tnum">${money(data.allocation[1].v)}</td><td class="num muted">—</td><td></td></tr>
          </tbody></table>
        </div>
      </div>
    </div>`;
    host.querySelectorAll('[data-go]').forEach(r=>r.onclick=()=>navigate(r.getAttribute('data-go')));
    host.querySelectorAll('.pf-range button').forEach((b,i)=>b.onclick=()=>{host.querySelectorAll('.pf-range button').forEach(x=>x.classList.remove('active'));b.classList.add('active');});
  }});

  SP.registerScreen('portfolio/vault',{render(host){
    host.innerHTML=`<div class="page page-narrow">
      <a class="qlink" style="display:inline-flex;margin-bottom:14px" onclick="SP.navigate('portfolio')">${icon('chevr',15)} Back to portfolio</a>
      <div class="pagehead"><div><h1>Aave Yield Vault</h1><div class="sub">Your position detail</div></div>${riskChip(1)}</div>
      <div class="card card-pad" style="margin-bottom:16px">
        <div class="posstats">
          <div class="stat"><span class="k">Shares</span><span class="v tnum">9,834.5031</span><span class="muted" style="font-size:11px">spvUSDC</span></div>
          <div class="stat"><span class="k">Value</span><span class="v tnum">${money(data.vault.shareValue)}</span></div>
          <div class="stat"><span class="k">Accrued yield</span><span class="v tnum" style="color:var(--gain)">+${money(data.vault.accrued)}</span></div>
        </div></div>
      <div class="card card-pad">
        <div class="card-hd"><span class="t">Transactions</span></div>
        <table class="tbl"><tbody>${data.txs.map(t=>`<tr><td><div style="font-weight:600">${t.type}</div><div class="muted" style="font-size:12px">${t.time}</div></td><td class="num tnum" style="color:${t.dir==='in'?'var(--gain)':'var(--foreground)'}">${t.amt}</td><td class="num muted tnum">${t.usd}</td><td><a class="cite" style="cursor:pointer">tx ${icon('ext',10)}</a></td></tr>`).join('')}</tbody></table>
      </div>
      <div style="display:flex;gap:10px;margin-top:18px"><button class="btn btn-primary btn-md" onclick="SP.navigate('vault/deposit')">Add to position</button><button class="btn btn-outline btn-md" onclick="SP.navigate('vault/withdraw')">Withdraw</button></div>
    </div>`;
  }});
})();
