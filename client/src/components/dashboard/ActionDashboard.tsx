import { useRef, useCallback, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { TemporalNavigator } from "./TemporalNavigator";
import { LiveChart, type LiveChartHandle } from "./LiveChart";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Send, Crosshair, Paperclip, ImageIcon, FileText, Loader2, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchChatByTicker, sendTacticalChat,
  type TickerData, type NoteData, type FullNote, type PriceRatioData, type ChatMsg
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

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
    const scrollRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [chatInput, setChatInput] = useState("");
    const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
    const [filePreviews, setFilePreviews] = useState<Map<string, string>>(new Map());
    const [optimisticMessages, setOptimisticMessages] = useState<ChatMsg[]>([]);
    const [isAiLoading, setIsAiLoading] = useState(false);
    const queryClient = useQueryClient();
    const { toast } = useToast();

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

    const tacticalChatMutation = useMutation({
      mutationFn: ({ content, files }: { content: string; files?: File[] }) =>
        sendTacticalChat(activeTicker!.id, content, files),
      onSuccess: () => {
        setOptimisticMessages([]);
        setIsAiLoading(false);
        queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "chat"] });
      },
      onError: (err: Error) => {
        setOptimisticMessages([]);
        setIsAiLoading(false);
        toast({ title: "Tactical Analysis Failed", description: err.message, variant: "destructive" });
      },
    });

    useEffect(() => {
      if (scrollRef.current) {
        const scrollContainer = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
        if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }, [messages, optimisticMessages, isAiLoading]);

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

      setChatInput("");
      clearFiles();
      setOptimisticMessages([optimisticUserMsg]);
      setIsAiLoading(true);
      tacticalChatMutation.mutate({ content: currentInput, files: currentFiles.length > 0 ? currentFiles : undefined });
    };

    const tacticalMessages = [...messages.slice(-10), ...optimisticMessages];

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

              <ScrollArea className="flex-1" ref={scrollRef}>
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
                    <div
                      key={msg.id}
                      className={cn("text-xs leading-relaxed", msg.role === "user" ? "text-right" : "")}
                      data-testid={`tactical-msg-${msg.id}`}
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
                    </div>
                  ))}
                  {isAiLoading && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="inline-block rounded-lg px-3 py-2 bg-muted/50 border border-border">
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <div className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <div className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                          <span className="text-[10px] text-muted-foreground ml-1">Analyzing...</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

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
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    );
  }
);
