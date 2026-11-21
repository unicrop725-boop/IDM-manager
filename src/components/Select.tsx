import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

interface SelectProps {
  value?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  className?: string;
  disabled?: boolean;
  id?: string;
  children?: React.ReactNode;
}

interface Opt {
  value: string;
  label: React.ReactNode;
}

/**
 * Drop-in replacement for a native <select>. Takes the same <option> children and an onChange that
 * receives `e.target.value`, but draws an animated list (fade + slide, rounded, hover highlight).
 * The list is rendered in a portal so it is never clipped by a modal's overflow.
 */
export const Select: React.FC<SelectProps> = ({ value, onChange, className = "", disabled, id, children }) => {
  const options = useMemo<Opt[]>(() => {
    const out: Opt[] = [];
    React.Children.toArray(children).forEach((child) => {
      if (React.isValidElement(child) && child.type === "option") {
        const p = child.props as { value?: string | number; children?: React.ReactNode };
        const label = p.children;
        out.push({ value: String(p.value ?? (typeof label === "string" ? label : "")), label });
      }
    });
    return out;
  }, [children]);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, up: false });

  // like a native <select>: an unmatched value shows the first option
  const current = options.find((o) => o.value === String(value ?? "")) ?? options[0];

  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const listH = Math.min(260, options.length * 40 + 10);
    const up = window.innerHeight - r.bottom < listH + 16 && r.top > listH + 16;
    setPos({ left: r.left, top: up ? r.top - 8 : r.bottom + 8, width: r.width, up });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onMove = () => place();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  const toggle = () => {
    if (disabled) return;
    if (!open) {
      setEverOpened(true);
      setActive(Math.max(0, options.findIndex((o) => o.value === String(value ?? ""))));
    }
    setOpen(!open);
  };

  const choose = (v: string) => {
    setOpen(false);
    triggerRef.current?.focus();
    if (v === String(value ?? "")) return;
    onChange?.({ target: { value: v }, currentTarget: { value: v } } as unknown as React.ChangeEvent<HTMLSelectElement>);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "Escape" && open) {
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        toggle();
        return;
      }
      setActive((a) => (e.key === "ArrowDown" ? Math.min(options.length - 1, a + 1) : Math.max(0, a - 1)));
    } else if ((e.key === "Enter" || e.key === " ") && open) {
      e.preventDefault();
      if (options[active]) choose(options[active].value);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={onKeyDown}
        style={{ paddingRight: 36 }}
        className={`select-trigger relative text-left flex items-center cursor-pointer disabled:opacity-50 ${className}`}
      >
        <span className="truncate flex-1">{current?.label ?? ""}</span>
        <ChevronDown
          className={`absolute right-3 top-1/2 -mt-2 w-4 h-4 text-[var(--text-secondary)] transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {everOpened &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            className={`select-list ${open ? "select-list--open" : ""} ${pos.up ? "select-list--up" : ""}`}
            style={{
              left: pos.left,
              top: pos.top,
              minWidth: pos.width,
            }}
          >
            {options.map((o, i) => {
              const selected = o.value === String(value ?? "");
              return (
                <div
                  key={o.value + i}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o.value)}
                  className={`select-item ${selected ? "select-item--selected" : ""} ${
                    i === active ? "select-item--active" : ""
                  }`}
                >
                  <span className="truncate">{o.label}</span>
                  {selected && <Check className="w-4 h-4 flex-shrink-0" strokeWidth={2.2} />}
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
};
