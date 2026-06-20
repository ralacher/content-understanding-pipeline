import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card stack-md">
      <p className="eyebrow">Not found</p>
      <h1>We couldn&apos;t find that media record.</h1>
      <p className="muted">Return to the overview to choose another processed asset.</p>
      <Link className="button primary" href="/">
        Back to overview
      </Link>
    </div>
  );
}
