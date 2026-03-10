import { useState, useRef, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarFolderProps {
  label: string;
  count?: number;
  level: "month" | "week";
  defaultOpen?: boolean;
  isOpen?: boolean;
  onToggle?: (open: boolean) => void;
  children: React.ReactNode;
}

export function SidebarFolder({ label, count, level, defaultOpen = false, isOpen, onToggle, children }: SidebarFolderProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  const open = isOpen !== undefined ? isOpen : internalOpen;

  const toggle = () => {
    const next = !open;
    if (onToggle) onToggle(next);
    else setInternalOpen(next);
  };

  useEffect(() => {
    if (contentRef.current) {
      setHeight(open ? contentRef.current.scrollHeight : 0);
    }
  }, [open]);

  useEffect(() => {
    if (!contentRef.current || !open) return;
    const observer = new MutationObserver(() => {
      if (contentRef.current) {
        setHeight(contentRef.current.scrollHeight);
      }
    });
    observer.observe(contentRef.current, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [open]);

  const isMonth = level === "month";

  return (
    <div className={cn("select-none", isMonth ? "mb-0.5" : "ml-1")}>
      <button
        onClick={toggle}
        className={cn(
          "w-full flex items-center gap-1.5 py-1.5 px-2 rounded-md transition-colors min-h-[32px]",
          "hover:bg-muted/40 text-muted-foreground hover:text-foreground",
          isMonth ? "text-[11px] font-bold uppercase tracking-wider" : "text-[10px] font-semibold tracking-wide"
        )}
        data-testid={`folder-${label.replace(/\s+/g, "-").toLowerCase()}`}
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 transition-transform duration-200",
            open && "rotate-90"
          )}
        />
        <span className="truncate">{label}</span>
        {count !== undefined && count > 0 && (
          <span className={cn(
            "ml-auto shrink-0 text-[9px] font-mono px-1.5 rounded-full",
            "bg-muted/50 text-muted-foreground/70"
          )}>
            {count}
          </span>
        )}
      </button>
      <div
        ref={contentRef}
        style={{ maxHeight: height !== undefined ? `${height}px` : open ? "none" : "0px" }}
        className={cn(
          "overflow-hidden transition-[max-height] duration-200 ease-in-out",
          !open && "max-h-0"
        )}
      >
        <div className={cn(isMonth ? "pl-1" : "pl-2")}>
          {children}
        </div>
      </div>
    </div>
  );
}
