"use client";
import { useEffect, useRef, useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/shared/lib";
export function Modal({
  open,
  onClose,
  title,
  children,
  drawer = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      const previous = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        dialog.close();
        document.body.style.overflow = previous;
      };
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={cn("modal", drawer && "drawer")}
      aria-labelledby={id}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const rect = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Закрыть"
          onClick={onClose}
        >
          <X size={22} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
