"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Spark Core Landing — faithful React port of
 * docs/design-handover/showcase/Spark Core Landing.html
 *
 * The page is dark-only and self-contained. The entire canvas particle engine
 * from the source <script> is ported into a single mount-once useEffect. The
 * GSAP intro tween is replaced with a CSS/opacity fade of #iword.
 */

const SECTIONS = 6;
const LABELS = ["Welcome", "Proposes", "Guardrails", "Sign", "Vault", "Proof"];

interface Particle {
  x: number;
  y: number;
  seed: number;
  ang: number;
  discR: number;
  ring: number;
  gx: number;
  gy: number;
  starT: number;
  col: string;
  size: number;
  px: number;
  py: number;
}

interface Dust {
  x: number;
  y: number;
  r: number;
  v: number;
  a: number;
}

type Flavor = "ember" | "plasma" | "constellation";

export default function SparkCoreLanding() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const introRef = useRef<HTMLDivElement | null>(null);
  const iwordRef = useRef<HTMLDivElement | null>(null);
  const dotsRef = useRef<HTMLDivElement | null>(null);
  const flavorRef = useRef<Flavor>("ember");

  function goConnect() {
    router.push("/connect");
  }

  /** Smooth-scroll to the next section after the given one. */
  function scrollToNextSection(currentSec: number) {
    const total = document.body.scrollHeight - window.innerHeight;
    const next = Math.min(SECTIONS - 1, currentSec + 1);
    window.scrollTo({ top: total * (next / (SECTIONS - 1)), behavior: "smooth" });
  }

  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cv = canvasRef.current;
    if (!cv) return;
    const c = cv.getContext("2d");
    if (!c) return;

    let W = 0;
    let H = 0;
    const DPR = Math.min(devicePixelRatio || 1, 2);
    function resize() {
      W = innerWidth;
      H = innerHeight;
      cv!.width = W * DPR;
      cv!.height = H * DPR;
      c!.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    resize();
    addEventListener("resize", resize);

    // ---- palette ----
    const COLS = ["#4D83FF", "#5EA0FF", "#38C6F4", "#7FD8F7", "#F5B62E", "#F2683C"];
    function colFor(i: number): string {
      // mostly blue/cyan, sparse gold/coral
      const r = (i * 47) % 100;
      if (r < 34) return COLS[0];
      if (r < 55) return COLS[1];
      if (r < 76) return COLS[2];
      if (r < 88) return COLS[3];
      if (r < 95) return COLS[4];
      return COLS[5];
    }

    // ---- particles ----
    const N = innerWidth < 860 ? 170 : 320;
    const P: Particle[] = [];
    // star (4-point spark) outline verts
    const starV: number[][] = [];
    for (let k = 0; k < 8; k++) {
      const ang = -Math.PI / 2 + (k * Math.PI) / 4;
      const rad = k % 2 === 0 ? 1 : 0.34;
      starV.push([Math.cos(ang) * rad, Math.sin(ang) * rad]);
    }
    function starPoint(t2: number, seed: number): number[] {
      const f = t2 * 8;
      const seg = Math.floor(f) % 8;
      const lf = f - Math.floor(f);
      const a = starV[seg];
      const b = starV[(seg + 1) % 8];
      const x = a[0] + (b[0] - a[0]) * lf;
      const y = a[1] + (b[1] - a[1]) * lf;
      const k = 0.5 + seed * 0.5;
      return [x * k, y * k];
    }
    const cols = Math.ceil(Math.sqrt(N));
    for (let i = 0; i < N; i++) {
      P.push({
        x: (Math.random() - 0.5) * W,
        y: (Math.random() - 0.5) * H,
        seed: Math.random(),
        ang: Math.random() * Math.PI * 2,
        discR: Math.sqrt(Math.random()),
        ring: i % 4,
        gx: (i % cols) / (cols - 1) - 0.5,
        gy: Math.floor(i / cols) / (cols - 1) - 0.5,
        starT: i / N,
        col: colFor(i),
        size: 0.6 + Math.random() * 1.6,
        px: 0,
        py: 0,
      });
    }

    // ---- minimalist animated background ----
    const bgDust: Dust[] = Array.from({ length: 54 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.2 + 0.3,
      v: Math.random() * 0.00018 + 0.00004,
      a: Math.random() * 0.22 + 0.06,
    }));
    const BLOOMS: [number, number, string][] = [
      [0.15, 0.2, "#22407a"],
      [0.85, 0.32, "#1a4a5e"],
      [0.72, 0.84, "#34305e"],
    ];
    function drawBackground() {
      // faint drifting corner blooms
      for (let i = 0; i < BLOOMS.length; i++) {
        const b = BLOOMS[i];
        const bx = W * (b[0] + Math.sin(t * 0.2 + i * 1.7) * 0.022);
        const by = H * (b[1] + Math.cos(t * 0.16 + i * 1.3) * 0.03);
        const g = c!.createRadialGradient(bx, by, 0, bx, by, Math.max(W, H) * 0.42);
        g.addColorStop(0, b[2]);
        g.addColorStop(1, "rgba(0,0,0,0)");
        c!.globalAlpha = 0.09;
        c!.fillStyle = g;
        c!.fillRect(0, 0, W, H);
      }
      c!.globalAlpha = 1;
      // drifting dot grid
      const gap = 50;
      const ox = ((t * 7) % gap) - mx * 16;
      const oy = ((t * 4) % gap) - my * 16;
      c!.fillStyle = "rgba(120,150,200,0.05)";
      for (let x = -gap; x < W + gap; x += gap) {
        for (let y = -gap; y < H + gap; y += gap) {
          c!.beginPath();
          c!.arc(x + ox, y + oy, 1, 0, 7);
          c!.fill();
        }
      }
      // slow floating dust
      for (const d of bgDust) {
        if (!reduce) {
          d.y -= d.v;
          if (d.y < -0.02) d.y = 1.02;
        }
        c!.globalAlpha = d.a;
        c!.fillStyle = "#9fc0e8";
        c!.beginPath();
        c!.arc(d.x * W - mx * 8, d.y * H, d.r, 0, 7);
        c!.fill();
      }
      c!.globalAlpha = 1;
    }

    // ---- chapter target (normalized -1..1, *S added later) ----
    function target(p: Particle, ch: number, rot: number): number[] {
      switch (ch) {
        case 0: {
          const r = p.discR * 0.42;
          const a = p.ang + rot;
          return [Math.cos(a) * r, Math.sin(a) * r];
        } // nucleus
        case 1: {
          const r = 0.5 + p.seed * 1.0;
          const a = p.ang + rot * 0.4;
          return [Math.cos(a) * r * 1.3, Math.sin(a) * r * 0.85];
        } // cloud / proposes
        case 2: {
          const rr = (p.ring + 1) / 4;
          const a = p.ang + rot * 0.3;
          return [Math.cos(a) * rr, Math.sin(a) * rr];
        } // rings / guardrails
        case 3: {
          return starPoint(p.starT, p.seed);
        } // spark star / sign
        case 4: {
          return [p.gx * 1.4, p.gy * 1.0];
        } // grid / vault
        case 5: {
          const r = 0.34 * p.discR + 0.06;
          const a = p.ang + rot;
          return [Math.cos(a) * r, Math.sin(a) * r];
        } // reform nucleus
        default:
          return [0, 0];
      }
    }
    const ENERGY = [1, 0.45, 0.6, 0.85, 0.4, 1];

    // ---- scroll progress ----
    let prog = 0; // 0..SECTIONS-1
    function onScroll() {
      const total = document.body.scrollHeight - innerHeight;
      const f = total > 0 ? Math.min(1, Math.max(0, scrollY / total)) : 0;
      prog = f * (SECTIONS - 1);
      // dots
      const cur = Math.round(prog);
      document.querySelectorAll("#dots button").forEach((d, i) => d.classList.toggle("on", i === cur));
    }
    addEventListener("scroll", onScroll, { passive: true });

    let mx = 0;
    let my = 0;
    function onMouseMove(e: MouseEvent) {
      mx = e.clientX / W - 0.5;
      my = e.clientY / H - 0.5;
    }
    addEventListener("mousemove", onMouseMove);

    // ---- render ----
    let t = 0;
    let raf = 0;
    function frame() {
      t += reduce ? 0 : 0.006;
      const S = Math.min(W, H) * 0.36;
      const cx = W / 2 + mx * 40;
      const cy = H / 2 + my * 30;
      const ch0 = Math.floor(prog);
      const ch1 = Math.min(SECTIONS - 1, ch0 + 1);
      const bf = prog - ch0;
      const rot = t * 0.6;
      const energy = ENERGY[ch0] + (ENERGY[ch1] - ENERGY[ch0]) * bf;
      const flavor = flavorRef.current || "ember";

      c!.clearRect(0, 0, W, H);

      drawBackground();

      // center glow
      const gr = c!.createRadialGradient(cx, cy, 0, cx, cy, S * 2.0);
      gr.addColorStop(0, `rgba(80,150,255,${0.16 * energy})`);
      gr.addColorStop(0.3, `rgba(56,198,244,${0.1 * energy})`);
      gr.addColorStop(0.6, `rgba(245,182,46,${0.04 * energy})`);
      gr.addColorStop(1, "rgba(4,7,14,0)");
      c!.fillStyle = gr;
      c!.fillRect(0, 0, W, H);

      // bright nucleus core (strong in chapters 0/5)
      if (energy > 0.7) {
        const ng = c!.createRadialGradient(cx, cy, 0, cx, cy, S * 0.3 * energy);
        ng.addColorStop(0, `rgba(225,240,255,${(energy - 0.6) * 1.4})`);
        ng.addColorStop(0.5, `rgba(125,180,255,${energy - 0.6})`);
        ng.addColorStop(1, "rgba(77,131,255,0)");
        c!.fillStyle = ng;
        c!.beginPath();
        c!.arc(cx, cy, S * 0.3 * energy, 0, 7);
        c!.fill();
      }

      // compute positions
      for (const p of P) {
        const a = target(p, ch0, rot);
        const b = target(p, ch1, rot);
        const tx = cx + (a[0] + (b[0] - a[0]) * bf) * S;
        const ty = cy + (a[1] + (b[1] - a[1]) * bf) * S;
        const k = reduce ? 1 : 0.09;
        p.x += (tx - p.x) * k;
        p.y += (ty - p.y) * k;
      }

      if (flavor === "ember") {
        c!.globalCompositeOperation = "lighter";
        for (const p of P) {
          const s = p.size * 1.5;
          const g = c!.createRadialGradient(p.x, p.y, 0, p.x, p.y, s * 4);
          g.addColorStop(0, p.col);
          g.addColorStop(1, "rgba(0,0,0,0)");
          c!.globalAlpha = 0.55;
          c!.fillStyle = g;
          c!.beginPath();
          c!.arc(p.x, p.y, s * 4, 0, 7);
          c!.fill();
          c!.globalAlpha = 0.9;
          c!.fillStyle = p.col;
          c!.beginPath();
          c!.arc(p.x, p.y, s * 0.7, 0, 7);
          c!.fill();
        }
        c!.globalCompositeOperation = "source-over";
        c!.globalAlpha = 1;
      } else if (flavor === "plasma") {
        c!.globalCompositeOperation = "lighter";
        for (const p of P) {
          const s = p.size * 9;
          const g = c!.createRadialGradient(p.x, p.y, 0, p.x, p.y, s);
          g.addColorStop(0, p.col);
          g.addColorStop(0.5, "rgba(60,120,255,0.06)");
          g.addColorStop(1, "rgba(0,0,0,0)");
          c!.globalAlpha = 0.32;
          c!.fillStyle = g;
          c!.beginPath();
          c!.arc(p.x, p.y, s, 0, 7);
          c!.fill();
        }
        c!.globalCompositeOperation = "source-over";
        c!.globalAlpha = 1;
      } else {
        // constellation
        // links to next particle if near
        c!.lineWidth = 1;
        for (let i = 0; i < N; i++) {
          const p = P[i];
          const q = P[(i + 1) % N];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const d = Math.hypot(dx, dy);
          if (d < S * 0.5) {
            c!.globalAlpha = (1 - d / (S * 0.5)) * 0.35;
            c!.strokeStyle = p.col;
            c!.beginPath();
            c!.moveTo(p.x, p.y);
            c!.lineTo(q.x, q.y);
            c!.stroke();
          }
          const q2 = P[(i + 7) % N];
          const d2 = Math.hypot(p.x - q2.x, p.y - q2.y);
          if (d2 < S * 0.32) {
            c!.globalAlpha = (1 - d2 / (S * 0.32)) * 0.25;
            c!.strokeStyle = p.col;
            c!.beginPath();
            c!.moveTo(p.x, p.y);
            c!.lineTo(q2.x, q2.y);
            c!.stroke();
          }
        }
        c!.globalAlpha = 1;
        for (const p of P) {
          c!.fillStyle = p.col;
          c!.beginPath();
          c!.arc(p.x, p.y, p.size * 1.2, 0, 7);
          c!.fill();
        }
      }

      raf = requestAnimationFrame(frame);
    }

    // ---- dots nav ----
    const dotsEl = dotsRef.current;
    const dotClickHandlers: Array<() => void> = [];
    if (dotsEl) {
      for (let i = 0; i < SECTIONS; i++) {
        const b = document.createElement("button");
        b.title = LABELS[i];
        if (i === 0) b.classList.add("on");
        const handler = () => {
          const total = document.body.scrollHeight - innerHeight;
          scrollTo({ top: total * (i / (SECTIONS - 1)), behavior: "smooth" });
        };
        b.onclick = handler;
        dotClickHandlers.push(handler);
        dotsEl.appendChild(b);
      }
    }

    // ---- section reveals ----
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add("in");
        }),
      { threshold: 0.35 },
    );
    document.querySelectorAll(".sec").forEach((s) => io.observe(s));

    // ---- intro then start ----
    let introGone = false;
    function hideIntro() {
      if (introGone) return;
      introGone = true;
      introRef.current?.classList.add("hide");
      document.querySelector('.sec[data-sec="0"]')?.classList.add("in");
    }
    function start() {
      onScroll();
      frame();
    }

    // dismissal listeners are registered conditionally below
    const dismissEvents: Array<keyof WindowEventMap> = [
      "wheel",
      "scroll",
      "click",
      "keydown",
      "touchstart",
      "pointerdown",
    ];

    if (reduce) {
      hideIntro();
      document.querySelectorAll(".sec").forEach((s) => s.classList.add("in"));
      start();
    } else {
      start();
      // REPLACE the GSAP intro tween with a simple CSS/opacity fade of #iword.
      if (iwordRef.current) {
        const iw = iwordRef.current;
        iw.style.opacity = "0";
        iw.style.transform = "scale(.92)";
        iw.style.filter = "blur(8px)";
        iw.style.transition = "opacity 1s ease, transform 1s ease, filter 1s ease";
        // next frame so the transition runs
        requestAnimationFrame(() => {
          iw.style.opacity = "1";
          iw.style.transform = "scale(1)";
          iw.style.filter = "blur(0px)";
        });
      }
      const introTimer = setTimeout(hideIntro, 1500);
      // robust dismissal — never let the splash trap the user if timers are throttled
      dismissEvents.forEach((ev) => addEventListener(ev, hideIntro, { once: true, passive: true }));

      // cleanup for the non-reduce branch
      return () => {
        clearTimeout(introTimer);
        cancelAnimationFrame(raf);
        removeEventListener("resize", resize);
        removeEventListener("scroll", onScroll);
        removeEventListener("mousemove", onMouseMove);
        dismissEvents.forEach((ev) => removeEventListener(ev, hideIntro));
        io.disconnect();
        if (dotsEl) dotsEl.innerHTML = "";
      };
    }

    // cleanup for the reduce branch
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
      removeEventListener("scroll", onScroll);
      removeEventListener("mousemove", onMouseMove);
      io.disconnect();
      if (dotsEl) dotsEl.innerHTML = "";
    };
    // run once on mount
  }, []);

  /** Flavor switch — keep current flavor in a ref (NOT window) + toggle .on. */
  function setFlavor(fl: Flavor, e: React.MouseEvent<HTMLButtonElement>) {
    flavorRef.current = fl;
    const btn = e.currentTarget;
    const group = btn.parentElement;
    if (group) {
      group.querySelectorAll(".fl").forEach((x) => x.classList.toggle("on", x === btn));
    }
  }

  return (
    <div className="spark-core-root">
      <canvas id="core" ref={canvasRef}></canvas>
      <div className="vignette"></div>

      {/* intro */}
      <div id="intro" ref={introRef}>
        <div className="iword" id="iword" ref={iwordRef}>
          SparkPoint
        </div>
      </div>

      {/* chrome */}
      <nav className="nav">
        <span className="brand">
          <svg className="smk" viewBox="0 0 24 24">
            <defs>
              <linearGradient id="nv" x1="3" y1="2" x2="21" y2="22" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#F2683C" />
                <stop offset=".5" stopColor="#F5B62E" />
                <stop offset="1" stopColor="#4D83FF" />
              </linearGradient>
            </defs>
            <path
              d="M12 1c.6 5.4 2.6 7.4 8 8-5.4.6-7.4 2.6-8 8-.6-5.4-2.6-7.4-8-8 5.4-.6 7.4-2.6 8-8Z"
              fill="url(#nv)"
            />
          </svg>
          SparkPoint
        </span>
        <span className="grow"></span>
        <span className="nav-badge" title="Fully self-custodial">
          <span className="led"></span>Fully self-custodial
        </span>
        <button className="navbtn" onClick={goConnect}>
          <span className="full">Connect wallet</span>
          <span className="ico">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12" />
              <circle cx="17" cy="13" r="1.3" />
            </svg>
          </span>
        </button>
      </nav>

      <div className="flavors" id="flavors">
        <button className="fl on" data-fl="ember" onClick={(e) => setFlavor("ember", e)}>
          Ember
        </button>
        <button className="fl" data-fl="plasma" onClick={(e) => setFlavor("plasma", e)}>
          Plasma
        </button>
        <button className="fl" data-fl="constellation" onClick={(e) => setFlavor("constellation", e)}>
          Constellation
        </button>
      </div>
      <div className="flhint">Core flavor — three takes on the same living centerpiece. Pick one.</div>

      <div className="dots" id="dots" ref={dotsRef}></div>

      <main id="main">
        {/* 0 HERO */}
        <section className="sec center" data-sec="0">
          <div className="secinner">
            <div className="panel">
              <div className="kicker">Fully self-custodial · AI-native onchain hedge fund</div>
              <h1 className="htitle">
                Meet the spark
                <br />
                that watches your capital.
              </h1>
              <p className="hbody">
                Sparky reads your goals, suggests every move, and proves every result on-chain — and{" "}
                <b>can&rsquo;t hold, move, or lose your money.</b>
              </p>
              <div className="hctas">
                <button className="btn btn-primary" onClick={goConnect}>
                  Connect wallet
                </button>
                <button className="btn btn-outline" onClick={() => scrollToNextSection(0)}>
                  See how it works
                </button>
              </div>
            </div>
          </div>
          <div className="scrollhint">
            <div className="mouse"></div>Scroll
          </div>
        </section>

        {/* 1 PROPOSES */}
        <section className="sec left" data-sec="1">
          <div className="secinner">
            <div className="panel">
              <span className="aibadge">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 1c.6 5.4 2.6 7.4 8 8-5.4.6-7.4 2.6-8 8-.6-5.4-2.6-7.4-8-8 5.4-.6 7.4-2.6 8-8Z" />
                </svg>
                AI suggestion — you approve &amp; sign
              </span>
              <div className="kicker">01 — Sparky proposes</div>
              <h2 className="htitle">An AI that reads the whole market for you.</h2>
              <p className="hbody">
                It watches Aave rates, your wallet, and your plan — then suggests the next move in plain language, with
                its reasoning and its sources. <b>Always a suggestion, never an order.</b>
              </p>
            </div>
            <div className="gfx">
              <div className="gcard float" style={{ top: 0, left: "8px", right: "30px", padding: "13px 15px" }}>
                <div className="gc-head">
                  <span className="gdot"></span>Sparky<span className="gc-time">now</span>
                </div>
                <div className="gc-text">
                  Aave USDC just moved to <b>4.3%</b>. Want to put your idle USDC to work?
                </div>
              </div>
              <div className="gcard float d2" style={{ bottom: 0, left: "30px", right: "8px", padding: "14px 15px" }}>
                <span className="gc-badge">AI suggestion — you approve &amp; sign</span>
                <div className="gc-rec">
                  Move idle USDC → <b>Aave Vault</b>
                </div>
                <div className="gc-apyrow">
                  <div>
                    <div className="gc-apy tnum">4.3%</div>
                    <div className="gc-apylbl">net APY · estimate</div>
                  </div>
                  <svg className="sparkline" viewBox="0 0 128 40" preserveAspectRatio="none">
                    <path
                      className="sl-area"
                      d="M0 30 L18 26 L36 28 L54 18 L72 22 L90 12 L108 16 L128 8 L128 40 L0 40 Z"
                    />
                    <path className="sl-line" d="M0 30 L18 26 L36 28 L54 18 L72 22 L90 12 L108 16 L128 8" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 2 GUARDRAILS */}
        <section className="sec right" data-sec="2">
          <div className="secinner">
            <div className="panel">
              <div className="kicker">02 — Guardrails check</div>
              <h2 className="htitle">Every move is checked before you sign.</h2>
              <p className="hbody">
                Deterministic policy runs on-chain on each suggestion. If a move breaks a rule, it never reaches you.
              </p>
            </div>
            <div className="gfx">
              <div className="gcard" style={{ inset: "8px 6px", padding: "18px" }}>
                <div className="gc-head" style={{ marginBottom: "16px" }}>
                  <span className="gdot" style={{ background: "var(--brand-cyan)" }}></span>Guardrail check
                </div>
                <div className="gchecklist">
                  <div className="grow">
                    <span className="gcheck">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="3.5">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    Within your cap · $25,000
                  </div>
                  <div className="grow">
                    <span className="gcheck">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="3.5">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    Allowlisted protocol · Aave v3
                  </div>
                  <div className="grow">
                    <span className="gcheck">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="3.5">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    Slippage under 0.5%
                  </div>
                  <div className="grow">
                    <span className="gcheck">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="3.5">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    Simulated on-chain
                  </div>
                </div>
                <div className="gpassed">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                  Simulation passed — no risks
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3 SIGN */}
        <section className="sec left" data-sec="3">
          <div className="secinner">
            <div className="panel">
              <div className="kicker">03 — You sign</div>
              <h2 className="htitle">Nothing moves without your signature.</h2>
              <p className="hbody">
                Sparky can direct strategy, but only you can authorize a transaction.{" "}
                <b>Your keys, your funds — always.</b> Withdraw anytime, even if we&rsquo;re offline.
              </p>
            </div>
            <div className="gfx">
              <div className="gcard float" style={{ inset: "20px", padding: "18px" }}>
                <div className="gc-head">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--brand-cyan)" strokeWidth="2">
                    <path d="M21 2l-2 2m-7.6 7.6a5 5 0 1 0-1 1L20 4l-2-2" />
                  </svg>
                  Sign transaction
                </div>
                <div className="gc-sub">Deposit 2,150 USDC → Aave Vault</div>
                <svg className="sigpad" viewBox="0 0 200 62" preserveAspectRatio="none">
                  <path className="sig" d="M14 42 C30 14 40 56 56 34 S86 10 104 38 130 54 150 28 176 16 188 38" />
                </svg>
                <button className="gc-signbtn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="4" y="11" width="16" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                  Sign with wallet
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 4 VAULT */}
        <section className="sec right" data-sec="4">
          <div className="secinner">
            <div className="panel">
              <div className="kicker">04 — The Aave Yield Vault</div>
              <h2 className="htitle">Conservative yield, capital-preservation-first.</h2>
              <p className="hbody">One audited vault on Base. Honest, net-of-fees numbers — never a projection.</p>
              <div className="vstats extra">
                <div className="vstat">
                  <div className="vn tnum" style={{ color: "var(--brand-cyan)" }}>
                    4.3%
                  </div>
                  <div className="vl">net APY · estimate</div>
                </div>
                <div className="vstat">
                  <div className="vn">
                    Risk 1<span style={{ color: "var(--muted-foreground)", fontSize: "18px" }}>/5</span>
                  </div>
                  <div className="vl">Lower · capital-preservation</div>
                </div>
                <div className="vstat">
                  <div className="vn tnum">0%</div>
                  <div className="vl">SparkPoint fee</div>
                </div>
              </div>
            </div>
            <div className="gfx">
              <div className="gcard float" style={{ inset: "16px", padding: "18px" }}>
                <div className="gc-head">
                  Aave Yield Vault<span className="gc-time">Base</span>
                </div>
                <div className="gc-apy tnum" style={{ marginTop: "10px" }}>
                  4.3%
                  <span style={{ fontSize: "13px", color: "var(--muted-foreground)", fontWeight: 500 }}> net APY</span>
                </div>
                <svg className="areachart" viewBox="0 0 240 92" preserveAspectRatio="none">
                  <path
                    className="ac-area"
                    d="M0 72 L30 64 L60 67 L90 50 L120 54 L150 38 L180 42 L210 26 L232 19 L232 92 L0 92 Z"
                  />
                  <path className="ac-line" d="M0 72 L30 64 L60 67 L90 50 L120 54 L150 38 L180 42 L210 26 L232 19" />
                  <circle className="ac-dot" cx="232" cy="19" r="4" />
                </svg>
                <div className="gc-foot">
                  <span className="gdot" style={{ background: "var(--gain)", animation: "none" }}></span>+$2.04 today ·
                  accruing
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 5 PROOF + CTA */}
        <section className="sec center" data-sec="5">
          <div className="secinner">
            <div className="panel">
              <div className="kicker">05 — Fully self-custodial</div>
              <h2 className="htitle">
                We can&rsquo;t touch your money.
                <br />
                Here&rsquo;s the proof.
              </h2>
              <div className="cc extra">
                <div className="col can">
                  <h4>SparkPoint can</h4>
                  <ul>
                    <li>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gain)" strokeWidth="2.5">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                      Direct strategy &amp; suggest moves
                    </li>
                    <li>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gain)" strokeWidth="2.5">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                      Simulate before you sign
                    </li>
                    <li>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gain)" strokeWidth="2.5">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                      Pause new deposits
                    </li>
                  </ul>
                </div>
                <div className="col cant">
                  <h4>SparkPoint can&rsquo;t</h4>
                  <ul>
                    <li>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--loss)" strokeWidth="2.5">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                      Move or withhold your funds
                    </li>
                    <li>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--loss)" strokeWidth="2.5">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                      Withdraw to itself
                    </li>
                    <li>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--loss)" strokeWidth="2.5">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                      Stop you withdrawing — ever
                    </li>
                  </ul>
                </div>
              </div>
              <div className="hctas extra" style={{ justifyContent: "center" }}>
                <button className="btn btn-primary" onClick={goConnect}>
                  Connect wallet
                </button>
                <button className="btn btn-outline" onClick={goConnect}>
                  Read the thesis
                </button>
              </div>
              <div className="footnote" style={{ marginTop: "24px" }}>
                Mockup for design review · single Aave Yield Vault · Base only · beta-gated. Not financial advice;
                capital at risk.
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
