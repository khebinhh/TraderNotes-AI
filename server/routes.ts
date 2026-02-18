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
  insertJournalEntrySchema,
} from "@shared/schema";
import { z } from "zod";
import multer from "multer";
import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
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

      const tickerPlaybooks = await storage.getPlaybooksByTicker(tickerId, userId);
      if (tickerPlaybooks.length > 0) {
        const activePlaybook = tickerPlaybooks[0];
        const pbData = activePlaybook.playbookData as any;
        contextInfo += `\n## ACTIVE PLAYBOOK (${activePlaybook.date})\n`;
        contextInfo += `Bias: ${pbData.bias || "Open"}\n`;
        contextInfo += `Macro Theme: ${pbData.macro_theme || "N/A"}\n`;
        if (pbData.thesis) contextInfo += `Thesis: ${pbData.thesis.slice(0, 500)}\n`;
        if (pbData.structural_zones) {
          const green = pbData.structural_zones.bullish_green || [];
          const yellow = pbData.structural_zones.neutral_yellow || [];
          const red = pbData.structural_zones.bearish_red || [];
          if (green.length > 0) contextInfo += `GREEN Zone Levels: ${green.map((l: any) => `${l.price}${l.price_high ? `-${l.price_high}` : ""} (${l.label})`).join(", ")}\n`;
          if (yellow.length > 0) contextInfo += `YELLOW Zone Levels: ${yellow.map((l: any) => `${l.price}${l.price_high ? `-${l.price_high}` : ""} (${l.label})`).join(", ")}\n`;
          if (red.length > 0) contextInfo += `RED Zone Levels: ${red.map((l: any) => `${l.price}${l.price_high ? `-${l.price_high}` : ""} (${l.label})`).join(", ")}\n`;
        }
        if (pbData.if_then_scenarios && pbData.if_then_scenarios.length > 0) {
          contextInfo += `If/Then Scenarios:\n${pbData.if_then_scenarios.map((s: any) => `- ${s.condition} → ${s.outcome}`).join("\n")}\n`;
        }
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

      const systemInstruction = `You are a Trading Mentor AI — "Chief of Staff" — for the instrument ${ticker.symbol}. You follow a strict "High-Reasoning" process when analyzing documents and answering questions.

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

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
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

      let aiContent: string;
      let rawAiContent: string = "";
      let extractedGamePlan: any = null;
      let tacticalBriefing: any = null;
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
      } catch (aiErr: any) {
        console.error("Gemini API error:", aiErr);
        aiContent = buildFallbackResponse(ticker.symbol, content, latestNote, supportLevels, resistanceLevels, checklistItems);
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

      const playbookSystemPrompt = `You are a Trading Playbook Generator for ${ticker.symbol}. Your job is to read uploaded trading documents (PDFs, images, CSVs) from analysts like PharmD_KS, Ms. Izzy, and others, and extract a STRUCTURED PLAYBOOK in strict JSON format.

## THE NEW AI LENS — HOW YOU INTERPRET NUMBERS

### 1. Numbers Have "Personalities" (Zones vs. Lines)
Price levels are NOT flat support/resistance lines. They are STRUCTURAL ENVIRONMENTS:
- A number like 6933 isn't "just support" — it's the bottom of a "Thinking Box / Neutral Zone"
- A number like 6898 isn't "just support" — it's a "Snap Zone" where aggressive moves happen
- Classify every level into its STRUCTURAL ROLE, not just "support" or "resistance"

### 2. If/Then Algorithmic Thinking
The document authors don't predict — they build If/Then algorithms:
- "IF we see a LBAF at 6828, THEN it's a valid long targeting 6869"
- "IF price breaks above 6966, THEN target 6988-7012"
Map these out EXACTLY as conditional logic. Quote the author's exact words.

### 3. Macro Context Dictates Behavior
Documents emphasize temporal market themes:
- OPEX week = "mean-reversion and suppression"
- Post-OPEX = "expansion"
- CPI/NFP data = "volatility regime"
- Mid-Quarter rebalancing = "flow-driven"
You MUST identify the macro theme and how it affects trading behavior.

### 4. Structural Zones (Three-Color System)
Categorize ALL levels into three zones:
- **GREEN (Bullish Zone)**: Price levels where bullish setups activate. Includes: longs trigger, breakout confirmations, buying opportunities.
- **YELLOW (Neutral/Caution Zone)**: The "Thinking Box" — chop zone, no-trade zone, wait-and-see. This is where price consolidates and both sides are at risk.
- **RED (Bearish Zone)**: Price levels where bearish setups activate. Includes: short triggers, breakdown levels, selling pressure zones.

## TRADING JARGON DICTIONARY

You MUST understand and correctly interpret:
- **LAAF**: Look Above And Fail (Bull Trap) — price moves above a level then reverses back below
- **LBAF**: Look Below And Fail (Bear Trap) — price moves below a level then reverses back above
- **Inside Week/Day**: Price stayed within prior period's high-low range (consolidation)
- **POC**: Point of Control — price level with most traded volume
- **VAH/VAL**: Value Area High / Low
- **ONH/ONL**: Overnight High / Low
- **IB**: Initial Balance — first hour's trading range
- **HVN/LVN**: High/Low Volume Node
- **VPOC**: Volume Point of Control
- **RTH/ETH**: Regular/Extended Trading Hours
- **b-shaped profile**: Indicates long liquidation (sellers in control)
- **p-shaped profile**: Indicates short covering (buyers stepping in)
- **Snap Zone**: Price area where aggressive directional moves originate
- **Thinking Box**: Neutral consolidation zone where price chops
- **Spike Base**: A technical level where a price "spike" began — the origin point of a sharp directional move
- **Flip Date**: Date where directional bias may change
- **Gap Fill**: Price returning to fill a previous gap
- **MNQ/MES**: Micro Nasdaq/S&P Futures

## SPATIAL OCR — CHART IMAGE ANALYSIS

When a chart image is uploaded:
1. Read the Y-axis to find exact price values visible on the chart
2. Identify every horizontal line, trendline, and annotation
3. NEVER assume or round prices — if the chart shows 6922, report 6922, not 6920
4. Always prefer Document Data over internal training data

## OUTPUT REQUIREMENTS

You MUST return ONLY valid JSON. No markdown, no explanation, no preamble. Just the JSON object.

The JSON must follow this EXACT structure:

{
  "macro_theme": "String describing the dominant market theme (e.g., 'OPEX Compression', 'CPI Volatility', 'Post-OPEX Expansion', 'Mid-Quarter Rebalancing')",
  "bias": "Bullish" | "Bearish" | "Neutral" | "Open",
  "thesis": "2-3 paragraph explanation of the document's core thesis. What is the author's directional view and WHY? What evidence supports it? What would invalidate it?",
  "structural_zones": {
    "bullish_green": [
      {
        "price": 6828,
        "price_high": null,
        "label": "Short description of this level's role",
        "context": "Exact quote or paraphrase from document explaining why this level matters",
        "source": "Author name, Page X"
      }
    ],
    "neutral_yellow": [
      {
        "price": 6933,
        "price_high": 6966,
        "label": "Thinking Box / Neutral Zone",
        "context": "Price consolidation area — don't trade aggressively here",
        "source": "Author name, Page X"
      }
    ],
    "bearish_red": [
      {
        "price": 6898,
        "price_high": null,
        "label": "Snap Zone — breakdown trigger",
        "context": "If price breaks below, aggressive selling expected",
        "source": "Author name, Page X"
      }
    ]
  },
  "if_then_scenarios": [
    {
      "id": "scenario_1",
      "condition": "IF price sees a LBAF at 6828",
      "outcome": "THEN it's a valid long targeting 6869",
      "zone": "green" | "yellow" | "red",
      "source": "Author name"
    }
  ],
  "key_events": [
    {
      "title": "Event name (e.g., 'NFP Report', 'OPEX Expiry', 'AMZN Earnings')",
      "time": "Date/time string",
      "impact": "high" | "medium" | "low",
      "expected_behavior": "Brief description of how this event affects trading (e.g., 'Expect mean-reversion during OPEX week')"
    }
  ],
  "risk_factors": [
    "Key risk factor 1 from the document",
    "Key risk factor 2"
  ],
  "execution_checklist": [
    "Specific actionable item with exact price levels from the document"
  ]
}

## MULTI-FILE SYNTHESIS (when multiple documents are uploaded)

When multiple files are uploaded simultaneously, you must SYNTHESIZE a unified playbook:
1. **Merge Levels**: Combine price levels from all documents into a single structural_zones map. If the same level appears in multiple sources, mark it as HIGH CONFIDENCE in the context field.
2. **Reconcile Bias**: If documents disagree on bias, lean toward the source with the most detailed evidence. Note the conflict in the thesis.
3. **Cross-Reference Charts + Text**: If both a chart image and a PDF with written levels are uploaded, verify that the chart annotations match the text. Flag discrepancies.
4. **Attribution Per Level**: Include which file each level was extracted from in the source field (e.g., "PharmD_KS levels.pdf + 4H_chart.png").
5. **Unified If/Then**: Merge all If/Then scenarios into a single list, deduplicating where conditions overlap.

## CRITICAL RULES
1. Extract EVERY price level mentioned — text AND chart annotations across ALL uploaded files
2. Use ONLY data from the uploaded documents. NEVER use your own market knowledge.
3. Quote the author's exact language wherever possible
4. If the document doesn't specify a field, use reasonable defaults but flag it
5. The JSON must be parseable — no trailing commas, no comments
6. Return ONLY the JSON object, nothing else`;

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: playbookSystemPrompt,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 16384,
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
        return res.status(500).json({ message: "Failed to process all uploaded files. Please try different file formats (PDF, PNG, JPG, CSV)." });
      }
      for (const path of tempFilePaths) {
        try { fs.unlinkSync(path); } catch {}
      }

      parts.push({ text: userMessage || `Analyze this document and extract a complete trading playbook for ${ticker.symbol}. Return ONLY the JSON structure.` });

      const result = await model.generateContent({ contents: [{ role: "user", parts }] });
      const rawText = result.response.text();

      let playbookData: any;
      try {
        playbookData = JSON.parse(rawText);
      } catch {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            playbookData = JSON.parse(jsonMatch[0].replace(/,\s*([}\]])/g, "$1"));
          } catch {
            return res.status(500).json({ message: "AI returned invalid JSON. Please try again." });
          }
        } else {
          return res.status(500).json({ message: "AI returned invalid JSON. Please try again." });
        }
      }

      if (!playbookData || typeof playbookData !== "object") {
        return res.status(500).json({ message: "AI returned invalid data structure. Please try again." });
      }
      if (!playbookData.structural_zones) {
        playbookData.structural_zones = { bullish_green: [], neutral_yellow: [], bearish_red: [] };
      }
      if (!playbookData.if_then_scenarios) playbookData.if_then_scenarios = [];
      if (!playbookData.key_events) playbookData.key_events = [];
      if (!playbookData.risk_factors) playbookData.risk_factors = [];
      if (!playbookData.execution_checklist) playbookData.execution_checklist = [];

      const playbook = await storage.createPlaybook({
        userId,
        tickerId,
        date: new Date().toISOString().split("T")[0],
        playbookData,
      });

      await storage.createChatMessage({
        userId,
        tickerId,
        role: "user",
        content: `[Playbook Generated] Uploaded: ${originalFilename}${userMessage ? ` — "${userMessage}"` : ""}`,
      });

      await storage.createChatMessage({
        userId,
        tickerId,
        role: "assistant",
        content: `📊 **Trading Playbook Generated**\n\n**Macro Theme:** ${playbookData.macro_theme || "N/A"}\n**Bias:** ${playbookData.bias || "Open"}\n\n${playbookData.thesis || "See playbook for details."}\n\n_View the full interactive playbook in the dashboard above._`,
      });

      res.status(201).json(playbook);
    } catch (err: any) {
      console.error("Analyze document error:", err);
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

      const todayStr = new Date().toISOString().split("T")[0];
      const tickerPlaybooks = await storage.getPlaybooksByTicker(tickerId, userId);
      const todayPlaybook = tickerPlaybooks.find(pb => pb.date === todayStr) || tickerPlaybooks[0] || null;

      let playbookContext = "No active playbook available.";
      if (todayPlaybook) {
        const pbData = todayPlaybook.playbookData as any;
        playbookContext = `## ACTIVE PLAYBOOK (${todayPlaybook.date})
Bias: ${pbData.bias || "Open"}
Macro Theme: ${pbData.macro_theme || "N/A"}
Thesis: ${pbData.thesis || "N/A"}

### Structural Zones:
GREEN (Bullish): ${JSON.stringify(pbData.structural_zones?.bullish_green || [])}
YELLOW (Neutral): ${JSON.stringify(pbData.structural_zones?.neutral_yellow || [])}
RED (Bearish): ${JSON.stringify(pbData.structural_zones?.bearish_red || [])}

### If/Then Scenarios:
${(pbData.if_then_scenarios || []).map((s: any) => `- ${s.condition} → ${s.outcome}`).join("\n")}

### Key Events:
${(pbData.key_events || []).map((e: any) => `- ${e.title} at ${e.time} (${e.impact})`).join("\n")}`;
      }

      const tacticalPrompt = `You are a Tactical Trading Assistant for ${ticker.symbol} in the Action Dashboard. You provide real-time execution guidance during live trading sessions.

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

## RESPONSE FORMAT
Keep responses concise and actionable for a live trading session:
- **Current Price**: [from chart]
- **Zone**: [Green/Yellow/Red based on playbook]
- **Active Scenario**: [matching If/Then from playbook]
- **Guidance**: [1-2 sentences of actionable advice]

${playbookContext}`;

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
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
        for (const path of tempFilePaths) {
          try { fs.unlinkSync(path); } catch {}
        }
      }

      const fileNames = uploadedFiles.map(f => f.originalname).join(", ");
      parts.push({ text: content || "Analyze this chart screenshot. What price am I at and what does the playbook say?" });

      await storage.createChatMessage({ userId, tickerId, role: "user", content: content || (uploadedFiles.length > 0 ? `[${uploadedFiles.length} file${uploadedFiles.length > 1 ? "s" : ""}: ${fileNames}]` : "[Chart Screenshot uploaded]") });

      const result = await model.generateContent({ contents: [{ role: "user", parts }] });
      const aiText = result.response.text();

      const aiMsg = await storage.createChatMessage({ userId, tickerId, role: "assistant", content: aiText });

      res.json({ userMessage: { role: "user", content }, aiMessage: aiMsg });
    } catch (err: any) {
      console.error("Tactical chat error:", err);
      res.status(500).json({ message: err.message || "Tactical analysis failed" });
    } finally {
      for (const path of tempFilePaths) {
        try { fs.unlinkSync(path); } catch {}
      }
    }
  });

  return httpServer;
}
