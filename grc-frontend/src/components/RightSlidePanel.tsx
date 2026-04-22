"use client";

import React from "react";
import { X } from "lucide-react";

interface RightSlidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  widthClassName?: string;
  showBackdrop?: boolean;
}

export default function RightSlidePanel({
  isOpen,
  onClose,
  title,
  children,
  widthClassName = "w-[780px]",
  showBackdrop = false,
}: RightSlidePanelProps) {
  if (!isOpen) return null;

  return (
    <>
      {showBackdrop && (
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/30"
        />
      )}

      <div
        className={`fixed inset-y-0 right-0 z-50 flex ${widthClassName} flex-col border-l border-slate-200 bg-white shadow-2xl`}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-900"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </>
  );
}
