"use client";

import { useRef, useState, type MouseEvent } from "react";

import type { GalleryPhotoListItem, GuestSelectionState } from "@photographer-platform/shared";

import { galleryCopy, type GalleryCopy, type Locale } from "../../../lib/i18n";
import type { GuestSelectionMutationResult } from "../../../lib/gallery-selection";

import { mutateGallerySelection } from "./selection-action";
import { GalleryLightbox, type ViewablePhoto } from "./gallery-lightbox";

type GalleryViewerProps = {
  readonly photos: readonly GalleryPhotoListItem[];
  readonly locale: Locale;
  readonly slug: string;
  readonly selection: GuestSelectionState | null;
};

export function movePreviewIndex(current: number, count: number, direction: -1 | 1): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, current + direction));
}

function CommentEditor({ value, copy, disabled, onSave }: {
  readonly value: string | null;
  readonly copy: GalleryCopy;
  readonly disabled: boolean;
  readonly onSave: (comment: string) => Promise<string | null | undefined>;
}) {
  const [draft, setDraft] = useState(value ?? "");
  return (
    <form className="gallery-comment" onSubmit={(event) => {
      event.preventDefault();
      void onSave(draft).then((saved) => { if (saved !== undefined) setDraft(saved ?? ""); });
    }}>
      <label>{copy.commentLabel}
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2_000} disabled={disabled} />
      </label>
      <button type="submit" disabled={disabled || draft === (value ?? "")}>{copy.saveComment}</button>
    </form>
  );
}

function PhotoCard({ photo, copy, onOpen, selected, comment, editable, busy, atLimit, onToggle, onSaveComment }: {
  readonly photo: GalleryPhotoListItem;
  readonly copy: GalleryCopy;
  readonly onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly selected: boolean;
  readonly comment: string | null;
  readonly editable: boolean;
  readonly busy: boolean;
  readonly atLimit: boolean;
  readonly onToggle: () => void;
  readonly onSaveComment: (comment: string) => Promise<string | null | undefined>;
}) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const image = photo.images?.thumbnail;
  const ratio = photo.width !== null && photo.height !== null
    ? `${photo.width} / ${photo.height}`
    : "4 / 3";

  return (
    <li className="gallery-card">
      {image === undefined ? (
        <div className="gallery-card-image gallery-card-image--missing" style={{ aspectRatio: ratio }}>
          <span>{copy.previewStatus[photo.previewStatus]}</span>
        </div>
      ) : (
        <button className="gallery-card-open" type="button" onClick={onOpen} aria-label={copy.openPreview(photo.fileName)}>
          <span className="gallery-card-image" style={{ aspectRatio: ratio }}>
            {thumbnailFailed ? (
              <span className="gallery-card-image-fallback">{copy.previewUnavailable}</span>
            ) : (
              // Application-generated derivative, not a Drive original.
              <img
                src={image.src}
                alt=""
                width={image.width ?? undefined}
                height={image.height ?? undefined}
                loading="lazy"
                decoding="async"
                onError={() => setThumbnailFailed(true)}
              />
            )}
          </span>
        </button>
      )}
      <div className="gallery-card-caption">
        <strong title={photo.fileName}>{photo.fileName}</strong>
        <span>{photo.width !== null && photo.height !== null
          ? `${photo.width} × ${photo.height} px`
          : copy.dimensionsUnknown}</span>
      </div>
      {editable && (
        <button className="gallery-select-button" type="button" aria-pressed={selected}
          disabled={busy || (atLimit && !selected)} onClick={onToggle}>
          {selected ? copy.deselectPhoto : copy.selectPhoto}
        </button>
      )}
      {selected && (editable
        ? <CommentEditor value={comment} copy={copy} disabled={busy} onSave={onSaveComment} />
        : comment !== null && <p className="gallery-comment-readonly">{comment}</p>)}
    </li>
  );
}

export function GalleryViewer({ photos, locale, slug, selection }: GalleryViewerProps) {
  const copy = galleryCopy[locale];
  const viewablePhotos = photos.filter((photo): photo is ViewablePhoto => photo.images !== null);
  const [selectionState, setSelectionState] = useState(selection);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [selectionError, setSelectionError] = useState<keyof GalleryCopy["selectionErrors"] | null>(null);
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const activePhoto = activeIndex === null ? null : viewablePhotos[activeIndex] ?? null;
  const editable = selectionState?.status === "DRAFT";
  const atLimit = selectionState !== null && selectionState.selectionLimit !== null &&
    selectionState.selectedCount >= selectionState.selectionLimit;
  const selectedById = new Map(selectionState?.selectedItems.map((item) => [item.photoId, item.comment]) ?? []);

  async function runMutation(input: Parameters<typeof mutateGallerySelection>[0]): Promise<GuestSelectionMutationResult> {
    setSelectionBusy(true);
    setSelectionError(null);
    try {
      const result = await mutateGallerySelection(input);
      if (result.status === "error") setSelectionError(result.reason);
      return result;
    } catch {
      setSelectionError("unavailable");
      return { status: "error", reason: "unavailable" };
    } finally {
      setSelectionBusy(false);
    }
  }

  async function togglePhoto(photoId: string) {
    if (!editable || selectionBusy) return;
    const selected = selectedById.has(photoId);
    const result = await runMutation({ kind: selected ? "deselect" : "select", slug, photoId });
    if (result.status !== "success" || !("state" in result)) return;
    setSelectionState((previous) => previous === null ? null : ({
      ...previous,
      ...result.state,
      selectedItems: selected
        ? previous.selectedItems.filter((item) => item.photoId !== photoId)
        : previous.selectedItems.some((item) => item.photoId === photoId)
          ? previous.selectedItems
          : [...previous.selectedItems, { photoId, comment: null }],
    }));
  }

  async function saveComment(photoId: string, comment: string): Promise<string | null | undefined> {
    if (!editable || selectionBusy) return undefined;
    const result = await runMutation({ kind: "comment", slug, photoId, comment });
    if (result.status !== "success" || !("comment" in result)) return undefined;
    setSelectionState((previous) => previous === null ? null : ({
      ...previous,
      selectedItems: previous.selectedItems.map((item) =>
        item.photoId === photoId ? { ...item, comment: result.comment } : item),
    }));
    return result.comment;
  }

  async function submitSelection() {
    if (!editable || selectionBusy || !confirmingSubmit) return;
    const result = await runMutation({ kind: "submit", slug });
    if (result.status !== "success" || !("state" in result)) return;
    setSelectionState((previous) => previous === null ? null : ({ ...previous, ...result.state }));
    setConfirmingSubmit(false);
  }

  function openPhoto(photoId: string, event: MouseEvent<HTMLButtonElement>) {
    const index = viewablePhotos.findIndex((photo) => photo.photoId === photoId);
    if (index < 0) return;
    openerRef.current = event.currentTarget;
    setActiveIndex(index);
  }

  function navigate(direction: -1 | 1) {
    if (activeIndex === null) return;
    setActiveIndex((previous) => previous === null ? null : movePreviewIndex(previous, viewablePhotos.length, direction));
  }

  return (
    <>
      <section className="gallery-selection" aria-live="polite">
        {selectionState === null ? (
          <p>{copy.selectionUnavailable}</p>
        ) : (
          <>
            <strong>{copy.selectedCount(selectionState.selectedCount, selectionState.selectionLimit)}</strong>
            {editable && atLimit && <p>{copy.selectionLimitReached}</p>}
            {selectionState.status === "SUBMITTED" && <p>{copy.submittedSelection}</p>}
            {selectionState.status === "LOCKED" && <p>{copy.lockedSelection}</p>}
            {editable && !confirmingSubmit && (
              <button type="button" disabled={selectionBusy || selectionState.selectedCount === 0}
                onClick={() => setConfirmingSubmit(true)}>{copy.submitSelection}</button>
            )}
            {editable && confirmingSubmit && (
              <div className="gallery-submit-confirmation">
                <p>{copy.confirmSubmission}</p>
                <button type="button" disabled={selectionBusy} onClick={() => void submitSelection()}>{copy.confirmSubmit}</button>
                <button type="button" disabled={selectionBusy} onClick={() => setConfirmingSubmit(false)}>{copy.cancelSubmit}</button>
              </div>
            )}
          </>
        )}
        {selectionError !== null && <p className="gallery-selection-error" role="alert">{copy.selectionErrors[selectionError]}</p>}
      </section>
      <ol className="gallery-photo-grid">
        {photos.map((photo) => (
          <PhotoCard
            key={photo.photoId}
            photo={photo}
            copy={copy}
            onOpen={(event) => openPhoto(photo.photoId, event)}
            selected={selectedById.has(photo.photoId)}
            comment={selectedById.get(photo.photoId) ?? null}
            editable={editable}
            busy={selectionBusy}
            atLimit={atLimit}
            onToggle={() => void togglePhoto(photo.photoId)}
            onSaveComment={(comment) => saveComment(photo.photoId, comment)}
          />
        ))}
      </ol>
      <GalleryLightbox photo={activePhoto} index={activeIndex ?? 0} count={viewablePhotos.length} copy={copy}
        editable={editable} selected={activePhoto !== null && selectedById.has(activePhoto.photoId)}
        disabled={selectionBusy || (atLimit && activePhoto !== null && !selectedById.has(activePhoto.photoId))}
        onToggle={() => { if (activePhoto !== null) void togglePhoto(activePhoto.photoId); }}
        onNavigate={navigate}
        onDismiss={() => {
          setActiveIndex(null);
          openerRef.current?.focus();
        }}
      />
    </>
  );
}
