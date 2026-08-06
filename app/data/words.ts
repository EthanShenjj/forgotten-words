export type Word = {
  id: string;
  text: string;
  pinyin: string;
  definition: string;
  example?: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  category: "常见词" | "文学" | "古典" | "成语";
  daily: boolean;
  chapterId: string;
};

export type Level = { id: string; title: string; words: string[]; };

export type Chapter = { id: string; title: string; subtitle: string; color: string; levels: Level[]; };

// ===== Daily words (small file, loads instantly) =====
const dailyWords: Word[] = [];
const dailyWordMap = new Map<string, Word>();
let dailyLoaded = false;

// ===== Full word list (large file, lazy-loaded for levels) =====
const allWords: Word[] = [];
const allWordMap = new Map<string, Word>();
let fullLoaded = false;

// ===== Chapters (built after full load) =====
export const chapters: Chapter[] = [];

const chapterMeta: Record<string, { title: string; subtitle: string; color: string }> = {
  "chapter-1": { title: "第一章：重新提笔", subtitle: "从那些明明熟悉却忽然卡住的词开始。", color: "#255f4b" },
  "chapter-2": { title: "第二章：纸上旧识", subtitle: "文学表达里的迟疑、回望与温柔。", color: "#314f88" },
  "chapter-3": { title: "第三章：古典文化", subtitle: "旧词并不遥远，只是少有机会被亲手写下。", color: "#6f3d2e" },
  "chapter-4": { title: "第四章：成语挑战", subtitle: "四字之间，有一点锋芒，也有一点记忆的重量。", color: "#8d2f28" },
};

const WORDS_PER_LEVEL = 5;

function buildChapters() {
  const byChapter: Record<string, Word[]> = {};
  for (const w of allWords) {
    if (!byChapter[w.chapterId]) byChapter[w.chapterId] = [];
    byChapter[w.chapterId].push(w);
  }

  chapters.length = 0;
  for (const [id, meta] of Object.entries(chapterMeta)) {
    const ws = byChapter[id] || [];
    const levels: Level[] = [];
    const chapterNum = id.split("-")[1];
    for (let i = 0; i < ws.length; i += WORDS_PER_LEVEL) {
      const chunk = ws.slice(i, i + WORDS_PER_LEVEL);
      const levelNum = Math.floor(i / WORDS_PER_LEVEL) + 1;
      levels.push({
        id: `level-${chapterNum}-${levelNum}`,
        title: `第 ${levelNum} 关`,
        words: chunk.map((w) => w.id),
      });
    }
    chapters.push({ id, ...meta, levels });
  }
}

// ===== Load daily words (fast, ~27KB) =====
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

export async function loadDailyWords(): Promise<void> {
  if (dailyLoaded) return;
  try {
    const res = await fetch(`${BASE}/daily-words.json`);
    const data: (string | number)[][] = await res.json();

    dailyWords.length = 0;
    dailyWordMap.clear();

    for (const row of data) {
      const w: Word = {
        id: row[0] as string,
        text: row[1] as string,
        pinyin: row[2] as string,
        definition: row[3] as string,
        difficulty: row[4] as 1 | 2 | 3 | 4 | 5,
        category: row[5] as Word["category"],
        daily: true,
        chapterId: "chapter-1",
      };
      dailyWords.push(w);
      dailyWordMap.set(w.id, w);
    }
    dailyLoaded = true;
  } catch (err) {
    console.error("Failed to load daily words:", err);
  }
}

// ===== Load full words (large, ~25MB, for levels) =====
export async function loadFullWords(): Promise<void> {
  if (fullLoaded) return;
  try {
    const res = await fetch(`${BASE}/words-data.json`);
    const data: (string | number)[][] = await res.json();

    allWords.length = 0;
    allWordMap.clear();

    for (const row of data) {
      const w: Word = {
        id: row[0] as string,
        text: row[1] as string,
        pinyin: row[2] as string,
        definition: row[3] as string,
        difficulty: row[4] as 1 | 2 | 3 | 4 | 5,
        category: row[5] as Word["category"],
        daily: row[6] === 1,
        chapterId: row[7] as string,
        example: row[8] as string | undefined,
      };
      allWords.push(w);
      allWordMap.set(w.id, w);
    }

    buildChapters();
    fullLoaded = true;
  } catch (err) {
    console.error("Failed to load full words:", err);
  }
}

export function isDailyLoaded(): boolean {
  return dailyLoaded;
}

export function isFullLoaded(): boolean {
  return fullLoaded;
}

// ===== Get word from whichever list is loaded =====
export function getWord(id: string): Word | undefined {
  return dailyWordMap.get(id) ?? allWordMap.get(id);
}

export function getLoadedWords(): Word[] {
  return allWords.length > 0 ? allWords : dailyWords;
}

// ===== Today's 3 words (no repeats via localStorage) =====
const USED_WORDS_KEY = "forgotten-words-used-daily";

function getUsedWordIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(USED_WORDS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function addUsedWordIds(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    const used = getUsedWordIds();
    for (const id of ids) used.add(id);
    // Keep only last 500 to avoid unlimited growth
    const arr = Array.from(used);
    const trimmed = arr.slice(-500);
    window.localStorage.setItem(USED_WORDS_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage full or unavailable, ignore
  }
}

export function todaysWords(date = new Date()): Word[] {
  if (dailyWords.length === 0) return [];

  const used = getUsedWordIds();
  const available = dailyWords.filter((w) => !used.has(w.id));

  // If we've used almost all words, reset
  const pool = available.length >= 3 ? available : dailyWords;

  const seed = Number(
    `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`
  );

  // Pick 3 words using seeded selection: 1 easy + 1 medium + 1 hard
  const buckets = [
    pool.filter((w) => w.difficulty <= 2),
    pool.filter((w) => w.difficulty === 3),
    pool.filter((w) => w.difficulty >= 4),
  ];

  const result: Word[] = [];
  for (let i = 0; i < 3; i++) {
    const bucket = buckets[i] || pool;
    if (bucket.length === 0) {
      // Fallback to any available word
      const fallback = pool[(seed + i * 7) % pool.length];
      if (fallback) result.push(fallback);
    } else {
      result.push(bucket[(seed + i * 7) % bucket.length]);
    }
  }

  // Mark as used
  addUsedWordIds(result.map((w) => w.id));

  return result.filter(Boolean);
}
