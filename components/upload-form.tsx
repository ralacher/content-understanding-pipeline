"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function UploadForm() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const formData = new FormData(event.currentTarget);
      const response = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as { id?: string; message?: string; error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Upload failed.");
      }

      setMessage(payload.message || "Upload complete.");

      if (payload.id) {
        router.push(`/assets/${payload.id}`);
        router.refresh();
      }
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : "Upload failed unexpectedly.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="upload-form" onSubmit={handleSubmit}>
      <label className="field">
        <span>AVI file</span>
        <input name="file" type="file" accept=".avi,video/x-msvideo" required />
      </label>
      <p className="muted">
        Uploaded files land in the incoming blob container and are picked up by the FFmpeg worker.
      </p>
      <button className="button primary" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Uploading…" : "Upload for processing"}
      </button>
      {message ? <p className="success-message">{message}</p> : null}
      {error ? <p className="error-message">{error}</p> : null}
    </form>
  );
}
