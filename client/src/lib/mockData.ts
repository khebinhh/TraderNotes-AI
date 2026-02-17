// Mock Data for TraderNotes AI

export type EventType = 'NFP' | 'Earnings' | 'FOMC' | 'CPI' | 'Note';
export type LevelType = 'support' | 'resistance' | 'zone';

export interface DailyNote {
  id: string;
  date: string;
  title: string;
  summary: string;
  levels: Array<{ price: string; type: LevelType; note: string }>;
  events: Array<{ time: string; event: string; type: EventType }>;
  checklist: Array<{ id: string; text: string; completed: boolean }>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  attachments?: string[];
}

export const MOCK_NOTES: DailyNote[] = [
  {
    id: '1',
    date: new Date().toISOString(), // Today
    title: "Mid-Week Update: Bullish Continuation?",
    summary: "Market is holding above the 6866 pivot. Looking for a push towards 6920 if NFP data comes in soft.",
    levels: [
      { price: "6866", type: "support", note: "Key Pivot - Hold above for bullish bias" },
      { price: "6924-6926", type: "resistance", note: "Major Resistance / Profit Take Zone" },
      { price: "6820", type: "support", note: "Invalidation level" }
    ],
    events: [
      { time: "08:30 AM", event: "Non-Farm Payrolls", type: "NFP" },
      { time: "10:00 AM", event: "ISM Services PMI", type: "Note" }
    ],
    checklist: [
      { id: "c1", text: "Hold above 6866 on 1H close", completed: true },
      { id: "c2", text: "Watch for volume spike at 6900", completed: false },
      { id: "c3", text: "Reduce risk ahead of NFP release", completed: true },
      { id: "c4", text: "No longs below 6840", completed: false }
    ]
  },
  {
    id: '2',
    date: new Date(Date.now() - 86400000).toISOString(), // Yesterday
    title: "Tuesday Reversal Setup",
    summary: "Rejected from 6950 supply. Looking for a retest of 6880 support.",
    levels: [
      { price: "6950", type: "resistance", note: "Supply Zone" },
      { price: "6880", type: "support", note: "First bounce target" }
    ],
    events: [],
    checklist: [
      { id: "c1", text: "Short below 6940", completed: true },
      { id: "c2", text: "Take profit at 6890", completed: true }
    ]
  },
  {
    id: '3',
    date: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
    title: "Weekly Open Plan",
    summary: "Chop zone expected. Range bound between 6800 and 6900.",
    levels: [
      { price: "6800", type: "support", note: "Range Low" },
      { price: "6900", type: "resistance", note: "Range High" }
    ],
    events: [
      { time: "02:00 PM", event: "FOMC Minutes", type: "FOMC" }
    ],
    checklist: [
      { id: "c1", text: "Wait for range breakout", completed: false },
      { id: "c2", text: "Scalp edges only", completed: true }
    ]
  }
];

export const MOCK_CHAT_HISTORY: ChatMessage[] = [
  {
    id: 'm1',
    role: 'user',
    content: "What's my game plan for today based on the mid-week note?",
    timestamp: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'm2',
    role: 'assistant',
    content: "Based on your **Mid-Week Update**, your focus is on the **6866 Pivot**. \n\n**Game Plan:**\n1.  **Bullish Bias**: Maintain longs as long as price holds above 6866 on a 1H closing basis.\n2.  **Targets**: Look for 6924-6926 as a primary take-profit zone.\n3.  **Risk**: Invalidation is a break below 6820.\n\nBe aware of **NFP at 8:30 AM** - volatility is expected.",
    timestamp: new Date(Date.now() - 3500000).toISOString(),
  },
  {
    id: 'm3',
    role: 'user',
    content: "Price is approaching 6920, should I close?",
    timestamp: new Date(Date.now() - 900000).toISOString(),
  },
  {
    id: 'm4',
    role: 'assistant',
    content: "Your note identifies **6924-6926** as a 'Major Resistance / Profit Take Zone'. \n\nGiven we are at 6920, you are entering the alert zone. \n\n*Suggestion:* Consider scaling out 50-75% of the position here and moving stops to breakeven on the runner. Watch for rejection wicks on the 5m chart.",
    timestamp: new Date(Date.now() - 850000).toISOString(),
  }
];
