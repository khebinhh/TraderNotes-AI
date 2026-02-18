import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TickerTabs, EmptyWorkspace, getTickerColor, inferExchange } from "./TickerTabs";
import { StrategyRoom } from "./StrategyRoom";
import { ActionDashboard, type ActionDashboardHandle } from "./ActionDashboard";
import {
  fetchTickers, fetchNotesByTicker, fetchFullNote, fetchPriceRatio, seedData,
  isFuturesSymbol, createTicker, deleteTicker, fetchWorkspace, saveWorkspace,
  type TickerData, type NoteData, type FullNote, type PriceRatioData
} from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { LogOut, BookOpen, BarChart3 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type RoomMode = "strategy" | "action";

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const [roomMode, setRoomMode] = useState<RoomMode>("strategy");
  const actionDashboardRef = useRef<ActionDashboardHandle>(null);
  const pendingLevelRef = useRef<{ price: number; label: string; color: string } | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedTickerId, setSelectedTickerId] = useState<number | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [workspaceTickerIds, setWorkspaceTickerIds] = useState<number[]>([]);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);

  useEffect(() => {
    seedData().then(() => setSeeded(true)).catch(() => setSeeded(true));
  }, []);

  const { data: allTickers = [], isLoading: tickersLoading } = useQuery<TickerData[]>({
    queryKey: ["/api/tickers"],
    enabled: seeded,
  });

  const { data: workspace } = useQuery({
    queryKey: ["/api/workspace"],
    queryFn: fetchWorkspace,
    enabled: seeded,
  });

  useEffect(() => {
    if (!workspace || workspaceLoaded || allTickers.length === 0) return;

    if (workspace.activeTickers && workspace.activeTickers.length > 0) {
      const validIds = workspace.activeTickers.filter(id => allTickers.some(t => t.id === id));
      if (validIds.length > 0) {
        setWorkspaceTickerIds(validIds);
        const lastActive = workspace.lastActiveTicker && validIds.includes(workspace.lastActiveTicker)
          ? workspace.lastActiveTicker
          : validIds[0];
        setSelectedTickerId(lastActive);
        setWorkspaceLoaded(true);
        return;
      }
    }

    const defaultIds = allTickers.map(t => t.id);
    setWorkspaceTickerIds(defaultIds);
    if (defaultIds.length > 0) setSelectedTickerId(defaultIds[0]);
    persistWorkspace(defaultIds, defaultIds[0] || null);
    setWorkspaceLoaded(true);
  }, [workspace, allTickers, workspaceLoaded]);

  const workspaceTickers = allTickers.filter(t => workspaceTickerIds.includes(t.id));

  const persistWorkspace = useCallback((tickerIds: number[], activeId: number | null) => {
    saveWorkspace({ activeTickers: tickerIds, lastActiveTicker: activeId }).catch(() => {});
  }, []);

  const addTickerMutation = useMutation({
    mutationFn: async (symbol: string) => {
      const existing = allTickers.find(t => t.symbol.toUpperCase() === symbol.toUpperCase());
      if (existing) {
        if (workspaceTickerIds.includes(existing.id)) {
          setSelectedTickerId(existing.id);
          return existing;
        }
        const newIds = [...workspaceTickerIds, existing.id];
        setWorkspaceTickerIds(newIds);
        setSelectedTickerId(existing.id);
        persistWorkspace(newIds, existing.id);
        return existing;
      }

      const displayName = symbol.replace(/[0-9!]/g, "");
      const exchange = inferExchange(symbol);
      const color = getTickerColor(symbol);
      const created = await createTicker({ symbol, displayName, exchange, color });
      return created;
    },
    onSuccess: (ticker) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickers"] });
      if (!workspaceTickerIds.includes(ticker.id)) {
        const newIds = [...workspaceTickerIds, ticker.id];
        setWorkspaceTickerIds(newIds);
        setSelectedTickerId(ticker.id);
        persistWorkspace(newIds, ticker.id);
      }
      toast({ title: `${ticker.symbol} workspace opened` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add ticker", description: err.message, variant: "destructive" });
    },
  });

  const removeTickerMutation = useMutation({
    mutationFn: async (tickerId: number) => {
      const newIds = workspaceTickerIds.filter(id => id !== tickerId);
      setWorkspaceTickerIds(newIds);

      if (selectedTickerId === tickerId) {
        const idx = workspaceTickerIds.indexOf(tickerId);
        const nextId = newIds[Math.min(idx, newIds.length - 1)] || null;
        setSelectedTickerId(nextId);
        setSelectedNoteId(null);
        persistWorkspace(newIds, nextId);
      } else {
        persistWorkspace(newIds, selectedTickerId);
      }

      return tickerId;
    },
    onSuccess: (tickerId) => {
      const ticker = allTickers.find(t => t.id === tickerId);
      toast({ title: `${ticker?.symbol || "Ticker"} tab closed` });
    },
  });

  const handleTickerChange = (tickerId: number) => {
    setSelectedTickerId(tickerId);
    setSelectedNoteId(null);
    persistWorkspace(workspaceTickerIds, tickerId);
  };

  const handleAddTicker = (symbol: string) => {
    addTickerMutation.mutate(symbol);
  };

  const handleRemoveTicker = (tickerId: number) => {
    removeTickerMutation.mutate(tickerId);
  };

  const activeTicker = allTickers.find((t) => t.id === selectedTickerId) || null;

  const { data: notes = [] } = useQuery<NoteData[]>({
    queryKey: ["/api/tickers", selectedTickerId, "notes"],
    queryFn: () => fetchNotesByTicker(selectedTickerId!),
    enabled: !!selectedTickerId,
  });

  useEffect(() => {
    if (notes.length > 0 && selectedNoteId === null) {
      setSelectedNoteId(notes[0].id);
    } else if (notes.length > 0 && !notes.find(n => n.id === selectedNoteId)) {
      setSelectedNoteId(notes[0].id);
    } else if (notes.length === 0) {
      setSelectedNoteId(null);
    }
  }, [notes, selectedNoteId]);

  const { data: activeNote } = useQuery<FullNote>({
    queryKey: ["/api/notes", selectedNoteId, "full"],
    queryFn: () => fetchFullNote(selectedNoteId!),
    enabled: !!selectedNoteId,
  });

  const { data: priceRatio } = useQuery<PriceRatioData>({
    queryKey: ["/api/price-ratio", activeTicker?.symbol],
    queryFn: () => fetchPriceRatio(activeTicker!.symbol),
    enabled: !!activeTicker && isFuturesSymbol(activeTicker.symbol),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
  });

  const [clockTime, setClockTime] = useState(new Date().toLocaleTimeString());
  const [nyTime, setNyTime] = useState(
    new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York" })
  );
  useEffect(() => {
    const interval = setInterval(() => {
      setClockTime(new Date().toLocaleTimeString());
      setNyTime(new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York" }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  if (tickersLoading || !seeded) {
    return (
      <div className="h-screen w-full bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="h-6 w-6 bg-primary rounded-sm animate-pulse mx-auto" />
          <p className="text-sm font-mono text-muted-foreground animate-pulse">Initializing Trading System...</p>
        </div>
      </div>
    );
  }

  const showEmptyWorkspace = workspaceLoaded && workspaceTickers.length === 0;

  return (
    <div className="h-screen w-full bg-background text-foreground overflow-hidden flex flex-col">
      <header className="h-11 border-b border-border bg-card flex items-center px-4 justify-between shrink-0 z-10">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 bg-primary rounded-sm animate-pulse" />
            <h1 className="text-sm font-bold tracking-widest uppercase font-mono text-primary" data-testid="text-app-title">
              TraderNotes AI
            </h1>
          </div>

          <div className="flex items-center bg-muted/30 rounded-lg p-0.5 border border-border/50" data-testid="room-toggle">
            <button
              onClick={() => setRoomMode("strategy")}
              data-testid="button-strategy-room"
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-mono font-bold tracking-wide transition-all",
                roomMode === "strategy"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <BookOpen className="h-3 w-3" />
              Strategy Room
            </button>
            <button
              onClick={() => setRoomMode("action")}
              data-testid="button-action-dashboard"
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-mono font-bold tracking-wide transition-all",
                roomMode === "action"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <BarChart3 className="h-3 w-3" />
              Action Dashboard
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span data-testid="status-system">ONLINE</span>
          </div>
          <div className="flex items-center gap-3" data-testid="text-clock">
            <div className="flex flex-col items-end leading-none">
              <span className="text-[10px] text-muted-foreground/60">LOCAL</span>
              <span>{clockTime}</span>
            </div>
            <div className="w-px h-5 bg-border" />
            <div className="flex flex-col items-end leading-none">
              <span className="text-[10px] text-amber-400/80">NYC</span>
              <span className="text-amber-400" data-testid="text-ny-clock">{nyTime}</span>
            </div>
          </div>
          {user && (
            <div className="flex items-center gap-3 ml-2 pl-3 border-l border-border">
              {user.profileImageUrl && (
                <img src={user.profileImageUrl} alt="" className="w-5 h-5 rounded-full" data-testid="img-user-avatar" />
              )}
              <span className="text-primary" data-testid="text-username">
                {user.firstName || user.email || "Trader"}
              </span>
              <button
                onClick={() => logout()}
                className="text-muted-foreground hover:text-red-400 transition-colors"
                data-testid="button-logout"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </header>

      <TickerTabs
        tickers={workspaceTickers}
        activeTickerId={selectedTickerId}
        onSelectTicker={handleTickerChange}
        onRemoveTicker={handleRemoveTicker}
        onAddTicker={handleAddTicker}
        isAdding={addTickerMutation.isPending}
      />

      <div className="flex-1 overflow-hidden">
        {showEmptyWorkspace ? (
          <EmptyWorkspace onAddTicker={handleAddTicker} />
        ) : roomMode === "strategy" ? (
          <StrategyRoom
            activeTicker={activeTicker}
            activeNote={activeNote || null}
            notes={notes}
            selectedNoteId={selectedNoteId}
            onSelectNote={setSelectedNoteId}
            onAddToChart={(price, label, color) => {
              pendingLevelRef.current = { price, label, color };
              setRoomMode("action");
              toast({
                title: "Level added to chart",
                description: `${label} at ${price}`,
              });
            }}
            onAddTicker={handleAddTicker}
          />
        ) : (
          <ActionDashboard
            ref={actionDashboardRef}
            activeTicker={activeTicker}
            activeNote={activeNote || null}
            notes={notes}
            selectedNoteId={selectedNoteId}
            onSelectNote={setSelectedNoteId}
            priceRatio={priceRatio || null}
            pendingLevel={pendingLevelRef.current}
            onPendingLevelConsumed={() => { pendingLevelRef.current = null; }}
          />
        )}
      </div>
    </div>
  );
}
