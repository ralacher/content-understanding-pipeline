import { ProcessingStatus } from "@/lib/domain";
import { statusLabel, statusTone } from "@/lib/utils";

export function StatusBadge({ status }: { status: ProcessingStatus }) {
  return <span className={`status-badge ${statusTone(status)}`}>{statusLabel(status)}</span>;
}
