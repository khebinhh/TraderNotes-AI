import type { Express, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { uploadedImages, tradingDiary } from "@shared/schema";
import { eq, and, or } from "drizzle-orm";
import { isAuthenticated } from "./auth";
import { getLiveRatio, isFuturesSymbol, getFuturesMapping } from "./priceService";
import { getMarketDate } from "./market-date";
import {
  insertNoteSchema,
  insertCalculatedLevelSchema,
  insertDailyChecklistSchema,
  insertChecklistItemSchema,
  insertEventSchema,
  insertChatMessageSchema,
  insertTickerSchema,
  insertJournalEntrySchema,
  insertTradingDiarySchema,
} from "@shared/schema";
import { z } from "zod";
import multer from "multer";
import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
function parseTargetDate(horizon: string): string | null {
  if (!horizon) return null;
  const now = new Date();
  const currentYear = now.getFullYear();
  const monthMap: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const rangeMatch = horizon.match(/(\w+)\s+(\d{1,2})\s*[-–]\s*(\d{1,2})/i);
  if (rangeMatch) {
    const month = monthMap[rangeMatch[1].toLowerCase().slice(0, 3)];
    if (month !== undefined) {
      const d = new Date(currentYear, month, parseInt(rangeMatch[2]));
      return d.toISOString().split("T")[0];
    }
  }
  const singleMatch = horizon.match(/(\w+)\s+(\d{1,2})/i);
  if (singleMatch) {
    const month = monthMap[singleMatch[1].toLowerCase().slice(0, 3)];
    if (month !== undefined) {
      const d = new Date(currentYear, month, parseInt(singleMatch[2]));
      return d.toISOString().split("T")[0];
    }
  }
  return null;
}

function getEndOfWeek(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const daysToFriday = day <= 5 ? 5 - day : 0;
  d.setDate(d.getDate() + daysToFriday);
  return d.toISOString().split("T")[0];
}

async function extractTextFromFile(filePath: string, mimeType: string): Promise<string> {
  if (mimeType === "application/pdf") {
    const pdfParseModule = await import("pdf-parse");
    const pdfParseFn = (pdfParseModule as any).default || pdfParseModule;
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParseFn(dataBuffer);
    return pdfData.text.slice(0, 50000);
  }
  if (mimeType === "text/csv" || mimeType === "text/plain") {
    return fs.readFileSync(filePath, "utf-8").slice(0, 50000);
  }
  return "";
}

const multerStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = "/tmp/uploads/";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".bin";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage: multerStorage, limits: { fileSize: 10 * 1024 * 1024 } });

function inferMimeType(originalName: string, browserMime: string): string {
  if (browserMime && browserMime !== "application/octet-stream") return browserMime;
  const ext = path.extname(originalName).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".webp": "image/webp",
  };
  return mimeMap[ext] || browserMime || "application/octet-stream";
}

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

      await storage.createChatMessage({
        userId,
        tickerId: created.id,
        role: "assistant",
        content: `Welcome to the **${created.symbol}** workspace. I don't see a playbook for this ticker yet. Upload a report or ask me a question to get started.`,
      });

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

  app.get("/api/workspace", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const workspace = await storage.getWorkspace(userId);
    res.json(workspace || { activeTickers: [], lastActiveTicker: null });
  });

  app.put("/api/workspace", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(res);
      const { activeTickers, lastActiveTicker } = req.body;
      const workspace = await storage.saveWorkspace(userId, activeTickers || [], lastActiveTicker ?? null);
      res.json(workspace);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
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

  app.post("/api/tickers/:tickerId/chat", isAuthenticated, upload.array("files", 10), async (req, res) => {
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];
    const tempFilePaths = uploadedFiles.map(f => f.path);
    try {
      const userId = getUserId(res);
      const tickerId = parseInt(req.params.tickerId as string);
      const content = req.body.content || "";

      if (!content.trim() && uploadedFiles.length === 0) {
        return res.status(400).json({ message: "Please provide a message or file" });
      }

      const ticker = await storage.getTicker(tickerId, userId);
      if (!ticker) return res.status(404).json({ message: "Ticker not found" });

      const fileNames = uploadedFiles.map(f => f.originalname).join(", ");
      const userMessage = await storage.createChatMessage({
        userId,
        tickerId,
        role: "user",
        content: content + (uploadedFiles.length > 0 ? ` [${uploadedFiles.length} file${uploadedFiles.length > 1 ? "s" : ""}: ${fileNames}]` : ""),
      });

      for (const uf of uploadedFiles) {
        const mime = inferMimeType(uf.originalname, uf.mimetype);
        if (mime.startsWith("image/")) {
          try {
            const uploadsDir = path.join(process.cwd(), "public", "uploads");
            if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
            const destName = `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(uf.originalname)}`;
            const destPath = path.join(uploadsDir, destName);
            fs.copyFileSync(uf.path, destPath);
            await storage.createUploadedImage({
              userId,
              tickerId,
              chatMessageId: userMessage.id,
              originalFilename: uf.originalname,
              storedPath: `/uploads/${destName}`,
              mimeType: mime,
            });
          } catch (imgErr) {
            console.error("Image persistence error (non-fatal):", imgErr);
          }
        }
      }

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

      const currentMarketDate = getMarketDate();
      const contextStack = await storage.getPlaybookContextStack(tickerId, userId, currentMarketDate);

      const formatPlaybookSummary = (pb: any, label: string, detail: "full" | "summary" | "macro") => {
        const pbData = pb.playbookData as any;
        let out = `\n## ${label} PLAYBOOK (${pb.date})\n`;
        out += `Horizon: ${pb.horizonType || "Daily"}\n`;
        out += `Bias: ${pbData.bias || "Open"}\n`;
        out += `Macro Theme: ${pbData.macro_theme || "N/A"}\n`;
        if (pbData.thesis) {
          const thesisText = typeof pbData.thesis === "object" ? (pbData.thesis.summary || JSON.stringify(pbData.thesis)) : String(pbData.thesis);
          out += `Thesis: ${thesisText.slice(0, detail === "full" ? 1000 : 500)}\n`;
        }
        if (detail === "full" || detail === "summary") {
          if (pbData.structural_zones) {
            const green = pbData.structural_zones.bullish_green || [];
            const yellow = pbData.structural_zones.neutral_yellow || [];
            const red = pbData.structural_zones.bearish_red || [];
            if (green.length > 0) out += `GREEN Zone Levels: ${green.map((l: any) => `${l.price}${l.price_high ? `-${l.price_high}` : ""} (${l.label})`).join(", ")}\n`;
            if (yellow.length > 0) out += `YELLOW Zone Levels: ${yellow.map((l: any) => `${l.price}${l.price_high ? `-${l.price_high}` : ""} (${l.label})`).join(", ")}\n`;
            if (red.length > 0) out += `RED Zone Levels: ${red.map((l: any) => `${l.price}${l.price_high ? `-${l.price_high}` : ""} (${l.label})`).join(", ")}\n`;
          }
          if (pbData.if_then_scenarios && pbData.if_then_scenarios.length > 0) {
            out += `If/Then Scenarios:\n${pbData.if_then_scenarios.map((s: any) => `- ${s.condition} → ${s.outcome}`).join("\n")}\n`;
          }
        }
        return out;
      };

      contextInfo += `\nCurrent Market Date: ${currentMarketDate}\n`;
      if (contextStack.daily) {
        contextInfo += formatPlaybookSummary(contextStack.daily, "DAILY", "full");
      }
      if (contextStack.weekly) {
        contextInfo += formatPlaybookSummary(contextStack.weekly, "WEEKLY", "summary");
      }
      if (contextStack.monthly) {
        contextInfo += formatPlaybookSummary(contextStack.monthly, "MONTHLY", "macro");
      }
      if (!contextStack.daily && !contextStack.weekly && !contextStack.monthly) {
        contextInfo += "\nNo active playbooks found for today.\n";
      }

      const chatHistory = await storage.getChatMessagesByTicker(tickerId, userId);
      const recentMessages = chatHistory.slice(-20);
      let geminiHistory = recentMessages.map((m) => ({
        role: m.role === "user" ? "user" as const : "model" as const,
        parts: [{ text: m.content }],
      }));
      while (geminiHistory.length > 0 && geminiHistory[0].role !== "user") {
        geminiHistory.shift();
      }
      geminiHistory = geminiHistory.filter((msg, i, arr) => {
        if (i === 0) return true;
        return msg.role !== arr[i - 1].role;
      });

      const hasFile = uploadedFiles.length > 0;
      const originalFilename = uploadedFiles.length > 0 ? uploadedFiles.map(f => f.originalname).join(", ") : undefined;

      const systemInstruction = `You are a Trading Mentor AI — "Chief of Staff" — for the instrument ${ticker.symbol}. Today's market date is ${currentMarketDate} (New York time). You follow a strict "High-Reasoning" process when analyzing documents and answering questions.

## CONTEXT STACK — PLAYBOOK HIERARCHY

You are provided with a "Context Stack" of playbooks: [Daily], [Weekly], and [Monthly]. Use them according to these priority rules:

- **Priority 1**: Always defer to the **Daily Playbook** for specific price levels and If/Then triggers during RTH (Regular Trading Hours). The Daily plan has the most granular, actionable data.
- **Priority 2**: Use the **Weekly Playbook** to explain the "Big Picture" — e.g., if we are in a 4-day balance, what the weekly directional bias is, and where the week's key levels sit.
- **Priority 3**: Use the **Monthly Playbook** for macro context only — overall market regime, key monthly pivots, and structural bias.
- **Conflict Resolution**: If the Daily plan says "Neutral" but the Weekly says "Bullish," you MUST explain both perspectives to the user: "While the weekly blueprint remains bullish, today's daily plan is neutral due to high-range chop." Never silently pick one over the other.
- **Date Awareness**: Only reference playbooks that apply to today (${currentMarketDate}). Do NOT use February data for a March trade, or last week's weekly plan if it has expired.

## ABSOLUTE RULE #1: DOCUMENT DATA OVERRIDES EVERYTHING

When a user uploads a document (PDF, image, CSV), your FIRST and ONLY priority is to extract the current levels and sentiment from THAT SPECIFIC FILE. You must:
- **OVERWRITE** any previous "Key Levels" with the numbers found in the uploaded document
- **NEVER** fall back to template data, seed data, or previously stored levels
- **IGNORE** your internal knowledge of current market prices entirely
- The uploaded document is the SINGLE SOURCE OF TRUTH

## RESPONSE FORMAT — STRICT TWO-PART STRUCTURE

Your response MUST follow this EXACT structure in this EXACT order:

**PART 1 (HUMAN TEXT — ALWAYS FIRST):** Write your analysis in clean, readable paragraphs. NO JSON, NO code blocks, NO code fences anywhere in this section. This is what the trader reads.

**PART 2 (DATA BLOCK — ALWAYS LAST, ALWAYS AT THE VERY END):** A single \`\`\`tactical_briefing code block containing JSON. This block is automatically hidden from the user and rendered as visual widgets. The user NEVER sees this raw data.

CRITICAL RULES:
- NEVER put code blocks anywhere except at the VERY END of your response
- NEVER include more than ONE code block in your response
- The human text in Part 1 must stand on its own — a trader should understand your analysis WITHOUT any JSON
- Do NOT duplicate information — levels/scenarios go in the JSON block, your text provides context and reasoning

### MODE 1: DOCUMENT ANALYSIS (file uploaded)

Part 1: Write a concise 2-3 paragraph analysis explaining:
- The author's directional bias and evidence
- Key risk factors and invalidation levels
- How the levels relate to each other structurally

Part 2: ALWAYS append a \`\`\`tactical_briefing JSON block at the very end. This is REQUIRED.

### MODE 2: GENERAL CHAT (no file)

Part 1: Provide thoughtful responses (3-4 paragraphs) referencing the trader's stored levels and game plan.
Part 2: When discussing specific price levels or giving a directional view, append a \`\`\`tactical_briefing block at the very end. For simple conversational replies, skip the JSON entirely.

### MODE 3: POST-MARKET REVIEW (recap/review/EOD request)

Trigger: When the user asks for a "recap", "review", "end of day", "EOD", "what happened today", "how did we do", "summary of today", "post-market", "closing review", "daily achievement", or uploads a chart with a closing timestamp (after 4:00 PM EST / 16:00 ET).

In this mode you are an AUDITOR, not a planner. Your job is to compare the MORNING PLAYBOOK against REALITY:

Part 1: Write a narrative recap (2-3 paragraphs):
- What the morning plan predicted vs what actually happened
- Which levels held, which broke, and why
- Emotional/volatility assessment of the session
- What the close means for tomorrow

Part 2: ALWAYS append a \`\`\`tactical_briefing block at the very end with a special "postMarketRecap" key included. The UI renders this as a Post-Market Achievement dashboard.

The audit logic:
1. Compare the Closing Price (from the chart screenshot or stated by the trader) to the Morning Playbook Levels stored in context
2. Identify which If/Then scenarios actually triggered
3. Determine which levels were defended (held) vs lost (broken)
4. Extract "Closing Remarks" — e.g., PharmD's Discord messages about "wen moon to wen gulag" — to capture the emotional sentiment of the floor
5. Grade the session outcome

## TACTICAL_BRIEFING JSON FORMAT

This block goes at the VERY END of your response. The UI renders it as visual widgets — the user never sees raw JSON:

\`\`\`tactical_briefing
{
  "bluf": "1-2 sentence Bottom Line Up Front summary",
  "sentiment": {
    "bias": "BULLISH" | "BEARISH" | "NEUTRAL" | "BULLISH LEAN" | "BEARISH LEAN",
    "summary": "Short explanation of sentiment, e.g. 'Lack of institutional participation. Bulls are losing steam near 6922.'"
  },
  "levels": {
    "overhead": [
      { "price": 6924, "priceHigh": null, "label": "Major resistance — prior day high", "source": "PharmD_KS, p2" }
    ],
    "pivots": [
      { "price": 6910, "priceHigh": 6917, "label": "Neutral zone — chop area", "source": "Document analysis" }
    ],
    "basins": [
      { "price": 6898, "priceHigh": null, "label": "Key support — snap zone", "source": "PharmD_KS, p1" }
    ]
  },
  "ifThen": [
    { "condition": "Price fails to hold 6910", "outcome": "Look for a rotation to 6898", "zone": "red" },
    { "condition": "Price reclaims 6924", "outcome": "Target 6966-6988 expansion", "zone": "green" }
  ],
  "sources": [
    { "filename": "levels_report.pdf", "description": "PharmD daily levels analysis" }
  ],
  "gamePlan": {
    "title": "Brief descriptive title for this game plan",
    "summary": "1-2 sentence summary of the primary bias and key levels",
    "bias": "bullish" | "bearish" | "neutral",
    "levels": [
      {
        "price": 6924,
        "priceHigh": null,
        "type": "support" | "resistance",
        "note": "Description with source attribution",
        "asset": "${ticker.symbol}",
        "source": "Document name, Page X"
      }
    ],
    "checklist": [
      "Action item with exact levels from document"
    ],
    "events": [
      {
        "title": "Event name",
        "time": "HH:MM AM/PM or date string",
        "impact": "high" | "medium" | "low"
      }
    ],
    "ifThenScenarios": [
      {
        "condition": "IF price holds above 6924",
        "outcome": "THEN target 6966-6988"
      }
    ]
  },

  // ONLY include "postMarketRecap" when in MODE 3 (Post-Market Review):
  "postMarketRecap": {
    "sessionOutcome": "STABILIZED" | "TREND_CONTINUATION" | "FAILED_BREAKOUT" | "REVERSAL" | "CHOP",
    "closingPrice": 6892,
    "morningBias": "bearish" | "bullish" | "neutral",
    "levelsDefended": [
      { "price": 6871, "label": "Core Bot — held as floor", "status": "defended" }
    ],
    "levelsLost": [
      { "price": 6902, "label": "P-Breakdown Flip Zone — rejected and lost", "status": "lost" }
    ],
    "scenariosTriggered": [
      { "scenario": "IF 6898-6902 rejected, THEN short targeting 6873", "result": "Partially triggered — price reached 6875", "grade": "A" | "B" | "C" | "F" }
    ],
    "prepForTomorrow": "Closed at 6892 near Major Weekly Level. Bulls need to reclaim 6902 Flip Zone. Failure opens path to 6858 Core Support.",
    "lessonOfTheDay": "Today a great example of why we keep a level head until there is firm clarity. Volatility crush in the last 90 minutes neutralized the expected moon/gulag move."
  }
}
\`\`\`

## LEVEL CLASSIFICATION

Categorize ALL price levels into three groups:
- **Overhead (Red)**: Resistance levels, targets above current price, sell zones
- **Pivots (Yellow)**: Neutral/decision zones, chop areas, "thinking box" levels
- **Basins (Green)**: Support levels, buy zones, floor areas

## MULTI-MODAL VISION ANALYSIS

When images or PDFs with charts are uploaded, use your VISION capabilities to:
- Identify every horizontal line, trendline, and price level visible on the chart
- Read price values from chart axes and annotations
- Detect chart patterns (head & shoulders, flags, channels, etc.)
- Cross-reference visual chart levels with text-mentioned levels

## MULTI-FILE SYNTHESIS (when multiple files are uploaded)

When the trader uploads multiple files at once, SYNTHESIZE across all inputs:
1. Cross-reference levels across documents — if multiple sources agree, flag as HIGH CONFIDENCE
2. Reconcile conflicting bias between documents
3. Attribute each level to its source file

## TRADING ACRONYM DICTIONARY

Interpret these trading terms naturally when encountered:
- **LAAF**: Look Above And Fail (Bull Trap)
- **LBAF**: Look Below And Fail (Bear Trap)
- **Inside Week/Day**: Price stayed within prior period's range (consolidation)
- **POC**: Point of Control — most traded volume level
- **VAH/VAL**: Value Area High / Low
- **ONH/ONL**: Overnight High / Low
- **IB**: Initial Balance — first hour's range
- **HVN/LVN**: High/Low Volume Node
- **VPOC**: Volume Point of Control
- **RTH/ETH**: Regular/Extended Trading Hours
- **Spike Base**: Origin point of a sharp directional move
- **Flip Date**: Date where directional bias may change
- **Gap Fill**: Price returning to fill a previous gap

## SPATIAL OCR — CHART IMAGE ANALYSIS

When a chart image is uploaded, perform Spatial OCR:
1. Read the Y-axis to find exact price values
2. Identify horizontal lines, trendlines, and annotations
3. NEVER assume or round prices — if the chart shows 6922, report 6922, not 6920

## CURRENT TRADER CONTEXT (from database — use ONLY when no document is uploaded)
${contextInfo}

## GUIDELINES FOR GENERAL CHAT (no file attached)
- Reference the trader's stored levels and game plan from context above
- Provide thoughtful, detailed responses (3-4 paragraphs minimum for substantive questions)
- When discussing specific levels or giving a market view, include a tactical_briefing JSON
- Use ONLY levels from the trader's stored notes, not your internal knowledge

## TICKER SYNC — DETECTING NEW INSTRUMENTS

When analyzing an uploaded document, if you detect references to a DIFFERENT ticker/instrument that the trader does NOT currently have in their workspace, suggest opening a new workspace tab for it.

Format the suggestion as: [SYNC_SUGGEST: SYMBOL] — e.g., "I notice this document references AAPL. [SYNC_SUGGEST: AAPL] Would you like me to open an AAPL workspace?"

Only suggest tickers that are NOT "${ticker.symbol}" (the current workspace).`;

      const CHAT_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
      let chatModelIndex = 0;
      let chatModelName = CHAT_MODELS[0];
      let model = genAI.getGenerativeModel({
        model: chatModelName,
        systemInstruction,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 16384,
        },
      });

      const parts: any[] = [];
      let fileProcessingFailed = false;

      if (uploadedFiles.length > 0) {
        const fileUploadResults = await Promise.allSettled(
          uploadedFiles.map(async (uploadedFile) => {
            try {
              const mimeType = inferMimeType(uploadedFile.originalname, uploadedFile.mimetype);
              const uploadResult = await fileManager.uploadFile(uploadedFile.path, {
                mimeType,
                displayName: uploadedFile.originalname,
              });

              let file = uploadResult.file;
              let attempts = 0;
              while (file.state === FileState.PROCESSING && attempts < 60) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
                const result = await fileManager.getFile(file.name);
                file = result;
                attempts++;
              }

              if (file.state === FileState.ACTIVE) {
                return { type: "fileData" as const, data: { fileData: { mimeType: file.mimeType, fileUri: file.uri } } };
              }
              throw new Error(`File ${uploadedFile.originalname} in state: ${file.state}`);
            } catch (fileErr: any) {
              console.warn(`Gemini upload error for ${uploadedFile.originalname}, trying fallback:`, fileErr?.message);
              const chatMimeType = inferMimeType(uploadedFile.originalname, uploadedFile.mimetype);
              if (chatMimeType.startsWith("image/")) {
                const imageData = fs.readFileSync(uploadedFile.path);
                return { type: "inlineData" as const, data: { inlineData: { mimeType: chatMimeType, data: imageData.toString("base64") } } };
              }
              const fileContent = await extractTextFromFile(uploadedFile.path, chatMimeType);
              if (fileContent) {
                return { type: "text" as const, data: { text: `[Document content from "${uploadedFile.originalname}"]:\n\n${fileContent}` } };
              }
              throw fileErr;
            }
          })
        );

        let successCount = 0;
        for (const result of fileUploadResults) {
          if (result.status === "fulfilled") {
            parts.push(result.value.data);
            successCount++;
          }
        }
        if (successCount === 0 && uploadedFiles.length > 0) {
          fileProcessingFailed = true;
        }
        for (const path of tempFilePaths) {
          try { fs.unlinkSync(path); } catch {}
        }
      }

      if (fileProcessingFailed) {
        const errorMessage = `⚠️ **File Processing Error**\n\nI was unable to process your uploaded file. The file may be too large, corrupted, or in an unsupported format.\n\n**What you can try:**\n- Re-upload the file (sometimes a retry works)\n- If it's a PDF, try converting it to images first\n- Make sure the file is under 10MB\n- Supported formats: PDF, PNG, JPG, CSV\n\nYour message has been saved — once the file processes successfully, I'll analyze it with full detail.`;

        const aiMessage = await storage.createChatMessage({
          userId,
          tickerId,
          role: "assistant",
          content: errorMessage,
        });

        return res.status(201).json({
          userMessage,
          aiMessage,
          createdNoteId: null,
        });
      }

      parts.push({ text: content || "Analyze the attached file in full detail. Provide a complete thesis, all levels, If/Then scenarios, and execution checklist." });

      let aiContent: string = "";
      let rawAiContent: string = "";
      let extractedGamePlan: any = null;
      let tacticalBriefing: any = null;
      let isFallback = false;

      const MAX_CHAT_RETRIES = 4;
      let lastAiErr: any = null;
      let chatRetryModelAttempts = 0;
      for (let attempt = 0; attempt < MAX_CHAT_RETRIES; attempt++) {
        try {
          const chat = model.startChat({
            history: geminiHistory,
          });
          const result = await chat.sendMessage(parts);
          rawAiContent = result.response.text();
          aiContent = rawAiContent;

          const briefingParsed = parseTacticalBriefing(aiContent);
          if (briefingParsed) {
            aiContent = briefingParsed.cleanContent;
            if (briefingParsed.briefing) {
              tacticalBriefing = briefingParsed.briefing;
            }
          }

          if (hasFile) {
            if (tacticalBriefing?.gamePlan) {
              extractedGamePlan = tacticalBriefing.gamePlan;
            }
            if (!extractedGamePlan) {
              extractedGamePlan = parseGamePlanFromResponse(rawAiContent);
            }
          }
          lastAiErr = null;
          break;
        } catch (aiErr: any) {
          lastAiErr = aiErr;
          const status = aiErr?.status || aiErr?.httpStatusCode || aiErr?.code;
          const isRetryable = status === 503 || status === 429 || String(aiErr?.message || "").includes("503") || String(aiErr?.message || "").includes("429") || String(aiErr?.message || "").includes("Service Unavailable") || String(aiErr?.message || "").includes("overloaded");
          if (isRetryable) {
            chatRetryModelAttempts++;
            if (chatRetryModelAttempts >= 2 && chatModelIndex < CHAT_MODELS.length - 1) {
              chatModelIndex++;
              chatModelName = CHAT_MODELS[chatModelIndex];
              chatRetryModelAttempts = 0;
              console.log(`Chat: switching to fallback model ${chatModelName}`);
              model = genAI.getGenerativeModel({
                model: chatModelName,
                systemInstruction,
                generationConfig: { temperature: 0.1, maxOutputTokens: 16384 },
              });
              await new Promise(r => setTimeout(r, 2000));
              continue;
            }
            if (attempt < MAX_CHAT_RETRIES - 1) {
              const delay = Math.pow(2, attempt) * 1000;
              console.log(`Chat API error (${status || "unknown"}, model=${chatModelName}). Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_CHAT_RETRIES})...`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
          }
          break;
        }
      }

      if (lastAiErr) {
        console.error("Gemini API error after retries:", lastAiErr);
        aiContent = buildFallbackResponse(ticker.symbol, content, latestNote, supportLevels, resistanceLevels, checklistItems);
        isFallback = true;
      }

      const aiMessage = await storage.createChatMessage({
        userId,
        tickerId,
        role: "assistant",
        content: aiContent,
        structuredData: tacticalBriefing || undefined,
      });

      let createdNote: any = null;
      if (extractedGamePlan && extractedGamePlan.title) {
        try {
          createdNote = await storage.createNote({
            userId,
            tickerId,
            title: extractedGamePlan.title,
            rawContent: content + (originalFilename ? ` [File: ${originalFilename}]` : ""),
            summary: extractedGamePlan.summary || null,
            tags: [extractedGamePlan.bias || "neutral"],
          });

          if (extractedGamePlan.levels && extractedGamePlan.levels.length > 0) {
            const levelInserts = extractedGamePlan.levels.map((l: any) => ({
              noteId: createdNote.id,
              ticker: l.asset || ticker.symbol,
              priceLow: String(l.price),
              priceHigh: l.priceHigh ? String(l.priceHigh) : null,
              levelType: l.type === "resistance" ? "resistance" : "support",
              description: l.note ? `${l.note}${l.source ? ` — Source: ${l.source}` : ""}` : null,
            }));
            await storage.createLevels(levelInserts);
          }

          if (extractedGamePlan.events && extractedGamePlan.events.length > 0) {
            const eventInserts = extractedGamePlan.events.map((e: any) => ({
              userId,
              noteId: createdNote.id,
              title: e.title,
              eventTime: e.time || "TBD",
              impactLevel: e.impact || "medium",
            }));
            await storage.createEvents(eventInserts);
          }

          if (extractedGamePlan.checklist && extractedGamePlan.checklist.length > 0) {
            const newChecklist = await storage.createChecklist({
              userId,
              noteId: createdNote.id,
              date: new Date().toISOString().split("T")[0],
              status: "open",
              closingNote: null,
            });

            const checklistInserts = extractedGamePlan.checklist.map((item: string) => ({
              checklistId: newChecklist.id,
              content: item,
              isCompleted: false,
            }));
            await storage.createChecklistItems(checklistInserts);
          }
        } catch (noteErr: any) {
          console.error("Auto game plan creation error:", noteErr);
        }
      }

      res.status(201).json({
        userMessage,
        aiMessage,
        createdNoteId: createdNote?.id || null,
        fallback: isFallback,
      });
    } catch (err: any) {
      console.error("Chat error:", err);
      res.status(400).json({ message: err.message });
    } finally {
      for (const path of tempFilePaths) {
        try { fs.unlinkSync(path); } catch {}
      }
    }
  });

  function stripAllCodeBlocks(text: string): string {
    return text.replace(/```[\w]*\s*[\s\S]*?```/g, "").trim();
  }

  function parseTacticalBriefing(aiContent: string): { briefing: any; cleanContent: string } | null {
    const briefingMatch = aiContent.match(/```(?:tactical_briefing|json)\s*\n([\s\S]*?)\n\s*```/);
    if (!briefingMatch) {
      const hasCodeBlocks = /```[\s\S]*?```/.test(aiContent);
      if (hasCodeBlocks) {
        return { briefing: null, cleanContent: stripAllCodeBlocks(aiContent) };
      }
      return null;
    }

    const cleanContent = stripAllCodeBlocks(aiContent);

    try {
      let jsonStr = briefingMatch[1].trim();
      jsonStr = jsonStr.replace(/,\s*([}\]])/g, "$1");
      const parsed = JSON.parse(jsonStr);

      if (!parsed.sentiment && !parsed.levels && !parsed.ifThen && !parsed.bluf) {
        return { briefing: null, cleanContent };
      }

      const briefing: any = {};

      if (parsed.bluf) briefing.bluf = String(parsed.bluf);
      if (parsed.sentiment) {
        briefing.sentiment = {
          bias: String(parsed.sentiment.bias || "NEUTRAL").toUpperCase(),
          summary: String(parsed.sentiment.summary || ""),
        };
      }

      if (parsed.levels) {
        briefing.levels = {
          overhead: Array.isArray(parsed.levels.overhead) ? parsed.levels.overhead.filter((l: any) => l.price) : [],
          pivots: Array.isArray(parsed.levels.pivots) ? parsed.levels.pivots.filter((l: any) => l.price) : [],
          basins: Array.isArray(parsed.levels.basins) ? parsed.levels.basins.filter((l: any) => l.price) : [],
        };
      }

      if (Array.isArray(parsed.ifThen)) {
        briefing.ifThen = parsed.ifThen.filter((s: any) => s.condition && s.outcome);
      }

      if (Array.isArray(parsed.sources)) {
        briefing.sources = parsed.sources.filter((s: any) => s.filename);
      }

      if (parsed.gamePlan) {
        briefing.gamePlan = parsed.gamePlan;
      }

      if (parsed.postMarketRecap) {
        briefing.postMarketRecap = {
          sessionOutcome: String(parsed.postMarketRecap.sessionOutcome || "CHOP").toUpperCase(),
          closingPrice: parsed.postMarketRecap.closingPrice || null,
          morningBias: parsed.postMarketRecap.morningBias || null,
          levelsDefended: Array.isArray(parsed.postMarketRecap.levelsDefended) ? parsed.postMarketRecap.levelsDefended : [],
          levelsLost: Array.isArray(parsed.postMarketRecap.levelsLost) ? parsed.postMarketRecap.levelsLost : [],
          scenariosTriggered: Array.isArray(parsed.postMarketRecap.scenariosTriggered) ? parsed.postMarketRecap.scenariosTriggered : [],
          prepForTomorrow: parsed.postMarketRecap.prepForTomorrow || null,
          lessonOfTheDay: parsed.postMarketRecap.lessonOfTheDay || null,
        };
      }

      return { briefing, cleanContent };
    } catch (err) {
      console.error("Failed to parse tactical briefing JSON:", err);
      return { briefing: null, cleanContent };
    }
  }

  function parseGamePlanFromResponse(aiContent: string): any | null {
    try {
      let jsonStr: string | null = null;

      const fencedMatch = aiContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fencedMatch) {
        jsonStr = fencedMatch[1].trim();
      }

      if (!jsonStr) {
        const rawJsonMatch = aiContent.match(/\{[\s\S]*"gamePlan"[\s\S]*\}/);
        if (rawJsonMatch) {
          jsonStr = rawJsonMatch[0];
        }
      }

      if (!jsonStr) return null;

      jsonStr = jsonStr.replace(/,\s*([}\]])/g, "$1");

      const parsed = JSON.parse(jsonStr);
      const gp = parsed.gamePlan || parsed;

      if (!gp.title && !gp.levels) return null;

      const validLevels = Array.isArray(gp.levels)
        ? gp.levels.filter((l: any) => {
            const price = Number(l.price);
            return !isNaN(price) && price > 0 && (l.type === "support" || l.type === "resistance");
          })
        : [];

      const validChecklist = Array.isArray(gp.checklist)
        ? gp.checklist.filter((c: any) => typeof c === "string" && c.trim().length > 0)
        : [];

      const validEvents = Array.isArray(gp.events)
        ? gp.events.filter((e: any) => e && typeof e.title === "string" && e.title.trim().length > 0)
            .map((e: any) => ({ ...e, time: e.time || "TBD", impact: e.impact || "medium" }))
        : [];

      return {
        title: typeof gp.title === "string" ? gp.title.slice(0, 200) : "AI-Generated Game Plan",
        summary: typeof gp.summary === "string" ? gp.summary.slice(0, 500) : null,
        bias: ["bullish", "bearish", "neutral"].includes(gp.bias) ? gp.bias : "neutral",
        levels: validLevels,
        checklist: validChecklist,
        events: validEvents,
        ifThenScenarios: Array.isArray(gp.ifThenScenarios) ? gp.ifThenScenarios : [],
      };
    } catch (err) {
      console.error("Failed to parse game plan JSON from AI response:", err);
      return null;
    }
  }

  function buildFallbackResponse(symbol: string, query: string, latestNote: any, support: any[], resistance: any[], checklist: any[]): string {
    if (latestNote) {
      const levelCount = support.length + resistance.length;
      return `I wasn't able to connect to the AI analysis engine right now, but I have your **${symbol}** game plan loaded — **${latestNote.title}**${latestNote.summary ? ` (${latestNote.summary})` : ""}.\n\nYou have **${levelCount} levels** and **${checklist.length} checklist items** stored from your latest playbook. To give you a full recap, I'd need the AI engine back online.\n\n**Would you like to try again?** Sometimes a quick retry resolves the connection. Or if you have a closing chart screenshot, upload it and I'll analyze it once the connection is restored.`;
    } else {
      return `I wasn't able to connect to the AI analysis engine right now, and I don't see a game plan loaded for **${symbol}** yet.\n\n**To get started:** Upload a trading note, PDF, or chart screenshot and I'll extract your levels, scenarios, and build a full playbook. Try again in a moment if you'd like AI-powered analysis.`;
    }
  }

  // ─── Playbooks ──────────────────────────────────────────────────

  app.get("/api/playbooks", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const pbs = await storage.getPlaybooks(userId);
    res.json(pbs);
  });

  app.get("/api/tickers/:tickerId/playbooks", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const tickerId = parseInt(req.params.tickerId as string);
    const pbs = await storage.getPlaybooksByTicker(tickerId, userId);
    res.json(pbs);
  });

  app.get("/api/playbooks/:id", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const id = parseInt(req.params.id as string);
    const pb = await storage.getPlaybook(id, userId);
    if (!pb) return res.status(404).json({ message: "Playbook not found" });
    res.json(pb);
  });

  app.patch("/api/playbooks/:id/review", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const id = parseInt(req.params.id as string);
    const { review } = req.body;
    if (typeof review !== "string") return res.status(400).json({ message: "review must be a string" });
    const updated = await storage.updatePlaybookReview(id, userId, review);
    if (!updated) return res.status(404).json({ message: "Playbook not found" });
    res.json(updated);
  });

  app.delete("/api/playbooks/:id", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid playbook id" });
    const deleted = await storage.deletePlaybook(id, userId);
    if (!deleted) return res.status(404).json({ message: "Playbook not found" });
    res.json({ success: true });
  });

  app.post("/api/playbooks/:id/pin-message", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const id = parseInt(req.params.id as string);
    const { messageId } = req.body;
    if (!messageId) return res.status(400).json({ message: "messageId is required" });

    const pb = await storage.getPlaybook(id, userId);
    if (!pb) return res.status(404).json({ message: "Playbook not found" });

    const msgs = await storage.getChatMessagesByTicker(pb.tickerId!, userId);
    const msg = msgs.find(m => m.id === messageId);
    if (!msg) return res.status(404).json({ message: "Message not found" });

    const pbData = pb.playbookData as any;
    const tacticalUpdates = Array.isArray(pbData.tactical_updates) ? pbData.tactical_updates : [];

    const alreadyPinned = tacticalUpdates.some((u: any) => u.pinnedMessageId === msg.id);
    if (alreadyPinned) return res.status(409).json({ message: "Message already pinned to this playbook" });

    tacticalUpdates.push({
      timestamp: new Date().toISOString(),
      source: "Pinned from chat",
      author: "User",
      addedLevels: [],
      addedScenarios: [],
      note: msg.content.slice(0, 500),
      pinnedMessageId: msg.id,
    });

    const updated = await storage.updatePlaybook(id, userId, {
      playbookData: { ...pbData, tactical_updates: tacticalUpdates },
    });
    res.json(updated);
  });

  // ─── Analyze Document (Playbook Generator) ────────────────────

  app.post("/api/analyze-document", isAuthenticated, upload.array("files", 10), async (req, res) => {
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];
    const tempFilePaths = uploadedFiles.map(f => f.path);
    try {
      const userId = getUserId(res);
      const tickerIdRaw = parseInt(req.body.tickerId as string);
      if (isNaN(tickerIdRaw)) return res.status(400).json({ message: "Valid tickerId is required" });
      const tickerId = tickerIdRaw;
      const userMessage = typeof req.body.content === "string" ? req.body.content.trim() : "";

      if (uploadedFiles.length === 0) {
        return res.status(400).json({ message: "Please upload a document to analyze" });
      }

      const ticker = await storage.getTicker(tickerId, userId);
      if (!ticker) return res.status(404).json({ message: "Ticker not found" });

      const originalFilename = uploadedFiles.map(f => f.originalname).join(", ");

      await storage.createChatMessage({
        userId,
        tickerId,
        role: "user",
        content: `📎 ${userMessage || "Generate Trading Playbook"} [${uploadedFiles.length} file${uploadedFiles.length > 1 ? "s" : ""}: ${originalFilename}]`,
      });

      const playbookSystemPrompt = `You are a Trading Playbook Generator. Your job is to read uploaded trading documents (PDFs, images, CSVs) from analysts and extract a STRUCTURED "Living Playbook" in strict JSON format.

## STRICT HORIZON CLASSIFICATION (CRITICAL — DO THIS FIRST)

Before extracting ANY data, you MUST classify the document's horizon type. Your first internal reasoning step must be: "Type: [MONTHLY/WEEKLY/DAILY]"

**Classification Rules:**
- **MONTHLY**: Title contains "Monthly", "Month of", "February Overview", "March Outlook", or covers an entire calendar month. These are rare — only use this if the document explicitly covers a full month.
- **WEEKLY**: Title contains "Week of", "Weekly", "Week", a date range like "Feb 17-21" or "Mar 8-14", or covers multiple trading days as a cohesive plan. Example: "Market Analysis for The Week of 3/8" → WEEKLY.
- **DAILY**: Title contains a single date like "Market Analysis and Trades for 2/10", "Trades for 3/9", or covers ONE specific trading day. This is the DEFAULT if unclear. Multi-day titles like "2/16-2/17" that cover a weekend bridge are still DAILY (use the first trading day).

**Set metadata.horizon_type to exactly "Daily", "Weekly", or "Monthly".** This determines which database silo the playbook is stored in. A Weekly report must NEVER overwrite a Daily report.

## SYMBOL-AWARE EXTRACTION (CRITICAL)

Documents often cover MULTIPLE instruments (e.g., ES, NQ, QQQ) in a single PDF. You MUST segregate ALL data by ticker symbol.

**Rules:**
1. Return a JSON object where the primary keys are Ticker Symbols (e.g., "ES", "NQ", "BTCUSD")
2. If a level or scenario is explicitly for NQ, place it ONLY under the "NQ" key. Do NOT mix symbols.
3. Each ticker gets its OWN complete playbook data (bias, levels, scenarios, thesis, etc.)
4. Shared data (macro_clock, key_events, risk_factors) goes in a top-level "shared" object
5. The requesting workspace ticker is "${ticker.symbol}" — always include this key even if the document is sparse for it

**How to detect the ticker:**
- ES levels are typically in the 4000-7000 range (S&P 500 futures)
- NQ levels are typically in the 15000-25000+ range (Nasdaq futures)
- Look for explicit headers like "ES: Trading Lower/Higher" or "NQ: Levels"
- If a section says "Nasdaq" or "NQ" or has 5-digit prices in the 15000-25000 range, it belongs under "NQ"
- If a section says "S&P" or "ES" or has 4-digit prices in the 4000-7000 range, it belongs under "ES"

## AUTHOR PROFILES — SPECIALIZED EXTRACTION LOGIC

### Ms. Izzy (Ratio Trading Style)
- **Signature Concepts**: "Calculated Ratios" (68-70, 173, 256, 346), "Nesting Channels," "Measured Moves," "RTH Range Levels," "Control Ratios," "Point Buffers"
- **How she thinks**: Numbers-based — she calculates precise targets from ratio math. Her levels are algorithmically derived.
- **Extract**: Every ratio number, nesting channel boundary, and measured move target. Tag source as "Ms. Izzy"

**IZZY-SPECIFIC PRECISION RULES (Critical for ratio-based reports):**
1. **Differentiate Resistance from Bearishness**: Do NOT put upside targets (e.g., 7043, annual highs, calculated highs) in the 'Bearish Zone' just because they are overhead resistance. Upside targets and calculated highs are BULLISH milestones — categorize them as zone="green" with type="Upside Target" or "Calculated High". Reserve the Bearish/Red zone ONLY for downside breakdown levels and actual bearish targets.
2. **Extract 'Mathematical Anchors'**: If the author mentions recurring "buffers," "control ratios," or "point calculations" (e.g., "32 point buffer," "30-34 point control ratio," "68-70 point range"), extract these into a top-level "strategy_rules" array. Each rule: { "label": "Control Ratio", "value": "30-34 points", "description": "Active math anchor — if price is 32 points above a level, it is extended" }.
3. **Contextualize RTH vs ETH**: Izzy often references RTH (Regular Trading Hours) vs ETH (Extended Trading Hours) levels. In the level's provenance field, ALWAYS specify "RTH High," "RTH Low," "ETH High," or "ETH Low" when the author distinguishes them — these carry different weight.
4. **Scenario Deadlines**: If a scenario or checklist item has a "Best if before [DATE]" or "no later than the 3rd" clause, extract this as a "timing_requirement" field on the scenario (e.g., "Best if before Feb 3rd"). Time-sensitive items are HIGH PRIORITY.

### PharmD_KS (Profile Trading Style)
- **Signature Concepts**: "Profile Shapes" (P-shape/b-shape), "LAAF/LBAF" setups, "Initial Balance (IB)" breaks, "Spike Bases"
- **How he thinks**: Volume profile and market structure — he reads the shape of the auction to determine direction.
- **Extract**: Every profile shape reference, LAAF/LBAF setup, IB level, and spike base. Tag source as "PharmD_KS"

### Unknown Author
- If the author cannot be identified, tag as "Unknown" and still extract all levels.

## THE AI LENS — HOW YOU INTERPRET NUMBERS

### 1. Numbers Have "Personalities" (Zones vs. Lines)
Price levels are NOT flat support/resistance lines. They are STRUCTURAL ENVIRONMENTS:
- Classify every level into its STRUCTURAL ROLE, not just "support" or "resistance"

### 2. Level Provenance (The "Why")
Every extracted level MUST include its historical origin — where the number came from. Examples: "Friday's Excess Low," "Jan RTH Low," "Thursday's Spike Base," "2/5 ETH Low." This gives prices MEMORY so users learn that old levels matter.

### 3. Conviction Ratings
Extract author-specific grades when present (e.g., "A+", "B-", "Monster Day Trade", "Minor setup"). If no explicit rating, infer from the author's emphasis: strong language = "A", moderate = "B", minor mention = "C".

### 4. Cross-Market Requirements
Identify when a setup on one ticker requires a condition on ANOTHER ticker. Examples:
- "Only if QQQ holds below 618.69"
- "QQQ 21-EMA/50-SMA cross needed"
- "ES needs to hold 6100 for NQ long"
Extract these as cross_market_filter on the scenario.

### 5. If/Then Algorithmic Thinking
Map out EXACTLY as conditional logic. Quote the author's exact words.

### 5b. Scenario Branching (Plan Type)
Every scenario MUST include a "plan_type" field:
- **"primary"**: The author's MOST LIKELY expected outcome. The main thesis, the base-case scenario. If the author says "I think X happens," that is primary.
- **"contingency"**: The "What If" fallback. Scenarios that begin with "if I'm wrong," "if we trade past an edge," "alternatively," or describe less likely outcomes are contingency.
- When in doubt, if a scenario aligns with the overall bias/thesis, mark it "primary." If it contradicts the bias or is a hedge, mark it "contingency."

### 6. Macro Context & Clock
Documents emphasize temporal market themes (OPEX, CPI, NFP, earnings). Extract as a macro_clock array with event, time, and risk level.

### 6b. Sentiment Warning Detection
If the author uses cautionary language suggesting heightened volatility or uncertainty — words/phrases like "fucky," "grueling," "choppy," "volatile," "messy," "treacherous," "be careful," "reduce size," "small size," "dangerous" — set metadata.sentiment_warning to "Volatility Warning". This gives the trader a psychological heads-up to trade smaller. If no such language is detected, omit or set to null.

### 7. Structural Zones (Three-Color System)
- **GREEN (Bullish Zone)**: Longs trigger, breakout confirmations, buying opportunities.
- **YELLOW (Neutral/Caution Zone)**: "Thinking Box" — chop zone, no-trade zone, wait-and-see.
- **RED (Bearish Zone)**: Short triggers, breakdown levels, selling pressure zones.

## SYNTHESIS & TACTICAL PRIORITIZATION MODULE

**Role**: You are a Senior Trading Strategist / Head of Research.
**Objective**: When analyzing multiple documents from different experts (e.g., Ms. Izzy and PharmD_KS), merge them into a single, high-conviction "Battle Map" that prioritizes quality over quantity. Do NOT create a "Price Ladder" — create a concise tactical plan.

### 1. Confluence Detection (Merging Levels)
- **Identify Clusters**: If two authors provide levels within 5 points of each other (for ES) or 20 points (for NQ), do NOT list them separately. Merge them into a single **"Confluence Zone"** with a price range (e.g., 6894-6902).
- **Label by Weight**: In the merged level, list BOTH authors as sources. Set \`is_confluence: true\` on the level. Label it as a "High-Confluence Decision Zone" if both authors focus heavily on the area.
- **Data Structure**: Confluence levels include: \`sources: ["PharmD_KS", "Ms. Izzy"]\` (array of all contributing authors) and \`is_confluence: true\` (boolean flag).
- A trader would rather know about 3 high-confluence levels than 30 individual ones.

### 2. Narrative Synthesis (The "One Thesis" Rule)
- **Compare Biases**: If Author A is "Neutral" and Author B is "Bearish," identify the "Pivot" that changes the bias.
- **Synthesis Output**: Instead of two separate summaries, provide ONE **"Unified Narrative"** thesis that explains the conflict. Example: "Izzy is looking for range suppression, but PharmD warns that a failure of 6894 triggers a liquidation. The common theme is: Watch the 6894 center closely."
- The thesis should read like a **battle briefing**, not two separate reports.

### 3. Exhaustive Scenario Extraction (100% Completeness Mandate)
- **You are a Strictly Exhaustive Data Extractor.** When analyzing a trading report (like PharmD_KS or Ms. Izzy), you must extract EVERY specific 'If/Then' branch mentioned.
- **Do not combine unique trades.** If the author mentions a 'Trading Higher' path and a 'Trading Lower' path with multiple sub-conditions (e.g., LAAF, LBAF, failed reclaim), each must be its own unique entry in the scenarios array.
- **There is NO limit on the number of scenarios.** Accuracy and completeness are the priority. If a report contains 15 scenarios, output all 15.
- **The "Author's Favorite" Filter**: Tag high-conviction setups (e.g., "A+ Setup," "Primarily interested in," "Favorite setup," "Mandatory hold," "Monster trade") with rating "A+" but still include ALL other well-defined scenarios.
- **Counter-Trend / Trap Detection**: Any scenario involving LAAF, LBAF, failed reclaim, counter-trend, trap, false break, fakeout, or stop hunt must be tagged with plan_type "counter_trend".
- **Every scenario must include BEHAVIOR** in the "then" field — not just a price target. "If level X breaks, go to level Y" is incomplete. A complete scenario includes: "If we lose 6871 with high volume, expect a fast liquidation toward the 6860 spike base."

### 4. Behavioral Context (The "How" of the Trade)
- In the **"then"** field of every scenario, include the expected **market character** — not just a price target.
- Look for keywords: "Volume building," "Squeeze," "Liquidated," "Spike," "Grind," "Rotational chop," "Fast move," "Sticky price action," "Fade."
- **Bad**: "THEN target 6869"
- **Good**: "THEN expect a fast liquidation toward the 6869 spike base"
- **Good**: "THEN look for a slow grind higher toward the 6928 monthly pivot"

### 5. Cross-Author Requirements
- Explicitly check if one author's condition provides a filter for another author's trade.
- Example: "PharmD's LBAF setup on ES is only high-probability if QQQ respects Izzy's 618.69 level."
- Set \`cross_market_filter\` on the scenario when this is detected.

### 6. Author Style Indicators
- On each level and scenario, include an \`author_initials\` field:
  - "I" for Ms. Izzy
  - "P" for PharmD_KS
  - "I+P" for confluence (both authors)
  - First letter of author name for unknown authors
- This allows the UI to show small color-coded dots indicating which logic contributed.

### 7. The "Rule of 3" Output Priority
The final "Synthesized Gameplan" should prioritize:
1. **Confluence levels FIRST** — these are the highest-probability zones
2. **Author's Favorite setups** — only high-conviction standalone scenarios
3. **The Decision Zone** — the ONE price area where the session's direction gets decided

## TRADING JARGON DICTIONARY

- **LAAF**: Look Above And Fail (Bull Trap)
- **LBAF**: Look Below And Fail (Bear Trap)
- **Inside Week/Day**: Price within prior period range
- **POC**: Point of Control
- **VAH/VAL**: Value Area High / Low
- **ONH/ONL**: Overnight High / Low
- **IB**: Initial Balance — first hour range
- **HVN/LVN**: High/Low Volume Node
- **VPOC**: Volume Point of Control
- **RTH/ETH**: Regular/Extended Trading Hours
- **b-shaped profile**: Long liquidation (sellers in control)
- **p-shaped profile**: Short covering (buyers stepping in)
- **Snap Zone**: Aggressive directional moves originate here
- **Thinking Box**: Neutral consolidation zone
- **Spike Base**: Origin of a sharp directional move
- **Flip Date**: Date where directional bias may change

## SPATIAL OCR — CHART IMAGE ANALYSIS

When a chart image is uploaded:
1. Read the Y-axis to find exact price values
2. Identify every horizontal line, trendline, and annotation
3. NEVER assume or round prices — report exact values
4. Always prefer Document Data over internal training data

## OUTPUT REQUIREMENTS

Return ONLY valid JSON. No markdown, no explanation, no preamble.

The TOP-LEVEL structure must be symbol-keyed. Each ticker symbol is a key containing that instrument's complete playbook. Shared data goes in a "shared" key.

{
  "metadata": {
    "author": "PharmD_KS | Ms. Izzy | Unknown | PharmD_KS + Ms. Izzy",
    "report_title": "Full title of document or description of chart",
    "target_horizon": "Date or Date Range (e.g., 'Feb 18', 'Feb 17-21')",
    "horizon_type": "Daily | Weekly | Monthly",
    "sentiment_warning": "Volatility Warning | null",
    "_horizon_reasoning": "Type: [MONTHLY/WEEKLY/DAILY] — one sentence explaining why"
  },
  "instruments": {
    "ES": {
      "bias": "Bearish",
      "thesis": { "bias": "Bearish", "summary": "Thesis for ES with evidence" },
      "macro_theme": "ES dominant theme",
      "levels": [
        {
          "price": 6898,
          "price_high": 6902,
          "type": "Resistance | Support | Pivot | Snap Zone | Spike Base | IB High | IB Low | POC | VAH | VAL | Confluence Zone",
          "zone": "green | yellow | red",
          "label": "Short description (or 'High-Confluence Decision Zone' for merged levels)",
          "provenance": "Thursday Spike Base",
          "context": "Paraphrase from document",
          "source": "PharmD_KS (or 'PharmD_KS + Ms. Izzy' for confluence)",
          "conviction": "A+ | A | B | C",
          "is_confluence": false,
          "sources": ["PharmD_KS"],
          "author_initials": "P"
        }
      ],
      "scenarios": [
        {
          "id": "es_scenario_1",
          "if": "IF price sees a LBAF at 6828",
          "then": "THEN expect a fast liquidation toward the 6860 spike base (include behavioral context, not just price target)",
          "zone": "green | yellow | red",
          "rating": "A+ | A | B | C",
          "source": "PharmD_KS",
          "cross_market_filter": null,
          "timing_requirement": null,
          "plan_type": "primary | counter_trend | contingency",
          "is_confluence": false,
          "sources": ["PharmD_KS"],
          "author_initials": "P"
        }
      ],
      "strategy_rules": [
        {
          "label": "Control Ratio",
          "value": "30-34 points",
          "description": "Active math anchor — if price is X points above a level, it is considered extended"
        }
      ],
      "execution_checklist": ["ES-specific actionable items"]
    },
    "NQ": {
      "bias": "Neutral",
      "thesis": { "bias": "Neutral", "summary": "Thesis for NQ with evidence" },
      "macro_theme": "NQ dominant theme",
      "levels": [ ... ],
      "scenarios": [ ... ],
      "execution_checklist": ["NQ-specific actionable items"]
    }
  },
  "shared": {
    "macro_clock": [
      { "event": "VIX Expiration", "time": "Feb 18", "risk": "High" }
    ],
    "key_events": [
      { "title": "Event name", "time": "Date/time string", "impact": "high | medium | low", "expected_behavior": "How this affects trading" }
    ],
    "risk_factors": ["Key risk factor 1"]
  }
}

**IMPORTANT:** If the document only covers ONE instrument, still use the instruments structure with just that one key. The requesting ticker is "${ticker.symbol}" — normalize symbol names: use "ES" for ES1!/ES/S&P, "NQ" for NQ1!/NQ/Nasdaq, "BTC" for BTCUSD, etc.

## BACKWARD COMPATIBILITY
Also include these legacy FLAT fields at the root level (alongside "instruments") for backward compatibility. Use data from the PRIMARY instrument (${ticker.symbol}):
- "bias": same as the primary instrument's bias
- "thesis": same as the primary instrument's thesis
- "macro_theme": same as the primary instrument's macro_theme
- "levels": COMBINED levels from ALL instruments (for legacy display)
- "scenarios": COMBINED scenarios from ALL instruments
- "structural_zones": { "bullish_green": [...], "neutral_yellow": [...], "bearish_red": [...] }
  - Map from the levels array: green zone levels → bullish_green, yellow → neutral_yellow, red → bearish_red
  - Each entry: { "price", "price_high", "label", "context", "source" }
- "if_then_scenarios": mapped from scenarios array
  - Each entry: { "id", "condition": scenarios[].if, "outcome": scenarios[].then, "zone", "source", "timing_requirement", "is_confluence", "sources", "author_initials" }
- "strategy_rules": COMBINED from all instruments (mathematical anchors, control ratios, buffers)
- "key_events": same as shared.key_events
- "risk_factors": same as shared.risk_factors
- "execution_checklist": COMBINED from all instruments
- "macro_clock": same as shared.macro_clock

## MULTI-FILE SYNTHESIS

When multiple files are uploaded:
1. **Merge Levels**: Combine from all documents. Same level in multiple sources = HIGH CONFIDENCE.
2. **Reconcile Bias**: Lean toward the most detailed evidence. Note conflicts.
3. **Cross-Reference**: Verify chart annotations match text. Flag discrepancies.
4. **Attribution**: Include which file each level came from (e.g., "PharmD_KS + Ms. Izzy").
5. **Unified Scenarios**: Merge and deduplicate.
6. **Author Detection**: If multiple authors detected, set metadata.author to combined (e.g., "PharmD_KS + Ms. Izzy").

## OUTPUT SIZE OPTIMIZATION
- Keep "context" strings under 80 characters — paraphrase, don't quote entire paragraphs
- Keep "label" strings under 40 characters
- Keep thesis.summary under 500 characters
- Do NOT duplicate data across levels, scenarios, and structural_zones — reference by price only in structural_zones
- Omit null fields entirely (e.g., if price_high is null, leave it out)
- Omit cross_market_filter if null
- For large documents covering multiple instruments, focus levels on the PRIMARY ticker requested

## TEMPORAL CONTEXT FILTER (Critical for Accuracy)

Documents contain BOTH historical review AND forward-looking plans. You MUST distinguish them:

**HISTORICAL sections (DO NOT use for Zones, Levels, or Scenarios):**
- Sections labeled "Review," "Recap," "Prior Weeks," "Prior Week Conditions," "Last Week," "What Happened"
- Any section describing what ALREADY occurred in the market
- These are for CONTEXT ONLY — they explain WHY the author holds a certain bias, but the specific prices and events are PAST

**FORWARD-LOOKING sections (USE these for Zones, Levels, and Scenarios):**
- Sections labeled "Early Week Conditions," "Price for Tomorrow," "Plan," "Game Plan," "This Week," "Outlook," "Forecast," "Setup"
- Any section describing what the author EXPECTS to happen or is watching for
- The Playbook should ONLY populate Structural Zones, Levels, and If/Then Scenarios from these forward-looking sections

**Date Validation Rule:** Determine the document's "Report Date" from the title, header, or publication date. Any specific dates mentioned in the document that occurred BEFORE the Report Date are HISTORICAL references — do NOT include them as actionable scenarios or targets. For example, if the Report Date is Jan 12 and the text says "retest 6920 as early as Jan 5th," that is a PAST event from the review section, not a future target. Only include dates that are on or after the Report Date, or dates explicitly labeled as "Upcoming" or "Next."

## CANDLESTICK PATTERN DETECTION

Scan the document for mentions of specific technical chart patterns. These include but are not limited to:
- **Reversal Patterns**: Star Reversal, Evening Star, Morning Star, Doji Star, Hammer, Inverted Hammer, Engulfing Pattern, Harami
- **Continuation/Structure Patterns**: Double Top, Double Bottom, Head & Shoulders, Inside Day, Inside Week, Outside Day
- **Volume Patterns**: Spike Reversal, Exhaustion Gap, Island Reversal

When ANY of these patterns are mentioned by the author, extract them as a PRIMARY "risk_factor" in the shared.risk_factors array. Format: "[Pattern Name] — [author's exact warning or context]". For example: "4-Day Star Reversal Pattern — author warns 'be very mindful of the potential star reversal pattern that could form.'"

These pattern warnings OVERRIDE individual price levels in importance — if the pattern completes, the directional levels may become unreliable.

## STRICT SOURCE ADHERENCE (Zero Hallucination Policy)

**DO NOT include ANY geopolitical events, macro events, country names, political figures, or conflicts that are NOT explicitly written in the uploaded document.** If the document says "Geopolitical risk" without specifying details, your risk_factor must say exactly "Geopolitical risk" — do NOT elaborate with specific countries, invasions, tariffs, sanctions, or political events from your training data.

Rules:
1. If the document mentions a vague risk (e.g., "geopolitical risk," "trade tensions"), quote it EXACTLY as written — never expand or specify
2. Never infer or add specific events (wars, elections, policy changes) that are not explicitly stated in the document
3. If unsure whether something is explicitly in the document or from your own knowledge, OMIT it entirely
4. Every risk_factor, key_event, and macro_clock entry MUST be directly traceable to specific text in the uploaded document

## MATH LABELING PRECISION

"Point Reductions" and "Control Ratios" are DIFFERENT mathematical concepts and MUST be kept as separate strategy_rules entries:

- **Point Reductions**: A reduction in the TARGET price range (e.g., "8-13 point reductions" means the expected move target shrinks by 8-13 points). These describe how far price might travel.
- **Control Ratios**: A fixed mathematical relationship used to measure distance from key levels (e.g., "30-34 point control ratio" means if price is 30-34 points above/below a level, it is considered at its mathematical boundary). These describe spatial relationships between levels.

Do NOT conflate these two concepts. If a document mentions BOTH "30-34 point control ratios" and "8 point reductions," create TWO separate strategy_rules entries with distinct labels and descriptions. Mixing them could lead a trader to the wrong target.

## CRITICAL RULES
1. Extract EVERY price level — text AND chart annotations across ALL files
2. Use ONLY data from uploaded documents. NEVER use your own market knowledge.
3. Quote the author's exact language wherever possible
4. Every level MUST have provenance (the "why" / historical origin)
5. The JSON must be parseable — no trailing commas, no comments
6. Return ONLY the JSON object, nothing else
7. COMPLETE the entire JSON — never stop mid-output. If the document is very large, prioritize the most important levels and scenarios rather than truncating
8. NEVER populate Zones, Levels, or Scenarios from historical/review sections — only from forward-looking plan sections
9. NEVER fabricate geopolitical events — only include what is explicitly written in the document
10. Keep Point Reductions and Control Ratios as SEPARATE strategy_rules entries`;

      const PLAYBOOK_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"];
      let activeModelName = PLAYBOOK_MODELS[0];
      let model = genAI.getGenerativeModel({
        model: activeModelName,
        systemInstruction: playbookSystemPrompt,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 65536,
          responseMimeType: "application/json",
        },
      });

      const parts: any[] = [];

      const fileUploadResults = await Promise.allSettled(
        uploadedFiles.map(async (uploadedFile) => {
          const mimeType = inferMimeType(uploadedFile.originalname, uploadedFile.mimetype);
          try {
            const uploadResult = await fileManager.uploadFile(uploadedFile.path, {
              mimeType,
              displayName: uploadedFile.originalname,
            });

            let file = uploadResult.file;
            let attempts = 0;
            while (file.state === FileState.PROCESSING && attempts < 60) {
              await new Promise((resolve) => setTimeout(resolve, 2000));
              const result = await fileManager.getFile(file.name);
              file = result;
              attempts++;
            }

            if (file.state === FileState.ACTIVE) {
              return { data: { fileData: { mimeType: file.mimeType, fileUri: file.uri } } };
            }
            throw new Error(`File ${uploadedFile.originalname} in state: ${file.state}`);
          } catch (uploadErr: any) {
            console.warn(`Gemini upload failed for ${uploadedFile.originalname}, trying fallback:`, uploadErr?.message);
            if (mimeType.startsWith("image/")) {
              const imageData = fs.readFileSync(uploadedFile.path);
              return { data: { inlineData: { mimeType, data: imageData.toString("base64") } } };
            }
            const fileContent = await extractTextFromFile(uploadedFile.path, mimeType);
            if (fileContent) {
              return { data: { text: `[Document content from "${uploadedFile.originalname}"]:\n\n${fileContent}` } };
            }
            throw uploadErr;
          }
        })
      );

      let successCount = 0;
      for (const result of fileUploadResults) {
        if (result.status === "fulfilled") {
          parts.push(result.value.data);
          successCount++;
        }
      }
      if (successCount === 0) {
        await storage.createChatMessage({ userId, tickerId, role: "assistant", content: `⚠️ **File Processing Failed**\n\nCouldn't process the uploaded file(s): ${originalFilename}\n\nThe files may be corrupted or in an unsupported format.\n\n**Try:** Re-upload the file, convert PDFs to images, or ensure files are under 10MB.\n\n_Supported formats: PDF, PNG, JPG, CSV_` });
        return res.status(500).json({ message: "Failed to process all uploaded files. Please try different file formats (PDF, PNG, JPG, CSV)." });
      }
      for (const path of tempFilePaths) {
        try { fs.unlinkSync(path); } catch {}
      }

      parts.push({ text: userMessage || `Analyze this document and extract a complete trading playbook for ${ticker.symbol}. Return ONLY the JSON structure.` });

      const sanitizeAndParseJSON = (raw: string): any => {
        let text = raw.trim();
        text = text.replace(/```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```/g, "$1");
        text = text.trim();

        const tryParse = (s: string): any => {
          s = s.replace(/,\s*([}\]])/g, "$1");
          s = s.replace(/[\x00-\x1F\x7F]/g, (ch) => ch === '\n' || ch === '\r' || ch === '\t' ? ch : '');
          return JSON.parse(s);
        };

        try { return tryParse(text); } catch {}

        const firstBrace = text.indexOf("{");
        const lastBrace = text.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          const extracted = text.substring(firstBrace, lastBrace + 1);
          try { return tryParse(extracted); } catch {}
        }

        const codeBlockMatch = text.match(/```[\s\S]*?```/);
        if (codeBlockMatch) {
          const inner = codeBlockMatch[0].replace(/```\w*\s*/, "").replace(/```$/, "").trim();
          try { return tryParse(inner); } catch {}
        }

        return null;
      };

      const repairTruncatedJSON = (raw: string): any => {
        let text = raw.trim();
        text = text.replace(/```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```/g, "$1").trim();

        const firstBrace = text.indexOf("{");
        if (firstBrace === -1) return null;
        text = text.substring(firstBrace);

        text = text.replace(/,\s*([}\]])/g, "$1");
        text = text.replace(/[\x00-\x1F\x7F]/g, (ch) => ch === '\n' || ch === '\r' || ch === '\t' ? ch : '');

        let openBraces = 0, openBrackets = 0;
        let inString = false, escape = false;
        let lastValidEnd = -1;

        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (escape) { escape = false; continue; }
          if (ch === '\\' && inString) { escape = true; continue; }
          if (ch === '"') { inString = !inString; continue; }
          if (inString) continue;
          if (ch === '{') openBraces++;
          if (ch === '}') { openBraces--; if (openBraces === 0 && openBrackets === 0) { lastValidEnd = i; break; } }
          if (ch === '[') openBrackets++;
          if (ch === ']') openBrackets--;
        }

        if (lastValidEnd > 0) {
          try { return JSON.parse(text.substring(0, lastValidEnd + 1)); } catch {}
        }

        let truncated = text;
        if (inString) truncated += '"';
        truncated = truncated.replace(/,\s*$/, '');
        while (openBrackets > 0) { truncated += ']'; openBrackets--; }
        while (openBraces > 0) { truncated += '}'; openBraces--; }
        truncated = truncated.replace(/,\s*([}\]])/g, "$1");

        try { return JSON.parse(truncated); } catch {}

        const keyFields = ["metadata", "thesis", "levels", "scenarios"];
        for (const field of keyFields.reverse()) {
          const fieldIdx = truncated.lastIndexOf(`"${field}"`);
          if (fieldIdx > 0) {
            let candidate = truncated.substring(0, fieldIdx).replace(/,\s*$/, '');
            let ob = 0, obk = 0;
            for (const c of candidate) { if (c === '{') ob++; if (c === '}') ob--; if (c === '[') obk++; if (c === ']') obk--; }
            while (obk > 0) { candidate += ']'; obk--; }
            while (ob > 0) { candidate += '}'; ob--; }
            try { return JSON.parse(candidate); } catch {}
          }
        }

        return null;
      };

      let rawText = "";
      let playbookData: any = null;
      let modelAttemptIndex = 0;
      let totalAttempts = 0;
      const MAX_ATTEMPTS_PER_MODEL = 2;
      const MAX_TOTAL_ATTEMPTS = PLAYBOOK_MODELS.length * MAX_ATTEMPTS_PER_MODEL;
      let modelAttemptsInCurrent = 0;

      for (totalAttempts = 1; totalAttempts <= MAX_TOTAL_ATTEMPTS; totalAttempts++) {
        try {
          const result = await model.generateContent({ contents: [{ role: "user", parts }] });
          const finishReason = result.response.candidates?.[0]?.finishReason;
          rawText = result.response.text();
          console.log(`---- RAW AI RESPONSE START (model=${activeModelName}, attempt ${totalAttempts}, finishReason=${finishReason}) ----`);
          console.log(rawText.slice(0, 500));
          console.log(`---- RAW AI RESPONSE END (${rawText.length} chars) ----`);

          if (finishReason === "MAX_TOKENS") {
            console.warn(`Response truncated by token limit on attempt ${totalAttempts}. Attempting repair...`);
            playbookData = repairTruncatedJSON(rawText);
            if (playbookData) {
              console.log("Truncated response repaired successfully.");
              break;
            }
          }

          playbookData = sanitizeAndParseJSON(rawText);
          if (playbookData) break;

          if (finishReason === "STOP" && rawText.length > 1000) {
            console.warn(`finishReason=STOP but JSON parse failed (${rawText.length} chars). Attempting truncated repair...`);
            playbookData = repairTruncatedJSON(rawText);
            if (playbookData) {
              console.log("STOP-truncated response repaired successfully.");
              break;
            }
          }

          console.error(`JSON Parse Error Location: model=${activeModelName}, attempt ${totalAttempts}, finishReason=${finishReason}, raw length=${rawText.length}, first 200 chars: ${rawText.slice(0, 200)}`);

          if (totalAttempts < MAX_TOTAL_ATTEMPTS) {
            const delay = Math.pow(2, modelAttemptsInCurrent) * 1000;
            console.log(`Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            modelAttemptsInCurrent++;
          }
        } catch (apiErr: any) {
          const status = apiErr?.status || apiErr?.httpStatusCode;
          const errMsg = String(apiErr?.message || "");
          const isOverloaded = status === 503 || status === 429 || errMsg.includes("503") || errMsg.includes("429") || errMsg.includes("Service Unavailable") || errMsg.includes("overloaded");
          console.error(`Gemini API error (model=${activeModelName}, attempt ${totalAttempts}):`, apiErr?.message || apiErr);

          if (isOverloaded) {
            modelAttemptsInCurrent++;
            if (modelAttemptsInCurrent >= MAX_ATTEMPTS_PER_MODEL && modelAttemptIndex < PLAYBOOK_MODELS.length - 1) {
              modelAttemptIndex++;
              activeModelName = PLAYBOOK_MODELS[modelAttemptIndex];
              modelAttemptsInCurrent = 0;
              console.log(`Switching to fallback model: ${activeModelName}`);
              model = genAI.getGenerativeModel({
                model: activeModelName,
                systemInstruction: playbookSystemPrompt,
                generationConfig: { temperature: 0.1, maxOutputTokens: 65536, responseMimeType: "application/json" },
              });
              await new Promise(r => setTimeout(r, 2000));
              continue;
            }
            if (totalAttempts < MAX_TOTAL_ATTEMPTS) {
              const delay = Math.pow(2, modelAttemptsInCurrent) * 1000;
              console.log(`Rate limited/overloaded (${status}). Retrying ${activeModelName} in ${delay}ms...`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
          }

          if (totalAttempts >= MAX_TOTAL_ATTEMPTS) {
            await storage.createChatMessage({ userId, tickerId, role: "assistant", content: `⚠️ **AI Service Busy**\n\nThe AI service is currently experiencing high traffic and couldn't process "${originalFilename}". This is temporary.\n\n**Try:** Use the retry button below to resubmit, or wait a minute and upload again.\n\n_Attempted models: ${PLAYBOOK_MODELS.slice(0, modelAttemptIndex + 1).join(" → ")}_` });
            return res.status(503).json({ message: "AI service is currently busy. Please try again in a moment." });
          }
        }
      }

      if (!playbookData && rawText) {
        console.warn("All standard JSON parse attempts failed. Attempting truncated JSON repair...");
        playbookData = repairTruncatedJSON(rawText);
        if (playbookData) {
          console.log("Truncated JSON repair succeeded — partial playbook recovered.");
        } else {
          console.error("JSON repair also failed. Returning error to user.");
          console.error("Last raw response (first 1000 chars):", rawText.slice(0, 1000));
          console.error("Last raw response (last 500 chars):", rawText.slice(-500));
          await storage.createChatMessage({ userId, tickerId, role: "assistant", content: `⚠️ **Playbook Generation Failed**\n\nThe AI couldn't generate a complete playbook for "${originalFilename}". The document may be too complex or contain too much data for a single analysis.\n\n**Try:**\n• Use the retry button to try again (AI responses can vary)\n• Upload just the ES or NQ section separately\n• Convert the PDF to images for better processing` });
          return res.status(500).json({ 
            message: `The AI couldn't generate a complete playbook for this document. The file "${originalFilename}" may be too complex or contain too much data for a single analysis. Try uploading just the ES or NQ section separately.`
          });
        }
      }

      if (!playbookData || typeof playbookData !== "object") {
        await storage.createChatMessage({ userId, tickerId, role: "assistant", content: `⚠️ **Invalid AI Response**\n\nThe AI returned an unexpected format for "${originalFilename}". This sometimes happens with unusual document layouts.\n\n**Try:** Use the retry button — results often improve on a second attempt.` });
        return res.status(500).json({ message: "AI returned invalid data structure. Please try again." });
      }

      const normalizeSymbol = (sym: string): string => {
        const s = sym.toUpperCase().replace(/[!]/g, "");
        if (s === "ES1" || s === "ES" || s.includes("S&P")) return "ES";
        if (s === "NQ1" || s === "NQ" || s.includes("NASDAQ")) return "NQ";
        return s;
      };
      const primarySymbol = normalizeSymbol(ticker.symbol);

      if (playbookData.instruments && typeof playbookData.instruments === "object") {
        const normalizedInstruments: Record<string, any> = {};
        for (const [key, val] of Object.entries(playbookData.instruments)) {
          normalizedInstruments[normalizeSymbol(key)] = val;
        }
        playbookData.instruments = normalizedInstruments;

        for (const [sym, instrData] of Object.entries(playbookData.instruments) as [string, any][]) {
          if (!instrData.levels) instrData.levels = [];
          if (!instrData.scenarios) instrData.scenarios = [];
          if (!instrData.execution_checklist) instrData.execution_checklist = [];
          if (!instrData.thesis || typeof instrData.thesis === "string") {
            const t = typeof instrData.thesis === "string" ? instrData.thesis : "";
            instrData.thesis = { bias: instrData.bias || "Open", summary: t };
          }
          if (!instrData.bias) instrData.bias = instrData.thesis?.bias || "Open";
          if (!instrData.macro_theme) instrData.macro_theme = "";
        }

        if (!playbookData.shared) playbookData.shared = {};
        if (!playbookData.shared.macro_clock) playbookData.shared.macro_clock = playbookData.macro_clock || [];
        if (!playbookData.shared.key_events) playbookData.shared.key_events = playbookData.key_events || [];
        if (!playbookData.shared.risk_factors) playbookData.shared.risk_factors = playbookData.risk_factors || [];

        const primary = playbookData.instruments[primarySymbol] || Object.values(playbookData.instruments)[0] || {};
        if (!playbookData.bias) playbookData.bias = primary.bias || "Open";
        if (!playbookData.thesis) playbookData.thesis = primary.thesis || { bias: "Open", summary: "" };
        if (!playbookData.macro_theme) playbookData.macro_theme = primary.macro_theme || "";

        if (!playbookData.levels || !Array.isArray(playbookData.levels) || playbookData.levels.length === 0) {
          const allLevels: any[] = [];
          for (const [sym, instrData] of Object.entries(playbookData.instruments) as [string, any][]) {
            for (const l of (instrData.levels || [])) {
              allLevels.push({ ...l, instrument: sym });
            }
          }
          playbookData.levels = allLevels;
        }
        if (!playbookData.scenarios || !Array.isArray(playbookData.scenarios) || playbookData.scenarios.length === 0) {
          const allScenarios: any[] = [];
          for (const [sym, instrData] of Object.entries(playbookData.instruments) as [string, any][]) {
            for (const s of (instrData.scenarios || [])) {
              allScenarios.push({ ...s, instrument: sym });
            }
          }
          playbookData.scenarios = allScenarios;
        }
      } else {
        playbookData.instruments = null;
      }

      if (!playbookData.structural_zones) {
        playbookData.structural_zones = { bullish_green: [], neutral_yellow: [], bearish_red: [] };
      }
      if (!playbookData.if_then_scenarios) playbookData.if_then_scenarios = [];
      if (!playbookData.key_events) playbookData.key_events = playbookData.shared?.key_events || [];
      if (!playbookData.risk_factors) playbookData.risk_factors = playbookData.shared?.risk_factors || [];
      if (!playbookData.execution_checklist) playbookData.execution_checklist = [];
      if (!playbookData.levels) playbookData.levels = [];
      if (!playbookData.scenarios) playbookData.scenarios = [];
      if (!playbookData.macro_clock) playbookData.macro_clock = playbookData.shared?.macro_clock || [];
      if (!playbookData.metadata) {
        playbookData.metadata = { author: "Unknown", report_title: originalFilename, target_horizon: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }), horizon_type: "Daily" };
      }
      if (!playbookData.thesis || typeof playbookData.thesis === "string") {
        const thesisText = typeof playbookData.thesis === "string" ? playbookData.thesis : "";
        playbookData.thesis = { bias: playbookData.bias || "Open", summary: thesisText };
      }

      const meta = playbookData.metadata;
      const author = meta.author || "Unknown";
      const horizonType = meta.horizon_type || "Daily";
      const today = new Date().toISOString().split("T")[0];
      const targetDateStart = parseTargetDate(meta.target_horizon) || today;
      const targetDateEnd = horizonType === "Weekly" ? getEndOfWeek(targetDateStart) : targetDateStart;

      const existingPlaybook = await storage.getPlaybookByTargetDate(tickerId, userId, targetDateStart, horizonType);
      let playbook;
      let isUpdate = false;

      if (existingPlaybook) {
        isUpdate = true;
        const existingData = existingPlaybook.playbookData as any;
        const tacticalUpdates = Array.isArray(existingData.tactical_updates) ? existingData.tactical_updates : [];
        tacticalUpdates.push({
          timestamp: new Date().toISOString(),
          source: originalFilename,
          author: author,
          addedLevels: playbookData.levels || [],
          addedScenarios: playbookData.scenarios || [],
          note: userMessage || `Updated from ${originalFilename}`,
        });

        const mergedLevels = [...(existingData.levels || [])];
        for (const newLevel of (playbookData.levels || [])) {
          const duplicate = mergedLevels.find((l: any) => l.price === newLevel.price && l.zone === newLevel.zone);
          if (duplicate) {
            duplicate.context = `${duplicate.context} | HIGH CONFIDENCE — confirmed by ${author}`;
            if (!duplicate.source.includes(author)) duplicate.source = `${duplicate.source} + ${author}`;
          } else {
            mergedLevels.push(newLevel);
          }
        }

        const mergedScenarios = [...(existingData.scenarios || [])];
        for (const newScen of (playbookData.scenarios || [])) {
          const dup = mergedScenarios.find((s: any) =>
            s.if === newScen.if && s.then === newScen.then && s.plan_type === newScen.plan_type
          );
          if (!dup) mergedScenarios.push(newScen);
        }

        const mergedGreen = [...(existingData.structural_zones?.bullish_green || [])];
        const mergedYellow = [...(existingData.structural_zones?.neutral_yellow || [])];
        const mergedRed = [...(existingData.structural_zones?.bearish_red || [])];
        for (const l of (playbookData.structural_zones?.bullish_green || [])) {
          if (!mergedGreen.find((e: any) => e.price === l.price)) mergedGreen.push(l);
        }
        for (const l of (playbookData.structural_zones?.neutral_yellow || [])) {
          if (!mergedYellow.find((e: any) => e.price === l.price)) mergedYellow.push(l);
        }
        for (const l of (playbookData.structural_zones?.bearish_red || [])) {
          if (!mergedRed.find((e: any) => e.price === l.price)) mergedRed.push(l);
        }

        const mergedIfThen = [...(existingData.if_then_scenarios || [])];
        for (const s of (playbookData.if_then_scenarios || [])) {
          const dup = mergedIfThen.find((e: any) =>
            e.condition === s.condition && e.outcome === s.outcome
          );
          if (!dup) mergedIfThen.push(s);
        }

        const mergedEvents = [...(existingData.key_events || [])];
        for (const e of (playbookData.key_events || [])) {
          if (!mergedEvents.find((ex: any) => ex.title === e.title)) mergedEvents.push(e);
        }

        const mergedData = {
          ...existingData,
          levels: mergedLevels,
          scenarios: mergedScenarios,
          structural_zones: { bullish_green: mergedGreen, neutral_yellow: mergedYellow, bearish_red: mergedRed },
          if_then_scenarios: mergedIfThen,
          key_events: mergedEvents,
          macro_clock: [...(existingData.macro_clock || []), ...(playbookData.macro_clock || []).filter((mc: any) => !(existingData.macro_clock || []).find((e: any) => e.event === mc.event))],
          risk_factors: Array.from(new Set([...(existingData.risk_factors || []), ...(playbookData.risk_factors || [])])),
          execution_checklist: Array.from(new Set([...(existingData.execution_checklist || []), ...(playbookData.execution_checklist || [])])),
          tactical_updates: tacticalUpdates,
          metadata: {
            ...existingData.metadata,
            author: existingData.metadata?.author?.includes(author) ? existingData.metadata.author : `${existingData.metadata?.author || "Unknown"} + ${author}`,
          },
        };

        playbook = await storage.updatePlaybook(existingPlaybook.id, userId, { playbookData: mergedData });
      } else {
        playbookData.tactical_updates = [];
        playbook = await storage.createPlaybook({
          userId,
          tickerId,
          date: today,
          author,
          horizonType,
          targetDateStart,
          targetDateEnd,
          playbookData,
        });
      }

      const thesisSummary = typeof playbookData.thesis === "object" ? playbookData.thesis.summary : playbookData.thesis;
      await storage.createChatMessage({
        userId,
        tickerId,
        role: "assistant",
        content: `**Trading Playbook ${isUpdate ? "Updated" : "Generated"}** (${author})\n\n**Horizon:** ${meta.target_horizon || "Today"} (${horizonType})\n**Macro Theme:** ${playbookData.macro_theme || "N/A"}\n**Bias:** ${playbookData.bias || playbookData.thesis?.bias || "Open"}\n\n${thesisSummary || "See playbook for details."}\n\n_${isUpdate ? "New insights merged into existing playbook." : "View the full interactive playbook in the dashboard above."}_`,
      });

      res.status(isUpdate ? 200 : 201).json(playbook);
    } catch (err: any) {
      console.error("Analyze document error:", err);
      try {
        const userId = getUserId(res);
        const tickerIdRaw = parseInt(req.body.tickerId as string);
        if (!isNaN(tickerIdRaw)) {
          await storage.createChatMessage({ userId, tickerId: tickerIdRaw, role: "assistant", content: `⚠️ **Processing Error**\n\nSomething went wrong while analyzing the document.\n\n**Error:** ${err.message || "Unknown error"}\n\n**Try:** Use the retry button to resubmit the document.` });
        }
      } catch {}
      res.status(500).json({ message: err.message || "Failed to analyze document" });
    } finally {
      for (const path of tempFilePaths) {
        try { fs.unlinkSync(path); } catch {}
      }
    }
  });

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

      await storage.saveWorkspace(userId, [btc.id, es.id, nq.id], btc.id);

      res.json({ message: "Data seeded successfully", userId });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/seed-reports/:tickerId", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(res);
      const tickerId = parseInt(req.params.tickerId as string);
      const ticker = await storage.getTicker(tickerId, userId);
      if (!ticker) return res.status(404).json({ message: "Ticker not found" });

      const reports = [
        { title: "Market Analysis and Trades for 2/2", date: "2026-02-02", horizon: "Daily" },
        { title: "Market Analysis and Trades for 2/3", date: "2026-02-03", horizon: "Daily" },
        { title: "Market Analysis and Trades for 2/4", date: "2026-02-04", horizon: "Daily" },
        { title: "Market Analysis and Trades for 2/5", date: "2026-02-05", horizon: "Daily" },
        { title: "Market Analysis and Trades for 2/6", date: "2026-02-06", horizon: "Daily" },
        { title: "Market Analysis and Trades for 2/9", date: "2026-02-09", horizon: "Daily" },
        { title: "Market Analysis and Trades for 2/10", date: "2026-02-10", horizon: "Daily" },
        { title: "Market Analysis and Trades for 2/11", date: "2026-02-11", horizon: "Daily" },
        { title: "Market Analysis and Trades for 2/12", date: "2026-02-12", horizon: "Daily" },
        { title: "Market Analysis and Trades for 2/13", date: "2026-02-13", horizon: "Daily" },
        { title: "Market Analysis for The Week of 2/15", date: "2026-02-15", horizon: "Weekly", endDate: "2026-02-21" },
        { title: "Market Analysis and Trades for 2/16-2/17", date: "2026-02-16", horizon: "Daily" },
        { title: "Market Analysis and Trades for 2/18", date: "2026-02-18", horizon: "Daily" },
        { title: "Market Analysis and Trades for 2/19", date: "2026-02-19", horizon: "Daily" },
        { title: "Market Analysis and Trades for 2/20", date: "2026-02-20", horizon: "Daily" },
        { title: "Market Analysis and Trades for 2/23", date: "2026-02-23", horizon: "Daily" },
        { title: "Market Analysis and Trades for 2/24", date: "2026-02-24", horizon: "Daily" },
        { title: "Market Analysis and Trades for 2/25", date: "2026-02-25", horizon: "Daily" },
        { title: "Market Analysis for The Week of 3/8", date: "2026-03-08", horizon: "Weekly", endDate: "2026-03-14" },
        { title: "Market Analysis and Trades for 3/9", date: "2026-03-09", horizon: "Daily" },
      ];

      const created: any[] = [];
      for (const report of reports) {
        const existing = await storage.getPlaybookByTargetDate(tickerId, userId, report.date, report.horizon);
        if (existing) continue;

        const createdDate = new Date(report.date + "T12:00:00-05:00");
        const pb = await storage.createPlaybook({
          userId,
          tickerId,
          date: report.date,
          author: "PharmD_KS",
          horizonType: report.horizon,
          targetDateStart: report.date,
          targetDateEnd: (report as any).endDate || report.date,
          playbookData: {
            bias: "Open",
            thesis: { bias: "Open", summary: `Awaiting full analysis — upload the PDF "${report.title}" to generate the complete playbook.` },
            macro_theme: report.title,
            metadata: {
              author: "PharmD_KS",
              report_title: report.title,
              target_horizon: report.date,
              horizon_type: report.horizon,
            },
            structural_zones: { bullish_green: [], neutral_yellow: [], bearish_red: [] },
            if_then_scenarios: [],
            levels: [],
            scenarios: [],
            key_events: [],
            risk_factors: [],
            execution_checklist: [],
            macro_clock: [],
            tactical_updates: [],
          },
        });
        created.push({ id: pb.id, title: report.title, horizon: report.horizon, date: report.date });
      }

      res.json({ message: `Seeded ${created.length} reports`, created });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Journal Entries ──────────────────────────────────────────────

  app.get("/api/tickers/:tickerId/journal", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const tickerId = parseInt(req.params.tickerId as string);
    const entries = await storage.getJournalEntries(tickerId, userId);
    res.json(entries);
  });

  app.post("/api/tickers/:tickerId/journal", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(res);
      const tickerId = parseInt(req.params.tickerId as string);
      const { content, sourceMessageId } = req.body;
      if (!content || typeof content !== "string") {
        return res.status(400).json({ message: "content is required" });
      }
      const entry = await storage.createJournalEntry({
        userId,
        tickerId,
        date: new Date().toISOString().split("T")[0],
        content,
        sourceMessageId: sourceMessageId || null,
      });
      res.status(201).json(entry);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/journal/:id", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const id = parseInt(req.params.id as string);
    await storage.deleteJournalEntry(id, userId);
    res.json({ success: true });
  });

  // ─── Tactical Chat (Action Dashboard) ─────────────────────────────

  app.post("/api/tickers/:tickerId/tactical-chat", isAuthenticated, upload.array("files", 10), async (req, res) => {
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];
    const tempFilePaths = uploadedFiles.map(f => f.path);
    try {
      const userId = getUserId(res);
      const tickerId = parseInt(req.params.tickerId as string);
      const content = typeof req.body.content === "string" ? req.body.content.trim() : "";

      const ticker = await storage.getTicker(tickerId, userId);
      if (!ticker) return res.status(404).json({ message: "Ticker not found" });

      const currentMarketDate = getMarketDate();
      const contextStack = await storage.getPlaybookContextStack(tickerId, userId, currentMarketDate);

      const formatLevel = (level: any): string => {
        const price = level.price ?? level.level ?? "?";
        const label = level.label || level.name || "";
        const author = level.author_initials || "";
        const sources = Array.isArray(level.sources) ? level.sources : [];
        const isConfluence = level.is_confluence === true;

        const priceHigh = level.price_high || level.priceHigh || "";
        let line = `  • ${price}${priceHigh ? `–${priceHigh}` : ""}`;
        if (label) line += ` — "${label}"`;
        if (author) line += ` [${author}]`;
        if (isConfluence && sources.length > 0) line += ` ⚡ CONFLUENCE (${sources.join(" + ")})`;
        else if (isConfluence) line += ` ⚡ CONFLUENCE`;
        else if (sources.length > 0) line += ` (Source: ${sources.join(", ")})`;
        if (level.rationale) line += ` — ${level.rationale}`;
        return line;
      };

      const formatZone = (levels: any[]): string => {
        if (!levels || levels.length === 0) return "  (none)";
        return levels.map(formatLevel).join("\n");
      };

      const formatScenario = (s: any): string => {
        const author = s.author_initials ? ` [${s.author_initials}]` : "";
        const confluence = s.is_confluence ? " ⚡ CONFLUENCE" : "";
        const sources = Array.isArray(s.sources) && s.sources.length > 0 ? ` (${s.sources.join(" + ")})` : "";
        return `- IF: ${s.condition || "N/A"}${author}${confluence}${sources}\n  THEN: ${s.outcome || "N/A"}`;
      };

      const formatFullPlaybook = (pb: any, label: string): string => {
        const pbData = pb.playbookData as any;
        const thesisText = pbData.thesis
          ? (typeof pbData.thesis === "object" ? (pbData.thesis.summary || JSON.stringify(pbData.thesis)) : String(pbData.thesis))
          : "N/A";
        return `## ${label} PLAYBOOK (${pb.date})
Horizon: ${pb.horizonType || "Daily"}
Bias: ${pbData.bias || "Open"}
Macro Theme: ${pbData.macro_theme || "N/A"}
Thesis: ${thesisText}

### Structural Zones (with provenance):
GREEN (Bullish):
${formatZone(pbData.structural_zones?.bullish_green)}
YELLOW (Neutral):
${formatZone(pbData.structural_zones?.neutral_yellow)}
RED (Bearish):
${formatZone(pbData.structural_zones?.bearish_red)}

### If/Then Scenarios (with provenance):
${(pbData.if_then_scenarios || []).map(formatScenario).join("\n")}

### Key Events:
${(pbData.key_events || []).map((e: any) => `- ${e.title} at ${e.time} (${e.impact})`).join("\n")}`;
      };

      const formatSummaryPlaybook = (pb: any, label: string): string => {
        const pbData = pb.playbookData as any;
        const thesisText = pbData.thesis
          ? (typeof pbData.thesis === "object" ? (pbData.thesis.summary || JSON.stringify(pbData.thesis)) : String(pbData.thesis))
          : "N/A";
        let out = `## ${label} PLAYBOOK (${pb.date})
Horizon: ${pb.horizonType || "Weekly"}
Bias: ${pbData.bias || "Open"}
Macro Theme: ${pbData.macro_theme || "N/A"}
Thesis: ${String(thesisText).slice(0, 500)}`;
        if (pbData.structural_zones) {
          const green = pbData.structural_zones.bullish_green || [];
          const yellow = pbData.structural_zones.neutral_yellow || [];
          const red = pbData.structural_zones.bearish_red || [];
          if (green.length > 0) out += `\nWeekly GREEN Levels: ${green.map((l: any) => `${l.price} (${l.label || ""})`).join(", ")}`;
          if (yellow.length > 0) out += `\nWeekly YELLOW Levels: ${yellow.map((l: any) => `${l.price} (${l.label || ""})`).join(", ")}`;
          if (red.length > 0) out += `\nWeekly RED Levels: ${red.map((l: any) => `${l.price} (${l.label || ""})`).join(", ")}`;
        }
        return out;
      };

      let playbookContext = `Current Market Date: ${currentMarketDate}\n\n`;
      if (contextStack.daily) {
        playbookContext += formatFullPlaybook(contextStack.daily, "DAILY") + "\n\n";
      }
      if (contextStack.weekly) {
        playbookContext += formatSummaryPlaybook(contextStack.weekly, "WEEKLY") + "\n\n";
      }
      if (contextStack.monthly) {
        const monthData = contextStack.monthly.playbookData as any;
        playbookContext += `## MONTHLY PLAYBOOK (${contextStack.monthly.date})
Bias: ${monthData.bias || "Open"}
Macro Theme: ${monthData.macro_theme || "N/A"}\n\n`;
      }
      if (!contextStack.daily && !contextStack.weekly && !contextStack.monthly) {
        playbookContext += "No active playbooks available for today's date.\n";
      }

      const tacticalPrompt = `You are a Tactical Trading Assistant for ${ticker.symbol} in the Action Dashboard. Today's market date is ${currentMarketDate} (New York time). You provide real-time execution guidance during live trading sessions.

## CONTEXT STACK — PLAYBOOK HIERARCHY

You have a "Context Stack" of playbooks: [Daily], [Weekly], and [Monthly]. Use them according to these priority rules:

- **Priority 1**: Always defer to the **Daily Playbook** for specific price levels and If/Then triggers during RTH. The Daily plan has the most granular, session-specific data.
- **Priority 2**: Use the **Weekly Playbook** to explain the "Big Picture" — e.g., if we are in a 4-day balance, what the weekly directional bias is.
- **Priority 3**: Use the **Monthly Playbook** for macro context only.
- **Conflict Resolution**: If the Daily plan says "Neutral" but the Weekly says "Bullish," you MUST explain both: "While the weekly blueprint remains bullish, today's daily plan is neutral due to high-range chop." Never silently pick one.
- **Date Awareness**: Only reference playbooks that apply to today (${currentMarketDate}). Do NOT confuse dates or use expired data.

## YOUR ROLE
You are the trader's execution partner. When they drop a chart screenshot, you:
1. Identify the current price using Spatial OCR (read the Y-axis)
2. Cross-reference the price against the Active Playbook zones
3. Tell the trader which zone they're in (Green/Yellow/Red)
4. Match the current price to the most relevant If/Then scenario
5. Provide actionable guidance: "You are approaching X. The Playbook says Y. Watch for Z."

## TRADING GLOSSARY
- **LAAF**: Look Above And Fail (Bull Trap)
- **LBAF**: Look Below And Fail (Bear Trap)
- **IB**: Initial Balance (First 60m of trade)
- **Spike Base**: A technical level where a price "spike" began
- **POC**: Point of Control
- **VAH/VAL**: Value Area High / Low
- **ONH/ONL**: Overnight High / Low

## MULTI-FILE ANALYSIS
When multiple chart screenshots or files are uploaded simultaneously:
1. Compare prices across all charts — identify which timeframe each chart represents
2. Cross-reference levels visible across multiple charts for HIGH CONFIDENCE zones
3. If a Discord alert screenshot accompanies a chart, verify the alert levels against the chart
4. Synthesize a unified tactical assessment from all uploaded inputs

## SPATIAL OCR RULES
When a chart image is uploaded:
1. Read the Y-axis to find the exact current price
2. Do NOT assume or round — if it shows 6922, say 6922, not 6920
3. Identify any visible horizontal lines, trendlines, or annotations
4. Always prefer what you SEE in the chart over assumptions

## TACTICAL REASONING REFINEMENT: Bridging Plan to Action

### 1. Prioritize Labels over Numbers
When analyzing a chart, always look for the text labels next to the price (e.g., 'RTH Open + 48', 'Core Bot', 'POC'). Use these names in your summary so the user knows *which* part of the plan is active.
- WRONG: "Price is at resistance around 6,900.75"
- RIGHT: "Price is testing 6,900.75 (The RTH Open + 48 ratio). This level is key because staying below it keeps the market in a 'Volatility Crush' mode as PharmD mentioned."

### 2. Level Provenance
When referencing a price level from the playbook, ALWAYS include:
- The level's label/name if available (e.g., "RTH Open + 48")
- The author source (e.g., "as PharmD noted" or "from Izzy's analysis")
- Why it matters in the current context
- WRONG: "6,900.75 is resistance"
- RIGHT: "6,900.75 (RTH + 48 ratio) [PharmD] — this is the key resistance that defines whether bulls regain control"

### 3. Confluence Awareness
When a level is marked as ⚡ CONFLUENCE in the playbook, give it MAXIMUM emphasis:
- Lead with the confluence status: "This is a HIGH-CONFIDENCE level where multiple experts agree"
- Name the contributing authors: "Both Izzy and PharmD identified this zone"
- Confluence levels should be mentioned FIRST when multiple levels are nearby
- If the current price is near a confluence level, make it the HEADLINE of your response

### 4. Volume Analysis
If you see large red bars at a resistance level, explicitly mention 'Aggressive Selling Volume' to confirm the rejection. If you see large green bars at support, mention 'Aggressive Buying Volume'. Volume context validates whether a level is holding or breaking.
- Example: "The massive red volume spike at 10:00 AM when price touched 6,922 confirms aggressive selling — this validates the playbook's bearish rejection zone."

### 5. LAAF/LBAF Trap Warnings
On OPEX days (monthly options expiration, typically 3rd Friday), earnings days, or FOMC days, actively warn the user about fake-out risk:
- If price moves ABOVE a key resistance, warn: "This move above [level] might be a Fake-out (LAAF) unless a 15-minute candle closes and stays above it. Wait for confirmation."
- If price moves BELOW a key support, warn: "This move below [level] might be a Bear Trap (LBAF) unless a 15-minute candle closes below it."
- Check the Key Events section of the playbook for any scheduled events that increase trap risk.

## RESPONSE FORMAT
Keep responses concise and actionable for a live trading session:
- **Current Price**: [from chart]
- **Zone**: [Green/Yellow/Red based on playbook]
- **Active Scenario**: [matching If/Then from playbook, with author attribution]
- **Confluence Alert**: [if near a confluence level, highlight it prominently]
- **Guidance**: [1-2 sentences of actionable advice with level labels and author sources]

${playbookContext}`;

      const TACTICAL_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
      let tactModelIdx = 0;
      let tactModelName = TACTICAL_MODELS[0];
      let model = genAI.getGenerativeModel({
        model: tactModelName,
        systemInstruction: tacticalPrompt,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
        },
      });

      const parts: any[] = [];

      if (uploadedFiles.length > 0) {
        const fileUploadResults = await Promise.allSettled(
          uploadedFiles.map(async (uploadedFile) => {
            try {
              const mimeType = inferMimeType(uploadedFile.originalname, uploadedFile.mimetype);
              const uploadResult = await fileManager.uploadFile(uploadedFile.path, {
                mimeType,
                displayName: uploadedFile.originalname,
              });

              let file = uploadResult.file;
              let attempts = 0;
              while (file.state === FileState.PROCESSING && attempts < 60) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
                const result = await fileManager.getFile(file.name);
                file = result;
                attempts++;
              }

              if (file.state === FileState.ACTIVE) {
                return { data: { fileData: { mimeType: file.mimeType, fileUri: file.uri } } };
              }
              throw new Error(`File ${uploadedFile.originalname} in state: ${file.state}`);
            } catch (fileErr: any) {
              const chatMimeType = inferMimeType(uploadedFile.originalname, uploadedFile.mimetype);
              if (chatMimeType.startsWith("image/")) {
                const imageData = fs.readFileSync(uploadedFile.path);
                return { data: { inlineData: { mimeType: chatMimeType, data: imageData.toString("base64") } } };
              }
              const fileContent = await extractTextFromFile(uploadedFile.path, chatMimeType);
              if (fileContent) {
                return { data: { text: `[Document content]:\n\n${fileContent}` } };
              }
              throw fileErr;
            }
          })
        );

        for (const result of fileUploadResults) {
          if (result.status === "fulfilled") {
            parts.push(result.value.data);
          }
        }
      }

      const fileNames = uploadedFiles.map(f => f.originalname).join(", ");
      parts.push({ text: content || "Analyze this chart screenshot. What price am I at and what does the playbook say?" });

      const tacticalUserMsg = await storage.createChatMessage({ userId, tickerId, role: "user", content: content || (uploadedFiles.length > 0 ? `[${uploadedFiles.length} file${uploadedFiles.length > 1 ? "s" : ""}: ${fileNames}]` : "[Chart Screenshot uploaded]") });

      for (const uf of uploadedFiles) {
        const ufMime = inferMimeType(uf.originalname, uf.mimetype);
        if (ufMime.startsWith("image/")) {
          try {
            const uploadsDir = path.join(process.cwd(), "public", "uploads");
            if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
            const destName = `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(uf.originalname)}`;
            const destPath = path.join(uploadsDir, destName);
            fs.copyFileSync(uf.path, destPath);
            await storage.createUploadedImage({
              userId,
              tickerId,
              chatMessageId: tacticalUserMsg.id,
              originalFilename: uf.originalname,
              storedPath: `/uploads/${destName}`,
              mimeType: ufMime,
            });
          } catch (imgErr) {
            console.error("Image persistence error (non-fatal):", imgErr);
          }
        }
      }

      for (const tmpPath of tempFilePaths) {
        try { fs.unlinkSync(tmpPath); } catch {}
      }

      let aiText: string;
      let isFallback = false;

      const MAX_TACTICAL_RETRIES = 4;
      let lastTacticalErr: any = null;
      let tactRetryModelAttempts = 0;
      for (let attempt = 0; attempt < MAX_TACTICAL_RETRIES; attempt++) {
        try {
          const result = await model.generateContent({ contents: [{ role: "user", parts }] });
          aiText = result.response.text();
          lastTacticalErr = null;
          break;
        } catch (tacticalErr: any) {
          lastTacticalErr = tacticalErr;
          const status = tacticalErr?.status || tacticalErr?.httpStatusCode || tacticalErr?.code;
          const isRetryable = status === 503 || status === 429 || String(tacticalErr?.message || "").includes("503") || String(tacticalErr?.message || "").includes("429") || String(tacticalErr?.message || "").includes("Service Unavailable") || String(tacticalErr?.message || "").includes("overloaded");
          if (isRetryable) {
            tactRetryModelAttempts++;
            if (tactRetryModelAttempts >= 2 && tactModelIdx < TACTICAL_MODELS.length - 1) {
              tactModelIdx++;
              tactModelName = TACTICAL_MODELS[tactModelIdx];
              tactRetryModelAttempts = 0;
              console.log(`Tactical: switching to fallback model ${tactModelName}`);
              model = genAI.getGenerativeModel({
                model: tactModelName,
                systemInstruction: tacticalPrompt,
                generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
              });
              await new Promise(r => setTimeout(r, 2000));
              continue;
            }
            if (attempt < MAX_TACTICAL_RETRIES - 1) {
              const delay = Math.pow(2, attempt) * 1000;
              console.log(`Tactical API error (${status || "unknown"}, model=${tactModelName}). Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_TACTICAL_RETRIES})...`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
          }
          break;
        }
      }

      if (lastTacticalErr) {
        console.error("Tactical Gemini API error after retries:", lastTacticalErr);
        const dailyPb = contextStack.daily;
        if (dailyPb) {
          const pbData = dailyPb.playbookData as any;
          const levelsSummary: string[] = [];
          if (pbData?.structural_zones) {
            const zones = pbData.structural_zones;
            if (zones.bullish_green?.length) levelsSummary.push(...zones.bullish_green.slice(0, 3).map((l: any) => `🟢 ${l.price} (${l.label || "support"})`));
            if (zones.neutral_yellow?.length) levelsSummary.push(...zones.neutral_yellow.slice(0, 2).map((l: any) => `🟡 ${l.price} (${l.label || "neutral"})`));
            if (zones.bearish_red?.length) levelsSummary.push(...zones.bearish_red.slice(0, 3).map((l: any) => `🔴 ${l.price} (${l.label || "resistance"})`));
          }
          if (pbData?.levels?.length && levelsSummary.length === 0) {
            levelsSummary.push(...pbData.levels.slice(0, 5).map((l: any) => `${l.price} (${l.label || l.type || "level"})`));
          }
          aiText = `AI analysis engine is temporarily unavailable, but your **${ticker.symbol}** playbook levels are loaded:\n\n${levelsSummary.length > 0 ? levelsSummary.join("\n") : "No levels extracted yet."}\n\n**Try again** when the service recovers for full tactical analysis.`;
        } else {
          aiText = `AI analysis engine is temporarily unavailable for **${ticker.symbol}**. No daily playbook found for today. Upload a game plan first, then retry for tactical analysis.`;
        }
        isFallback = true;
      }

      const aiMsg = await storage.createChatMessage({ userId, tickerId, role: "assistant", content: aiText! });

      if (!isFallback && contextStack.daily) {
        try {
          const dailyData = contextStack.daily.playbookData as any;
          const tacticalUpdates = Array.isArray(dailyData.tactical_updates) ? [...dailyData.tactical_updates] : [];
          tacticalUpdates.push({
            timestamp: new Date().toISOString(),
            source: "Tactical Chat",
            author: "Tactical AI",
            addedLevels: [],
            addedScenarios: [],
            note: aiText!.slice(0, 500),
          });
          await storage.updatePlaybook(contextStack.daily.id, userId, {
            playbookData: { ...dailyData, tactical_updates: tacticalUpdates },
          });

          if (contextStack.weekly) {
            const weeklyData = contextStack.weekly.playbookData as any;
            const weeklyScenarios = weeklyData.if_then_scenarios || weeklyData.scenarios || [];
            const priceMatches = aiText!.match(/\b\d{4,5}(?:\.\d{1,2})?\b/g);
            if (priceMatches && weeklyScenarios.length > 0) {
              const weeklyUpdates = Array.isArray(weeklyData.tactical_updates) ? [...weeklyData.tactical_updates] : [];
              const summary = `${currentMarketDate} Tactical Update: ${aiText!.slice(0, 200)}`;
              weeklyUpdates.push({
                timestamp: new Date().toISOString(),
                source: "Tactical Chat (cross-write)",
                author: "Tactical AI",
                addedLevels: [],
                addedScenarios: [],
                note: summary,
              });
              await storage.updatePlaybook(contextStack.weekly.id, userId, {
                playbookData: { ...weeklyData, tactical_updates: weeklyUpdates },
              });
            }
          }

          if (contextStack.monthly) {
            const monthlyData = contextStack.monthly.playbookData as any;
            const mentionsYearly = /yearly|annual|all.time|macro.shift|monthly.pivot/i.test(aiText!);
            if (mentionsYearly) {
              const monthlyUpdates = Array.isArray(monthlyData.tactical_updates) ? [...monthlyData.tactical_updates] : [];
              monthlyUpdates.push({
                timestamp: new Date().toISOString(),
                source: "Tactical Chat (cross-write)",
                author: "Tactical AI",
                addedLevels: [],
                addedScenarios: [],
                note: `${currentMarketDate}: ${aiText!.slice(0, 200)}`,
              });
              await storage.updatePlaybook(contextStack.monthly.id, userId, {
                playbookData: { ...monthlyData, tactical_updates: monthlyUpdates },
              });
            }
          }
        } catch (tripleWriteErr) {
          console.error("Triple-write error (non-fatal):", tripleWriteErr);
        }
      }

      res.json({ userMessage: { role: "user", content }, aiMessage: aiMsg, fallback: isFallback });
    } catch (err: any) {
      console.error("Tactical chat error:", err);
      res.status(500).json({ message: err.message || "Tactical analysis failed" });
    } finally {
      for (const path of tempFilePaths) {
        try { fs.unlinkSync(path); } catch {}
      }
    }
  });

  // ─── Trading Diary ──────────────────────────────────────────
  const handleDiaryList = async (req: any, res: any) => {
    try {
      const userId = getUserId(res);
      const tickerId = parseInt(req.params.tickerId as string);
      if (isNaN(tickerId)) return res.status(400).json({ message: "Invalid ticker ID" });
      const entries = await storage.getDiaryEntries(tickerId, userId);
      res.json(entries);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  };

  app.get("/api/tickers/:tickerId/diary", isAuthenticated, handleDiaryList);

  app.get("/api/diary/entry/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(res);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid diary ID" });
      const entry = await storage.getDiaryEntry(id, userId);
      if (!entry) return res.status(404).json({ message: "Diary entry not found" });
      res.json(entry);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/diary/:tickerId", isAuthenticated, handleDiaryList);

  app.patch("/api/diary/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(res);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid diary ID" });
      const { userClosingThought, isFinalized } = req.body;
      const updates: any = {};
      if (userClosingThought !== undefined) updates.userClosingThought = userClosingThought;
      if (isFinalized !== undefined) updates.isFinalized = isFinalized;
      const updated = await storage.updateDiary(id, userId, updates);
      if (!updated) return res.status(404).json({ message: "Diary entry not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/diary/date-check/:tickerId/:date", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(res);
      const tickerId = parseInt(req.params.tickerId as string);
      const date = req.params.date as string;
      if (isNaN(tickerId)) return res.status(400).json({ message: "Invalid ticker ID" });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: "Invalid date format (YYYY-MM-DD)" });

      const contextStack = await storage.getPlaybookContextStack(tickerId, userId, date);
      const hasPlaybook = !!(contextStack.daily || contextStack.weekly || contextStack.monthly);

      const chatHistory = await storage.getChatMessagesByTicker(tickerId, userId);
      const hasChat = chatHistory.some(m => {
        if (!m.createdAt || m.role !== "user") return false;
        const msgNY = new Date(new Date(m.createdAt).toLocaleString("en-US", { timeZone: "America/New_York" }));
        const msgDateStr = `${msgNY.getFullYear()}-${String(msgNY.getMonth() + 1).padStart(2, "0")}-${String(msgNY.getDate()).padStart(2, "0")}`;
        return msgDateStr === date;
      });

      const existingEntry = await storage.getDiaryByDate(tickerId, userId, date);

      res.json({ hasPlaybook, hasChat, hasExistingEntry: !!existingEntry });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/diary/:tickerId/:date", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(res);
      const tickerId = parseInt(req.params.tickerId as string);
      const date = req.params.date as string;
      if (isNaN(tickerId)) return res.status(400).json({ message: "Invalid ticker ID" });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: "Invalid date format (YYYY-MM-DD)" });
      const entry = await storage.getDiaryByDate(tickerId, userId, date);
      if (!entry) return res.status(404).json({ message: "No diary entry for this date" });
      res.json(entry);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/diary/generate", isAuthenticated, upload.fields([
    { name: "daily_chart", maxCount: 1 },
    { name: "weekly_chart", maxCount: 1 },
    { name: "monthly_chart", maxCount: 1 },
  ]), async (req, res) => {
    try {
      const userId = getUserId(res);
      const tickerId = parseInt(req.body.tickerId);
      const date = req.body.date;
      if (!tickerId || !date) return res.status(400).json({ message: "tickerId and date are required" });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: "Invalid date format (YYYY-MM-DD)" });

      const ticker = await storage.getTicker(tickerId, userId);
      if (!ticker) return res.status(404).json({ message: "Ticker not found" });

      const existing = await storage.getDiaryByDate(tickerId, userId, date);
      if (existing) {
        return res.json(existing);
      }

      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const dailyChartFile = files?.daily_chart?.[0];
      const weeklyChartFile = files?.weekly_chart?.[0];
      const monthlyChartFile = files?.monthly_chart?.[0];

      const allowedMimes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
      const allChartFiles = [dailyChartFile, weeklyChartFile, monthlyChartFile].filter(Boolean) as Express.Multer.File[];
      for (const f of allChartFiles) {
        if (!allowedMimes.includes(f.mimetype)) {
          try { fs.unlinkSync(f.path); } catch {}
          return res.status(400).json({ message: `Invalid file type: ${f.mimetype}. Only image files are allowed.` });
        }
        const ext = path.extname(f.originalname).toLowerCase();
        if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) {
          try { fs.unlinkSync(f.path); } catch {}
          return res.status(400).json({ message: `Invalid file extension: ${ext}. Only image files are allowed.` });
        }
      }

      const contextStack = await storage.getPlaybookContextStack(tickerId, userId, date);
      const chatHistory = await storage.getChatMessagesByTicker(tickerId, userId);
      const dayMessagesForValidation = chatHistory.filter(m => {
        if (!m.createdAt) return false;
        const msgNY = new Date(new Date(m.createdAt).toLocaleString("en-US", { timeZone: "America/New_York" }));
        const msgDateStr = `${msgNY.getFullYear()}-${String(msgNY.getMonth() + 1).padStart(2, "0")}-${String(msgNY.getDate()).padStart(2, "0")}`;
        return msgDateStr === date;
      });

      const hasUserChatToday = dayMessagesForValidation.some(m => m.role === "user");

      const hasAnyChart = !!(dailyChartFile || weeklyChartFile || monthlyChartFile);
      if (!hasAnyChart && !hasUserChatToday) {
        return res.status(400).json({ message: "Either a closing chart or tactical chat history for the day is required to generate a diary." });
      }

      const persistChartFile = (file: Express.Multer.File): string => {
        const ext = path.extname(file.originalname) || ".png";
        const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}${ext}`;
        const destDir = path.join(process.cwd(), "public", "uploads");
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        const destPath = path.join(destDir, safeName);
        fs.copyFileSync(file.path, destPath);
        try { fs.unlinkSync(file.path); } catch {}
        return `/uploads/${safeName}`;
      };

      const dailyChartUrl = dailyChartFile ? persistChartFile(dailyChartFile) : null;
      const weeklyChartUrl = weeklyChartFile ? persistChartFile(weeklyChartFile) : null;
      const monthlyChartUrl = monthlyChartFile ? persistChartFile(monthlyChartFile) : null;

      const weeklyContextProvided = !!weeklyChartFile;
      const monthlyContextProvided = !!monthlyChartFile;

      const dayMessages = dayMessagesForValidation;

      const dayImages = await storage.getUploadedImagesByDate(tickerId, userId, date);

      const formatPlaybookForDiary = (pb: any, label: string) => {
        const data = pb.playbookData as any;
        let out = `\n## ${label} PLAYBOOK\n`;
        out += `Bias: ${data.bias || "Open"}\n`;
        out += `Macro Theme: ${data.macro_theme || "N/A"}\n`;
        if (data.thesis) {
          const thesisText = typeof data.thesis === "object" ? (data.thesis.summary || JSON.stringify(data.thesis)) : String(data.thesis);
          out += `Thesis: ${thesisText.slice(0, 800)}\n`;
        }
        if (data.structural_zones) {
          const allZones = [
            ...(data.structural_zones.bullish_green || []),
            ...(data.structural_zones.neutral_yellow || []),
            ...(data.structural_zones.bearish_red || []),
          ];
          if (allZones.length > 0) {
            out += `Key Levels: ${allZones.map((l: any) => `${l.price}${l.price_high ? `-${l.price_high}` : ""} (${l.label})`).join(", ")}\n`;
          }
        }
        if (data.if_then_scenarios?.length > 0) {
          out += `Scenarios:\n${data.if_then_scenarios.map((s: any) => `- ${s.condition} → ${s.outcome}`).join("\n")}\n`;
        }
        if (data.execution_checklist?.length > 0) {
          out += `Checklist: ${data.execution_checklist.join("; ")}\n`;
        }
        return out;
      };

      const pbFoundCount = [contextStack.daily, contextStack.weekly, contextStack.monthly].filter(Boolean).length;
      console.log(`[Diary] Context for ${date}: ${pbFoundCount} playbook(s) found (daily=${!!contextStack.daily}, weekly=${!!contextStack.weekly}, monthly=${!!contextStack.monthly}), ${dayMessages.length} chat message(s) for target date`);

      let contextInfo = `Ticker: ${ticker.symbol} (${ticker.displayName})\nDiary Date: ${date}\n`;
      if (contextStack.daily) contextInfo += formatPlaybookForDiary(contextStack.daily, "DAILY");
      if (contextStack.weekly) contextInfo += formatPlaybookForDiary(contextStack.weekly, "WEEKLY");
      if (contextStack.monthly) contextInfo += formatPlaybookForDiary(contextStack.monthly, "MONTHLY");

      if (dayMessages.length > 0) {
        contextInfo += "\n## CHAT LOG FOR THIS DAY\n";
        for (const msg of dayMessages.slice(-40)) {
          const time = new Date(msg.createdAt!).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" });
          contextInfo += `[${time}] ${msg.role}: ${msg.content.slice(0, 500)}\n`;
        }
      }

      if (dayImages.length > 0) {
        contextInfo += "\n## UPLOADED IMAGES FOR THIS DAY\n";
        contextInfo += `${dayImages.length} image(s) were uploaded during this session:\n`;
        for (const img of dayImages) {
          const time = img.uploadedAt ? new Date(img.uploadedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }) : "unknown";
          contextInfo += `- [${time}] "${img.originalFilename}" (${img.mimeType}) → ${img.storedPath}\n`;
        }
      }

      contextInfo += "\n## CHART AVAILABILITY\n";
      contextInfo += `weekly_context_provided: ${weeklyContextProvided}\n`;
      contextInfo += `monthly_context_provided: ${monthlyContextProvided}\n`;
      if (dailyChartUrl) contextInfo += `- DAILY closing chart: PROVIDED (${dailyChartUrl})\n`;
      else contextInfo += "- DAILY closing chart: NOT PROVIDED — use Daily Playbook text for context\n";
      if (weeklyChartUrl) contextInfo += `- WEEKLY closing chart: PROVIDED (${weeklyChartUrl})\n`;
      else contextInfo += "- WEEKLY closing chart: NOT PROVIDED — use Weekly Playbook JSON/text for context\n";
      if (monthlyChartUrl) contextInfo += `- MONTHLY closing chart: PROVIDED (${monthlyChartUrl})\n`;
      else contextInfo += "- MONTHLY closing chart: NOT PROVIDED — use Monthly Playbook JSON/text for context\n";

      if (contextStack.weekly) {
        const weeklyData = contextStack.weekly.playbookData as any;
        contextInfo += "\n## WEEKLY PLAYBOOK RAW JSON (for Blueprint Alignment Audit)\n";
        contextInfo += JSON.stringify(weeklyData, null, 2).slice(0, 4000) + "\n";
      }
      if (contextStack.monthly) {
        const monthlyData = contextStack.monthly.playbookData as any;
        contextInfo += "\n## MONTHLY PLAYBOOK RAW JSON (for Blueprint Alignment Audit)\n";
        contextInfo += JSON.stringify(monthlyData, null, 2).slice(0, 4000) + "\n";
      }

      const imageRefsForResponse = dayImages.map(img => ({
        filename: img.originalFilename,
        path: img.storedPath,
        uploadedAt: img.uploadedAt ? new Date(img.uploadedAt).toISOString() : null,
        timestamp: img.uploadedAt ? new Date(img.uploadedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }) : "unknown",
        context: "",
        ai_critique: "",
      }));

      const chartImageParts: any[] = [];
      const readFileAsBase64Part = (filePath: string, mimeType: string) => {
        const absPath = path.join(process.cwd(), "public", filePath);
        if (fs.existsSync(absPath)) {
          const data = fs.readFileSync(absPath);
          return { inlineData: { data: data.toString("base64"), mimeType } };
        }
        return null;
      };

      if (dailyChartUrl && dailyChartFile) {
        const dailyPart = readFileAsBase64Part(dailyChartUrl, dailyChartFile.mimetype);
        if (dailyPart) chartImageParts.push({ text: "DAILY closing chart:" }, dailyPart);
      }
      if (weeklyChartUrl && weeklyChartFile) {
        const weeklyPart = readFileAsBase64Part(weeklyChartUrl, weeklyChartFile.mimetype);
        if (weeklyPart) chartImageParts.push({ text: "WEEKLY closing chart:" }, weeklyPart);
      }
      if (monthlyChartUrl && monthlyChartFile) {
        const monthlyPart = readFileAsBase64Part(monthlyChartUrl, monthlyChartFile.mimetype);
        if (monthlyPart) chartImageParts.push({ text: "MONTHLY closing chart:" }, monthlyPart);
      }

      const chartsAvailable = [dailyChartUrl ? "Daily" : null, weeklyChartUrl ? "Weekly" : null, monthlyChartUrl ? "Monthly" : null].filter(Boolean);
      const allChartsPresent = chartsAvailable.length === 3;
      const noCharts = chartsAvailable.length === 0;

      let analysisMode = "";
      if (allChartsPresent) {
        analysisMode = `ANALYSIS MODE: FULL MACRO-TO-MICRO (all 3 charts provided)
Perform the complete multi-timeframe synthesis:
Step 1 (Daily): Compare the Daily close to the morning's Playbook scenarios. Which levels held? Which broke? Was the bias correct?
Step 2 (Weekly): Analyze the Weekly candle from the chart image. Did it close as an 'Inside Week,' 'Engulfing,' or 'Pin Bar'? Explain how this affects next week's bias.
Step 3 (Monthly): Check the Monthly levels from the chart image. Is the Monthly trend still intact or is a macro breakdown occurring?
Final Output: Synthesize all three visual timeframes into the 'bigger_picture' section.`;
      } else if (noCharts) {
        analysisMode = `ANALYSIS MODE: CHAT-ONLY RECAP (no charts provided)
Focus on the tactical chat history and playbook text. Summarize what was discussed, which levels were referenced, and what the trader's sentiment was. Use playbook JSON data for all timeframe analysis. Also generate the "chat_recap" field summarizing key Q&A exchanges from the chat log.`;
      } else {
        analysisMode = `ANALYSIS MODE: ADAPTIVE (charts available: ${chartsAvailable.join(", ")})
Focus on the ${chartsAvailable.join("/")} chart(s) provided. For missing timeframes, use the stored Playbook JSON/text to provide context. Note in your analysis: "Visual Weekly context was not provided" or "Visual Monthly context was not provided" where applicable. Still produce weekly_impact and monthly_impact using the playbook text data.`;
      }

      const systemInstruction = `You are an Institutional Risk Manager and Trading Post-Mortem Analyst for ${ticker.symbol}. The market date is ${date} (New York time).

${analysisMode}

BLUEPRINT ALIGNMENT AUDIT — CRITICAL:
After completing your timeframe analysis, perform a Blueprint Alignment Audit:
1. Read the WEEKLY PLAYBOOK RAW JSON carefully. Scan for ANY time-based rules, deadlines, flip dates, or decision days. Examples:
   - "ES must hold 6900 until Tuesday"
   - "6th Flip Date is March 15"
   - "Decision Wednesday — bulls must reclaim 5950 by Wednesday close"
   - "If price stays above X for 3 consecutive days..."
2. Read the MONTHLY PLAYBOOK RAW JSON carefully. Scan for the same types of time-based rules at the macro level.
3. For each time-based rule found:
   a) Has the deadline date passed relative to today (${date})?
   b) Did the market meet the stated price condition?
   c) If the deadline passed AND the condition FAILED → mark status as "diverged"
   d) If the deadline passed AND the condition was MET → mark status as "in_line"
   e) If the deadline has NOT yet passed → mark event result as "pending"
4. Example: If the Weekly Blueprint says "ES must hold 6900 until Tuesday" and today is Wednesday and price closed at 6850, the weekly status MUST be "diverged" with explanation "Price closed below 6900 after the Tuesday deadline — bullish scenario invalidated per expert rules."

When analyzing the 'Bigger Picture,' prioritize the specific date-based triggers found in reports. If an author mentions a 'Flip Date' or 'Decision Tuesday,' explicitly state if the market passed or failed that expert's test today.

Your analysis MUST be returned as a JSON object with these exact fields:

{
  "market_achievement": {
    "summary": "2-3 paragraph narrative of what happened in the session",
    "session_outcome": "TREND_CONTINUATION | REVERSAL | FAILED_BREAKOUT | CHOP | STABILIZED",
    "key_moves": ["List of 3-5 significant price moves or events"]
  },
  "bigger_picture": {
    "summary": "1-2 paragraphs synthesizing timeframe analysis (reference date-based triggers from expert playbooks)",
    "weekly_impact": "How today's action affects the weekly thesis",
    "monthly_impact": "How today's action affects the monthly bias"
  },
  "plan_adherence": {
    "grade": "A | B | C | D | F",
    "grade_rationale": "1-2 sentences explaining the grade",
    "levels_defended": [{"price": 0, "label": "description", "status": "defended"}],
    "levels_lost": [{"price": 0, "label": "description", "status": "lost"}],
    "scenarios_triggered": [{"scenario": "IF/THEN description", "result": "what actually happened", "grade": "A-F"}]
  },
  "blueprint_alignment": {
    "weekly": {
      "status": "in_line | diverged | no_data",
      "checked_events": [{"event": "rule or deadline name", "deadline": "the date or timeframe", "condition": "what must happen", "result": "passed | failed | pending", "explanation": "why it passed/failed"}],
      "rationale": "Overall weekly alignment summary"
    },
    "monthly": {
      "status": "in_line | diverged | holding | no_data",
      "checked_events": [{"event": "rule or deadline name", "deadline": "the date or timeframe", "condition": "what must happen", "result": "passed | failed | pending", "explanation": "why it passed/failed"}],
      "rationale": "Overall monthly alignment summary"
    }
  },
  "closing_bias": "Bullish | Bearish | Neutral | Open",
  "lesson_of_the_day": "A key takeaway from today's session",
  "prep_for_tomorrow": "Key levels and scenarios to watch for the next session",
  "road_ahead": "Predict the next major battleground based on structure",
  "image_references": [{"filename": "chart.png", "path": "/uploads/xyz.png", "timestamp": "10:30 AM", "context": "Brief description", "ai_critique": "Technical analysis"}],
  "chat_recap": [{"question": "key question from chat", "answer": "key answer or insight", "timestamp": "HH:MM AM/PM"}]
}

RULES:
1. Base your analysis ONLY on the provided playbook context, chat log, and closing chart images — do not invent data
2. If no playbook exists, grade plan adherence as "N/A" and note there was no morning plan
3. Be specific about which levels held or broke, referencing exact prices from the playbook
4. The grade should reflect how well the morning plan predicted actual market behavior
5. If uploaded images are listed, include them in "image_references" with context and ai_critique
6. The "road_ahead" field MUST reference specific price levels and structure
7. If no Weekly Playbook exists, set blueprint_alignment.weekly.status to "no_data" with empty checked_events
8. If no Monthly Playbook exists, set blueprint_alignment.monthly.status to "no_data" with empty checked_events
9. If no time-based rules are found in a playbook, still set the status based on whether the overall thesis/bias is tracking (in_line) or not (diverged)
10. The "chat_recap" field should contain 3-5 key Q&A exchanges from the chat log. If no chat history exists, return an empty array.
11. Return ONLY the JSON object, no additional text or markdown`;

      const DIARY_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"];
      let diaryModelIdx = 0;
      let diaryModelName = DIARY_MODELS[0];
      let model = genAI.getGenerativeModel({
        model: diaryModelName,
        systemInstruction,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192,
        },
      });

      let aiAnalysis: any = null;
      let grade = "N/A";
      let closingBias = "Open";

      const MAX_ATTEMPTS_PER_MODEL = 2;
      const MAX_TOTAL_ATTEMPTS = DIARY_MODELS.length * MAX_ATTEMPTS_PER_MODEL;
      let diaryModelAttempts = 0;
      let lastErr: any = null;
      for (let attempt = 0; attempt < MAX_TOTAL_ATTEMPTS; attempt++) {
        try {
          const contentParts: any[] = [{ text: contextInfo }, ...chartImageParts];
          console.log(`[Diary] Calling ${diaryModelName} (attempt ${attempt + 1}/${MAX_TOTAL_ATTEMPTS})...`);
          const result = await model.generateContent(contentParts);
          let responseText = result.response.text().trim();
          responseText = responseText.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?\s*```$/, "");
          responseText = responseText.replace(/,\s*([}\]])/g, "$1");
          aiAnalysis = JSON.parse(responseText);
          const modelRefs = Array.isArray(aiAnalysis.image_references) ? aiAnalysis.image_references : [];
          const mergedRefs = imageRefsForResponse.map(ref => {
            const match = modelRefs.find((mr: any) => mr.path === ref.path || mr.filename === ref.filename);
            return match ? { ...ref, context: match.context || ref.context, ai_critique: match.ai_critique || ref.ai_critique } : ref;
          });
          aiAnalysis.image_references = mergedRefs;
          grade = aiAnalysis.plan_adherence?.grade || "N/A";
          closingBias = aiAnalysis.closing_bias || "Open";
          console.log(`[Diary] Successfully generated with ${diaryModelName}`);
          lastErr = null;
          break;
        } catch (err: any) {
          lastErr = err;
          const status = err?.status || err?.httpStatusCode;
          const errMsg = String(err?.message || "");
          const isOverloaded = status === 503 || status === 429 || errMsg.includes("503") || errMsg.includes("429") || errMsg.includes("Service Unavailable") || errMsg.includes("overloaded");
          console.error(`[Diary] ${diaryModelName} error (attempt ${attempt + 1}):`, err?.message || err);

          if (isOverloaded) {
            diaryModelAttempts++;
            if (diaryModelAttempts >= MAX_ATTEMPTS_PER_MODEL && diaryModelIdx < DIARY_MODELS.length - 1) {
              diaryModelIdx++;
              diaryModelName = DIARY_MODELS[diaryModelIdx];
              diaryModelAttempts = 0;
              console.log(`[Diary] Switching to fallback model: ${diaryModelName}`);
              model = genAI.getGenerativeModel({
                model: diaryModelName,
                systemInstruction,
                generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
              });
              await new Promise(r => setTimeout(r, 2000));
              continue;
            }
            if (attempt < MAX_TOTAL_ATTEMPTS - 1) {
              const delay = Math.pow(2, diaryModelAttempts) * 1000;
              console.log(`[Diary] Retrying ${diaryModelName} in ${delay}ms...`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
          }
          break;
        }
      }

      if (lastErr || !aiAnalysis) {
        aiAnalysis = {
          market_achievement: {
            summary: "AI analysis was unavailable. Please try generating again later.",
            session_outcome: "UNKNOWN",
            key_moves: [],
          },
          bigger_picture: { summary: "N/A", weekly_impact: "N/A", monthly_impact: "N/A" },
          plan_adherence: { grade: "N/A", grade_rationale: "Could not generate analysis", levels_defended: [], levels_lost: [], scenarios_triggered: [] },
          closing_bias: "Open",
          lesson_of_the_day: "N/A",
          prep_for_tomorrow: "N/A",
          road_ahead: "N/A",
          image_references: imageRefsForResponse,
          blueprint_alignment: {
            weekly: { status: "no_data", checked_events: [], rationale: "AI analysis was unavailable" },
            monthly: { status: "no_data", checked_events: [], rationale: "AI analysis was unavailable" },
          },
          chat_recap: [],
        };
        grade = "N/A";
        closingBias = "Open";
      }

      const diary = await storage.createDiary({
        userId,
        tickerId,
        date,
        aiAnalysis,
        isFinalized: false,
        planAdherenceGrade: grade,
        closingBias: closingBias,
        dailyChartUrl,
        weeklyChartUrl,
        monthlyChartUrl,
      });

      res.status(201).json(diary);
    } catch (err: any) {
      console.error("Diary generation error:", err);
      res.status(500).json({ message: err.message || "Failed to generate diary" });
    }
  });

  app.patch("/api/diary/:id/regenerate", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(res);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid diary ID" });

      const entry = await storage.getDiaryEntry(id, userId);
      if (!entry) return res.status(404).json({ message: "Diary entry not found" });

      const tickerId = entry.tickerId!;
      const date = entry.date;
      const ticker = await storage.getTicker(tickerId, userId);
      if (!ticker) return res.status(404).json({ message: "Ticker not found" });

      const contextStack = await storage.getPlaybookContextStack(tickerId, userId, date);
      const chatHistory = await storage.getChatMessagesByTicker(tickerId, userId);
      const dayMessages = chatHistory.filter(m => {
        if (!m.createdAt) return false;
        const msgNY = new Date(new Date(m.createdAt).toLocaleString("en-US", { timeZone: "America/New_York" }));
        const msgDateStr = `${msgNY.getFullYear()}-${String(msgNY.getMonth() + 1).padStart(2, "0")}-${String(msgNY.getDate()).padStart(2, "0")}`;
        return msgDateStr === date;
      });

      const pbFoundCount = [contextStack.daily, contextStack.weekly, contextStack.monthly].filter(Boolean).length;
      console.log(`[Diary Regen] Context for ${date}: ${pbFoundCount} playbook(s) found (daily=${!!contextStack.daily}, weekly=${!!contextStack.weekly}, monthly=${!!contextStack.monthly}), ${dayMessages.length} chat message(s)`);

      const formatPlaybookForDiary = (pb: any, label: string) => {
        const data = pb.playbookData as any;
        let out = `\n## ${label} PLAYBOOK\n`;
        out += `Bias: ${data.bias || "Open"}\n`;
        out += `Macro Theme: ${data.macro_theme || "N/A"}\n`;
        if (data.thesis) {
          const thesisText = typeof data.thesis === "object" ? (data.thesis.summary || JSON.stringify(data.thesis)) : String(data.thesis);
          out += `Thesis: ${thesisText.slice(0, 800)}\n`;
        }
        if (data.structural_zones) {
          const allZones = [
            ...(data.structural_zones.bullish_green || []),
            ...(data.structural_zones.neutral_yellow || []),
            ...(data.structural_zones.bearish_red || []),
          ];
          if (allZones.length > 0) {
            out += `Key Levels: ${allZones.map((l: any) => `${l.price}${l.price_high ? `-${l.price_high}` : ""} (${l.label})`).join(", ")}\n`;
          }
        }
        if (data.if_then_scenarios?.length > 0) {
          out += `Scenarios:\n${data.if_then_scenarios.map((s: any) => `- ${s.condition} → ${s.outcome}`).join("\n")}\n`;
        }
        if (data.execution_checklist?.length > 0) {
          out += `Checklist: ${data.execution_checklist.join("; ")}\n`;
        }
        return out;
      };

      let contextInfo = `Ticker: ${ticker.symbol} (${ticker.displayName})\nDiary Date: ${date}\n`;
      if (contextStack.daily) contextInfo += formatPlaybookForDiary(contextStack.daily, "DAILY");
      if (contextStack.weekly) contextInfo += formatPlaybookForDiary(contextStack.weekly, "WEEKLY");
      if (contextStack.monthly) contextInfo += formatPlaybookForDiary(contextStack.monthly, "MONTHLY");

      if (dayMessages.length > 0) {
        contextInfo += "\n## CHAT LOG FOR THIS DAY\n";
        for (const msg of dayMessages.slice(-40)) {
          const time = new Date(msg.createdAt!).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" });
          contextInfo += `[${time}] ${msg.role}: ${msg.content.slice(0, 500)}\n`;
        }
      }

      const dayImages = await storage.getUploadedImagesByDate(tickerId, userId, date);
      if (dayImages.length > 0) {
        contextInfo += "\n## UPLOADED IMAGES FOR THIS DAY\n";
        contextInfo += `${dayImages.length} image(s) were uploaded during this session:\n`;
        for (const img of dayImages) {
          const time = img.uploadedAt ? new Date(img.uploadedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }) : "unknown";
          contextInfo += `- [${time}] "${img.originalFilename}" (${img.mimeType}) → ${img.storedPath}\n`;
        }
      }

      const dailyChartUrl = entry.dailyChartUrl;
      const weeklyChartUrl = entry.weeklyChartUrl;
      const monthlyChartUrl = entry.monthlyChartUrl;

      contextInfo += "\n## CHART AVAILABILITY\n";
      contextInfo += `weekly_context_provided: ${!!weeklyChartUrl}\n`;
      contextInfo += `monthly_context_provided: ${!!monthlyChartUrl}\n`;
      if (dailyChartUrl) contextInfo += `- DAILY closing chart: PROVIDED (${dailyChartUrl})\n`;
      else contextInfo += "- DAILY closing chart: NOT PROVIDED — use Daily Playbook text for context\n";
      if (weeklyChartUrl) contextInfo += `- WEEKLY closing chart: PROVIDED (${weeklyChartUrl})\n`;
      else contextInfo += "- WEEKLY closing chart: NOT PROVIDED — use Weekly Playbook JSON/text for context\n";
      if (monthlyChartUrl) contextInfo += `- MONTHLY closing chart: PROVIDED (${monthlyChartUrl})\n`;
      else contextInfo += "- MONTHLY closing chart: NOT PROVIDED — use Monthly Playbook JSON/text for context\n";

      if (contextStack.weekly) {
        const weeklyData = contextStack.weekly.playbookData as any;
        contextInfo += "\n## WEEKLY PLAYBOOK RAW JSON (for Blueprint Alignment Audit)\n";
        contextInfo += JSON.stringify(weeklyData, null, 2).slice(0, 4000) + "\n";
      }
      if (contextStack.monthly) {
        const monthlyData = contextStack.monthly.playbookData as any;
        contextInfo += "\n## MONTHLY PLAYBOOK RAW JSON (for Blueprint Alignment Audit)\n";
        contextInfo += JSON.stringify(monthlyData, null, 2).slice(0, 4000) + "\n";
      }

      const imageRefsForResponse = dayImages.map(img => ({
        filename: img.originalFilename,
        path: img.storedPath,
        uploadedAt: img.uploadedAt ? new Date(img.uploadedAt).toISOString() : null,
        timestamp: img.uploadedAt ? new Date(img.uploadedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }) : "unknown",
        context: "",
        ai_critique: "",
      }));

      const chartImageParts: any[] = [];
      const readFileAsBase64Part = (filePath: string, mimeType: string) => {
        const absPath = path.join(process.cwd(), "public", filePath);
        if (fs.existsSync(absPath)) {
          const data = fs.readFileSync(absPath);
          return { inlineData: { data: data.toString("base64"), mimeType } };
        }
        return null;
      };

      const guessMime = (url: string) => {
        const ext = path.extname(url).toLowerCase();
        if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
        if (ext === ".webp") return "image/webp";
        if (ext === ".gif") return "image/gif";
        return "image/png";
      };

      if (dailyChartUrl) {
        const part = readFileAsBase64Part(dailyChartUrl, guessMime(dailyChartUrl));
        if (part) chartImageParts.push({ text: "DAILY closing chart:" }, part);
      }
      if (weeklyChartUrl) {
        const part = readFileAsBase64Part(weeklyChartUrl, guessMime(weeklyChartUrl));
        if (part) chartImageParts.push({ text: "WEEKLY closing chart:" }, part);
      }
      if (monthlyChartUrl) {
        const part = readFileAsBase64Part(monthlyChartUrl, guessMime(monthlyChartUrl));
        if (part) chartImageParts.push({ text: "MONTHLY closing chart:" }, part);
      }

      const chartsAvailable = [dailyChartUrl ? "Daily" : null, weeklyChartUrl ? "Weekly" : null, monthlyChartUrl ? "Monthly" : null].filter(Boolean);
      const allChartsPresent = chartsAvailable.length === 3;
      const noCharts = chartsAvailable.length === 0;

      let analysisMode = "";
      if (allChartsPresent) {
        analysisMode = `ANALYSIS MODE: FULL MACRO-TO-MICRO (all 3 charts provided)
Perform the complete multi-timeframe synthesis:
Step 1 (Daily): Compare the Daily close to the morning's Playbook scenarios. Which levels held? Which broke? Was the bias correct?
Step 2 (Weekly): Analyze the Weekly candle from the chart image. Did it close as an 'Inside Week,' 'Engulfing,' or 'Pin Bar'? Explain how this affects next week's bias.
Step 3 (Monthly): Check the Monthly levels from the chart image. Is the Monthly trend still intact or is a macro breakdown occurring?
Final Output: Synthesize all three visual timeframes into the 'bigger_picture' section.`;
      } else if (noCharts) {
        analysisMode = `ANALYSIS MODE: CHAT-ONLY RECAP (no charts provided)
Focus on the tactical chat history and playbook text. Summarize what was discussed, which levels were referenced, and what the trader's sentiment was. Use playbook JSON data for all timeframe analysis. Also generate the "chat_recap" field summarizing key Q&A exchanges from the chat log.`;
      } else {
        analysisMode = `ANALYSIS MODE: ADAPTIVE (charts available: ${chartsAvailable.join(", ")})
Focus on the ${chartsAvailable.join("/")} chart(s) provided. For missing timeframes, use the stored Playbook JSON/text to provide context. Note in your analysis: "Visual Weekly context was not provided" or "Visual Monthly context was not provided" where applicable. Still produce weekly_impact and monthly_impact using the playbook text data.`;
      }

      const systemInstruction = `You are an Institutional Risk Manager and Trading Post-Mortem Analyst for ${ticker.symbol}. The market date is ${date} (New York time).

${analysisMode}

BLUEPRINT ALIGNMENT AUDIT — CRITICAL:
After completing your timeframe analysis, perform a Blueprint Alignment Audit:
1. Read the WEEKLY PLAYBOOK RAW JSON carefully. Scan for ANY time-based rules, deadlines, flip dates, or decision days.
2. Read the MONTHLY PLAYBOOK RAW JSON carefully. Scan for the same types of time-based rules at the macro level.
3. For each time-based rule found:
   a) Has the deadline date passed relative to today (${date})?
   b) Did the market meet the stated price condition?
   c) If the deadline passed AND the condition FAILED → mark status as "diverged"
   d) If the deadline passed AND the condition was MET → mark status as "in_line"
   e) If the deadline has NOT yet passed → mark event result as "pending"

Your analysis MUST be returned as a JSON object with these exact fields:

{
  "market_achievement": { "summary": "...", "session_outcome": "TREND_CONTINUATION | REVERSAL | FAILED_BREAKOUT | CHOP | STABILIZED", "key_moves": ["..."] },
  "bigger_picture": { "summary": "...", "weekly_impact": "...", "monthly_impact": "..." },
  "plan_adherence": { "grade": "A | B | C | D | F", "grade_rationale": "...", "levels_defended": [{"price": 0, "label": "...", "status": "defended"}], "levels_lost": [{"price": 0, "label": "...", "status": "lost"}], "scenarios_triggered": [{"scenario": "...", "result": "...", "grade": "A-F"}] },
  "blueprint_alignment": { "weekly": { "status": "in_line | diverged | no_data", "checked_events": [], "rationale": "..." }, "monthly": { "status": "in_line | diverged | holding | no_data", "checked_events": [], "rationale": "..." } },
  "closing_bias": "Bullish | Bearish | Neutral | Open",
  "lesson_of_the_day": "...",
  "prep_for_tomorrow": "...",
  "road_ahead": "...",
  "image_references": [],
  "chat_recap": []
}

RULES:
1. Base your analysis ONLY on the provided playbook context, chat log, and closing chart images
2. If no playbook exists, grade plan adherence as "N/A" and note there was no morning plan
3. Be specific about which levels held or broke, referencing exact prices
4. The grade should reflect how well the morning plan predicted actual market behavior
5. If uploaded images are listed, include them in "image_references" with context and ai_critique
6. The "road_ahead" field MUST reference specific price levels and structure
7. If no Weekly Playbook exists, set blueprint_alignment.weekly.status to "no_data"
8. If no Monthly Playbook exists, set blueprint_alignment.monthly.status to "no_data"
9. The "chat_recap" field should contain 3-5 key Q&A exchanges from the chat log. If no chat history exists, return an empty array.
10. Return ONLY the JSON object, no additional text or markdown`;

      const REGEN_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"];
      let regenModelIdx = 0;
      let regenModelName = REGEN_MODELS[0];
      let model = genAI.getGenerativeModel({
        model: regenModelName,
        systemInstruction,
        generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
      });

      let aiAnalysis: any = null;
      let grade = "N/A";
      let closingBias = "Open";

      const MAX_ATTEMPTS_PER_MODEL = 2;
      const MAX_TOTAL_ATTEMPTS = REGEN_MODELS.length * MAX_ATTEMPTS_PER_MODEL;
      let regenModelAttempts = 0;
      let lastErr: any = null;
      for (let attempt = 0; attempt < MAX_TOTAL_ATTEMPTS; attempt++) {
        try {
          const contentParts: any[] = [{ text: contextInfo }, ...chartImageParts];
          console.log(`[Diary Regen] Calling ${regenModelName} (attempt ${attempt + 1}/${MAX_TOTAL_ATTEMPTS})...`);
          const result = await model.generateContent(contentParts);
          let responseText = result.response.text().trim();
          responseText = responseText.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?\s*```$/, "");
          responseText = responseText.replace(/,\s*([}\]])/g, "$1");
          aiAnalysis = JSON.parse(responseText);
          const modelRefs = Array.isArray(aiAnalysis.image_references) ? aiAnalysis.image_references : [];
          const mergedRefs = imageRefsForResponse.map(ref => {
            const match = modelRefs.find((mr: any) => mr.path === ref.path || mr.filename === ref.filename);
            return match ? { ...ref, context: match.context || ref.context, ai_critique: match.ai_critique || ref.ai_critique } : ref;
          });
          aiAnalysis.image_references = mergedRefs;
          grade = aiAnalysis.plan_adherence?.grade || "N/A";
          closingBias = aiAnalysis.closing_bias || "Open";
          console.log(`[Diary Regen] Successfully regenerated with ${regenModelName}`);
          lastErr = null;
          break;
        } catch (err: any) {
          lastErr = err;
          const status = err?.status || err?.httpStatusCode;
          const errMsg = String(err?.message || "");
          const isOverloaded = status === 503 || status === 429 || errMsg.includes("503") || errMsg.includes("429") || errMsg.includes("Service Unavailable") || errMsg.includes("overloaded");
          console.error(`[Diary Regen] ${regenModelName} error (attempt ${attempt + 1}):`, err?.message || err);

          if (isOverloaded) {
            regenModelAttempts++;
            if (regenModelAttempts >= MAX_ATTEMPTS_PER_MODEL && regenModelIdx < REGEN_MODELS.length - 1) {
              regenModelIdx++;
              regenModelName = REGEN_MODELS[regenModelIdx];
              regenModelAttempts = 0;
              console.log(`[Diary Regen] Switching to fallback model: ${regenModelName}`);
              model = genAI.getGenerativeModel({
                model: regenModelName,
                systemInstruction,
                generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
              });
              await new Promise(r => setTimeout(r, 2000));
              continue;
            }
            if (attempt < MAX_TOTAL_ATTEMPTS - 1) {
              const delay = Math.pow(2, regenModelAttempts) * 1000;
              console.log(`[Diary Regen] Retrying ${regenModelName} in ${delay}ms...`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
          }
          break;
        }
      }

      if (lastErr || !aiAnalysis) {
        return res.status(503).json({
          message: `AI service is currently busy. Attempted models: ${REGEN_MODELS.slice(0, regenModelIdx + 1).join(" → ")}. Please try again in a moment.`
        });
      }

      const updated = await storage.updateDiary(id, userId, {
        aiAnalysis,
        planAdherenceGrade: grade,
        closingBias: closingBias,
      });

      res.json(updated);
    } catch (err: any) {
      console.error("Diary regeneration error:", err);
      res.status(500).json({ message: err.message || "Failed to regenerate diary" });
    }
  });

  app.post("/api/diary/:id/chat", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(res);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid diary ID" });
      const { message } = req.body;
      if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ message: "Message is required" });
      }

      const entry = await storage.getDiaryEntry(id, userId);
      if (!entry) return res.status(404).json({ message: "Diary entry not found" });

      const ticker = entry.tickerId ? await storage.getTicker(entry.tickerId, userId) : null;
      const analysis = entry.aiAnalysis as any;

      let diaryContext = `## DIARY ENTRY FOR ${entry.date}\n`;
      diaryContext += `Ticker: ${ticker?.symbol || "Unknown"}\n`;
      diaryContext += `Grade: ${entry.planAdherenceGrade || "N/A"}\n`;
      diaryContext += `Closing Bias: ${entry.closingBias || "Open"}\n`;
      if (analysis?.market_achievement?.summary) {
        diaryContext += `Market Achievement: ${analysis.market_achievement.summary}\n`;
      }
      if (analysis?.bigger_picture?.summary) {
        diaryContext += `Bigger Picture: ${analysis.bigger_picture.summary}\n`;
      }
      if (analysis?.plan_adherence?.grade_rationale) {
        diaryContext += `Grade Rationale: ${analysis.plan_adherence.grade_rationale}\n`;
      }
      if (analysis?.lesson_of_the_day) {
        diaryContext += `Lesson: ${analysis.lesson_of_the_day}\n`;
      }
      if (entry.userClosingThought) {
        diaryContext += `Trader's Closing Thought: ${entry.userClosingThought}\n`;
      }

      const systemInstruction = `You are a Trading Mentor reviewing a past diary entry for ${ticker?.symbol || "an instrument"}. The diary is from ${entry.date}. The trader is reflecting on this past session and asking follow-up questions ("Talk to the Past").

Your role:
- Help the trader extract deeper lessons from this past session
- Reference specific data from the diary (levels, grade, outcomes) in your answers
- Be constructive and educational — focus on pattern recognition and improvement
- Keep responses concise (2-3 paragraphs)
- If the trader asks "what could I have done differently?" — reference the specific playbook data and scenarios

## DIARY CONTEXT
${diaryContext}

Respond in plain text, no JSON or code blocks.`;

      const DIARY_CHAT_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
      let diaryChatModelIdx = 0;
      let diaryChatModelName = DIARY_CHAT_MODELS[0];
      let model = genAI.getGenerativeModel({
        model: diaryChatModelName,
        systemInstruction,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4096,
        },
      });

      let aiResponse = "";
      const MAX_RETRIES = 4;
      let lastErr: any = null;
      let diaryChatRetryAttempts = 0;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const result = await model.generateContent(message);
          aiResponse = result.response.text();
          lastErr = null;
          break;
        } catch (err: any) {
          lastErr = err;
          const status = err?.status || err?.httpStatusCode;
          const isRetryable = status === 503 || status === 429 || String(err?.message || "").includes("503") || String(err?.message || "").includes("429") || String(err?.message || "").includes("Service Unavailable") || String(err?.message || "").includes("overloaded");
          if (isRetryable) {
            diaryChatRetryAttempts++;
            if (diaryChatRetryAttempts >= 2 && diaryChatModelIdx < DIARY_CHAT_MODELS.length - 1) {
              diaryChatModelIdx++;
              diaryChatModelName = DIARY_CHAT_MODELS[diaryChatModelIdx];
              diaryChatRetryAttempts = 0;
              console.log(`[DiaryChat] Switching to fallback model: ${diaryChatModelName}`);
              model = genAI.getGenerativeModel({
                model: diaryChatModelName,
                systemInstruction,
                generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
              });
              await new Promise(r => setTimeout(r, 2000));
              continue;
            }
            if (attempt < MAX_RETRIES - 1) {
              const delay = Math.pow(2, attempt) * 1000;
              console.log(`[DiaryChat] ${diaryChatModelName} error (${status}). Retrying in ${delay}ms...`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
          }
          break;
        }
      }

      if (lastErr || !aiResponse) {
        aiResponse = "I'm unable to process your reflection right now. Please try again in a moment.";
      }

      res.json({ message: aiResponse });
    } catch (err: any) {
      console.error("Diary chat error:", err);
      res.status(500).json({ message: err.message || "Failed to process reflection" });
    }
  });

  app.get("/uploads/:filename", isAuthenticated, async (req, res) => {
    const userId = getUserId(res);
    const filename = req.params.filename as string;
    if (!filename || /[\/\\]/.test(filename)) {
      return res.status(400).json({ message: "Invalid filename" });
    }
    const storedPath = `/uploads/${filename}`;
    const allUserImages = await db.select().from(uploadedImages)
      .where(and(eq(uploadedImages.userId, userId), eq(uploadedImages.storedPath, storedPath)))
      .limit(1);
    if (allUserImages.length === 0) {
      const diaryCharts = await db.select().from(tradingDiary)
        .where(and(
          eq(tradingDiary.userId, userId),
          or(
            eq(tradingDiary.dailyChartUrl, storedPath),
            eq(tradingDiary.weeklyChartUrl, storedPath),
            eq(tradingDiary.monthlyChartUrl, storedPath),
          )
        ))
        .limit(1);
      if (diaryCharts.length === 0) {
        return res.status(403).json({ message: "Access denied" });
      }
    }
    const filePath = path.join(process.cwd(), "public", "uploads", filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File not found" });
    }
    res.sendFile(filePath);
  });

  return httpServer;
}
