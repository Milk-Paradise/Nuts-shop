import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    dangerouslyAllowLocalIP:
      process.env.CATALOG_IMAGE_HOST === "localhost" &&
      process.env.NODE_ENV === "development",
    remotePatterns: [
      { protocol: "https", hostname: "11centov.ru" },
      { protocol: "https", hostname: "store.storeimages.cdn-apple.com" },
      ...(process.env.CATALOG_IMAGE_HOST
        ? [
            {
              protocol:
                process.env.CATALOG_IMAGE_PROTOCOL === "http"
                  ? ("http" as const)
                  : ("https" as const),
              hostname: process.env.CATALOG_IMAGE_HOST,
              port: process.env.CATALOG_IMAGE_PORT || "",
              pathname:
                process.env.CATALOG_IMAGE_HOST === "localhost"
                  ? "/static/**"
                  : "/**",
            },
          ]
        : []),
    ],
  },
};
export default config;
