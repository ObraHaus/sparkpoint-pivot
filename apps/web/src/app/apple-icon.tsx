import { ImageResponse } from "next/og";

// Generic iOS home-screen icon — SparkPoint spark on the brand near-black field.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const SPARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="s" x1="3" y1="2" x2="21" y2="22" gradientUnits="userSpaceOnUse"><stop stop-color="#FF5A36"/><stop offset=".5" stop-color="#FF8A4C"/><stop offset="1" stop-color="#4D83FF"/></linearGradient></defs><path d="M12 1c.6 5.4 2.6 7.4 8 8-5.4.6-7.4 2.6-8 8-.6-5.4-2.6-7.4-8-8 5.4-.6 7.4-2.6 8-8Z" fill="url(#s)"/></svg>`;
const SPARK_URL = `data:image/svg+xml,${encodeURIComponent(SPARK)}`;

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
        <img src={SPARK_URL} width={120} height={120} alt="" />
      </div>
    ),
    { ...size },
  );
}
