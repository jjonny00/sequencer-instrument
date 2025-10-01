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

  const onDown = (e: Event) => {
    downTarget = (e as any).target ?? null;
    downPointerId = (e as PointerEvent).pointerId ?? null;

    // Hard unlock INSIDE the earliest gesture turn
    unlockAudioSyncHard();
  };

  const reemitClick = (upEvent: Event) => {
    const upTarget = (upEvent as any).target as HTMLElement | null;
    const samePointer =
      (upEvent as PointerEvent).pointerId != null &&
      downPointerId != null &&
      (upEvent as PointerEvent).pointerId === downPointerId;
    const sameNode = upTarget && downTarget && upTarget === downTarget;

    if (!samePointer && !sameNode) return;

    try {
      const el = upTarget ?? (downTarget as HTMLElement | null);
      if (el && typeof el.dispatchEvent === "function") {
        const ev = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        });
        el.dispatchEvent(ev);
      }
    } catch {}
  };

  const onUp = (e: Event) => {
    reemitClick(e);
    downTarget = null;
    downPointerId = null;

    if (hasHardUnlocked()) {
      remove();
    }
  };

  const add = () => {
    document.addEventListener("pointerdown", onDown, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchstart", onDown, {
      capture: true,
      passive: true,
    });
    document.addEventListener("mousedown", onDown, {
      capture: true,
      passive: true,
    });

    document.addEventListener("pointerup", onUp, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchend", onUp, {
      capture: true,
      passive: true,
    });
    document.addEventListener("mouseup", onUp, {
      capture: true,
      passive: true,
    });
  };

  const remove = () => {
    document.removeEventListener("pointerdown", onDown, {
      capture: true,
    } as any);
    document.removeEventListener("touchstart", onDown, {
      capture: true,
    } as any);
    document.removeEventListener("mousedown", onDown, {
      capture: true,
    } as any);

    document.removeEventListener("pointerup", onUp, {
      capture: true,
    } as any);
    document.removeEventListener("touchend", onUp, {
      capture: true,
    } as any);
    document.removeEventListener("mouseup", onUp, {
      capture: true,
    } as any);
  };

  add();
}
