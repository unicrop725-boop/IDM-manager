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

/** Notch containing a single round close button. */
export const ModalCorner: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <NotchCorner>
    <button type="button" onClick={onClose} className="notch-action notch-action--close" aria-label="Close" title="Close">
      <X className="w-5 h-5" strokeWidth={1.8} />
    </button>
  </NotchCorner>
);
