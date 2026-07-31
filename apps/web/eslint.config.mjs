import nextConfig from "@prism/tooling-config/eslint/next";

const config = nextConfig.prepend({
  name: "prism/web-ignores",
  ignores: ["app/prototype/**", "next-env.d.ts"],
});

export default config;
