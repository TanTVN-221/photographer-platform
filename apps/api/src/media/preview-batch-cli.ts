import { PreviewBatchError } from "./preview-batch-cursor.js";
import { executePreviewBatchCommand } from "./preview-batch-command.js";

const controller = new AbortController();
const cancel = () => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
// Soft scheduling deadline, not a hard native decoder/process-isolation limit.
const deadline = setTimeout(cancel, 120_000);
try {
  const result = await executePreviewBatchCommand(process.argv.slice(2), process.env, controller.signal);
  const counts: Record<string, number> = {};
  for (const outcome of result.outcomes) counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
  console.info(JSON.stringify({ event: "preview_batch_finished", status: result.status, counts,
    nextCursor: result.nextCursor, codes: [...new Set(result.outcomes.flatMap((item) => "code" in item ? [item.code] : []))] }));
  if (result.status === "blocked" || result.status === "catalog-changed" || result.status === "cancelled") process.exitCode = 2;
} catch (error) {
  console.error(JSON.stringify({ event: "preview_batch_failed", code: error instanceof PreviewBatchError ? error.code : "unavailable" }));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  process.off("SIGINT", cancel);
  process.off("SIGTERM", cancel);
}
