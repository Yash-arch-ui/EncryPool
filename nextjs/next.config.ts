import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // The pooltogether.com layout port serves its section backgrounds and card
  // art as local SVGs through next/image; the optimizer needs this opt-in.
  images: {
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  typescript: {
    ignoreBuildErrors: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  eslint: {
    ignoreDuringBuilds: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  webpack: config => {
    config.externals.push("pino-pretty", "lokijs", "encoding");

    // MetaMask SDK bundles a React Native async-storage import that only
    // makes sense inside RN.  Stub it out so the Next.js browser build
    // doesn't blow up with "Module not found".
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false as unknown as string,
    };

    return config;
  },
};

const isIpfs = process.env.NEXT_PUBLIC_IPFS_BUILD === "true";

if (isIpfs) {
  nextConfig.output = "export";
  nextConfig.trailingSlash = true;
  nextConfig.images = {
    ...nextConfig.images,
    unoptimized: true,
  };
}

module.exports = nextConfig;
