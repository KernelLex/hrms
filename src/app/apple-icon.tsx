import { ImageResponse } from "next/og";

/** The home-screen icon on iPhone and iPad, which rounds the corners itself. */

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

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
          background: "#171717",
          color: "#ffffff",
          fontSize: 100,
          fontWeight: 600,
          fontFamily: "sans-serif",
        }}
      >
        H
      </div>
    ),
    size,
  );
}
