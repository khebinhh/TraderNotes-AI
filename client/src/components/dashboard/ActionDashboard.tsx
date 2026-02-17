import { useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from "react";
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
  pendingLevel?: { price: number; label: string; color: string } | null;
  onPendingLevelConsumed?: () => void;
}

export interface ActionDashboardHandle {
  syncToLevel: (price: number, label: string, color: string) => void;
}

export const ActionDashboard = forwardRef<ActionDashboardHandle, ActionDashboardProps>(
  function ActionDashboard({ activeTicker, activeNote, notes, selectedNoteId, onSelectNote, priceRatio, pendingLevel, onPendingLevelConsumed }, ref) {
    const chartRef = useRef<LiveChartHandle>(null);

    const handleSyncToLevel = useCallback((price: number, label: string, color: string) => {
      chartRef.current?.syncToLevel(price, label, color);
    }, []);

    useImperativeHandle(ref, () => ({
      syncToLevel: handleSyncToLevel,
    }));

    useEffect(() => {
      if (pendingLevel) {
        const timer = setTimeout(() => {
          chartRef.current?.syncToLevel(pendingLevel.price, pendingLevel.label, pendingLevel.color);
          onPendingLevelConsumed?.();
        }, 300);
        return () => clearTimeout(timer);
      }
    }, [pendingLevel, onPendingLevelConsumed]);

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
);
