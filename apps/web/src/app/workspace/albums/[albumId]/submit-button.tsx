"use client";
import { useFormStatus } from "react-dom";

export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <button disabled={pending} aria-busy={pending}
    className="border border-[var(--ink)] px-4 py-3 disabled:opacity-50">{children}</button>;
}
