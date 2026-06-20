export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { initializeTelemetry } = await import("./lib/telemetry");
  initializeTelemetry(process.env.APPLICATIONINSIGHTS_ROLE_NAME || "frontend-api");
}
