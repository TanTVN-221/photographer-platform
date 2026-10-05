"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";

import type { GalleryImageSet, GalleryPhotoListItem } from "@photographer-platform/shared";

import type { GalleryCopy } from "../../../lib/i18n";
import { backdropTap, outsideDialog, PreviewSwipe, type PreviewPointer } from "./preview-interaction";

export type ViewablePhoto = GalleryPhotoListItem & { readonly images: GalleryImageSet };

function sample(event: PointerEvent<HTMLElement>): PreviewPointer {
  return { pointerId: event.pointerId, pointerType: event.pointerType, isPrimary: event.isPrimary,
    button: event.button, x: event.clientX, y: event.clientY, time: event.timeStamp };
}

function viewportScale(): number { return window.visualViewport?.scale ?? 1; }

export function GalleryLightbox({ photo, index, count, copy, editable, selected, disabled, onToggle, onNavigate, onDismiss }: {
  readonly photo: ViewablePhoto | null;
  readonly index: number;
  readonly count: number;
  readonly copy: GalleryCopy;
  readonly editable: boolean;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onToggle: () => void;
  readonly onNavigate: (direction: -1 | 1) => void;
  readonly onDismiss: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const swipeRef = useRef(new PreviewSwipe());
  const backdropRef = useRef<PreviewPointer | null>(null);
  const [failedPhotoId, setFailedPhotoId] = useState<string | null>(null);
  const isOpen = photo !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (!isOpen) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const cancel = () => { swipeRef.current.cancel(); backdropRef.current = null; };
    window.addEventListener("blur", cancel);
    return () => {
      cancel();
      document.body.style.overflow = overflow;
      window.removeEventListener("blur", cancel);
    };
  }, [isOpen]);

  // Navigation or a selection-control availability change invalidates a swipe.
  useEffect(() => {
    swipeRef.current.cancel();
    const dialog = dialogRef.current;
    // Navigation can reach a page boundary; selection can become busy/locked.
    // Restore an enabled modal target so subsequent arrows/Escape still work.
    if (dialog?.open && (!dialog.contains(document.activeElement) ||
      (document.activeElement instanceof HTMLButtonElement && document.activeElement.disabled))) {
      closeButtonRef.current?.focus();
    }
  }, [photo?.photoId, disabled, editable]);

  function navigate(direction: -1 | 1) {
    swipeRef.current.cancel();
    setFailedPhotoId(null);
    onNavigate(direction);
  }

  return (
    <dialog ref={dialogRef} className="gallery-lightbox" aria-labelledby="gallery-lightbox-title"
      aria-describedby={isOpen ? "gallery-lightbox-help" : undefined}
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          navigate(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}
      onClose={() => {
        swipeRef.current.cancel();
        backdropRef.current = null;
        setFailedPhotoId(null);
        onDismiss();
      }}
      onPointerDownCapture={(event) => {
        // Observe secondary touches even when they land on a control, not the stage.
        if (!event.isPrimary) swipeRef.current.cancel();
        const point = sample(event);
        backdropRef.current = event.isPrimary && event.button === 0 && event.target === event.currentTarget &&
          outsideDialog(point, event.currentTarget.getBoundingClientRect()) ? point : null;
      }}
      onPointerCancel={() => { swipeRef.current.cancel(); backdropRef.current = null; }}
      onClick={(event) => {
        const start = backdropRef.current;
        backdropRef.current = null;
        if (event.target === event.currentTarget && event.button === 0 && event.detail > 0 &&
          backdropTap(start, { x: event.clientX, y: event.clientY, time: event.timeStamp },
            event.currentTarget.getBoundingClientRect())) event.currentTarget.close();
      }}>
      {photo !== null && (
        <div className="gallery-lightbox-content">
          <div className="gallery-lightbox-topbar">
            <span role="status" aria-live="polite" aria-atomic="true">{copy.photoPosition(index + 1, count)} · {photo.fileName}</span>
            <button ref={closeButtonRef} type="button" onClick={() => dialogRef.current?.close()} aria-label={copy.closePreview}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div className="gallery-lightbox-stage"
            onPointerDown={(event) => swipeRef.current.begin(sample(event), viewportScale())}
            onPointerMove={(event) => swipeRef.current.move(sample(event), viewportScale())}
            onPointerUp={(event) => {
              const direction = swipeRef.current.end(sample(event), viewportScale());
              if (direction !== null) navigate(direction);
            }}
            onLostPointerCapture={() => swipeRef.current.cancel()}>
            {failedPhotoId === photo.photoId ? <p role="status">{copy.previewUnavailable}</p> : (
              // Exactly one generated preview; no originals or adjacent prefetch.
              <img key={photo.photoId} src={photo.images.preview.src} alt={photo.fileName}
                width={photo.images.preview.width ?? undefined} height={photo.images.preview.height ?? undefined}
                draggable={false} onError={() => setFailedPhotoId(photo.photoId)} />
            )}
          </div>
          <div className="gallery-lightbox-bottom">
            <div>
              <h2 id="gallery-lightbox-title">{photo.fileName}</h2>
              <span>{photo.width !== null && photo.height !== null
                ? `${photo.width} × ${photo.height} px` : copy.dimensionsUnknown}</span>
              <p id="gallery-lightbox-help">{copy.previewHelp}</p>
            </div>
            {editable && <button type="button" aria-pressed={selected} disabled={disabled} onClick={onToggle}>
              {selected ? copy.deselectPhoto : copy.selectPhoto}
            </button>}
            <nav aria-label={copy.previewNavigationLabel}>
              <button type="button" onClick={() => navigate(-1)} disabled={index === 0}>
                <span aria-hidden="true">← </span>{copy.previousPhoto}
              </button>
              <button type="button" onClick={() => navigate(1)} disabled={index === count - 1}>
                {copy.nextPhoto}<span aria-hidden="true"> →</span>
              </button>
            </nav>
          </div>
        </div>
      )}
    </dialog>
  );
}
