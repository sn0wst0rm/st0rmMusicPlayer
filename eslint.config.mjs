import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma generated files:
    "src/generated/**",
  ]),
  // Custom rules
  {
    rules: {
      // Disabled: We use <img> for dynamically served cover art from /api/cover/
      // which is already optimized via Sharp with size variants (small/medium/large)
      "@next/next/no-img-element": "off",
      // Allow setState in effects for intentional patterns like modal reset, color extraction
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
