import { ImageResponse } from "next/og";
import { readFileSync } from "fs";
import { join } from "path";

// Generic social-share image (auto-wired to og:image + twitter:image by Next).
export const runtime = "nodejs";
export const alt = "Sparky — AI-Native Onchain Hedge Fund";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LOGO =
  "data:image/png;base64," +
  readFileSync(join(process.cwd(), "src/assets/brand/sparky-logo.png")).toString("base64");

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "90px",
          background: "#080C17",
          color: "#EAEEF7",
        }}
      >
        <img src={LOGO} width={150} height={150} alt="" />
        <div
          style={{
            display: "flex",
            fontSize: 80,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            marginTop: 28,
          }}
        >
          Sparky
        </div>
        <div style={{ display: "flex", fontSize: 34, color: "#8C98AE", marginTop: 16 }}>
          The First AI-Native Onchain Hedge Fund
        </div>
        <div style={{ display: "flex", fontSize: 23, color: "#8C98AE", marginTop: 44 }}>
          Fully self-custodial · AI DeFi assistant
        </div>
      </div>
    ),
    { ...size },
  );
}
