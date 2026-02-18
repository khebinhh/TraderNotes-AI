import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, date, boolean, decimal, jsonb, serial, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";
import { users } from "./models/auth";

export const tickers = pgTable("tickers", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  displayName: text("display_name").notNull(),
  exchange: text("exchange").default("COINBASE"),
  color: text("color").default("#f59e0b"),
});

export const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  tickerId: integer("ticker_id").references(() => tickers.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  rawContent: text("raw_content"),
  summary: text("summary"),
  createdAt: timestamp("created_at").defaultNow(),
  tags: text("tags").array(),
});

export const calculatedLevels = pgTable("calculated_levels", {
  id: serial("id").primaryKey(),
  noteId: integer("note_id").references(() => notes.id, { onDelete: "cascade" }),
  ticker: text("ticker").notNull().default("BTCUSD"),
  priceLow: text("price_low").notNull(),
  priceHigh: text("price_high"),
  levelType: text("level_type").notNull(),
  description: text("description"),
});

export const dailyChecklists = pgTable("daily_checklists", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  noteId: integer("note_id").references(() => notes.id, { onDelete: "cascade" }),
  date: date("date").notNull().defaultNow(),
  status: text("status").notNull().default("open"),
  closingNote: text("closing_note"),
});

export const checklistItems = pgTable("checklist_items", {
  id: serial("id").primaryKey(),
  checklistId: integer("checklist_id").references(() => dailyChecklists.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  isCompleted: boolean("is_completed").notNull().default(false),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  noteId: integer("note_id").references(() => notes.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  eventTime: text("event_time").notNull(),
  impactLevel: text("impact_level").notNull().default("high"),
});

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  tickerId: integer("ticker_id").references(() => tickers.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const playbooks = pgTable("playbooks", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  tickerId: integer("ticker_id").references(() => tickers.id, { onDelete: "cascade" }),
  date: date("date").notNull().defaultNow(),
  playbookData: jsonb("playbook_data").notNull(),
  userReview: text("user_review"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const journalEntries = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  tickerId: integer("ticker_id").references(() => tickers.id, { onDelete: "cascade" }),
  date: date("date").notNull().defaultNow(),
  content: text("content").notNull(),
  sourceMessageId: integer("source_message_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTickerSchema = createInsertSchema(tickers).omit({ id: true });
export const insertNoteSchema = createInsertSchema(notes).omit({ id: true, createdAt: true });
export const insertCalculatedLevelSchema = createInsertSchema(calculatedLevels).omit({ id: true });
export const insertDailyChecklistSchema = createInsertSchema(dailyChecklists).omit({ id: true });
export const insertChecklistItemSchema = createInsertSchema(checklistItems).omit({ id: true });
export const insertEventSchema = createInsertSchema(events).omit({ id: true });
export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true });
export const insertPlaybookSchema = createInsertSchema(playbooks).omit({ id: true, createdAt: true });
export const insertJournalEntrySchema = createInsertSchema(journalEntries).omit({ id: true, createdAt: true });

export type Ticker = typeof tickers.$inferSelect;
export type InsertTicker = z.infer<typeof insertTickerSchema>;
export type Note = typeof notes.$inferSelect;
export type InsertNote = z.infer<typeof insertNoteSchema>;
export type CalculatedLevel = typeof calculatedLevels.$inferSelect;
export type InsertCalculatedLevel = z.infer<typeof insertCalculatedLevelSchema>;
export type DailyChecklist = typeof dailyChecklists.$inferSelect;
export type InsertDailyChecklist = z.infer<typeof insertDailyChecklistSchema>;
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type InsertChecklistItem = z.infer<typeof insertChecklistItemSchema>;
export type Event = typeof events.$inferSelect;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type Playbook = typeof playbooks.$inferSelect;
export type InsertPlaybook = z.infer<typeof insertPlaybookSchema>;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type InsertJournalEntry = z.infer<typeof insertJournalEntrySchema>;
