import { getContainer } from "./core/container";

/** Node-only startup checks; exits the process on invalid configuration. */
export function validateStartup(): void {
  try {
    getContainer(); // validates configuration; Task 6 adds the dedicated tenant check
  } catch (err) {
    console.error("Startup failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
