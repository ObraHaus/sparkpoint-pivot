/* ===== premium.js — Subscriptions & Premium AI tier (Flow 10), paid in SRK ===== */
(function(){
  const {icon,navigate,reduce}=SP;
  const css=`
.pm-banner{display:flex;align-items:flex-start;gap:11px;padding:13px 16px;border-radius:var(--radius);
  background:var(--info-subtle);border:1px solid color-mix(in srgb,var(--info) 22%,transparent);font-size:13px;line-height:1.5;color:var(--muted-foreground);margin-bottom:20px;}
.pm-banner svg{color:var(--info);flex:none;margin-top:1px;}
.pm-banner b{color:var(--foreground);}
.matrix{width:100%;border-collapse:collapse;}
.matrix th,.matrix td{padding:13px 14px;border-bottom:1px solid var(--border-soft);font-size:13.5px;text-align:left;}
.matrix th{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted-foreground);}
.matrix .col{text-align:center;width:130px;}
.matrix .feat{color:var(--foreground);}
.matrix .ok{color:var(--gain);} .matrix .no{color:var(--muted-foreground);}
.matrix tr.head-prem th{color:var(--primary);}
.plan-cards{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;}
@media(max-width:820px){.plan-cards{grid-template-columns:1fr;}.matrix .col{width:auto;}}
.plan{border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;background:var(--card);}
.plan.prem{border-color:color-mix(in srgb,var(--primary) 40%,transparent);box-shadow:0 0 0 1px var(--spark-subtle);}
.plan .pn{font-size:13px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.05em;}
.plan .pp{font-size:28px;font-weight:600;margin:8px 0 2px;letter-spacing:-.01em;}
.plan .psub{font-size:12.5px;color:var(--muted-foreground);}
.payrow{display:flex;align-items:center;justify-content:space-between;padding:11px 0;border-bottom:1px solid var(--border-soft);font-size:13.5px;}
.payrow:last-child{border-bottom:none;}
`;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

  const FEATURES=[
    ['AI chat assistant','Full','Full'],
    ['Portfolio &amp; read access','Full','Full'],
    ['Aave Yield Vault — deposit / yield / withdraw','Full','Full'],
    ['Swaps &amp; withdraw-always','Full','Full'],
    ['Strategy analysis','Basic','Deeper &amp; more frequent'],
    ['Advanced strategy vaults (when live)','—','Included'],
    ['Limits &amp; priority compute','Standard','Higher'],
    ['Advanced analytics &amp; alerts','—','Included'],
    ['Scoped auto-rebalance','—','Higher caps'],
  ];

  SP.registerScreen('premium',{render(host){
    host.innerHTML=`<div class="page page-narrow">
      <div class="pagehead"><div><h1>Premium</h1><div class="sub">Optional advanced AI, paid in SRK. The free tier is fully capable.</div></div></div>
      <div class="pm-banner">${icon('info',16)}<span><b>Premium is optional.</b> Everything that matters — the chat assistant, the vault, deposits, yield, swaps, and withdraw-always — is free and <b>never requires SRK</b>. Premium only adds advanced capability.</span></div>

      <div class="plan-cards">
        <div class="plan">
          <div class="pn">Free</div><div class="pp">$0</div><div class="psub">Fully capable — forever</div>
          <div style="margin-top:14px;font-size:12.5px;color:var(--muted-foreground);line-height:1.5">Chat, portfolio, the Aave vault, swaps, withdraw-always.</div>
          <button class="btn btn-outline btn-md" style="width:100%;margin-top:16px" disabled>Your current plan</button>
        </div>
        <div class="plan prem">
          <div class="pn" style="color:var(--primary)">Premium</div><div class="pp tnum">500 SRK<span style="font-size:14px;color:var(--muted-foreground);font-weight:500"> /mo</span></div><div class="psub">≈ $12.00 / month · cancel anytime</div>
          <div style="margin-top:14px;font-size:12.5px;color:var(--muted-foreground);line-height:1.5">Deeper analysis, advanced vaults, higher limits, analytics &amp; alerts.</div>
          <button class="btn btn-primary btn-md" style="width:100%;margin-top:16px" onclick="SP.navigate('premium/pay')">Upgrade — pay in SRK</button>
        </div>
      </div>

      <div class="card card-pad">
        <div class="card-hd"><span class="t">Free vs Premium</span><span class="lbl">free tier never gated</span></div>
        <table class="matrix"><thead><tr><th>Feature</th><th class="col">Free</th><th class="col" style="color:var(--primary)">Premium</th></tr></thead><tbody>
          ${FEATURES.map(f=>`<tr><td class="feat">${f[0]}</td>
            <td class="col ${f[1]==='—'?'no':'ok'}">${f[1]==='—'?icon('x',14):f[1]}</td>
            <td class="col ${f[2]==='—'?'no':'ok'}">${f[2]}</td></tr>`).join('')}
        </tbody></table>
      </div>
      <div style="font-size:12px;color:var(--muted-foreground);margin-top:14px;text-align:center">SRK is a non-essential utility token. <a style="color:var(--primary);cursor:pointer" onclick="SP.navigate('fees')">How we make money →</a></div>
    </div>`;
  }});

  SP.registerScreen('premium/pay',{render(host){
    const balance=320, price=500, low=balance<price;
    host.innerHTML=`<div class="page page-narrow">
      <a class="qlink" style="display:inline-flex;margin-bottom:14px" onclick="SP.navigate('premium')">${icon('chevr',15)} Back</a>
      <div class="pagehead"><div><h1>Upgrade to Premium</h1><div class="sub">A subscription payment in SRK — not a vault fee. Cancel anytime.</div></div></div>
      <div class="card card-pad">
        <div class="payrow"><span class="muted">Plan</span><span style="font-weight:600">Premium · monthly</span></div>
        <div class="payrow"><span class="muted">Price</span><span class="tnum">500 SRK <span class="muted">≈ $12.00</span></span></div>
        <div class="payrow"><span class="muted">Your SRK balance</span><span class="tnum" style="color:${low?'var(--caution)':'var(--foreground)'}">${balance} SRK</span></div>
        <div class="payrow"><span class="muted">SparkPoint fee</span><span>n/a — subscription payment, not a vault fee</span></div>
      </div>
      ${low?`<div class="pm-banner" style="margin-top:16px;background:var(--caution-subtle);border-color:color-mix(in srgb,var(--caution) 26%,transparent)">${icon('alert',16)}<span>You need <b>${price-balance} more SRK</b> to pay for the first month. You can acquire SRK, or this never blocks any free feature.</span></div>
        <div style="display:flex;gap:10px;margin-top:8px"><button class="btn btn-outline btn-lg" style="flex:none" onclick="SP.toast('Opens acquire-SRK hand-off')">Acquire SRK</button><button class="btn btn-primary btn-lg" style="flex:1" disabled>Review &amp; sign</button></div>`
      :`<div style="font-size:12px;color:var(--muted-foreground);margin:14px 0">You'll sign an <b style="color:var(--foreground)">approve</b> + <b style="color:var(--foreground)">pay</b> transaction — non-custodial, through the same sign gate as everything else.</div>
        <div style="display:flex;gap:10px"><button class="btn btn-outline btn-lg" style="flex:none" onclick="SP.navigate('premium')">Cancel</button><button class="btn btn-primary btn-lg" style="flex:1" onclick="SP.navigate('confirm/premium')">Review &amp; sign</button></div>`}
      <div style="text-align:center;font-size:11px;color:var(--muted-foreground);margin-top:10px">Premium never gates the vault, deposits, yield, or withdrawals.</div>
    </div>`;
  }});
})();
