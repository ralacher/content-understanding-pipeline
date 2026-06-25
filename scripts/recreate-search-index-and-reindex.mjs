import { CosmosClient } from "@azure/cosmos";
import { AzureCliCredential } from "@azure/identity";

const SEARCH_ENDPOINT = process.env.AI_SEARCH_ENDPOINT;
const SEARCH_INDEX_NAME = process.env.AI_SEARCH_INDEX_NAME || "content-understanding-assets";
const SEARCH_API_VERSION = process.env.AI_SEARCH_API_VERSION || "2024-07-01";
const SEARCH_ADMIN_KEY = process.env.AI_SEARCH_ADMIN_KEY;

const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT;
const COSMOS_DATABASE = process.env.COSMOS_DATABASE || "content-understanding";
const COSMOS_CONTAINER = process.env.COSMOS_CONTAINER || "media-records";

const EMBEDDING_ENDPOINT = process.env.EMBEDDING_ENDPOINT;
const EMBEDDING_DEPLOYMENT = process.env.EMBEDDING_DEPLOYMENT;
const EMBEDDING_API_VERSION = process.env.EMBEDDING_API_VERSION || "2024-05-01-preview";
const EMBEDDING_DIMENSIONS = Number.parseInt(process.env.EMBEDDING_DIMENSIONS || "1536", 10);

if (!SEARCH_ENDPOINT || !SEARCH_ADMIN_KEY) {
  throw new Error("Missing AI Search endpoint/admin key.");
}
if (!COSMOS_ENDPOINT) {
  throw new Error("Missing Cosmos endpoint.");
}
if (!EMBEDDING_ENDPOINT || !EMBEDDING_DEPLOYMENT) {
  throw new Error("Missing embedding endpoint/deployment.");
}

const credential = new AzureCliCredential();

function getSearchHeaders() {
  return {
    "Content-Type": "application/json",
    "api-key": SEARCH_ADMIN_KEY,
  };
}

function isFoundryEndpoint(endpoint) {
  return endpoint.includes("services.ai.azure.com");
}

function getEmbeddingUrl() {
  const base = EMBEDDING_ENDPOINT.replace(/\/$/, "");
  if (isFoundryEndpoint(base)) {
    return `${base}/models/embeddings?api-version=${EMBEDDING_API_VERSION}`;
  }
  return `${base}/openai/deployments/${encodeURIComponent(EMBEDDING_DEPLOYMENT)}/embeddings?api-version=${EMBEDDING_API_VERSION}`;
}

function buildSearchableText(record) {
  return [
    record.fileName,
    record.summary,
    (record.unsafeBehaviors || [])
      .map((item) => [item.description, item.timestamp ? `at ${item.timestamp}` : undefined].filter(Boolean).join(" "))
      .join("\n"),
    record.location,
    record.numberOfPeople !== undefined ? `people ${record.numberOfPeople}` : undefined,
    (record.objectData || []).map((item) => `${item.name}: ${item.description}`).join("\n"),
    (record.trainPassings || []).join("\n"),
    (record.tags || []).join(" "),
    (record.analysisSections || []).map((section) => `${section.title}\n${section.summary}\n${(section.bullets || []).join("\n")}`).join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
}

async function embedText(text) {
  const token = await credential.getToken("https://cognitiveservices.azure.com/.default");
  if (!token?.token) {
    throw new Error("Unable to acquire embedding token.");
  }

  const body = isFoundryEndpoint(EMBEDDING_ENDPOINT)
    ? {
        model: EMBEDDING_DEPLOYMENT,
        input: [text],
        dimensions: EMBEDDING_DIMENSIONS,
      }
    : {
        input: text,
        dimensions: EMBEDDING_DIMENSIONS,
      };

  const response = await fetch(getEmbeddingUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.text().catch(() => "");
    throw new Error(`Embedding failed ${response.status}${payload ? `: ${payload}` : ""}`);
  }

  const payload = await response.json();
  const first = Array.isArray(payload?.data) ? payload.data[0] : undefined;
  const embedding = Array.isArray(first?.embedding)
    ? first.embedding
    : Array.isArray(payload?.embedding)
      ? payload.embedding
      : undefined;

  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Invalid embedding length: ${embedding?.length ?? "none"}`);
  }

  return embedding;
}

async function recreateIndex() {
  const endpoint = `${SEARCH_ENDPOINT.replace(/\/$/, "")}/indexes/${encodeURIComponent(SEARCH_INDEX_NAME)}?api-version=${SEARCH_API_VERSION}`;

  await fetch(endpoint, {
    method: "DELETE",
    headers: getSearchHeaders(),
  });

  const indexDefinition = {
    name: SEARCH_INDEX_NAME,
    fields: [
      { name: "id", type: "Edm.String", key: true, searchable: false, filterable: true, sortable: true },
      { name: "type", type: "Edm.String", searchable: false, filterable: true, sortable: true },
      { name: "fileName", type: "Edm.String", searchable: true, filterable: true, sortable: true, analyzer: "en.microsoft" },
      { name: "status", type: "Edm.String", searchable: false, filterable: true, sortable: true },
      { name: "summary", type: "Edm.String", searchable: true, filterable: false, sortable: false, analyzer: "en.microsoft" },
      { name: "unsafeBehaviorsText", type: "Edm.String", searchable: true, filterable: false, sortable: false, analyzer: "en.microsoft" },
      { name: "numberOfPeople", type: "Edm.Int32", searchable: false, filterable: true, sortable: true },
      { name: "objectDataText", type: "Edm.String", searchable: true, filterable: false, sortable: false, analyzer: "en.microsoft" },
      { name: "trainPassingsText", type: "Edm.String", searchable: true, filterable: false, sortable: false, analyzer: "en.microsoft" },
      { name: "location", type: "Edm.String", searchable: true, filterable: true, sortable: true, analyzer: "en.microsoft" },
      { name: "searchableText", type: "Edm.String", searchable: true, filterable: false, sortable: false, analyzer: "en.microsoft" },
      {
        name: "contentVector",
        type: "Collection(Edm.Single)",
        searchable: true,
        filterable: false,
        sortable: false,
        facetable: false,
        dimensions: EMBEDDING_DIMENSIONS,
        vectorSearchProfileName: "content-vector-profile",
      },
      { name: "createdAt", type: "Edm.DateTimeOffset", searchable: false, filterable: true, sortable: true },
      { name: "updatedAt", type: "Edm.DateTimeOffset", searchable: false, filterable: true, sortable: true },
      { name: "indexedAt", type: "Edm.DateTimeOffset", searchable: false, filterable: true, sortable: true },
      { name: "uploadedByName", type: "Edm.String", searchable: true, filterable: true, sortable: true, analyzer: "en.microsoft" },
    ],
    vectorSearch: {
      algorithms: [
        {
          name: "content-hnsw",
          kind: "hnsw",
          hnswParameters: {
            metric: "cosine",
            m: 4,
            efConstruction: 400,
            efSearch: 500,
          },
        },
      ],
      profiles: [
        {
          name: "content-vector-profile",
          algorithmConfigurationName: "content-hnsw",
        },
      ],
    },
  };

  const createResponse = await fetch(endpoint, {
    method: "PUT",
    headers: getSearchHeaders(),
    body: JSON.stringify(indexDefinition),
  });

  if (!createResponse.ok) {
    const payload = await createResponse.text().catch(() => "");
    throw new Error(`Index create failed ${createResponse.status}${payload ? `: ${payload}` : ""}`);
  }
}

async function fetchCompletedRecords() {
  const cosmos = new CosmosClient({
    endpoint: COSMOS_ENDPOINT,
    aadCredentials: credential,
  });

  const container = cosmos.database(COSMOS_DATABASE).container(COSMOS_CONTAINER);
  const { resources } = await container.items
    .query({
      query: "SELECT * FROM c WHERE c.type = @type AND c.status = @status ORDER BY c.createdAt DESC",
      parameters: [
        { name: "@type", value: "mediaRecord" },
        { name: "@status", value: "completed" },
      ],
    })
    .fetchAll();

  return resources;
}

async function uploadDocuments(documents) {
  if (documents.length === 0) return;

  const endpoint = `${SEARCH_ENDPOINT.replace(/\/$/, "")}/indexes/${encodeURIComponent(SEARCH_INDEX_NAME)}/docs/index?api-version=${SEARCH_API_VERSION}`;

  for (let i = 0; i < documents.length; i += 100) {
    const chunk = documents.slice(i, i + 100);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: getSearchHeaders(),
      body: JSON.stringify({
        value: chunk.map((d) => ({ "@search.action": "mergeOrUpload", ...d })),
      }),
    });

    if (!response.ok) {
      const payload = await response.text().catch(() => "");
      throw new Error(`Index upload failed ${response.status}${payload ? `: ${payload}` : ""}`);
    }

    const payload = await response.json();
    const failed = (payload?.value || []).filter((v) => v?.status === false);
    if (failed.length > 0) {
      throw new Error(`Index upload had ${failed.length} failed documents.`);
    }

    console.log(`Indexed ${Math.min(i + chunk.length, documents.length)} / ${documents.length}`);
  }
}

async function main() {
  console.log("Recreating AI Search index...");
  await recreateIndex();

  console.log("Loading completed records from Cosmos...");
  const records = await fetchCompletedRecords();
  console.log(`Found ${records.length} completed records.`);

  const documents = [];
  for (const record of records) {
    const searchableText = buildSearchableText(record);
    const embedding = await embedText(searchableText.slice(0, 12000));

    const objectDataText = (record.objectData || []).map((item) => `${item.name}: ${item.description}`).join("\n");
    const trainPassingsText = (record.trainPassings || []).join("\n");
    const unsafeBehaviorsText = (record.unsafeBehaviors || [])
      .map((item) => [item.description, item.timestamp ? `at ${item.timestamp}` : undefined].filter(Boolean).join(" "))
      .join("\n");

    documents.push({
      id: record.id,
      type: "mediaRecordSearchDocument",
      fileName: record.fileName,
      status: record.status,
      summary: record.summary,
      unsafeBehaviorsText: unsafeBehaviorsText || undefined,
      numberOfPeople: record.numberOfPeople,
      objectDataText: objectDataText || undefined,
      trainPassingsText: trainPassingsText || undefined,
      location: record.location,
      searchableText,
      contentVector: embedding,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      indexedAt: record.indexedAt,
      uploadedByName: record.uploadedBy?.name || "unknown",
    });
  }

  console.log("Uploading reindexed documents...");
  await uploadDocuments(documents);
  console.log("Done. Index recreated and reindexed successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
