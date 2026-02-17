import { useState, useRef, useEffect } from "react";
import { Send, Bot, Paperclip, Sparkles, X, FileText, Image as ImageIcon, Calendar, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchChatByTicker, sendChatMessage, type FullNote, type ChatMsg, type TickerData, type NoteData } from "@/lib/api";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const ACCEPTED_FILE_TYPES = ".pdf,.png,.jpg,.jpeg,.csv";
const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface StrategyRoomProps {
  activeTicker: TickerData | null;
  activeNote: FullNote | null;
  notes: NoteData[];
  selectedNoteId: number | null;
  onSelectNote: (id: number) => void;
}

export function StrategyRoom({ activeTicker, activeNote, notes, selectedNoteId, onSelectNote }: StrategyRoomProps) {
  const [input, setInput] = useState("");
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: messages = [] } = useQuery<ChatMsg[]>({
    queryKey: ["/api/tickers", activeTicker?.id, "chat"],
    queryFn: () => fetchChatByTicker(activeTicker!.id),
    enabled: !!activeTicker,
  });

  const chatMutation = useMutation({
    mutationFn: ({ content, file }: { content: string; file?: File }) =>
      sendChatMessage(activeTicker!.id, content, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "chat"] });
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      alert("File size must be under 10MB");
      return;
    }
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

  const removeFile = () => {
    setAttachedFile(null);
    setFilePreview(null);
  };

  const handleSend = () => {
    if ((!input.trim() && !attachedFile) || chatMutation.isPending || !activeTicker) return;
    chatMutation.mutate({ content: input, file: attachedFile || undefined });
    setInput("");
    removeFile();
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith("image/")) return <ImageIcon className="h-3.5 w-3.5" />;
    return <FileText className="h-3.5 w-3.5" />;
  };

  const dateGroups = notes.reduce<Record<string, NoteData[]>>((acc, note) => {
    const dateKey = format(new Date(note.createdAt), "yyyy-MM-dd");
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(note);
    return acc;
  }, {});

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
                      onClick={() => onSelectNote(note.id)}
                      data-testid={`button-archive-note-${note.id}`}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg text-sm transition-all group",
                        selectedNoteId === note.id
                          ? "bg-primary/10 border border-primary/20 text-foreground"
                          : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium truncate text-xs">{note.title}</span>
                        {selectedNoteId === note.id && (
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
            {notes.length === 0 && (
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
                <Sparkles size={14} />
              </AvatarFallback>
            </Avatar>
            <div>
              <span className="text-sm font-semibold tracking-wide" data-testid="text-strategy-chat-title">
                {activeTicker ? `${activeTicker.symbol} Strategy Session` : "Strategy Session"}
              </span>
              {activeTicker && (
                <span className="text-[10px] text-muted-foreground ml-2">{activeTicker.displayName}</span>
              )}
            </div>
          </div>
          {activeNote && (
            <Badge variant="outline" className="font-mono text-[10px] border-primary/20 text-primary" data-testid="badge-active-plan">
              Active Plan: {activeNote.title}
            </Badge>
          )}
        </div>

        <ScrollArea className="flex-1" ref={scrollRef}>
          <div className="max-w-3xl mx-auto py-6 px-6 space-y-6">
            {messages.map((msg) => (
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
                  <div className="space-y-2">
                    {msg.content.split("\n").map((line, i) => (
                      <p key={i} dangerouslySetInnerHTML={{
                        __html: line
                          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                          .replace(/\[([ x])\]/g, (_, c) => c === "x" ? "✅" : "⬜")
                      }} />
                    ))}
                  </div>
                  {msg.createdAt && (
                    <div className="text-[10px] opacity-40 mt-2 font-mono text-right">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  )}
                </div>
                {msg.role === "user" && (
                  <Avatar className="h-8 w-8 border border-border shrink-0 mt-1">
                    <AvatarFallback className="bg-muted text-muted-foreground text-xs">ME</AvatarFallback>
                  </Avatar>
                )}
              </div>
            ))}
            {chatMutation.isPending && (
              <div className="flex gap-4">
                <Avatar className="h-8 w-8 border border-primary/20 shrink-0">
                  <AvatarFallback className="bg-gradient-to-br from-indigo-900 to-slate-900 text-primary">
                    <Sparkles size={14} />
                  </AvatarFallback>
                </Avatar>
                <div className="bg-card border border-border rounded-xl px-4 py-3 rounded-tl-none">
                  <div className="flex gap-1.5 items-center">
                    <div className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    <span className="text-xs text-muted-foreground ml-2">Analyzing...</span>
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
            {activeTicker && messages.length === 0 && !chatMutation.isPending && (
              <div className="text-center py-16">
                <Sparkles className="h-12 w-12 text-primary/20 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {activeTicker.symbol} Strategy Room
                </h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Drop your trading PDFs, charts, or notes here. The AI will extract key levels,
                  build your daily game plan, and create an execution checklist.
                </p>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="border-t border-border p-4 bg-card/30 shrink-0">
          <div className="max-w-3xl mx-auto">
            {attachedFile && (
              <div className="mb-2 flex items-center gap-2" data-testid="file-attachment-badge">
                <Badge variant="secondary" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-primary/10 border border-primary/20">
                  {filePreview ? (
                    <img src={filePreview} alt="preview" className="h-6 w-6 rounded object-cover" />
                  ) : (
                    getFileIcon(attachedFile)
                  )}
                  <span className="max-w-[200px] truncate">{attachedFile.name}</span>
                  <span className="text-muted-foreground">({(attachedFile.size / 1024).toFixed(0)}KB)</span>
                  <button onClick={removeFile} className="ml-1 hover:text-destructive transition-colors" data-testid="button-remove-file">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </Badge>
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
                  ? `Drop a PDF, paste your game plan, or ask about ${activeTicker.symbol}...`
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
                          className={cn("h-8 w-8 text-muted-foreground hover:text-foreground", attachedFile && "text-primary")}
                          onClick={() => fileInputRef.current?.click()}
                          disabled={!activeTicker}
                          data-testid="button-attach"
                        >
                          <Paperclip className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Attach PDF, Chart, or CSV</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Button
                  size="sm"
                  onClick={handleSend}
                  disabled={(!input.trim() && !attachedFile) || chatMutation.isPending || !activeTicker}
                  className="h-8 px-4 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-bold tracking-wide rounded-lg"
                  data-testid="button-send"
                >
                  <Send className="mr-2 h-3.5 w-3.5" />
                  SEND
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
