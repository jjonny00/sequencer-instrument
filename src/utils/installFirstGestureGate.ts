import { unlockAudioSyncHard, hasHardUnlocked } from "./audioUnlock";

/**
 * Installs earliest-gesture unlock + click re-emit, once.
 * Does NOT block events, does NOT change layout.
 */
let installed = false;

export function installFirstGestureGate() {
  if (installed) return;
  installed = true;

  let downTarget: EventTarget | null = null;
  let downPointerId: number | null = null;
  let downTouchId: number | null = null;
  let downCoords: { x: number; y: number } | null = null;

  const extractPointerId = (event: Event): number | null => {
    return typeof (event as PointerEvent).pointerId === "number"
      ? (event as PointerEvent).pointerId
      : null;
  };

  const extractTouchId = (event: Event): number | null => {
    if ("changedTouches" in event) {
      const changed = (event as TouchEvent).changedTouches?.[0];
      if (changed) {
        return typeof changed.identifier === "number" ? changed.identifier : null;
      }
    }
    if ("touches" in event) {
      const active = (event as TouchEvent).touches?.[0];
      if (active) {
        return typeof active.identifier === "number" ? active.identifier : null;
      }
    }
    return null;
  };

  const extractCoords = (event: Event): { x: number; y: number } | null => {
    if ("clientX" in event && "clientY" in event) {
      const { clientX, clientY } = event as PointerEvent;
      if (typeof clientX === "number" && typeof clientY === "number") {
        return { x: clientX, y: clientY };
      }
    }

    if ("changedTouches" in event) {
      const touch = (event as TouchEvent).changedTouches?.[0];
      if (touch) {
        return { x: touch.clientX, y: touch.clientY };
      }
    }

    if ("touches" in event) {
      const touch = (event as TouchEvent).touches?.[0];
      if (touch) {
        return { x: touch.clientX, y: touch.clientY };
      }
    }

    return null;
  };

  const resetGestureState = () => {
    downTarget = null;
    downPointerId = null;
    downTouchId = null;
    downCoords = null;
  };

  const onDown = (event: Event) => {
    downTarget = (event as any).target ?? null;
    downPointerId = extractPointerId(event);
    downTouchId = extractTouchId(event);
    downCoords = extractCoords(event);

    // Hard unlock INSIDE the earliest gesture turn
    unlockAudioSyncHard();
  };

  const resolveTarget = (upEvent: Event): HTMLElement | null => {
    const upTarget = (upEvent as any).target as HTMLElement | null;

    if (upTarget && typeof upTarget.dispatchEvent === "function") {
      // If the up target matches or contains the original target, prefer it.
      if (
        (downTarget instanceof Node && upTarget.contains(downTarget)) ||
        upTarget === downTarget
      ) {
        return upTarget;
      }
    }

    const original = downTarget as HTMLElement | null;
    if (original && typeof original.dispatchEvent === "function") {
      return original;
    }

    if (downCoords) {
      const candidate = document.elementFromPoint(
        downCoords.x,
        downCoords.y
      ) as HTMLElement | null;
      if (candidate && typeof candidate.dispatchEvent === "function") {
        return candidate;
      }
    }

    return null;
  };

  const reemitClick = (upEvent: Event) => {
    const pointerId = extractPointerId(upEvent);
    const touchId = extractTouchId(upEvent);

    const pointerMatches =
      downPointerId != null && pointerId != null
        ? pointerId === downPointerId
        : downPointerId == null || pointerId == null;
    const touchMatches =
      downTouchId != null && touchId != null
        ? touchId === downTouchId
        : downTouchId == null || touchId == null;

    if (!pointerMatches || !touchMatches) {
      return;
    }

    const target = resolveTarget(upEvent);
    if (!target) {
      return;
    }

    try {
      const ev = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      });
      target.dispatchEvent(ev);
    } catch {}
  };

  const onUp = (event: Event) => {
    reemitClick(event);
    resetGestureState();

    if (hasHardUnlocked()) {
      remove();
    }
  };

  const onCancel = () => {
    resetGestureState();
  };

  const add = () => {
    const options = { capture: true, passive: true } as const;
    document.addEventListener("pointerdown", onDown, options);
    document.addEventListener("touchstart", onDown, options);
    document.addEventListener("mousedown", onDown, options);

    document.addEventListener("pointerup", onUp, options);
    document.addEventListener("touchend", onUp, options);
    document.addEventListener("mouseup", onUp, options);

    document.addEventListener("pointercancel", onCancel, options);
    document.addEventListener("touchcancel", onCancel, options);
  };

  const remove = () => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("touchstart", onDown, true);
    document.removeEventListener("mousedown", onDown, true);

    document.removeEventListener("pointerup", onUp, true);
    document.removeEventListener("touchend", onUp, true);
    document.removeEventListener("mouseup", onUp, true);

    document.removeEventListener("pointercancel", onCancel, true);
    document.removeEventListener("touchcancel", onCancel, true);
  };

  add();
}
