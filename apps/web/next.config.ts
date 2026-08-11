import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@attatta/shared", "@attatta/remotion-template"],
  reactStrictMode: true,
  // Workspace packages use NodeNext-style ".js" imports that map to ".ts" sources.
  // Webpack does not rewrite those; alias so transpilePackages can resolve them.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
