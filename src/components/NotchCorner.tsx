import React, { useLayoutEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * Notched top-right corner for cards: a tab with inverted (concave) corners holding round
 * action buttons. The parent must be a `.notch-card`. The concave fillets are painted in the
 * parent's own background colour, which is read at render time so it works in any theme.
 */
export const NotchCorner: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const bg = getComputedStyle(parent).backgroundColor;
    parent.style.setProperty("--card-bg", bg);
    el.style.setProperty("--card-bg", bg);
  });

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
