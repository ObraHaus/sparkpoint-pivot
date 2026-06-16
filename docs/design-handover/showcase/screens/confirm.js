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
          ${isDep?`<div class="bc-row"><span class="muted">Net APY on new shares</span><span class="tnum">4.3%</span></div>`:''}
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
})();
