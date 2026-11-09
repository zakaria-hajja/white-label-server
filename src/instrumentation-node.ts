import { getContainer } from "./core/container";

/** Node-only startup checks; exits the process on invalid configuration or tenant. */
export async function validateStartup(): Promise<void> {
  try {
    const container = getContainer(); // validates configuration
    if (container.config.mode === "dedicated") await container.tenantResolver.verifyStartup();
  } catch (err) {
    console.error("Startup failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
