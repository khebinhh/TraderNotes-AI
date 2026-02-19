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

export interface PostMarketRecap {
  sessionOutcome: string;
  closingPrice: number | null;
  morningBias: string | null;
  levelsDefended: Array<{ price: number; label: string; status: string }>;
  levelsLost: Array<{ price: number; label: string; status: string }>;
  scenariosTriggered: Array<{ scenario: string; result: string; grade: string }>;
  prepForTomorrow: string | null;
  lessonOfTheDay: string | null;
}

export interface TacticalBriefing {
  sentiment: {
    bias: "BULLISH" | "BEARISH" | "NEUTRAL" | "BULLISH LEAN" | "BEARISH LEAN";
    summary: string;
  };
  levels: {
    overhead: Array<{ price: number; priceHigh?: number | null; label: string; source?: string }>;
    pivots: Array<{ price: number; priceHigh?: number | null; label: string; source?: string }>;
    basins: Array<{ price: number; priceHigh?: number | null; label: string; source?: string }>;
  };
  ifThen: Array<{ condition: string; outcome: string; zone?: string }>;
  sources: Array<{ filename: string; description: string }>;
  bluf: string;
  postMarketRecap?: PostMarketRecap;
}

export interface ChatMsg {
  id: number;
  userId: string | null;
  tickerId: number | null;
  role: string;
  content: string;
  structuredData?: TacticalBriefing | null;
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

export async function deleteTicker(id: number): Promise<void> {
  await apiRequest("DELETE", `/api/tickers/${id}`);
}

export interface WorkspaceData {
  activeTickers: number[];
  lastActiveTicker: number | null;
}

export async function fetchWorkspace(): Promise<WorkspaceData> {
  const res = await fetch("/api/workspace", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch workspace");
  return res.json();
}

export async function saveWorkspace(data: WorkspaceData): Promise<WorkspaceData> {
  const res = await apiRequest("PUT", "/api/workspace", data);
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

export async function sendChatMessage(tickerId: number, content: string, files?: File[]): Promise<{ userMessage: ChatMsg; aiMessage: ChatMsg; createdNoteId?: number | null }> {
  const formData = new FormData();
  formData.append("content", content);
  if (files && files.length > 0) {
    files.forEach(f => formData.append("files", f));
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

export interface PlaybookEnhancedLevel {
  price: number;
  price_high?: number | null;
  type: string;
  zone: "green" | "yellow" | "red";
  label: string;
  provenance: string;
  context: string;
  source: string;
  conviction: string;
}

export interface PlaybookScenario {
  id: string;
  condition: string;
  outcome: string;
  zone: "green" | "yellow" | "red";
  source: string;
}

export interface PlaybookEnhancedScenario {
  id: string;
  if: string;
  then: string;
  zone: "green" | "yellow" | "red";
  rating: string;
  source: string;
  cross_market_filter: string | null;
}

export interface PlaybookEvent {
  title: string;
  time: string;
  impact: "high" | "medium" | "low";
  expected_behavior: string;
}

export interface PlaybookMacroClock {
  event: string;
  time: string;
  risk: "High" | "Medium" | "Low";
}

export interface PlaybookMetadata {
  author: string;
  report_title: string;
  target_horizon: string;
  horizon_type: "Daily" | "Weekly" | "Monthly";
}

export interface TacticalUpdate {
  timestamp: string;
  source: string;
  author: string;
  addedLevels: PlaybookEnhancedLevel[];
  addedScenarios: PlaybookEnhancedScenario[];
  note: string;
}

export interface PlaybookData {
  macro_theme: string;
  bias: "Bullish" | "Bearish" | "Neutral" | "Open";
  thesis: string | { bias: string; summary: string };
  structural_zones: {
    bullish_green: PlaybookZoneLevel[];
    neutral_yellow: PlaybookZoneLevel[];
    bearish_red: PlaybookZoneLevel[];
  };
  if_then_scenarios: PlaybookScenario[];
  key_events: PlaybookEvent[];
  risk_factors: string[];
  execution_checklist: string[];
  metadata?: PlaybookMetadata;
  macro_clock?: PlaybookMacroClock[];
  levels?: PlaybookEnhancedLevel[];
  scenarios?: PlaybookEnhancedScenario[];
  tactical_updates?: TacticalUpdate[];
}

export interface Playbook {
  id: number;
  userId: string | null;
  tickerId: number | null;
  date: string;
  author: string | null;
  horizonType: string | null;
  targetDateStart: string | null;
  targetDateEnd: string | null;
  playbookData: PlaybookData;
  userReview: string | null;
  createdAt: string;
}

export async function analyzeDocument(tickerId: number, files: File[], content?: string): Promise<Playbook> {
  const formData = new FormData();
  files.forEach(f => formData.append("files", f));
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

export async function deletePlaybook(id: number): Promise<void> {
  const res = await apiRequest("DELETE", `/api/playbooks/${id}`);
  if (!res.ok) throw new Error("Failed to delete playbook");
}

export async function pinMessageToPlaybook(playbookId: number, messageId: number): Promise<Playbook> {
  const res = await apiRequest("POST", `/api/playbooks/${playbookId}/pin-message`, { messageId });
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

export async function sendTacticalChat(tickerId: number, content: string, files?: File[]): Promise<{ userMessage: ChatMsg; aiMessage: ChatMsg }> {
  const formData = new FormData();
  formData.append("content", content);
  if (files && files.length > 0) {
    files.forEach(f => formData.append("files", f));
  }
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
