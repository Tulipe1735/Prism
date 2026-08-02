import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@prism/contracts", "@prism/workspace-executor"],
};

export default nextConfig;
