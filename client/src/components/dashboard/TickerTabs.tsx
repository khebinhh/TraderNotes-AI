import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type TickerData } from "@/lib/api";
import { cn } from "@/lib/utils";

interface TickerTabsProps {
  tickers: TickerData[];
  activeTickerId: number | null;
  onSelectTicker: (id: number) => void;
}

export function TickerTabs({ tickers, activeTickerId, onSelectTicker }: TickerTabsProps) {
  return (
    <div className="h-10 border-b border-border bg-card/80 flex items-center px-2 gap-1 shrink-0 overflow-x-auto" data-testid="ticker-tabs-bar">
      {tickers.map((ticker) => {
        const isActive = ticker.id === activeTickerId;
        return (
          <button
            key={ticker.id}
            onClick={() => onSelectTicker(ticker.id)}
            data-testid={`button-ticker-${ticker.symbol}`}
            className={cn(
              "flex items-center gap-2 px-4 py-1.5 rounded-t text-xs font-bold font-mono transition-all whitespace-nowrap border-b-2",
              isActive
                ? "bg-background text-foreground border-b-primary shadow-[0_-1px_8px_-3px_rgba(245,158,11,0.15)]"
                : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30 border-b-transparent"
            )}
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: ticker.color || "#f59e0b" }}
            />
            <span>{ticker.symbol}</span>
            <span className={cn(
              "text-[10px] font-normal hidden sm:inline",
              isActive ? "text-muted-foreground" : "text-muted-foreground/50"
            )}>
              {ticker.displayName}
            </span>
          </button>
        );
      })}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0 ml-1"
        data-testid="button-add-ticker"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
