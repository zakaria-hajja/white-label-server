import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const jwtSecret = "test-jwt-secret-test-jwt-secret-0123456789";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration-shared",
          include: ["tests/integration/**/*.test.ts"],
          fileParallelism: false,
          env: {
            DEPLOYMENT_MODE: "shared",
            DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/whitelabel_test_shared",
            JWT_SECRET: jwtSecret,
          },
        },
      },
      {
        extends: true,
        test: {
          name: "integration-dedicated",
          include: ["tests/integration/**/*.test.ts"],
          fileParallelism: false,
          env: {
            DEPLOYMENT_MODE: "dedicated",
            DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/whitelabel_test_dedicated",
            DEDICATED_TENANT_SLUG: "acme",
            JWT_SECRET: jwtSecret,
          },
        },
      },
    ],
  },
});
