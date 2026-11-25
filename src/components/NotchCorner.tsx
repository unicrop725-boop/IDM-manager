import React, { useEffect, useLayoutEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * Notched top-right corner for cards: a tab with inverted (concave) corners holding round
 * action buttons. The parent must be a `.notch-card`. The concave fillets are painted in the
 * parent's own background colour, which is read at render time so it works in any theme.
 */
export const NotchCorner: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const ref = useRef<HTMLDivElement>(null);

  // Copy the card's real background colour into --card-bg (used by the notch curves and the
  // header/footer gradients). It must be re-read whenever the theme changes, otherwise the old
  // colour stays stuck on the card.
  const sync = () => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const bg = getComputedStyle(parent).backgroundColor;
    parent.style.setProperty("--card-bg", bg);
    el.style.setProperty("--card-bg", bg);
  };

  useLayoutEffect(sync);

  useEffect(() => {
    let t: number | undefined;
    const observer = new MutationObserver(() => {
      sync();
      // run again once any colour transition on the card has finished
      window.clearTimeout(t);
      t = window.setTimeout(sync, 320);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    return () => {
      observer.disconnect();
      window.clearTimeout(t);
    };
  }, []);

  return (
    <div ref={ref} className="notch-corner">
      <i data-corner="tl" />
      <i data-corner="br" />
      {children}
    </div>
  );
};

/** Open dialogs, innermost last: only the top one answers Esc, Tab and backdrop clicks. */
const openDialogs: symbol[] = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Standard dialog behaviour, applied to every modal through its close button (every modal has one):
 * role="dialog" + aria-modal, a name, focus moved inside and kept inside (Tab / Shift+Tab), Esc and a click on the
 * dimmed backdrop close it, and focus returns to whatever opened it.
 */
function useDialogBehavior(buttonRef: React.RefObject<HTMLButtonElement>, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const button = buttonRef.current;
    const card = button?.closest<HTMLElement>(".notch-card");
    const overlay = card?.parentElement;
    if (!button || !card || !overlay) return;

    const id = Symbol("dialog");
    openDialogs.push(id);
    const opener = document.activeElement as HTMLElement | null;

    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    if (!card.hasAttribute("aria-label")) {
      const title = card.querySelector<HTMLElement>("h1, h2, h3, .font-semibold, .font-bold")?.textContent?.trim();
      card.setAttribute("aria-label", title || "Dialog");
    }
    card.tabIndex = -1;

    const focusables = () => Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (!card.contains(document.activeElement)) {
      (focusables().find((el) => el !== button) ?? card).focus({ preventScroll: true });
    }

    const isTop = () => openDialogs[openDialogs.length - 1] === id;

    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return;
      if (e.key === "Escape") {
        // A dropdown that is open inside the dialog closes first.
        if (card.querySelector('[aria-expanded="true"]')) return;
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === "Tab") {
        const list = focusables();
        if (list.length === 0) {
          e.preventDefault();
          return;
        }
        const first = list[0];
        const last = list[list.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (!active || !card.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && (active === first || active === card)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    // Close on a click on the dimmed backdrop, but not at the end of a text selection that started inside the card.
    let downOnBackdrop = false;
    const onDown = (e: MouseEvent) => {
      downOnBackdrop = e.target === overlay;
    };
    const onUp = (e: MouseEvent) => {
      if (downOnBackdrop && e.target === overlay && isTop()) closeRef.current();
      downOnBackdrop = false;
    };

    document.addEventListener("keydown", onKey, true);
    overlay.addEventListener("mousedown", onDown);
    overlay.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      overlay.removeEventListener("mousedown", onDown);
      overlay.removeEventListener("mouseup", onUp);
      const i = openDialogs.indexOf(id);
      if (i >= 0) openDialogs.splice(i, 1);
      if (opener && opener !== document.body && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [buttonRef]);
}

/** Notch containing a single round close button. Also gives its modal standard dialog behaviour. */
export const ModalCorner: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  useDialogBehavior(buttonRef, onClose);
  return (
    <NotchCorner>
      <button ref={buttonRef} type="button" onClick={onClose} className="notch-action notch-action--close" aria-label="Close" title="Close">
        <X className="w-5 h-5" strokeWidth={1.8} />
      </button>
    </NotchCorner>
  );
};
