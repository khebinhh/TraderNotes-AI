import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { TickerTabs } from "./TickerTabs";
import { StrategyRoom } from "./StrategyRoom";
import { ActionDashboard, type ActionDashboardHandle } from "./ActionDashboard";
import { fetchTickers, fetchNotesByTicker, fetchFullNote, fetchPriceRatio, seedData, isFuturesSymbol, type TickerData, type NoteData, type FullNote, type PriceRatioData } from "@/lib/api";
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
  const [selectedTickerId, setSelectedTickerId] = useState<number | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    seedData().then(() => setSeeded(true)).catch(() => setSeeded(true));
  }, []);

  const { data: tickersList = [], isLoading: tickersLoading } = useQuery<TickerData[]>({
    queryKey: ["/api/tickers"],
    enabled: seeded,
  });

  useEffect(() => {
    if (tickersList.length > 0 && selectedTickerId === null) {
      setSelectedTickerId(tickersList[0].id);
    }
  }, [tickersList, selectedTickerId]);

  const activeTicker = tickersList.find((t) => t.id === selectedTickerId) || null;

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

  const handleTickerChange = (tickerId: number) => {
    setSelectedTickerId(tickerId);
    setSelectedNoteId(null);
  };

  const [clockTime, setClockTime] = useState(new Date().toLocaleTimeString());
  useEffect(() => {
    const interval = setInterval(() => setClockTime(new Date().toLocaleTimeString()), 1000);
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
          <div data-testid="text-clock">{clockTime}</div>
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
        tickers={tickersList}
        activeTickerId={selectedTickerId}
        onSelectTicker={handleTickerChange}
      />

      <div className="flex-1 overflow-hidden">
        {roomMode === "strategy" ? (
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
