import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig keeps JSX for Next ("preserve"); tests need it compiled with React's automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    // fileURLToPath, not URL.pathname: the checkout path may contain spaces.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    // DB tests share one database, so test files run one at a time.
    fileParallelism: false,
  },
});
