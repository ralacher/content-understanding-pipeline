import * as appInsights from "applicationinsights";

declare global {
  var __contentUnderstandingTelemetryInitialized: boolean | undefined;
}

export function initializeTelemetry(defaultRoleName: string): void {
  if (globalThis.__contentUnderstandingTelemetryInitialized) {
    return;
  }

  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) {
    return;
  }

  const sdk = (appInsights as unknown as { default?: typeof appInsights }).default ?? appInsights;

  if (typeof (sdk as { setup?: unknown }).setup !== "function") {
    console.warn("Application Insights SDK is installed but does not expose setup(); telemetry disabled.");
    return;
  }

  sdk
    .setup(connectionString)
    .setAutoDependencyCorrelation(true)
    .setAutoCollectRequests(true)
    .setAutoCollectPerformance(true, true)
    .setAutoCollectExceptions(true)
    .setAutoCollectDependencies(true)
    .setAutoCollectConsole(true, true)
    .setUseDiskRetryCaching(true)
    .setInternalLogging(false, false)
    .start();

  if (sdk.defaultClient) {
    sdk.defaultClient.context.tags[sdk.defaultClient.context.keys.cloudRole] =
      process.env.APPLICATIONINSIGHTS_ROLE_NAME || defaultRoleName;
  }

  globalThis.__contentUnderstandingTelemetryInitialized = true;
}
