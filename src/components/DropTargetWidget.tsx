import React, { useState } from "react";
import { ArrowDownToLine } from "lucide-react";

interface DropTargetWidgetProps {
  onDropUrl: (url: string) => void;
  onClose?: () => void;
}

export const DropTargetWidget: React.FC<DropTargetWidgetProps> = ({
  onDropUrl,
}) => {
  const [isOver, setIsOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOver(false);

    let droppedUrl = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (!droppedUrl) {
      // Check html for links
      const html = e.dataTransfer.getData("text/html");
      const match = html.match(/href=["'](https?:\/\/[^"']+)["']/i);
      if (match) droppedUrl = match[1];
    }

    if (droppedUrl && droppedUrl.trim().startsWith("http")) {
      onDropUrl(droppedUrl.trim());
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`fixed bottom-14 right-14 w-20 h-20 rounded-2xl flex flex-col items-center justify-center cursor-pointer select-none shadow-2xl transition-all duration-200 z-40 border ${
        isOver
          ? "gradient-accent scale-110 border-white/40 ring-4 ring-purple-500/30"
          : "bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
      title="Drop link here to download"
    >
      <ArrowDownToLine
        className={`w-6 h-6 transition-transform ${isOver ? "text-white animate-bounce" : "text-purple-400"}`}
      />
      <span className={`text-[10px] font-semibold mt-1 ${isOver ? "text-white" : "text-[var(--text-secondary)]"}`}>
        Drop Link
      </span>
    </div>
  );
};
