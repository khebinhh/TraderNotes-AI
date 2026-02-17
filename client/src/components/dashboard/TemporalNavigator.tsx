import { format } from "date-fns";
import { TrendingUp, Archive, ArrowRight, Crosshair, Info } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toggleChecklistItem, isFuturesSymbol, type NoteData, type FullNote, type TickerData, type PriceRatioData } from "@/lib/api";
import { cn } from "@/lib/utils";

interface TemporalNavigatorProps {
  notes: NoteData[];
  activeNote: FullNote | null;
  activeTicker: TickerData | null;
  selectedNoteId: number | null;
  onSelectNote: (id: number) => void;
  priceRatio: PriceRatioData | null;
  onSyncToLevel?: (price: number, label: string, color: string) => void;
}

function convertPrice(futuresPrice: number, ratio: number): number {
  return Math.round((futuresPrice / ratio) * 100) / 100;
}

function isNearPrice(levelPrice: number, currentPrice: number, threshold: number = 0.005): boolean {
  return Math.abs(levelPrice - currentPrice) / currentPrice <= threshold;
}

export function TemporalNavigator({ notes, activeNote, activeTicker, selectedNoteId, onSelectNote, priceRatio, onSyncToLevel }: TemporalNavigatorProps) {
  const queryClient = useQueryClient();
  const isFutures = activeTicker && isFuturesSymbol(activeTicker.symbol);
  const ratio = priceRatio?.ratio || (isFutures ? 10 : 1);
  const currentEtfPrice = priceRatio?.etfPrice || null;

  const toggleMutation = useMutation({
    mutationFn: ({ id, isCompleted }: { id: number; isCompleted: boolean }) =>
      toggleChecklistItem(id, isCompleted),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes", selectedNoteId, "full"] });
    },
  });

  const handleSyncToLevel = (level: { priceLow: string; priceHigh?: string | null; levelType: string; description: string | null }) => {
    const rawPrice = parseFloat(level.priceLow);
    if (isNaN(rawPrice) || !onSyncToLevel) return;
    const chartPrice = isFutures ? convertPrice(rawPrice, ratio) : rawPrice;
    const color = level.levelType === "resistance" ? "#f43f5e" : "#10b981";
    const label = level.description || level.levelType;
    onSyncToLevel(chartPrice, label, color);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex flex-col min-h-[40%] border-b border-border">
        <div className="p-3 border-b border-border flex items-center justify-between bg-sidebar-accent/30">
          <h2 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2" data-testid="text-game-plan-header">
            <TrendingUp className="h-3 w-3" />
            {activeTicker ? `${activeTicker.symbol} Game Plan` : "Game Plan"}
          </h2>
          {activeNote && (
            <Badge variant="outline" className="font-mono text-[10px] h-5 border-primary/20 text-primary">
              {format(new Date(activeNote.createdAt), "MMM dd")}
            </Badge>
          )}
        </div>

        <ScrollArea className="flex-1 p-4">
          {activeNote ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] uppercase text-muted-foreground font-mono tracking-wider flex items-center gap-1">
                    Key Levels
                    {activeTicker && <span className="text-primary/60">• {activeTicker.symbol}</span>}
                  </h3>
                  {isFutures && priceRatio && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1 cursor-help" data-testid="tooltip-ratio-mapping">
                            <Info className="h-3 w-3 text-amber-400" />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[250px] text-xs bg-card border-amber-500/30">
                          <p className="italic text-amber-300">
                            Levels are dynamically mapped from {activeTicker?.symbol} to {priceRatio.etfSymbol} based on current futures premium.
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            Ratio: {priceRatio.ratio.toFixed(4)}
                            {priceRatio.isFallback ? " (fallback)" : ""}
                          </p>
                          {priceRatio.etfPrice && (
                            <p className="text-muted-foreground">
                              {priceRatio.etfSymbol}: ${priceRatio.etfPrice.toFixed(2)}
                            </p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <div className="space-y-2">
                  {activeNote.levels.map((level) => {
                    const rawPrice = parseFloat(level.priceLow);
                    const chartPrice = isFutures ? convertPrice(rawPrice, ratio) : rawPrice;
                    const isProximity = currentEtfPrice && !isNaN(chartPrice) && isNearPrice(chartPrice, currentEtfPrice);
                    const levelColor = level.levelType === "resistance" ? "rose" : "emerald";

                    return (
                      <div
                        key={level.id}
                        className={cn(
                          "flex items-start gap-2 text-sm group rounded-md p-1.5 -mx-1.5 transition-colors",
                          isProximity && level.levelType === "resistance" && "bg-rose-500/10 ring-1 ring-rose-500/30",
                          isProximity && level.levelType === "support" && "bg-emerald-500/10 ring-1 ring-emerald-500/30"
                        )}
                        data-testid={`level-${level.id}`}
                      >
                        <div className={cn(
                          "w-1 h-full min-h-[20px] rounded-full mt-0.5",
                          level.levelType === "resistance" ? "bg-rose-500" : "bg-emerald-500",
                          isProximity && "animate-pulse"
                        )} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-foreground">
                              {level.priceLow}{level.priceHigh ? `-${level.priceHigh}` : ""}
                            </span>
                            {isFutures && (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                → {chartPrice.toFixed(2)} {priceRatio?.etfSymbol}
                              </span>
                            )}
                            {isProximity && (
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[9px] h-4 px-1 font-mono animate-pulse",
                                  level.levelType === "resistance"
                                    ? "border-rose-500/50 text-rose-400"
                                    : "border-emerald-500/50 text-emerald-400"
                                )}
                                data-testid={`badge-proximity-${level.id}`}
                              >
                                LIVE
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{level.description}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0",
                            `text-${levelColor}-400 hover:text-${levelColor}-300 hover:bg-${levelColor}-500/10`
                          )}
                          onClick={() => handleSyncToLevel(level)}
                          title="Sync Chart to Level"
                          data-testid={`button-sync-level-${level.id}`}
                        >
                          <Crosshair className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <Separator className="bg-border/50" />

              <div className="space-y-2">
                <h3 className="text-[10px] uppercase text-muted-foreground font-mono tracking-wider">Execution Checklist</h3>
                <div className="space-y-3">
                  {activeNote.checklistItems.map((item) => (
                    <div key={item.id} className="flex items-start space-x-2" data-testid={`checklist-item-${item.id}`}>
                      <Checkbox
                        id={`item-${item.id}`}
                        checked={item.isCompleted}
                        onCheckedChange={(checked) => {
                          toggleMutation.mutate({ id: item.id, isCompleted: !!checked });
                        }}
                        className="border-muted-foreground/50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary"
                        data-testid={`checkbox-item-${item.id}`}
                      />
                      <label
                        htmlFor={`item-${item.id}`}
                        className={cn(
                          "text-xs font-medium leading-none pt-0.5 cursor-pointer",
                          item.isCompleted ? "line-through text-muted-foreground" : "text-foreground"
                        )}
                      >
                        {item.content}
                      </label>
                    </div>
                  ))}
                  {activeNote.checklistItems.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">No checklist items.</p>
                  )}
                </div>
              </div>

              <Separator className="bg-border/50" />

              <div className="space-y-2">
                <h3 className="text-[10px] uppercase text-muted-foreground font-mono tracking-wider">Event Risk</h3>
                <div className="space-y-2">
                  {activeNote.events.map((evt) => (
                    <div key={evt.id} className="flex items-center justify-between text-xs bg-muted/30 p-2 rounded border border-border/50" data-testid={`event-${evt.id}`}>
                      <span className="text-rose-400 font-mono font-bold">{evt.eventTime}</span>
                      <span className="font-medium text-foreground truncate ml-2">{evt.title}</span>
                      <Badge variant="outline" className="text-[9px] h-4 ml-2 border-amber-500/30 text-amber-400 shrink-0">
                        Vertical Line
                      </Badge>
                    </div>
                  ))}
                  {activeNote.events.length === 0 && (
                    <div className="text-xs text-muted-foreground italic">No high impact events.</div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground italic p-2">
              {activeTicker ? `No notes for ${activeTicker.symbol} yet.` : "Select a ticker to begin."}
            </div>
          )}
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col bg-sidebar/50">
        <div className="p-3 border-b border-border bg-sidebar-accent/10 flex items-center gap-2">
          <Archive className="h-3 w-3 text-muted-foreground" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground" data-testid="text-archive-header">
            {activeTicker ? `${activeTicker.symbol} Notes` : "Past Entries"}
          </h2>
        </div>

        <ScrollArea className="flex-1">
          <div className="flex flex-col">
            {notes.map((note) => (
              <button
                key={note.id}
                onClick={() => onSelectNote(note.id)}
                data-testid={`button-note-${note.id}`}
                className={cn(
                  "flex items-start gap-3 p-4 text-left border-b border-border/50 transition-colors hover:bg-sidebar-accent/50",
                  selectedNoteId === note.id
                    ? "bg-sidebar-accent border-l-2 border-l-primary"
                    : "border-l-2 border-l-transparent opacity-70 hover:opacity-100"
                )}
              >
                <div className="flex flex-col items-center min-w-[3rem]">
                  <span className="text-xs font-bold font-mono text-foreground">
                    {format(new Date(note.createdAt), "dd")}
                  </span>
                  <span className="text-[10px] uppercase text-muted-foreground">
                    {format(new Date(note.createdAt), "MMM")}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold truncate text-foreground/90">{note.title}</h4>
                  <p className="text-xs text-muted-foreground truncate mt-1">{note.summary}</p>
                </div>
                {selectedNoteId === note.id && (
                  <ArrowRight className="h-4 w-4 text-primary animate-in slide-in-from-left-2" />
                )}
              </button>
            ))}
            {notes.length === 0 && (
              <div className="p-4 text-xs text-muted-foreground italic">
                {activeTicker ? `No notes for ${activeTicker.symbol} yet.` : "Select a ticker."}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
