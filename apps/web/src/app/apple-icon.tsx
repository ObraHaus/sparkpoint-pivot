import { ImageResponse } from "next/og";
import { readFileSync } from "fs";
import { join } from "path";

// iOS home-screen icon — the real Sparky logo on the brand near-black field.
export const runtime = "nodejs";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const LOGO =
  "data:image/png;base64," +
  readFileSync(join(process.cwd(), "src/assets/brand/sparky-logo.png")).toString("base64");

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#080C17",
        }}
      >
        <img src={LOGO} width={140} height={140} alt="" />
      </div>
    ),
    { ...size },
  );
}
