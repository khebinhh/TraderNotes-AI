import { useRef, useCallback } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { TemporalNavigator } from "./TemporalNavigator";
import { LiveChart, type LiveChartHandle } from "./LiveChart";
import { type TickerData, type NoteData, type FullNote, type PriceRatioData } from "@/lib/api";

interface ActionDashboardProps {
  activeTicker: TickerData | null;
  activeNote: FullNote | null;
  notes: NoteData[];
  selectedNoteId: number | null;
  onSelectNote: (id: number) => void;
  priceRatio: PriceRatioData | null;
}

export function ActionDashboard({ activeTicker, activeNote, notes, selectedNoteId, onSelectNote, priceRatio }: ActionDashboardProps) {
  const chartRef = useRef<LiveChartHandle>(null);

  const handleSyncToLevel = useCallback((price: number, label: string, color: string) => {
    chartRef.current?.syncToLevel(price, label, color);
  }, []);

  return (
    <div className="h-full">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={30} minSize={20} maxSize={40} className="bg-sidebar border-r border-border">
          <TemporalNavigator
            notes={notes}
            activeNote={activeNote}
            activeTicker={activeTicker}
            selectedNoteId={selectedNoteId}
            onSelectNote={onSelectNote}
            priceRatio={priceRatio}
            onSyncToLevel={handleSyncToLevel}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={70} minSize={50} className="bg-black">
          <LiveChart
            ref={chartRef}
            activeTicker={activeTicker}
            activeNote={activeNote}
            priceRatio={priceRatio}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
