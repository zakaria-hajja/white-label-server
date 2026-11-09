export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateStartup } = await import("./instrumentation-node");
    validateStartup();
  }
}
