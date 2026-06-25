export const dynamic = "force-dynamic";

import Link from "next/link";
import {
  NeverMissClass,
  getNeverMissExpandedTerms,
  searchMediaRecords,
  searchMediaRecordsWithNeverMiss,
} from "@/lib/search";
import { listMediaRecords } from "@/lib/storage";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";

type SearchParams = Promise<{
  q?: string;
  class?: string | string[];
  tag?: string | string[];
}>;

const NEVER_MISS_OPTIONS: Array<{ value: NeverMissClass; label: string; hint: string }> = [
  { value: "weapon", label: "Weapon", hint: "knife, gun, firearm, blade" },
  { value: "fight", label: "Fight", hint: "assault, brawl, altercation" },
  { value: "push", label: "Push", hint: "push, shove, fall, track-adjacent incidents" },
];

function normalizeNeverMissClasses(value: string | string[] | undefined): NeverMissClass[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const allowed = new Set<NeverMissClass>(NEVER_MISS_OPTIONS.map((option) => option.value));
  return Array.from(new Set(values.filter((item): item is NeverMissClass => allowed.has(item as NeverMissClass))));
}

function buildSearchHref(query: string, selectedClasses: NeverMissClass[]): string {
  return buildSearchHrefWithTags(query, selectedClasses, []);
}

function buildSearchHrefWithTags(query: string, selectedClasses: NeverMissClass[], selectedTags: string[]): string {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("q", query);
  }
  for (const className of selectedClasses) {
    params.append("class", className);
  }
  for (const tag of selectedTags) {
    params.append("tag", tag);
  }

  const serialized = params.toString();
  return serialized ? `/search?${serialized}` : "/search";
}

function toggleNeverMissClass(
  selectedClasses: NeverMissClass[],
  className: NeverMissClass,
): NeverMissClass[] {
  if (selectedClasses.includes(className)) {
    return selectedClasses.filter((item) => item !== className);
  }
  return [...selectedClasses, className];
}

function normalizeSelectedTags(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return Array.from(new Set(values.map((item) => item.trim().toLowerCase()).filter(Boolean)));
}

function toggleTag(selectedTags: string[], tag: string): string[] {
  if (selectedTags.includes(tag)) {
    return selectedTags.filter((item) => item !== tag);
  }

  return [...selectedTags, tag];
}

function pickFieldSummary(record: Awaited<ReturnType<typeof searchMediaRecords>>[number]): string {
  const legacyRecord = record as typeof record & {
    unsafeBehavior?: string;
    trainPassing?: string[];
  };

  const parts = [
    record.summary,
    record.unsafeBehaviors?.map((item) => item.description).filter(Boolean).join(", ") || legacyRecord.unsafeBehavior,
    record.location,
    record.numberOfPeople !== undefined ? `People: ${record.numberOfPeople}` : undefined,
    record.objectData && record.objectData.length > 0
      ? `Objects: ${record.objectData.slice(0, 2).map((item) => item.name).join(", ")}`
      : undefined,
    record.trainPassings && record.trainPassings.length > 0
      ? `Train passings: ${record.trainPassings[0]}`
      : legacyRecord.trainPassing && legacyRecord.trainPassing.length > 0
        ? `Train passings: ${legacyRecord.trainPassing[0]}`
        : undefined,
  ].filter((value): value is string => Boolean(value));

  return parts.join(" • ") || "No highlights available.";
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const query = params.q?.trim() || "";
  const neverMissClasses = normalizeNeverMissClasses(params.class);
  const selectedTags = normalizeSelectedTags(params.tag);
  const tagSourceRecords = await listMediaRecords(300);
  const availableTags = Array.from(
    new Set(
      tagSourceRecords
        .flatMap((record) => record.tags || [])
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  )
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 48);
  const expandedTerms = getNeverMissExpandedTerms(query, neverMissClasses);
  const records =
    neverMissClasses.length > 0 || selectedTags.length > 0
      ? await searchMediaRecordsWithNeverMiss(query, { limit: 20, neverMissClasses, selectedTags })
      : await searchMediaRecords(query, 20);

  return (
    <div className="stack-xl">
      <section className="card stack-md">
        <form className="search-bar" action="/search">
          <input
            defaultValue={query}
            name="q"
            placeholder="Search by behavior, object, location, summary, or phrase"
            type="search"
          />
          {neverMissClasses.map((className) => (
            <input key={className} type="hidden" name="class" value={className} />
          ))}
          {selectedTags.map((tag) => (
            <input key={tag} type="hidden" name="tag" value={tag} />
          ))}
          <button className="button primary" type="submit">
            Search
          </button>
        </form>

        <div className="never-miss-panel">
          <p className="eyebrow">Never-miss classes</p>
          <div className="never-miss-badges" role="group" aria-label="Never-miss class filters">
            {NEVER_MISS_OPTIONS.map((option) => {
              const isSelected = neverMissClasses.includes(option.value);
              const nextSelection = toggleNeverMissClass(neverMissClasses, option.value);

              return (
                <Link
                  key={option.value}
                  className={`never-miss-badge${isSelected ? " selected" : ""}`}
                  href={buildSearchHrefWithTags(query, nextSelection, selectedTags)}
                >
                  <span>{option.label}</span>
                  <small>{option.hint}</small>
                </Link>
              );
            })}
          </div>
          {neverMissClasses.length > 0 ? (
            <div className="stack-xs">
              <p className="muted">
                Strict lexical expansion is active for: {neverMissClasses.join(", ")}
              </p>
              <div className="tag-list" aria-label="Expanded terms used">
                {expandedTerms.map((term) => (
                  <span key={term} className="tag">
                    {term}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="stack-xs">
            <p className="eyebrow">Tag filters</p>
            <div className="tag-filter-list" role="group" aria-label="Tag filters">
              {availableTags.map((tag) => {
                const isSelected = selectedTags.includes(tag);
                const nextTags = toggleTag(selectedTags, tag);

                return (
                  <Link
                    key={tag}
                    className={`tag-filter-chip${isSelected ? " selected" : ""}`}
                    href={buildSearchHrefWithTags(query, neverMissClasses, nextTags)}
                  >
                    {tag}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Video file</th>
                <th>Relevant fields</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>{formatRelativeTime(record.indexedAt || record.updatedAt || record.createdAt)}</td>
                  <td>
                    <div className="stack-xs">
                      <Link className="table-link" href={`/assets/${record.id}`}>
                        {record.fileName}
                      </Link>
                      <span className="muted">Updated {formatDateTime(record.updatedAt)}</span>
                    </div>
                  </td>
                  <td>{pickFieldSummary(record)}</td>
                </tr>
              ))}
              {records.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    No matches yet. Try a broader phrase or upload more analyzed videos.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}