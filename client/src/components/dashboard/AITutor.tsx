import { useState, useRef, useEffect } from "react";
import { Send, Bot, Paperclip, MoreHorizontal, Sparkles, X, FileText, Image as ImageIcon } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchChatByTicker, sendChatMessage, type FullNote, type ChatMsg, type TickerData } from "@/lib/api";
import { cn } from "@/lib/utils";

const ACCEPTED_FILE_TYPES = ".pdf,.png,.jpg,.jpeg,.csv";
const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface AITutorProps {
  activeNote: FullNote | null;
  activeTicker: TickerData | null;
}

export function AITutor({ activeNote, activeTicker }: AITutorProps) {
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

  return (
    <div className="h-full flex flex-col bg-background relative">
      <div className="h-12 border-b border-border flex items-center justify-between px-4 shrink-0 bg-card/50 backdrop-blur">
        <div className="flex items-center gap-2">
          <Avatar className="h-6 w-6 border border-primary/20">
            <AvatarFallback className="bg-primary/10 text-primary text-[10px]"><Bot size={14} /></AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-wide leading-tight" data-testid="text-chat-title">
              {activeTicker ? `${activeTicker.symbol} Mentor` : "Trading Mentor"}
            </span>
            {activeTicker && (
              <span className="text-[10px] text-muted-foreground leading-tight">{activeTicker.displayName}</span>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" data-testid="button-chat-menu">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-6 pb-4">
          {messages.map((msg) => (
            <div key={msg.id} className={cn("flex gap-3 max-w-[90%]", msg.role === "user" ? "ml-auto flex-row-reverse" : "")} data-testid={`chat-message-${msg.id}`}>
              <div className="shrink-0 mt-0.5">
                {msg.role === "assistant" ? (
                  <Avatar className="h-8 w-8 border border-primary/20 shadow-[0_0_10px_-4px_rgba(245,158,11,0.5)]">
                    <AvatarFallback className="bg-gradient-to-br from-indigo-900 to-slate-900 text-primary"><Sparkles size={14} /></AvatarFallback>
                  </Avatar>
                ) : (
                  <Avatar className="h-8 w-8 border border-border">
                    <AvatarFallback className="bg-muted text-muted-foreground">ME</AvatarFallback>
                  </Avatar>
                )}
              </div>
              <div className={cn(
                "rounded-lg p-3 text-sm leading-relaxed shadow-sm",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground font-medium rounded-tr-none"
                  : "bg-card border border-border text-card-foreground rounded-tl-none"
              )}>
                <div className="markdown-prose space-y-2">
                  {msg.content.split("\n").map((line, i) => (
                    <p key={i} dangerouslySetInnerHTML={{
                      __html: line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                    }} />
                  ))}
                </div>
                {msg.createdAt && (
                  <div className="text-[10px] opacity-40 mt-2 font-mono text-right">
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                )}
              </div>
            </div>
          ))}
          {chatMutation.isPending && (
            <div className="flex gap-3">
              <Avatar className="h-8 w-8 border border-primary/20">
                <AvatarFallback className="bg-gradient-to-br from-indigo-900 to-slate-900 text-primary"><Sparkles size={14} /></AvatarFallback>
              </Avatar>
              <div className="bg-card border border-border rounded-lg p-3 rounded-tl-none">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-muted-foreground/30 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-2 h-2 bg-muted-foreground/30 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-2 h-2 bg-muted-foreground/30 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
          {!activeTicker && (
            <div className="text-center text-xs text-muted-foreground italic py-8">Select a ticker to start chatting.</div>
          )}
        </div>
      </ScrollArea>

      <div className="p-4 bg-background border-t border-border shrink-0">
        {attachedFile && (
          <div className="mb-2 flex items-center gap-2" data-testid="file-attachment-badge">
            <Badge variant="secondary" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-primary/10 border border-primary/20">
              {filePreview ? (
                <img src={filePreview} alt="preview" className="h-6 w-6 rounded object-cover" />
              ) : (
                getFileIcon(attachedFile)
              )}
              <span className="max-w-[150px] truncate">{attachedFile.name}</span>
              <span className="text-muted-foreground">({(attachedFile.size / 1024).toFixed(0)}KB)</span>
              <button
                onClick={removeFile}
                className="ml-1 hover:text-destructive transition-colors"
                data-testid="button-remove-file"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </Badge>
          </div>
        )}
        <div className="relative rounded-xl border border-input bg-card shadow-sm transition-shadow focus-within:shadow-[0_0_0_1px_hsl(var(--ring))]">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={activeTicker ? `Ask about ${activeTicker.symbol} levels, history, or structure...` : "Select a ticker first..."}
            disabled={!activeTicker}
            className="min-h-[70px] w-full resize-none bg-transparent border-0 focus-visible:ring-0 p-3 text-sm placeholder:text-muted-foreground/50 font-medium"
            data-testid="input-chat"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_FILE_TYPES}
            onChange={handleFileChange}
            className="hidden"
            data-testid="input-file-upload"
          />
          <div className="flex items-center justify-between p-2 pt-0">
            <div className="flex gap-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-7 w-7 text-muted-foreground hover:text-foreground",
                        attachedFile && "text-primary"
                      )}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!activeTicker}
                      data-testid="button-attach"
                    >
                      <Paperclip className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Attach Screenshot/PDF (PNG, JPG, PDF, CSV)</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Button
              size="sm"
              onClick={handleSend}
              disabled={(!input.trim() && !attachedFile) || chatMutation.isPending || !activeTicker}
              className="h-7 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-bold tracking-wide"
              data-testid="button-send"
            >
              SEND <Send className="ml-2 h-3 w-3" />
            </Button>
          </div>
        </div>
        <div className="text-[10px] text-center mt-2 text-muted-foreground/30 font-mono">
          {activeTicker ? `${activeTicker.symbol} • Trading Mentor AI` : "Trading Mentor AI"}
        </div>
      </div>
    </div>
  );
}
