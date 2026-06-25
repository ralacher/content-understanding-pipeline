import { DefaultAzureCredential, ManagedIdentityCredential } from "@azure/identity";

function isManagedIdentityRuntime(): boolean {
  return Boolean(
    process.env.IDENTITY_ENDPOINT ||
      process.env.MSI_ENDPOINT ||
      process.env.CONTAINER_APP_NAME ||
      process.env.WEBSITE_SITE_NAME,
  );
}

export function getTokenCredential() {
  const managedIdentityClientId = process.env.AZURE_CLIENT_ID;

  if (isManagedIdentityRuntime()) {
    return managedIdentityClientId
      ? new ManagedIdentityCredential(managedIdentityClientId)
      : new ManagedIdentityCredential();
  }

  return new DefaultAzureCredential();
}
