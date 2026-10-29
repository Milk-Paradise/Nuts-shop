import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "11centov.ru" },
      { protocol: "https", hostname: "store.storeimages.cdn-apple.com" },
      ...(process.env.CATALOG_IMAGE_HOST
        ? [
            {
              protocol: "https" as const,
              hostname: process.env.CATALOG_IMAGE_HOST,
            },
          ]
        : []),
    ],
  },
};
export default config;
