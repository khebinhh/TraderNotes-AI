-- TraderNotes AI - PostgreSQL Database Schema

-- 1. Users Table
-- Stores user authentication and profile data
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  username TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  settings JSONB DEFAULT '{}' -- Stores theme prefs, default tickers, etc.
);

-- 2. Notes Table
-- Stores raw text/PDF data uploaded by the user
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  raw_content TEXT, -- The full extracted text from PDF/User input
  file_url TEXT,    -- Path to the original PDF if stored in storage
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  tags TEXT[]
);

-- 3. Calculated_Levels Table
-- Stores extracted support/resistance levels from notes
CREATE TABLE calculated_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID REFERENCES notes(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL, -- e.g., "BTCUSD", "ES1!"
  price_low DECIMAL NOT NULL,
  price_high DECIMAL, -- If it's a zone (e.g., 6924-6926), otherwise null or same as low
  level_type TEXT CHECK (level_type IN ('support', 'resistance', 'pivot', 'invalidation')),
  description TEXT, -- The context context extracted (e.g., "Hold above for bullish bias")
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Daily_Checklists Table
-- Stores the generated "Game Plan" for the day
CREATE TABLE daily_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  summary TEXT, -- "Today's Focus" summary
  closing_note TEXT, -- User's end-of-day reflection
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Checklist_Items Table
-- Individual items within a daily checklist
CREATE TABLE checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID REFERENCES daily_checklists(id) ON DELETE CASCADE,
  content TEXT NOT NULL, -- e.g., "Hold above 6866"
  is_completed BOOLEAN DEFAULT FALSE,
  source_note_id UUID REFERENCES notes(id) -- Link back to the note that generated this item
);

-- 6. Events Table
-- High volatility reminders extracted from notes
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, -- e.g., "NFP Release"
  event_time TIMESTAMP WITH TIME ZONE NOT NULL,
  impact_level TEXT CHECK (impact_level IN ('low', 'medium', 'high')),
  related_note_id UUID REFERENCES notes(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_notes_user ON notes(user_id);
CREATE INDEX idx_levels_ticker ON calculated_levels(ticker);
CREATE INDEX idx_checklists_date ON daily_checklists(user_id, date);
