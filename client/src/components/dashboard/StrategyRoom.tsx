import { useState, useRef, useEffect } from "react";
import { Send, Bot, Paperclip, Sparkles, X, FileText, Image as ImageIcon, Calendar, ChevronRight, BarChart3, BookOpen, Loader2, Pin, MessageSquare } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchChatByTicker, sendChatMessage, analyzeDocument, fetchPlaybooks, updatePlaybookReview,
  fetchJournalEntries, createJournalEntry, deleteJournalEntry,
  type FullNote, type ChatMsg, type TickerData, type NoteData, type Playbook, type JournalEntry, type TacticalBriefing as TacticalBriefingData
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { PlaybookDashboard } from "./PlaybookDashboard";
import { TacticalBriefing } from "./TacticalBriefing";
import { useToast } from "@/hooks/use-toast";

const ACCEPTED_FILE_TYPES = ".pdf,.png,.jpg,.jpeg,.csv";
const MAX_FILE_SIZE = 10 * 1024 * 1024;

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
  const [input, setInput] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<Map<string, string>>(new Map());
  const [activePlaybookId, setActivePlaybookId] = useState<number | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMsg[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

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

  const activePlaybook = playbooksList.find(p => p.id === activePlaybookId) || null;

  const chatMutation = useMutation({
    mutationFn: ({ content, files }: { content: string; files?: File[] }) =>
      sendChatMessage(activeTicker!.id, content, files),
    onSuccess: (data) => {
      setOptimisticMessages([]);
      setIsAiLoading(false);
      queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "chat"] });
      if (data.createdNoteId) {
        queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "notes"] });
        onSelectNote(data.createdNoteId);
      }
    },
    onError: () => {
      setOptimisticMessages([]);
      setIsAiLoading(false);
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: ({ files, content }: { files: File[]; content?: string }) =>
      analyzeDocument(activeTicker!.id, files, content),
    onSuccess: (playbook) => {
      setOptimisticMessages([]);
      setIsAiLoading(false);
      setActivePlaybookId(playbook.id);
      queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "playbooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "chat"] });
      toast({ title: "Playbook Generated", description: `${(playbook.playbookData as any).bias || "Open"} bias — ${(playbook.playbookData as any).macro_theme || "Analysis complete"}` });
    },
    onError: (err: Error) => {
      setOptimisticMessages([]);
      setIsAiLoading(false);
      toast({ title: "Analysis Failed", description: err.message, variant: "destructive" });
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

  useEffect(() => {
    if (scrollRef.current && !activePlaybook) {
      const scrollContainer = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages, optimisticMessages, isAiLoading, activePlaybook]);

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

  const clearFiles = () => {
    setAttachedFiles([]);
    setFilePreviews(new Map());
  };

  const handleSend = (mode?: "playbook" | "chat") => {
    if ((!input.trim() && attachedFiles.length === 0) || !activeTicker) return;
    if (chatMutation.isPending || analyzeMutation.isPending) return;

    const currentInput = input;
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

    setInput("");
    clearFiles();

    if (currentFiles.length > 0 && mode === "playbook") {
      setOptimisticMessages([optimisticUserMsg]);
      setIsAiLoading(true);
      analyzeMutation.mutate({ files: currentFiles, content: currentInput || undefined });
    } else if (currentFiles.length > 0 && mode === "chat") {
      setOptimisticMessages([optimisticUserMsg]);
      setIsAiLoading(true);
      chatMutation.mutate({ content: currentInput || `Analyze these files: ${fileNames}`, files: currentFiles });
    } else if (currentFiles.length > 0) {
      setOptimisticMessages([optimisticUserMsg]);
      setIsAiLoading(true);
      analyzeMutation.mutate({ files: currentFiles, content: currentInput || undefined });
    } else {
      setOptimisticMessages([optimisticUserMsg]);
      setIsAiLoading(true);
      chatMutation.mutate({ content: currentInput, files: undefined });
    }
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith("image/")) return <ImageIcon className="h-3.5 w-3.5" />;
    return <FileText className="h-3.5 w-3.5" />;
  };

  const handleAddLevelToChart = (level: ExtractedLevel) => {
    if (!onAddToChart) return;
    const price = parseFloat(level.price);
    if (isNaN(price)) return;
    const color = level.type === "resistance" ? "#f43f5e" : "#10b981";
    onAddToChart(price, level.description, color);
  };

  const dateGroups = notes.reduce<Record<string, NoteData[]>>((acc, note) => {
    const dateKey = format(new Date(note.createdAt), "yyyy-MM-dd");
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(note);
    return acc;
  }, {});

  const renderMessageContent = (msg: ChatMsg) => {
    const isAssistant = msg.role === "assistant";
    const hasBriefing = isAssistant && msg.structuredData && (msg.structuredData.sentiment || msg.structuredData.levels || msg.structuredData.ifThen);
    const legacyLevels = (isAssistant && !hasBriefing) ? extractLevelsFromMessage(msg.content) : [];
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

        {isAssistant && !hasBriefing && legacyLevels.length > 0 && (
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

        {msg.createdAt && (
          <div className="flex items-center justify-between mt-2">
            <div className="text-[10px] opacity-40 font-mono">
              {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
            {isAssistant && (
              (() => {
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
              })()
            )}
          </div>
        )}
      </>
    );
  };

  const isProcessing = chatMutation.isPending || analyzeMutation.isPending;

  return (
    <div className="h-full flex">
      <div className="w-64 border-r border-border flex flex-col bg-card/30 shrink-0">
        <div className="p-4 border-b border-border bg-card/50">
          <div className="flex items-center gap-2 mb-1">
            <Calendar className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-primary font-mono" data-testid="text-archive-title">
              Daily Briefings
            </h2>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {activeTicker ? `${activeTicker.symbol} game plan archive` : "Select a ticker"}
          </p>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {playbooksList.length > 0 && (
              <div className="mb-2">
                <div className="px-2 py-1.5 text-[10px] font-mono text-primary uppercase tracking-wider flex items-center gap-1.5">
                  <BookOpen className="h-3 w-3" />
                  Playbooks
                </div>
                {playbooksList.map((pb) => {
                  const pbData = pb.playbookData as any;
                  return (
                    <button
                      key={pb.id}
                      onClick={() => setActivePlaybookId(activePlaybookId === pb.id ? null : pb.id)}
                      data-testid={`button-playbook-${pb.id}`}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg text-sm transition-all group",
                        activePlaybookId === pb.id
                          ? "bg-primary/10 border border-primary/20 text-foreground"
                          : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium truncate text-xs">
                          {pbData.bias || "Open"} — {pbData.macro_theme || "Analysis"}
                        </span>
                        {activePlaybookId === pb.id && (
                          <ChevronRight className="h-3 w-3 text-primary shrink-0" />
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {format(new Date(pb.createdAt), "MMM d, h:mm a")}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}

            {journalEntries.length > 0 && (
              <div className="mb-2">
                <div className="px-2 py-1.5 text-[10px] font-mono text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Pin className="h-3 w-3" />
                  Learning Journal
                </div>
                {journalEntries.slice(0, 5).map((entry) => (
                  <div
                    key={entry.id}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-amber-500/5 text-muted-foreground"
                  >
                    <p className="text-[11px] line-clamp-2">{entry.content.slice(0, 100)}...</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                      {format(new Date(entry.createdAt), "MMM d, h:mm a")}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {Object.entries(dateGroups)
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([dateKey, dateNotes]) => (
                <div key={dateKey}>
                  <div className="px-2 py-1.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                    {format(new Date(dateKey), "EEE, MMM d")}
                  </div>
                  {dateNotes.map((note) => (
                    <button
                      key={note.id}
                      onClick={() => { onSelectNote(note.id); setActivePlaybookId(null); }}
                      data-testid={`button-archive-note-${note.id}`}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg text-sm transition-all group",
                        selectedNoteId === note.id && !activePlaybookId
                          ? "bg-primary/10 border border-primary/20 text-foreground"
                          : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium truncate text-xs">{note.title}</span>
                        {selectedNoteId === note.id && !activePlaybookId && (
                          <ChevronRight className="h-3 w-3 text-primary shrink-0" />
                        )}
                      </div>
                      {note.summary && (
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">{note.summary}</p>
                      )}
                    </button>
                  ))}
                </div>
              ))}
            {notes.length === 0 && playbooksList.length === 0 && (
              <div className="p-4 text-xs text-muted-foreground italic text-center">
                {activeTicker ? `No briefings for ${activeTicker.symbol} yet.` : "Select a ticker to begin."}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col bg-background">
        <div className="h-12 border-b border-border flex items-center justify-between px-6 shrink-0 bg-card/30">
          <div className="flex items-center gap-3">
            <Avatar className="h-7 w-7 border border-primary/20">
              <AvatarFallback className="bg-gradient-to-br from-indigo-900 to-slate-900 text-primary text-[10px]">
                {activePlaybook ? <BookOpen size={14} /> : <Sparkles size={14} />}
              </AvatarFallback>
            </Avatar>
            <div>
              <span className="text-sm font-semibold tracking-wide" data-testid="text-strategy-chat-title">
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
            {activeNote && !activePlaybook && (
              <Badge variant="outline" className="font-mono text-[10px] border-primary/20 text-primary" data-testid="badge-active-plan">
                Active Plan: {activeNote.title}
              </Badge>
            )}
          </div>
        </div>

        {activePlaybook ? (
          <PlaybookDashboard
            playbook={activePlaybook}
            onSaveReview={(id, review) => reviewMutation.mutate({ id, review })}
            onAddToChart={onAddToChart}
            isSavingReview={reviewMutation.isPending}
          />
        ) : (
          <>
            <ScrollArea className="flex-1" ref={scrollRef}>
              <div className="max-w-3xl mx-auto py-6 px-6 space-y-6">
                {[...messages, ...optimisticMessages].map((msg) => (
                  <div key={msg.id} className={cn("flex gap-4", msg.role === "user" ? "justify-end" : "")} data-testid={`chat-message-${msg.id}`}>
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
                        {analyzeMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 text-primary animate-spin" />
                            <span className="text-xs text-muted-foreground ml-1">
                              Generating Trading Playbook...
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
                    <div className="mt-6 grid grid-cols-2 gap-3 max-w-sm mx-auto">
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

            <div className="border-t border-border p-4 bg-card/30 shrink-0">
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
                    className="min-h-[80px] w-full resize-none bg-transparent border-0 focus-visible:ring-0 p-4 text-sm placeholder:text-muted-foreground/40 font-medium"
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
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleSend("playbook")}
                          disabled={isProcessing || !activeTicker}
                          className="h-8 px-3 text-xs bg-emerald-600 text-white hover:bg-emerald-700 font-bold tracking-wide rounded-lg"
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
                          className="h-8 px-3 text-xs font-bold tracking-wide rounded-lg border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
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
                        className="h-8 px-4 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-bold tracking-wide rounded-lg"
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
          </>
        )}
      </div>
    </div>
  );
}
