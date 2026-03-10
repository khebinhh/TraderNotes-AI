import { memo, useState } from "react";
import { MessageSquare, ChevronRight, ChevronDown } from "lucide-react";
import { format, isToday as isTodayFn, isValid } from "date-fns";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Playbook } from "@/lib/api";
import type { ChatSession } from "@/lib/sidebar-utils";
import { getTopicName, getAuthorInfo } from "@/lib/sidebar-utils";

interface PlaybookItemProps {
  type: "playbook";
  item: Playbook;
  isActive: boolean;
  onClick: () => void;
  tickerSymbol?: string;
}

interface ChatSessionItemProps {
  type: "chat";
  item: ChatSession;
  isActive: boolean;
  onClick: () => void;
}

interface ConsolidatedChatProps {
  type: "consolidated-chat";
  sessions: ChatSession[];
  dayLabel: string;
  activeSessionId: string | null;
  onSelectSession: (session: ChatSession) => void;
}

type SidebarItemProps = PlaybookItemProps | ChatSessionItemProps | ConsolidatedChatProps;

function safeParseDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T12:00:00");
  return isValid(d) ? d : null;
}

function AuthorLine({ author, targetDate }: { author: string | null | undefined; targetDate: string | null }) {
  const info = getAuthorInfo(author);
  const parsed = safeParseDate(targetDate);
  const fullDate = parsed ? format(parsed, "EEEE, MMM d, yyyy") : null;

  const authorDisplay = (() => {
    if (info.isIzzy && info.isPharmD) {
      return (
        <span className="inline-flex items-center gap-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block" />
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block" />
          <span>Izzy + PharmD</span>
        </span>
      );
    }
    if (info.isIzzy) {
      return (
        <span className="inline-flex items-center gap-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block" />
          <span>Izzy</span>
        </span>
      );
    }
    if (info.isPharmD) {
      return (
        <span className="inline-flex items-center gap-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block" />
          <span>PharmD_KS</span>
        </span>
      );
    }
    if (info.label) return <span>{info.label}</span>;
    return null;
  })();

  if (!authorDisplay && !fullDate) return null;

  return (
    <div className="text-[9px] font-mono text-muted-foreground/60 flex items-center gap-0.5 mt-0.5">
      {authorDisplay}
      {authorDisplay && fullDate && <span className="mx-0.5">•</span>}
      {fullDate && <span>{fullDate}</span>}
    </div>
  );
}

function DateBadge({ targetDate }: { targetDate: string | null }) {
  const date = safeParseDate(targetDate);
  if (!date) return null;

  const isToday = isTodayFn(date);

  if (isToday) {
    return (
      <span
        className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0 uppercase tracking-wider"
        data-testid="badge-date-today"
      >
        TODAY
      </span>
    );
  }

  const shortDate = format(date, "MMM dd").toUpperCase();
  return (
    <span
      className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground shrink-0 uppercase tracking-wider"
      data-testid="badge-date"
    >
      {shortDate}
    </span>
  );
}

export const SidebarItem = memo(function SidebarItem(props: SidebarItemProps) {
  if (props.type === "consolidated-chat") {
    return <ConsolidatedChatItem {...props} />;
  }
  if (props.type === "playbook") {
    return <PlaybookItem {...props} />;
  }
  return <ChatSessionItem {...props} />;
});

function PlaybookItem({ item, isActive, onClick, tickerSymbol }: PlaybookItemProps) {
  const pbData = item.playbookData as any;
  const meta = pbData?.metadata;
  const author = item.author || meta?.author;
  const targetDate = item.targetDateStart || item.date || null;
  const fullTitle = getTopicName(item, tickerSymbol);

  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            data-testid={`button-playbook-${item.id}`}
            className={cn(
              "w-full text-left px-2.5 py-2.5 rounded-lg transition-all group",
              isActive
                ? "bg-amber-500/10 border border-amber-400/40 text-foreground shadow-[0_0_12px_-4px_rgba(251,191,36,0.25)]"
                : "hover:bg-muted/40 text-muted-foreground hover:text-foreground border border-transparent hover:border-border/30"
            )}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <span className={cn(
                  "font-medium text-xs leading-[1.4] line-clamp-2 block",
                  isActive && "text-amber-200"
                )}>
                  {fullTitle}
                </span>
                <AuthorLine author={author} targetDate={targetDate} />
              </div>
              <div className="flex items-center gap-1 shrink-0 pt-0.5">
                <DateBadge targetDate={targetDate} />
                {isActive && <ChevronRight className="h-3 w-3 text-amber-400" />}
              </div>
            </div>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-[280px] text-xs">
          <p>{fullTitle}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ChatSessionItem({ item, isActive, onClick }: ChatSessionItemProps) {
  return (
    <button
      onClick={onClick}
      data-testid={`button-chat-session-${item.id}`}
      className={cn(
        "w-full text-left px-2.5 py-1.5 rounded-lg text-sm transition-all group min-h-[36px] md:min-h-0",
        isActive
          ? "bg-blue-500/10 border border-blue-400/40 text-foreground"
          : "hover:bg-muted/50 text-muted-foreground hover:text-foreground border border-transparent"
      )}
    >
      <div className="flex items-center gap-1.5">
        <MessageSquare className={cn("h-3 w-3 shrink-0", isActive ? "text-blue-400" : "text-muted-foreground/50")} />
        <span className={cn("font-medium truncate text-xs flex-1", isActive && "text-blue-200")}>
          {item.name}
        </span>
        {item.messageCount > 2 && (
          <span className="text-[8px] font-mono text-muted-foreground/50 shrink-0">
            {item.messageCount} msgs
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-0.5 pl-[18px]">
        <span className="text-[9px] text-muted-foreground/50">
          {format(new Date(item.firstMessageAt), "h:mm a")}
        </span>
      </div>
    </button>
  );
}

function ConsolidatedChatItem({ sessions, dayLabel, activeSessionId, onSelectSession }: ConsolidatedChatProps) {
  const [expanded, setExpanded] = useState(false);

  if (sessions.length === 1) {
    return (
      <ChatSessionItem
        type="chat"
        item={sessions[0]}
        isActive={activeSessionId === sessions[0].id}
        onClick={() => onSelectSession(sessions[0])}
      />
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-2.5 py-1.5 rounded-lg text-sm transition-all hover:bg-muted/50 text-muted-foreground hover:text-foreground min-h-[36px] md:min-h-0"
        data-testid={`button-consolidated-chat-${dayLabel}`}
      >
        <div className="flex items-center gap-1.5">
          <MessageSquare className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          <span className="font-medium truncate text-xs flex-1">
            Tactical Review ({sessions.length} sessions)
          </span>
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          )}
        </div>
      </button>
      {expanded && (
        <div className="pl-3 space-y-0.5">
          {sessions.map(session => (
            <ChatSessionItem
              key={session.id}
              type="chat"
              item={session}
              isActive={activeSessionId === session.id}
              onClick={() => onSelectSession(session)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
