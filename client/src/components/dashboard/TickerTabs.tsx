import { useState, useRef, useEffect } from "react";
import { Plus, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type TickerData } from "@/lib/api";
import { cn } from "@/lib/utils";

interface TickerTabsProps {
  tickers: TickerData[];
  activeTickerId: number | null;
  onSelectTicker: (id: number) => void;
  onRemoveTicker: (id: number) => void;
  onAddTicker: (symbol: string) => void;
  isAdding?: boolean;
}

const TICKER_COLORS: Record<string, string> = {
  ES: "#f59e0b", NQ: "#3b82f6", YM: "#ef4444", RTY: "#10b981",
  BTC: "#f7931a", ETH: "#627eea", SPY: "#22c55e", QQQ: "#8b5cf6",
  AAPL: "#a3a3a3", TSLA: "#ef4444", AMZN: "#ff9900", NVDA: "#76b900",
  MSFT: "#00a4ef", GOOG: "#4285f4", META: "#0668e1", AMD: "#ed1c24",
  GC: "#fbbf24", CL: "#78350f", SI: "#c0c0c0",
};

function getTickerColor(symbol: string): string {
  const base = symbol.replace(/[0-9!]/g, "").toUpperCase();
  return TICKER_COLORS[base] || "#f59e0b";
}

function inferExchange(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.includes("!") || /^(ES|NQ|YM|RTY|GC|CL|SI|ZB|ZN|MES|MNQ|M2K|MYM)\d*$/.test(s)) return "CME_MINI";
  if (/^(BTC|ETH|SOL|DOGE|XRP|ADA)/.test(s)) return "COINBASE";
  return "NASDAQ";
}

export function TickerTabs({ tickers, activeTickerId, onSelectTicker, onRemoveTicker, onAddTicker, isAdding }: TickerTabsProps) {
  const [showAddInput, setShowAddInput] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showAddInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showAddInput]);

  const handleAdd = () => {
    const symbol = newSymbol.trim().toUpperCase();
    if (!symbol) return;
    onAddTicker(symbol);
    setNewSymbol("");
    setShowAddInput(false);
  };

  return (
    <div className="h-10 border-b border-border bg-card/80 flex items-center px-2 gap-1 shrink-0 overflow-x-auto" data-testid="ticker-tabs-bar">
      {tickers.map((ticker) => {
        const isActive = ticker.id === activeTickerId;
        return (
          <div
            key={ticker.id}
            className={cn(
              "group flex items-center gap-1.5 px-3 py-1.5 rounded-t text-xs font-bold font-mono transition-all whitespace-nowrap border-b-2 cursor-pointer",
              isActive
                ? "bg-background text-amber-400 border-b-amber-400 shadow-[0_-1px_8px_-3px_rgba(245,158,11,0.25)]"
                : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30 border-b-transparent"
            )}
            data-testid={`button-ticker-${ticker.symbol}`}
          >
            <div
              className="flex items-center gap-1.5 flex-1"
              onClick={() => onSelectTicker(ticker.id)}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: ticker.color || "#f59e0b" }}
              />
              <span>{ticker.symbol}</span>
              <span className={cn(
                "text-[10px] font-normal hidden sm:inline",
                isActive ? "text-amber-400/60" : "text-muted-foreground/50"
              )}>
                {ticker.displayName}
              </span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemoveTicker(ticker.id);
              }}
              data-testid={`button-close-ticker-${ticker.symbol}`}
              className={cn(
                "ml-1 p-0.5 rounded-sm transition-all",
                isActive
                  ? "text-amber-400/60 hover:text-red-400 hover:bg-red-400/10"
                  : "opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-red-400 hover:bg-red-400/10"
              )}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      {showAddInput ? (
        <div className="flex items-center gap-1 ml-1">
          <Input
            ref={inputRef}
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") { setShowAddInput(false); setNewSymbol(""); }
            }}
            placeholder="e.g. AAPL"
            className="h-7 w-28 text-xs font-mono bg-background border-primary/50 focus:border-primary"
            data-testid="input-add-ticker"
            disabled={isAdding}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-primary hover:text-primary"
            onClick={handleAdd}
            disabled={!newSymbol.trim() || isAdding}
            data-testid="button-confirm-add-ticker"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => { setShowAddInput(false); setNewSymbol(""); }}
            data-testid="button-cancel-add-ticker"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-primary shrink-0 ml-1"
          data-testid="button-add-ticker"
          onClick={() => setShowAddInput(true)}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

export function EmptyWorkspace({ onAddTicker }: { onAddTicker: (symbol: string) => void }) {
  const [symbol, setSymbol] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex-1 flex items-center justify-center bg-background" data-testid="empty-workspace">
      <div className="text-center space-y-6 max-w-md">
        <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <Search className="h-8 w-8 text-primary" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold font-mono text-foreground" data-testid="text-empty-title">
            Open a Workspace
          </h2>
          <p className="text-sm text-muted-foreground">
            Add a ticker to start analyzing. Type a symbol below to get started.
          </p>
        </div>
        <div className="flex items-center gap-2 max-w-xs mx-auto">
          <Input
            ref={inputRef}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter" && symbol.trim()) {
                onAddTicker(symbol.trim().toUpperCase());
                setSymbol("");
              }
            }}
            placeholder="Type a symbol (e.g. AAPL, ES1!, NQ1!)"
            className="h-10 text-sm font-mono bg-card border-border focus:border-primary"
            data-testid="input-empty-workspace-ticker"
          />
          <Button
            onClick={() => {
              if (symbol.trim()) {
                onAddTicker(symbol.trim().toUpperCase());
                setSymbol("");
              }
            }}
            disabled={!symbol.trim()}
            className="h-10 px-4"
            data-testid="button-empty-workspace-add"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 justify-center">
          {["ES1!", "NQ1!", "BTCUSD", "AAPL", "SPY", "TSLA", "NVDA"].map((s) => (
            <button
              key={s}
              onClick={() => onAddTicker(s)}
              className="px-3 py-1.5 rounded-full text-xs font-mono bg-muted/30 border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all"
              data-testid={`button-quick-add-${s}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export { getTickerColor, inferExchange };
