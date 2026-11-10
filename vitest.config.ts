import { defineConfig } from "vitest/config";

const jwtSecret = "test-jwt-secret-test-jwt-secret-0123456789";

export default defineConfig({
  resolve: { tsconfigPaths: true },
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
          // Plain *.test.ts under tests/integration runs in shared mode only;
          // mode-specific files use the *.dedicated.test.ts suffix.
          include: ["tests/integration/**/*.test.ts"],
          exclude: ["**/node_modules/**", "tests/integration/**/*.dedicated.test.ts"],
          globalSetup: ["tests/setup/migrate.ts"],
          setupFiles: ["tests/setup/integration.ts"],
          fileParallelism: false,
          testTimeout: 20000,
          hookTimeout: 20000,
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
          include: ["tests/integration/**/*.dedicated.test.ts"],
          globalSetup: ["tests/setup/migrate.ts"],
          setupFiles: ["tests/setup/integration.ts"],
          fileParallelism: false,
          testTimeout: 20000,
          hookTimeout: 20000,
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
