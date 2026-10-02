// The kiosk's own web manifest (FR-ATT-06): added to a tablet's home screen, the kiosk opens at
// /kiosk with no browser bars at all. The app's manifest would open the app instead, and name it.
export function GET() {
  return Response.json(
    {
      name: "SuZu check-in",
      short_name: "Check-in",
      start_url: "/kiosk",
      scope: "/kiosk",
      display: "fullscreen",
      display_override: ["fullscreen", "standalone"],
      background_color: "#000000",
      theme_color: "#000000",
      icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    },
    { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } },
  );
}
