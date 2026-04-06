# 🏏 IPL Fantasy — How To Run

## First Time Setup

```bash
# Terminal 1 — install & run backend
cd server
pnpm install
pnpm dev

# Terminal 2 — install & run frontend
cd client
pnpm install
pnpm dev
```

Open → http://localhost:3000

---

## How to Play

1. One person → **Create Room** → picks teams (e.g. CSK vs PBKS) → shares the 6-letter code
2. Friends → **Join Room** → enter code + name
3. Everyone → **Pick My Team** → select 11 players, assign C and VC → Submit
4. Admin → **Lock Room** (optional, stops team changes)
5. During/After match → Admin → **Enter Match Scores** → tap each player → enter stats → Save
6. Everyone sees the **Live Leaderboard** update in real-time 🏆

---

## Scoring Rules

| Action | Points |
|--------|--------|
| Per run | +1 |
| Boundary (4) | +1 bonus |
| Six (6) | +2 bonus |
| 25-run milestone | +4 |
| Half century | +8 |
| Century | +16 |
| Duck (dismissed for 0) | -2 |
| Per wicket | +25 |
| LBW/Bowled bonus | +8 |
| 3-wicket haul | +4 |
| 4-wicket haul | +8 |
| 5-wicket haul | +16 |
| Maiden over | +8 |
| Catch | +8 |
| 3+ catches bonus | +4 |
| Stumping | +12 |
| Direct run-out | +12 |
| Indirect run-out | +6 |
| Playing XI | +4 |
| **Captain** | **2× total** |
| **Vice Captain** | **1.5× total** |

Strike rate & economy bonuses also apply (see server/src/scoring.ts).
