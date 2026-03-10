import { format, isToday, isYesterday, isSameMonth, isSameDay } from "date-fns";
import type { Playbook, ChatMsg, NoteData } from "./api";

export interface ChatSession {
  id: string;
  name: string;
  messageCount: number;
  firstMessageAt: string;
  lastMessageAt: string;
  messages: ChatMsg[];
}

export interface DayGroup {
  label: string;
  date: Date;
  dateKey: string;
  officialReports: Playbook[];
  tacticalSessions: ChatSession[];
  notes: NoteData[];
}

export interface WeekGroup {
  label: string;
  weekNumber: number;
  days: DayGroup[];
  isCurrent: boolean;
}

export interface MonthGroup {
  label: string;
  monthKey: string;
  weeks: WeekGroup[];
  isCurrent: boolean;
}

export interface NavigatorTree {
  months: MonthGroup[];
}

export function deriveSessionName(messages: ChatMsg[]): string {
  const firstUserMsg = messages.find(m => m.role === "user");
  if (!firstUserMsg) return "Chat Session";

  const content = firstUserMsg.content;

  const fileMatch = content.match(/\[(\d+) files?: (.+?)\]/);
  if (fileMatch && content.replace(/\[\d+ files?: .+?\]/, "").trim().length === 0) {
    return "Document Analysis";
  }

  let cleaned = content
    .replace(/\[\d+ files?: .+?\]/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .trim();

  if (!cleaned) return "Document Analysis";

  cleaned = cleaned.replace(/^(hey|hi|hello|can you|could you|please|analyze|look at|check)\s+/i, "");

  const tickerMatch = cleaned.match(/\b(ES|NQ|BTC|ETH|SPY|QQQ|AAPL|TSLA|AMZN|GOOGL|MSFT)\b/i);
  const priceMatch = cleaned.match(/\b(\d{3,5}(?:\.\d{1,2})?)\b/);
  const keywordMatch = cleaned.match(/\b(LAAF|LBAF|squeeze|breakout|breakdown|support|resistance|gap|fill|reversal|bounce|rejection|fade|OPEX|FOMC|CPI|NFP|earnings)\b/i);

  if (tickerMatch && priceMatch && keywordMatch) {
    return `${keywordMatch[1]} at ${priceMatch[1]}`;
  }
  if (keywordMatch && priceMatch) {
    return `${keywordMatch[1]} at ${priceMatch[1]}`;
  }
  if (tickerMatch && keywordMatch) {
    return `${tickerMatch[1]} ${keywordMatch[1]} Review`;
  }

  const truncated = cleaned.length > 35 ? cleaned.slice(0, 33) + "…" : cleaned;
  return truncated || "Chat Session";
}

function groupChatIntoSessions(messages: ChatMsg[]): ChatSession[] {
  if (messages.length === 0) return [];

  const sorted = [...messages].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const sessions: ChatSession[] = [];
  let currentSession: ChatMsg[] = [sorted[0]];
  const SESSION_GAP_MS = 2 * 60 * 60 * 1000;

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].createdAt).getTime();
    const curr = new Date(sorted[i].createdAt).getTime();

    if (curr - prev > SESSION_GAP_MS || !isSameDay(new Date(sorted[i - 1].createdAt), new Date(sorted[i].createdAt))) {
      sessions.push(buildSession(currentSession));
      currentSession = [sorted[i]];
    } else {
      currentSession.push(sorted[i]);
    }
  }
  if (currentSession.length > 0) {
    sessions.push(buildSession(currentSession));
  }

  return sessions;
}

function buildSession(messages: ChatMsg[]): ChatSession {
  const name = deriveSessionName(messages);
  return {
    id: `session-${messages[0].id}`,
    name,
    messageCount: messages.length,
    firstMessageAt: messages[0].createdAt,
    lastMessageAt: messages[messages.length - 1].createdAt,
    messages,
  };
}

function getWeekOfMonth(date: Date): number {
  return Math.ceil(date.getDate() / 7);
}

export function getTopicName(pb: Playbook, tickerSymbol?: string): string {
  const pbData = pb.playbookData as any;
  const meta = pbData?.metadata;
  if (meta?.session_summary) return meta.session_summary;
  if (meta?.report_title && meta.report_title.length <= 40) return meta.report_title;
  const bias = pbData?.bias || pbData?.thesis?.bias;
  const theme = pbData?.macro_theme || meta?.report_title;
  if (theme && bias) {
    const short = theme.length > 30 ? theme.slice(0, 28) + "…" : theme;
    return `${short} — ${bias}`;
  }
  if (theme) return theme.length > 40 ? theme.slice(0, 38) + "…" : theme;
  if (bias) return `${tickerSymbol || "Session"} ${bias}`;
  return "Analysis";
}

export function getAuthorInfo(author: string | null | undefined): { isIzzy: boolean; isPharmD: boolean; label: string | null } {
  if (!author) return { isIzzy: false, isPharmD: false, label: null };
  const isIzzy = author.toLowerCase().includes("izzy");
  const isPharmD = author.toLowerCase().includes("pharmd");
  return { isIzzy, isPharmD, label: author };
}

export function groupBriefingsByDate(
  playbooks: Playbook[],
  chatMessages: ChatMsg[],
  notes: NoteData[]
): NavigatorTree {
  const now = new Date();
  const allDates: Map<string, DayGroup> = new Map();

  playbooks.forEach(pb => {
    const date = new Date(pb.createdAt);
    const dateKey = format(date, "yyyy-MM-dd");
    if (!allDates.has(dateKey)) {
      allDates.set(dateKey, {
        label: getDayLabel(date),
        date,
        dateKey,
        officialReports: [],
        tacticalSessions: [],
        notes: [],
      });
    }
    allDates.get(dateKey)!.officialReports.push(pb);
  });

  const sessions = groupChatIntoSessions(chatMessages);
  sessions.forEach(session => {
    const date = new Date(session.firstMessageAt);
    const dateKey = format(date, "yyyy-MM-dd");
    if (!allDates.has(dateKey)) {
      allDates.set(dateKey, {
        label: getDayLabel(date),
        date,
        dateKey,
        officialReports: [],
        tacticalSessions: [],
        notes: [],
      });
    }
    allDates.get(dateKey)!.tacticalSessions.push(session);
  });

  notes.forEach(note => {
    const date = new Date(note.createdAt);
    const dateKey = format(date, "yyyy-MM-dd");
    if (!allDates.has(dateKey)) {
      allDates.set(dateKey, {
        label: getDayLabel(date),
        date,
        dateKey,
        officialReports: [],
        tacticalSessions: [],
        notes: [],
      });
    }
    allDates.get(dateKey)!.notes.push(note);
  });

  const monthMap: Map<string, { days: Map<string, DayGroup>; label: string; date: Date }> = new Map();

  allDates.forEach((dayGroup, dateKey) => {
    const monthKey = format(dayGroup.date, "yyyy-MM");
    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, {
        days: new Map(),
        label: format(dayGroup.date, "MMMM yyyy"),
        date: dayGroup.date,
      });
    }
    monthMap.get(monthKey)!.days.set(dateKey, dayGroup);
  });

  const months: MonthGroup[] = Array.from(monthMap.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([monthKey, monthData]) => {
      const weekMap: Map<number, DayGroup[]> = new Map();

      monthData.days.forEach(dayGroup => {
        const weekNum = getWeekOfMonth(dayGroup.date);
        if (!weekMap.has(weekNum)) weekMap.set(weekNum, []);
        weekMap.get(weekNum)!.push(dayGroup);
      });

      const nowWeekOfMonth = getWeekOfMonth(now);
      const nowMonthKey = format(now, "yyyy-MM");

      const weeks: WeekGroup[] = Array.from(weekMap.entries())
        .sort(([a], [b]) => b - a)
        .map(([weekNum, days]) => {
          const sortedDays = days.sort((a, b) =>
            b.date.getTime() - a.date.getTime()
          );
          const isCurrentWeek = monthKey === nowMonthKey && weekNum === nowWeekOfMonth;
          return {
            label: `Week ${weekNum}`,
            weekNumber: weekNum,
            days: sortedDays,
            isCurrent: isCurrentWeek,
          };
        });

      return {
        label: monthData.label,
        monthKey,
        weeks,
        isCurrent: isSameMonth(monthData.date, now),
      };
    });

  return { months };
}

function getDayLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEE, MMM d");
}

export function countItemsInMonth(month: MonthGroup): number {
  return month.weeks.reduce((sum, week) =>
    sum + week.days.reduce((daySum, day) =>
      daySum + day.officialReports.length + day.tacticalSessions.length + day.notes.length, 0
    ), 0
  );
}

export function countItemsInWeek(week: WeekGroup): number {
  return week.days.reduce((sum, day) =>
    sum + day.officialReports.length + day.tacticalSessions.length + day.notes.length, 0
  );
}
