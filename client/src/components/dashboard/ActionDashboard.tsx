import { memo, useRef, useCallback, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TemporalNavigator } from "./TemporalNavigator";
import { LiveChart, type LiveChartHandle } from "./LiveChart";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Send, Crosshair, Paperclip, FileText, X, TrendingUp, BarChart3, MessageSquare, RefreshCw, AlertTriangle, Loader2, MapPin } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchChatByTicker, sendTacticalChat, fetchPlaybooks,
  type TickerData, type NoteData, type FullNote, type PriceRatioData, type ChatMsg, type Playbook
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { motion, AnimatePresence } from "framer-motion";

interface PlaybookFallbackData {
  date: string;
  levels: string[];
  scenarios: string[];
}

function extractPlaybookFallback(playbook: Playbook | null | undefined): PlaybookFallbackData | null {
  if (!playbook?.playbookData) return null;
  const data = playbook.playbookData as any;
  const levels: string[] = [];

  if (data.structural_zones) {
    const zones = data.structural_zones;
    for (const zone of [zones.bullish_green, zones.neutral_yellow, zones.bearish_red]) {
      if (Array.isArray(zone)) {
        zone.forEach((z: any) => {
          if (z.price != null) levels.push(String(z.price));
        });
      }
    }
  }

  if (data.levels && Array.isArray(data.levels)) {
    data.levels.forEach((l: any) => {
      if (l.price != null) levels.push(String(l.price));
    });
  }

  const scenarios: string[] = [];
  if (data.if_then_scenarios && Array.isArray(data.if_then_scenarios)) {
    data.if_then_scenarios.slice(0, 3).forEach((s: any) => {
      if (s.condition && s.outcome) scenarios.push(`If ${s.condition} → ${s.outcome}`);
    });
  }
  if (data.scenarios && Array.isArray(data.scenarios)) {
    data.scenarios.slice(0, 3).forEach((s: any) => {
      if (s.if && s.then) scenarios.push(`If ${s.if} → ${s.then}`);
      else if (s.condition && s.outcome) scenarios.push(`If ${s.condition} → ${s.outcome}`);
    });
  }

  const uniqueLevels = Array.from(new Set(levels)).slice(0, 6);
  if (uniqueLevels.length === 0 && scenarios.length === 0) return null;

  return {
    date: playbook.targetDateStart || playbook.date || "unknown",
    levels: uniqueLevels,
    scenarios,
  };
}

interface TacticalChatPanelProps {
  activeTicker: TickerData | null;
  messages: ChatMsg[];
}

const TacticalChatPanel = memo(function TacticalChatPanel({ activeTicker, messages }: TacticalChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [chatInput, setChatInput] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<Map<string, string>>(new Map());
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMsg[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [lastPendingRequest, setLastPendingRequest] = useState<{ content: string; files: File[] } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevTickerIdRef = useRef<number | undefined>(activeTicker?.id);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: playbooksList = [] } = useQuery<Playbook[]>({
    queryKey: ["/api/tickers", activeTicker?.id, "playbooks"],
    queryFn: () => fetchPlaybooks(activeTicker!.id),
    enabled: !!activeTicker,
  });

  useEffect(() => {
    if (prevTickerIdRef.current !== activeTicker?.id) {
      prevTickerIdRef.current = activeTicker?.id;
      setLastPendingRequest(null);
      setErrorMessage(null);
      setIsRetrying(false);
      setOptimisticMessages([]);
      setIsAiLoading(false);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    }
  }, [activeTicker?.id]);

  const tacticalChatMutation = useMutation({
    mutationFn: ({ content, files }: { content: string; files?: File[] }) =>
      sendTacticalChat(activeTicker!.id, content, files),
    onSuccess: (data) => {
      setOptimisticMessages([]);
      setIsAiLoading(false);
      setIsRetrying(false);
      queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "chat"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "playbooks"] });

      if (data.fallback) {
        setErrorMessage("AI service is temporarily unavailable. Your playbook levels are shown below.");
      } else {
        setLastPendingRequest(null);
        setErrorMessage(null);
      }
    },
    onError: (err: Error) => {
      setIsAiLoading(false);
      setIsRetrying(false);
      if (lastPendingRequest) {
        setChatInput(lastPendingRequest.content);
      }
      const msg = err.message.includes("busy") || err.message.includes("503")
        ? "AI service is experiencing high traffic. Please try again in a moment."
        : err.message.includes("429")
          ? "Rate limited. Please wait a moment before retrying."
          : err.message || "Tactical analysis failed. Please try again.";
      setErrorMessage(msg);
    },
  });

  useEffect(() => {
    const viewport = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    if (!viewport) return;
    const onScroll = () => {
      const distFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      setIsScrolledUp(distFromBottom > 300);
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (isScrolledUp) return;
    const scrollContainer = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }, [messages, optimisticMessages, isAiLoading, isScrolledUp]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (!selectedFiles.length) return;
    const validFiles = selectedFiles.filter(f => {
      if (f.size > 10 * 1024 * 1024) {
        toast({ title: `"${f.name}" exceeds 10MB limit`, variant: "destructive" });
        return false;
      }
      return true;
    });
    setAttachedFiles(prev => [...prev, ...validFiles]);
    validFiles.forEach(file => {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          setFilePreviews(prev => new Map(prev).set(file.name + file.size, ev.target?.result as string));
        };
        reader.readAsDataURL(file);
      }
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => { setAttachedFiles(prev => prev.filter((_, i) => i !== index)); };
  const clearFiles = () => { setAttachedFiles([]); setFilePreviews(new Map()); };

  const handleSendChat = () => {
    if ((!chatInput.trim() && attachedFiles.length === 0) || !activeTicker || tacticalChatMutation.isPending) return;

    const currentInput = chatInput;
    const currentFiles = [...attachedFiles];
    const fileNames = currentFiles.map(f => f.name).join(", ");
    const optimisticUserMsg: ChatMsg = {
      id: Date.now(),
      role: "user",
      content: currentInput + (currentFiles.length > 0 ? ` [${currentFiles.length} file${currentFiles.length > 1 ? "s" : ""}: ${fileNames}]` : ""),
      createdAt: new Date().toISOString(),
      tickerId: activeTicker.id,
      userId: "",
    };

    setLastPendingRequest({ content: currentInput, files: currentFiles });
    setErrorMessage(null);
    setChatInput("");
    clearFiles();
    setOptimisticMessages([optimisticUserMsg]);
    setIsAiLoading(true);
    tacticalChatMutation.mutate({ content: currentInput, files: currentFiles.length > 0 ? currentFiles : undefined });
  };

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  const handleRetry = () => {
    if (!lastPendingRequest || !activeTicker || tacticalChatMutation.isPending) return;

    const needsWarmup = errorMessage?.includes("high traffic") || errorMessage?.includes("Rate limited");
    const delay = needsWarmup ? 2000 : 0;

    setIsRetrying(true);
    setErrorMessage(null);
    setIsAiLoading(true);

    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      tacticalChatMutation.mutate({
        content: lastPendingRequest.content,
        files: lastPendingRequest.files.length > 0 ? lastPendingRequest.files : undefined,
      });
    }, delay);
  };

  const tacticalMessages = [...messages.slice(-10), ...optimisticMessages];

  return (
    <div className="h-full flex flex-col">
      <div className="h-10 border-b border-border flex items-center px-3 bg-card/50 shrink-0">
        <Crosshair className="h-3.5 w-3.5 text-primary mr-2" />
        <span className="text-xs font-bold font-mono uppercase tracking-wider text-primary" data-testid="text-tactical-chat-title">
          Tactical Assistant
        </span>
        {activeTicker && (
          <Badge variant="outline" className="ml-2 text-[9px] h-4 font-mono border-primary/20 text-primary/70">
            {activeTicker.symbol}
          </Badge>
        )}
      </div>

      <div className="relative flex-1 min-h-0">
      <ScrollArea className="h-full" ref={scrollRef}>
        <div className="p-3 space-y-3">
          {tacticalMessages.length === 0 && (
            <div className="text-center py-8 px-2">
              <Crosshair className="h-8 w-8 text-primary/20 mx-auto mb-3" />
              <p className="text-xs text-muted-foreground font-medium mb-1">Tactical Assistant</p>
              <p className="text-[10px] text-muted-foreground/60">
                Drop a chart screenshot here. The AI will read the price, check your playbook zones, and give you actionable guidance.
              </p>
            </div>
          )}
          {tacticalMessages.map((msg) => (
            <motion.div
              key={msg.id}
              className={cn("text-xs leading-relaxed gpu-accelerated", msg.role === "user" ? "text-right" : "")}
              data-testid={`tactical-msg-${msg.id}`}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={msg.role === "user"
                ? { type: "spring", stiffness: 300, damping: 24 }
                : { duration: 0.3, ease: "easeOut" }
              }
            >
              <div className={cn(
                "inline-block rounded-lg px-3 py-2 max-w-[95%]",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 border border-border text-foreground"
              )}>
                {msg.content.split("\n").map((line, i) => (
                  <p key={i} dangerouslySetInnerHTML={{
                    __html: line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                  }} />
                ))}
              </div>
              {msg.createdAt && (
                <div className="text-[9px] opacity-30 mt-0.5 font-mono">
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              )}
            </motion.div>
          ))}
          {isAiLoading && (
            <motion.div
              className="flex items-center gap-2 text-xs text-muted-foreground gpu-accelerated"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              <div className="inline-block rounded-lg px-3 py-2 bg-muted/50 border border-border">
                <div className="flex items-center gap-1.5">
                  {isRetrying ? (
                    <>
                      <Loader2 className="h-3 w-3 text-amber-400 animate-spin" />
                      <span className="text-[10px] text-muted-foreground ml-1">Retrying...</span>
                    </>
                  ) : (
                    <>
                      <motion.div className="w-1.5 h-1.5 bg-primary/50 rounded-full" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0 }} />
                      <motion.div className="w-1.5 h-1.5 bg-primary/50 rounded-full" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }} />
                      <motion.div className="w-1.5 h-1.5 bg-primary/50 rounded-full" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }} />
                      <motion.span
                        className="text-[10px] text-muted-foreground ml-1"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.5, delay: 0.3 }}
                      >
                        Analyzing...
                      </motion.span>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          )}
          {errorMessage && !isAiLoading && (() => {
            const nyNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
            const todayStr = `${nyNow.getFullYear()}-${String(nyNow.getMonth() + 1).padStart(2, "0")}-${String(nyNow.getDate()).padStart(2, "0")}`;
            const todayDaily = playbooksList.find(pb => {
              const ht = (pb.horizonType || "Daily").toLowerCase();
              return (ht === "daily" || !pb.horizonType) && (pb.targetDateStart === todayStr || pb.date === todayStr);
            });
            const fallbackPlaybook = todayDaily || (playbooksList.length > 0 ? playbooksList[0] : null);
            const fallback = extractPlaybookFallback(fallbackPlaybook);
            return (
              <div className="flex items-start gap-2" data-testid="error-fallback-tactical-container">
                <div className="inline-block rounded-lg px-3 py-2 bg-destructive/5 border border-destructive/20">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <AlertTriangle className="h-3 w-3 text-destructive/80" />
                    <span className="text-[10px] text-destructive/90">{errorMessage}</span>
                  </div>
                  {fallback && (
                    <div className="mt-1.5 pt-1.5 border-t border-amber-500/20" data-testid="fallback-levels-tactical">
                      <div className="flex items-center gap-1 mb-1">
                        <MapPin className="h-2.5 w-2.5 text-amber-400" />
                        <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wider">
                          AI offline — {fallback.date} Levels
                        </span>
                      </div>
                      {fallback.levels.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1">
                          {fallback.levels.map((level, i) => (
                            <Badge key={i} variant="outline" className="text-[9px] font-mono border-amber-500/30 text-amber-300 bg-amber-500/5 h-4 px-1.5" data-testid={`tactical-fallback-level-${i}`}>
                              {level}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {fallback.scenarios.length > 0 && (
                        <div className="space-y-0.5 mt-1">
                          {fallback.scenarios.map((s, i) => (
                            <p key={i} className="text-[9px] text-amber-300/80 font-mono leading-relaxed" data-testid={`tactical-fallback-scenario-${i}`}>
                              {s}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {lastPendingRequest && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRetry}
                      disabled={tacticalChatMutation.isPending}
                      className="h-6 px-2.5 text-[10px] font-bold border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive mt-1.5"
                      data-testid="button-retry-tactical"
                    >
                      <RefreshCw className="h-2.5 w-2.5 mr-1" />
                      Retry
                    </Button>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </ScrollArea>
      <AnimatePresence>
        {isScrolledUp && (
          <motion.button
            key="jump-to-present-tactical"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={() => {
              const vp = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]");
              if (vp) vp.scrollTo({ top: vp.scrollHeight, behavior: "smooth" });
              setIsScrolledUp(false);
            }}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider text-primary border border-primary/40 bg-black/70 backdrop-blur-sm shadow-lg hover:bg-black/90 transition-colors"
            data-testid="button-jump-to-present-tactical"
          >
            ↓ Jump to Present
          </motion.button>
        )}
      </AnimatePresence>
      </div>

      <div className="border-t border-border p-2 bg-card/30 shrink-0">
        {attachedFiles.length > 0 && (
          <div className="mb-1.5">
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {attachedFiles.map((file, idx) => {
                const preview = filePreviews.get(file.name + file.size);
                return (
                  <div key={`${file.name}-${idx}`} className="relative shrink-0 group" data-testid={`tactical-file-thumb-${idx}`}>
                    <div className="w-10 h-10 rounded border border-border bg-muted/30 flex items-center justify-center overflow-hidden">
                      {preview ? (
                        <img src={preview} alt={file.name} className="w-full h-full object-cover" />
                      ) : (
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <button
                      onClick={() => removeFile(idx)}
                      className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      data-testid={`button-tactical-remove-file-${idx}`}
                    >
                      <X className="h-2 w-2" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.pdf,.csv"
            onChange={handleFileChange}
            multiple
            className="hidden"
            data-testid="input-tactical-file"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground relative"
            onClick={() => fileInputRef.current?.click()}
            disabled={tacticalChatMutation.isPending}
            data-testid="button-tactical-attach"
          >
            <Paperclip className="h-3.5 w-3.5" />
            {attachedFiles.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-primary text-[8px] font-bold text-primary-foreground flex items-center justify-center">
                {attachedFiles.length}
              </span>
            )}
          </Button>
          <Textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); }
            }}
            placeholder={attachedFiles.length > 0 ? "Add context about these files..." : "Drop charts or ask..."}
            className="min-h-[36px] max-h-[80px] text-xs resize-none bg-transparent border-border"
            data-testid="input-tactical-chat"
          />
          <Button
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleSendChat}
            disabled={(!chatInput.trim() && attachedFiles.length === 0) || tacticalChatMutation.isPending || !activeTicker}
            data-testid="button-tactical-send"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
});

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
    const isMobile = useIsMobile();
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

    const { data: messages = [] } = useQuery<ChatMsg[]>({
      queryKey: ["/api/tickers", activeTicker?.id, "chat"],
      queryFn: () => fetchChatByTicker(activeTicker!.id),
      enabled: !!activeTicker,
    });

    if (isMobile) {
      return (
        <div className="h-full flex flex-col">
          <Tabs defaultValue="chart" className="h-full flex flex-col">
            <TabsList className="w-full rounded-none border-b border-border bg-card shrink-0 h-11">
              <TabsTrigger value="levels" className="flex-1 gap-1.5 text-xs min-h-[44px]" data-testid="tab-levels">
                <TrendingUp className="h-3.5 w-3.5" />
                Levels
              </TabsTrigger>
              <TabsTrigger value="chart" className="flex-1 gap-1.5 text-xs min-h-[44px]" data-testid="tab-chart">
                <BarChart3 className="h-3.5 w-3.5" />
                Chart
              </TabsTrigger>
              <TabsTrigger value="tactical" className="flex-1 gap-1.5 text-xs min-h-[44px]" data-testid="tab-tactical">
                <MessageSquare className="h-3.5 w-3.5" />
                Tactical
              </TabsTrigger>
            </TabsList>
            <TabsContent value="levels" className="flex-1 mt-0 overflow-hidden">
              <div className="h-full bg-sidebar">
                <TemporalNavigator
                  notes={notes}
                  activeNote={activeNote}
                  activeTicker={activeTicker}
                  selectedNoteId={selectedNoteId}
                  onSelectNote={onSelectNote}
                  priceRatio={priceRatio}
                  onSyncToLevel={handleSyncToLevel}
                />
              </div>
            </TabsContent>
            <TabsContent value="chart" className="flex-1 mt-0 overflow-hidden">
              <div className="h-full bg-black">
                <LiveChart
                  ref={chartRef}
                  activeTicker={activeTicker}
                  activeNote={activeNote}
                  priceRatio={priceRatio}
                />
              </div>
            </TabsContent>
            <TabsContent value="tactical" className="flex-1 mt-0 overflow-hidden">
              <div className="h-full bg-card">
                <TacticalChatPanel activeTicker={activeTicker} messages={messages} />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      );
    }

    return (
      <div className="h-full">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={25} minSize={18} maxSize={35} className="bg-sidebar border-r border-border">
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

          <ResizablePanel defaultSize={50} minSize={35} className="bg-black">
            <LiveChart
              ref={chartRef}
              activeTicker={activeTicker}
              activeNote={activeNote}
              priceRatio={priceRatio}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={25} minSize={18} maxSize={35} className="bg-card border-l border-border">
            <TacticalChatPanel activeTicker={activeTicker} messages={messages} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    );
  }
);
