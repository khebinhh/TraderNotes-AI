import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { TemporalNavigator } from "./TemporalNavigator";
import { AITutor } from "./AITutor";
import { LiveChart, type LiveChartHandle } from "./LiveChart";
import { TickerTabs } from "./TickerTabs";
import { fetchTickers, fetchNotesByTicker, fetchFullNote, fetchPriceRatio, seedData, isFuturesSymbol, type TickerData, type NoteData, type FullNote, type PriceRatioData } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { LogOut } from "lucide-react";

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const [selectedTickerId, setSelectedTickerId] = useState<number | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [seeded, setSeeded] = useState(false);
  const chartRef = useRef<LiveChartHandle>(null);

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
    if (notes.length > 0) {
      setSelectedNoteId(notes[0].id);
    } else {
      setSelectedNoteId(null);
    }
  }, [notes]);

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

  const handleSyncToLevel = useCallback((price: number, label: string, color: string) => {
    chartRef.current?.syncToLevel(price, label, color);
  }, []);

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
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 bg-primary rounded-sm animate-pulse" />
          <h1 className="text-sm font-bold tracking-widest uppercase font-mono text-primary" data-testid="text-app-title">
            TraderNotes AI <span className="text-muted-foreground opacity-50">v1.0</span>
          </h1>
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
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={20} minSize={15} maxSize={30} className="bg-sidebar border-r border-border">
            <TemporalNavigator
              notes={notes}
              activeNote={activeNote || null}
              activeTicker={activeTicker}
              selectedNoteId={selectedNoteId}
              onSelectNote={setSelectedNoteId}
              priceRatio={priceRatio || null}
              onSyncToLevel={handleSyncToLevel}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={30} minSize={20} maxSize={40} className="bg-background">
            <AITutor activeNote={activeNote || null} activeTicker={activeTicker} />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={50} minSize={30} className="bg-black">
            <LiveChart
              ref={chartRef}
              activeTicker={activeTicker}
              activeNote={activeNote || null}
              priceRatio={priceRatio || null}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
