import type { NextConfig } from "next";

/**
 * Next.js 配置。
 *
 * - serverExternalPackages：把含原生依赖/Node 侧 API 的包（Playwright 相关）
 *   排除在 Next 的打包外，服务端直接 require；
 * - transpilePackages：让 workspace 内以 TS 源码发布的包被 Next 转译；
 * - webpack：服务端构建时把 playwright-core 标记为 CommonJS external，
 *   避免服务端重复打包该重量级依赖。
 */
const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@prism/action-broker",
    "@prism/runtime-ui-tars",
    "playwright-core",
  ],
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
