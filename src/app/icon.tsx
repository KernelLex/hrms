import { ImageResponse } from "next/og";

/**
 * The app icon: the brand mark (§8.17), an ink square with a white H, at
 * the sizes phones ask for. The maskable one leaves the safe zone Android
 * crops to, so the H is never cut.
 */

export function generateImageMetadata() {
  return [
    { id: "192", size: { width: 192, height: 192 }, contentType: "image/png" },
    { id: "512", size: { width: 512, height: 512 }, contentType: "image/png" },
    { id: "maskable", size: { width: 512, height: 512 }, contentType: "image/png" },
  ];
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const which = String(await id);
  const size = which === "192" ? 192 : 512;
  const maskable = which === "maskable";
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
          borderRadius: maskable ? 0 : size * 0.22,
          color: "#ffffff",
          fontSize: size * (maskable ? 0.4 : 0.56),
          fontWeight: 600,
          fontFamily: "sans-serif",
        }}
      >
        H
      </div>
    ),
    { width: size, height: size },
  );
}
