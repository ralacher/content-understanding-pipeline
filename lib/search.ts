import { getTokenCredential } from "./credential";
import { getRuntimeConfig, isAiSearchConfigured } from "./config";
import { MediaRecord } from "./domain";
import { getMediaRecord, listMediaRecords } from "./storage";

type SearchHit = {
  id: string;
  score?: number;
};

export type NeverMissClass = "weapon" | "fight" | "push";

const NEVER_MISS_EXPANSIONS: Record<NeverMissClass, string[]> = {
  weapon: ["weapon", "knife", "gun", "firearm", "blade", "machete", "pistol", "rifle"],
  fight: ["fight", "fighting", "assault", "altercation", "brawl", "scuffle", "attack"],
  push: [
    "push",
    "pushed",
    "pushing",
    "shove",
    "shoved",
    "force",
    "forced",
    "knocked",
    "fall",
    "falls",
    "falling",
    "fell",
    "slip",
    "slipped",
    "trip",
    "tripped",
    "stumble",
    "stumbled",
  ],
};

type SearchDocument = {
  id: string;
  type: "mediaRecordSearchDocument";
  fileName: string;
  status: MediaRecord["status"];
  summary: string;
  tags: string[];
  unsafeBehaviorsText?: string;
  numberOfPeople?: number;
  objectDataText?: string;
  trainPassingsText?: string;
  location?: string;
  searchableText: string;
  contentVector: number[];
  createdAt: string;
  updatedAt: string;
  indexedAt?: string;
  uploadedByName: string;
};

declare global {
  var __contentUnderstandingSearchIndexEnsured: Set<string> | undefined;
}

function getBearerToken(token: string): string {
  return `Bearer ${token}`;
}

function getSearchBaseUrl(): string {
  const config = getRuntimeConfig();
  if (!config.aiSearch.endpoint) {
    throw new Error("AI Search endpoint is not configured.");
  }

  return config.aiSearch.endpoint.replace(/\/$/, "");
}

function getSearchDocumentUrl(path: string): string {
  const config = getRuntimeConfig();
  return `${getSearchBaseUrl()}${path}?api-version=${config.aiSearch.apiVersion}`;
}

function isFoundryEndpoint(endpoint: string): boolean {
  return endpoint.includes("services.ai.azure.com");
}

function getEmbeddingUrl(): string {
  const config = getRuntimeConfig();
  if (!config.embeddings.endpoint) {
    throw new Error("Embedding endpoint is not configured.");
  }

  const baseUrl = config.embeddings.endpoint.replace(/\/$/, "");

  if (isFoundryEndpoint(baseUrl)) {
    return `${baseUrl}/models/embeddings?api-version=${config.embeddings.apiVersion}`;
  }

  return `${baseUrl}/openai/deployments/${encodeURIComponent(config.embeddings.deployment)}/embeddings?api-version=${config.embeddings.apiVersion}`;
}

function getEmbeddingTokenScopes(): string[] {
  const configuredScope = getRuntimeConfig().embeddings.scope;
  return Array.from(
    new Set([
      configuredScope,
      "https://ai.azure.com/.default",
      "https://cognitiveservices.azure.com/.default",
    ].filter(Boolean)),
  );
}

function recordToSearchDocument(record: MediaRecord, embedding: number[]): SearchDocument {
  const objectDataText = (record.objectData || [])
    .map((item) => `${item.name}: ${item.description}`)
    .join("\n");
  const trainPassingsText = (record.trainPassings || []).join("\n");
  const unsafeBehaviorsText = (record.unsafeBehaviors || [])
    .map((item) => [item.description, item.timestamp ? `at ${item.timestamp}` : undefined].filter(Boolean).join(" "))
    .join("\n");
  const searchableText = [
    record.fileName,
    record.summary,
    unsafeBehaviorsText,
    record.location,
    record.numberOfPeople !== undefined ? `people detected ${record.numberOfPeople}` : undefined,
    objectDataText,
    trainPassingsText,
    record.tags.join(" "),
    record.analysisSections.map((section) => `${section.title}\n${section.summary}\n${section.bullets.join(" \n")}`).join("\n"),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");

  return {
    id: record.id,
    type: "mediaRecordSearchDocument",
    fileName: record.fileName,
    status: record.status,
    summary: record.summary,
    tags: record.tags,
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
    uploadedByName: record.uploadedBy.name,
  };
}

function getIndexDefinition() {
  const config = getRuntimeConfig();

  return {
    name: config.aiSearch.indexName,
    fields: [
      { name: "id", type: "Edm.String", key: true, searchable: false, filterable: true, sortable: true },
      { name: "type", type: "Edm.String", searchable: false, filterable: true, sortable: true },
      { name: "fileName", type: "Edm.String", searchable: true, filterable: true, sortable: true, analyzer: "en.microsoft" },
      { name: "status", type: "Edm.String", searchable: false, filterable: true, sortable: true },
      { name: "summary", type: "Edm.String", searchable: true, filterable: false, sortable: false, analyzer: "en.microsoft" },
      { name: "tags", type: "Collection(Edm.String)", searchable: true, filterable: true, facetable: true },
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
        dimensions: config.embeddings.dimensions,
        vectorSearchProfile: "content-vector-profile",
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
          algorithm: "content-hnsw",
        },
      ],
    },
  };
}

async function ensureSearchIndex(): Promise<void> {
  const config = getRuntimeConfig();
  if (!isAiSearchConfigured()) {
    return;
  }

  const ensured =
    globalThis.__contentUnderstandingSearchIndexEnsured ||
    (globalThis.__contentUnderstandingSearchIndexEnsured = new Set<string>());

  if (ensured.has(config.aiSearch.indexName)) {
    return;
  }

  const credential = getTokenCredential();
  const token = await credential.getToken("https://search.azure.com/.default");

  if (!token?.token) {
    throw new Error("Unable to acquire an access token for Azure AI Search.");
  }

  const indexUrl = getSearchDocumentUrl(`/indexes/${encodeURIComponent(config.aiSearch.indexName)}`);
  const lookupResponse = await fetch(indexUrl, {
    headers: {
      Authorization: getBearerToken(token.token),
      "Content-Type": "application/json",
    },
  });

  if (lookupResponse.ok) {
    ensured.add(config.aiSearch.indexName);
    return;
  }

  if (lookupResponse.status !== 404) {
    const payload = await lookupResponse.text().catch(() => "");
    throw new Error(`AI Search index lookup failed with ${lookupResponse.status}${payload ? `: ${payload}` : "."}`);
  }

  const createResponse = await fetch(indexUrl, {
    method: "PUT",
    headers: {
      Authorization: getBearerToken(token.token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(getIndexDefinition()),
  });

  if (!createResponse.ok) {
    const payload = await createResponse.text().catch(() => "");
    throw new Error(`AI Search index create failed with ${createResponse.status}${payload ? `: ${payload}` : "."}`);
  }

  ensured.add(config.aiSearch.indexName);
}

async function embedText(text: string): Promise<number[]> {
  const credential = getTokenCredential();
  const scopes = getEmbeddingTokenScopes();
  const config = getRuntimeConfig();
  const isFoundry = config.embeddings.endpoint ? isFoundryEndpoint(config.embeddings.endpoint) : false;
  let lastError: string | undefined;

  for (const scope of scopes) {
    const token = await credential.getToken(scope);
    if (!token?.token) {
      lastError = `Unable to acquire an access token for embeddings using scope ${scope}.`;
      continue;
    }

    const requestBody = isFoundry
      ? JSON.stringify({
          model: config.embeddings.deployment,
          input: [text],
          dimensions: config.embeddings.dimensions,
        })
      : JSON.stringify({
          input: text,
          dimensions: config.embeddings.dimensions,
        });

    const response = await fetch(getEmbeddingUrl(), {
      method: "POST",
      headers: {
        Authorization: getBearerToken(token.token),
        "Content-Type": "application/json",
      },
      body: requestBody,
    });

    if (response.status === 401) {
      const payload = await response.text().catch(() => "");
      lastError = `Embedding request failed with 401 for scope ${scope}${payload ? `: ${payload}` : "."}`;
      continue;
    }

    if (!response.ok) {
      const payload = await response.text().catch(() => "");
      throw new Error(`Embedding request failed with ${response.status}${payload ? `: ${payload}` : "."}`);
    }

    const payload = (await response.json()) as {
      data?: unknown;
      embedding?: unknown;
    };

    let embedding: number[] | undefined;

    if (Array.isArray(payload.data)) {
      // Azure OpenAI and many Foundry responses: { data: [{ embedding: number[] }] }
      const firstItem = payload.data[0];
      if (
        firstItem &&
        typeof firstItem === "object" &&
        Array.isArray((firstItem as { embedding?: unknown }).embedding)
      ) {
        embedding = (firstItem as { embedding: number[] }).embedding;
      } else if (payload.data.every((item) => typeof item === "number")) {
        // Some endpoints may return { data: number[] }
        embedding = payload.data as number[];
      }
    }

    if (!embedding && Array.isArray(payload.embedding)) {
      // Fallback for endpoints that return { embedding: number[] }
      embedding = payload.embedding as number[];
    }

    if (!Array.isArray(embedding) || embedding.length === 0 || !embedding.every((item) => typeof item === "number")) {
      throw new Error("Embedding response did not contain a vector.");
    }

    if (embedding.length !== config.embeddings.dimensions) {
      throw new Error(
        `Embedding response had length ${embedding.length}, expected ${config.embeddings.dimensions}. ` +
          `Check AZURE_FOUNDRY_EMBEDDING_DIMENSIONS and model deployment configuration.`,
      );
    }

    return embedding;
  }

  throw new Error(lastError || "Unable to acquire an access token for embeddings.");
}

async function indexDocument(document: SearchDocument): Promise<void> {
  await ensureSearchIndex();

  const credential = getTokenCredential();
  const token = await credential.getToken("https://search.azure.com/.default");

  if (!token?.token) {
    throw new Error("Unable to acquire an access token for Azure AI Search.");
  }

  const config = getRuntimeConfig();
  const response = await fetch(getSearchDocumentUrl(`/indexes/${encodeURIComponent(config.aiSearch.indexName)}/docs/index`), {
    method: "POST",
    headers: {
      Authorization: getBearerToken(token.token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      value: [
        {
          "@search.action": "mergeOrUpload",
          ...document,
        },
      ],
    }),
  });

  if (!response.ok) {
    const payload = await response.text().catch(() => "");
    throw new Error(`AI Search indexing failed with ${response.status}${payload ? `: ${payload}` : "."}`);
  }
}

function parseSearchHits(payload: {
  value?: Array<{
    id?: string;
    [key: string]: unknown;
    [key: `@search.${string}`]: unknown;
  }>;
}): SearchHit[] {
  return (payload.value || [])
    .map((item): SearchHit | undefined => {
      if (typeof item.id !== "string") {
        return undefined;
      }

      return {
        id: item.id,
        score: typeof item["@search.score"] === "number" ? item["@search.score"] : undefined,
      };
    })
    .filter((item): item is SearchHit => Boolean(item));
}

function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const output: SearchHit[] = [];

  for (const hit of hits) {
    if (seen.has(hit.id)) {
      continue;
    }
    seen.add(hit.id);
    output.push(hit);
  }

  return output;
}

function sanitizeFullQueryToken(term: string): string {
  return term.replace(/[+\-!(){}\[\]^"~*?:\\/]|&&|\|\|/g, " ").trim();
}

function formatFullQueryTerm(term: string): string {
  const normalized = term.trim();
  if (!normalized) {
    return "";
  }

  return normalized.includes(" ") ? `"${normalized.replace(/"/g, '\\"')}"` : normalized;
}

function normalizeSelectedTags(selectedTags: string[] | undefined): string[] {
  if (!selectedTags || selectedTags.length === 0) {
    return [];
  }

  return Array.from(
    new Set(
      selectedTags
        .map((tag) => sanitizeFullQueryToken(tag.toLowerCase()))
        .filter(Boolean),
    ),
  );
}

export function getNeverMissExpandedTerms(
  query: string,
  neverMissClasses: NeverMissClass[],
): string[] {
  const baseTerms = query
    .split(/\s+/)
    .map((term) => sanitizeFullQueryToken(term.toLowerCase()))
    .filter(Boolean);

  const expandedTerms = neverMissClasses
    .flatMap((className) => NEVER_MISS_EXPANSIONS[className] || [])
    .map((term) => sanitizeFullQueryToken(term.toLowerCase()))
    .filter(Boolean);

  return Array.from(new Set([...baseTerms, ...expandedTerms]));
}

function buildNeverMissExpandedQuery(query: string, neverMissClasses: NeverMissClass[]): string {
  const terms = getNeverMissExpandedTerms(query, neverMissClasses);

  if (terms.length === 0) {
    return "";
  }

  return terms.map((term) => formatFullQueryTerm(term)).filter(Boolean).join(" OR ");
}

function buildPolicyExpandedQuery(
  query: string,
  neverMissClasses: NeverMissClass[],
  selectedTags: string[],
): string {
  const policyTerms = [
    ...getNeverMissExpandedTerms(query, neverMissClasses),
    ...selectedTags,
  ];
  const terms = Array.from(new Set(policyTerms.filter(Boolean)));

  if (terms.length === 0) {
    return "";
  }

  return terms.map((term) => formatFullQueryTerm(term)).filter(Boolean).join(" OR ");
}

function getNeverMissSafetyNetQuery(neverMissClasses: NeverMissClass[]): string {
  const terms = Array.from(
    new Set(neverMissClasses.flatMap((className) => NEVER_MISS_EXPANSIONS[className] || [])),
  )
    .map((term) => sanitizeFullQueryToken(term.toLowerCase()))
    .filter(Boolean);

  if (terms.length === 0) {
    return "";
  }

  return terms.map((term) => formatFullQueryTerm(term)).filter(Boolean).join(" OR ");
}

function getTagSafetyNetQuery(selectedTags: string[]): string {
  if (selectedTags.length === 0) {
    return "";
  }

  return selectedTags.map((term) => formatFullQueryTerm(term)).filter(Boolean).join(" OR ");
}

async function fetchSearchHits(query: string, limit: number): Promise<SearchHit[]> {
  if (!isAiSearchConfigured()) {
    return [];
  }

  await ensureSearchIndex();
  const credential = getTokenCredential();
  const token = await credential.getToken("https://search.azure.com/.default");

  if (!token?.token) {
    throw new Error("Unable to acquire an access token for Azure AI Search.");
  }
  const embedding = await embedText(query);

  const config = getRuntimeConfig();
  const response = await fetch(getSearchDocumentUrl(`/indexes/${encodeURIComponent(config.aiSearch.indexName)}/docs/search`), {
    method: "POST",
    headers: {
      Authorization: getBearerToken(token.token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      search: query,
      searchMode: "any",
      top: limit,
      select: "id",
      vectorQueries: [
        {
          kind: "vector",
          vector: embedding,
          fields: "contentVector",
          k: limit,
        },
      ],
    }),
  });

  if (!response.ok) {
    const payload = await response.text().catch(() => "");
    throw new Error(`AI Search query failed with ${response.status}${payload ? `: ${payload}` : "."}`);
  }

  const payload = (await response.json()) as {
    value?: Array<{
      id?: string;
      [key: string]: unknown;
      [key: `@search.${string}`]: unknown;
    }>;
  };

  return parseSearchHits(payload);
}

async function fetchLexicalSearchHits(query: string, limit: number): Promise<SearchHit[]> {
  if (!isAiSearchConfigured()) {
    return [];
  }

  await ensureSearchIndex();
  const credential = getTokenCredential();
  const token = await credential.getToken("https://search.azure.com/.default");

  if (!token?.token) {
    throw new Error("Unable to acquire an access token for Azure AI Search.");
  }
  const config = getRuntimeConfig();
  const response = await fetch(getSearchDocumentUrl(`/indexes/${encodeURIComponent(config.aiSearch.indexName)}/docs/search`), {
    method: "POST",
    headers: {
      Authorization: getBearerToken(token.token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      search: query,
      searchMode: "any",
      queryType: "full",
      top: limit,
      select: "id",
    }),
  });

  if (!response.ok) {
    const payload = await response.text().catch(() => "");
    throw new Error(`AI Search lexical query failed with ${response.status}${payload ? `: ${payload}` : "."}`);
  }

  const payload = (await response.json()) as {
    value?: Array<{
      id?: string;
      [key: string]: unknown;
      [key: `@search.${string}`]: unknown;
    }>;
  };

  return parseSearchHits(payload);
}

async function searchLocally(query: string, limit: number): Promise<MediaRecord[]> {
  const records = await listMediaRecords(100);
  if (!query.trim()) {
    return records.slice(0, limit);
  }

  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return records
    .map((record) => {
      const haystack = [
        record.fileName,
        record.summary,
        record.unsafeBehaviors?.map((item) => item.description).join(" "),
        record.location,
        record.objectData?.map((item) => `${item.name} ${item.description}`).join(" "),
        record.trainPassings?.join(" "),
        record.tags.join(" "),
      ]
        .filter((value): value is string => Boolean(value))
        .join(" ")
        .toLowerCase();

      const score = tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
      return { record, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.record)
    .slice(0, limit);
}

export async function indexMediaRecord(record: MediaRecord): Promise<void> {
  if (!isAiSearchConfigured() || (record.status !== "completed" && record.status !== "indexing")) {
    return;
  }

  const searchableText = [
    record.fileName,
    record.summary,
    record.unsafeBehaviors?.map((item) => [item.description, item.timestamp ? `at ${item.timestamp}` : undefined].filter(Boolean).join(" ")).join("\n"),
    record.location,
    record.numberOfPeople !== undefined ? `people ${record.numberOfPeople}` : undefined,
    record.objectData?.map((item) => `${item.name}: ${item.description}`).join("\n"),
    record.trainPassings?.join("\n"),
    record.tags.join(" "),
    record.analysisSections.map((section) => `${section.title}\n${section.summary}`).join("\n"),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");

  const embedding = await embedText(searchableText.slice(0, 12000));
  await indexDocument(recordToSearchDocument(record, embedding));
}

export async function searchMediaRecords(query: string, limit = 20): Promise<MediaRecord[]> {
  if (!query.trim()) {
    if (isAiSearchConfigured()) {
      return listMediaRecords(limit);
    }

    return listMediaRecords(limit);
  }

  if (!isAiSearchConfigured()) {
    return searchLocally(query, limit);
  }

  let hits = await fetchSearchHits(query, limit);
  if (hits.length === 0) {
    hits = await fetchLexicalSearchHits(query, limit);
  }
  const records = await Promise.all(hits.map((hit) => getMediaRecord(hit.id)));
  return records.filter((record): record is MediaRecord => Boolean(record));
}

export async function searchMediaRecordsWithNeverMiss(
  query: string,
  options?: {
    limit?: number;
    neverMissClasses?: NeverMissClass[];
    selectedTags?: string[];
  },
): Promise<MediaRecord[]> {
  const limit = options?.limit ?? 20;
  const neverMissClasses = options?.neverMissClasses ?? [];
  const selectedTags = normalizeSelectedTags(options?.selectedTags);
  const hasUserQuery = query.trim().length > 0;

  if (neverMissClasses.length === 0 && selectedTags.length === 0) {
    return searchMediaRecords(query, limit);
  }

  if (!isAiSearchConfigured()) {
    const localQuery = hasUserQuery
      ? [query, ...selectedTags].join(" ").trim()
      : [getNeverMissSafetyNetQuery(neverMissClasses), getTagSafetyNetQuery(selectedTags)].join(" ").trim();
    return searchLocally(localQuery, limit);
  }

  const expandedQuery = hasUserQuery
    ? buildPolicyExpandedQuery(query, neverMissClasses, selectedTags)
    : [getNeverMissSafetyNetQuery(neverMissClasses), getTagSafetyNetQuery(selectedTags)].filter(Boolean).join(" OR ");
  const lexicalExpandedHits = expandedQuery
    ? await fetchLexicalSearchHits(expandedQuery, limit)
    : [];
  const hybridHits = hasUserQuery ? await fetchSearchHits(query, limit) : [];

  let mergedHits = dedupeHits([...lexicalExpandedHits, ...hybridHits]).slice(0, limit);

  const lowConfidence = lexicalExpandedHits.length === 0 || mergedHits.length < Math.min(3, limit);
  if (lowConfidence) {
    const safetyNetQuery = [
      getNeverMissSafetyNetQuery(neverMissClasses),
      getTagSafetyNetQuery(selectedTags),
    ]
      .filter(Boolean)
      .join(" OR ");
    const shouldFetchSafetyNet = Boolean(safetyNetQuery) && safetyNetQuery !== expandedQuery;
    const safetyNetHits = shouldFetchSafetyNet ? await fetchLexicalSearchHits(safetyNetQuery, limit) : [];
    mergedHits = dedupeHits([...lexicalExpandedHits, ...safetyNetHits, ...hybridHits]).slice(0, limit);

    if (lexicalExpandedHits.length === 0 && safetyNetHits.length === 0) {
      console.warn("Never-miss lexical retrieval returned zero results.", {
        query,
        neverMissClasses,
      });
    }
  }

  const records = await Promise.all(mergedHits.map((hit) => getMediaRecord(hit.id)));
  return records.filter((record): record is MediaRecord => Boolean(record));
}