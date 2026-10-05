"use client";
import { useState } from "react";
import type { Locale } from "../../../../lib/i18n";
import { workspaceCopy } from "../../../../lib/workspace-copy";

export function GalleryLink({ url, locale }: { url: string; locale: Locale }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copy = workspaceCopy[locale];
  return <div className="mt-5 space-y-3">
    <div className="flex flex-wrap gap-5">
      <a href={url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{copy.openGallery}</a>
      <button type="button" className="underline underline-offset-4" onClick={async () => {
        try { await navigator.clipboard.writeText(url); setStatus("copied"); } catch { setStatus("failed"); }
      }}>{copy.copy}</button>
    </div>
    <input readOnly aria-label={copy.copy} value={url} onFocus={(event) => event.currentTarget.select()}
      className="w-full max-w-xl border border-[var(--line)] bg-transparent p-2 text-sm" />
    <p role="status" className="text-sm">{status === "copied" ? copy.copied : status === "failed" ? copy.copyFailed : ""}</p>
  </div>;
}
