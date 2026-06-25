"use client";

import { DragEvent, FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const ACCEPT = "video/*,.avi,.mp4,.mov,.mkv,.webm,.wmv,.mpeg,.mpg,.m4v,.ogv,.ogg,.3gp";

type FileResult = {
  name: string;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
  id?: string;
};

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<FileResult[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    const next = Array.from(incoming);
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...next.filter((f) => !names.has(f.name))];
    });
    setResults([]);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setResults([]);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!files.length) return;
    setIsSubmitting(true);
    setResults(files.map((f) => ({ name: f.name, status: "pending" as const })));

    let firstId: string | undefined;

    for (let i = 0; i < files.length; i++) {
      setResults((prev) =>
        prev.map((r, j) => (j === i ? { ...r, status: "uploading" as const } : r)),
      );
      try {
        const formData = new FormData();
        formData.append("file", files[i]);
        const res = await fetch("/api/uploads", { method: "POST", body: formData });
        const payload = (await res.json()) as { id?: string; error?: string };
        if (!res.ok) throw new Error(payload.error || "Upload failed.");
        if (!firstId) firstId = payload.id;
        setResults((prev) =>
          prev.map((r, j) =>
            j === i ? { ...r, status: "done" as const, id: payload.id } : r,
          ),
        );
      } catch (err) {
        setResults((prev) =>
          prev.map((r, j) =>
            j === i
              ? { ...r, status: "error" as const, error: err instanceof Error ? err.message : "Failed." }
              : r,
          ),
        );
      }
    }

    setIsSubmitting(false);
    if (firstId) {
      router.push(`/assets/${firstId}`);
      router.refresh();
    }
  }

  return (
    <form className="upload-form" onSubmit={handleSubmit}>
      <div
        className={`file-drop-zone${isDragging ? " dragging" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          name="file"
          type="file"
          accept={ACCEPT}
          multiple
          className="visually-hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        <span className="file-drop-icon">↑</span>
        <span className="file-drop-label">
          {files.length
            ? `${files.length} file${files.length > 1 ? "s" : ""} selected`
            : "Drop videos here or click to browse"}
        </span>
        <span className="file-drop-hint">MP4, MOV, MKV, AVI, WEBM and more</span>
      </div>

      {files.length > 0 ? (
        <ul className="file-list">
          {files.map((f, i) => {
            const result = results[i];
            return (
              <li
                key={f.name}
                className={`file-list-item${result ? ` status-${result.status}` : ""}`}
              >
                <span className="file-list-name">{f.name}</span>
                {result?.status === "uploading" ? (
                  <span className="file-list-status">Uploading…</span>
                ) : result?.status === "done" ? (
                  <span className="file-list-status success">✓ Queued</span>
                ) : result?.status === "error" ? (
                  <span className="file-list-status error">{result.error}</span>
                ) : (
                  <button
                    type="button"
                    className="file-list-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(i);
                    }}
                    aria-label={`Remove ${f.name}`}
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      <p className="muted">
        Files land in the incoming blob container and are picked up by the FFmpeg worker for
        conversion and analysis.
      </p>
      <button
        className="button primary"
        disabled={isSubmitting || files.length === 0}
        type="submit"
      >
        {isSubmitting
          ? "Uploading…"
          : files.length > 1
            ? `Upload ${files.length} videos`
            : "Upload for processing"}
      </button>
    </form>
  );
}
