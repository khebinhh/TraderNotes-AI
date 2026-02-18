import { eq, desc, and } from "drizzle-orm";
import { db } from "./db";
import {
  tickers, notes, calculatedLevels, dailyChecklists, checklistItems, events, chatMessages, playbooks, journalEntries, userWorkspaces,
  type Ticker, type InsertTicker,
  type Note, type InsertNote,
  type CalculatedLevel, type InsertCalculatedLevel,
  type DailyChecklist, type InsertDailyChecklist,
  type ChecklistItem, type InsertChecklistItem,
  type Event, type InsertEvent,
  type ChatMessage, type InsertChatMessage,
  type Playbook, type InsertPlaybook,
  type JournalEntry, type InsertJournalEntry,
  type UserWorkspace,
} from "@shared/schema";

export interface IStorage {
  getTickers(userId: string): Promise<Ticker[]>;
  getTicker(id: number, userId: string): Promise<Ticker | undefined>;
  createTicker(ticker: InsertTicker): Promise<Ticker>;
  deleteTicker(id: number, userId: string): Promise<void>;

  getNotes(userId: string): Promise<Note[]>;
  getNotesByTicker(tickerId: number, userId: string): Promise<Note[]>;
  getNote(id: number, userId: string): Promise<Note | undefined>;
  createNote(note: InsertNote): Promise<Note>;
  deleteNote(id: number, userId: string): Promise<void>;

  getLevelsByNote(noteId: number): Promise<CalculatedLevel[]>;
  createLevel(level: InsertCalculatedLevel): Promise<CalculatedLevel>;
  createLevels(levels: InsertCalculatedLevel[]): Promise<CalculatedLevel[]>;

  getChecklists(userId: string): Promise<DailyChecklist[]>;
  getChecklist(id: number): Promise<DailyChecklist | undefined>;
  getChecklistByDate(userId: string, date: string): Promise<DailyChecklist | undefined>;
  createChecklist(checklist: InsertDailyChecklist): Promise<DailyChecklist>;
  updateChecklistStatus(id: number, userId: string, status: string, closingNote?: string): Promise<DailyChecklist | undefined>;

  getChecklistItems(checklistId: number): Promise<ChecklistItem[]>;
  createChecklistItem(item: InsertChecklistItem): Promise<ChecklistItem>;
  createChecklistItems(items: InsertChecklistItem[]): Promise<ChecklistItem[]>;
  toggleChecklistItem(id: number, userId: string, isCompleted: boolean): Promise<ChecklistItem | undefined>;

  getEvents(userId: string): Promise<Event[]>;
  getEventsByNote(noteId: number): Promise<Event[]>;
  createEvent(event: InsertEvent): Promise<Event>;
  createEvents(events: InsertEvent[]): Promise<Event[]>;

  getChatMessages(userId: string): Promise<ChatMessage[]>;
  getChatMessagesByTicker(tickerId: number, userId: string): Promise<ChatMessage[]>;
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;

  getPlaybooks(userId: string): Promise<Playbook[]>;
  getPlaybooksByTicker(tickerId: number, userId: string): Promise<Playbook[]>;
  getPlaybook(id: number, userId: string): Promise<Playbook | undefined>;
  createPlaybook(playbook: InsertPlaybook): Promise<Playbook>;
  updatePlaybookReview(id: number, userId: string, review: string): Promise<Playbook | undefined>;

  getJournalEntries(tickerId: number, userId: string): Promise<JournalEntry[]>;
  createJournalEntry(entry: InsertJournalEntry): Promise<JournalEntry>;
  deleteJournalEntry(id: number, userId: string): Promise<void>;

  getWorkspace(userId: string): Promise<UserWorkspace | undefined>;
  saveWorkspace(userId: string, activeTickers: number[], lastActiveTicker: number | null): Promise<UserWorkspace>;
}

export class DatabaseStorage implements IStorage {
  async getTickers(userId: string): Promise<Ticker[]> {
    return db.select().from(tickers).where(eq(tickers.userId, userId));
  }

  async getTicker(id: number, userId: string): Promise<Ticker | undefined> {
    const [ticker] = await db.select().from(tickers).where(and(eq(tickers.id, id), eq(tickers.userId, userId)));
    return ticker;
  }

  async createTicker(ticker: InsertTicker): Promise<Ticker> {
    const [created] = await db.insert(tickers).values(ticker).returning();
    return created;
  }

  async deleteTicker(id: number, userId: string): Promise<void> {
    await db.delete(tickers).where(and(eq(tickers.id, id), eq(tickers.userId, userId)));
  }

  async getNotes(userId: string): Promise<Note[]> {
    return db.select().from(notes).where(eq(notes.userId, userId)).orderBy(desc(notes.createdAt));
  }

  async getNotesByTicker(tickerId: number, userId: string): Promise<Note[]> {
    return db.select().from(notes).where(and(eq(notes.tickerId, tickerId), eq(notes.userId, userId))).orderBy(desc(notes.createdAt));
  }

  async getNote(id: number, userId: string): Promise<Note | undefined> {
    const [note] = await db.select().from(notes).where(and(eq(notes.id, id), eq(notes.userId, userId)));
    return note;
  }

  async createNote(note: InsertNote): Promise<Note> {
    const [created] = await db.insert(notes).values(note).returning();
    return created;
  }

  async deleteNote(id: number, userId: string): Promise<void> {
    await db.delete(notes).where(and(eq(notes.id, id), eq(notes.userId, userId)));
  }

  async getLevelsByNote(noteId: number): Promise<CalculatedLevel[]> {
    return db.select().from(calculatedLevels).where(eq(calculatedLevels.noteId, noteId));
  }

  async createLevel(level: InsertCalculatedLevel): Promise<CalculatedLevel> {
    const [created] = await db.insert(calculatedLevels).values(level).returning();
    return created;
  }

  async createLevels(levelsData: InsertCalculatedLevel[]): Promise<CalculatedLevel[]> {
    if (levelsData.length === 0) return [];
    return db.insert(calculatedLevels).values(levelsData).returning();
  }

  async getChecklists(userId: string): Promise<DailyChecklist[]> {
    return db.select().from(dailyChecklists).where(eq(dailyChecklists.userId, userId)).orderBy(desc(dailyChecklists.date));
  }

  async getChecklist(id: number): Promise<DailyChecklist | undefined> {
    const [cl] = await db.select().from(dailyChecklists).where(eq(dailyChecklists.id, id));
    return cl;
  }

  async getChecklistByDate(userId: string, date: string): Promise<DailyChecklist | undefined> {
    const [cl] = await db.select().from(dailyChecklists).where(and(eq(dailyChecklists.userId, userId), eq(dailyChecklists.date, date)));
    return cl;
  }

  async createChecklist(checklist: InsertDailyChecklist): Promise<DailyChecklist> {
    const [created] = await db.insert(dailyChecklists).values(checklist).returning();
    return created;
  }

  async updateChecklistStatus(id: number, userId: string, status: string, closingNote?: string): Promise<DailyChecklist | undefined> {
    const [updated] = await db.update(dailyChecklists)
      .set({ status, closingNote: closingNote || null })
      .where(and(eq(dailyChecklists.id, id), eq(dailyChecklists.userId, userId)))
      .returning();
    return updated;
  }

  async getChecklistItems(checklistId: number): Promise<ChecklistItem[]> {
    return db.select().from(checklistItems).where(eq(checklistItems.checklistId, checklistId));
  }

  async createChecklistItem(item: InsertChecklistItem): Promise<ChecklistItem> {
    const [created] = await db.insert(checklistItems).values(item).returning();
    return created;
  }

  async createChecklistItems(items: InsertChecklistItem[]): Promise<ChecklistItem[]> {
    if (items.length === 0) return [];
    return db.insert(checklistItems).values(items).returning();
  }

  async toggleChecklistItem(id: number, userId: string, isCompleted: boolean): Promise<ChecklistItem | undefined> {
    const [item] = await db
      .select({ ci: checklistItems, cl: dailyChecklists })
      .from(checklistItems)
      .innerJoin(dailyChecklists, eq(checklistItems.checklistId, dailyChecklists.id))
      .where(and(eq(checklistItems.id, id), eq(dailyChecklists.userId, userId)));

    if (!item) return undefined;

    const [updated] = await db.update(checklistItems)
      .set({ isCompleted })
      .where(eq(checklistItems.id, id))
      .returning();
    return updated;
  }

  async getEvents(userId: string): Promise<Event[]> {
    return db.select().from(events).where(eq(events.userId, userId));
  }

  async getEventsByNote(noteId: number): Promise<Event[]> {
    return db.select().from(events).where(eq(events.noteId, noteId));
  }

  async createEvent(event: InsertEvent): Promise<Event> {
    const [created] = await db.insert(events).values(event).returning();
    return created;
  }

  async createEvents(eventsData: InsertEvent[]): Promise<Event[]> {
    if (eventsData.length === 0) return [];
    return db.insert(events).values(eventsData).returning();
  }

  async getChatMessages(userId: string): Promise<ChatMessage[]> {
    return db.select().from(chatMessages).where(eq(chatMessages.userId, userId)).orderBy(chatMessages.createdAt);
  }

  async getChatMessagesByTicker(tickerId: number, userId: string): Promise<ChatMessage[]> {
    return db.select().from(chatMessages).where(and(eq(chatMessages.tickerId, tickerId), eq(chatMessages.userId, userId))).orderBy(chatMessages.createdAt);
  }

  async createChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const [created] = await db.insert(chatMessages).values(message).returning();
    return created;
  }

  async getPlaybooks(userId: string): Promise<Playbook[]> {
    return db.select().from(playbooks).where(eq(playbooks.userId, userId)).orderBy(desc(playbooks.createdAt));
  }

  async getPlaybooksByTicker(tickerId: number, userId: string): Promise<Playbook[]> {
    return db.select().from(playbooks).where(and(eq(playbooks.tickerId, tickerId), eq(playbooks.userId, userId))).orderBy(desc(playbooks.createdAt));
  }

  async getPlaybook(id: number, userId: string): Promise<Playbook | undefined> {
    const [pb] = await db.select().from(playbooks).where(and(eq(playbooks.id, id), eq(playbooks.userId, userId)));
    return pb;
  }

  async createPlaybook(playbook: InsertPlaybook): Promise<Playbook> {
    const [created] = await db.insert(playbooks).values(playbook).returning();
    return created;
  }

  async updatePlaybookReview(id: number, userId: string, review: string): Promise<Playbook | undefined> {
    const [updated] = await db.update(playbooks)
      .set({ userReview: review })
      .where(and(eq(playbooks.id, id), eq(playbooks.userId, userId)))
      .returning();
    return updated;
  }

  async getJournalEntries(tickerId: number, userId: string): Promise<JournalEntry[]> {
    return db.select().from(journalEntries)
      .where(and(eq(journalEntries.tickerId, tickerId), eq(journalEntries.userId, userId)))
      .orderBy(desc(journalEntries.createdAt));
  }

  async createJournalEntry(entry: InsertJournalEntry): Promise<JournalEntry> {
    const [created] = await db.insert(journalEntries).values(entry).returning();
    return created;
  }

  async deleteJournalEntry(id: number, userId: string): Promise<void> {
    await db.delete(journalEntries).where(and(eq(journalEntries.id, id), eq(journalEntries.userId, userId)));
  }

  async getWorkspace(userId: string): Promise<UserWorkspace | undefined> {
    const [ws] = await db.select().from(userWorkspaces).where(eq(userWorkspaces.userId, userId));
    return ws;
  }

  async saveWorkspace(userId: string, activeTickers: number[], lastActiveTicker: number | null): Promise<UserWorkspace> {
    const existing = await this.getWorkspace(userId);
    if (existing) {
      const [updated] = await db.update(userWorkspaces)
        .set({ activeTickers, lastActiveTicker })
        .where(eq(userWorkspaces.userId, userId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(userWorkspaces).values({
      userId,
      activeTickers,
      lastActiveTicker,
    }).returning();
    return created;
  }
}

export const storage = new DatabaseStorage();
