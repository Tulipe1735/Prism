import nextConfig from "@prism/tooling-config/eslint/next";

const config = [
  {
    ignores: ["app/prototype/**", "next-env.d.ts"],
  },
  ...nextConfig,
];

export default config;
