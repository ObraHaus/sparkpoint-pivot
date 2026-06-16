/* ===== public.js — Landing → Connect → Verify (login) ===== */
(function(){
  const {icon,sparkmark,navigate} = SP;

  const css = `
.pubwrap{height:100vh;height:100dvh;display:flex;flex-direction:column;overflow:hidden;}
.pubtop{display:flex;align-items:center;gap:16px;padding:0 26px;height:64px;flex:none;border-bottom:1px solid var(--border-soft);}
.publink{font-size:13.5px;color:var(--muted-foreground);cursor:pointer;font-weight:500;}
.publink:hover{color:var(--foreground);}
.pubscroll{overflow-y:auto;flex:1;}
.hero{max-width:980px;margin:0 auto;padding:64px 26px 40px;text-align:center;}
.hero-badge{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--primary);
  background:var(--spark-subtle);border:1px solid color-mix(in srgb,var(--primary) 26%,transparent);border-radius:999px;padding:6px 13px;margin-bottom:22px;}
.hero-h1{font-size:54px;line-height:1.05;font-weight:600;letter-spacing:-.025em;margin:0 0 18px;
  background:linear-gradient(180deg,var(--foreground),color-mix(in srgb,var(--foreground) 62%,var(--background)));-webkit-background-clip:text;background-clip:text;color:transparent;}
.hero-sub{font-size:18px;line-height:1.55;color:var(--muted-foreground);max-width:620px;margin:0 auto 28px;}
.hero-sub b{color:var(--foreground);font-weight:600;}
.hero-cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:22px;}
.hero-proof{display:flex;gap:20px;justify-content:center;flex-wrap:wrap;font-size:13px;color:var(--muted-foreground);}
.hero-proof span{display:inline-flex;align-items:center;gap:6px;}
.hero-proof svg{color:var(--gain);}
.hero-card{max-width:460px;margin:44px auto 0;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:18px;text-align:left;box-shadow:var(--shadow-md);}
.hc-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
.hc-thesis{font-size:14.5px;line-height:1.5;margin-bottom:14px;}
.hc-row{display:flex;align-items:center;gap:14px;}
.hc-big{font-size:26px;font-weight:600;letter-spacing:-.01em;line-height:1;}
.hc-lbl{font-size:11px;color:var(--muted-foreground);margin-top:3px;}
.band{max-width:980px;margin:0 auto;padding:54px 26px;text-align:center;}
.band.alt{background:var(--card);border-top:1px solid var(--border-soft);border-bottom:1px solid var(--border-soft);max-width:none;}
.band-eyebrow{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--primary);margin-bottom:10px;}
.band-h2{font-size:32px;font-weight:600;letter-spacing:-.02em;margin:0 0 36px;}
.three{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;}
.beat{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:22px;text-align:left;}
.beat-ico{width:42px;height:42px;border-radius:11px;background:var(--spark-subtle);color:var(--primary);display:grid;place-items:center;margin-bottom:14px;}
.beat-t{font-size:16px;font-weight:600;margin-bottom:7px;}
.beat-d{font-size:13.5px;line-height:1.55;color:var(--muted-foreground);}
.fineprint{font-size:12px;color:var(--muted-foreground);text-align:center;max-width:560px;margin:28px auto 0;line-height:1.5;}
.center-stage{flex:1;display:grid;place-items:center;padding:24px;overflow-y:auto;}
.connect-card{width:420px;max-width:92vw;background:var(--card);border:1px solid var(--border);border-radius:18px;padding:30px;box-shadow:var(--shadow-md);}
.walletlist{display:flex;flex-direction:column;gap:9px;}
.walletrow{display:flex;align-items:center;gap:13px;padding:14px;border-radius:var(--radius);border:1px solid var(--border);background:var(--background);cursor:pointer;transition:.15s;color:var(--foreground);}
.walletrow:hover{border-color:var(--primary);background:var(--card-2);}
.wl-ico{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;flex:none;}
.wl-name{flex:1;text-align:left;font-size:14.5px;font-weight:600;}
.walletrow svg{color:var(--muted-foreground);}
.connect-reassure{display:flex;gap:9px;align-items:flex-start;margin-top:18px;padding:12px;border-radius:var(--radius);background:var(--spark-subtle);font-size:12.5px;line-height:1.5;color:var(--muted-foreground);}
.connect-reassure svg{color:var(--primary);flex:none;margin-top:1px;}
.verify-anim{width:64px;height:64px;border-radius:50%;background:var(--spark-subtle);display:grid;place-items:center;margin:0 auto;}
.verify-anim .ai-dot{width:14px;height:14px;}
@media(max-width:760px){.hero-h1{font-size:36px;}.three{grid-template-columns:1fr;}.band-h2{font-size:24px;}.hero{padding-top:36px;}.pubtop .publink{display:none;}}
`;
  const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

  function pubTop(){
    return `<div class="pubtop">
      <div class="brand" style="cursor:pointer" onclick="SP.navigate('landing')">${sparkmark(23)}SparkPoint</div>
      <div class="grow"></div>
      <a class="publink" onclick="SP.navigate('landing')">How it works</a>
      <a class="publink" onclick="SP.navigate('landing')">Trust</a>
      <a class="publink" onclick="SP.navigate('landing')">Security</a>
      <button class="btn btn-primary btn-md" onclick="SP.navigate('connect')">Connect wallet</button>
    </div>`;
  }
  function beat(ic,t,d){return `<div class="beat"><span class="beat-ico">${icon(ic,20)}</span><div class="beat-t">${t}</div><div class="beat-d">${d}</div></div>`;}

  SP.registerScreen('landing',{render(host){
    host.innerHTML = `
    <div class="pubwrap">
      ${pubTop()}
      <div class="pubscroll">
        <section class="hero">
          <div class="hero-badge">${icon('shieldcheck',14)} Native non-custody · provable on-chain</div>
          <h1 class="hero-h1">The first AI-native<br>onchain hedge fund.</h1>
          <p class="hero-sub">An AI fund manager that learns your goals, explains every move, and proves every result on-chain — and <b>can't hold, move, or lose your money.</b></p>
          <div class="hero-cta">
            <button class="btn btn-primary btn-lg" onclick="SP.navigate('connect')">${icon('wallet',18)} Connect wallet</button>
            <button class="btn btn-outline btn-lg" id="howbtn">See how it works</button>
          </div>
          <div class="hero-proof">
            <span>${icon('check',14)} You own your keys</span>
            <span>${icon('check',14)} Withdraw anytime — even if we're offline</span>
            <span>${icon('check',14)} You sign every move</span>
          </div>
          <div class="hero-card">
            <div class="hc-top"><span class="badge badge-ai">AI suggestion — you approve &amp; sign</span><span class="mono" style="font-size:11px;color:var(--muted-foreground)">live preview</span></div>
            <div class="hc-thesis">Move idle USDC into the <b>Aave Yield Vault</b> — same low risk, more yield.</div>
            <div class="hc-row"><div><div class="hc-big tnum">4.3%</div><div class="hc-lbl">net APY · estimate</div></div>
              ${SP.riskChip(1)}<div style="flex:1"></div>
              <button class="btn btn-primary btn-sm">Review this move</button></div>
          </div>
        </section>

        <section class="band" id="how">
          <div class="band-eyebrow">The thesis</div>
          <h2 class="band-h2">AI proposes. Guardrails check. You dispose.</h2>
          <div class="three">
            ${beat('spark','The AI proposes','It reads your wallet, learns your goals, and suggests strategies — explaining the reasoning and citing its sources.')}
            ${beat('shield','Guardrails check','Deterministic policy — caps, allowlists, slippage, simulation — checks every suggestion before you\'re ever asked to sign.')}
            ${beat('key','You dispose','You sign every state-changing move. The protocol can direct strategy but has no code path to take your funds.')}
          </div>
        </section>

        <section class="band alt">
          <div class="cancan" style="max-width:760px;margin:0 auto">
            <div class="col can"><h5>SparkPoint can</h5><ul>
              <li>${icon('check',13)}Direct strategy &amp; suggest moves</li><li>${icon('check',13)}Simulate before you sign</li>
              <li>${icon('check',13)}Pause new deposits (emergency)</li><li>${icon('check',13)}Report outcomes — wins and losses</li></ul></div>
            <div class="col cant"><h5>SparkPoint can't</h5><ul>
              <li>${icon('x',13)}Move or withhold your funds</li><li>${icon('x',13)}Withdraw to itself</li>
              <li>${icon('x',13)}Change the rules on you</li><li>${icon('x',13)}Stop you withdrawing — ever</li></ul></div>
          </div>
          <p class="fineprint">Mockup for design review. Single Aave Yield Vault · Base only · beta-gated. Not financial advice; capital at risk.</p>
          <div style="text-align:center;margin-top:22px"><button class="btn btn-primary btn-lg" onclick="SP.navigate('connect')">Connect wallet to start</button></div>
        </section>
      </div>
    </div>`;
    host.querySelector('#howbtn').onclick=()=>host.querySelector('#how').scrollIntoView({behavior:'smooth'});
  }});

  SP.registerScreen('connect',{render(host){
    const wallets=[['Coinbase Wallet','#0052FF','M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 13.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z'],
      ['WalletConnect','#3B99FC','M7 9.5c2.8-2.7 7.2-2.7 10 0l.4.4-1.4 1.3-.4-.3a5.3 5.3 0 0 0-7.2 0l-.4.4L6.6 9.9 7 9.5Z'],
      ['MetaMask','#E2761B','M3 4l7 5-2-5H3Zm18 0h-5l-2 5 7-5Z'],
      ['Browser wallet','#8A97A8','M3 7h18v10H3z']];
    host.innerHTML=`<div class="pubwrap">${pubTop()}<div class="center-stage">
      <div class="connect-card">
        <div style="text-align:center;margin-bottom:6px">${sparkmark(34)}</div>
        <h2 style="text-align:center;font-size:22px;font-weight:600;margin:0 0 6px">Connect your wallet</h2>
        <p style="text-align:center;font-size:13.5px;color:var(--muted-foreground);margin:0 0 20px;line-height:1.5">You stay in control. We read your wallet to personalize — <b style="color:var(--foreground)">nothing moves without your signature.</b></p>
        <div class="walletlist">
          ${wallets.map((w,i)=>`<button class="walletrow" data-i="${i}">
            <span class="wl-ico" style="background:${w[1]}1f;color:${w[1]}"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="${w[2]}"/></svg></span>
            <span class="wl-name">${w[0]}</span>${icon('chevr',16)}</button>`).join('')}
        </div>
        <div class="connect-reassure">${icon('shieldcheck',16)}<span>You own your keys and your account. We never generate a wallet for you or hold your keys.</span></div>
        <div style="text-align:center;margin-top:14px"><span class="pill ghosty" style="cursor:default"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#0052FF"/></svg>Base network</span></div>
      </div></div></div>`;
    host.querySelectorAll('.walletrow').forEach(b=>b.onclick=()=>{
      b.innerHTML=`<span class="wl-ico"><span class="ai-dot"></span></span><span class="wl-name">Connecting…</span>`;
      setTimeout(()=>navigate('verify'),900);
    });
  }});

  SP.registerScreen('verify',{render(host){
    host.innerHTML=`<div class="pubwrap">${pubTop()}<div class="center-stage">
      <div class="connect-card" style="text-align:center">
        <div class="verify-anim" id="vanim"><span class="ai-dot"></span></div>
        <h2 id="vtitle" style="font-size:20px;font-weight:600;margin:18px 0 6px">Checking your access…</h2>
        <p id="vsub" style="font-size:13.5px;color:var(--muted-foreground);margin:0;line-height:1.5">SparkPoint is in beta — confirming your wallet is whitelisted on Base.</p>
        <div id="vsteps" style="margin:20px 0 4px;text-align:left;max-width:280px;margin-inline:auto"></div>
        <div id="vcta"></div>
      </div></div></div>`;
    const steps=[['Wallet connected','0x12A4…b9Ef'],['On Base network','confirmed'],['Whitelist (beta)','passed']];
    const box=host.querySelector('#vsteps'); let i=0;
    (function go(){
      if(i>=steps.length){
        host.querySelector('#vanim').innerHTML=`<span style="color:var(--gain)">${icon('check',30,2.5)}</span>`;
        host.querySelector('#vtitle').textContent='You\'re in.';
        host.querySelector('#vsub').textContent='Let\'s build your plan — it takes about 3 minutes.';
        host.querySelector('#vcta').innerHTML=`<a class="btn btn-primary btn-lg" href="flows/Onboarding.html" style="margin-top:18px;display:inline-flex">Start onboarding</a>
          <div style="margin-top:10px"><a class="btn btn-ghost btn-sm" onclick="SP.navigate('chat')">Skip to app (demo)</a></div>`;
        return;
      }
      const row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:10px;padding:6px 0;font-size:13px;color:var(--muted-foreground)';
      row.innerHTML=`<span class="ai-dot"></span><span style="flex:1">${steps[i][0]}</span>`;
      box.appendChild(row);
      setTimeout(()=>{row.querySelector('.ai-dot').outerHTML=`<span style="color:var(--gain)">${icon('check',15,2.5)}</span>`;
        row.querySelector('span:last-child').innerHTML=`${steps[i][0]} · <span class="mono" style="color:var(--foreground)">${steps[i][1]}</span>`;i++;setTimeout(go,460);},620);
    })();
  }});
})();
