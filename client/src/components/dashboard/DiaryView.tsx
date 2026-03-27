import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  fetchDiaryEntries, generateDiary, updateDiary, sendDiaryChat,
  fetchChatByTicker,
  checkDateActivity,
  regenerateDiary,
  type DiaryEntry, type DiaryAnalysis, type TickerData, type ChatMsg, type DateCheckResult,
} from "@/lib/api";
import {
  CalendarDays, FileText, Loader2, CheckCircle2, XCircle,
  TrendingUp, TrendingDown, Minus, Award, BookOpen, ArrowRight,
  Lightbulb, Target, Shield, ShieldAlert, ChevronDown, ChevronRight,
  Lock, Pencil, Menu, Image, MessageCircle, Send, X, Upload,
  Compass, Printer, Columns2, GitCompare, AlertTriangle, Clock,
  MessageSquare, Calendar, RefreshCw, ImageOff, ZoomIn, FileDown,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { motion, AnimatePresence } from "framer-motion";

function getGradeColor(grade: string | null) {
  if (!grade) return "text-muted-foreground";
  switch (grade.toUpperCase()) {
    case "A": return "text-emerald-400";
    case "B": return "text-blue-400";
    case "C": return "text-amber-400";
    case "D": return "text-orange-400";
    case "F": return "text-red-400";
    default: return "text-muted-foreground";
  }
}

function getGradeBg(grade: string | null) {
  if (!grade) return "bg-muted/30";
  switch (grade.toUpperCase()) {
    case "A": return "bg-emerald-500/10 border-emerald-500/30";
    case "B": return "bg-blue-500/10 border-blue-500/30";
    case "C": return "bg-amber-500/10 border-amber-500/30";
    case "D": return "bg-orange-500/10 border-orange-500/30";
    case "F": return "bg-red-500/10 border-red-500/30";
    default: return "bg-muted/30 border-border";
  }
}

function getBiasIcon(bias: string | null) {
  if (!bias) return <Minus className="h-3.5 w-3.5" />;
  switch (bias.toLowerCase()) {
    case "bullish": return <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />;
    case "bearish": return <TrendingDown className="h-3.5 w-3.5 text-red-400" />;
    default: return <Minus className="h-3.5 w-3.5 text-amber-400" />;
  }
}

function getOutcomeColor(outcome: string) {
  switch (outcome?.toUpperCase()) {
    case "TREND_CONTINUATION": return "text-emerald-400 bg-emerald-500/10";
    case "REVERSAL": return "text-red-400 bg-red-500/10";
    case "FAILED_BREAKOUT": return "text-orange-400 bg-orange-500/10";
    case "CHOP": return "text-amber-400 bg-amber-500/10";
    case "STABILIZED": return "text-blue-400 bg-blue-500/10";
    default: return "text-muted-foreground bg-muted/30";
  }
}

interface CollapsiblePillarProps {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  accentColor?: string;
}

function CollapsiblePillar({ title, icon, defaultOpen = true, children, accentColor = "border-border" }: CollapsiblePillarProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className={cn("border rounded-lg overflow-hidden", accentColor)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-card/50 hover:bg-card/80 transition-colors text-left"
        data-testid={`button-pillar-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        {icon}
        <span className="text-sm font-bold font-mono tracking-wide uppercase flex-1">{title}</span>
        <motion.div
          animate={{ rotate: isOpen ? 90 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="gpu-accelerated"
            style={{ overflow: "hidden" }}
          >
            <div className="px-4 pb-4 pt-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const chartColorMap: Record<string, { active: string; idle: string }> = {
  amber: { active: "border-amber-500/50 bg-amber-500/5", idle: "border-border hover:border-muted-foreground/40" },
  emerald: { active: "border-emerald-500/50 bg-emerald-500/5", idle: "border-border hover:border-muted-foreground/40" },
  blue: { active: "border-blue-500/50 bg-blue-500/5", idle: "border-border hover:border-muted-foreground/40" },
  violet: { active: "border-violet-500/50 bg-violet-500/5", idle: "border-border hover:border-muted-foreground/40" },
};

interface ChartUploadSlotProps {
  label: string;
  sublabel: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  required?: boolean;
  color: string;
}

function ChartUploadSlot({ label, sublabel, file, onFileChange, required, color }: ChartUploadSlotProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) onFileChange(f);
  }, [onFileChange]);

  const colors = chartColorMap[color] || chartColorMap.emerald;

  return (
    <div
      className={cn(
        "border-2 border-dashed rounded-lg p-3 text-center transition-colors cursor-pointer hover:border-opacity-80",
        file ? colors.active : colors.idle
      )}
      onClick={() => inputRef.current?.click()}
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
      data-testid={`dropzone-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFileChange(f); }}
      />
      {file && previewUrl ? (
        <div className="space-y-2">
          <img src={previewUrl} alt={label} className="w-full h-24 object-contain rounded" />
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[120px]">{file.name}</span>
            <button
              onClick={e => { e.stopPropagation(); onFileChange(null); }}
              className="p-0.5 rounded hover:bg-muted/30"
              data-testid={`button-remove-${label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          </div>
        </div>
      ) : (
        <div className="py-3 space-y-1.5">
          <Upload className="h-5 w-5 mx-auto text-muted-foreground/40" />
          <p className="text-xs font-bold font-mono">{label}{required && <span className="text-red-400">*</span>}</p>
          <p className="text-[10px] text-muted-foreground/60">{sublabel}</p>
        </div>
      )}
    </div>
  );
}

function TabbedChartViewer({ entry, onImageClick }: { entry: DiaryEntry; onImageClick?: (src: string, alt: string) => void }) {
  const [activeHtfTab, setActiveHtfTab] = useState<"daily" | "weekly" | "monthly">("daily");
  const [brokenUrls, setBrokenUrls] = useState<Set<string>>(new Set());

  const htfTabs = [
    { key: "daily" as const, label: "1D", url: entry.dailyChartUrl, color: "text-emerald-400 border-emerald-400" },
    { key: "weekly" as const, label: "1W", url: entry.weeklyChartUrl, color: "text-blue-400 border-blue-400" },
    { key: "monthly" as const, label: "1M", url: entry.monthlyChartUrl, color: "text-violet-400 border-violet-400" },
  ].filter(t => t.url);

  const hasIntraday = !!entry.intradayChartUrl;
  const hasHtf = htfTabs.length > 0;

  if (!hasIntraday && !hasHtf) return null;

  const htfActiveUrl = htfTabs.find(t => t.key === activeHtfTab)?.url || htfTabs[0]?.url;

  return (
    <div className="space-y-3" data-testid="tabbed-chart-viewer">
      {/* Primary: Intraday Execution Tape */}
      {hasIntraday && (
        <div className="border border-amber-500/30 rounded-lg overflow-hidden bg-card/30">
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/5 border-b border-amber-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span className="text-[10px] font-bold font-mono uppercase tracking-widest text-amber-400">Execution Tape — Intraday Session</span>
          </div>
          <div className="p-2 bg-black/20">
            {brokenUrls.has(entry.intradayChartUrl!) ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <ImageOff className="h-8 w-8 opacity-40" />
                <span className="text-xs font-mono">Image Missing</span>
              </div>
            ) : (
              <img
                src={entry.intradayChartUrl!}
                alt="Intraday session chart"
                className="w-full max-h-[500px] object-contain rounded cursor-pointer hover:opacity-90 transition-opacity"
                data-testid="img-chart-intraday"
                onClick={() => onImageClick?.(entry.intradayChartUrl!, "Intraday session chart")}
                onError={() => setBrokenUrls(prev => new Set(prev).add(entry.intradayChartUrl!))}
              />
            )}
          </div>
        </div>
      )}
      {/* Secondary: HTF Context */}
      {hasHtf && (
        <div className="border border-border rounded-lg overflow-hidden bg-card/30">
          <div className="flex items-center border-b border-border bg-muted/20">
            <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest px-3 py-1.5 border-r border-border shrink-0">HTF Context</span>
            {htfTabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveHtfTab(tab.key)}
                className={cn(
                  "flex-1 px-3 py-1.5 text-[10px] font-bold font-mono uppercase tracking-wide transition-all border-b-2",
                  activeHtfTab === tab.key ? tab.color : "text-muted-foreground border-transparent hover:text-foreground"
                )}
                data-testid={`tab-chart-${tab.key}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="p-2 bg-black/20">
            {htfActiveUrl && brokenUrls.has(htfActiveUrl) ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                <ImageOff className="h-6 w-6 opacity-40" />
                <span className="text-xs font-mono">Image Missing</span>
              </div>
            ) : (
              <img
                src={htfActiveUrl!}
                alt={`${activeHtfTab} closing candle`}
                className="w-full max-h-[280px] object-contain rounded cursor-pointer hover:opacity-90 transition-opacity"
                data-testid={`img-chart-${activeHtfTab}`}
                onClick={() => htfActiveUrl && onImageClick?.(htfActiveUrl, `${activeHtfTab} closing candle`)}
                onError={() => { if (htfActiveUrl) setBrokenUrls(prev => new Set(prev).add(htfActiveUrl)); }}
              />
            )}
          </div>
        </div>
      )}
      {/* Print-only: all charts stacked */}
      <div className="print-charts-all">
        {hasIntraday && (
          <div className="print-chart-item">
            <div className="print-chart-label">Intraday Session Chart</div>
            {!brokenUrls.has(entry.intradayChartUrl!) ? (
              <img src={entry.intradayChartUrl!} alt="Intraday chart" style={{ width: "100%" }} />
            ) : (
              <div style={{ padding: "8px", color: "#9ca3af", fontSize: "10px" }}>Image Missing</div>
            )}
          </div>
        )}
        {htfTabs.map(tab => (
          <div key={tab.key} className="print-chart-item">
            <div className="print-chart-label">{tab.key === "daily" ? "1D" : tab.key === "weekly" ? "1W" : "1M"} Candle Chart</div>
            {!brokenUrls.has(tab.url!) ? (
              <img src={tab.url!} alt={`${tab.label} closing candle`} style={{ width: "100%" }} />
            ) : (
              <div style={{ padding: "8px", color: "#9ca3af", fontSize: "10px" }}>Image Missing</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CompareModal({ intradayChartUrl, morningThesis, planAdherence, open, onClose }: {
  intradayChartUrl: string;
  morningThesis: string | null;
  planAdherence: DiaryAnalysis["plan_adherence"] | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-base flex items-center gap-2">
            <Columns2 className="h-4 w-4 text-primary" />
            Plan vs. Reality
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Morning playbook thesis and predicted levels vs. the intraday execution tape
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <span className="text-[10px] font-mono text-amber-400 uppercase font-bold">Morning Playbook Thesis</span>
            <div className="bg-muted/20 rounded-lg p-3 border border-amber-500/20 min-h-[200px]">
              <p className="text-xs text-foreground/80 whitespace-pre-line leading-relaxed">
                {morningThesis || "No morning playbook was recorded for this session."}
              </p>
            </div>
            {planAdherence && (
              <div className="space-y-2">
                {planAdherence.levels_defended?.length > 0 && (
                  <div>
                    <span className="text-[10px] font-mono text-emerald-400 uppercase block mb-1">Levels Defended</span>
                    {planAdherence.levels_defended.map((l, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[11px] text-emerald-300/80">
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                        <span className="font-mono font-bold">{l.price}</span> {l.label}
                      </div>
                    ))}
                  </div>
                )}
                {planAdherence.levels_lost?.length > 0 && (
                  <div>
                    <span className="text-[10px] font-mono text-red-400 uppercase block mb-1">Levels Lost</span>
                    {planAdherence.levels_lost.map((l, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[11px] text-red-300/80">
                        <XCircle className="h-3 w-3 shrink-0" />
                        <span className="font-mono font-bold">{l.price}</span> {l.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <span className="text-[10px] font-mono text-amber-400 uppercase font-bold">Execution Tape — Intraday Session</span>
            <div className="bg-black/20 rounded-lg overflow-hidden border border-amber-500/20">
              <img
                src={intradayChartUrl}
                alt="Intraday session chart"
                className="w-full object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getNYDateStr() {
  const nowNY = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  return `${nowNY.getFullYear()}-${String(nowNY.getMonth() + 1).padStart(2, "0")}-${String(nowNY.getDate()).padStart(2, "0")}`;
}


function TimelineImageCard({ img, index, onImageClick }: {
  img: { filename: string; path: string; context?: string; uploadedAt?: string; timestamp?: string; ai_critique?: string; is_critical?: boolean };
  index: number;
  onImageClick: (src: string, alt: string) => void;
}) {
  const [isBroken, setIsBroken] = useState(false);
  return (
    <div className="relative pl-6 border-l-2 border-cyan-500/30" data-testid={`timeline-moment-${index}`}>
      <div className="absolute left-[-5px] top-2 w-2.5 h-2.5 rounded-full bg-cyan-400 border-2 border-background" />
      <div className="flex items-center gap-2 mb-2">
        <Badge className="text-[9px] bg-cyan-500/10 text-cyan-400 border-cyan-500/30 font-mono">
          {img.timestamp || img.uploadedAt?.split("T")[1]?.slice(0, 5) || "—"}
        </Badge>
        <span className="text-[10px] font-mono text-muted-foreground truncate" title={img.filename}>
          {img.filename}
        </span>
      </div>
      <div className="border border-border/50 rounded-lg overflow-hidden bg-muted/10">
        <div className="aspect-video bg-black/20 relative group">
          {isBroken ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-1">
              <ImageOff className="h-6 w-6 opacity-40" />
              <span className="text-[10px] font-mono">Image Missing</span>
            </div>
          ) : (
            <>
              <img
                src={img.path}
                alt={img.filename}
                className="w-full h-full max-h-[400px] object-contain cursor-pointer"
                loading="lazy"
                data-testid={`img-visual-proof-${index}`}
                onClick={() => onImageClick(img.path, img.filename)}
                onError={() => setIsBroken(true)}
              />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <ZoomIn className="h-6 w-6 text-white/70 drop-shadow-lg" />
              </div>
            </>
          )}
        </div>
      </div>
      {img.is_critical !== false && (img.context || img.ai_critique) && (
        <div className="mt-2 bg-cyan-500/5 border border-cyan-500/10 rounded-md p-2.5">
          {img.context && (
            <p className="text-[11px] text-foreground/70 mb-1">{img.context}</p>
          )}
          {img.ai_critique && (
            <p className="text-[11px] text-cyan-300/80 italic" data-testid={`text-ai-critique-${index}`}>
              {img.ai_critique}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ImageLightbox({ src, alt, open, onClose }: { src: string; alt: string; open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-black/95 border-border max-w-[95vw] max-h-[95vh] p-2">
        <DialogHeader className="sr-only">
          <DialogTitle>{alt}</DialogTitle>
          <DialogDescription>Enlarged image view</DialogDescription>
        </DialogHeader>
        <img
          src={src}
          alt={alt}
          className="w-full h-full max-h-[85vh] object-contain rounded"
          data-testid="img-lightbox"
        />
      </DialogContent>
    </Dialog>
  );
}

interface DiaryViewProps {
  activeTicker: TickerData | null;
}

export function DiaryView({ activeTicker }: DiaryViewProps) {
  const [selectedDiaryId, setSelectedDiaryId] = useState<number | null>(null);
  const [closingThought, setClosingThought] = useState("");
  const [isEditingThought, setIsEditingThought] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<{ src: string; alt: string } | null>(null);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [intradayChart, setIntradayChart] = useState<File | null>(null);
  const [dailyChart, setDailyChart] = useState<File | null>(null);
  const [weeklyChart, setWeeklyChart] = useState<File | null>(null);
  const [monthlyChart, setMonthlyChart] = useState<File | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(getNYDateStr());
  const [genProgress, setGenProgress] = useState<string | null>(null);
  const genTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearGenTimers = useCallback(() => {
    genTimersRef.current.forEach(t => clearTimeout(t));
    genTimersRef.current = [];
  }, []);

  const prevTickerIdRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (prevTickerIdRef.current !== activeTicker?.id) {
      prevTickerIdRef.current = activeTicker?.id;
      setSelectedDiaryId(null);
      setClosingThought("");
      setIsEditingThought(false);
      setChatMessages([]);
      setChatOpen(false);
    }
  }, [activeTicker?.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const { data: diaryEntries = [], isLoading } = useQuery<DiaryEntry[]>({
    queryKey: ["/api/tickers", activeTicker?.id, "diary"],
    queryFn: () => fetchDiaryEntries(activeTicker!.id),
    enabled: !!activeTicker,
  });

  const { data: tickerChatMessages = [] } = useQuery<ChatMsg[]>({
    queryKey: ["/api/tickers", activeTicker?.id, "chat", "diary-check"],
    queryFn: () => fetchChatByTicker(activeTicker!.id),
    enabled: !!activeTicker,
    staleTime: 30000,
  });

  const hasDateChat = useMemo(() => {
    if (tickerChatMessages.length === 0) return false;
    return tickerChatMessages.some((m) => {
      if (!m.createdAt || m.role !== "user") return false;
      const msgNY = new Date(new Date(m.createdAt).toLocaleString("en-US", { timeZone: "America/New_York" }));
      const msgDateStr = `${msgNY.getFullYear()}-${String(msgNY.getMonth() + 1).padStart(2, "0")}-${String(msgNY.getDate()).padStart(2, "0")}`;
      return msgDateStr === selectedDate;
    });
  }, [tickerChatMessages, selectedDate]);

  const { data: dateCheck } = useQuery<DateCheckResult>({
    queryKey: ["/api/diary/date-check", activeTicker?.id, selectedDate],
    queryFn: () => checkDateActivity(activeTicker!.id, selectedDate),
    enabled: !!activeTicker && !!selectedDate && showUploadModal,
    staleTime: 10000,
  });

  const selectedEntry = useMemo(() => {
    if (!selectedDiaryId) return diaryEntries[0] || null;
    return diaryEntries.find(e => e.id === selectedDiaryId) || null;
  }, [diaryEntries, selectedDiaryId]);

  const generateMutation = useMutation({
    mutationFn: () => {
      const dateToUse = selectedDate || getNYDateStr();
      return generateDiary(activeTicker!.id, dateToUse, {
        intraday: intradayChart || undefined,
        daily: dailyChart || undefined,
        weekly: weeklyChart || undefined,
        monthly: monthlyChart || undefined,
      });
    },
    onMutate: () => {
      setShowUploadModal(false);
      clearGenTimers();
      const hasIntraday = !!intradayChart;
      const hasCharts = !!(intradayChart || dailyChart || weeklyChart || monthlyChart);
      setGenProgress(hasCharts ? "Uploading charts..." : "Analyzing chat history...");
      if (hasIntraday) {
        genTimersRef.current.push(setTimeout(() => setGenProgress("Reading Execution Tape..."), 2000));
        genTimersRef.current.push(setTimeout(() => setGenProgress("Running Blueprint Alignment Audit..."), 5000));
        genTimersRef.current.push(setTimeout(() => setGenProgress("Synthesizing Settlement Audit..."), 8000));
      } else if (hasCharts) {
        genTimersRef.current.push(setTimeout(() => setGenProgress("Reviewing HTF candle structure..."), 2000));
        genTimersRef.current.push(setTimeout(() => setGenProgress("Running Blueprint Alignment Audit..."), 5000));
        genTimersRef.current.push(setTimeout(() => setGenProgress("Generating post-mortem..."), 8000));
      } else {
        genTimersRef.current.push(setTimeout(() => setGenProgress("Building Chat Recap..."), 2000));
        genTimersRef.current.push(setTimeout(() => setGenProgress("Running Blueprint Alignment Audit..."), 5000));
        genTimersRef.current.push(setTimeout(() => setGenProgress("Generating post-mortem..."), 8000));
      }
    },
    onSuccess: (entry) => {
      clearGenTimers();
      setGenProgress(null);
      setIntradayChart(null);
      setDailyChart(null);
      setWeeklyChart(null);
      setMonthlyChart(null);
      queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "diary"] });
      setSelectedDiaryId(entry.id);
      toast({ title: "Diary Generated", description: `Settlement Audit for ${entry.date} created` });
    },
    onError: (err: Error) => {
      clearGenTimers();
      setGenProgress(null);
      toast({ title: "Generation Failed", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: number; userClosingThought?: string; isFinalized?: boolean }) =>
      updateDiary(data.id, { userClosingThought: data.userClosingThought, isFinalized: data.isFinalized }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "diary"] });
      setIsEditingThought(false);
      setShowFinalizeModal(false);
      toast({ title: "Diary Updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    },
  });

  const regenMutation = useMutation({
    mutationFn: (diaryId: number) => regenerateDiary(diaryId),
    onMutate: () => {
      setGenProgress("Re-generating analysis...");
    },
    onSuccess: () => {
      setGenProgress(null);
      queryClient.invalidateQueries({ queryKey: ["/api/tickers", activeTicker?.id, "diary"] });
      toast({ title: "Analysis Re-generated", description: "The AI has re-analyzed your diary entry." });
    },
    onError: (err: Error) => {
      setGenProgress(null);
      toast({ title: "Re-generation Failed", description: err.message, variant: "destructive" });
    },
  });

  const chatMutation = useMutation({
    mutationFn: (message: string) => sendDiaryChat(selectedEntry!.id, message),
    onSuccess: (data) => {
      setChatMessages(prev => [...prev, { role: "assistant", content: data.message }]);
    },
    onError: () => {
      setChatMessages(prev => [...prev, { role: "assistant", content: "Sorry, I couldn't process that. Please try again." }]);
    },
  });

  const analysis = selectedEntry?.aiAnalysis as DiaryAnalysis | null;

  const handleSaveThought = () => {
    if (!selectedEntry) return;
    updateMutation.mutate({ id: selectedEntry.id, userClosingThought: closingThought });
  };

  const handleFinalizeClick = () => {
    if (!selectedEntry) return;
    setShowFinalizeModal(true);
  };

  const handleConfirmFinalize = () => {
    if (!selectedEntry) return;
    updateMutation.mutate({
      id: selectedEntry.id,
      isFinalized: true,
      userClosingThought: closingThought || selectedEntry.userClosingThought || undefined,
    });
  };

  const handleSendChat = () => {
    if (!chatInput.trim() || !selectedEntry || chatMutation.isPending) return;
    const msg = chatInput.trim();
    setChatMessages(prev => [...prev, { role: "user", content: msg }]);
    setChatInput("");
    chatMutation.mutate(msg);
  };

  const handleOpenUploadModal = () => {
    setDailyChart(null);
    setWeeklyChart(null);
    setMonthlyChart(null);
    setSelectedDate(getNYDateStr());
    setShowUploadModal(true);
  };

  const hasActivityChat = dateCheck ? dateCheck.hasChat : hasDateChat;
  const hasIntradayChart = !!intradayChart;
  const hasAnyChart = !!(intradayChart || dailyChart || weeklyChart || monthlyChart);
  // Intraday chart OR chat history required — HTF-only uploads are not sufficient
  const canGenerate = hasIntradayChart || hasActivityChat;

  const handlePrint = () => {
    const ticker = activeTicker?.symbol || "Ticker";
    const date = selectedEntry?.date || new Date().toISOString().split("T")[0];
    const originalTitle = document.title;
    document.title = `TraderNotes_Diary_${ticker}_${date}`;
    window.print();
    document.title = originalTitle;
  };

  const [isExportingPDF, setIsExportingPDF] = useState(false);

  const handleExportPDF = async () => {
    if (!reportRef.current || isExportingPDF) return;
    setIsExportingPDF(true);
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: html2canvas } = await import("html2canvas");
      const ticker = activeTicker?.symbol || "Ticker";
      const date = selectedEntry?.date || new Date().toISOString().split("T")[0];
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#0D0D0D",
        logging: false,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let yOffset = 0;
      let remaining = imgHeight;
      while (remaining > 0) {
        if (yOffset > 0) pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, -yOffset, imgWidth, imgHeight);
        yOffset += pageHeight;
        remaining -= pageHeight;
      }
      pdf.save(`TraderNotes_Diary_${ticker}_${date}.pdf`);
    } catch (err) {
      console.error("PDF export error:", err);
    } finally {
      setIsExportingPDF(false);
    }
  };

  const morningThesis = useMemo(() => {
    if (!analysis) return null;
    const parts: string[] = [];
    if (analysis.plan_adherence?.grade_rationale) parts.push(`Grade Rationale: ${analysis.plan_adherence.grade_rationale}`);
    if (analysis.plan_adherence?.levels_defended?.length) {
      parts.push("Levels Defended: " + analysis.plan_adherence.levels_defended.map(l => `${l.price} (${l.label})`).join(", "));
    }
    if (analysis.plan_adherence?.scenarios_triggered?.length) {
      parts.push("Scenarios: " + analysis.plan_adherence.scenarios_triggered.map(s => s.scenario).join("\n"));
    }
    return parts.join("\n\n") || null;
  }, [analysis]);

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <Button
          onClick={handleOpenUploadModal}
          disabled={!activeTicker || generateMutation.isPending}
          size="sm"
          className="w-full h-9 text-xs font-bold font-mono tracking-wide bg-amber-600 hover:bg-amber-700 text-white"
          data-testid="button-generate-diary"
        >
          {generateMutation.isPending ? (
            <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin shrink-0" /> GENERATING...</>
          ) : (
            <><FileText className="mr-1.5 h-3.5 w-3.5 shrink-0" /> NEW ENTRY</>
          )}
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {diaryEntries.length === 0 && !isLoading && (
            <div className="text-center py-8 px-4">
              <CalendarDays className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-xs text-muted-foreground/60 font-mono">No diary entries yet</p>
              <p className="text-[10px] text-muted-foreground/40 mt-1">Generate your first post-mortem above</p>
            </div>
          )}
          {diaryEntries.map((entry, idx) => {
            const isSelected = selectedEntry?.id === entry.id;
            const dateObj = parseISO(entry.date);
            const nowNY = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
            const todayStr = `${nowNY.getFullYear()}-${String(nowNY.getMonth() + 1).padStart(2, "0")}-${String(nowNY.getDate()).padStart(2, "0")}`;
            const isToday = entry.date === todayStr;

            return (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05, duration: 0.25, ease: "easeOut" as const }}
                className="gpu-accelerated"
              >
                <motion.button
                  onClick={() => { setSelectedDiaryId(entry.id); setClosingThought(entry.userClosingThought || ""); setSidebarOpen(false); setChatMessages([]); setChatOpen(false); }}
                  className={cn(
                    "w-full text-left px-3 py-2.5 rounded-lg transition-colors border gpu-accelerated",
                    isSelected ? "bg-primary/10 border-primary/30" : "border-transparent hover:bg-muted/30"
                  )}
                  data-testid={`diary-entry-${entry.id}`}
                  whileHover={{ scale: 1.02, borderColor: "rgba(255,255,255,0.15)" }}
                  transition={{ duration: 0.1 }}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      {isToday ? (
                        <Badge className="text-[9px] bg-amber-500/20 text-amber-400 border-amber-500/30 px-1.5 py-0">TODAY</Badge>
                      ) : (
                        <span className="text-[10px] font-mono text-muted-foreground">{format(dateObj, "MMM d")}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 ml-auto">
                      {entry.planAdherenceGrade && entry.planAdherenceGrade !== "N/A" && (
                        <span className={cn("text-xs font-bold font-mono", getGradeColor(entry.planAdherenceGrade))}>
                          {entry.planAdherenceGrade}
                        </span>
                      )}
                      {getBiasIcon(entry.closingBias)}
                      {entry.isFinalized && <Lock className="h-3 w-3 text-muted-foreground/50" />}
                    </div>
                  </div>
                  <div className="mt-1">
                    <p className="text-[10px] text-muted-foreground/60 font-mono line-clamp-1">
                      {(entry.aiAnalysis as DiaryAnalysis | null)?.market_achievement?.session_outcome || "Report"}
                    </p>
                  </div>
                </motion.button>
              </motion.div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );

  if (!activeTicker) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-2">
          <BookOpen className="h-8 w-8 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">Select a ticker to view your Trading Diary</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {isMobile ? (
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0 bg-card">
            <SheetHeader className="sr-only">
              <SheetTitle>Diary Entries</SheetTitle>
            </SheetHeader>
            {sidebarContent}
          </SheetContent>
        </Sheet>
      ) : (
        <div className="w-64 border-r border-border bg-card/50 shrink-0 flex flex-col">
          {sidebarContent}
        </div>
      )}

      <div className="flex-1 overflow-hidden flex flex-col">
        {isMobile && (
          <div className="h-10 border-b border-border flex items-center px-3 bg-card/30 shrink-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors mr-2"
              data-testid="button-diary-sidebar-toggle"
            >
              <Menu className="h-4 w-4" />
            </button>
            <span className="text-xs font-mono text-muted-foreground">
              {selectedEntry ? format(parseISO(selectedEntry.date), "MMMM d, yyyy") : "Select an entry"}
            </span>
          </div>
        )}

        <ScrollArea className="flex-1">
          {genProgress && (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="text-center space-y-4 px-4">
                <div className="relative">
                  <Loader2 className="h-12 w-12 text-amber-400 animate-spin mx-auto" />
                </div>
                <motion.p
                  key={genProgress}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm font-mono text-amber-400"
                  data-testid="text-gen-progress"
                >
                  {genProgress}
                </motion.p>
                <div className="w-48 mx-auto h-1 bg-muted/30 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-amber-400/60 rounded-full"
                    initial={{ width: "5%" }}
                    animate={{ width: "90%" }}
                    transition={{ duration: 15, ease: "linear" }}
                  />
                </div>
              </div>
            </div>
          )}

          {!genProgress && !selectedEntry ? (
            <div className="flex items-center justify-center h-full min-h-[400px]">
              <div className="text-center space-y-3 px-4">
                <CalendarDays className="h-12 w-12 text-muted-foreground/20 mx-auto" />
                <h3 className="text-sm font-mono font-bold text-muted-foreground">Trading Diary</h3>
                <p className="text-xs text-muted-foreground/60 max-w-xs mx-auto">
                  Generate an end-of-day post-mortem that synthesizes your playbooks and chat history into an actionable review.
                </p>
                <Button
                  onClick={handleOpenUploadModal}
                  disabled={!activeTicker || generateMutation.isPending}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-bold font-mono text-xs tracking-wide"
                  data-testid="button-generate-diary-empty"
                >
                  <FileText className="mr-1.5 h-3.5 w-3.5 shrink-0" /> NEW ENTRY
                </Button>
              </div>
            </div>
          ) : !genProgress && selectedEntry ? (
            <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4 relative print-region" ref={reportRef}>
              <div className="print-header">
                <span className="print-header-left">TRADERNOTES AI</span>
                <span className="print-header-right">
                  {[activeTicker?.symbol, selectedEntry?.date].filter(Boolean).join(" | ")}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold font-mono" data-testid="text-diary-date">
                    {format(parseISO(selectedEntry.date), "EEEE, MMMM d, yyyy")}
                  </h2>
                  <div className="flex items-center gap-3 mt-1">
                    {analysis?.market_achievement?.session_outcome && (
                      <Badge className={cn("text-[10px] font-mono font-bold", getOutcomeColor(analysis.market_achievement.session_outcome))}>
                        {analysis.market_achievement.session_outcome.replace(/_/g, " ")}
                      </Badge>
                    )}
                    <div className="flex items-center gap-1">
                      {getBiasIcon(selectedEntry.closingBias)}
                      <span className="text-xs font-mono text-muted-foreground">{selectedEntry.closingBias || "Open"}</span>
                    </div>
                    {selectedEntry.isFinalized && (
                      <Badge variant="outline" className="text-[10px] border-muted-foreground/30">
                        <Lock className="h-2.5 w-2.5 mr-1" /> Finalized
                      </Badge>
                    )}
                  </div>
                </div>
                {selectedEntry.planAdherenceGrade && selectedEntry.planAdherenceGrade !== "N/A" && (
                  <div className={cn("flex flex-col items-center px-4 py-2 rounded-lg border", getGradeBg(selectedEntry.planAdherenceGrade))}>
                    <span className="text-[10px] font-mono text-muted-foreground uppercase">Grade</span>
                    <span className={cn("text-2xl font-black font-mono", getGradeColor(selectedEntry.planAdherenceGrade))} data-testid="text-diary-grade">
                      {selectedEntry.planAdherenceGrade}
                    </span>
                  </div>
                )}
              </div>

              {(selectedEntry.intradayChartUrl || selectedEntry.dailyChartUrl || selectedEntry.weeklyChartUrl || selectedEntry.monthlyChartUrl) && (
                <div className="space-y-2">
                  <TabbedChartViewer entry={selectedEntry} onImageClick={(src, alt) => setLightboxSrc({ src, alt })} />
                  {(selectedEntry.intradayChartUrl || selectedEntry.dailyChartUrl) && (
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-[10px] font-mono border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                        onClick={() => setShowCompareModal(true)}
                        data-testid="button-compare-morning"
                      >
                        <Columns2 className="h-3 w-3 mr-1.5 shrink-0" />
                        Compare with Morning Plan
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {(() => {
                const isFailedAnalysis = !analysis ||
                  analysis.plan_adherence?.grade === "N/A" ||
                  analysis.market_achievement?.summary?.includes("unavailable") ||
                  analysis.bigger_picture?.summary === "N/A";
                return isFailedAnalysis && !selectedEntry.isFinalized ? (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-center space-y-3" data-testid="section-regen-prompt">
                    <div className="flex items-center justify-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-400" />
                      <span className="text-sm font-mono font-bold text-amber-400">Analysis Incomplete</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      The AI analysis for this entry contains placeholder data — likely due to a service outage during generation.
                    </p>
                    <Button
                      onClick={() => regenMutation.mutate(selectedEntry.id)}
                      disabled={regenMutation.isPending}
                      className="bg-amber-600 hover:bg-amber-700 text-white font-bold font-mono text-xs tracking-wide"
                      data-testid="button-regenerate-analysis"
                    >
                      {regenMutation.isPending ? (
                        <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin shrink-0" /> RE-GENERATING...</>
                      ) : (
                        <><RefreshCw className="mr-1.5 h-3.5 w-3.5 shrink-0" /> RE-GENERATE ANALYSIS</>
                      )}
                    </Button>
                  </div>
                ) : null;
              })()}

              {analysis && (
                <>
                  <CollapsiblePillar
                    title="Market Achievement"
                    icon={<Target className="h-4 w-4 text-blue-400" />}
                    accentColor="border-blue-500/20"
                  >
                    <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-line" data-testid="text-market-achievement">
                      {analysis.market_achievement?.summary}
                    </p>
                    {analysis.market_achievement?.key_moves?.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        <span className="text-[10px] font-mono text-muted-foreground uppercase">Key Moves</span>
                        {analysis.market_achievement.key_moves.map((move, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                            <ArrowRight className="h-3 w-3 text-blue-400 mt-0.5 shrink-0" />
                            <span>{move}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CollapsiblePillar>

                  <CollapsiblePillar
                    title="Bigger Picture Alignment"
                    icon={<BookOpen className="h-4 w-4 text-violet-400" />}
                    accentColor="border-violet-500/20"
                  >
                    <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-line" data-testid="text-bigger-picture">
                      {analysis.bigger_picture?.summary}
                    </p>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-muted/20 rounded-md p-3">
                        <span className="text-[10px] font-mono text-muted-foreground uppercase block mb-1">Weekly Impact</span>
                        <p className="text-xs text-foreground/80">{analysis.bigger_picture?.weekly_impact}</p>
                      </div>
                      <div className="bg-muted/20 rounded-md p-3">
                        <span className="text-[10px] font-mono text-muted-foreground uppercase block mb-1">Monthly Impact</span>
                        <p className="text-xs text-foreground/80">{analysis.bigger_picture?.monthly_impact}</p>
                      </div>
                    </div>
                  </CollapsiblePillar>

                  <CollapsiblePillar
                    title="Plan Adherence"
                    icon={<Award className="h-4 w-4 text-amber-400" />}
                    accentColor="border-amber-500/20"
                  >
                    {analysis.plan_adherence?.grade_rationale && (
                      <p className="text-sm text-foreground/90 mb-3" data-testid="text-grade-rationale">
                        {analysis.plan_adherence.grade_rationale}
                      </p>
                    )}

                    {analysis.plan_adherence?.levels_defended?.length > 0 && (
                      <div className="mb-3">
                        <span className="text-[10px] font-mono text-emerald-400 uppercase block mb-1.5">Levels Defended</span>
                        <div className="space-y-1">
                          {analysis.plan_adherence.levels_defended.map((level, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs bg-emerald-500/5 rounded px-2 py-1.5 border border-emerald-500/10">
                              <Shield className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                              <span className="font-mono font-bold text-emerald-400">{level.price}</span>
                              <span className="text-foreground/70">{level.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {analysis.plan_adherence?.levels_lost?.length > 0 && (
                      <div className="mb-3">
                        <span className="text-[10px] font-mono text-red-400 uppercase block mb-1.5">Levels Lost</span>
                        <div className="space-y-1">
                          {analysis.plan_adherence.levels_lost.map((level, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs bg-red-500/5 rounded px-2 py-1.5 border border-red-500/10">
                              <ShieldAlert className="h-3.5 w-3.5 text-red-400 shrink-0" />
                              <span className="font-mono font-bold text-red-400">{level.price}</span>
                              <span className="text-foreground/70">{level.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {analysis.plan_adherence?.scenarios_triggered?.length > 0 && (
                      <div>
                        <span className="text-[10px] font-mono text-muted-foreground uppercase block mb-1.5">Scenarios Triggered</span>
                        <div className="space-y-1.5">
                          {analysis.plan_adherence.scenarios_triggered.map((s, i) => (
                            <div key={i} className="bg-muted/20 rounded-md p-2.5 border border-border/50">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-xs text-foreground/80 flex-1">{s.scenario}</p>
                                <span className={cn("text-xs font-bold font-mono shrink-0", getGradeColor(s.grade))}>{s.grade}</span>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-1">{s.result}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CollapsiblePillar>

                  {analysis.image_references && analysis.image_references.length > 0 && (
                    <CollapsiblePillar
                      title="Tactical Timeline"
                      icon={<Image className="h-4 w-4 text-cyan-400" />}
                      accentColor="border-cyan-500/20"
                      defaultOpen={true}
                    >
                      <div className="space-y-4">
                        {analysis.image_references.map((img, i) => (
                          <TimelineImageCard
                            key={i}
                            img={img}
                            index={i}
                            onImageClick={(src, alt) => setLightboxSrc({ src, alt })}
                          />
                        ))}
                      </div>
                    </CollapsiblePillar>
                  )}

                  {analysis.road_ahead && analysis.road_ahead !== "N/A" && (
                    <div className="bg-gradient-to-r from-indigo-500/10 to-violet-500/10 border border-indigo-500/30 rounded-lg p-4" data-testid="section-road-ahead">
                      <div className="flex items-center gap-2 mb-2">
                        <Compass className="h-4 w-4 text-indigo-400" />
                        <span className="text-xs font-bold font-mono text-indigo-400 uppercase">The Road Ahead</span>
                      </div>
                      <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-line" data-testid="text-road-ahead">
                        {analysis.road_ahead}
                      </p>
                    </div>
                  )}

                  {analysis.blueprint_alignment && (analysis.blueprint_alignment.weekly?.status !== "no_data" || analysis.blueprint_alignment.monthly?.status !== "no_data") && (
                    <CollapsiblePillar
                      title="Strategic Sync"
                      icon={<GitCompare className="h-4 w-4 text-teal-400" />}
                      accentColor="border-teal-500/20"
                      defaultOpen={true}
                    >
                      <div className="space-y-4">
                        {analysis.blueprint_alignment.weekly && analysis.blueprint_alignment.weekly.status !== "no_data" && (
                          <div data-testid="section-blueprint-weekly">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs font-bold font-mono text-blue-400">WEEKLY BLUEPRINT</span>
                              <Badge
                                className={cn(
                                  "text-[9px] font-mono border",
                                  analysis.blueprint_alignment.weekly.status === "in_line"
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                    : "bg-red-500/10 text-red-400 border-red-500/30"
                                )}
                                data-testid="badge-weekly-status"
                              >
                                {analysis.blueprint_alignment.weekly.status === "in_line" ? (
                                  <><CheckCircle2 className="h-2.5 w-2.5 mr-1 shrink-0" />IN-LINE</>
                                ) : (
                                  <><AlertTriangle className="h-2.5 w-2.5 mr-1 shrink-0" />DIVERGED</>
                                )}
                              </Badge>
                            </div>
                            {analysis.blueprint_alignment.weekly.checked_events?.length > 0 && (
                              <div className="space-y-1.5 mb-2">
                                {analysis.blueprint_alignment.weekly.checked_events.map((evt, i) => (
                                  <div key={i} className="flex items-start gap-2 text-[11px] pl-2 border-l-2 border-blue-500/20" data-testid={`blueprint-weekly-event-${i}`}>
                                    {evt.result === "passed" ? (
                                      <CheckCircle2 className="h-3 w-3 text-emerald-400 mt-0.5 shrink-0" />
                                    ) : evt.result === "failed" ? (
                                      <XCircle className="h-3 w-3 text-red-400 mt-0.5 shrink-0" />
                                    ) : (
                                      <Clock className="h-3 w-3 text-amber-400 mt-0.5 shrink-0" />
                                    )}
                                    <div>
                                      <span className="font-mono font-bold text-foreground/80">{evt.event}</span>
                                      {evt.deadline && <span className="text-muted-foreground ml-1">({evt.deadline})</span>}
                                      <p className="text-muted-foreground/80">{evt.explanation}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            <p className="text-[11px] text-foreground/70 italic">{analysis.blueprint_alignment.weekly.rationale}</p>
                          </div>
                        )}

                        {analysis.blueprint_alignment.monthly && analysis.blueprint_alignment.monthly.status !== "no_data" && (
                          <div data-testid="section-blueprint-monthly">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs font-bold font-mono text-violet-400">MONTHLY BLUEPRINT</span>
                              <Badge
                                className={cn(
                                  "text-[9px] font-mono border",
                                  analysis.blueprint_alignment.monthly.status === "diverged"
                                    ? "bg-red-500/10 text-red-400 border-red-500/30"
                                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                )}
                                data-testid="badge-monthly-status"
                              >
                                {analysis.blueprint_alignment.monthly.status === "diverged" ? (
                                  <><AlertTriangle className="h-2.5 w-2.5 mr-1 shrink-0" />DIVERGED</>
                                ) : (
                                  <><CheckCircle2 className="h-2.5 w-2.5 mr-1 shrink-0" />HOLDING</>
                                )}
                              </Badge>
                            </div>
                            {analysis.blueprint_alignment.monthly.checked_events?.length > 0 && (
                              <div className="space-y-1.5 mb-2">
                                {analysis.blueprint_alignment.monthly.checked_events.map((evt, i) => (
                                  <div key={i} className="flex items-start gap-2 text-[11px] pl-2 border-l-2 border-violet-500/20" data-testid={`blueprint-monthly-event-${i}`}>
                                    {evt.result === "passed" ? (
                                      <CheckCircle2 className="h-3 w-3 text-emerald-400 mt-0.5 shrink-0" />
                                    ) : evt.result === "failed" ? (
                                      <XCircle className="h-3 w-3 text-red-400 mt-0.5 shrink-0" />
                                    ) : (
                                      <Clock className="h-3 w-3 text-amber-400 mt-0.5 shrink-0" />
                                    )}
                                    <div>
                                      <span className="font-mono font-bold text-foreground/80">{evt.event}</span>
                                      {evt.deadline && <span className="text-muted-foreground ml-1">({evt.deadline})</span>}
                                      <p className="text-muted-foreground/80">{evt.explanation}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            <p className="text-[11px] text-foreground/70 italic">{analysis.blueprint_alignment.monthly.rationale}</p>
                          </div>
                        )}
                      </div>
                    </CollapsiblePillar>
                  )}

                  {analysis.chat_recap && analysis.chat_recap.length > 0 && (!analysis.image_references || analysis.image_references.length === 0) && (
                    <CollapsiblePillar
                      title="Chat Recap"
                      icon={<MessageSquare className="h-4 w-4 text-sky-400" />}
                      accentColor="border-sky-500/20"
                      defaultOpen={true}
                    >
                      <div className="space-y-3">
                        {analysis.chat_recap.map((item, i) => (
                          <div key={i} className="pl-3 border-l-2 border-sky-500/20" data-testid={`chat-recap-${i}`}>
                            <div className="flex items-start gap-2">
                              {item.timestamp && (
                                <Badge className="text-[9px] bg-sky-500/10 text-sky-400 border-sky-500/30 font-mono shrink-0">
                                  {item.timestamp}
                                </Badge>
                              )}
                              <p className="text-[11px] font-bold text-foreground/80">{item.question}</p>
                            </div>
                            <p className="text-[11px] text-foreground/60 mt-1">{item.answer}</p>
                          </div>
                        ))}
                      </div>
                    </CollapsiblePillar>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Lightbulb className="h-4 w-4 text-amber-400" />
                        <span className="text-xs font-bold font-mono text-amber-400 uppercase">Lesson of the Day</span>
                      </div>
                      <p className="text-sm text-foreground/90" data-testid="text-lesson">{analysis.lesson_of_the_day}</p>
                    </div>
                    <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <ArrowRight className="h-4 w-4 text-blue-400" />
                        <span className="text-xs font-bold font-mono text-blue-400 uppercase">Prep for Tomorrow</span>
                      </div>
                      <p className="text-sm text-foreground/90" data-testid="text-prep">{analysis.prep_for_tomorrow}</p>
                    </div>
                  </div>
                </>
              )}

              <div className="border border-border rounded-lg p-4 bg-card/30">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Pencil className="h-4 w-4 text-primary" />
                    <span className="text-xs font-bold font-mono uppercase">Closing Thought</span>
                  </div>
                  {selectedEntry.isFinalized ? (
                    <Badge variant="outline" className="text-[9px]">
                      <Lock className="h-2.5 w-2.5 mr-1" /> Locked
                    </Badge>
                  ) : (
                    <div className="flex gap-2">
                      {isEditingThought ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-[10px]"
                            onClick={() => { setIsEditingThought(false); setClosingThought(selectedEntry.userClosingThought || ""); }}
                            data-testid="button-cancel-thought"
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 text-[10px] bg-primary"
                            onClick={handleSaveThought}
                            disabled={updateMutation.isPending}
                            data-testid="button-save-thought"
                          >
                            Save
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[10px]"
                          onClick={() => { setIsEditingThought(true); setClosingThought(selectedEntry.userClosingThought || ""); }}
                          data-testid="button-edit-thought"
                        >
                          <Pencil className="h-3 w-3 mr-1" /> Edit
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {selectedEntry.isFinalized ? (
                  <p className="text-sm text-foreground/80" data-testid="text-closing-thought">
                    {selectedEntry.userClosingThought || "No closing thought recorded."}
                  </p>
                ) : isEditingThought ? (
                  <Textarea
                    value={closingThought}
                    onChange={(e) => setClosingThought(e.target.value)}
                    placeholder="Record your personal reflection on today's session..."
                    className="min-h-[80px] text-sm bg-transparent border-muted resize-none"
                    data-testid="input-closing-thought"
                  />
                ) : (
                  <p className="text-sm text-foreground/80 cursor-pointer hover:text-foreground transition-colors"
                     onClick={() => { setIsEditingThought(true); setClosingThought(selectedEntry.userClosingThought || ""); }}
                     data-testid="text-closing-thought"
                  >
                    {selectedEntry.userClosingThought || "Click to add your closing thought..."}
                  </p>
                )}
              </div>

              {!selectedEntry.isFinalized && (
                <div className="flex justify-end gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setChatOpen(!chatOpen)}
                    className="font-mono text-xs tracking-wide border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                    data-testid="button-talk-to-past"
                  >
                    <MessageCircle className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                    TALK TO THE PAST
                  </Button>
                  <Button
                    onClick={handleFinalizeClick}
                    disabled={updateMutation.isPending}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold font-mono text-xs tracking-wide"
                    data-testid="button-finalize-diary"
                  >
                    <Lock className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                    FINALIZE DIARY
                  </Button>
                </div>
              )}

              {selectedEntry.isFinalized && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    onClick={() => setChatOpen(!chatOpen)}
                    className="font-mono text-xs tracking-wide border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                    data-testid="button-talk-to-past-finalized"
                  >
                    <MessageCircle className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                    TALK TO THE PAST
                  </Button>
                </div>
              )}

              {chatOpen && (
                <div className="border border-cyan-500/20 rounded-lg overflow-hidden bg-card/30" data-testid="diary-chat-container">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-cyan-500/5 border-b border-cyan-500/20">
                    <MessageCircle className="h-4 w-4 text-cyan-400 shrink-0" />
                    <span className="text-xs font-bold font-mono text-cyan-400 uppercase flex-1">Talk to the Past</span>
                    <button onClick={() => setChatOpen(false)} className="p-1 hover:bg-muted/30 rounded">
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto p-3 space-y-3">
                    {chatMessages.length === 0 && (
                      <p className="text-xs text-muted-foreground/60 text-center py-4 font-mono">
                        Ask questions about this past session to extract deeper lessons...
                      </p>
                    )}
                    {chatMessages.map((msg, i) => (
                      <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                        <div className={cn(
                          "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                          msg.role === "user"
                            ? "bg-primary/20 text-foreground"
                            : "bg-muted/30 text-foreground/90"
                        )} data-testid={`chat-message-${msg.role}-${i}`}>
                          <p className="whitespace-pre-line text-xs">{msg.content}</p>
                        </div>
                      </div>
                    ))}
                    {chatMutation.isPending && (
                      <div className="flex justify-start">
                        <div className="bg-muted/30 rounded-lg px-3 py-2">
                          <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="border-t border-cyan-500/20 p-2 flex gap-2">
                    <Input
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                      placeholder="What could I have done differently?"
                      className="text-xs bg-transparent border-muted"
                      data-testid="input-diary-chat"
                    />
                    <Button
                      size="sm"
                      onClick={handleSendChat}
                      disabled={!chatInput.trim() || chatMutation.isPending}
                      className="h-9 px-3 bg-cyan-600 hover:bg-cyan-700"
                      data-testid="button-send-diary-chat"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex justify-center gap-2 pt-2 pb-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrint}
                  className="font-mono text-xs tracking-wide border-muted-foreground/30 text-muted-foreground hover:text-foreground no-print"
                  data-testid="button-print-diary"
                >
                  <Printer className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                  PRINT
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportPDF}
                  disabled={isExportingPDF}
                  className="font-mono text-xs tracking-wide border-amber-500/30 text-amber-400 hover:text-amber-300 hover:border-amber-400/50 no-print"
                  data-testid="button-export-pdf-diary"
                >
                  {isExportingPDF ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 shrink-0 animate-spin" />
                  ) : (
                    <FileDown className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                  )}
                  {isExportingPDF ? "EXPORTING..." : "DOWNLOAD PDF"}
                </Button>
              </div>

              <div className="print-footer">
                Confidential Trading Logic — Generated by TraderNotes AI.
              </div>
            </div>
          ) : null}
        </ScrollArea>
      </div>

      <Dialog open={showUploadModal} onOpenChange={setShowUploadModal}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-base flex items-center gap-2">
              <Upload className="h-4 w-4 text-amber-400" />
              Settlement Audit — Upload Charts
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Drop your Intraday session chart (required) to generate the Execution Tape audit. HTF candle charts are optional macro context.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 bg-muted/30 rounded-lg px-3 py-2 border border-border/50">
            <Calendar className="h-4 w-4 text-amber-400 shrink-0" />
            <div className="flex flex-col gap-0.5">
              <label htmlFor="analysis-date" className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Analysis Date</label>
              <input
                id="analysis-date"
                type="date"
                value={selectedDate}
                max={getNYDateStr()}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent border-none text-sm font-mono text-foreground focus:outline-none [color-scheme:dark]"
                data-testid="input-analysis-date"
              />
            </div>
          </div>
          {/* Slot 1: Intraday — full width, mandatory */}
          <ChartUploadSlot
            label="Intraday Session Chart"
            sublabel="RTH/ETH — 1m, 5m, or 15m view"
            file={intradayChart}
            onFileChange={setIntradayChart}
            required
            color="amber"
          />
          {/* Slots 2-4: HTF optional context — 3 columns */}
          <div className="grid grid-cols-3 gap-2">
            <ChartUploadSlot
              label="1-Day Summary"
              sublabel="HTF: Daily Candle"
              file={dailyChart}
              onFileChange={setDailyChart}
              color="emerald"
            />
            <ChartUploadSlot
              label="1-Week Summary"
              sublabel="HTF: Weekly Candle"
              file={weeklyChart}
              onFileChange={setWeeklyChart}
              color="blue"
            />
            <ChartUploadSlot
              label="1-Month Summary"
              sublabel="HTF: Monthly Candle"
              file={monthlyChart}
              onFileChange={setMonthlyChart}
              color="violet"
            />
          </div>
          {dateCheck?.hasExistingEntry && (
            <p className="text-[10px] text-blue-400/80 font-mono text-center" data-testid="text-existing-entry-warning">
              A diary entry already exists for this date — generating will return the existing entry
            </p>
          )}
          {!canGenerate && (
            <p className="text-[10px] text-amber-400/80 font-mono text-center" data-testid="text-no-activity-warning">
              Upload an Intraday chart or have tactical chat history for this date to generate
            </p>
          )}
          {canGenerate && !hasAnyChart && hasActivityChat && (
            <p className="text-[10px] text-emerald-400/80 font-mono text-center">
              Chat history detected — a Chat Recap diary will be generated
            </p>
          )}
          {canGenerate && hasIntradayChart && (
            <p className="text-[10px] text-emerald-400/80 font-mono text-center">
              {dateCheck?.hasPlaybook ? "Ready — Execution Tape audit with playbook context" : dateCheck?.hasChat ? "Ready — Execution Tape audit with chat context" : "Ready — visual Execution Tape audit"}
            </p>
          )}
          {canGenerate && hasAnyChart && !hasIntradayChart && (
            <p className="text-[10px] text-emerald-400/80 font-mono text-center">
              {dateCheck?.hasPlaybook ? "Ready to generate with HTF + playbook context" : "Ready — HTF candle analysis"}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setShowUploadModal(false)} className="text-xs font-mono" data-testid="button-cancel-upload">
              Cancel
            </Button>
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={!canGenerate || generateMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700 text-white font-bold font-mono text-xs"
              data-testid="button-generate-with-charts"
            >
              {generateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <FileText className="h-3.5 w-3.5 mr-1.5 shrink-0" />}
              GENERATE DIARY
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showFinalizeModal} onOpenChange={setShowFinalizeModal}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono text-base">Finalize Diary Entry</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Once finalized, this diary entry will be locked and cannot be edited.
              {(!closingThought.trim() && !selectedEntry?.userClosingThought?.trim()) && (
                <span className="block mt-2 text-amber-400">
                  You haven't added a closing thought yet. Are you sure you want to finalize without one?
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {!selectedEntry?.isFinalized && !closingThought.trim() && !selectedEntry?.userClosingThought?.trim() && (
            <Textarea
              value={closingThought}
              onChange={(e) => setClosingThought(e.target.value)}
              placeholder="Optional: Add a closing thought before finalizing..."
              className="min-h-[60px] text-sm bg-transparent border-muted resize-none"
              data-testid="input-finalize-thought"
            />
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setShowFinalizeModal(false)} className="text-xs font-mono" data-testid="button-cancel-finalize">
              Cancel
            </Button>
            <Button
              onClick={handleConfirmFinalize}
              disabled={updateMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold font-mono text-xs"
              data-testid="button-confirm-finalize"
            >
              {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Lock className="h-3.5 w-3.5 mr-1.5" />}
              CONFIRM FINALIZE
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {(selectedEntry?.intradayChartUrl || selectedEntry?.dailyChartUrl) && (
        <CompareModal
          intradayChartUrl={selectedEntry.intradayChartUrl || selectedEntry.dailyChartUrl!}
          morningThesis={morningThesis}
          planAdherence={analysis?.plan_adherence || null}
          open={showCompareModal}
          onClose={() => setShowCompareModal(false)}
        />
      )}

      <ImageLightbox
        src={lightboxSrc?.src || ""}
        alt={lightboxSrc?.alt || ""}
        open={!!lightboxSrc}
        onClose={() => setLightboxSrc(null)}
      />
    </div>
  );
}
