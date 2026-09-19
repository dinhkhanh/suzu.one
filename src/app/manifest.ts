import type { MetadataRoute } from "next";

// The web app manifest: what makes Suzu One installable on a phone's home screen (SRS A5, NFR-UX-01).
// It opens on the check-in screen, because that is what people open it for every morning.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Suzu One",
    short_name: "Suzu One",
    description: "Suzu Group — chấm công, nghỉ phép, phê duyệt và công việc hằng ngày.",
    lang: "vi",
    start_url: "/attendance/check-in",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#171717",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Chấm công", url: "/attendance/check-in", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Xin nghỉ phép", url: "/leave/new" },
      { name: "Phê duyệt", url: "/approvals" },
    ],
  };
}
