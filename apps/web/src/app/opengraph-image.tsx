import { ImageResponse } from "next/og";

// Generic social-share image (auto-wired to og:image + twitter:image by Next).
export const alt = "Sparky — AI-Native Onchain Hedge Fund";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><clipPath id="c" clipPathUnits="userSpaceOnUse"><rect x="-30" y="-17" width="60" height="34" rx="14" transform="translate(57 60) skewX(-20)"/></clipPath><rect x="-30" y="-17" width="60" height="34" rx="14" transform="translate(43 40) skewX(-20)" fill="#F47B3F"/><rect x="-30" y="-17" width="60" height="34" rx="14" transform="translate(57 60) skewX(-20)" fill="#4577E6"/><g clip-path="url(#c)"><rect x="-30" y="-17" width="60" height="34" rx="14" transform="translate(43 40) skewX(-20)" fill="#F2C400"/></g></svg>`;
const LOGO_URL = `data:image/svg+xml,${encodeURIComponent(LOGO)}`;

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
        <img src={LOGO_URL} width={132} height={132} alt="" />
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
          Fully self-custodial · AI DeFi assistant + Aave Yield Vault on Base
        </div>
      </div>
    ),
    { ...size },
  );
}
