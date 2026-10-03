import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AgentLedger",
    short_name: "AgentLedger",
    description: "Agents propose. Policies decide. Humans stay in control.",
    start_url: "/dashboard/approvals",
    display: "standalone",
    background_color: "#EFEFEF",
    theme_color: "#0000FF",
    icons: [
      {
        src: "/globe.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
