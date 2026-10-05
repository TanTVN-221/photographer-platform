"use client";
import { useState } from "react";
export function ReviewThumbnail({ src, fileName, unavailable, width, height }: {
  src: string | null; fileName: string; unavailable: string; width: number | null; height: number | null;
}) {
  const [failed, setFailed] = useState(false);
  return <div className="flex h-36 w-36 shrink-0 items-center justify-center bg-[var(--surface)]">
    {src !== null && !failed ?
      // Authenticated image requests must go directly to the API; the Next
      // optimizer does not forward the owner's HttpOnly session cookie.
      <img src={src} alt={fileName} loading="lazy" decoding="async" width={width ?? 144} height={height ?? 144}
        className="h-full w-full object-contain" onError={() => setFailed(true)} /> :
      <p className="px-3 text-center text-xs text-[var(--muted)]">{unavailable}</p>}
  </div>;
}
