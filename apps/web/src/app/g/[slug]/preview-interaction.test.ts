import { describe, expect, it } from "vitest";

import { backdropTap, outsideDialog, PreviewSwipe, type PreviewPointer } from "./preview-interaction";

const point: PreviewPointer = { x: 200, y: 100, time: 100, pointerId: 1, pointerType: "touch", isPrimary: true, button: 0 };
const end = (changes: Partial<PreviewPointer> = {}): PreviewPointer => ({ ...point, x: 100, time: 500, ...changes });

describe("completed preview-stage swipes (GAL-006, IMG-001, PERF-003)", () => {
  it.each([[-100, 1], [100, -1]] as const)("moves exactly one photo for horizontal delta %s", (delta, direction) => {
    const swipe = new PreviewSwipe();
    swipe.begin(point);
    expect(swipe.end(end({ x: point.x + delta }))).toBe(direction);
    expect(swipe.end(end({ x: point.x + delta }))).toBeNull();
  });

  it.each([0, 10, 47, -47])("ignores taps and short movement %s", (delta) => {
    const swipe = new PreviewSwipe(); swipe.begin(point);
    expect(swipe.end(end({ x: point.x + delta }))).toBeNull();
  });

  it.each(["mouse", "pen", ""])("ignores %s input", (pointerType) => {
    const swipe = new PreviewSwipe(); swipe.begin({ ...point, pointerType });
    expect(swipe.end(end({ pointerType }))).toBeNull();
  });

  it("rejects vertical and diagonal gestures even when horizontal threshold is met", () => {
    for (const x of [200, 140, 100]) {
      const swipe = new PreviewSwipe(); swipe.begin(point);
      expect(swipe.end(end({ x, y: 180 }))).toBeNull();
    }
  });

  it("does not reinterpret a vertical scroll as a later horizontal swipe", () => {
    const swipe = new PreviewSwipe(); swipe.begin(point);
    swipe.move(end({ x: 195, y: 115, time: 120 }));
    expect(swipe.end(end())).toBeNull();
  });

  it.each([99, 1_601])("rejects backwards clocks and long holds (%s)", (time) => {
    const swipe = new PreviewSwipe(); swipe.begin(point);
    expect(swipe.end(end({ time }))).toBeNull();
  });

  it("cancels multi-touch rather than replacing the first finger", () => {
    const swipe = new PreviewSwipe(); swipe.begin(point);
    swipe.begin({ ...point, pointerId: 2, isPrimary: false });
    expect(swipe.end(end())).toBeNull();
    expect(swipe.end(end({ pointerId: 2, isPrimary: false }))).toBeNull();
  });

  it("can explicitly cancel on multi-touch elsewhere, capture loss, blur or navigation", () => {
    const swipe = new PreviewSwipe(); swipe.begin(point); swipe.cancel();
    expect(swipe.end(end())).toBeNull();
    swipe.begin(point);
    expect(swipe.end(end())).toBe(1);
  });

  it("ignores unrelated pointer events without completing the tracked gesture", () => {
    const swipe = new PreviewSwipe(); swipe.begin(point);
    swipe.move(end({ pointerId: 9, y: 900 }));
    expect(swipe.end(end({ pointerId: 9 }))).toBeNull();
    expect(swipe.end(end())).toBe(1);
  });

  it.each([1.2, 2, NaN, Infinity, 0])("does not navigate a zoomed or invalid viewport (%s)", (scale) => {
    const swipe = new PreviewSwipe(); swipe.begin(point, scale);
    expect(swipe.end(end())).toBeNull();
    swipe.begin(point);
    expect(swipe.end(end(), scale)).toBeNull();
  });

  it("rejects malformed coordinates and primary/button state", () => {
    for (const changes of [{ x: NaN }, { y: Infinity }, { time: NaN }, { isPrimary: false }, { button: 2 }]) {
      const swipe = new PreviewSwipe(); swipe.begin({ ...point, ...changes });
      expect(swipe.end(end())).toBeNull();
    }
    const swipe = new PreviewSwipe(); swipe.begin(point);
    expect(swipe.end(end({ x: Infinity }))).toBeNull();
  });
});

describe("intentional modal backdrop dismissal (GAL-004/005/006)", () => {
  const bounds = { left: 20, top: 20, right: 300, bottom: 300 };
  const outside = { x: 10, y: 100, time: 100 };

  it("recognizes only coordinates strictly outside the dialog box", () => {
    expect(outsideDialog(outside, bounds)).toBe(true);
    expect(outsideDialog({ x: 20, y: 20, time: 100 }, bounds)).toBe(false);
    expect(outsideDialog({ x: 300, y: 300, time: 100 }, bounds)).toBe(false);
  });

  it("dismisses an outside tap, never an inside-to-outside drag or synthetic click", () => {
    expect(backdropTap(outside, { ...outside, time: 300 }, bounds)).toBe(true);
    expect(backdropTap(null, { ...outside, time: 300 }, bounds)).toBe(false);
    expect(backdropTap({ ...outside, x: 150 }, { ...outside, time: 300 }, bounds)).toBe(false);
    expect(backdropTap(outside, { ...outside, x: 150, time: 300 }, bounds)).toBe(false);
  });

  it("ignores outside drags, holds and invalid timing", () => {
    expect(backdropTap(outside, { ...outside, y: 130, time: 300 }, bounds)).toBe(false);
    expect(backdropTap(outside, { ...outside, time: 1_601 }, bounds)).toBe(false);
    expect(backdropTap(outside, { ...outside, time: 99 }, bounds)).toBe(false);
  });
});
