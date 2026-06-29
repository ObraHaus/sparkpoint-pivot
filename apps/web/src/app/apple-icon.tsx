import { ImageResponse } from "next/og";

// Generic iOS home-screen icon — the Sparky logo on the brand near-black field.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><clipPath id="c" clipPathUnits="userSpaceOnUse"><rect x="-30" y="-17" width="60" height="34" rx="14" transform="translate(57 60) skewX(-20)"/></clipPath><rect x="-30" y="-17" width="60" height="34" rx="14" transform="translate(43 40) skewX(-20)" fill="#F47B3F"/><rect x="-30" y="-17" width="60" height="34" rx="14" transform="translate(57 60) skewX(-20)" fill="#4577E6"/><g clip-path="url(#c)"><rect x="-30" y="-17" width="60" height="34" rx="14" transform="translate(43 40) skewX(-20)" fill="#F2C400"/></g></svg>`;
const LOGO_URL = `data:image/svg+xml,${encodeURIComponent(LOGO)}`;

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
        <img src={LOGO_URL} width={132} height={132} alt="" />
      </div>
    ),
    { ...size },
  );
}
