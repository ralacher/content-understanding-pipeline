export interface RuntimeConfig {
  app: {
    baseUrl: string;
    title: string;
  };
  auth: {
    clientId?: string;
    clientSecret?: string;
    tenantId?: string;
    sessionSecret?: string;
  };
  storage: {
    accountUrl?: string;
    uploadContainer?: string;
    processedContainer?: string;
    queueName?: string;
    enqueueOnUpload: boolean;
  };
  cosmos: {
    endpoint?: string;
    database?: string;
    container?: string;
  };
  contentUnderstanding: {
    analyzerUrl?: string;
    scope: string;
  };
  aiSearch: {
    endpoint?: string;
    indexName: string;
    apiVersion: string;
  };
  embeddings: {
    endpoint?: string;
    deployment: string;
    apiVersion: string;
    dimensions: number;
    scope: string;
  };
}

let cachedConfig: RuntimeConfig | undefined;

export function getRuntimeConfig(): RuntimeConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = {
    app: {
      baseUrl: process.env.NEXT_PUBLIC_APP_BASE_URL || process.env.APP_BASE_URL || "http://localhost:3000",
      title: process.env.NEXT_PUBLIC_APP_TITLE || "Content Understanding Hub",
    },
    auth: {
      clientId: process.env.ENTRA_ID_CLIENT_ID,
      clientSecret: process.env.ENTRA_ID_CLIENT_SECRET,
      tenantId: process.env.ENTRA_ID_TENANT_ID,
      sessionSecret: process.env.AUTH_SESSION_SECRET,
    },
    storage: {
      accountUrl: process.env.AZURE_STORAGE_ACCOUNT_URL,
      uploadContainer: process.env.AZURE_STORAGE_UPLOAD_CONTAINER || "incoming-avi",
      processedContainer: process.env.AZURE_STORAGE_PROCESSED_CONTAINER || "processed-mp4",
      queueName: process.env.AZURE_STORAGE_QUEUE_NAME || "video-processing",
      enqueueOnUpload: process.env.UPLOAD_WRITE_QUEUE_MESSAGE === "true",
    },
    cosmos: {
      endpoint: process.env.AZURE_COSMOS_ENDPOINT,
      database: process.env.AZURE_COSMOS_DATABASE || "content-understanding",
      container: process.env.AZURE_COSMOS_CONTAINER || "media-records",
    },
    contentUnderstanding: {
      analyzerUrl: process.env.CONTENT_UNDERSTANDING_ANALYZER_URL,
      scope: process.env.CONTENT_UNDERSTANDING_SCOPE || "https://cognitiveservices.azure.com/.default",
    },
    aiSearch: {
      endpoint: process.env.AZURE_AI_SEARCH_ENDPOINT,
      indexName: process.env.AZURE_AI_SEARCH_INDEX_NAME || "content-understanding-assets",
      apiVersion: process.env.AZURE_AI_SEARCH_API_VERSION || "2024-07-01",
    },
    embeddings: {
      endpoint: process.env.AZURE_FOUNDRY_ENDPOINT,
      deployment: process.env.AZURE_FOUNDRY_EMBEDDING_DEPLOYMENT || "text-embedding-3-large",
      apiVersion: process.env.AZURE_FOUNDRY_EMBEDDING_API_VERSION || "2024-05-01-preview",
      dimensions: Number.parseInt(process.env.AZURE_FOUNDRY_EMBEDDING_DIMENSIONS || "1536", 10),
      scope: process.env.AZURE_FOUNDRY_EMBEDDING_SCOPE || "https://cognitiveservices.azure.com/.default",
    },
  };

  return cachedConfig;
}

export function isAuthConfigured(): boolean {
  const config = getRuntimeConfig();
  return Boolean(
    config.auth.clientId &&
      config.auth.clientSecret &&
      config.auth.tenantId &&
      config.auth.sessionSecret,
  );
}

export function isCloudConfigured(): boolean {
  const config = getRuntimeConfig();
  return Boolean(
    config.storage.accountUrl &&
      config.storage.uploadContainer &&
      config.storage.processedContainer &&
      config.cosmos.endpoint &&
      config.cosmos.database &&
      config.cosmos.container,
  );
}

export function isAiSearchConfigured(): boolean {
  const config = getRuntimeConfig();
  return Boolean(config.aiSearch.endpoint && config.aiSearch.indexName && config.embeddings.endpoint);
}
