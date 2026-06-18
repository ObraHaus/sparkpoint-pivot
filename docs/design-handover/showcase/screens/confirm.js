/* ===== confirm.js — Execution Confirmation & Pre-Trade Simulation (the trust gate) ===== */
(function(){
  const {icon,data,money,fmt,navigate,reduce} = SP;
  const css=`
.cf-wrap{max-width:560px;margin:0 auto;}
.cf-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;}
.cf-hd{padding:18px 20px;border-bottom:1px solid var(--border-soft);}
.cf-sec{padding:18px 20px;border-bottom:1px solid var(--border-soft);}
.cf-sec:last-child{border-bottom:none;}
.cf-lbl{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted-foreground);margin-bottom:12px;}
.simbar{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:var(--radius);font-size:13.5px;}
.simbar.pass{background:var(--gain-subtle);color:var(--gain);border:1px solid color-mix(in srgb,var(--gain) 26%,transparent);}
.bc-row{display:flex;align-items:center;justify-content:space-between;padding:9px 0;font-size:14px;}
.ackbox{display:flex;gap:11px;align-items:flex-start;padding:12px 14px;border-radius:var(--radius);background:var(--caution-subtle);border:1px solid color-mix(in srgb,var(--caution) 28%,transparent);margin-top:6px;}
.ackcheck{width:20px;height:20px;border-radius:6px;border:2px solid var(--caution);flex:none;cursor:pointer;display:grid;place-items:center;color:transparent;margin-top:1px;}
.ackcheck.on{background:var(--caution);color:var(--on-solid);}
@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-4px)}40%,80%{transform:translateX(4px)}}
.shake{animation:shake .3s;}
.feeline{display:flex;align-items:center;justify-content:space-between;padding:9px 0;font-size:13.5px;}
.feeline .ffi{display:inline-flex;align-items:center;gap:6px;color:var(--muted-foreground);}
.feeline .ii{width:15px;height:15px;border-radius:50%;border:1px solid var(--border);display:grid;place-items:center;font-size:9px;color:var(--muted-foreground);cursor:help;}
.feeline.free .strike{text-decoration:line-through;color:var(--muted-foreground);margin-right:6px;}
.trace{margin-top:6px;}
.trace summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:7px;font-size:13px;font-weight:500;color:var(--info);}
.trace summary::-webkit-details-marker{display:none;}
.trace-row{display:flex;gap:10px;align-items:flex-start;padding:7px 0;font-size:12.5px;color:var(--muted-foreground);}
.trace-row .tn{width:20px;height:20px;border-radius:50%;background:var(--muted);display:grid;place-items:center;font-size:10px;font-weight:600;color:var(--foreground);flex:none;}
.trace-row.hinge .tn{background:var(--spark-subtle);color:var(--primary);box-shadow:0 0 0 2px var(--spark-subtle);}
.trace-row b{color:var(--foreground);font-weight:600;}
`;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

  function render(host,mode){
    const isDep=mode!=='withdraw';
    const title=isDep?'Deposit 2,150 USDC':'Withdraw 5,000 USDC';
    host.innerHTML=`<div class="page"><div class="cf-wrap">
      <a class="qlink" style="display:inline-flex;margin-bottom:14px" onclick="history.back()">${icon('chevr',15)} Back</a>
      <div class="cf-card">
        <div class="cf-hd"><div style="display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:17px;font-weight:600">Confirm: ${isDep?'Deposit':'Withdrawal'}</div>${icon('flask',18)}</div>
          <div style="font-size:13.5px;color:var(--muted-foreground);margin-top:6px">${isDep?'You\'re depositing 2,150 USDC into the Aave Yield Vault. You\'ll receive ≈ 2,118.4 spvUSDC.':'You\'re withdrawing 5,000 USDC from the Aave Yield Vault to your wallet.'}</div>
        </div>
        <div class="cf-sec" id="simsec"><div class="cf-lbl">Pre-trade simulation</div><div id="simbody"></div></div>
        <div class="cf-sec" id="bcsec" style="display:none"><div class="cf-lbl">Balance changes (simulated)</div>
          <div class="bc-row"><span class="muted">${isDep?'USDC out':'spvUSDC redeemed'}</span><span class="tnum" style="color:var(--loss)">−${isDep?'2,150.00 USDC':'4,902.10 spvUSDC'}</span></div>
          <div class="bc-row"><span class="muted">${isDep?'spvUSDC in':'USDC in'}</span><span class="tnum" style="color:var(--gain)">+${isDep?'2,118.40 spvUSDC':'5,000.00 USDC'}</span></div>
          <div class="bc-row"><span class="muted">Network fee (gas)</span><span class="tnum">≈ $0.01</span></div>
          <div class="bc-row"><span class="muted">Fee on this deposit</span><span class="tnum" style="color:var(--gain)">0% — none</span></div>
          ${isDep?`<div class="bc-row"><span class="muted">Performance fee</span><span class="tnum">10% of yield (over HWM)</span></div><div class="bc-row"><span class="muted">Net APY on new shares</span><span class="tnum">3.87%</span></div>`:''}
        </div>
        <div class="cf-sec" id="guardsec" style="display:none"><div class="cf-lbl">Guardrail checklist</div>
          <div class="guard pass"><span class="gi">${icon('check',16)}</span><span class="gt">Within your beta cap (${money(data.vault.capUser,0)})</span></div>
          <div class="guard pass"><span class="gi">${icon('check',16)}</span><span class="gt">Slippage under your max (0.5%)</span></div>
          <div class="guard pass"><span class="gi">${icon('check',16)}</span><span class="gt">Allowlisted protocol — Aave v3 (Base)</span></div>
          <div class="guard pass"><span class="gi">${icon('check',16)}</span><span class="gt">Simulation passed — no risks detected</span></div>
          ${isDep?`<div class="ackbox"><div class="ackcheck" id="ack">${icon('check',13)}</div>
            <div style="flex:1"><div style="font-size:13.5px;font-weight:600">Requires your acknowledgement</div>
            <div style="font-size:12.5px;color:var(--muted-foreground);margin-top:2px">This uses your full idle balance, leaving no USDC buffer in your wallet.</div>
            <div style="font-size:12px;color:var(--caution);margin-top:6px;font-weight:600">I understand this is above my usual buffer.</div></div></div>`:''}
        </div>
        <div class="cf-sec" id="ctrlsec" style="display:none">
          <div style="display:flex;gap:9px;align-items:flex-start;font-size:13px;color:var(--muted-foreground);line-height:1.5">${icon('shieldcheck',16)}<span><b style="color:var(--foreground)">Nothing moves until you sign.</b> You can cancel now with no effect. SparkPoint never holds your funds.</span></div>
        </div>
        <div class="cf-sec" id="signsec" style="display:none">
          <div id="signhelp" style="font-size:12px;color:var(--caution);margin-bottom:10px;${isDep?'':'display:none'}">${icon('alert',13)} Acknowledge the item above to enable signing.</div>
          <div style="display:flex;gap:10px"><button class="btn btn-outline btn-lg" onclick="SP.navigate('vault')" style="flex:none">Cancel</button>
            <button class="btn btn-primary btn-lg" id="signbtn" style="flex:1" ${isDep?'disabled':''}>${icon('key',16)} Sign ${isDep?'deposit':'withdrawal'}</button></div>
        </div>
      </div>
    </div></div>`;

    // simulation reveal
    const sim=host.querySelector('#simbody');
    const steps=[{a:'Building the transaction',b:'Built the transaction'},{a:'Simulating against Base state',b:'Simulated against Base state'},{a:'Checking your guardrails',b:'Checked your guardrails'}];
    let i=0;
    sim.innerHTML='';
    (function go(){
      if(i>=steps.length){
        sim.innerHTML=`<div class="simbar pass">${icon('check',16)} Simulation passed — no risks detected.</div>`;
        ['#bcsec','#guardsec','#ctrlsec','#signsec'].forEach((s,k)=>{const el=host.querySelector(s);setTimeout(()=>{el.style.display='block';if(!reduce&&typeof gsap!=='undefined')gsap.fromTo(el,{opacity:0,y:8},{opacity:1,y:0,duration:.3});},k*120);});
        wireSign(host,isDep);
        return;
      }
      const r=document.createElement('div');r.style.cssText='display:flex;align-items:center;gap:9px;font-size:13px;color:var(--muted-foreground);padding:4px 0';
      r.innerHTML=`<span class="ai-dot"></span><span>${steps[i].a}…</span>`;sim.appendChild(r);
      setTimeout(()=>{r.querySelector('.ai-dot').outerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gain)" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>`;r.querySelector('span:last-child').textContent=steps[i].b;i++;setTimeout(go,reduce?80:280);},reduce?120:520);
    })();
  }

  function wireSign(host,isDep){
    const signbtn=host.querySelector('#signbtn'), help=host.querySelector('#signhelp'), ack=host.querySelector('#ack');
    if(isDep&&ack){ ack.onclick=()=>{ ack.classList.toggle('on'); const ok=ack.classList.contains('on'); signbtn.disabled=!ok; help.style.display=ok?'none':'block'; }; }
    signbtn.onclick=()=>{
      if(signbtn.disabled){ const sec=host.querySelector('#guardsec'); sec.classList.add('shake'); setTimeout(()=>sec.classList.remove('shake'),320); return; }
      signbtn.innerHTML=`<span class="ai-dot" style="background:var(--primary-foreground)"></span> Waiting for your wallet…`; signbtn.disabled=true;
      setTimeout(()=>success(host,isDep),1400);
    };
  }
  function success(host,isDep){
    host.querySelector('.cf-card').innerHTML=`<div style="padding:40px 24px;text-align:center">
      <div style="width:64px;height:64px;border-radius:50%;background:var(--gain-subtle);display:grid;place-items:center;margin:0 auto 16px" id="okc"><span style="color:var(--gain)">${icon('check',30,2.5)}</span></div>
      <div style="font-size:20px;font-weight:600;margin-bottom:8px">${isDep?'Deposit confirmed.':'Withdrawal confirmed.'}</div>
      <div style="font-size:14px;color:var(--muted-foreground);line-height:1.5;max-width:380px;margin:0 auto 6px">${isDep?'You now hold 11,952.9 spvUSDC (≈ '+money(12152.82)+').':money(5000)+' is back in your wallet.'}</div>
      <a class="cite" style="cursor:pointer;display:inline-flex;margin-bottom:20px">View transaction ${icon('ext',11)}</a>
      <div style="display:flex;gap:10px;justify-content:center"><button class="btn btn-outline btn-md" onclick="SP.navigate('portfolio')">See it in your portfolio</button><button class="btn btn-primary btn-md" onclick="SP.navigate('chat')">Back to chat</button></div>
    </div>`;
    if(!reduce&&typeof gsap!=='undefined'){gsap.fromTo('#okc',{scale:.5,opacity:0},{scale:1,opacity:1,duration:.4,ease:'back.out(2)'});}
    SP.toast(isDep?'Deposit confirmed · View tx ↗':'Withdrawal confirmed · View tx ↗');
  }

  SP.registerScreen('confirm/deposit',{render(h){render(h,'deposit');}});
  SP.registerScreen('confirm/withdraw',{render(h){render(h,'withdraw');}});
  SP.registerScreen('confirm',{render(h){render(h,'deposit');}});

  /* ===== Swap confirm variant (Flow 9) ===== */
  const FREE_SWAPS_LEFT = 0; // 0 = standard fee active (per client: show 0.20% with $ amount)
  function renderSwap(host){
    const free = FREE_SWAPS_LEFT>0;
    host.innerHTML=`<div class="page"><div class="cf-wrap">
      <a class="qlink" style="display:inline-flex;margin-bottom:14px" onclick="SP.navigate('chat')">${icon('chevr',15)} Back to chat</a>
      <div class="cf-card">
        <div class="cf-hd"><div style="display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:17px;font-weight:600">Confirm: Swap</div><span class="badge badge-ai">AI suggestion — you approve &amp; sign</span></div>
          <div style="font-size:13.5px;color:var(--muted-foreground);margin-top:6px">You’re swapping <b style="color:var(--foreground)">0.1 ETH</b> for ≈ <b style="color:var(--foreground)">312.40 USDC</b> on Aerodrome.</div>
        </div>
        <div class="cf-sec" id="simsec"><div class="cf-lbl">Pre-trade simulation</div><div id="simbody"></div></div>
        <div class="cf-sec" id="bcsec" style="display:none"><div class="cf-lbl">Balance changes (simulated)</div>
          <div class="bc-row"><span class="muted">ETH out</span><span class="tnum" style="color:var(--loss)">− 0.1000 ETH · −$500.00</span></div>
          <div class="bc-row"><span class="muted">USDC in</span><span class="tnum" style="color:var(--gain)">+ 312.40 USDC · +$312.40</span></div>
          <div class="bc-row"><span class="muted">Network fee (gas)</span><span class="tnum">≈ $0.05</span></div>
          <div class="bc-row"><span class="muted">Expected output</span><span class="tnum">≈ 312.40 USDC</span></div>
          <div class="bc-row"><span class="muted">Minimum received <span style="font-size:11px">(at 0.5% max slippage)</span></span><span class="tnum">310.84 USDC</span></div>
        </div>
        <div class="cf-sec" id="costsec" style="display:none"><div class="cf-lbl">Cost &amp; outcome</div>
          <div class="feeline ${free?'free':''}"><span class="ffi">SparkPoint routing fee · 0.20% <span class="ii" id="feeinfo" title="A usage fee for routing this swap. It’s taken inside this swap — SparkPoint never holds your funds. It never applies to the vault or your deposits.">i</span></span>
            <span class="tnum">${free?`<span class="strike">$0.62</span>$0.00 — first ${FREE_SWAPS_LEFT} free`:`$0.62`}</span></div>
          <div class="feeline"><span class="ffi">Net USDC received</span><span class="tnum" style="color:var(--foreground);font-weight:600">≈ 311.78 USDC</span></div>
        </div>
        <div class="cf-sec" id="guardsec" style="display:none"><div class="cf-lbl">Guardrail checklist</div>
          <div class="guard pass"><span class="gi">${icon('check',16)}</span><span class="gt">Route allowlisted — Aerodrome (Base)</span></div>
          <div class="guard pass"><span class="gi">${icon('check',16)}</span><span class="gt">Slippage under your max (0.5%)</span></div>
          <div class="guard pass"><span class="gi">${icon('check',16)}</span><span class="gt">Policy approved</span></div>
          <div class="guard pass"><span class="gi">${icon('check',16)}</span><span class="gt">Simulation passed — no risks detected</span></div>
          <details class="trace"><summary>${icon('info',14)} How it works</summary>
            <div style="margin-top:8px">
              <div class="trace-row"><span class="tn">1</span><div>You ask Sparky to <b>swap ETH for USDC</b></div></div>
              <div class="trace-row"><span class="tn">2</span><div>Policy layer checks <b>Aerodrome allowlist, limits, slippage</b></div></div>
              <div class="trace-row"><span class="tn">3</span><div>Tenderly <b>simulates</b> the exact swap — output, min received, gas</div></div>
              <div class="trace-row hinge"><span class="tn">4</span><div><b>You sign.</b> Nothing moves before this.</div></div>
              <div class="trace-row"><span class="tn">5</span><div>Aerodrome swaps — the <b>routing fee leg</b> is taken inside your signed swap</div></div>
              <div class="trace-row"><span class="tn">6</span><div>Result recorded to your <b>Outcome Log</b></div></div>
            </div></details>
        </div>
        <div class="cf-sec" id="ctrlsec" style="display:none">
          <div style="display:flex;gap:9px;align-items:flex-start;font-size:13px;color:var(--muted-foreground);line-height:1.5">${icon('shieldcheck',16)}<span><b style="color:var(--foreground)">Nothing moves until you sign.</b> You can cancel now with no effect. SparkPoint never holds your funds.</span></div>
        </div>
        <div class="cf-sec" id="signsec" style="display:none">
          <div style="display:flex;gap:10px"><button class="btn btn-outline btn-lg" onclick="SP.navigate('chat')" style="flex:none">Cancel</button>
            <button class="btn btn-primary btn-lg" id="signbtn" style="flex:1">${icon('key',16)} Sign transaction</button></div>
        </div>
      </div>
    </div></div>`;
    const sim=host.querySelector('#simbody');
    const steps=[{a:'Building the swap',b:'Built the swap'},{a:'Simulating on Aerodrome',b:'Simulated on Aerodrome'},{a:'Checking your guardrails',b:'Checked your guardrails'}];
    let i=0;
    (function go(){
      if(i>=steps.length){
        sim.innerHTML=`<div class="simbar pass">${icon('check',16)} Simulation passed — no risks detected.</div>`;
        ['#bcsec','#costsec','#guardsec','#ctrlsec','#signsec'].forEach((s,k)=>{const el=host.querySelector(s);setTimeout(()=>{el.style.display='block';if(!reduce&&typeof gsap!=='undefined')gsap.fromTo(el,{opacity:0,y:8},{opacity:1,y:0,duration:.3});},k*110);});
        host.querySelector('#signbtn').onclick=()=>{const b=host.querySelector('#signbtn');b.innerHTML=`<span class="ai-dot" style="background:var(--primary-foreground)"></span> Waiting for your wallet…`;b.disabled=true;setTimeout(()=>swapSuccess(host),1400);};
        return;
      }
      const r=document.createElement('div');r.style.cssText='display:flex;align-items:center;gap:9px;font-size:13px;color:var(--muted-foreground);padding:4px 0';
      r.innerHTML=`<span class="ai-dot"></span><span>${steps[i].a}…</span>`;sim.appendChild(r);
      setTimeout(()=>{r.querySelector('.ai-dot').outerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gain)" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>`;r.querySelector('span:last-child').textContent=steps[i].b;i++;setTimeout(go,reduce?80:280);},reduce?120:520);
    })();
  }
  function swapSuccess(host){
    host.querySelector('.cf-card').innerHTML=`<div style="padding:36px 24px 24px;text-align:center">
      <div style="width:60px;height:60px;border-radius:50%;background:var(--gain-subtle);display:grid;place-items:center;margin:0 auto 14px" id="okc"><span style="color:var(--gain)">${icon('check',28,2.5)}</span></div>
      <div style="font-size:19px;font-weight:600;margin-bottom:7px">Swap confirmed.</div>
      <div style="font-size:13.5px;color:var(--muted-foreground);line-height:1.5;max-width:360px;margin:0 auto 4px">You received ≈ 311.78 USDC via Aerodrome. Routing fee paid: $0.62 (0.20%).</div>
      <a class="cite" style="cursor:pointer;display:inline-flex;margin-bottom:18px">View transaction ${icon('ext',11)}</a>
      <div class="card" style="text-align:left;padding:16px;margin:0 0 4px;border-color:color-mix(in srgb,var(--primary) 26%,transparent)">
        <span class="badge badge-ai" style="margin-bottom:9px">AI suggestion — you approve &amp; sign</span>
        <div style="font-size:14px;font-weight:600;margin-bottom:6px">Put your USDC to work?</div>
        <div style="font-size:12.5px;color:var(--muted-foreground);line-height:1.5;margin-bottom:12px">You now hold ≈ 311.78 USDC. Deposit it into the Aave Yield Vault and start earning — <b style="color:var(--foreground)">3.87% net APY</b> (estimate · see breakdown). 0% on your deposit; 10% performance fee on yield only. Withdraw anytime.</div>
        <div style="display:flex;gap:9px"><button class="btn btn-primary btn-md" onclick="SP.navigate('confirm/deposit')">Review deposit</button><button class="btn btn-ghost btn-md" onclick="SP.navigate('portfolio')">Not now</button></div>
      </div>
    </div>`;
    if(!reduce&&typeof gsap!=='undefined'){gsap.fromTo('#okc',{scale:.5,opacity:0},{scale:1,opacity:1,duration:.4,ease:'back.out(2)'});}
    SP.toast('Swap confirmed · View tx ↗');
  }
  SP.registerScreen('confirm/swap',{render(h){renderSwap(h);}});

  /* ===== Premium subscription confirm (Flow 10 → Flow 6) ===== */
  function renderPremium(host){
    host.innerHTML=`<div class="page"><div class="cf-wrap">
      <a class="qlink" style="display:inline-flex;margin-bottom:14px" onclick="SP.navigate('premium/pay')">${icon('chevr',15)} Back</a>
      <div class="cf-card">
        <div class="cf-hd"><div style="display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:17px;font-weight:600">Confirm: Premium subscription</div>${icon('flask',18)}</div>
          <div style="font-size:13.5px;color:var(--muted-foreground);margin-top:6px">You're paying <b style="color:var(--foreground)">500 SRK</b> (≈ $12.00) for one month of Premium. This is a subscription payment, not a vault fee.</div>
        </div>
        <div class="cf-sec" id="simsec"><div class="cf-lbl">Pre-trade simulation</div><div id="simbody"></div></div>
        <div class="cf-sec" id="bcsec" style="display:none"><div class="cf-lbl">Balance changes (simulated)</div>
          <div class="bc-row"><span class="muted">SRK out</span><span class="tnum" style="color:var(--loss)">− 500 SRK · −$12.00</span></div>
          <div class="bc-row"><span class="muted">Steps</span><span class="tnum">approve + pay</span></div>
          <div class="bc-row"><span class="muted">Network fee (gas)</span><span class="tnum">≈ $0.02</span></div>
          <div class="bc-row"><span class="muted">SparkPoint fee</span><span>n/a — subscription payment, not a vault fee</span></div>
        </div>
        <div class="cf-sec" id="guardsec" style="display:none"><div class="cf-lbl">Guardrail checklist</div>
          <div class="guard pass"><span class="gi">${icon('check',16)}</span><span class="gt">Allowlisted — SparkPoint subscription contract</span></div>
          <div class="guard pass"><span class="gi">${icon('check',16)}</span><span class="gt">Exact amount — 500 SRK, no unlimited approval</span></div>
          <div class="guard pass"><span class="gi">${icon('check',16)}</span><span class="gt">Simulation passed — no risks detected</span></div>
        </div>
        <div class="cf-sec" id="ctrlsec" style="display:none">
          <div style="display:flex;gap:9px;align-items:flex-start;font-size:13px;color:var(--muted-foreground);line-height:1.5">${icon('shieldcheck',16)}<span><b style="color:var(--foreground)">Nothing moves until you sign.</b> Premium never gates the vault, deposits, yield, or withdrawals. Cancel anytime.</span></div>
        </div>
        <div class="cf-sec" id="signsec" style="display:none">
          <div style="display:flex;gap:10px"><button class="btn btn-outline btn-lg" onclick="SP.navigate('premium')" style="flex:none">Cancel</button>
            <button class="btn btn-primary btn-lg" id="signbtn" style="flex:1">${icon('key',16)} Sign &amp; subscribe</button></div>
        </div>
      </div>
    </div></div>`;
    const sim=host.querySelector('#simbody');
    const steps=[{a:'Building the payment',b:'Built the payment'},{a:'Simulating approve + pay',b:'Simulated approve + pay'},{a:'Checking your guardrails',b:'Checked your guardrails'}];
    let i=0;
    (function go(){
      if(i>=steps.length){
        sim.innerHTML=`<div class="simbar pass">${icon('check',16)} Simulation passed — no risks detected.</div>`;
        ['#bcsec','#guardsec','#ctrlsec','#signsec'].forEach((s,k)=>{const el=host.querySelector(s);setTimeout(()=>{el.style.display='block';if(!reduce&&typeof gsap!=='undefined')gsap.fromTo(el,{opacity:0,y:8},{opacity:1,y:0,duration:.3});},k*110);});
        host.querySelector('#signbtn').onclick=()=>{const b=host.querySelector('#signbtn');b.innerHTML=`<span class="ai-dot" style="background:var(--primary-foreground)"></span> Waiting for your wallet…`;b.disabled=true;setTimeout(()=>{
          host.querySelector('.cf-card').innerHTML=`<div style="padding:38px 24px;text-align:center">
            <div style="width:60px;height:60px;border-radius:50%;background:var(--gain-subtle);display:grid;place-items:center;margin:0 auto 14px" id="okc"><span style="color:var(--gain)">${icon('check',28,2.5)}</span></div>
            <div style="font-size:19px;font-weight:600;margin-bottom:7px">Premium active.</div>
            <div style="font-size:13.5px;color:var(--muted-foreground);line-height:1.5;max-width:360px;margin:0 auto 6px">Premium subscription: 500 SRK (paid in SRK) — not a vault fee. Renews monthly · cancel anytime in Settings.</div>
            <a class="cite" style="cursor:pointer;display:inline-flex;margin-bottom:18px">View transaction ${icon('ext',11)}</a>
            <div style="display:flex;gap:10px;justify-content:center"><button class="btn btn-outline btn-md" onclick="SP.navigate('premium')">Manage subscription</button><button class="btn btn-primary btn-md" onclick="SP.navigate('chat')">Back to chat</button></div>
          </div>`;
          if(!reduce&&typeof gsap!=='undefined'){gsap.fromTo('#okc',{scale:.5,opacity:0},{scale:1,opacity:1,duration:.4,ease:'back.out(2)'});}
          SP.toast('Premium active · View tx ↗');
        },1400);};
        return;
      }
      const r=document.createElement('div');r.style.cssText='display:flex;align-items:center;gap:9px;font-size:13px;color:var(--muted-foreground);padding:4px 0';
      r.innerHTML=`<span class="ai-dot"></span><span>${steps[i].a}…</span>`;sim.appendChild(r);
      setTimeout(()=>{r.querySelector('.ai-dot').outerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gain)" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>`;r.querySelector('span:last-child').textContent=steps[i].b;i++;setTimeout(go,reduce?80:280);},reduce?120:520);
    })();
  }
  SP.registerScreen('confirm/premium',{render(h){renderPremium(h);}});

  /* ===== Bridge confirm (Base ↔ Sui) ===== */
  function renderBridge(host){
    host.innerHTML=`<div class="page"><div class="cf-wrap">
      <a class="qlink" style="display:inline-flex;margin-bottom:14px" onclick="SP.navigate('bridge')">${icon('chevr',15)} Back to bridge</a>
      <div class="cf-card">
        <div class="cf-hd"><div style="display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:17px;font-weight:600">Confirm: Bridge</div>${icon('flask',18)}</div>
          <div style="font-size:13.5px;color:var(--muted-foreground);margin-top:6px">You're bridging <b style="color:var(--foreground)">500 USDC</b> from <b style="color:var(--foreground)">Base</b> to <b style="color:var(--foreground)">Sui</b>.</div>
        </div>
        <div class="cf-sec" id="simsec"><div class="cf-lbl">Pre-bridge simulation</div><div id="simbody"></div></div>
        <div class="cf-sec" id="bcsec" style="display:none"><div class="cf-lbl">Balance changes (simulated)</div>
          <div class="bc-row"><span class="muted">USDC out · Base</span><span class="tnum" style="color:var(--loss)">− 500.00 USDC</span></div>
          <div class="bc-row"><span class="muted">USDC in · Sui</span><span class="tnum" style="color:var(--gain)">+ 500.00 USDC</span></div>
          <div class="bc-row"><span class="muted">Bridge fee</span><span class="tnum">≈ $0.40</span></div>
          <div class="bc-row"><span class="muted">Est. settlement</span><span class="tnum">~3–5 min</span></div>
        </div>
        <div class="cf-sec" id="guardsec" style="display:none"><div class="cf-lbl">Guardrail checklist</div>
          <div class="guard pass"><span class="gi">${icon('check',16)}</span><span class="gt">Canonical bridge route — allowlisted</span></div>
          <div class="guard pass"><span class="gi">${icon('check',16)}</span><span class="gt">Destination is your own Sui wallet</span></div>
          <div class="guard pass"><span class="gi">${icon('check',16)}</span><span class="gt">Within your bridge cap</span></div>
          <div class="guard pass"><span class="gi">${icon('check',16)}</span><span class="gt">Simulation passed — no risks detected</span></div>
        </div>
        <div class="cf-sec" id="ctrlsec" style="display:none">
          <div style="display:flex;gap:9px;align-items:flex-start;font-size:13px;color:var(--muted-foreground);line-height:1.5">${icon('shieldcheck',16)}<span><b style="color:var(--foreground)">You stay in custody the whole way.</b> Funds leave Base only by your signature and land in your own Sui wallet. SparkPoint never holds them in transit.</span></div>
        </div>
        <div class="cf-sec" id="signsec" style="display:none">
          <div style="display:flex;gap:10px"><button class="btn btn-outline btn-lg" onclick="SP.navigate('bridge')" style="flex:none">Cancel</button>
            <button class="btn btn-primary btn-lg" id="signbtn" style="flex:1">${icon('key',16)} Sign bridge</button></div>
        </div>
      </div>
    </div></div>`;
    const sim=host.querySelector('#simbody');
    const steps=[{a:'Building the bridge message',b:'Built the bridge message'},{a:'Simulating lock on Base',b:'Simulated lock on Base'},{a:'Checking your guardrails',b:'Checked your guardrails'}];
    let i=0;
    (function go(){
      if(i>=steps.length){
        sim.innerHTML=`<div class="simbar pass">${icon('check',16)} Simulation passed — no risks detected.</div>`;
        ['#bcsec','#guardsec','#ctrlsec','#signsec'].forEach((s,k)=>{const el=host.querySelector(s);setTimeout(()=>{el.style.display='block';if(!reduce&&typeof gsap!=='undefined')gsap.fromTo(el,{opacity:0,y:8},{opacity:1,y:0,duration:.3});},k*110);});
        host.querySelector('#signbtn').onclick=()=>{const b=host.querySelector('#signbtn');b.innerHTML=`<span class="ai-dot" style="background:var(--primary-foreground)"></span> Waiting for your wallet…`;b.disabled=true;setTimeout(()=>{
          host.querySelector('.cf-card').innerHTML=`<div style="padding:36px 24px;text-align:center">
            <div style="width:60px;height:60px;border-radius:50%;background:var(--gain-subtle);display:grid;place-items:center;margin:0 auto 14px" id="okc"><span style="color:var(--gain)">${icon('check',28,2.5)}</span></div>
            <div style="font-size:19px;font-weight:600;margin-bottom:7px">Bridge initiated.</div>
            <div style="font-size:13.5px;color:var(--muted-foreground);line-height:1.5;max-width:360px;margin:0 auto 6px">500 USDC is on its way from Base to Sui — usually 3–5 minutes. You'll get a notification when it lands in your Sui wallet.</div>
            <a class="cite" style="cursor:pointer;display:inline-flex;margin-bottom:18px">Track on bridge explorer ${icon('ext',11)}</a>
            <div style="display:flex;gap:10px;justify-content:center"><button class="btn btn-outline btn-md" onclick="SP.navigate('portfolio')">View portfolio</button><button class="btn btn-primary btn-md" onclick="SP.navigate('chat')">Back to chat</button></div>
          </div>`;
          if(!reduce&&typeof gsap!=='undefined'){gsap.fromTo('#okc',{scale:.5,opacity:0},{scale:1,opacity:1,duration:.4,ease:'back.out(2)'});}
          SP.toast('Bridge initiated · Base → Sui');
        },1400);};
        return;
      }
      const r=document.createElement('div');r.style.cssText='display:flex;align-items:center;gap:9px;font-size:13px;line-height:1.4;color:var(--muted-foreground);padding:4px 0';
      r.innerHTML=`<span class="ai-dot"></span><span>${steps[i].a}…</span>`;sim.appendChild(r);
      setTimeout(()=>{r.querySelector('.ai-dot').outerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gain)" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>`;r.querySelector('span:last-child').textContent=steps[i].b;i++;setTimeout(go,reduce?80:280);},reduce?120:520);
    })();
  }
  SP.registerScreen('confirm/bridge',{render(h){renderBridge(h);}});
})();
