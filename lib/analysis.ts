import {
  AnalysisSection,
  AnalysisUsage,
  ContentUnderstandingSummary,
  ObjectDataItem,
  UnsafeBehavior,
} from "./domain";

function coerceObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (item && typeof item === "object") {
        const text = (item as Record<string, unknown>).text || (item as Record<string, unknown>).label;
        return typeof text === "string" ? text : undefined;
      }

      return undefined;
    })
    .filter((item): item is string => Boolean(item));
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function coerceValueObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    if (objectValue.valueObject && typeof objectValue.valueObject === "object") {
      return objectValue.valueObject as Record<string, unknown>;
    }

    return objectValue;
  }

  return undefined;
}

function extractField(contentFields: Record<string, unknown> | undefined, fieldName: string): Record<string, unknown> | undefined {
  if (!contentFields) {
    return undefined;
  }

  const field = contentFields[fieldName];
  return coerceValueObject(field);
}

function makeSection(title: string, summary: string, bullets: string[]): AnalysisSection | null {
  if (!summary && bullets.length === 0) {
    return null;
  }

  return {
    title,
    summary,
    bullets,
  };
}

function extractUsage(root: Record<string, unknown>, result: Record<string, unknown>): AnalysisUsage | undefined {
  const usage = coerceObject(root.usage) || coerceObject(result.usage);
  if (!usage) {
    return undefined;
  }

  const rawTokens = coerceObject(usage.tokens);
  const tokens = rawTokens
    ? Object.fromEntries(
        Object.entries(rawTokens).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
      )
    : undefined;

  return {
    videoHours: typeof usage.videoHours === "number" ? usage.videoHours : undefined,
    contextualizationTokens:
      typeof usage.contextualizationTokens === "number" ? usage.contextualizationTokens : undefined,
    tokens,
  };
}

function extractUnsafeBehaviors(
  contentFields: Record<string, unknown> | undefined,
): UnsafeBehavior[] | undefined {
  if (!contentFields) {
    return undefined;
  }

  const unsafeBehaviorsField = coerceObject(contentFields.unsafeBehaviors);
  if (unsafeBehaviorsField) {
    const valueString = unsafeBehaviorsField.valueString;
    if (typeof valueString === "string") {
      const behaviors: UnsafeBehavior[] = [];
      const lines = valueString.split("\n").map((line) => line.trim()).filter(Boolean);

      for (const line of lines) {
        const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 1) {
          behaviors.push({
            description: parts[0],
            timestamp: parts[1],
          });
        }
      }

      return behaviors.length > 0 ? behaviors : undefined;
    }

    if (Array.isArray(unsafeBehaviorsField.valueArray)) {
      const mappedBehaviors = unsafeBehaviorsField.valueArray
        .map((item): UnsafeBehavior | undefined => {
          if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>;
            const valueObject = coerceObject(obj.valueObject);
            const descriptionField = coerceObject(valueObject?.description);
            const timestampField = coerceObject(valueObject?.timestamp);
            const description =
              typeof obj.description === "string"
                ? obj.description
                : typeof descriptionField?.valueString === "string"
                  ? descriptionField.valueString
                  : typeof obj.valueString === "string"
                    ? obj.valueString
                    : undefined;
            const timestamp =
              typeof obj.timestamp === "string"
                ? obj.timestamp
                : typeof timestampField?.valueString === "string"
                  ? timestampField.valueString
                  : typeof obj.time === "string"
                    ? obj.time
                    : undefined;

            if (description) {
              return { description, timestamp };
            }
          }
          return undefined;
        })
        .filter((item): item is UnsafeBehavior => Boolean(item));

      return mappedBehaviors.length > 0 ? mappedBehaviors : undefined;
    }
  }

  // Fallback to legacy singular unsafeBehavior field
  const legacyUnsafeBehaviorField = coerceObject(contentFields.unsafeBehavior);
  if (legacyUnsafeBehaviorField) {
    const valueString = legacyUnsafeBehaviorField.valueString;
    if (typeof valueString === "string") {
      return [{ description: valueString }];
    }
  }

  return undefined;
}

function extractObjectData(contentFields: Record<string, unknown> | undefined): ObjectDataItem[] | undefined {
  const objectDataField = extractField(contentFields, "objectData");
  const valueArray = objectDataField?.valueArray;

  if (!Array.isArray(valueArray)) {
    return undefined;
  }

  const mappedItems = valueArray
    .map((entry): ObjectDataItem | undefined => {
      const item = coerceValueObject(entry);
      if (!item) {
        return undefined;
      }

      const valueObject = coerceValueObject(item.valueObject) || item;
      const nameField = coerceObject(valueObject.name);
      const descriptionField = coerceObject(valueObject.description);
      const objectNameField = coerceObject(valueObject.objectName);
      const objectDescriptionField = coerceObject(valueObject.objectDescription);

      const name = typeof valueObject.name === "string"
        ? valueObject.name
        : typeof nameField?.valueString === "string"
          ? nameField.valueString
          : typeof valueObject.objectName === "string"
            ? valueObject.objectName
            : typeof objectNameField?.valueString === "string"
              ? objectNameField.valueString
              : undefined;
      const description = typeof valueObject.description === "string"
        ? valueObject.description
        : typeof descriptionField?.valueString === "string"
          ? descriptionField.valueString
          : typeof valueObject.objectDescription === "string"
            ? valueObject.objectDescription
            : typeof objectDescriptionField?.valueString === "string"
              ? objectDescriptionField.valueString
              : undefined;

      if (name && description) {
        return {
          name,
          description,
        };
      }

      return undefined;
    })
    .filter((item): item is ObjectDataItem => Boolean(item));

  return mappedItems.length > 0 ? mappedItems : undefined;
}

function extractTimeList(contentFields: Record<string, unknown> | undefined, fieldName: string): string[] | undefined {
  const field = extractField(contentFields, fieldName);
  if (!field) {
    return undefined;
  }

  if (typeof field.valueString === "string") {
    const values = field.valueString
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^[-*]\s*/, ""));
    return values.length > 0 ? values : undefined;
  }

  if (Array.isArray(field.valueArray)) {
    const values = field.valueArray
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }

        const item = coerceValueObject(entry);
        if (!item) {
          return undefined;
        }

        const valueObject = coerceValueObject(item.valueObject) || item;
        if (typeof valueObject.valueString === "string") {
          return valueObject.valueString;
        }

        if (typeof valueObject.time === "string") {
          return valueObject.time;
        }

        if (typeof valueObject.timestamp === "string") {
          return valueObject.timestamp;
        }

        return undefined;
      })
      .filter((item): item is string => Boolean(item));

    return values.length > 0 ? values : undefined;
  }

  return undefined;
}

function extractStringField(contentFields: Record<string, unknown> | undefined, fieldName: string): string | undefined {
  const field = extractField(contentFields, fieldName);
  if (!field) {
    return undefined;
  }

  if (typeof field.valueString === "string") {
    return field.valueString;
  }

  if (typeof field.value === "string") {
    return field.value;
  }

  return undefined;
}

function extractTagList(contentFields: Record<string, unknown> | undefined): string[] | undefined {
  const field = extractField(contentFields, "tags");
  if (!field) {
    return undefined;
  }

  if (Array.isArray(field.valueArray)) {
    const values = field.valueArray
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }

        const item = coerceValueObject(entry);
        if (!item) {
          return undefined;
        }

        const valueObject = coerceValueObject(item.valueObject) || item;
        if (typeof valueObject.valueString === "string") {
          return valueObject.valueString;
        }

        if (typeof valueObject.text === "string") {
          return valueObject.text;
        }

        return undefined;
      })
      .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : undefined))
      .filter((value): value is string => Boolean(value));

    return values.length > 0 ? Array.from(new Set(values)).slice(0, 8) : undefined;
  }

  if (typeof field.valueString === "string") {
    const values = field.valueString
      .split(/[\n,]/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    return values.length > 0 ? Array.from(new Set(values)).slice(0, 8) : undefined;
  }

  return undefined;
}

function extractIntegerField(contentFields: Record<string, unknown> | undefined, fieldName: string): number | undefined {
  const field = extractField(contentFields, fieldName);
  if (!field) {
    return undefined;
  }

  return coerceNumber(
    field.valueInteger ??
      field.valueInt ??
      field.valueNumber ??
      field.valueString ??
      field.value,
  );
}

function buildStructuredSections(input: {
  summary: string;
  unsafeBehaviors?: UnsafeBehavior[];
  numberOfPeople?: number;
  objectData?: ObjectDataItem[];
  trainPassings?: string[];
  location?: string;
  keywordBullets: string[];
  topicBullets: string[];
  transcriptBullets: string[];
}): AnalysisSection[] {
  const sections: Array<AnalysisSection | null> = [
    makeSection("Executive summary", input.summary, []),
    makeSection(
      "Unsafe behaviors",
      input.unsafeBehaviors?.length || input.numberOfPeople !== undefined || input.location || input.objectData?.length || input.trainPassings?.length
        ? "Structured fields captured from the generated schema."
        : "No unsafe behavior details were returned.",
      input.unsafeBehaviors?.map((item) => [item.description, item.timestamp ? `at ${item.timestamp}` : undefined].filter(Boolean).join(" ")) || [],
    ),
    input.numberOfPeople !== undefined
      ? makeSection("People count", `${input.numberOfPeople} people were detected.`, [formatCountLine(input.numberOfPeople)])
      : null,
    input.objectData && input.objectData.length > 0
      ? makeSection(
          "Objects",
          "Detected objects were normalized into a structured list.",
          input.objectData.map((item) => `${item.name}: ${item.description}`),
        )
      : null,
    input.trainPassings && input.trainPassings.length > 0
      ? makeSection("Train passings", "Train passing times were extracted from the analysis.", input.trainPassings)
      : null,
    input.location ? makeSection("Location", input.location, [input.location]) : null,
    makeSection(
      "Detected themes",
      input.topicBullets.length > 0
        ? "Common themes identified in the analysis response."
        : input.keywordBullets.length > 0
          ? "Keywords were identified from the recording."
          : "No explicit themes were returned.",
      input.topicBullets.length > 0 ? input.topicBullets : input.keywordBullets,
    ),
    makeSection(
      "Transcript highlights",
      input.transcriptBullets.length > 0
        ? "Representative spoken moments extracted from the recording."
        : "No transcript highlights were returned.",
      input.transcriptBullets,
    ),
  ];

  return sections.filter((item): item is AnalysisSection => Boolean(item));
}

function formatCountLine(value: number): string {
  return `Detected count: ${value}.`;
}

export function normalizeAnalysisResult(payload: unknown): ContentUnderstandingSummary {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const result = root.result && typeof root.result === "object" ? (root.result as Record<string, unknown>) : root;
  const transcript = result.transcript && typeof result.transcript === "object"
    ? (result.transcript as Record<string, unknown>)
    : undefined;
  const contents = Array.isArray(result.contents) ? result.contents : [];
  const primaryContent = coerceObject(contents[0]);
  const contentFields = coerceObject(primaryContent?.fields);
  const summaryFromField = extractStringField(contentFields, "summary") || "";
  const transcriptSegments = transcript?.segments && Array.isArray(transcript.segments)
    ? transcript.segments
    : [];

  const summary =
    summaryFromField ||
    (typeof result.summary === "string" && result.summary) ||
    (typeof result.overview === "string" && result.overview) ||
    (typeof transcript?.summary === "string" && transcript.summary) ||
    "Content Understanding completed successfully.";

  const transcriptBullets = transcriptSegments
    .map((segment) => {
      if (!segment || typeof segment !== "object") {
        return undefined;
      }

      const text = (segment as Record<string, unknown>).text;
      return typeof text === "string" ? text : undefined;
    })
    .filter((item): item is string => Boolean(item))
    .slice(0, 5);

  const keywordBullets = coerceStringArray(result.keywords).slice(0, 6);
  const topicBullets = coerceStringArray(result.topics).slice(0, 6);
  const unsafeBehaviors = extractUnsafeBehaviors(contentFields);
  const numberOfPeople = extractIntegerField(contentFields, "numberOfPeople");
  const objectData = extractObjectData(contentFields);
  const trainPassings = extractTimeList(contentFields, "trainPassings") || extractTimeList(contentFields, "trainPassing");
  const location = extractStringField(contentFields, "location");
  const sections = buildStructuredSections({
    summary,
    unsafeBehaviors,
    numberOfPeople,
    objectData,
    trainPassings,
    location,
    keywordBullets,
    topicBullets,
    transcriptBullets,
  });

  const confidence =
    typeof result.confidence === "number"
      ? result.confidence
      : typeof result.score === "number"
        ? result.score
        : undefined;

  const durationSeconds =
    typeof result.durationSeconds === "number"
      ? result.durationSeconds
      : typeof result.durationInSeconds === "number"
        ? result.durationInSeconds
        : undefined;

  const language =
    typeof result.language === "string"
      ? result.language
      : typeof transcript?.language === "string"
        ? transcript.language
        : undefined;

  const generatedTags = extractTagList(contentFields);
  const tags = generatedTags || Array.from(new Set([...topicBullets, ...keywordBullets])).slice(0, 8);
  const usage = extractUsage(root, result);

  return {
    summary,
    confidence,
    durationSeconds,
    language,
    tags,
    sections,
    usage,
    unsafeBehaviors,
    numberOfPeople,
    objectData,
    trainPassings,
    location,
  };
}
