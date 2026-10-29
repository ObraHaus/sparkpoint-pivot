"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SparkLogo } from "@/components/ui/SparkLogo";
import { stageCopy } from "@/lib/stage";
import brokerProfile from "@/assets/brokers/opensea-profile.png";

/**
 * New Era Landing — Sparky's landing rebuilt on a single Three.js particle
 * field that morphs through six scroll-driven poses, with UnrealBloom post.
 *
 * Source of the visual language: the "New Era" open-design study (three.js).
 * The Sparky copy is unchanged from the prior Spark Core landing; only the
 * 3D engine, the pose choreography, and the crossfade layout are new.
 *
 *   pose 0  Ring (corona)   → HERO
 *   pose 1  Gold frame      → Sparky Brokers (spotlight outline of a frame)
 *   pose 2  Starfield       → 01 Sparky proposes
 *   pose 3  Galaxy (new)    → 02 Guardrails check
 *   pose 4  Helix (DNA)     → 03 You sign
 *   pose 5  Wave (terrain)  → 04 The Curated Vaults
 *   pose 6  Gather → burst  → 05 Fully self-custodial (white close)
 *
 * The whole engine lives in one mount-once useEffect, mirroring the prior
 * landing's pattern. WebGL / reduced-motion both fall back to a stacked,
 * fully-legible scroll via the `.rm` class.
 */

// Color ramp stops (orange → gold → violet → indigo → blue → cyan), shared by
// the shader and the DNA line geometry. Verbatim from the New Era study.
const RAMP: Array<[number, [number, number, number]]> = [
  [0.0, [1.0, 0.353, 0.212]],
  [0.18, [1.0, 0.541, 0.298]],
  [0.45, [0.639, 0.357, 1.0]],
  [0.62, [0.416, 0.357, 1.0]],
  [0.82, [0.231, 0.51, 0.965]],
  [1.0, [0.369, 0.784, 1.0]],
];

// Scroll-progress dots: [label, target scroll fraction] per section.
const DOT_SECTIONS: Array<[string, number]> = [
  ["Welcome", 0.03],
  ["Brokers", 0.14],
  ["Proposes", 0.26],
  ["Guardrails", 0.41],
  ["Sign", 0.585],
  ["Vault", 0.735],
  ["Proof", 0.99],
];

// --- small presentational SVGs (module scope so they keep stable identity) ---
const SparkMark = ({ size = 24 }: { size?: number }) => (
  <SparkLogo size={size} className="ne-smk" />
);

const ArrowOut = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M7 17 17 7" />
    <path d="M8 7h9v9" />
  </svg>
);

const Check = ({ stroke }: { stroke: string }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.5" aria-hidden>
    <path d="M5 13l4 4L19 7" />
  </svg>
);

const Cross = ({ stroke }: { stroke: string }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.5" aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

const MoonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
);

const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
  </svg>
);

type Theme = "light" | "dark";

export default function NewEraLanding() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const splashRef = useRef<HTMLDivElement | null>(null);

  // Landing theme — default LIGHT (client request); dark is the "full" experience.
  // SSR returns the default so the markup matches; the client initializer reads
  // the saved choice, and the splash overlay masks any first-paint swap.
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    return localStorage.getItem("sp-landing-theme") === "dark" ? "dark" : "light";
  });
  const themeRef = useRef<Theme>(theme);
  const [showNudge, setShowNudge] = useState(false);
  // reduced-motion: render the calm static fallback by default, but let the
  // visitor opt into the full animation (motionOverrideRef flips the engine live).
  const [showMotion, setShowMotion] = useState(false);
  const motionOverrideRef = useRef(false);
  // Sparky Brokers — the gold-frame toggle is a PREVIEW of the activation rule
  // (the real burn happens in the app). Off by default: no frame until paid up.
  const [brokerActivated, setBrokerActivated] = useState(false);
  // 3D handles, populated once the scene is built, so the toggle can retheme live.
  const sceneRef = useRef<{
    THREE: typeof import("three");
    renderer: import("three").WebGLRenderer;
    material: import("three").ShaderMaterial;
    dnaLines: import("three").LineSegments;
    bloom: { strength: number };
    darkBloom: number;
  } | null>(null);

  function configureSceneTheme(t: Theme) {
    const s = sceneRef.current;
    if (!s) return;
    const light = t === "light";
    s.renderer.setClearColor(light ? 0xeef1f7 : 0x010104, 1);
    s.material.blending = light ? s.THREE.NormalBlending : s.THREE.AdditiveBlending;
    s.material.needsUpdate = true;
    s.material.uniforms.uLight.value = light ? 1 : 0;
    (s.dnaLines.material as import("three").LineBasicMaterial).blending = light
      ? s.THREE.NormalBlending
      : s.THREE.AdditiveBlending;
    s.bloom.strength = light ? 0.0 : s.darkBloom;
  }

  function applyTheme(t: Theme) {
    themeRef.current = t;
    setTheme(t);
    try {
      localStorage.setItem("sp-landing-theme", t);
    } catch {
      /* ignore */
    }
    configureSceneTheme(t);
  }

  function dismissNudge(switchToDark: boolean) {
    setShowNudge(false);
    try {
      localStorage.setItem("sp-landing-nudge", "done");
    } catch {
      /* ignore */
    }
    if (switchToDark) applyTheme("dark");
  }

  // reduced-motion opt-in: enable the full animation for this visitor.
  function playFullMotion() {
    motionOverrideRef.current = true;
    rootRef.current?.classList.remove("rm");
    setShowMotion(false);
    try {
      localStorage.setItem("sp-landing-motion", "play");
    } catch {
      /* ignore */
    }
    window.scrollTo(0, 0);
  }
  function dismissMotion() {
    setShowMotion(false);
    try {
      localStorage.setItem("sp-landing-motion", "dismissed");
    } catch {
      /* ignore */
    }
  }

  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [subStatus, setSubStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [subError, setSubError] = useState("");

  // Subscribe to the newsletter via our /api/subscribe proxy → Mailjet widget.
  async function onSubscribe(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = newsletterEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setSubError("Please enter a valid email address.");
      setSubStatus("error");
      return;
    }
    setSubStatus("submitting");
    setSubError("");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("provider");
      setSubStatus("success");
    } catch {
      setSubError("Something went wrong — please try again.");
      setSubStatus("error");
    }
  }

  /**
   * The Sparky Broker mint whitelist page.
   *
   * This replaced the beta-access application CTA (2026-10-06): the beta opened to every wallet
   * (`BETA_OPEN=true`), so "Apply for beta access" sent people to a form for something they already
   * had. The collection's GTD/FCFS allowlists are what actually needs an application now, and the
   * form keeps its own address so it can be linked from both landings.
   *
   * Unlike `goConnect`, this deliberately does NOT mirror the construction gate: `/mint-whitelist`
   * is in the middleware's locked-deploy allowlist precisely so a visitor can still ask for a mint
   * spot while the rest of the site is sealed, which is exactly when they would most want to.
   */
  function goMintWhitelist() {
    router.push("/mint-whitelist");
  }

  function goConnect() {
    // While the construction gate is on, /connect is gated — send the CTA to
    // the public Coming soon page instead of dead-ending. Cosmetic mirror of
    // the server-side gate; SITE_LOCKED (middleware) is the real enforcement.
    if (process.env.NEXT_PUBLIC_SITE_LOCKED === "true") {
      router.push("/coming-soon");
      return;
    }
    router.push("/connect");
  }

  /** Smooth-scroll to a normalized scroll fraction (0..1). */
  function scrollToFraction(frac: number) {
    const total = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: total * frac, behavior: "smooth" });
  }

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isMobile = window.innerWidth < 780;

    // reduced-motion: respect it by default (static stacked layout), unless the
    // visitor previously opted into the full animation.
    let motionPref: string | null = null;
    try {
      motionPref = localStorage.getItem("sp-landing-motion");
    } catch {
      /* ignore */
    }
    if (reduced && motionPref === "play") motionOverrideRef.current = true;
    if (reduced && !motionOverrideRef.current) root.classList.add("rm");
    // animate when motion isn't reduced, or the visitor opted in (live flag)
    const isAnimating = () => !reduced || motionOverrideRef.current;

    let cleanup = () => {};
    let cancelled = false;

    // ---- async-load three; ANY failure (chunk blocked, WebGL unavailable,
    //      addon import error) falls back to the stacked, legible `.rm` layout
    //      so the page can never render as a black screen ----
    (async () => {
      try {
        const THREE = await import("three");
        const { EffectComposer } = await import("three/examples/jsm/postprocessing/EffectComposer.js");
        const { RenderPass } = await import("three/examples/jsm/postprocessing/RenderPass.js");
        const { UnrealBloomPass } = await import("three/examples/jsm/postprocessing/UnrealBloomPass.js");
        if (cancelled) return;

        const renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: false,
          alpha: false,
          powerPreference: "high-performance",
        });
        cleanup = init(THREE, renderer, EffectComposer, RenderPass, UnrealBloomPass);
      } catch (err) {
        console.error("[NewEraLanding] 3D init failed — falling back to stacked layout:", err);
        root.classList.add("rm");
      }
    })();

    function init(
      THREE: typeof import("three"),
      renderer: import("three").WebGLRenderer,
      EffectComposer: typeof import("three/examples/jsm/postprocessing/EffectComposer.js")["EffectComposer"],
      RenderPass: typeof import("three/examples/jsm/postprocessing/RenderPass.js")["RenderPass"],
      UnrealBloomPass: typeof import("three/examples/jsm/postprocessing/UnrealBloomPass.js")["UnrealBloomPass"],
    ) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(innerWidth, innerHeight);
      renderer.setClearColor(0x010104, 1);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 400);
      camera.position.set(0, 0, 30);

      const group = new THREE.Group();
      scene.add(group);

      // ---------- pose buffers ----------
      const LINES = isMobile ? 70 : 130;
      const PER = isMobile ? 80 : 130;
      const N = LINES * PER; // ~5.6k mobile / ~16.9k desktop

      const aRing = new Float32Array(N * 3); // pose 0 — corona ring
      const aSpot = new Float32Array(N * 3); // pose 1 — gold frame outline + halo
      const aStar = new Float32Array(N * 3); // pose 2 — starfield
      const aGalaxy = new Float32Array(N * 3); // pose 3 — galaxy (new)
      const aHelix = new Float32Array(N * 3); // pose 4 — DNA helix
      const aWave = new Float32Array(N * 3); // pose 5 — terrain
      const aGather = new Float32Array(N * 3); // pose 6 — central core
      const aRand = new Float32Array(N);
      const aSpotGlow = new Float32Array(N); // 1 = frame rail, 0.5 = halo, 0.15 = fill

      const gw = isMobile ? 130 : 240; // wave grid columns
      const rows = Math.ceil(N / gw);

      // galaxy constants
      const G_ARMS = 2;
      const G_MAXR = 16.0;
      const G_TURNS = 2.4;

      for (let i = 0; i < N; i++) {
        const r3 = i * 3;
        aRand[i] = Math.random();

        // RING — a circular waveform: golden-angle angular coverage (no spokes),
        // radius undulates like an audio wave bent into a ring.
        const a = i * 2.39996323;
        const Rmaj = 13.0;
        const wave =
          Math.sin(a * 6.0) * 0.85 + Math.sin(a * 13.0 + 1.7) * 0.45 + Math.sin(a * 22.0 - 0.6) * 0.22;
        const band = (Math.random() - 0.5) * 1.5;
        const flare = Math.pow(Math.random(), 7.0) * 4.6; // rare solar prominences
        const rad = Rmaj + wave + band + flare;
        aRing[r3] = Math.cos(a) * rad;
        aRing[r3 + 1] = Math.sin(a) * rad;
        aRing[r3 + 2] = (Math.random() - 0.5) * 1.2;

        // GOLD FRAME — the activation pose: a picture-frame outline (the
        // entitlement, drawn) with corner brackets and a soft halo, sitting
        // around the broker art in the left column (desktop) / above the copy
        // (portrait).
        {
          // centred at the world origin; the loop offsets the group so the frame
          // hugs the broker art wherever the responsive layout puts it.
          const SF = 6.4; // frame half-size (scaled to the art by the loop)
          const sx = 0;
          const sy = 0;
          const pick = Math.random();
          if (pick < 0.55) {
            // rails — walk the rectangle perimeter, thin rail thickness
            const per = Math.random() * 4;
            const e = Math.random() * 2 - 1;
            let px = 0;
            let py = 0;
            if (per < 1) {
              px = e * SF;
              py = -SF;
            } else if (per < 2) {
              px = SF;
              py = e * SF;
            } else if (per < 3) {
              px = -e * SF;
              py = SF;
            } else {
              px = -SF;
              py = e * SF;
            }
            aSpot[r3] = sx + px + (Math.random() - 0.5) * 0.22;
            aSpot[r3 + 1] = sy + py + (Math.random() - 0.5) * 0.22;
            aSpot[r3 + 2] = (Math.random() - 0.5) * 0.9;
            aSpotGlow[i] = 1.0;
          } else if (pick < 0.72) {
            // corner brackets — denser arms at the four corners
            const cx = (Math.random() < 0.5 ? -1 : 1) * SF;
            const cy = (Math.random() < 0.5 ? -1 : 1) * SF;
            const along = Math.random() * 1.6;
            const horiz = Math.random() < 0.5;
            aSpot[r3] = sx + cx + (horiz ? -Math.sign(cx) * along : (Math.random() - 0.5) * 0.3);
            aSpot[r3 + 1] = sy + cy + (horiz ? (Math.random() - 0.5) * 0.3 : -Math.sign(cy) * along);
            aSpot[r3 + 2] = (Math.random() - 0.5) * 0.7;
            aSpotGlow[i] = 1.3;
          } else {
            // halo — an ellipse breathing around the frame
            const sang = Math.random() * Math.PI * 2;
            const rr = SF * 1.42 + (Math.random() - 0.5) * 2.4;
            aSpot[r3] = sx + Math.cos(sang) * rr;
            aSpot[r3 + 1] = sy + Math.sin(sang) * rr * 0.68;
            aSpot[r3 + 2] = (Math.random() - 0.5) * 2.6;
            aSpotGlow[i] = 0.45;
          }
        }

        // STARFIELD — wide volume + faint spiral arc
        if (i % 6 === 0) {
          const sa = (i / N) * Math.PI * 4.2;
          const sr = 4 + (i / N) * 30;
          aStar[r3] = Math.cos(sa) * sr;
          aStar[r3 + 1] = -15 + Math.sin(sa) * sr * 0.1 + (Math.random() - 0.5) * 2.4;
          aStar[r3 + 2] = Math.sin(sa) * sr - 8;
        } else {
          aStar[r3] = (Math.random() - 0.5) * 78;
          aStar[r3 + 1] = (Math.random() - 0.5) * 48;
          aStar[r3 + 2] = (Math.random() - 0.5) * 64 - 12;
        }

        // GALAXY — spiral disk in the XZ plane: dense warm core, two logarithmic
        // dust arms, and one brighter orbit ring. Viewed at a low angle via the
        // group tilt; color ramps by radius so the core glows warm.
        const sel = Math.random();
        if (sel < 0.16) {
          // dense core
          const cr = Math.pow(Math.random(), 2.0) * 2.4;
          const ca = Math.random() * Math.PI * 2;
          aGalaxy[r3] = Math.cos(ca) * cr;
          aGalaxy[r3 + 1] = (Math.random() - 0.5) * 0.8;
          aGalaxy[r3 + 2] = Math.sin(ca) * cr;
        } else if (sel < 0.3) {
          // bright orbit ring band (the prominent ellipse)
          const rr = 9.6 + (Math.random() - 0.5) * 1.3;
          const ra = Math.random() * Math.PI * 2;
          aGalaxy[r3] = Math.cos(ra) * rr;
          aGalaxy[r3 + 1] = (Math.random() - 0.5) * 0.5;
          aGalaxy[r3 + 2] = Math.sin(ra) * rr;
        } else {
          // spiral arms
          const arm = i % G_ARMS;
          const tt = Math.pow(Math.random(), 0.7); // bias outward
          const theta = tt * Math.PI * 2 * G_TURNS + arm * ((Math.PI * 2) / G_ARMS);
          const grad = 1.5 + tt * G_MAXR;
          const jx = (Math.random() - 0.5) * grad * 0.18;
          const jz = (Math.random() - 0.5) * grad * 0.18;
          aGalaxy[r3] = Math.cos(theta) * grad + jx;
          aGalaxy[r3 + 1] = (Math.random() - 0.5) * (0.5 + tt * 1.0);
          aGalaxy[r3 + 2] = Math.sin(theta) * grad + jz;
        }

        // DNA — double helix: two backbone strands (180° apart) + base-pair rungs
        const HH = 12.0,
          HR = 2.9,
          TURNS = 4.0,
          NRUNGS = 26;
        if (i % 4 === 0) {
          const ri = Math.floor(Math.random() * NRUNGS);
          const ty = ri / (NRUNGS - 1);
          const rang = ty * Math.PI * 2 * TURNS;
          const u = Math.random();
          const x0 = Math.cos(rang) * HR,
            z0 = Math.sin(rang) * HR;
          const x1 = Math.cos(rang + Math.PI) * HR,
            z1 = Math.sin(rang + Math.PI) * HR;
          aHelix[r3] = x0 + (x1 - x0) * u + (Math.random() - 0.5) * 0.16;
          aHelix[r3 + 1] = (ty - 0.5) * 2 * HH + (Math.random() - 0.5) * 0.22;
          aHelix[r3 + 2] = z0 + (z1 - z0) * u + (Math.random() - 0.5) * 0.16;
        } else {
          const t = i / N;
          const s = i & 1;
          const ha = t * Math.PI * 2 * TURNS + s * Math.PI;
          const hr = HR + (Math.random() - 0.5) * 0.3;
          aHelix[r3] = Math.cos(ha) * hr;
          aHelix[r3 + 1] = (t - 0.5) * 2 * HH;
          aHelix[r3 + 2] = Math.sin(ha) * hr;
        }

        // WAVE — flat undulating terrain (colored by x)
        const col = i % gw,
          row = Math.floor(i / gw);
        const wx = (col / (gw - 1) - 0.5) * 66 + (Math.random() - 0.5) * 0.4;
        const wz = (row / (rows - 1) - 0.5) * 42;
        const wy =
          -7.5 +
          Math.sin(wx * 0.34) * 0.9 +
          Math.cos(wz * 0.42) * 0.8 +
          Math.sin((wx + wz) * 0.18) * 1.3 +
          (Math.random() - 0.5) * 0.3;
        aWave[r3] = wx;
        aWave[r3 + 1] = wy;
        aWave[r3 + 2] = wz;

        // GATHER — tight central core
        const gphi = Math.acos(2 * Math.random() - 1),
          gth = Math.random() * Math.PI * 2;
        const grd = Math.cbrt(Math.random()) * 0.9;
        aGather[r3] = grd * Math.sin(gphi) * Math.cos(gth);
        aGather[r3 + 1] = grd * Math.cos(gphi);
        aGather[r3 + 2] = grd * Math.sin(gphi) * Math.sin(gth);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(aRing, 3)); // base = ring
      geo.setAttribute("aSpot", new THREE.BufferAttribute(aSpot, 3));
      geo.setAttribute("aSpotGlow", new THREE.BufferAttribute(aSpotGlow, 1));
      geo.setAttribute("aStar", new THREE.BufferAttribute(aStar, 3));
      geo.setAttribute("aGalaxy", new THREE.BufferAttribute(aGalaxy, 3));
      geo.setAttribute("aHelix", new THREE.BufferAttribute(aHelix, 3));
      geo.setAttribute("aWave", new THREE.BufferAttribute(aWave, 3));
      geo.setAttribute("aGather", new THREE.BufferAttribute(aGather, 3));
      geo.setAttribute("aRand", new THREE.BufferAttribute(aRand, 1));

      const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uDpr: { value: Math.min(devicePixelRatio, 2) },
          uSize: { value: isMobile ? 1.6 : 1.3 },
          wRing: { value: 1 },
          wSpot: { value: 0 },
          wStar: { value: 0 },
          wGalaxy: { value: 0 },
          wHelix: { value: 0 },
          wWave: { value: 0 },
          wGather: { value: 0 },
          uBurst: { value: 0 },
          uWaveCol: { value: 0 },
          uGalaxyCol: { value: 0 },
          uShimmer: { value: 1 },
          uLight: { value: 0 }, // 0 = dark (additive glow), 1 = light (ink)
        },
        vertexShader: `
          attribute vec3 aSpot; attribute float aSpotGlow;
          attribute vec3 aStar; attribute vec3 aGalaxy; attribute vec3 aHelix;
          attribute vec3 aWave; attribute vec3 aGather; attribute float aRand;
          uniform float uTime,uDpr,uSize,wRing,wSpot,wStar,wGalaxy,wHelix,wWave,wGather,uBurst,uWaveCol,uGalaxyCol,uShimmer;
          varying vec3 vCol; varying float vI;
          vec3 ramp(float t){
            vec3 c0=vec3(1.000,0.353,0.212), c1=vec3(1.000,0.541,0.298), c2=vec3(0.639,0.357,1.000),
                 c3=vec3(0.416,0.357,1.000), c4=vec3(0.231,0.510,0.965), c5=vec3(0.369,0.784,1.000);
            vec3 c=mix(c0,c1,smoothstep(0.0,0.18,t));
            c=mix(c,c2,smoothstep(0.18,0.45,t));
            c=mix(c,c3,smoothstep(0.45,0.62,t));
            c=mix(c,c4,smoothstep(0.62,0.82,t));
            c=mix(c,c5,smoothstep(0.82,1.0,t));
            return c;
          }
          void main(){
            vec3 fp = position*wRing + aSpot*wSpot + aStar*wStar + aGalaxy*wGalaxy + aHelix*wHelix + aWave*wWave + aGather*wGather;
            // corona ring: rim undulates as a waveform travelling around the loop
            if(wRing>0.001){
              float ang = atan(fp.y, fp.x);
              float r = length(fp.xy) + 0.0001;
              vec2 radial = fp.xy / r;
              vec2 tang = vec2(-fp.y, fp.x) / r;
              float w = sin(ang*6.0 - uTime*0.8)*0.42 + sin(ang*13.0 + uTime*1.0)*0.22;
              fp.xy += radial * w * wRing;
              fp.xy += tang * sin(ang*9.0 - uTime*0.6) * 0.16 * wRing;
            }
            // gentle drift / shimmer
            float s = uShimmer;
            fp.x += sin(fp.y*0.35 + uTime*0.7 + aRand*6.2831)*0.13*s;
            fp.z += cos(fp.x*0.35 + uTime*0.6 + aRand*6.2831)*0.13*s;
            fp.y += sin(uTime*0.9 + aRand*6.2831)*0.08*s;
            // burst — push outward from centre
            if(uBurst>0.0){
              vec3 dir = normalize(fp + vec3(0.0001));
              fp += dir * uBurst*uBurst * 34.0;
            }
            // colour: y-based ramp, switching to x-based (wave) or radial (galaxy)
            float tY = clamp((12.0 - fp.y)/24.0, 0.0, 1.0);
            float tX = clamp(0.5 - fp.x/66.0, 0.0, 1.0);
            float tG = clamp(length(fp.xz)/16.0, 0.0, 1.0);
            float t = mix(tY, tX, uWaveCol);
            t = mix(t, tG, uGalaxyCol);
            t = mix(t, 0.14, wSpot); // gold-frame pose
            vCol = ramp(t);
            float tw = 0.78 + 0.34*sin(uTime*2.0 + aRand*40.0);
            vI = tw + uBurst*3.5 + uGalaxyCol*(1.0-tG)*0.9 + wSpot*aSpotGlow*1.5; // galaxy core glows, frame rails sparkle
            vec4 mv = modelViewMatrix * vec4(fp,1.0);
            gl_PointSize = uSize*uDpr*(62.0/-mv.z)*(1.0+uBurst*1.4);
            gl_Position = projectionMatrix*mv;
          }
        `,
        fragmentShader: `
          precision mediump float;
          uniform float uLight;
          varying vec3 vCol; varying float vI;
          void main(){
            float d = length(gl_PointCoord-0.5);
            float a = smoothstep(0.5,0.04,d);
            if(a<=0.001) discard;
            // dark: additive glow (vCol*vI). light: darker, more opaque ink dots.
            vec3 col = mix(vCol*vI, vCol*0.5, uLight);
            float alpha = min(a * (1.0 + uLight*0.8), 1.0);
            gl_FragColor = vec4(col, alpha);
          }
        `,
      });

      const points = new THREE.Points(geo, material);
      points.frustumCulled = false;
      group.add(points);

      // ---------- DNA wired lines (visible only during the helix stage) ----------
      const dnaLines = buildDNA(THREE);
      group.add(dnaLines);

      // ---------- post ----------
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(innerWidth, innerHeight),
        isMobile ? 0.7 : 0.95,
        0.6,
        0.0,
      );
      composer.addPass(bloom);

      // expose handles + apply the initial theme (ink-on-light vs additive-dark)
      sceneRef.current = {
        THREE,
        renderer,
        material,
        dnaLines,
        bloom,
        darkBloom: isMobile ? 0.7 : 0.95,
      };
      configureSceneTheme(themeRef.current);

      // The brokers frame is a world-space pose; the art is DOM. Measure the
      // art's on-screen centre + width and convert to world offsets at z=0, so
      // the particle frame hugs the art on every viewport (desktop columns and
      // the stacked mobile/`rm` layouts).
      let spotCx = 0,
        spotCy = 0,
        spotScale = 1;
      function measureSpot() {
        const el = root!.querySelector("#brokers .broker-img") as HTMLElement | null;
        if (!el || !el.getBoundingClientRect) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0) return;
        const halfH = Math.tan((camera.fov * Math.PI) / 360) * 29;
        const halfW = halfH * camera.aspect;
        spotCx = ((r.left + r.width / 2) / innerWidth - 0.5) * 2 * halfW;
        spotCy = -((r.top + r.height / 2) / innerHeight - 0.5) * 2 * halfH;
        const desiredHalf = ((r.width * 1.14) / 2 / innerWidth) * 2 * halfW;
        spotScale = Math.min(1.7, Math.max(0.5, desiredHalf / 6.4));
      }

      function onResize() {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight);
        composer.setSize(innerWidth, innerHeight);
        bloom.setSize(innerWidth, innerHeight);
        measureSpot();
      }
      addEventListener("resize", onResize);
      onResize();

      // ---------- scroll → progress → pose weights ----------
      const ss = (lo: number, hi: number, x: number) => {
        x = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
        return x * x * (3 - 2 * x);
      };
      const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
      const fade = (p: number, a: number, b: number, c: number, d: number) =>
        Math.min(ss(a, b, p), 1 - ss(c, d, p));

      type Weights = {
        ring: number;
        spot: number;
        star: number;
        galaxy: number;
        helix: number;
        wave: number;
        gather: number;
      };
      function stageWeights(p: number): { w: Weights; burst: number; white: number } {
        const w: Weights = { ring: 0, spot: 0, star: 0, galaxy: 0, helix: 0, wave: 0, gather: 0 };
        let burst = 0,
          white = 0;
        if (p < 0.06) w.ring = 1;
        else if (p < 0.13) {
          const t = ss(0.06, 0.13, p);
          w.ring = 1 - t;
          w.spot = t;
        } else if (p < 0.19) w.spot = 1;
        else if (p < 0.26) {
          const t = ss(0.19, 0.26, p);
          w.spot = 1 - t;
          w.star = t;
        } else if (p < 0.33) w.star = 1;
        else if (p < 0.41) {
          const t = ss(0.33, 0.41, p);
          w.star = 1 - t;
          w.galaxy = t;
        } else if (p < 0.48) w.galaxy = 1;
        else if (p < 0.56) {
          const t = ss(0.48, 0.56, p);
          w.galaxy = 1 - t;
          w.helix = t;
        } else if (p < 0.63) w.helix = 1;
        else if (p < 0.71) {
          const t = ss(0.63, 0.71, p);
          w.helix = 1 - t;
          w.wave = t;
        } else if (p < 0.78) w.wave = 1;
        else if (p < 0.86) {
          const t = ss(0.78, 0.86, p);
          w.wave = 1 - t;
          w.gather = t;
        } else if (p < 0.91) w.gather = 1;
        else if (p < 0.96) {
          w.gather = 1;
          burst = ss(0.91, 0.96, p);
        } else {
          w.gather = 1;
          burst = 1;
          white = ss(0.95, 1.0, p);
        }
        return { w, burst, white };
      }

      // ---------- DOM handles ----------
      const $ = (sel: string) => root!.querySelector(sel) as HTMLElement | null;
      const panels = {
        hero: $("#hero"),
        brokers: $("#brokers"),
        proposes: $("#proposes"),
        guardrails: $("#guardrails"),
        sign: $("#sign"),
        vault: $("#vault"),
      };
      const whiteout = $(".whiteout");
      const footer = $("footer.close");
      const hint = $(".scrollhint");
      const navEl = $(".ne-nav");
      const dotsEl = $(".ne-dots");
      const dotButtons = Array.from(root!.querySelectorAll(".ne-dots button")) as HTMLElement[];

      function setPanel(el: HTMLElement | null, o: number, dy: number) {
        if (!el) return;
        el.style.opacity = o.toFixed(3);
        el.style.transform = `translateY(${dy}px)`;
        el.style.pointerEvents = o > 0.55 ? "auto" : "none";
      }

      function getProgress() {
        if (!isAnimating()) return 0.045;
        const max = document.documentElement.scrollHeight - innerHeight;
        return max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
      }

      let curZ = 30,
        curRX = 0,
        curX = 0,
        curY = 0,
        smP = 0,
        lastSec = -1,
        raf = 0;

      function loop(tms: number) {
        const time = tms * 0.001;
        const p = getProgress();
        smP += (p - smP) * 0.12;
        const { w, burst, white } = stageWeights(smP);

        const u = material.uniforms;
        u.uTime.value = time;
        u.wRing.value = w.ring;
        u.wSpot.value = w.spot;
        u.wStar.value = w.star;
        u.wGalaxy.value = w.galaxy;
        u.wHelix.value = w.helix;
        u.wWave.value = w.wave;
        u.wGather.value = w.gather;
        u.uBurst.value = burst;
        u.uWaveCol.value = w.wave;
        u.uGalaxyCol.value = w.galaxy;
        u.uShimmer.value = 1 - burst * 0.8;

        // camera distance + tilt per pose. On portrait screens the horizontal
        // FOV is the constraint, so pull the camera back to fit the wide poses.
        const aspect = innerWidth / innerHeight;
        const fit = aspect < 1 ? Math.min(1.9, 0.85 / aspect) : 1;
        const tz =
          (30 * w.ring + 29 * w.spot + 14.5 * w.star + 22 * w.galaxy + 26 * w.helix + 30 * w.wave + 19 * w.gather) *
          fit;
        const trx = w.galaxy * 0.95 + w.wave * 0.42 + w.star * 0.05;
        // nudge the galaxy left so its glowing core sits just right of the
        // guardrails card (left) and clear of the right-aligned copy
        // + slide the gold-frame pose onto the broker art's measured centre
        const tposx = -3 * w.galaxy + spotCx * w.spot;
        const tposy = spotCy * w.spot;
        curZ += (tz - curZ) * 0.06;
        curRX += (trx - curRX) * 0.06;
        curX += (tposx - curX) * 0.06;
        curY += (tposy - curY) * 0.06;
        camera.position.z = curZ;
        group.rotation.x = curRX;
        group.position.x = curX;
        group.position.y = curY;

        if (isAnimating()) {
          group.rotation.y += 0.0026 * w.helix + 0.0012 * w.galaxy;
          group.rotation.y *= 1 - 0.08 * w.ring - 0.04 * w.wave - 0.04 * w.gather;
          group.rotation.z = 0;
          const breathe = 1 + 0.014 * Math.sin(time * 0.8) * w.ring;
          group.scale.setScalar(breathe * (1 + (spotScale - 1) * w.spot));
        }
        dnaLines.material.opacity = w.helix * 0.5;

        // crossfade overlays — skipped when not animating (CSS owns the stacked layout)
        if (isAnimating()) {
          setPanel(panels.hero, fade(smP, -0.1, 0.0, 0.05, 0.1), (0.1 - Math.min(smP, 0.1)) * -80);
          setPanel(panels.brokers, fade(smP, 0.06, 0.11, 0.16, 0.2), (0.13 - clamp(smP, 0.06, 0.2)) * 120);
          setPanel(panels.proposes, fade(smP, 0.2, 0.25, 0.3, 0.35), (0.275 - clamp(smP, 0.2, 0.35)) * 120);
          setPanel(panels.guardrails, fade(smP, 0.355, 0.4, 0.46, 0.51), (0.43 - clamp(smP, 0.355, 0.51)) * 120);
          setPanel(panels.sign, fade(smP, 0.51, 0.56, 0.61, 0.66), (0.585 - clamp(smP, 0.51, 0.66)) * 120);
          setPanel(panels.vault, fade(smP, 0.66, 0.71, 0.76, 0.81), (0.735 - clamp(smP, 0.66, 0.81)) * 120);

          if (whiteout) whiteout.style.opacity = white.toFixed(3);
          if (footer) {
            const fo = ss(0.975, 1.0, smP);
            footer.style.opacity = fo.toFixed(3);
            footer.style.pointerEvents = fo > 0.6 ? "auto" : "none";
          }
          if (hint) hint.style.opacity = (1 - ss(0.02, 0.1, smP)).toFixed(2);
          if (navEl) navEl.style.opacity = (1 - ss(0.93, 0.985, smP)).toFixed(2);
          if (dotsEl) {
            const o = 1 - ss(0.9, 0.97, smP); // fade dots out as the white close arrives
            dotsEl.style.opacity = o.toFixed(2);
            dotsEl.style.pointerEvents = o > 0.5 ? "auto" : "none";
          }
          canvas!.style.opacity = (1 - white * 0.9).toFixed(2);
        }

        // active scroll-progress dot — switch at the midpoint of each panel
        // hand-off, so the lit dot matches the panel actually on screen.
        const secIdx =
          smP < 0.09 ? 0 : smP < 0.21 ? 1 : smP < 0.35 ? 2 : smP < 0.51 ? 3 : smP < 0.66 ? 4 : smP < 0.86 ? 5 : 6;
        if (secIdx !== lastSec) {
          lastSec = secIdx;
          dotButtons.forEach((b, i) => b.classList.toggle("on", i === secIdx));
        }

        composer.render();
        raf = requestAnimationFrame(loop);
      }

      raf = requestAnimationFrame(loop);

      return () => {
        cancelAnimationFrame(raf);
        removeEventListener("resize", onResize);
        dnaLines.geometry.dispose();
        (dnaLines.material as import("three").Material).dispose();
        geo.dispose();
        material.dispose();
        composer.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        sceneRef.current = null;
      };
    }

    // Two continuous backbone helices + base-pair rungs as additive lines.
    function buildDNA(THREE: typeof import("three")) {
      const HH = 12.0,
        HR = 2.9,
        TURNS = 4.0,
        NRUNGS = 26,
        SEG = 170;
      function ramp(t: number): [number, number, number] {
        t = Math.max(0, Math.min(1, t));
        for (let s = 0; s < RAMP.length - 1; s++) {
          if (t <= RAMP[s + 1][0]) {
            const a = RAMP[s],
              b = RAMP[s + 1],
              f = (t - a[0]) / (b[0] - a[0]);
            return [
              a[1][0] + (b[1][0] - a[1][0]) * f,
              a[1][1] + (b[1][1] - a[1][1]) * f,
              a[1][2] + (b[1][2] - a[1][2]) * f,
            ];
          }
        }
        return RAMP[RAMP.length - 1][1];
      }
      function pt(s: number, tt: number): [number, number, number] {
        const ang = tt * Math.PI * 2 * TURNS + s * Math.PI;
        const y = (tt - 0.5) * 2 * HH;
        return [Math.cos(ang) * HR, y, Math.sin(ang) * HR];
      }
      const pos: number[] = [],
        col: number[] = [];
      function push(p: [number, number, number]) {
        pos.push(p[0], p[1], p[2]);
        const c = ramp((12 - p[1]) / 24);
        col.push(c[0], c[1], c[2]);
      }
      for (let s = 0; s < 2; s++)
        for (let j = 0; j < SEG - 1; j++) {
          push(pt(s, j / (SEG - 1)));
          push(pt(s, (j + 1) / (SEG - 1)));
        }
      for (let ri = 0; ri < NRUNGS; ri++) {
        const tt = ri / (NRUNGS - 1);
        push(pt(0, tt));
        push(pt(1, tt));
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      lg.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      const lm = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const lines = new THREE.LineSegments(lg, lm);
      lines.frustumCulled = false;
      return lines;
    }

    return () => {
      cancelled = true;
      cleanup();
    };
  }, []); // mount once

  // Splash fade-out + dark-mode nudge timer.
  useEffect(() => {
    const splash = splashRef.current;
    const hideSplash = () => splash?.classList.add("gone");
    const splashTimer = setTimeout(hideSplash, 1100);
    // never let the splash trap the user if timers are throttled
    const onFirst = () => hideSplash();
    ["wheel", "scroll", "pointerdown", "keydown"].forEach((ev) =>
      addEventListener(ev, onFirst, { once: true, passive: true }),
    );

    let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
    let nudgeDone = true;
    try {
      nudgeDone = localStorage.getItem("sp-landing-nudge") === "done";
    } catch {
      /* ignore */
    }
    if (!nudgeDone) {
      nudgeTimer = setTimeout(() => {
        if (themeRef.current === "light") setShowNudge(true); // only nudge light-mode visitors
      }, 3600);
    }

    // reduced-motion popup: offer the full animation (unless already chosen)
    let motionTimer: ReturnType<typeof setTimeout> | undefined;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let motionPref: string | null = null;
    try {
      motionPref = localStorage.getItem("sp-landing-motion");
    } catch {
      /* ignore */
    }
    if (reduced && motionPref !== "play" && motionPref !== "dismissed") {
      motionTimer = setTimeout(() => setShowMotion(true), 2600);
    }

    return () => {
      clearTimeout(splashTimer);
      if (nudgeTimer) clearTimeout(nudgeTimer);
      if (motionTimer) clearTimeout(motionTimer);
      ["wheel", "scroll", "pointerdown", "keydown"].forEach((ev) => removeEventListener(ev, onFirst));
    };
  }, []);

  return (
    <div className={`new-era-root${theme === "light" ? " light" : ""}`} ref={rootRef} suppressHydrationWarning>
      {/* first-load splash — fades out once mounted */}
      <div id="ne-splash" ref={splashRef}>
        <span className="ne-splash-word">Sparky</span>
      </div>

      <canvas id="scene" ref={canvasRef}></canvas>
      <div className="vignette"></div>

      {/* fixed chrome */}
      <nav className="ne-nav">
        <span className="ne-brand">
          <SparkMark />
          Sparky
        </span>
        <span className="ne-grow"></span>
        <button
          className="ne-themebtn"
          onClick={() => applyTheme(theme === "light" ? "dark" : "light")}
          aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
        >
          {theme === "light" ? <MoonIcon /> : <SunIcon />}
        </button>
        <span className="ne-badge-led" title="Fully self-custodial">
          <span className="led"></span>Fully self-custodial
        </span>
        <button className="ne-navbtn" onClick={goConnect}>
          Connect wallet
        </button>
      </nav>

      {/* scroll-progress dots */}
      <div className="ne-dots" role="navigation" aria-label="Sections">
        {DOT_SECTIONS.map(([label, frac], i) => (
          <button
            key={label}
            type="button"
            className={i === 0 ? "on" : ""}
            aria-label={label}
            onClick={() => scrollToFraction(frac)}
          />
        ))}
      </div>

      {/* crossfade panels */}
      <div className="panels">
        {/* 0 — HERO (corona ring) */}
        <section className="panel hero" id="hero">
          <div className="wrap">
            <span className="badge">
              <SparkMark size={15} />
              Fully self-custodial · AI-native onchain hedge fund
            </span>
            <h1 className="head">
              Meet the spark <span className="tail">that watches your capital.</span>
            </h1>
            <p className="sub">
              Sparky reads your goals, suggests every move, and proves every result on-chain — and{" "}
              <b>can&rsquo;t hold, move, or lose your money.</b>
            </p>
            <div className="btns">
              <button className="btn primary" onClick={goConnect}>
                Connect wallet
                <span className="arrow">
                  <ArrowOut />
                </span>
              </button>
              <button className="btn ghost" onClick={() => scrollToFraction(0.26)}>
                See how it works
              </button>
              {/* The beta is open to every wallet, so this is no longer an access application —
                  it is the Sparky Broker GTD/FCFS mint whitelist (the collection mints in staged
                  allowlists on OpenSea). It NAVIGATES to /mint-whitelist rather than scrolling:
                  this page is a scroll-driven WebGL sequence, so a programmatic jump to the end
                  whips the whole animation past at a speed nobody can read, and dumps the visitor
                  somewhere they did not ask to be. A page transition is the honest way to change
                  context. */}
              <button className="btn ghost" onClick={goMintWhitelist}>
                Apply for mint whitelist
              </button>
            </div>
          </div>
        </section>

        {/* 1 — SPARKY BROKERS (gold frame pose) */}
        <section className="panel brokers" id="brokers">
          <div className="wrap">
            <div className="broker-art">
              <span className="broker-glow" aria-hidden />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className={`broker-img${brokerActivated ? " on" : ""}`}
                src={brokerProfile.src}
                alt="Sparky Broker — the collection profile image"
                draggable={false}
              />
              <div className="broker-toggle" role="group" aria-label="Activation preview">
                <button
                  type="button"
                  className={brokerActivated ? "" : "on"}
                  onClick={() => setBrokerActivated(false)}
                >
                  Unactivated
                </button>
                <button
                  type="button"
                  className={brokerActivated ? "on" : ""}
                  onClick={() => setBrokerActivated(true)}
                >
                  Activated · gold frame
                </button>
              </div>
              <span className="broker-note">Preview — activation burns SRK in the app.</span>
            </div>
            <div className="col">
              <span className="badge accent">
                <SparkMark size={13} />
                Membership · not just a collectible
              </span>
              <span className="kicker">Sparky Brokers</span>
              <h1 className="head">
                A broker is a <span className="tail">membership.</span>
              </h1>
              <p className="sub wide">
                Activate it with SRK to unlock <b>SparkPoint Premium</b> and a{" "}
                <b>weight in every revenue payout</b> — and it wears the proof as a two-pixel gold
                frame. Activation belongs to the holder, not the token.
              </p>
              <ul className="checks">
                <li>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--brand-cyan)" strokeWidth="3.5">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                  A two-pixel gold frame — the entitlement, drawn
                </li>
                <li>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--brand-cyan)" strokeWidth="3.5">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                  Sell it and the activation clears; the next owner burns their own SRK
                </li>
              </ul>
              <div className="broker-flow">
                <div>
                  <b>1 · Hold</b>
                  <span>A broker from the 5,555.</span>
                </div>
                <div>
                  <b>2 · Burn SRK</b>
                  <span>Premium + payout weight.</span>
                </div>
                <div>
                  <b>3 · Transfer</b>
                  <span>Activation clears.</span>
                </div>
              </div>
              <div className="btns">
                <a
                  className="btn primary"
                  href="https://opensea.io/collection/sparkybroker"
                  target="_blank"
                  rel="noreferrer"
                >
                  View on OpenSea
                  <span className="arrow">
                    <ArrowOut />
                  </span>
                </a>
                {/* The GTD/FCFS allowlists are the one part of the drop that still needs an
                    application — the beta-access CTA is gone because the beta is open. */}
                <button className="btn ghost" onClick={goMintWhitelist}>
                  Apply for mint whitelist
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 2 — PROPOSES (starfield) */}
        <section className="panel left" id="proposes">
          <div className="wrap">
            <div className="col">
              <span className="badge accent">
                <SparkMark size={13} />
                AI suggestion — you approve &amp; sign
              </span>
              <span className="kicker">01 — Sparky proposes</span>
              <h1 className="head">An AI that reads the whole market for you.</h1>
              <p className="sub wide">
                It watches the live vaults, your wallet, and your plan — then suggests the next move in plain language, with
                its reasoning and its sources. <b>Always a suggestion, never an order.</b>
              </p>
            </div>
            <div className="gfx">
              <div className="gcard float" style={{ top: 0, left: "8px", right: "30px", padding: "13px 15px" }}>
                <div className="gc-head">
                  <span className="gdot"></span>Sparky<span className="gc-time">now</span>
                </div>
                <div className="gc-text">
                  USDG just moved to <b>3.6%</b>. Want to put your idle USDG to work?
                </div>
              </div>
              <div className="gcard float d2" style={{ bottom: 0, left: "30px", right: "8px", padding: "14px 15px" }}>
                <span className="gc-badge">AI suggestion — you approve &amp; sign</span>
                <div className="gc-rec">
                  Move idle USDG → <b>Curated Vault</b>
                </div>
                <div className="gc-apyrow">
                  <div>
                    <div className="gc-apy tnum">3.6%</div>
                    <div className="gc-apylbl">net APY · estimate</div>
                  </div>
                  <svg className="sparkline" viewBox="0 0 128 40" preserveAspectRatio="none">
                    <path className="sl-area" d="M0 30 L18 26 L36 28 L54 18 L72 22 L90 12 L108 16 L128 8 L128 40 L0 40 Z" />
                    <path className="sl-line" d="M0 30 L18 26 L36 28 L54 18 L72 22 L90 12 L108 16 L128 8" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 2 — GUARDRAILS (galaxy) */}
        <section className="panel right" id="guardrails">
          <div className="wrap">
            <div className="col">
              <span className="kicker">02 — Guardrails check</span>
              <h1 className="head">Every move is checked before you sign.</h1>
              <p className="sub wide">
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
                    Allowlisted vault · curated board
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

        {/* 3 — SIGN (helix) */}
        <section className="panel left" id="sign">
          <div className="wrap">
            <div className="col">
              <span className="kicker">03 — You sign</span>
              <h1 className="head">Nothing moves without your signature.</h1>
              <p className="sub wide">
                Sparky can direct strategy, but only you can authorize a transaction.{" "}
                <b>Your keys, your funds — always.</b>{" "}
                Withdraw anytime, even if we&rsquo;re offline.
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
                <div className="gc-sub">Deposit 2,150 USDG → Curated Vault</div>
                <svg className="sigpad" viewBox="0 0 200 62" preserveAspectRatio="none">
                  <path
                    className="sig"
                    d="M14 40 C 20 15 28 13 30 28 C 31 39 25 43 24 33 C 23 22 33 21 39 33 C 43 41 48 41 50 30 C 52 20 57 20 58 31 C 59 42 65 43 70 30 C 76 14 86 14 86 32 C 86 47 92 46 98 33 C 104 22 110 24 113 35 C 116 45 123 45 128 31 C 133 18 142 20 144 33 C 145 43 151 45 158 33 C 168 16 182 22 190 28 C 198 33 176 50 112 50 C 64 50 40 48 34 43"
                  />
                </svg>
                <button className="gc-signbtn" type="button">
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

        {/* 4 — VAULT (wave / terrain) */}
        <section className="panel right" id="vault">
          <div className="wrap">
            <div className="col">
              <span className="kicker">04 — The Curated Vaults</span>
              <h1 className="head">
                Conservative yield, <span className="tail">capital-preservation-first.</span>
              </h1>
              <p className="sub">Honest, net-of-fees numbers — never a projection.</p>
              <ul className="stats">
                <li>
                  <span className="sn" style={{ color: "var(--brand-cyan)" }}>
                    3.6%
                  </span>
                  <span className="sl">net APY · estimate</span>
                </li>
                <li>
                  <span className="sn">
                    Risk 1<span className="sub-unit">/5</span>
                  </span>
                  <span className="sl">Lower · capital-preservation</span>
                </li>
                <li>
                  <span className="sn">0%</span>
                  <span className="sl">management fee</span>
                </li>
              </ul>
            </div>
            <div className="gfx">
              <div className="gcard float" style={{ inset: "16px", padding: "18px" }}>
                <div className="gc-head">
                  Curated USDG vault<span className="gc-time">Robinhood Chain</span>
                </div>
                <div className="gc-apy tnum" style={{ marginTop: "10px" }}>
                  3.6%
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
      </div>

      <div className="scrollhint">
        <span>Scroll</span>
        <span className="bar"></span>
      </div>

      {/* 5 — close: burst → white footer (Fully self-custodial) */}
      <div className="whiteout"></div>
      <footer className="close">
        <div className="ftop">
          <div className="fbrand">
            <SparkMark size={22} />
            Sparky
          </div>
          <span className="kicker dark">05 — Fully self-custodial</span>
          <h2>
            We can&rsquo;t touch your money. <span className="tail">Here&rsquo;s the proof.</span>
          </h2>
          <div className="cc">
            <div className="col can">
              <h4>Sparky can</h4>
              <ul>
                <li>
                  <Check stroke="var(--gain)" />
                  Direct strategy &amp; suggest moves
                </li>
                <li>
                  <Check stroke="var(--gain)" />
                  Simulate before you sign
                </li>
                <li>
                  <Check stroke="var(--gain)" />
                  Pause new deposits
                </li>
              </ul>
            </div>
            <div className="col cant">
              <h4>Sparky can&rsquo;t</h4>
              <ul>
                <li>
                  <Cross stroke="var(--loss)" />
                  Move or withhold your funds
                </li>
                <li>
                  <Cross stroke="var(--loss)" />
                  Withdraw to itself
                </li>
                <li>
                  <Cross stroke="var(--loss)" />
                  Stop you withdrawing — ever
                </li>
              </ul>
            </div>
          </div>
          <form className="fsub" onSubmit={onSubscribe} noValidate>
            <label className="fsub-label" htmlFor="ne-news">
              Get launch updates
            </label>
            {subStatus === "success" ? (
              <p className="fsub-done" role="status">
                Thanks — check your inbox to confirm your subscription.
              </p>
            ) : (
              <>
                <div className="fsub-row">
                  <input
                    id="ne-news"
                    className="fsub-input"
                    type="email"
                    autoComplete="email"
                    placeholder="you@email.com"
                    aria-label="Email address"
                    value={newsletterEmail}
                    disabled={subStatus === "submitting"}
                    onChange={(e) => {
                      setNewsletterEmail(e.target.value);
                      if (subStatus === "error") setSubStatus("idle");
                    }}
                  />
                  <button
                    className="fbtn primary"
                    type="submit"
                    disabled={subStatus === "submitting"}
                  >
                    {subStatus === "submitting" ? "Subscribing…" : "Subscribe"}
                    <span className="arrow">
                      <ArrowOut />
                    </span>
                  </button>
                </div>
                {subStatus === "error" && (
                  <p className="fsub-error" role="alert">
                    {subError}
                  </p>
                )}
                <p className="fsub-consent">
                  We&rsquo;ll only email launch updates. Unsubscribe anytime.
                </p>
              </>
            )}
          </form>
          {/* The two ways in, side by side. "Connect wallet" is the app; the ghost button is the
              Sparky Broker mint whitelist (5,555, staged through OpenSea GTD/FCFS) — the beta
              application that used to live at /apply is gone because the beta is open to all. */}
          <div className="fbtns">
            <button className="fbtn primary" onClick={goConnect}>
              Connect wallet
              <span className="arrow">
                <ArrowOut />
              </span>
            </button>
            {/* No arrow: the circled arrow is styled only for `.fbtn.primary` (a light border for a
                dark fill) and the hero's ghost buttons carry none either. */}
            <button className="fbtn ghost" onClick={goMintWhitelist}>
              Apply for mint whitelist
            </button>
          </div>
        </div>
        <div className="fbot">
          <div className="fine">
            Curated vaults · Robinhood Chain · {stageCopy.adjective}-gated. Not financial advice;
            capital at risk.
          </div>
          <div className="fcopy">© 2026 Sparky — AI-native onchain hedge fund.</div>
        </div>
      </footer>

      {/* bottom-right toasts — stacked so they never overlap */}
      <div className="ne-toasts">
        {/* reduced-motion: offer the full animation */}
        {showMotion && (
          <div className="ne-toast" role="status">
            <button className="ne-toast-x" type="button" aria-label="Dismiss" onClick={dismissMotion}>
              ×
            </button>
            <div className="ne-toast-title">
              <SparkMark size={14} />
              Reduced motion is on
            </div>
            <div className="ne-toast-body">
              This page is animated. For the best experience, turn off reduced motion in your device settings — or play
              it here.
            </div>
            <button className="ne-toast-btn" type="button" onClick={playFullMotion}>
              Play animation
              <ArrowOut />
            </button>
          </div>
        )}
        {/* dark-mode nudge (light mode only, remembered) */}
        {showNudge && theme === "light" && (
          <div className="ne-toast" role="status">
            <button className="ne-toast-x" type="button" aria-label="Dismiss" onClick={() => dismissNudge(false)}>
              ×
            </button>
            <div className="ne-toast-title">
              <SparkMark size={14} />
              Try dark mode
            </div>
            <div className="ne-toast-body">Experience the page the way we designed it.</div>
            <button className="ne-toast-btn" type="button" onClick={() => dismissNudge(true)}>
              Switch to dark
              <ArrowOut />
            </button>
          </div>
        )}
      </div>

      <div id="scroller"></div>
    </div>
  );
}
