import type { Express, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { isAuthenticated } from "./auth";
import { getLiveRatio, isFuturesSymbol, getFuturesMapping } from "./priceService";
import {
  insertNoteSchema,
  insertCalculatedLevelSchema,
  insertDailyChecklistSchema,
  insertChecklistItemSchema,
  insertEventSchema,
  insertChatMessageSchema,
  insertTickerSchema,
} from "@shared/schema";
import { z } from "zod";
import multer from "multer";
import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";

const upload = multer({ dest: "/tmp/uploads/", limits: { fileSize: 10 * 1024 * 1024 } });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY || "");

function getUserId(res: Response): string {
  return res.locals.user!.id;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ─── Tickers ──────────────────────────────────────────────────
  app.get("/api/tickers", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const tickersList = await storage.getTickers(userId);
    res.json(tickersList);
  });

  app.post("/api/tickers", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(res);
      const parsed = insertTickerSchema.parse({ ...req.body, userId });
      const created = await storage.createTicker(parsed);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/tickers/:id", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const id = parseInt(req.params.id as string);
    await storage.deleteTicker(id, userId);
    res.json({ success: true });
  });

  // ─── Notes (scoped by ticker) ────────────────────────────────
  app.get("/api/tickers/:tickerId/notes", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const tickerId = parseInt(req.params.tickerId as string);
    const notesData = await storage.getNotesByTicker(tickerId, userId);
    res.json(notesData);
  });

  app.get("/api/notes", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const notesData = await storage.getNotes(userId);
    res.json(notesData);
  });

  app.get("/api/notes/:id", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const id = parseInt(req.params.id as string);
    const note = await storage.getNote(id, userId);
    if (!note) return res.status(404).json({ message: "Note not found" });
    res.json(note);
  });

  app.post("/api/notes", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(res);
      const { note: noteData, levels, events: eventsData, checklistItems: items } = req.body;

      const parsedNote = insertNoteSchema.parse({ ...noteData, userId });
      const createdNote = await storage.createNote(parsedNote);

      let createdLevels: any[] = [];
      if (levels && levels.length > 0) {
        const parsedLevels = levels.map((l: any) =>
          insertCalculatedLevelSchema.parse({ ...l, noteId: createdNote.id })
        );
        createdLevels = await storage.createLevels(parsedLevels);
      }

      let createdEvents: any[] = [];
      if (eventsData && eventsData.length > 0) {
        const parsedEvents = eventsData.map((e: any) =>
          insertEventSchema.parse({ ...e, noteId: createdNote.id, userId })
        );
        createdEvents = await storage.createEvents(parsedEvents);
      }

      let createdChecklist = null;
      let createdItems: any[] = [];
      if (items && items.length > 0) {
        createdChecklist = await storage.createChecklist({
          userId,
          noteId: createdNote.id,
          date: new Date().toISOString().split("T")[0],
          status: "open",
          closingNote: null,
        });

        const parsedItems = items.map((i: any) =>
          insertChecklistItemSchema.parse({ ...i, checklistId: createdChecklist!.id })
        );
        createdItems = await storage.createChecklistItems(parsedItems);
      }

      res.status(201).json({
        note: createdNote,
        levels: createdLevels,
        events: createdEvents,
        checklist: createdChecklist,
        checklistItems: createdItems,
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/notes/:id", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const id = parseInt(req.params.id as string);
    await storage.deleteNote(id, userId);
    res.json({ success: true });
  });

  // ─── Full Note View (aggregated) ─────────────────────────────
  app.get("/api/notes/:id/full", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const id = parseInt(req.params.id as string);
    const note = await storage.getNote(id, userId);
    if (!note) return res.status(404).json({ message: "Note not found" });

    const levels = await storage.getLevelsByNote(id);
    const eventsData = note.userId ? await storage.getEventsByNote(id) : [];

    let checklist = null;
    let checklistItemsData: any[] = [];
    if (note.userId) {
      const checklists = await storage.getChecklists(note.userId);
      checklist = checklists.find((c) => c.noteId === id) || null;
      if (checklist) {
        checklistItemsData = await storage.getChecklistItems(checklist.id);
      }
    }

    res.json({
      ...note,
      levels,
      events: eventsData,
      checklist,
      checklistItems: checklistItemsData,
    });
  });

  // ─── Levels ───────────────────────────────────────────────────
  app.get("/api/notes/:noteId/levels", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const noteId = parseInt(req.params.noteId as string);
    const note = await storage.getNote(noteId, userId);
    if (!note) return res.status(404).json({ message: "Note not found" });
    const levels = await storage.getLevelsByNote(noteId);
    res.json(levels);
  });

  // ─── Daily Checklists ────────────────────────────────────────
  app.get("/api/checklists", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const checklists = await storage.getChecklists(userId);
    res.json(checklists);
  });

  app.get("/api/checklists/:id/items", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const id = parseInt(req.params.id as string);
    const checklist = await storage.getChecklist(id);
    if (!checklist || checklist.userId !== userId) return res.status(404).json({ message: "Checklist not found" });
    const items = await storage.getChecklistItems(id);
    res.json(items);
  });

  app.patch("/api/checklists/:id", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const id = parseInt(req.params.id as string);
    const { status, closingNote } = req.body;
    const updated = await storage.updateChecklistStatus(id, userId, status, closingNote);
    if (!updated) return res.status(404).json({ message: "Checklist not found" });
    res.json(updated);
  });

  app.patch("/api/checklist-items/:id/toggle", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const id = parseInt(req.params.id as string);
    const { isCompleted } = req.body;
    const updated = await storage.toggleChecklistItem(id, userId, isCompleted);
    if (!updated) return res.status(404).json({ message: "Item not found" });
    res.json(updated);
  });

  // ─── Events ──────────────────────────────────────────────────
  app.get("/api/events", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const eventsData = await storage.getEvents(userId);
    res.json(eventsData);
  });

  // ─── Chat Messages (scoped by ticker) ────────────────────────
  app.get("/api/tickers/:tickerId/chat", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const tickerId = parseInt(req.params.tickerId as string);
    const messages = await storage.getChatMessagesByTicker(tickerId, userId);
    res.json(messages);
  });

  app.get("/api/chat", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const messages = await storage.getChatMessages(userId);
    res.json(messages);
  });

  app.post("/api/tickers/:tickerId/chat", isAuthenticated, upload.single("file"), async (req, res) => {
    const tempFilePath = req.file?.path;
    try {
      const userId = getUserId(res);
      const tickerId = parseInt(req.params.tickerId as string);
      const content = req.body.content || "";

      if (!content.trim() && !req.file) {
        return res.status(400).json({ message: "Please provide a message or file" });
      }

      const ticker = await storage.getTicker(tickerId, userId);
      if (!ticker) return res.status(404).json({ message: "Ticker not found" });

      const userMessage = await storage.createChatMessage({
        userId,
        tickerId,
        role: "user",
        content: content + (req.file ? ` [File: ${req.file.originalname}]` : ""),
      });

      const tickerNotes = await storage.getNotesByTicker(tickerId, userId);
      const latestNote = tickerNotes[0];
      let contextInfo = `Ticker: ${ticker.symbol} (${ticker.displayName})\n`;
      let supportLevels: any[] = [];
      let resistanceLevels: any[] = [];
      let checklistItems: any[] = [];

      if (latestNote) {
        const levels = await storage.getLevelsByNote(latestNote.id);
        supportLevels = levels.filter((l) => l.levelType === "support");
        resistanceLevels = levels.filter((l) => l.levelType === "resistance");
        const allChecklists = await storage.getChecklists(userId);
        const checklist = allChecklists.find((c) => c.noteId === latestNote.id);
        if (checklist) {
          checklistItems = await storage.getChecklistItems(checklist.id);
        }

        contextInfo += `Latest Game Plan: "${latestNote.title}"\n`;
        if (latestNote.summary) contextInfo += `Summary: ${latestNote.summary}\n`;
        if (supportLevels.length > 0) {
          contextInfo += `Key Support Levels: ${supportLevels.map((l) => l.priceLow + (l.priceHigh ? `-${l.priceHigh}` : "") + (l.description ? ` (${l.description})` : "")).join(", ")}\n`;
        }
        if (resistanceLevels.length > 0) {
          contextInfo += `Key Resistance Levels: ${resistanceLevels.map((l) => l.priceLow + (l.priceHigh ? `-${l.priceHigh}` : "") + (l.description ? ` (${l.description})` : "")).join(", ")}\n`;
        }
        if (checklistItems.length > 0) {
          contextInfo += `Checklist: ${checklistItems.map((ci) => `${ci.isCompleted ? "✅" : "⬜"} ${ci.content}`).join("; ")}\n`;
        }
      }

      const chatHistory = await storage.getChatMessagesByTicker(tickerId, userId);
      const recentHistory = chatHistory.slice(-10).map((m) => ({
        role: m.role === "user" ? "user" as const : "model" as const,
        parts: [{ text: m.content }],
      }));

      const systemInstruction = `You are a Trading Mentor AI for the instrument ${ticker.symbol}. You follow a strict "Strategic Reasoning" process when analyzing documents and answering questions.

## CRITICAL RULES

1. **Strict Document Adherence:** When a file (PDF, image, CSV) is uploaded, IGNORE your internal knowledge of current market prices entirely. Use ONLY the price levels, dates, scenarios, and data provided in the uploaded document. Never substitute or "correct" numbers from the document with your own market knowledge. The document is the single source of truth.

2. **Scenario Parsing — Price Conditions:** Look for "Price Conditions" in the document. When the document says something like "ES must hold ABOVE 6924," categorize this as a specific level type:
   - "must hold ABOVE X" → Support / Pivot Point
   - "target X" or "next leg to X" → Resistance / Target
   - "if breaks below X" → Breakdown Level
   Do NOT treat these as random numbers. Classify each one.

3. **If/Then Logic Extraction:** Extract all conditional scenarios from the document. For example: "IF 6966 is snapped, THEN 6988-7012 is the target." These If/Then chains must be preserved exactly as written and reflected in the Execution Checklist. Quote the author's exact conditions.

4. **Temporal Awareness:** Identify any dates, time-based events, or "Flip Dates" mentioned in the document (e.g., "6th flip," "NFP Friday," "AMZN Earnings"). Map these to the calendar and surface them as Event Risk items.

5. **Author Attribution:** When the document contains advice, levels, or scenarios from a specific author or source, QUOTE the author directly. For example, instead of saying "Long above 5920 on 15m reclaim," say "Long above 6866 (Izzy's mandatory sustain level)." This builds trust by showing exactly where the advice came from.

## OUTPUT STRUCTURE

When analyzing an uploaded document, structure your response as:

**Primary Bias:** (Bullish / Bearish / Neutral — based on the "Open Bias" or directional language in the document)

**Critical Levels:** (List the most frequently mentioned price levels from the document, with their classification)
- **[Price]** — [Type: Support/Resistance/Pivot/Target] — "[Exact quote from document]"

**If/Then Scenarios:**
- IF [condition from document] → THEN [outcome from document]

**Risk Variables:** (What cancels the trade or invalidates the setup, as stated in the document)
- [Exact risk condition from document, e.g., "Failing to sustain 6866"]

**Event Risk:** (Any dates, earnings, economic events mentioned)
- [Event] — [Date/Time if specified]

**Execution Checklist:** (Actionable items derived from the document's If/Then logic)
- [ ] [Action item with exact levels from document]

## CURRENT TRADER CONTEXT (from database)
${contextInfo}

## GUIDELINES FOR GENERAL CHAT (no file attached)
- Reference the trader's stored levels and game plan from the context above
- Be concise but thorough
- Suggest actionable insights (entries, exits, risk management)
- Use markdown formatting for clarity (bold for key levels, bullet points for analysis)
- When discussing price levels, use ONLY levels from the trader's stored notes, not your internal knowledge`;

      const model = genAI.getGenerativeModel({
        model: "gemini-1.5-pro",
        systemInstruction,
        generationConfig: {
          temperature: 0.1,
        },
      });

      const parts: any[] = [];

      if (req.file) {
        try {
          const mimeType = req.file.mimetype || "application/octet-stream";
          const uploadResult = await fileManager.uploadFile(req.file.path, {
            mimeType,
            displayName: req.file.originalname,
          });

          let file = uploadResult.file;
          let attempts = 0;
          while (file.state === FileState.PROCESSING && attempts < 30) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            const result = await fileManager.getFile(file.name);
            file = result;
            attempts++;
          }

          if (file.state === FileState.ACTIVE) {
            parts.push({ fileData: { mimeType: file.mimeType, fileUri: file.uri } });
          }
        } catch (fileErr) {
          console.error("Gemini file upload error:", fileErr);
        } finally {
          try { if (tempFilePath) fs.unlinkSync(tempFilePath); } catch {}
          tempFilePath && (req.file = undefined as any);
        }
      }

      parts.push({ text: content || "Analyze the attached file." });

      let aiContent: string;
      try {
        const result = await model.generateContent({
          contents: [...recentHistory, { role: "user", parts }],
        });
        aiContent = result.response.text();
      } catch (aiErr: any) {
        console.error("Gemini API error:", aiErr);
        aiContent = buildFallbackResponse(ticker.symbol, content, latestNote, supportLevels, resistanceLevels, checklistItems);
      }

      const aiMessage = await storage.createChatMessage({
        userId,
        tickerId,
        role: "assistant",
        content: aiContent,
      });

      res.status(201).json({ userMessage, aiMessage });
    } catch (err: any) {
      console.error("Chat error:", err);
      res.status(400).json({ message: err.message });
    } finally {
      if (tempFilePath) {
        try { fs.unlinkSync(tempFilePath); } catch {}
      }
    }
  });

  function buildFallbackResponse(symbol: string, query: string, latestNote: any, support: any[], resistance: any[], checklist: any[]): string {
    let response = `Here's your current **${symbol}** context from your notes:\n\n`;

    if (latestNote) {
      response += `**Active Game Plan:** ${latestNote.title}\n`;
      if (latestNote.summary) response += `> ${latestNote.summary}\n\n`;

      if (support.length > 0) {
        response += `**Support Levels:**\n${support.map((l) => `- **${l.priceLow}${l.priceHigh ? `-${l.priceHigh}` : ""}** ${l.description ? `— ${l.description}` : ""}`).join("\n")}\n\n`;
      }
      if (resistance.length > 0) {
        response += `**Resistance Levels:**\n${resistance.map((l) => `- **${l.priceLow}${l.priceHigh ? `-${l.priceHigh}` : ""}** ${l.description ? `— ${l.description}` : ""}`).join("\n")}\n\n`;
      }
      if (checklist.length > 0) {
        response += `**Checklist:**\n${checklist.map((ci) => `- ${ci.isCompleted ? "✅" : "⬜"} ${ci.content}`).join("\n")}\n\n`;
      }

      response += `\n*AI analysis is temporarily unavailable. The levels and plan above are from your stored notes. Please try again shortly for AI-powered insights.*`;
    } else {
      response += `No game plan found for ${symbol}. Upload a trading note to get started!\n\n*AI analysis is temporarily unavailable. Please try again shortly.*`;
    }

    return response;
  }

  // ─── Price Ratio (Dynamic Futures/ETF mapping) ─────────────────
  app.get("/api/price-ratio/:symbol", isAuthenticated, async (req, res) => {
    const symbol = req.params.symbol as string;
    const ratioData = await getLiveRatio(symbol);
    res.json(ratioData);
  });

  // ─── Seed Default Data for New Users ───────────────────────────
  app.post("/api/seed", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(res);

      const existingTickers = await storage.getTickers(userId);
      if (existingTickers.length > 0) {
        return res.json({ message: "Data already seeded", userId });
      }

      const btc = await storage.createTicker({ userId, symbol: "BTCUSD", displayName: "Bitcoin", exchange: "COINBASE", color: "#f7931a" });
      const es = await storage.createTicker({ userId, symbol: "ES1!", displayName: "S&P 500 Futures", exchange: "CME_MINI", color: "#22c55e" });
      const nq = await storage.createTicker({ userId, symbol: "NQ1!", displayName: "Nasdaq Futures", exchange: "CME_MINI", color: "#6366f1" });

      const btcNote1 = await storage.createNote({
        userId, tickerId: btc.id,
        title: "BTC Mid-Week Update: Bullish Continuation?",
        rawContent: "Looking for bullish continuation if we hold the 68660 pivot. Target is 69200-69260. Be careful of NFP at 8:30. Invalidation below 68200.",
        summary: "BTC holding above 68660 pivot. Targeting 69200 if NFP data comes in soft.",
        tags: ["bullish", "NFP", "levels"],
      });

      await storage.createLevels([
        { noteId: btcNote1.id, ticker: "BTCUSD", priceLow: "68660", levelType: "support", description: "Key Pivot - Hold above for bullish bias" },
        { noteId: btcNote1.id, ticker: "BTCUSD", priceLow: "69200", priceHigh: "69260", levelType: "resistance", description: "Major Resistance / Profit Take Zone" },
        { noteId: btcNote1.id, ticker: "BTCUSD", priceLow: "68200", levelType: "support", description: "Invalidation level" },
      ]);

      await storage.createEvents([
        { userId, noteId: btcNote1.id, title: "Non-Farm Payrolls", eventTime: "08:30 AM", impactLevel: "high" },
      ]);

      const btcChecklist1 = await storage.createChecklist({
        userId, noteId: btcNote1.id,
        date: new Date().toISOString().split("T")[0], status: "open", closingNote: null,
      });

      await storage.createChecklistItems([
        { checklistId: btcChecklist1.id, content: "Hold above 68660 on 1H close", isCompleted: true },
        { checklistId: btcChecklist1.id, content: "Watch for volume spike at 69000", isCompleted: false },
        { checklistId: btcChecklist1.id, content: "Reduce risk ahead of NFP release", isCompleted: true },
        { checklistId: btcChecklist1.id, content: "No longs below 68400", isCompleted: false },
      ]);

      const btcNote2 = await storage.createNote({
        userId, tickerId: btc.id,
        title: "BTC Tuesday Reversal Setup",
        rawContent: "Rejected from 69500 supply. Looking for a retest of 68800 support.",
        summary: "BTC rejected from 69500 supply. Retest of 68800 support expected.",
        tags: ["reversal", "short"],
      });

      await storage.createLevels([
        { noteId: btcNote2.id, ticker: "BTCUSD", priceLow: "69500", levelType: "resistance", description: "Supply Zone" },
        { noteId: btcNote2.id, ticker: "BTCUSD", priceLow: "68800", levelType: "support", description: "First bounce target" },
      ]);

      const btcChecklist2 = await storage.createChecklist({
        userId, noteId: btcNote2.id,
        date: new Date(Date.now() - 86400000).toISOString().split("T")[0], status: "closed", closingNote: "Caught the move. Took profit at 68900.",
      });

      await storage.createChecklistItems([
        { checklistId: btcChecklist2.id, content: "Short below 69400", isCompleted: true },
        { checklistId: btcChecklist2.id, content: "Take profit at 68900", isCompleted: true },
      ]);

      const esNote1 = await storage.createNote({
        userId, tickerId: es.id,
        title: "ES Weekly Open: Holding Above VAH",
        rawContent: "ES holding above value area high at 5920. Target 5960 resistance. FOMC minutes at 2PM.",
        summary: "ES bullish above 5920 VAH. Targeting 5960 with FOMC risk.",
        tags: ["bullish", "FOMC", "value area"],
      });

      await storage.createLevels([
        { noteId: esNote1.id, ticker: "ES1!", priceLow: "5920", levelType: "support", description: "Value Area High - Bullish above" },
        { noteId: esNote1.id, ticker: "ES1!", priceLow: "5960", levelType: "resistance", description: "Weekly resistance target" },
        { noteId: esNote1.id, ticker: "ES1!", priceLow: "5880", levelType: "support", description: "POC / Invalidation" },
      ]);

      await storage.createEvents([
        { userId, noteId: esNote1.id, title: "FOMC Minutes", eventTime: "02:00 PM", impactLevel: "high" },
      ]);

      const esChecklist1 = await storage.createChecklist({
        userId, noteId: esNote1.id,
        date: new Date().toISOString().split("T")[0], status: "open", closingNote: null,
      });

      await storage.createChecklistItems([
        { checklistId: esChecklist1.id, content: "Long above 5920 on 15m reclaim", isCompleted: false },
        { checklistId: esChecklist1.id, content: "Scale out at 5950-5960", isCompleted: false },
        { checklistId: esChecklist1.id, content: "Flat before FOMC at 2PM", isCompleted: false },
      ]);

      const nqNote1 = await storage.createNote({
        userId, tickerId: nq.id,
        title: "NQ Earnings Season Play",
        rawContent: "AAPL and MSFT earnings this week. NQ range bound 20800-21200. Breakout play above 21200.",
        summary: "NQ range bound 20800-21200. Watching for earnings-driven breakout.",
        tags: ["earnings", "range", "breakout"],
      });

      await storage.createLevels([
        { noteId: nqNote1.id, ticker: "NQ1!", priceLow: "20800", levelType: "support", description: "Range Low / Earnings support" },
        { noteId: nqNote1.id, ticker: "NQ1!", priceLow: "21200", levelType: "resistance", description: "Range High / Breakout level" },
        { noteId: nqNote1.id, ticker: "NQ1!", priceLow: "21500", levelType: "resistance", description: "Measured move target if breakout" },
      ]);

      await storage.createEvents([
        { userId, noteId: nqNote1.id, title: "AAPL Earnings", eventTime: "04:30 PM", impactLevel: "high" },
        { userId, noteId: nqNote1.id, title: "MSFT Earnings", eventTime: "04:30 PM", impactLevel: "high" },
      ]);

      const nqChecklist1 = await storage.createChecklist({
        userId, noteId: nqNote1.id,
        date: new Date().toISOString().split("T")[0], status: "open", closingNote: null,
      });

      await storage.createChecklistItems([
        { checklistId: nqChecklist1.id, content: "Wait for range breakout above 21200", isCompleted: false },
        { checklistId: nqChecklist1.id, content: "Scalp range edges only pre-earnings", isCompleted: false },
        { checklistId: nqChecklist1.id, content: "No overnight positions through earnings", isCompleted: false },
      ]);

      await storage.createChatMessage({ userId, tickerId: btc.id, role: "assistant", content: "Welcome to the **BTCUSD** workspace. I'm your trading mentor for Bitcoin. Ask me about your levels, game plan, or past entries." });
      await storage.createChatMessage({ userId, tickerId: es.id, role: "assistant", content: "Welcome to the **ES1!** workspace. I'm your trading mentor for S&P 500 Futures. Ask me about your levels, game plan, or past entries." });
      await storage.createChatMessage({ userId, tickerId: nq.id, role: "assistant", content: "Welcome to the **NQ1!** workspace. I'm your trading mentor for Nasdaq Futures. Ask me about your levels, game plan, or past entries." });

      res.json({ message: "Data seeded successfully", userId });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
