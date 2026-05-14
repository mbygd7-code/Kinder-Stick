import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["__tests__/**/*.spec.ts"],
    // adapt.spec.ts 는 vitest 형식이 아닌 tsx-runner 스크립트 — 제외.
    // 그 파일은 `npx tsx __tests__/adapt.spec.ts` 로 직접 실행.
    exclude: ["__tests__/adapt.spec.ts", "node_modules/**"],
    globals: false,
  },
});
