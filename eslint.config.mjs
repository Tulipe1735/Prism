import antfu from "@antfu/eslint-config";

export default antfu(
  {
    type: "lib",
    stylistic: false,
    typescript: true,
    jsonc: false,
    markdown: false,
    toml: false,
    yaml: false,
    ignores: ["coverage/**", "dist/**", "fixtures/**", "src/browser/snapshot.js"],
  },
  {
    name: "prism/typescript",
    files: ["**/*.ts"],
    rules: {
      "no-console": "off",
      "test/prefer-lowercase-title": "off",
      "ts/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    },
  },
);
