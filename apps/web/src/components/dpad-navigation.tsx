"use client";

import { useEffect } from "react";

type Direction = "up" | "down" | "left" | "right";
type InputMode = "dpad" | "pointer" | "touch";

const FOCUSABLE_SELECTOR = [
  "[data-dpad-focusable]:not([data-dpad-disabled='true'])",
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[role='button']:not([aria-disabled='true'])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const OVERLAY_SCOPE_SELECTOR = [
  "[data-slot='select-content']",
  "[data-slot='dropdown-menu-content']",
  "[data-slot='dialog-content']",
  "[data-slot='drawer-content']",
  "[data-dpad-scope]",
].join(",");

const DPAD_ACTIVE_SELECTOR = "[data-dpad-active='true']";

const DIRECTION_BY_KEY: Record<string, Direction | undefined> = {
  ArrowUp: "up",
  Up: "up",
  ArrowDown: "down",
  Down: "down",
  ArrowLeft: "left",
  Left: "left",
  ArrowRight: "right",
  Right: "right",
};

const DIRECTION_BY_KEY_CODE: Record<number, Direction | undefined> = {
  37: "left",
  38: "up",
  39: "right",
  40: "down",
};

function isHTMLElement(node: EventTarget | null): node is HTMLElement {
  return node instanceof HTMLElement;
}

function isTextInput(element: HTMLElement | null): boolean {
  if (!element) {
    return false;
  }
  if (element.isContentEditable) {
    return true;
  }
  const tagName = element.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea";
}

function isNativeEditingControl(element: HTMLElement | null): boolean {
  if (!element) {
    return false;
  }
  const tagName = element.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function isVisible(element: HTMLElement): boolean {
  if (element.hidden || element.closest("[hidden],[aria-hidden='true'],[inert]")) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity) === 0
  ) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  );
}

function getVisibleFocusableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => !element.matches("[disabled],[aria-disabled='true']"))
    .filter(isVisible);
}

function getActiveScope(activeElement: HTMLElement | null): ParentNode {
  const activeScope = activeElement?.closest<HTMLElement>(OVERLAY_SCOPE_SELECTOR);
  if (activeScope && isVisible(activeScope)) {
    return activeScope;
  }

  const visibleOverlays = Array.from(
    document.querySelectorAll<HTMLElement>(OVERLAY_SCOPE_SELECTOR)
  ).filter((element) => {
    if (!isVisible(element)) {
      return false;
    }
    if (element.dataset.dpadScope !== undefined) {
      return true;
    }
    return element.querySelector(FOCUSABLE_SELECTOR) !== null;
  });

  return visibleOverlays.at(-1) ?? document;
}

function getElementCenter(element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function setInputMode(mode: InputMode): void {
  document.documentElement.dataset.dpadInput = mode;
}

function clearDpadActive(): void {
  document
    .querySelectorAll<HTMLElement>(DPAD_ACTIVE_SELECTOR)
    .forEach((element) => {
      delete element.dataset.dpadActive;
    });
}

function setDpadActive(element: HTMLElement): void {
  clearDpadActive();
  element.dataset.dpadActive = "true";
}

function getDirectionScore(
  from: HTMLElement,
  to: HTMLElement,
  direction: Direction
): number | null {
  const fromRect = from.getBoundingClientRect();
  const toRect = to.getBoundingClientRect();
  const fromCenter = getElementCenter(from);
  const toCenter = getElementCenter(to);
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;

  const verticalOverlap =
    Math.min(fromRect.bottom, toRect.bottom) - Math.max(fromRect.top, toRect.top);
  const horizontalOverlap =
    Math.min(fromRect.right, toRect.right) - Math.max(fromRect.left, toRect.left);

  let primaryDistance: number;
  let secondaryDistance: number;
  let overlapBonus = 0;

  switch (direction) {
    case "right":
      primaryDistance = dx;
      secondaryDistance = Math.abs(dy);
      overlapBonus = verticalOverlap > 0 ? -500 : 0;
      break;
    case "left":
      primaryDistance = -dx;
      secondaryDistance = Math.abs(dy);
      overlapBonus = verticalOverlap > 0 ? -500 : 0;
      break;
    case "down":
      primaryDistance = dy;
      secondaryDistance = Math.abs(dx);
      overlapBonus = horizontalOverlap > 0 ? -500 : 0;
      break;
    case "up":
      primaryDistance = -dy;
      secondaryDistance = Math.abs(dx);
      overlapBonus = horizontalOverlap > 0 ? -500 : 0;
      break;
  }

  if (primaryDistance <= 4) {
    return null;
  }

  return primaryDistance * 4 + secondaryDistance * 2 + overlapBonus;
}

function findNextFocusable(
  current: HTMLElement,
  candidates: HTMLElement[],
  direction: Direction
): HTMLElement | null {
  if (current.closest("[data-dpad-poster-grid]")) {
    const gridCandidate = findGridFocusable(current, candidates, direction);
    if (gridCandidate || direction !== "up") {
      return gridCandidate;
    }
  }

  let best: { element: HTMLElement; score: number } | null = null;

  for (const candidate of candidates) {
    if (candidate === current || candidate.contains(current)) {
      continue;
    }
    const score = getDirectionScore(current, candidate, direction);
    if (score === null) {
      continue;
    }
    if (!best || score < best.score) {
      best = { element: candidate, score };
    }
  }

  return best?.element ?? null;
}

function findGridFocusable(
  current: HTMLElement,
  candidates: HTMLElement[],
  direction: Direction
): HTMLElement | null {
  const posterGrid = current.closest("[data-dpad-poster-grid]");
  if (!posterGrid) {
    return null;
  }

  const posterCandidates = candidates.filter((candidate) =>
    posterGrid.contains(candidate)
  );
  if (!posterCandidates.includes(current)) {
    return null;
  }

  const currentRect = current.getBoundingClientRect();
  const currentCenter = getElementCenter(current);
  const scored = posterCandidates
    .filter((candidate) => candidate !== current)
    .map((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const center = getElementCenter(candidate);
      const dx = center.x - currentCenter.x;
      const dy = center.y - currentCenter.y;
      const rowOverlap =
        Math.min(currentRect.bottom, rect.bottom) -
        Math.max(currentRect.top, rect.top);
      const columnOverlap =
        Math.min(currentRect.right, rect.right) -
        Math.max(currentRect.left, rect.left);

      if (direction === "right" && dx <= 4) {
        return null;
      }
      if (direction === "left" && dx >= -4) {
        return null;
      }
      if (direction === "down" && dy <= 4) {
        return null;
      }
      if (direction === "up" && dy >= -4) {
        return null;
      }

      const isHorizontal = direction === "left" || direction === "right";
      const primaryDistance = isHorizontal ? Math.abs(dx) : Math.abs(dy);
      const secondaryDistance = isHorizontal ? Math.abs(dy) : Math.abs(dx);
      const alignedBonus =
        (isHorizontal && rowOverlap > 0) || (!isHorizontal && columnOverlap > 0)
          ? -1000
          : 0;

      return {
        element: candidate,
        score: primaryDistance * 4 + secondaryDistance * 2 + alignedBonus,
      };
    })
    .filter(
      (
        item
      ): item is {
        element: HTMLElement;
        score: number;
      } => item !== null
    )
    .sort((a, b) => a.score - b.score);

  if (scored[0]) {
    return scored[0].element;
  }

  return null;
}

function findInitialFocusable(candidates: HTMLElement[]): HTMLElement | null {
  if (candidates.length === 0) {
    return null;
  }

  const viewportCenter = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  };

  return candidates
    .map((element) => {
      const center = getElementCenter(element);
      return {
        element,
        score:
          Math.abs(center.y - viewportCenter.y) * 2 +
          Math.abs(center.x - viewportCenter.x),
      };
    })
    .sort((a, b) => a.score - b.score)[0]?.element ?? null;
}

function focusElement(element: HTMLElement): void {
  setDpadActive(element);
  element.focus({ preventScroll: true });
  element.scrollIntoView({
    block: "nearest",
    inline: "nearest",
    behavior: "smooth",
  });
}

function clickActiveElement(): boolean {
  const active = document.activeElement;
  if (!isHTMLElement(active) || isNativeEditingControl(active)) {
    return false;
  }
  if (!active.matches(FOCUSABLE_SELECTOR)) {
    return false;
  }
  if (!isVisible(active)) {
    return false;
  }
  active.click();
  return true;
}

function moveFocus(direction: Direction): boolean {
  const activeElement = isHTMLElement(document.activeElement)
    ? document.activeElement
    : null;
  const scope = getActiveScope(activeElement);
  const candidates = getVisibleFocusableElements(scope);

  if (candidates.length === 0) {
    return false;
  }

  if (!activeElement || !candidates.includes(activeElement) || !isVisible(activeElement)) {
    const initial = findInitialFocusable(candidates);
    if (!initial) {
      return false;
    }
    focusElement(initial);
    return true;
  }

  const next = findNextFocusable(activeElement, candidates, direction);
  if (!next) {
    return false;
  }

  focusElement(next);
  return true;
}

function getDirectionFromEvent(event: KeyboardEvent): Direction | undefined {
  return DIRECTION_BY_KEY[event.key] ?? DIRECTION_BY_KEY_CODE[event.keyCode];
}

function isActivationKey(event: KeyboardEvent): boolean {
  return (
    event.key === "Enter" ||
    event.key === "NumpadEnter" ||
    event.key === " " ||
    event.key === "Spacebar" ||
    event.key === "Select" ||
    event.keyCode === 13
  );
}

function useKeyboardDpadNavigation() {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const target = isHTMLElement(event.target) ? event.target : null;
      const direction = getDirectionFromEvent(event);

      if (direction) {
        if (isTextInput(target)) {
          return;
        }
        setInputMode("dpad");
        if (moveFocus(direction)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (!isActivationKey(event) || isNativeEditingControl(target)) {
        return;
      }

      if (clickActiveElement()) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);
}

function useGamepadDpadNavigation() {
  useEffect(() => {
    let animationFrame = 0;
    let lastMove = 0;
    let activationWasPressed = false;
    const repeatMs = 180;

    function readDirection(gamepad: Gamepad): Direction | null {
      const buttons = gamepad.buttons;
      if (buttons[12]?.pressed || gamepad.axes[1] < -0.65) {
        return "up";
      }
      if (buttons[13]?.pressed || gamepad.axes[1] > 0.65) {
        return "down";
      }
      if (buttons[14]?.pressed || gamepad.axes[0] < -0.65) {
        return "left";
      }
      if (buttons[15]?.pressed || gamepad.axes[0] > 0.65) {
        return "right";
      }
      return null;
    }

    function tick(now: number) {
      const gamepads = navigator.getGamepads?.() ?? [];
      const gamepad = Array.from(gamepads).find(Boolean);

      if (gamepad) {
        const direction = readDirection(gamepad);
        if (direction && now - lastMove > repeatMs) {
          setInputMode("dpad");
          moveFocus(direction);
          lastMove = now;
        }

        const activationPressed = Boolean(gamepad.buttons[0]?.pressed);
        if (activationPressed && !activationWasPressed) {
          clickActiveElement();
        }
        activationWasPressed = activationPressed;
      }

      animationFrame = window.requestAnimationFrame(tick);
    }

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);
}

export function DpadNavigation() {
  useKeyboardDpadNavigation();
  useGamepadDpadNavigation();
  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (event.pointerType !== "mouse") {
        setInputMode("touch");
        clearDpadActive();
        return;
      }

      setInputMode("pointer");
      clearDpadActive();
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.pointerType === "mouse") {
        setInputMode("pointer");
        return;
      }

      setInputMode("touch");
      clearDpadActive();
    }

    function handleFocusIn(event: FocusEvent) {
      if (!isHTMLElement(event.target)) {
        return;
      }
      const focusable = event.target.closest<HTMLElement>(
        "[data-dpad-focusable]"
      );
      if (!focusable) {
        clearDpadActive();
        return;
      }
      setDpadActive(focusable);
    }

    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    window.addEventListener("pointerdown", handlePointerDown, {
      passive: true,
    });
    window.addEventListener("focusin", handleFocusIn);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("focusin", handleFocusIn);
    };
  }, []);
  return null;
}
