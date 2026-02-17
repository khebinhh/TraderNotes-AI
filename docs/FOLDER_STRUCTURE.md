# TraderNotes AI - Next.js Folder Structure

Recommended structure for the production Fullstack Next.js application.

```
/
├── app/                        # App Router (Next.js 14+)
│   ├── (auth)/                 # Auth route group
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── (dashboard)/            # Protected dashboard routes
│   │   ├── layout.tsx          # Dashboard shell (Sidebar + Header)
│   │   ├── page.tsx            # Main "Command Center" view
│   │   ├── archive/page.tsx    # Full archive view
│   │   └── settings/page.tsx
│   ├── api/                    # API Routes
│   │   ├── ingest/route.ts     # POST: PDF/Note ingestion webhook
│   │   ├── chat/route.ts       # POST: Gemini Chat stream
│   │   └── events/route.ts     # GET: Calendar events
│   ├── globals.css
│   └── layout.tsx              # Root layout
│
├── components/
│   ├── dashboard/
│   │   ├── temporal-navigator.tsx
│   │   ├── ai-tutor.tsx
│   │   ├── live-chart.tsx
│   │   └── game-plan-checklist.tsx
│   ├── ui/                     # Shadcn UI components
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   └── ...
│   └── shared/
│       ├── theme-toggle.tsx
│       └── user-nav.tsx
│
├── lib/
│   ├── db/                     # Database connection & schemas
│   │   ├── schema.prisma       # Prisma Schema
│   │   └── client.ts
│   ├── ai/                     # AI Logic
│   │   ├── gemini.ts           # Gemini API client
│   │   ├── prompts.ts          # System prompts
│   │   └── tools.ts            # Function calling definitions
│   └── utils.ts
│
├── types/                      # TypeScript definitions
│   └── index.ts
│
├── public/                     # Static assets
└── package.json
```
