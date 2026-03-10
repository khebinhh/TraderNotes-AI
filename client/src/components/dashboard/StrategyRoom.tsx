import { useState, useRef, useEffect, useMemo, useCallback, memo } from "react";
import { Send, Bot, Paperclip, Sparkles, X, FileText, Image as ImageIcon, Calendar, ChevronRight, BarChart3, BookOpen, Loader2, Pin, MessageSquare, RefreshCw, AlertTriangle, Menu, MapPin } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  fetchChatByTicker, sendChatMessage, analyzeDocument, fetchPlaybooks, updatePlaybookReview,
  fetchJournalEntries, createJournalEntry, deleteJournalEntry, pinMessageToPlaybook, deletePlaybook,
  type FullNote, type ChatMsg, type TickerData, type NoteData, type Playbook, type JournalEntry, type TacticalBriefing as TacticalBriefingData
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { PlaybookDashboard } from "./PlaybookDashboard";
import { TacticalBriefing } from "./TacticalBriefing";
import { SidebarItem } from "./SidebarItem";
import { getTopicName, type ChatSession } from "@/lib/sidebar-utils";
import { PostMarketRecap } from "./PostMarketRecap";
import { useToast } from "@/hooks/use-toast";

const ACCEPTED_FILE_TYPES = ".pdf,.png,.jpg,.jpeg,.csv";
const MAX_FILE_SIZE = 10 * 1024 * 1024;

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

interface ExtractedLevel {
  price: string;
  type: "support" | "resistance";
  description: string;
}

function extractLevelsFromMessage(content: string): ExtractedLevel[] {
  const levels: ExtractedLevel[] = [];
  const patterns = [
    /\*\*(\d[\d,]*\.?\d*)\*\*\s*[—–-]\s*(Support|Resistance|Pivot|Target)/gi,
    /\*\*(\d[\d,]*\.?\d*(?:\s*-\s*\d[\d,]*\.?\d*)?)\*\*\s*[—–-]\s*(?:Type:\s*)?(Support|Resistance|Pivot|Target)/gi,
    /(\d{4,6}\.?\d*)\s*(?:is|as)\s+(?:a\s+)?(?:key\s+)?(support|resistance)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const price = match[1].replace(/,/g, "").split("-")[0].trim();
      const typeRaw = match[2].toLowerCase();
      const type: "support" | "resistance" = typeRaw.includes("resist") || typeRaw.includes("target") ? "resistance" : "support";
      if (!levels.find(l => l.price === price)) {
        levels.push({ price, type, description: `${type === "resistance" ? "Resistance" : "Support"} at ${price}` });
      }
    }
  }
  return levels;
}

interface ChatInputProps {
  activeTicker: TickerData | null;
  isProcessing: boolean;
  hasError: boolean;
  onSend: (content: string, files: File[], mode?: "playbook" | "chat") => void;
}

const ChatInput = memo(function ChatInput({ activeTicker, isProcessing, hasError, onSend }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<Map<string, string>>(new Map());
  const [pendingInput, setPendingInput] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (hasError && pendingInput !== null) {
      setInput(pendingInput);
      setPendingInput(null);
    }
  }, [hasError, pendingInput]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (!selectedFiles.length) return;
    const validFiles = selectedFiles.filter(f => {
      if (f.size > MAX_FILE_SIZE) {
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

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = (mode?: "playbook" | "chat") => {
    if ((!input.trim() && attachedFiles.length === 0) || !activeTicker) return;
    if (isProcessing) return;
    setPendingInput(input);
    onSend(input, [...attachedFiles], mode);
    setInput("");
    setAttachedFiles([]);
    setFilePreviews(new Map());
  };

  return (
    <div className="border-t border-border p-3 md:p-4 bg-card/30 shrink-0">
      <div className="max-w-3xl mx-auto">
        {attachedFiles.length > 0 && (
          <div className="mb-2" data-testid="file-attachment-grid">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Badge variant="outline" className="text-[9px] border-primary/30 text-primary font-mono">
                {attachedFiles.length} file{attachedFiles.length > 1 ? "s" : ""} staged
              </Badge>
              <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400">
                Choose action below
              </Badge>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
              {attachedFiles.map((file, idx) => {
                const preview = filePreviews.get(file.name + file.size);
                return (
                  <div key={`${file.name}-${idx}`} className="relative shrink-0 group" data-testid={`file-thumb-${idx}`}>
                    <div className="w-16 h-16 rounded-lg border border-border bg-muted/30 flex items-center justify-center overflow-hidden">
                      {preview ? (
                        <img src={preview} alt={file.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="flex flex-col items-center gap-0.5">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                          <span className="text-[8px] text-muted-foreground uppercase">{file.name.split('.').pop()}</span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => removeFile(idx)}
                      className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      data-testid={`button-remove-file-${idx}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                    <p className="text-[8px] text-muted-foreground/70 mt-0.5 max-w-[64px] truncate text-center">{file.name}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="relative rounded-xl border border-input bg-card shadow-sm transition-shadow focus-within:shadow-[0_0_0_2px_hsl(var(--primary)/0.15)]">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={activeTicker
              ? attachedFiles.length > 0
                ? "Optional: Add context about these documents..."
                : `Drop PDFs/charts for a Trading Playbook, or ask about ${activeTicker.symbol}...`
              : "Select a ticker first..."}
            disabled={!activeTicker}
            className="min-h-[60px] md:min-h-[80px] w-full resize-none bg-transparent border-0 focus-visible:ring-0 p-3 md:p-4 text-sm placeholder:text-muted-foreground/40 font-medium"
            data-testid="input-strategy-chat"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_FILE_TYPES}
            onChange={handleFileChange}
            multiple
            className="hidden"
            data-testid="input-file-upload"
          />
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex gap-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("h-8 w-8 text-muted-foreground hover:text-foreground relative", attachedFiles.length > 0 && "text-primary")}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!activeTicker || isProcessing}
                      data-testid="button-attach"
                    >
                      <Paperclip className="h-4 w-4" />
                      {attachedFiles.length > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary text-[9px] font-bold text-primary-foreground flex items-center justify-center" data-testid="badge-file-count">
                          {attachedFiles.length}
                        </span>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Attach PDFs, Charts, or CSVs (multiple allowed)</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {attachedFiles.length > 0 ? (
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  onClick={() => handleSend("playbook")}
                  disabled={isProcessing || !activeTicker}
                  className="h-8 px-3 text-xs bg-emerald-600 text-white hover:bg-emerald-700 font-bold tracking-wide rounded-lg min-h-[44px] md:min-h-0"
                  data-testid="button-generate-playbook"
                >
                  <BookOpen className="mr-1.5 h-3.5 w-3.5" />
                  GENERATE PLAYBOOK
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleSend("chat")}
                  disabled={isProcessing || !activeTicker}
                  variant="outline"
                  className="h-8 px-3 text-xs font-bold tracking-wide rounded-lg border-blue-500/30 text-blue-400 hover:bg-blue-500/10 min-h-[44px] md:min-h-0"
                  data-testid="button-tactical-research"
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  TACTICAL RESEARCH
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                onClick={() => handleSend()}
                disabled={!input.trim() || isProcessing || !activeTicker}
                className="h-8 px-4 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-bold tracking-wide rounded-lg min-h-[44px] md:min-h-0"
                data-testid="button-send"
              >
                <Send className="mr-2 h-3.5 w-3.5" />
                SEND
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

interface StrategyRoomProps {
  activeTicker: TickerData | null;
  activeNote: FullNote | null;
  notes: NoteData[];
  selectedNoteId: number | null;
  onSelectNote: (id: number) => void;
  onAddToChart?: (price: number, label: string, color: string) => void;
  onAddTicker?: (symbol: string) => void;
}

export function StrategyRoom({ activeTicker, activeNote, notes, selectedNoteId, onSelectNote, onAddToChart, onAddTicker }: StrategyRoomProps) {
  const [activePlaybookId, setActivePlaybookId] = useState<number | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMsg[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [lastPendingRequest, setLastPendingRequest] = useState<{ content: string; files: File[]; mode?: "playbook" | "chat" } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevTickerIdRef = useRef<number | undefined>(activeTicker?.id);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const { data: messages = [] } = useQuery<ChatMsg[]>({
    queryKey: ["/api/tickers", activeTicker?.id, "chat"],
    queryFn: () => fetchChatByTicker(activeTicker!.id),
    enabled: !!activeTicker,
  });

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

  const activePlaybook = playbooksList.find(p => p.id === activePlaybookId) || null;

  const todayDailyPlaybook = useMemo(() => {
    if (playbooksList.length === 0) return null;
    const nowNY = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const todayStr = `${nowNY.getFullYear()}-${String(nowNY.getMonth() + 1).padStart(2, "0")}-${String(nowNY.getDate()).padStart(2, "0")}`;

    const dailyMatch = playbooksList.find(p => {
      const isDaily = !p.horizonType || p.horizonType === "Daily";
      if (p.targetDateStart && isDaily) return p.targetDateStart === todayStr;
      if (isDaily) return p.date === todayStr;
      return false;
    });
    if (dailyMatch) return dailyMatch;

    return playbooksList[0];
  }, [playbooksList]);

  const chatMutation = useMutation({
    mutationFn: ({ content, files }: { content: string; files?: File[] }) =>
      sendChatMessage(activeTicker!.id, content, files),
    onSuccess: (data) => {
      setOptimisticMessages([]);
      setIsAiLoading(false);
      setIsRetrying(false);
      queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "chat"] });

      if (data.fallback) {
        setErrorMessage("AI service is temporarily unavailable. Your playbook levels are shown below.");
      } else {
        setLastPendingRequest(null);
        setErrorMessage(null);
      }

      if (data.createdNoteId) {
        queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "notes"] });
        onSelectNote(data.createdNoteId);
      }
    },
    onError: (err: Error) => {
      setOptimisticMessages([]);
      setIsAiLoading(false);
      setIsRetrying(false);
      const msg = err.message.includes("busy") || err.message.includes("503")
        ? "AI service is experiencing high traffic. Please try again in a moment."
        : err.message.includes("429")
          ? "Rate limited. Please wait a moment before retrying."
          : err.message || "Failed to connect. Please try again.";
      setErrorMessage(msg);
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: ({ files, content }: { files: File[]; content?: string }) =>
      analyzeDocument(activeTicker!.id, files, content),
    onSuccess: (playbook) => {
      setOptimisticMessages([]);
      setIsAiLoading(false);
      setLastPendingRequest(null);
      setErrorMessage(null);
      setIsRetrying(false);
      setActivePlaybookId(playbook.id);
      queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "playbooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "chat"] });
      toast({ title: "Playbook Generated", description: `${(playbook.playbookData as any).bias || "Open"} bias — ${(playbook.playbookData as any).macro_theme || "Analysis complete"}` });
    },
    onError: (err: Error) => {
      setOptimisticMessages([]);
      setIsAiLoading(false);
      setIsRetrying(false);
      queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "chat"] });
      const msg = err.message.includes("busy") || err.message.includes("503")
        ? "AI service is experiencing high traffic. Please try again in a moment."
        : err.message.includes("429")
          ? "Rate limited. Please wait a moment before retrying."
          : err.message.includes("JSON") || err.message.includes("invalid")
            ? "Analysis formatted incorrectly. The AI response couldn't be parsed. Please try again."
            : err.message || "Analysis failed. Please try again.";
      setErrorMessage(msg);
    },
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, review }: { id: number; review: string }) =>
      updatePlaybookReview(id, review),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "playbooks"] });
      toast({ title: "Review Saved" });
    },
  });

  const { data: journalEntries = [] } = useQuery<JournalEntry[]>({
    queryKey: ["/api/tickers", activeTicker?.id, "journal"],
    queryFn: () => fetchJournalEntries(activeTicker!.id),
    enabled: !!activeTicker,
  });

  const pinMutation = useMutation({
    mutationFn: ({ content, sourceMessageId }: { content: string; sourceMessageId?: number }) =>
      createJournalEntry(activeTicker!.id, content, sourceMessageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "journal"] });
      toast({ title: "Pinned to Journal", description: "AI insight saved to your Learning Journal" });
    },
  });

  const unpinMutation = useMutation({
    mutationFn: (id: number) => deleteJournalEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "journal"] });
      toast({ title: "Removed from Journal" });
    },
  });

  const pinToPlaybookMutation = useMutation({
    mutationFn: ({ playbookId, messageId }: { playbookId: number; messageId: number }) =>
      pinMessageToPlaybook(playbookId, messageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "playbooks"] });
      toast({ title: "Pinned to Playbook", description: "Chat message pinned to your active playbook" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePlaybook(id),
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "playbooks"] });
      const remaining = playbooksList.filter(p => p.id !== deletedId);
      setActivePlaybookId(remaining.length > 0 ? remaining[0].id : null);
      toast({ title: "Playbook Deleted", description: "The playbook has been removed from your workspace" });
    },
    onError: () => {
      toast({ title: "Delete Failed", description: "Could not delete the playbook. Please try again.", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (scrollRef.current && !activePlaybook) {
      const scrollContainer = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages, optimisticMessages, isAiLoading, activePlaybook]);

  const fireRequest = useCallback((content: string, files: File[], mode?: "playbook" | "chat") => {
    if (!activeTicker) return;
    const fileNames = files.map(f => f.name).join(", ");

    if (files.length > 0 && (mode === "playbook" || !mode)) {
      analyzeMutation.mutate({ files, content: content || undefined });
    } else if (files.length > 0 && mode === "chat") {
      chatMutation.mutate({ content: content || `Analyze these files: ${fileNames}`, files });
    } else {
      chatMutation.mutate({ content, files: undefined });
    }
  }, [activeTicker, chatMutation, analyzeMutation]);

  const handleSend = useCallback((content: string, files: File[], mode?: "playbook" | "chat") => {
    if ((!content.trim() && files.length === 0) || !activeTicker) return;
    if (chatMutation.isPending || analyzeMutation.isPending) return;

    setLastPendingRequest({ content, files, mode });
    setErrorMessage(null);

    const fileNames = files.map(f => f.name).join(", ");
    const optimisticUserMsg: ChatMsg = {
      id: Date.now(),
      role: "user",
      content: content + (files.length > 0 ? ` [${files.length} file${files.length > 1 ? "s" : ""}: ${fileNames}]` : ""),
      createdAt: new Date().toISOString(),
      tickerId: activeTicker.id,
      userId: "",
    };

    setOptimisticMessages([optimisticUserMsg]);
    setIsAiLoading(true);
    fireRequest(content, files, mode);
  }, [activeTicker, chatMutation, analyzeMutation, fireRequest]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  const handleRetry = useCallback(() => {
    if (!lastPendingRequest || !activeTicker) return;
    if (chatMutation.isPending || analyzeMutation.isPending) return;

    const needsWarmup = errorMessage?.includes("high traffic") || errorMessage?.includes("Rate limited");
    const delay = needsWarmup ? 2000 : 0;

    setIsRetrying(true);
    setErrorMessage(null);
    setIsAiLoading(true);

    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      fireRequest(lastPendingRequest.content, lastPendingRequest.files, lastPendingRequest.mode);
    }, delay);
  }, [lastPendingRequest, activeTicker, chatMutation, analyzeMutation, fireRequest, errorMessage]);

  const handleAddLevelToChart = useCallback((level: ExtractedLevel) => {
    if (!onAddToChart) return;
    const price = parseFloat(level.price);
    if (isNaN(price)) return;
    const color = level.type === "resistance" ? "#f43f5e" : "#10b981";
    onAddToChart(price, level.description, color);
  }, [onAddToChart]);

  const renderMessageContent = (msg: ChatMsg) => {
    const isAssistant = msg.role === "assistant";
    const hasBriefing = isAssistant && msg.structuredData && (msg.structuredData.sentiment || msg.structuredData.levels || msg.structuredData.ifThen);
    const hasRecap = isAssistant && msg.structuredData?.postMarketRecap;
    const legacyLevels = (isAssistant && !hasBriefing && !hasRecap) ? extractLevelsFromMessage(msg.content) : [];
    const syncMatches = isAssistant ? Array.from(msg.content.matchAll(/\*{0,2}\[SYNC_SUGGEST:\s*([A-Z0-9!.]+)\]\*{0,2}/g)) : [];
    const cleanContent = msg.content
      .replace(/```[\w]*\s*[\s\S]*?```/g, "")
      .replace(/\*{0,2}\[SYNC_SUGGEST:\s*[A-Z0-9!.]+\]\*{0,2}/g, "")
      .trim();

    return (
      <>
        {cleanContent && (
          <div className="space-y-2">
            {cleanContent.split("\n").map((line, i) => (
              <p key={i} dangerouslySetInnerHTML={{
                __html: line
                  .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                  .replace(/\[([ x])\]/g, (_, c) => c === "x" ? "&#9989;" : "&#11036;")
              }} />
            ))}
          </div>
        )}

        {hasBriefing && (
          <div className={cn(cleanContent ? "mt-3 pt-3 border-t border-border/30" : "")}>
            <TacticalBriefing data={msg.structuredData!} onAddToChart={onAddToChart} />
          </div>
        )}

        {hasRecap && (
          <div className={cn(cleanContent || hasBriefing ? "mt-3 pt-3 border-t border-border/30" : "")}>
            <PostMarketRecap data={msg.structuredData!.postMarketRecap!} />
          </div>
        )}

        {isAssistant && !hasBriefing && !hasRecap && legacyLevels.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border/30">
            <div className="text-[10px] uppercase text-muted-foreground font-mono tracking-wider mb-2">
              Extracted Levels
            </div>
            <div className="flex flex-wrap gap-1.5">
              {legacyLevels.map((level, i) => (
                <TooltipProvider key={i}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => handleAddLevelToChart(level)}
                        className={cn(
                          "flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono font-bold transition-all",
                          "border hover:scale-105 active:scale-95",
                          level.type === "resistance"
                            ? "border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
                            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                        )}
                        data-testid={`button-add-level-${level.price}`}
                      >
                        <BarChart3 className="h-3 w-3" />
                        {level.price}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Add {level.type} level {level.price} to Live Chart
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
            </div>
          </div>
        )}

        {isAssistant && syncMatches.length > 0 && onAddTicker && (
          <div className="mt-3 pt-3 border-t border-border/30">
            <div className="text-[10px] uppercase text-muted-foreground font-mono tracking-wider mb-2">
              Detected Tickers
            </div>
            <div className="flex flex-wrap gap-1.5">
              {syncMatches.map((match, i) => (
                <button
                  key={i}
                  onClick={() => onAddTicker(match[1])}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono font-bold border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-all hover:scale-105 active:scale-95"
                  data-testid={`button-sync-add-${match[1]}`}
                >
                  <Sparkles className="h-3 w-3" />
                  Open {match[1]} Workspace
                </button>
              ))}
            </div>
          </div>
        )}

        {isAssistant && msg.content.includes("⚠️") && (
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => {
                const fileInput = document.createElement("input");
                fileInput.type = "file";
                fileInput.multiple = true;
                fileInput.accept = ".pdf,.png,.jpg,.jpeg,.csv";
                fileInput.onchange = (e) => {
                  const files = Array.from((e.target as HTMLInputElement).files || []);
                  if (files.length === 0) return;
                  const validFiles = files.filter(f => {
                    if (f.size > 10 * 1024 * 1024) {
                      toast({ title: `"${f.name}" exceeds 10MB limit`, variant: "destructive" });
                      return false;
                    }
                    return true;
                  });
                  if (validFiles.length === 0) return;
                  if (!activeTicker) return;
                  setIsAiLoading(true);
                  analyzeMutation.mutate({ files: validFiles, content: undefined });
                };
                fileInput.click();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono font-bold border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-all hover:scale-105 active:scale-95"
              disabled={isProcessing}
              data-testid={`button-retry-${msg.id}`}
            >
              <RefreshCw className="h-3 w-3" />
              Retry Upload
            </button>
            <span className="text-[10px] text-muted-foreground/50 font-mono">Re-upload the document to try again</span>
          </div>
        )}

        {msg.createdAt && (
          <div className="flex items-center justify-between mt-2">
            <div className="text-[10px] opacity-40 font-mono">
              {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
            {isAssistant && (
              <div className="flex items-center gap-1.5">
                {playbooksList.length > 0 && (() => {
                  const targetPb = todayDailyPlaybook || playbooksList[0];
                  const pbData = targetPb?.playbookData as any;
                  const isPbPinned = Array.isArray(pbData?.tactical_updates) && pbData.tactical_updates.some((u: any) => u.pinnedMessageId === msg.id);
                  return (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => {
                              if (!isPbPinned && targetPb) pinToPlaybookMutation.mutate({ playbookId: targetPb.id, messageId: msg.id });
                            }}
                            className={cn(
                              "flex items-center gap-1 text-[10px] font-mono transition-all px-1.5 py-0.5 rounded",
                              isPbPinned
                                ? "text-blue-400 bg-blue-500/10"
                                : "text-muted-foreground/40 hover:text-blue-400 hover:bg-blue-500/10"
                            )}
                            disabled={isPbPinned}
                            data-testid={`button-pin-playbook-${msg.id}`}
                          >
                            <BookOpen className="h-3 w-3" />
                            {isPbPinned ? "In Playbook" : "Playbook"}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{isPbPinned ? "Already pinned to playbook" : "Pin to playbook"}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                })()}
                {(() => {
                  const isPinned = journalEntries.some(j => j.sourceMessageId === msg.id);
                  const pinnedEntry = journalEntries.find(j => j.sourceMessageId === msg.id);
                  return (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => {
                              if (isPinned && pinnedEntry) {
                                unpinMutation.mutate(pinnedEntry.id);
                              } else {
                                pinMutation.mutate({ content: msg.content, sourceMessageId: msg.id });
                              }
                            }}
                            className={cn(
                              "flex items-center gap-1 text-[10px] font-mono transition-all px-1.5 py-0.5 rounded",
                              isPinned
                                ? "text-amber-400 bg-amber-500/10"
                                : "text-muted-foreground/40 hover:text-amber-400 hover:bg-amber-500/10"
                            )}
                            data-testid={`button-pin-${msg.id}`}
                          >
                            <Pin className="h-3 w-3" />
                            {isPinned ? "Pinned" : "Pin"}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{isPinned ? "Remove from Learning Journal" : "Pin to Learning Journal"}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </>
    );
  };

  const isProcessing = chatMutation.isPending || analyzeMutation.isPending;

  const [viewMode, setViewMode] = useState<"daily" | "weekly" | "monthly">("daily");

  const filteredPlaybooks = useMemo(() => {
    const horizonMap: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
    const target = horizonMap[viewMode];
    return playbooksList
      .filter(p => {
        const ht = p.horizonType || (p.playbookData as any)?.metadata?.horizon_type || "Daily";
        return ht === target;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [playbooksList, viewMode]);

  const todayPlaybookId = useMemo(() => {
    const nowNY = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const todayStr = `${nowNY.getFullYear()}-${String(nowNY.getMonth() + 1).padStart(2, "0")}-${String(nowNY.getDate()).padStart(2, "0")}`;
    const match = playbooksList.find(p => {
      const isDaily = !p.horizonType || p.horizonType === "Daily";
      const d = p.targetDateStart || p.date;
      return isDaily && d === todayStr;
    });
    return match?.id || null;
  }, [playbooksList]);

  const jumpToToday = useCallback(() => {
    setViewMode("daily");
    setTimeout(() => {
      if (todayPlaybookId) {
        setActivePlaybookId(todayPlaybookId);
        const el = document.querySelector(`[data-testid="button-playbook-${todayPlaybookId}"]`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }, 100);
  }, [todayPlaybookId]);

  useEffect(() => {
    if (!activePlaybookId) return;
    const pb = playbooksList.find(p => p.id === activePlaybookId);
    if (!pb) return;

    const ht = (pb.horizonType || (pb.playbookData as any)?.metadata?.horizon_type || "Daily").toLowerCase() as "daily" | "weekly" | "monthly";
    if (ht !== viewMode) {
      setViewMode(ht);
    }

    setTimeout(() => {
      const el = document.querySelector(`[data-testid="button-playbook-${activePlaybookId}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 200);
  }, [activePlaybookId, playbooksList]);

  const handlePlaybookClick = useCallback((pb: Playbook) => {
    setActivePlaybookId(activePlaybookId === pb.id ? null : pb.id);
    setActiveSessionId(null);
    if (isMobile) setSidebarOpen(false);
  }, [activePlaybookId, isMobile]);

  const handleNoteClick = useCallback((noteId: number) => {
    onSelectNote(noteId);
    setActivePlaybookId(null);
    setActiveSessionId(null);
    if (isMobile) setSidebarOpen(false);
  }, [onSelectNote, isMobile]);

  const handleSessionClick = useCallback((session: ChatSession) => {
    setActiveSessionId(activeSessionId === session.id ? null : session.id);
    setActivePlaybookId(null);
    if (isMobile) setSidebarOpen(false);
    setTimeout(() => {
      if (scrollRef.current) {
        const scrollContainer = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }
    }, 100);
  }, [activeSessionId, isMobile]);

  const viewModeConfig = {
    daily: { label: "DAILY", icon: FileText, color: "text-emerald-400", bgActive: "bg-emerald-500/15 border-emerald-500/30 text-emerald-400", description: "Daily game plans" },
    weekly: { label: "WEEKLY", icon: BookOpen, color: "text-blue-400", bgActive: "bg-blue-500/15 border-blue-500/30 text-blue-400", description: "Weekly blueprints" },
    monthly: { label: "MONTHLY", icon: BarChart3, color: "text-violet-400", bgActive: "bg-violet-500/15 border-violet-500/30 text-violet-400", description: "Monthly overviews" },
  };

  const sidebarContent = (
    <div className="flex flex-col h-full max-h-screen overflow-hidden">
      <div className={cn("p-3 border-b border-border bg-card/50 space-y-2.5 shrink-0", isMobile && "pt-2")}>
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary shrink-0" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary font-mono flex-1" data-testid="text-archive-title">
            Navigator
          </h2>
        </div>

        <button
          onClick={jumpToToday}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-amber-400 bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/20 transition-colors min-h-[36px]"
          data-testid="button-jump-to-today"
        >
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          Jump to Today's Plan
        </button>

        <div className="flex gap-1.5">
          {(["daily", "weekly", "monthly"] as const).map(mode => {
            const config = viewModeConfig[mode];
            const ModeIcon = config.icon;
            const count = playbooksList.filter(p => {
              const ht = p.horizonType || (p.playbookData as any)?.metadata?.horizon_type || "Daily";
              return ht === { daily: "Daily", weekly: "Weekly", monthly: "Monthly" }[mode];
            }).length;
            return (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  "flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-lg transition-all border font-mono",
                  viewMode === mode
                    ? config.bgActive
                    : "border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/30 hover:border-border"
                )}
                data-testid={`button-view-${mode}`}
              >
                <ModeIcon className="h-4 w-4" />
                <span className="text-[10px] font-bold uppercase tracking-wider">{config.label}</span>
                {count > 0 && (
                  <span className={cn("text-[9px] opacity-70", viewMode === mode ? "" : "text-muted-foreground")}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
        <div className="p-1.5 space-y-0.5">
          {filteredPlaybooks.length > 0 ? (
            filteredPlaybooks.map(pb => {
              const pbDate = pb.targetDateStart || pb.date;
              const isTodays = todayPlaybookId === pb.id;
              return (
                <div key={pb.id}>
                  {isTodays && (
                    <div className="px-2 py-1 text-[9px] font-mono text-amber-400/80 uppercase tracking-widest flex items-center gap-1">
                      <MapPin className="h-2.5 w-2.5" />
                      Today
                    </div>
                  )}
                  <SidebarItem
                    type="playbook"
                    item={pb}
                    isActive={activePlaybookId === pb.id}
                    onClick={() => handlePlaybookClick(pb)}
                    tickerSymbol={activeTicker?.symbol}
                  />
                </div>
              );
            })
          ) : (
            <div className="p-4 text-xs text-muted-foreground italic text-center">
              {activeTicker
                ? `No ${viewMode} playbooks for ${activeTicker.symbol} yet.`
                : "Select a ticker to begin."}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full flex">
      {isMobile ? (
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-[280px] p-0 flex flex-col">
            <SheetHeader className="sr-only">
              <SheetTitle>Daily Briefings</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col h-full">
              {sidebarContent}
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <div className="w-64 border-r border-border flex flex-col bg-card/30 shrink-0">
          {sidebarContent}
        </div>
      )}

      <div className="flex-1 flex flex-col bg-background min-w-0">
        <div className="h-12 border-b border-border flex items-center justify-between px-4 md:px-6 shrink-0 bg-card/30">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            {isMobile && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setSidebarOpen(true)}
                data-testid="button-open-sidebar"
              >
                <Menu className="h-4 w-4" />
              </Button>
            )}
            <Avatar className="h-7 w-7 border border-primary/20 shrink-0">
              <AvatarFallback className="bg-gradient-to-br from-indigo-900 to-slate-900 text-primary text-[10px]">
                {activePlaybook ? <BookOpen size={14} /> : <Sparkles size={14} />}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <span className="text-sm font-semibold tracking-wide truncate block" data-testid="text-strategy-chat-title">
                {activePlaybook
                  ? `${activeTicker?.symbol || ""} Trading Playbook`
                  : activeTicker ? `${activeTicker.symbol} Strategy Session` : "Strategy Session"}
              </span>
              {activeTicker && !activePlaybook && (
                <span className="text-[10px] text-muted-foreground ml-2">{activeTicker.displayName}</span>
              )}
              {activePlaybook && (
                <span className="text-[10px] text-muted-foreground ml-2">
                  {(activePlaybook.playbookData as any).macro_theme || ""}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activePlaybook && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => setActivePlaybookId(null)}
                data-testid="button-back-to-chat"
              >
                Back to Chat
              </Button>
            )}
            {!activePlaybook && todayDailyPlaybook && (() => {
              const pbData = todayDailyPlaybook.playbookData as any;
              const title = getTopicName(todayDailyPlaybook, activeTicker?.symbol);
              const bias = pbData?.bias || (typeof pbData?.thesis === "object" ? pbData.thesis.bias : null);
              const nowNY = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
              const todayStr = `${nowNY.getFullYear()}-${String(nowNY.getMonth() + 1).padStart(2, "0")}-${String(nowNY.getDate()).padStart(2, "0")}`;
              const pbDate = todayDailyPlaybook.targetDateStart || todayDailyPlaybook.date;
              const isPbToday = pbDate === todayStr;
              return (
                <Badge variant="outline" className="font-mono text-[10px] border-primary/20 text-primary" data-testid="badge-active-plan">
                  Active Plan: {bias ? `${bias} — ` : ""}{title}{!isPbToday && pbDate ? ` (${pbDate})` : ""}
                </Badge>
              );
            })()}
            {!activePlaybook && !todayDailyPlaybook && activeNote && (
              <Badge variant="outline" className="font-mono text-[10px] border-primary/20 text-primary" data-testid="badge-active-plan">
                Active Plan: {activeNote.title}
              </Badge>
            )}
          </div>
        </div>

        {activePlaybook ? (
          <PlaybookDashboard
            playbook={activePlaybook}
            activeTickerSymbol={activeTicker?.symbol}
            onSaveReview={(id, review) => reviewMutation.mutate({ id, review })}
            onAddToChart={onAddToChart}
            onDelete={(id) => deleteMutation.mutate(id)}
            isSavingReview={reviewMutation.isPending}
            isDeleting={deleteMutation.isPending}
          />
        ) : (
          <>
            <ScrollArea className="flex-1" ref={scrollRef}>
              <div className="max-w-3xl mx-auto py-4 md:py-6 px-3 md:px-6 space-y-4 md:space-y-6">
                {[...messages, ...optimisticMessages].map((msg) => (
                  <div key={msg.id} className={cn("flex gap-2 md:gap-4", msg.role === "user" ? "justify-end" : "")} data-testid={`chat-message-${msg.id}`}>
                    {msg.role === "assistant" && (
                      <Avatar className="h-8 w-8 border border-primary/20 shadow-[0_0_10px_-4px_rgba(245,158,11,0.3)] shrink-0 mt-1">
                        <AvatarFallback className="bg-gradient-to-br from-indigo-900 to-slate-900 text-primary">
                          <Sparkles size={14} />
                        </AvatarFallback>
                      </Avatar>
                    )}
                    <div className={cn(
                      "rounded-xl px-4 py-3 text-sm leading-relaxed shadow-sm max-w-[85%]",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground font-medium rounded-tr-none"
                        : "bg-card border border-border text-card-foreground rounded-tl-none"
                    )}>
                      {renderMessageContent(msg)}
                    </div>
                    {msg.role === "user" && (
                      <Avatar className="h-8 w-8 border border-border shrink-0 mt-1">
                        <AvatarFallback className="bg-muted text-muted-foreground text-xs">ME</AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                ))}
                {isAiLoading && (
                  <div className="flex gap-4">
                    <Avatar className="h-8 w-8 border border-primary/20 shrink-0">
                      <AvatarFallback className="bg-gradient-to-br from-indigo-900 to-slate-900 text-primary">
                        <Sparkles size={14} />
                      </AvatarFallback>
                    </Avatar>
                    <div className="bg-card border border-border rounded-xl px-4 py-3 rounded-tl-none">
                      <div className="flex gap-1.5 items-center">
                        {isRetrying ? (
                          <>
                            <Loader2 className="h-4 w-4 text-amber-400 animate-spin" />
                            <span className="text-xs text-muted-foreground ml-1">Retrying...</span>
                          </>
                        ) : analyzeMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 text-primary animate-spin" />
                            <span className="text-xs text-muted-foreground ml-1">
                              Analyzing document and generating Trading Playbook... This may take a moment for large files.
                            </span>
                          </>
                        ) : (
                          <>
                            <div className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                            <div className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                            <div className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                            <span className="text-xs text-muted-foreground ml-2">Analyzing...</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {errorMessage && !isAiLoading && (() => {
                  const fallbackPlaybook = todayDailyPlaybook || (playbooksList.length > 0 ? playbooksList[0] : null);
                  const fallback = extractPlaybookFallback(fallbackPlaybook);
                  return (
                    <div className="flex gap-4" data-testid="error-fallback-container">
                      <Avatar className="h-8 w-8 border border-destructive/30 shrink-0">
                        <AvatarFallback className="bg-gradient-to-br from-red-900/50 to-slate-900 text-destructive">
                          <AlertTriangle size={14} />
                        </AvatarFallback>
                      </Avatar>
                      <div className="bg-destructive/5 border border-destructive/20 rounded-xl px-4 py-3 rounded-tl-none max-w-[85%]">
                        <p className="text-xs text-destructive/90 mb-2">{errorMessage}</p>
                        {fallback && (
                          <div className="mt-2 pt-2 border-t border-amber-500/20" data-testid="fallback-levels-strategy">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <MapPin className="h-3 w-3 text-amber-400" />
                              <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
                                AI offline — {fallback.date} Playbook Levels
                              </span>
                            </div>
                            {fallback.levels.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mb-1.5">
                                {fallback.levels.map((level, i) => (
                                  <Badge key={i} variant="outline" className="text-[10px] font-mono border-amber-500/30 text-amber-300 bg-amber-500/5" data-testid={`fallback-level-${i}`}>
                                    {level}
                                  </Badge>
                                ))}
                              </div>
                            )}
                            {fallback.scenarios.length > 0 && (
                              <div className="space-y-1 mt-1.5">
                                {fallback.scenarios.map((s, i) => (
                                  <p key={i} className="text-[10px] text-amber-300/80 font-mono leading-relaxed" data-testid={`fallback-scenario-${i}`}>
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
                            disabled={chatMutation.isPending || analyzeMutation.isPending}
                            className="h-7 px-3 text-[11px] font-bold border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive mt-2"
                            data-testid="button-retry-analysis"
                          >
                            <RefreshCw className="h-3 w-3 mr-1.5" />
                            Retry Analysis
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })()}
                {!activeTicker && (
                  <div className="text-center py-16">
                    <Bot className="h-12 w-12 text-muted-foreground/20 mx-auto mb-4" />
                    <p className="text-sm text-muted-foreground">Select a ticker to begin your strategy session.</p>
                  </div>
                )}
                {activeTicker && messages.length === 0 && !isProcessing && (
                  <div className="text-center py-16">
                    <BookOpen className="h-12 w-12 text-primary/20 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      {activeTicker.symbol} Strategy Room
                    </h3>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto mb-2">
                      Drop your trading PDFs or chart screenshots here. The AI will generate a
                      <strong className="text-primary"> Visual Trading Playbook</strong> with structural zones,
                      If/Then scenarios, and an execution checklist.
                    </p>
                    <p className="text-xs text-muted-foreground/60 max-w-sm mx-auto">
                      Or just type a question to chat with your AI trading mentor.
                    </p>
                    <div className="mt-6 grid grid-cols-2 gap-3 max-w-sm mx-auto px-2">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-left p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 hover:bg-emerald-500/10 transition-all group cursor-pointer"
                        data-testid="button-upload-pdf"
                      >
                        <FileText className="h-5 w-5 text-emerald-400 mb-2 group-hover:scale-110 transition-transform" />
                        <p className="text-xs font-bold text-emerald-400">Upload PDF/Doc</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">PharmD, Izzy reports</p>
                      </button>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-left p-4 rounded-xl bg-blue-500/5 border border-blue-500/20 hover:bg-blue-500/10 transition-all group cursor-pointer"
                        data-testid="button-upload-chart"
                      >
                        <ImageIcon className="h-5 w-5 text-blue-400 mb-2 group-hover:scale-110 transition-transform" />
                        <p className="text-xs font-bold text-blue-400">Chart Screenshot</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">AI reads chart levels</p>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            <ChatInput
              activeTicker={activeTicker}
              isProcessing={isProcessing}
              hasError={!!errorMessage}
              onSend={handleSend}
            />
          </>
        )}
      </div>
    </div>
  );
}
