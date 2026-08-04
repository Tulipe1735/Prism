import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prism/action-broker", "playwright-core"],
  transpilePackages: [
    "@prism/contracts",
    "@prism/orchestrator",
    "@prism/workspace-executor",
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        ...(config.externals ?? []),
        { "playwright-core": "commonjs playwright-core" },
      ];
    }

    return config;
  },
};

export default nextConfig;
