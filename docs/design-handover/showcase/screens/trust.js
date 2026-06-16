/* ===== trust.js — Trust Center, prove-it permissions, withdraw-always exit, automation ===== */
(function(){
  const {icon,data,money,navigate,reduce}=SP;
  const css=`
.guarantee{display:flex;gap:13px;padding:16px 0;border-bottom:1px solid var(--border-soft);}
.guarantee:last-child{border-bottom:none;}
.guarantee .gico{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;flex:none;background:var(--gain-subtle);color:var(--gain);}
.statusrow{display:flex;align-items:center;justify-content:space-between;padding:13px 0;border-bottom:1px solid var(--border-soft);}
.statusrow:last-child{border-bottom:none;}
.permtable td{font-family:var(--font-mono);font-size:12px;}
.exit-step{display:flex;gap:13px;padding:14px 0;border-bottom:1px solid var(--border-soft);}
.exit-step .num{width:26px;height:26px;border-radius:50%;background:var(--muted);display:grid;place-items:center;font-size:12px;font-weight:600;flex:none;}
.trust-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
@media(max-width:1023px){.trust-grid{grid-template-columns:1fr;}}
`;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

  const GUARANTEES=[
    ['shieldcheck','No admin withdrawal','We have no code path to send your funds anywhere but back to you — not us, not anyone.'],
    ['door','Withdraw-always','Exit directly on-chain, even if SparkPoint\'s app and AI are completely offline.'],
    ['key','You own your keys','You own your keys and your account. We never generate a wallet for you or hold your keys.'],
    ['zap','Scoped, revocable automation','Any automation you grant is scoped, capped, time-limited, and revocable by you instantly — without our help.'],
    ['pause','Non-upgradeable, pause-only','The vault is single-purpose and non-upgradeable. Any pause control governs pausing only — never your funds.']
  ];

  SP.registerScreen('trust',{render(host){
    host.innerHTML=`<div class="page page-wide">
      <div class="pagehead"><div><h1>Trust Center</h1><div class="sub">Your keys. Your funds. Always. — proven, not promised.</div></div>
        <button class="btn btn-primary btn-md" onclick="SP.navigate('trust/permissions')">${icon('shieldcheck',16)} Prove it</button></div>
      <div class="trust-grid" style="margin-bottom:18px">
        <div class="card card-pad">
          <div class="card-hd"><span class="t">Five structural guarantees</span></div>
          ${GUARANTEES.map(g=>`<div class="guarantee"><span class="gico">${icon(g[0],18)}</span><div><div style="font-size:14px;font-weight:600">${g[1]}</div><div style="font-size:12.5px;color:var(--muted-foreground);line-height:1.5;margin-top:3px">${g[2]}</div></div></div>`).join('')}
        </div>
        <div style="display:flex;flex-direction:column;gap:18px">
          <div class="card card-pad">
            <div class="card-hd"><span class="t">Status</span></div>
            <div class="statusrow"><span class="muted">Custody invariants</span><span style="color:var(--gain);font-weight:600;display:inline-flex;align-items:center;gap:5px">${icon('check',14)} All nominal</span></div>
            <div class="statusrow"><span class="muted">Kill-switch</span><span style="display:inline-flex;align-items:center;gap:6px;font-weight:600">${icon('pause',14)} Pause-only · inactive</span></div>
            <div class="statusrow"><span class="muted">Whitelist (beta)</span><span style="color:var(--gain);font-weight:600">Passed</span></div>
            <div class="statusrow"><span class="muted">Network</span><span style="font-weight:600">Base</span></div>
            <div style="font-size:12px;color:var(--muted-foreground);margin-top:12px;line-height:1.5">${icon('info',13)} The kill-switch can pause <b>new</b> deposits in an emergency. It can never block your withdrawals.</div>
          </div>
          <div class="card card-pad">
            <div class="card-hd"><span class="t">Your beta caps</span></div>
            <div class="statusrow"><span class="muted">Per-user cap</span><span class="tnum">${money(data.vault.capUsed,0)} / ${money(data.vault.capUser,0)}</span></div>
            <div class="statusrow"><span class="muted">Vault TVL cap</span><span class="tnum">$${data.vault.tvl}M / $${data.vault.tvlCap}M</span></div>
          </div>
          <div class="card card-pad">
            <div class="card-hd"><span class="t">Audits &amp; addresses</span></div>
            <div class="statusrow"><span class="muted">Vault contract</span><span class="mono" style="font-size:12px">0x9f…2C1 ${icon('ext',11)}</span></div>
            <div class="statusrow"><span class="muted">Policy module</span><span class="mono" style="font-size:12px">0x3a…77B ${icon('ext',11)}</span></div>
            <div class="statusrow"><span class="muted">Audit</span><span style="font-weight:600;display:inline-flex;gap:5px;align-items:center">${icon('shieldcheck',13)} Spearbit ↗</span></div>
          </div>
        </div>
      </div>
      <div class="card card-pad" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <div style="flex:1;min-width:240px"><div style="font-weight:600;margin-bottom:4px">Exit anytime</div><div style="font-size:12.5px;color:var(--muted-foreground)">The self-service exit works even if SparkPoint is entirely offline.</div></div>
        <button class="btn btn-outline btn-md" onclick="SP.navigate('trust/exit')">${icon('door',16)} Withdraw / Exit</button>
        <button class="btn btn-outline btn-md" onclick="SP.navigate('automation')">${icon('zap',16)} Automation</button>
      </div>
    </div>`;
  }});

  SP.registerScreen('trust/permissions',{render(host){
    host.innerHTML=`<div class="page page-narrow">
      <a class="qlink" style="display:inline-flex;margin-bottom:14px" onclick="SP.navigate('trust')">${icon('chevr',15)} Back to Trust Center</a>
      <div class="pagehead"><div><h1>What SparkPoint can &amp; can't do</h1><div class="sub">Read live from the contracts via Base RPC — works even if our backend is down.</div></div></div>
      <div class="cancan" style="margin-bottom:18px">
        <div class="col can"><h5>Can</h5><ul><li>${icon('check',13)}Direct strategy</li><li>${icon('check',13)}Suggest moves</li><li>${icon('check',13)}Simulate</li><li>${icon('check',13)}Pause new deposits</li></ul></div>
        <div class="col cant"><h5>Can't</h5><ul><li>${icon('x',13)}Move your funds</li><li>${icon('x',13)}Withdraw to itself</li><li>${icon('x',13)}Change the rules</li><li>${icon('x',13)}Stop you withdrawing</li></ul></div>
      </div>
      <div class="card card-pad">
        <div class="card-hd"><span class="t">Granted on-chain permissions</span><span class="lbl">live</span></div>
        <table class="tbl permtable"><thead><tr><th>Scope</th><th>Grantee</th><th class="num">Limit</th></tr></thead><tbody>
          <tr><td>vault.rebalance()</td><td>0x3a…77B (policy)</td><td class="num">allowlist only</td></tr>
          <tr><td>maxSlippage</td><td>policy module</td><td class="num">0.50%</td></tr>
          <tr><td>perTxCap</td><td>policy module</td><td class="num">$25,000</td></tr>
          <tr><td>admin.withdraw()</td><td style="color:var(--loss)">— none —</td><td class="num" style="color:var(--loss)">no code path</td></tr>
          <tr><td>user.withdraw()</td><td style="color:var(--gain)">you only</td><td class="num" style="color:var(--gain)">unlimited</td></tr>
        </tbody></table>
        <div style="font-size:12px;color:var(--muted-foreground);margin-top:14px;line-height:1.5">The <span class="mono">admin.withdraw()</span> row is the trust payload: there is no function by which SparkPoint can move your funds.</div>
      </div>
      <div style="display:flex;gap:10px;margin-top:18px"><button class="btn btn-outline btn-md" onclick="SP.toast('Opens Basescan ↗')">${icon('ext',16)} Verify on Basescan</button><button class="btn btn-primary btn-md" onclick="SP.navigate('trust/exit')">Withdraw now</button></div>
    </div>`;
  }});

  SP.registerScreen('trust/exit',{render(host){
    host.innerHTML=`<div class="page page-narrow">
      <a class="qlink" style="display:inline-flex;margin-bottom:14px" onclick="SP.navigate('trust')">${icon('chevr',15)} Back to Trust Center</a>
      <div class="pagehead"><div><h1>Withdraw / Exit</h1><div class="sub">Withdraw anytime — even if SparkPoint is offline.</div></div></div>
      <div class="card card-pad" style="margin-bottom:16px">
        <div class="card-hd"><span class="t">Normal withdrawal</span><span class="pill ghosty" style="cursor:default">${icon('check',13)} Recommended</span></div>
        <div style="font-size:13.5px;color:var(--muted-foreground);line-height:1.55;margin-bottom:14px">Withdraw through the app — simulated, guardrail-checked, and signed by you. Funds land back in your wallet.</div>
        <div style="display:flex;gap:10px"><button class="btn btn-primary btn-md" onclick="SP.navigate('vault/withdraw')">Withdraw USDC</button><button class="btn btn-outline btn-md" onclick="SP.navigate('vault/withdraw')">Withdraw everything</button></div>
      </div>
      <div class="card card-pad">
        <div class="card-hd"><span class="t">On-chain self-service exit</span><span class="pill ghosty" style="cursor:default">${icon('lock',13)} Backend-independent</span></div>
        <div style="font-size:13.5px;color:var(--muted-foreground);line-height:1.55;margin-bottom:6px">If our app and AI are entirely offline, you can still redeem directly from the vault contract using any tool (e.g. Etherscan's write tab).</div>
        <div class="exit-step"><span class="num">1</span><div><div style="font-size:13.5px;font-weight:600">Open the vault on Basescan</div><div class="mono" style="font-size:12px;color:var(--muted-foreground);margin-top:3px">0x9f…2C1 ${icon('ext',11)}</div></div></div>
        <div class="exit-step"><span class="num">2</span><div><div style="font-size:13.5px;font-weight:600">Call <span class="mono">redeem(shares, you, you)</span></div><div style="font-size:12.5px;color:var(--muted-foreground);margin-top:3px">Burns your spvUSDC, sends USDC to your address.</div></div></div>
        <div class="exit-step" style="border-bottom:none"><span class="num">3</span><div><div style="font-size:13.5px;font-weight:600">Sign with your wallet</div><div style="font-size:12.5px;color:var(--muted-foreground);margin-top:3px">No SparkPoint involvement required.</div></div></div>
      </div>
    </div>`;
  }});

  SP.registerScreen('automation',{render(host){
    const sk=data.sessionKey;
    host.innerHTML=`<div class="page page-narrow">
      <div class="pagehead"><div><h1>Automation</h1><div class="sub">Opt-in, scoped, time-boxed — and revocable by you instantly.</div></div></div>
      ${sk?'':`<div class="card card-pad" style="text-align:center;padding:36px 24px;margin-bottom:16px">
        <div class="empty" style="padding:0"><span class="ei">${icon('zap',24)}</span>
        <div class="et">No active automation</div>
        <div class="eb">By default you sign every move. You can grant a scoped, capped, time-limited session key for hands-off rebalancing — and revoke it instantly, without our help.</div>
        <button class="btn btn-primary btn-md" onclick="SP.navigate('automation/grant')">Grant scoped access</button></div></div>`}
      <div class="card card-pad">
        <div class="card-hd"><span class="t">How session keys stay safe</span></div>
        ${[['Allowlist','Can only touch the audited Aave vault — nothing else.'],['Per-tx + cumulative caps','Bounded spend per action and in total.'],['Max slippage','Trades stop if prices move against you.'],['Hard expiry','Auto-expires; you set the window.'],['Instant revoke','Cancel unilaterally on-chain — no SparkPoint cooperation needed.']].map(r=>`<div class="statusrow"><span style="font-weight:600">${r[0]}</span><span class="muted" style="font-size:12.5px;max-width:300px;text-align:right">${r[1]}</span></div>`).join('')}
      </div>
    </div>`;
  }});

  SP.registerScreen('automation/grant',{render(host){
    host.innerHTML=`<div class="page page-narrow">
      <a class="qlink" style="display:inline-flex;margin-bottom:14px" onclick="SP.navigate('automation')">${icon('chevr',15)} Back</a>
      <div class="pagehead"><div><h1>Grant scoped access</h1><div class="sub">You decide the scope, caps, and expiry. Revoke anytime.</div></div></div>
      <div class="card card-pad">
        <div class="field" style="margin-bottom:18px"><label>What it can do</label>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius)"><span style="font-size:13.5px">Auto-rebalance within the Aave vault only</span><button class="switch on" data-sw></button></div></div>
        <div class="field" style="margin-bottom:18px"><label>Cumulative cap</label><input class="input" value="$5,000" /><div class="hint">Total the session key can move before it stops.</div></div>
        <div class="field" style="margin-bottom:18px"><label>Max slippage</label><input class="input" value="0.5%" /></div>
        <div class="field" style="margin-bottom:18px"><label>Expires</label>
          <div class="seg" style="width:100%">${['7 days','30 days','90 days'].map((d,i)=>`<button class="${i===0?'active':''}" style="flex:1">${d}</button>`).join('')}</div></div>
        <div style="background:var(--info-subtle);border:1px solid color-mix(in srgb,var(--info) 22%,transparent);border-radius:var(--radius);padding:13px;font-size:12.5px;color:var(--muted-foreground);line-height:1.5;margin-bottom:16px">${icon('info',14)} Granting a session key is itself a transaction you sign. In-scope actions then execute under these on-chain limits; each still appears in your outcome log.</div>
        <button class="btn btn-primary btn-lg" style="width:100%" onclick="SP.navigate('confirm/deposit')">Review &amp; sign grant</button>
      </div>
    </div>`;
    host.querySelectorAll('[data-sw]').forEach(s=>s.onclick=()=>s.classList.toggle('on'));
    host.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>{b.parentElement.querySelectorAll('button').forEach(x=>x.classList.remove('active'));b.classList.add('active');});
  }});
})();
