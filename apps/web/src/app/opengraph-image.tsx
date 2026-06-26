import { ImageResponse } from "next/og";

// Generic social-share image (auto-wired to og:image + twitter:image by Next).
export const alt = "SparkPoint — AI-Native Onchain Hedge Fund";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const SPARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="s" x1="3" y1="2" x2="21" y2="22" gradientUnits="userSpaceOnUse"><stop stop-color="#FF5A36"/><stop offset=".5" stop-color="#FF8A4C"/><stop offset="1" stop-color="#4D83FF"/></linearGradient></defs><path d="M12 1c.6 5.4 2.6 7.4 8 8-5.4.6-7.4 2.6-8 8-.6-5.4-2.6-7.4-8-8 5.4-.6 7.4-2.6 8-8Z" fill="url(#s)"/></svg>`;
const SPARK_URL = `data:image/svg+xml,${encodeURIComponent(SPARK)}`;

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
        <img src={SPARK_URL} width={96} height={96} alt="" />
        <div
          style={{
            display: "flex",
            fontSize: 80,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            marginTop: 34,
          }}
        >
          SparkPoint
        </div>
        <div style={{ display: "flex", fontSize: 34, color: "#8C98AE", marginTop: 16 }}>
          The First AI-Native Onchain Hedge Fund
        </div>
        <div style={{ display: "flex", fontSize: 23, color: "#8C98AE", marginTop: 44 }}>
          Fully self-custodial · AI DeFi assistant + Aave Yield Vault on Base
        </div>
      </div>
    ),
    { ...size },
  );
}
