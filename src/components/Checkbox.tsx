import React from "react";

interface CheckboxProps {
  checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  title?: string;
}

/** Inset "pressed" checkbox, styled by .fancy-checkbox in index.css. */
export const Checkbox: React.FC<CheckboxProps> = ({ checked, onChange, className = "", title }) => (
  <label className={`fancy-checkbox ${className}`} title={title}>
    <input type="checkbox" checked={checked} onChange={onChange} />
    <span className="checkmark" />
  </label>
);
