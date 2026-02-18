import { apiRequest } from "./queryClient";

export interface TickerData {
  id: number;
  userId: string | null;
  symbol: string;
  displayName: string;
  exchange: string | null;
  color: string | null;
}

export interface NoteLevel {
  id: number;
  noteId: number | null;
  ticker: string;
  priceLow: string;
  priceHigh: string | null;
  levelType: string;
  description: string | null;
}

export interface ChecklistItem {
  id: number;
  checklistId: number | null;
  content: string;
  isCompleted: boolean;
}

export interface NoteEvent {
  id: number;
  userId: string | null;
  noteId: number | null;
  title: string;
  eventTime: string;
  impactLevel: string;
}

export interface DailyChecklist {
  id: number;
  userId: string | null;
  noteId: number | null;
  date: string;
  status: string;
  closingNote: string | null;
}

export interface NoteData {
  id: number;
  userId: string | null;
  tickerId: number | null;
  title: string;
  rawContent: string | null;
  summary: string | null;
  createdAt: string;
  tags: string[] | null;
}

export interface FullNote extends NoteData {
  levels: NoteLevel[];
  events: NoteEvent[];
  checklist: DailyChecklist | null;
  checklistItems: ChecklistItem[];
}

export interface ChatMsg {
  id: number;
  userId: string | null;
  tickerId: number | null;
  role: string;
  content: string;
  createdAt: string;
}

export async function seedData() {
  const res = await apiRequest("POST", "/api/seed");
  return res.json();
}

export async function fetchTickers(): Promise<TickerData[]> {
  const res = await fetch("/api/tickers", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch tickers");
  return res.json();
}

export async function createTicker(data: { symbol: string; displayName: string; exchange?: string; color?: string }): Promise<TickerData> {
  const res = await apiRequest("POST", "/api/tickers", data);
  return res.json();
}

export async function fetchNotesByTicker(tickerId: number): Promise<NoteData[]> {
  const res = await fetch(`/api/tickers/${tickerId}/notes`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch notes");
  return res.json();
}

export async function fetchFullNote(id: number): Promise<FullNote> {
  const res = await fetch(`/api/notes/${id}/full`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch note");
  return res.json();
}

export async function toggleChecklistItem(id: number, isCompleted: boolean): Promise<ChecklistItem> {
  const res = await apiRequest("PATCH", `/api/checklist-items/${id}/toggle`, { isCompleted });
  return res.json();
}

export async function sendChatMessage(tickerId: number, content: string, file?: File): Promise<{ userMessage: ChatMsg; aiMessage: ChatMsg; createdNoteId?: number | null }> {
  const formData = new FormData();
  formData.append("content", content);
  if (file) {
    formData.append("file", file);
  }
  const res = await fetch(`/api/tickers/${tickerId}/chat`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Chat request failed" }));
    throw new Error(err.message);
  }
  return res.json();
}

export async function fetchChatByTicker(tickerId: number): Promise<ChatMsg[]> {
  const res = await fetch(`/api/tickers/${tickerId}/chat`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch chat");
  return res.json();
}

export async function createNote(data: {
  note: { title: string; rawContent: string; summary: string; tickerId: number; tags?: string[] };
  levels: Array<{ priceLow: string; priceHigh?: string; levelType: string; description?: string; ticker?: string }>;
  events: Array<{ title: string; eventTime: string; impactLevel?: string }>;
  checklistItems: Array<{ content: string; isCompleted?: boolean }>;
}): Promise<any> {
  const res = await apiRequest("POST", "/api/notes", data);
  return res.json();
}

export async function closeChecklist(id: number, closingNote: string): Promise<DailyChecklist> {
  const res = await apiRequest("PATCH", `/api/checklists/${id}`, { status: "closed", closingNote });
  return res.json();
}

export interface PriceRatioData {
  ratio: number;
  futuresPrice: number | null;
  etfPrice: number | null;
  etfSymbol: string;
  tvSymbol: string;
  lastUpdated: string;
  isFallback: boolean;
}

export async function fetchPriceRatio(symbol: string): Promise<PriceRatioData> {
  const res = await fetch(`/api/price-ratio/${encodeURIComponent(symbol)}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch price ratio");
  return res.json();
}

export interface PlaybookZoneLevel {
  price: number;
  price_high: number | null;
  label: string;
  context: string;
  source: string;
}

export interface PlaybookScenario {
  id: string;
  condition: string;
  outcome: string;
  zone: "green" | "yellow" | "red";
  source: string;
}

export interface PlaybookEvent {
  title: string;
  time: string;
  impact: "high" | "medium" | "low";
  expected_behavior: string;
}

export interface PlaybookData {
  macro_theme: string;
  bias: "Bullish" | "Bearish" | "Neutral" | "Open";
  thesis: string;
  structural_zones: {
    bullish_green: PlaybookZoneLevel[];
    neutral_yellow: PlaybookZoneLevel[];
    bearish_red: PlaybookZoneLevel[];
  };
  if_then_scenarios: PlaybookScenario[];
  key_events: PlaybookEvent[];
  risk_factors: string[];
  execution_checklist: string[];
}

export interface Playbook {
  id: number;
  userId: string | null;
  tickerId: number | null;
  date: string;
  playbookData: PlaybookData;
  userReview: string | null;
  createdAt: string;
}

export async function analyzeDocument(tickerId: number, file: File, content?: string): Promise<Playbook> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("tickerId", String(tickerId));
  if (content) formData.append("content", content);
  const res = await fetch("/api/analyze-document", {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Document analysis failed" }));
    throw new Error(err.message);
  }
  return res.json();
}

export async function fetchPlaybooks(tickerId: number): Promise<Playbook[]> {
  const res = await fetch(`/api/tickers/${tickerId}/playbooks`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch playbooks");
  return res.json();
}

export async function updatePlaybookReview(id: number, review: string): Promise<Playbook> {
  const res = await apiRequest("PATCH", `/api/playbooks/${id}/review`, { review });
  return res.json();
}

const FUTURES_SYMBOLS = ["ES1!", "NQ1!"];
export function isFuturesSymbol(symbol: string): boolean {
  return FUTURES_SYMBOLS.includes(symbol);
}

export interface JournalEntry {
  id: number;
  userId: string | null;
  tickerId: number | null;
  date: string;
  content: string;
  sourceMessageId: number | null;
  createdAt: string;
}

export async function fetchJournalEntries(tickerId: number): Promise<JournalEntry[]> {
  const res = await fetch(`/api/tickers/${tickerId}/journal`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch journal");
  return res.json();
}

export async function createJournalEntry(tickerId: number, content: string, sourceMessageId?: number): Promise<JournalEntry> {
  const res = await apiRequest("POST", `/api/tickers/${tickerId}/journal`, { content, sourceMessageId });
  return res.json();
}

export async function deleteJournalEntry(id: number): Promise<void> {
  await apiRequest("DELETE", `/api/journal/${id}`);
}

export async function sendTacticalChat(tickerId: number, content: string, file?: File): Promise<{ userMessage: ChatMsg; aiMessage: ChatMsg }> {
  const formData = new FormData();
  formData.append("content", content);
  if (file) formData.append("file", file);
  const res = await fetch(`/api/tickers/${tickerId}/tactical-chat`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Tactical chat failed" }));
    throw new Error(err.message);
  }
  return res.json();
}
