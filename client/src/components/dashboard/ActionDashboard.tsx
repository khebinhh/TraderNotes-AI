import { useRef, useCallback, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { TemporalNavigator } from "./TemporalNavigator";
import { LiveChart, type LiveChartHandle } from "./LiveChart";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Send, Crosshair, Paperclip, ImageIcon, Loader2, X } from "lucide-react";
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
    const [attachedFile, setAttachedFile] = useState<File | null>(null);
    const [filePreview, setFilePreview] = useState<string | null>(null);
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
      mutationFn: ({ content, file }: { content: string; file?: File }) =>
        sendTacticalChat(activeTicker!.id, content, file),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "chat"] });
      },
      onError: (err: Error) => {
        toast({ title: "Tactical Analysis Failed", description: err.message, variant: "destructive" });
      },
    });

    useEffect(() => {
      if (scrollRef.current) {
        const scrollContainer = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
        if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }, [messages]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { toast({ title: "File too large", variant: "destructive" }); return; }
      setAttachedFile(file);
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (ev) => setFilePreview(ev.target?.result as string);
        reader.readAsDataURL(file);
      } else {
        setFilePreview(null);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const removeFile = () => { setAttachedFile(null); setFilePreview(null); };

    const handleSendChat = () => {
      if ((!chatInput.trim() && !attachedFile) || !activeTicker || tacticalChatMutation.isPending) return;
      tacticalChatMutation.mutate({ content: chatInput, file: attachedFile || undefined });
      setChatInput("");
      removeFile();
    };

    const tacticalMessages = messages.slice(-10);

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
                  {tacticalChatMutation.isPending && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin text-primary" />
                      <span>Analyzing...</span>
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="border-t border-border p-2 bg-card/30 shrink-0">
                {attachedFile && (
                  <div className="mb-1.5 flex items-center gap-1">
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 flex items-center gap-1">
                      {filePreview ? (
                        <img src={filePreview} alt="" className="h-4 w-4 rounded object-cover" />
                      ) : (
                        <ImageIcon className="h-3 w-3" />
                      )}
                      <span className="max-w-[120px] truncate">{attachedFile.name}</span>
                      <button onClick={removeFile} className="hover:text-destructive" data-testid="button-tactical-remove-file">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  </div>
                )}
                <div className="flex gap-1.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.pdf,.csv"
                    onChange={handleFileChange}
                    className="hidden"
                    data-testid="input-tactical-file"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={tacticalChatMutation.isPending}
                    data-testid="button-tactical-attach"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                  </Button>
                  <Textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); }
                    }}
                    placeholder="Drop chart or ask..."
                    className="min-h-[36px] max-h-[80px] text-xs resize-none bg-transparent border-border"
                    data-testid="input-tactical-chat"
                  />
                  <Button
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={handleSendChat}
                    disabled={(!chatInput.trim() && !attachedFile) || tacticalChatMutation.isPending || !activeTicker}
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
