type Point = { readonly x: number; readonly y: number; readonly time: number };

export type PreviewPointer = Point & {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  readonly button: number;
};

type Bounds = { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };

export function outsideDialog(point: Point, bounds: Bounds): boolean {
  return point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom;
}

export function backdropTap(start: Point | null, end: Point, bounds: Bounds): boolean {
  return start !== null && outsideDialog(start, bounds) && outsideDialog(end, bounds) &&
    end.time >= start.time && end.time - start.time <= 1_500 &&
    Math.abs(end.x - start.x) <= 10 && Math.abs(end.y - start.y) <= 10;
}

function finitePoint(point: Point): boolean {
  return [point.x, point.y, point.time].every(Number.isFinite);
}

function unzoomed(scale: number): boolean { return Number.isFinite(scale) && scale > 0 && scale <= 1.01; }

/** Single, completed touch only. No rendering/network work is performed on move. */
export class PreviewSwipe {
  private start: PreviewPointer | null = null;

  begin(pointer: PreviewPointer, viewportScale = 1): void {
    // Another finger invalidates the entire gesture, not just that pointer.
    if (this.start !== null || !pointer.isPrimary) {
      this.cancel();
      return;
    }
    if (pointer.pointerType !== "touch" || pointer.button !== 0 ||
      !finitePoint(pointer) || !unzoomed(viewportScale)) return;
    this.start = pointer;
  }

  move(pointer: PreviewPointer, viewportScale = 1): void {
    const start = this.start;
    if (start === null || pointer.pointerId !== start.pointerId) return;
    const dx = Math.abs(pointer.x - start.x);
    const dy = Math.abs(pointer.y - start.y);
    if (!finitePoint(pointer) || !unzoomed(viewportScale) ||
      pointer.time < start.time || pointer.time - start.time > 1_500 ||
      (dy >= 12 && dy >= dx)) this.cancel();
  }

  end(pointer: PreviewPointer, viewportScale = 1): -1 | 1 | null {
    const start = this.start;
    if (start === null || pointer.pointerId !== start.pointerId) return null;
    this.move(pointer, viewportScale);
    if (this.start === null || pointer.pointerType !== "touch" || !pointer.isPrimary) {
      this.cancel();
      return null;
    }
    this.cancel();
    const dx = pointer.x - start.x;
    const dy = pointer.y - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
    return dx < 0 ? 1 : -1;
  }

  cancel(): void { this.start = null; }
}
