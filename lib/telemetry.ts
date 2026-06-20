import appInsights from "applicationinsights";

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

  appInsights
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

  if (appInsights.defaultClient) {
    appInsights.defaultClient.context.tags[appInsights.defaultClient.context.keys.cloudRole] =
      process.env.APPLICATIONINSIGHTS_ROLE_NAME || defaultRoleName;
  }

  globalThis.__contentUnderstandingTelemetryInitialized = true;
}
