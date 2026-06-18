/* ===== bridge.js — Cross-network Bridge (Base ↔ Sui) ===== */
(function(){
  const {icon,navigate,data,fmt}=SP;
  const css=`
.br-wrap{max-width:560px;margin:0 auto;}
.br-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;}
.netbox{background:var(--background);border:1px solid var(--input);border-radius:var(--radius);padding:14px 16px;}
.netbox.focus{border-color:var(--primary);box-shadow:0 0 0 3px var(--spark-subtle);}
.netsel{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:600;cursor:pointer;}
.netsel .ndot{width:16px;height:16px;border-radius:50%;flex:none;}
.br-swap{display:flex;justify-content:center;margin:-10px 0;position:relative;z-index:2;}
.br-swap button{width:38px;height:38px;border-radius:11px;background:var(--card-2);border:1px solid var(--border);color:var(--primary);cursor:pointer;display:grid;place-items:center;transition:.18s;}
.br-swap button:hover{transform:rotate(180deg);border-color:var(--primary);}
.br-amt{display:flex;align-items:center;gap:10px;margin-top:10px;}
.br-amt input{flex:1;background:none;border:none;outline:none;color:var(--foreground);font-size:26px;font-weight:600;font-family:inherit;}
.br-row{display:flex;justify-content:space-between;padding:9px 0;font-size:13.5px;border-bottom:1px solid var(--border-soft);}
.br-row:last-child{border-bottom:none;}
.assetpick{display:flex;gap:8px;}
.assetpick button{font-family:inherit;font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:999px;border:1px solid var(--border);background:var(--background);color:var(--muted-foreground);cursor:pointer;}
.assetpick button.on{border-color:var(--primary);background:var(--spark-subtle);color:var(--primary);}
.route-step{display:flex;gap:11px;align-items:flex-start;padding:8px 0;font-size:12.5px;color:var(--muted-foreground);}
.route-step .rn{width:22px;height:22px;border-radius:50%;background:var(--muted);display:grid;place-items:center;font-size:10px;font-weight:600;color:var(--foreground);flex:none;}
.route-step b{color:var(--foreground);}
`;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

  const NET={base:{name:'Base',color:'#0052FF'},sui:{name:'Sui',color:'#4DA8FF'}};
  let from='base',to='sui',asset='USDC',amt='500.00';

  function balOf(net){const a=data.bridgeAssets.find(x=>x.sym===asset);return a?a[net]:0;}

  SP.registerScreen('bridge',{render(host){
    function draw(){
      const f=NET[from],t=NET[to];
      host.innerHTML=`<div class="page"><div class="br-wrap">
        <div class="pagehead"><div><h1>Bridge</h1><div class="sub">Move assets between networks. Non-custodial — you sign; SparkPoint never holds your funds in transit.</div></div></div>
        <div class="card-pad" style="padding:0">
          <div class="br-card">
            <div class="assetpick" style="margin-bottom:14px">
              ${['USDC','ETH'].map(a=>`<button class="${a===asset?'on':''}" data-asset="${a}">${a}</button>`).join('')}
            </div>
            <div class="netbox">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:11.5px;color:var(--muted-foreground);font-weight:500">From</span>
                <span class="netsel" data-flip-from><span class="ndot" style="background:${f.color}"></span>${f.name}${icon('chevd',13)}</span>
              </div>
              <div class="br-amt"><input id="bramt" inputmode="decimal" value="${amt}"/><span style="font-size:15px;font-weight:600;color:var(--muted-foreground)">${asset}</span></div>
              <div style="font-size:11.5px;color:var(--muted-foreground);margin-top:4px">Balance on ${f.name}: <span class="tnum">${fmt(balOf(from), asset==='ETH'?4:2)} ${asset}</span> · <a style="color:var(--primary);cursor:pointer" data-max>Max</a></div>
            </div>
            <div class="br-swap"><button data-swap title="Swap direction">${icon('refresh',17)}</button></div>
            <div class="netbox">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:11.5px;color:var(--muted-foreground);font-weight:500">To</span>
                <span class="netsel"><span class="ndot" style="background:${t.color}"></span>${t.name}</span>
              </div>
              <div class="br-amt"><span style="flex:1;font-size:26px;font-weight:600" class="tnum">${amt||'0.00'}</span><span style="font-size:15px;font-weight:600;color:var(--muted-foreground)">${asset}</span></div>
              <div style="font-size:11.5px;color:var(--muted-foreground);margin-top:4px">Balance on ${t.name}: <span class="tnum">${fmt(balOf(to), asset==='ETH'?4:2)} ${asset}</span></div>
            </div>
            <div style="background:var(--background);border:1px solid var(--border-soft);border-radius:var(--radius);padding:13px;margin-top:14px">
              <div class="br-row"><span class="muted">Bridge route</span><span>${f.name} → ${t.name} · canonical</span></div>
              <div class="br-row"><span class="muted">Est. time</span><span class="tnum">~3–5 min</span></div>
              <div class="br-row"><span class="muted">Bridge fee</span><span class="tnum">~$0.40</span></div>
              <div class="br-row"><span class="muted">You'll receive</span><span class="tnum" style="font-weight:600">≈ ${amt||'0.00'} ${asset} on ${t.name}</span></div>
            </div>
            <button class="btn btn-primary btn-lg" style="width:100%;margin-top:16px" data-review>Review bridge</button>
            <div style="text-align:center;font-size:11px;color:var(--muted-foreground);margin-top:10px">Next: simulation + guardrail check, then you sign. Withdraw-always applies on both networks.</div>
          </div>
        </div>
        <div class="card card-pad" style="margin-top:16px">
          <div class="card-hd"><span class="t">How the bridge keeps custody yours</span></div>
          <div class="route-step"><span class="rn">1</span><div>You sign a <b>lock/burn</b> on ${f.name} — funds leave your wallet only by your signature.</div></div>
          <div class="route-step"><span class="rn">2</span><div>The canonical bridge <b>verifies</b> the message across networks.</div></div>
          <div class="route-step"><span class="rn">3</span><div>You <b>receive</b> the asset on ${t.name}, in your own wallet. SparkPoint never custodies it in transit.</div></div>
        </div>
      </div></div>`;
      host.querySelectorAll('[data-asset]').forEach(b=>b.onclick=()=>{asset=b.dataset.asset;draw();});
      const ai=host.querySelector('#bramt');
      ai.addEventListener('input',()=>{amt=ai.value;});
      ai.closest('.netbox') && ai.addEventListener('focus',()=>ai.closest('.netbox').classList.add('focus'));
      ai.addEventListener('blur',()=>ai.closest('.netbox').classList.remove('focus'));
      host.querySelector('[data-max]').onclick=()=>{amt=fmt(balOf(from),asset==='ETH'?4:2);draw();};
      const flip=()=>{const x=from;from=to;to=x;draw();};
      host.querySelector('[data-swap]').onclick=flip;
      host.querySelector('[data-flip-from]').onclick=flip;
      host.querySelector('[data-review]').onclick=()=>navigate('confirm/bridge');
    }
    draw();
  }});
})();
