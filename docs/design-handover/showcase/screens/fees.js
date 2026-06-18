/* ===== fees.js — Fee Transparency & Revenue Surfaces (Flow 11) ===== */
(function(){
  const {icon,navigate}=SP;
  const css=`
.fees-lede{font-size:15px;color:var(--muted-foreground);line-height:1.55;max-width:680px;margin:6px 0 22px;}
.principle{display:grid;grid-template-columns:1fr 1fr;gap:10px 26px;padding:18px 20px;margin-bottom:20px;}
.principle .pr{display:flex;align-items:center;gap:10px;font-size:13.5px;font-weight:500;}
.principle .pr svg{color:var(--gain);flex:none;}
.fees-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px;}
@media(max-width:900px){.fees-grid,.principle{grid-template-columns:1fr;}}
.fcard h3{font-size:15px;font-weight:600;margin:0 0 12px;display:flex;align-items:center;gap:8px;}
.fcard ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:9px;}
.fcard li{display:flex;gap:9px;font-size:13px;line-height:1.5;color:var(--foreground);}
.fcard li svg{flex:none;margin-top:3px;}
.fcard .muted-li{color:var(--muted-foreground);}
.feetag{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;border-radius:999px;padding:3px 10px;white-space:nowrap;}
.greyed{opacity:.78;}
.notactive{background:var(--muted);color:var(--muted-foreground);border:1px solid var(--border);}
.honesty{padding:20px;margin-bottom:18px;}
.honesty .hbars{display:flex;align-items:flex-end;gap:8px;height:120px;margin-top:14px;}
.honesty .hbar{flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:3px;align-items:center;}
.honesty .hbar .yield{width:100%;border-radius:4px 4px 0 0;background:linear-gradient(180deg,var(--brand-cyan),color-mix(in srgb,var(--brand-cyan) 30%,transparent));}
.honesty .hbar .rev{width:100%;border-radius:0 0 4px 4px;background:var(--muted-foreground);opacity:.5;}
.honesty .hbar .hx{font-size:10px;color:var(--muted-foreground);}
.verify{padding:18px 20px;display:flex;flex-direction:column;gap:11px;}
.verify .vrow{display:flex;align-items:center;justify-content:space-between;font-size:13px;gap:12px;}
.verify .mono{color:var(--muted-foreground);}
`;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

  function honestyBars(){
    const months=['Feb','Mar','Apr','May','Jun'];
    const yld=[40,72,95,120,150], rev=[0,1.2,0.6,1.4,0.4];
    return months.map((m,i)=>`<div class="hbar"><div class="rev" style="height:${rev[i]*4}px"></div><div class="yield" style="height:${yld[i]*.7}px"></div><span class="hx">${m}</span></div>`).join('');
  }

  SP.registerScreen('fees',{render(host){
    host.innerHTML=`<div class="page page-wide">
      <div class="pagehead"><div><h1>Fees &amp; how we make money</h1>
        <div class="fees-lede">We only earn when you earn — never on your principal, never by taking custody. Here's exactly what we charge, when, and why.</div></div></div>

      <div class="card principle">
        <div class="pr">${icon('check',16)} 0 fees on your principal</div>
        <div class="pr">${icon('check',16)} We only earn a % of the profit you make</div>
        <div class="pr">${icon('check',16)} You see every fee before you sign</div>
        <div class="pr">${icon('check',16)} We never hold your funds</div>
      </div>

      <div class="fees-grid">
        <div class="card card-pad fcard">
          <h3>${icon('check',17)} What's free</h3>
          <ul>
            <li>${icon('check',14)}<span><b>The Aave Yield Vault</b> — deposit, earn, and withdraw with <b>0% on your deposits, principal & withdrawals</b>.</span></li>
            <li>${icon('check',14)}The chat assistant (free tier), your portfolio, and withdraw-always.</li>
            <li>${icon('check',14)}You never need SRK for any of this.</li>
          </ul>
        </div>
        <div class="card card-pad fcard">
          <h3>${icon('activity',17)} The one fee today</h3>
          <ul>
            <li><span class="feetag" style="background:var(--spark-subtle);color:var(--primary)">Swap routing fee · 0.20%</span></li>
            <li class="muted-li">Set within a published 0.15–0.30% band.</li>
            <li>${icon('check',14)}Only when <b>you</b> execute a swap.</li>
            <li>${icon('check',14)}Taken inside your own signed swap — never on the vault or deposits.</li>
          </ul>
          <div style="display:flex;gap:8px;margin-top:14px"><button class="btn btn-outline btn-sm" onclick="SP.navigate('confirm/swap')">See an example</button><button class="btn btn-ghost btn-sm">Verify recipient ↗</button></div>
        </div>
        <div class="card card-pad fcard">
          <h3>${icon('coins',17)} Optional: Premium</h3>
          <ul>
            <li>Advanced AI features, <b>paid in SRK</b> — a subscription payment, not a vault fee.</li>
            <li class="muted-li">The free tier stays fully usable. Premium never gates the vault, deposits, yield, or withdrawals.</li>
          </ul>
          <div style="margin-top:14px"><button class="btn btn-outline btn-sm" onclick="SP.navigate('premium')">Compare free vs premium →</button></div>
        </div>
        <div class="card card-pad fcard">
          <h3>${icon('coins',17)} Performance fee · vault <span class="feetag" style="background:var(--spark-subtle);color:var(--primary)">Active · v1</span></h3>
          <ul>
            <li><span class="feetag" style="background:var(--spark-subtle);color:var(--primary)">10% of profit · over high-water mark</span></li>
            <li>${icon('check',14)}Charged <b>only on new profit</b> above your high-water mark — never on your principal or your deposits.</li>
            <li>${icon('check',14)}If your balance dips and recovers, you pay <b>nothing</b> until you’re back above your previous high.</li>
            <li class="muted-li">This is the “we only earn when you earn” fee — accrued transparently, shown in every net-APY breakdown.</li>
          </ul>
        </div>
      </div>

      <div class="card honesty">
        <div class="card-hd"><span class="t">We only earn when you earn</span><span class="lbl">your yield vs our revenue · last 5 months</span></div>
        <div style="display:flex;gap:18px;font-size:12px;color:var(--muted-foreground);margin-top:4px">
          <span style="display:inline-flex;align-items:center;gap:6px"><span style="width:11px;height:11px;border-radius:3px;background:var(--brand-cyan)"></span>Yield earned for you</span>
          <span style="display:inline-flex;align-items:center;gap:6px"><span style="width:11px;height:11px;border-radius:3px;background:var(--muted-foreground);opacity:.5"></span>Fees you paid us</span>
        </div>
        <div class="hbars">${honestyBars()}</div>
        <div style="font-size:12px;color:var(--muted-foreground);margin-top:10px">Historical, net-of-everything — no projections. You've paid <b style="color:var(--foreground)">$0.00</b> in fees so far (vault-only).</div>
      </div>

      <div class="card verify">
        <div class="card-hd" style="margin-bottom:4px"><span class="t">Verify — don't take our word for it</span></div>
        <div class="vrow"><span>Vault deposit/withdraw fee</span><span class="mono">read: feeBps = 0 ${icon('ext',11)}</span></div>
        <div class="vrow"><span>Vault performance fee</span><span class="mono">read: perfFeeBps = 1000 (10%) ${icon('ext',11)}</span></div>
        <div class="vrow"><span>Swap fee-recipient</span><span class="mono">0x7c…F12 ${icon('ext',11)}</span></div>
        <div style="font-size:12px;color:var(--muted-foreground)">These fees live in the contracts, not this app. <a style="color:var(--primary);cursor:pointer" onclick="SP.navigate('trust/permissions')">See permissions →</a></div>
      </div>
    </div>`;
  }});
})();
