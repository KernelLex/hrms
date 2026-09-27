import type { MetadataRoute } from "next";

/**
 * What makes HRMS installable: added to a phone's home screen it opens full
 * screen, like an app. Icons come from `icon.tsx`; `public/sw.js` keeps the
 * app's code — never anyone's data — for a quick start.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HRMS",
    short_name: "HRMS",
    description: "Your leave, payslips, tax and profile — and, for HR, the whole back office.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fafafa",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
