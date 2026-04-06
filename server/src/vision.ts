/**
 * vision.ts — Extract cricket scorecard from a screenshot using Claude vision
 *
 * Usage: admin uploads a Cricbuzz/ESPNcricinfo scorecard screenshot.
 * Claude reads the image and returns structured batting/bowling data.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ScorecardData } from './cricapi';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXTRACTION_PROMPT = `You are a cricket scorecard parser. Extract all batting and bowling data from this scorecard screenshot.

Return ONLY a valid JSON object in this exact format (no markdown, no explanation):
{
  "batting": [
    {
      "name": "Player Name",
      "runs": 45,
      "balls": 32,
      "fours": 4,
      "sixes": 1,
      "dismissal": "c Fielder b Bowler"
    }
  ],
  "bowling": [
    {
      "name": "Bowler Name",
      "overs": "4.0",
      "maidens": 0,
      "runs": 28,
      "wickets": 2
    }
  ],
  "playingXI": ["Player1", "Player2"]
}

Rules:
- Include ALL batters shown in the scorecard (including not out ones)
- For dismissed batters, include the full dismissal text (e.g. "c Conway b Pathirana", "b Bumrah", "lbw b Chahal", "run out (Kohli)")
- For not out batters, set dismissal to "not out"
- Include ALL bowlers shown
- overs must be a string like "3.4" or "4.0"
- playingXI should list all player names visible in the scorecard
- If there are two innings visible, include both (some players may appear twice — combine their stats)
- Numbers must be integers (except overs which is a string)`;

export async function extractScorecardFromImage(
  imageBase64: string,
  mimeType: string = 'image/jpeg'
): Promise<ScorecardData | null> {
  const validMime = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const mime = validMime.includes(mimeType) ? mimeType : 'image/jpeg';

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mime as any,
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: EXTRACTION_PROMPT,
          },
        ],
      },
    ],
  });

  const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
  if (!text) return null;

  // Strip markdown code fences if present
  const json = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  const parsed = JSON.parse(json);

  // Convert to our ScorecardData format
  const scorecard: ScorecardData = {
    playingXI: parsed.playingXI ?? [],
    batters: (parsed.batting ?? []).map((b: any) => ({
      name:      String(b.name ?? ''),
      runs:      Number(b.runs  ?? 0),
      balls:     Number(b.balls ?? 0),
      fours:     Number(b.fours ?? 0),
      sixes:     Number(b.sixes ?? 0),
      isOut:     !String(b.dismissal ?? '').toLowerCase().includes('not out'),
      dismissal: String(b.dismissal ?? ''),
    })),
    bowlers: (parsed.bowling ?? []).map((bw: any) => ({
      name:      String(bw.name ?? ''),
      overs:     parseOvers(String(bw.overs ?? '0')),
      maidens:   Number(bw.maidens  ?? 0),
      runs:      Number(bw.runs     ?? 0),
      wickets:   Number(bw.wickets  ?? 0),
      lbwBowled: 0, // derived by autoMapStats from dismissal text
    })),
    fielding: [], // derived by autoMapStats from dismissal texts
  };

  // Add all named players to playingXI if not already there
  const allNames = [
    ...scorecard.batters.map(b => b.name),
    ...scorecard.bowlers.map(bw => bw.name),
  ];
  for (const n of allNames) {
    if (n && !scorecard.playingXI.includes(n)) scorecard.playingXI.push(n);
  }

  return scorecard;
}

function parseOvers(s: string): number {
  const [ov, balls] = s.split('.');
  return parseInt(ov || '0') + (parseInt(balls || '0') / 6);
}
