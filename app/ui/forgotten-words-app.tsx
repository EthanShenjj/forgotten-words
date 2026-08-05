"use client";

import {
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  CircleUserRound,
  Eraser,
  Eye,
  Home,
  Lock,
  LogIn,
  Moon,
  PencilLine,
  RotateCcw,
  Share2,
  Sparkles,
  Trophy,
  Undo2,
  Volume2,
  X
} from "lucide-react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { chapters, getLoadedWords, getWord, loadDailyWords, loadFullWords, todaysWords, type Chapter, type Level, type Word } from "../data/words";

type Screen = "home" | "daily" | "levels" | "profile" | "admin";
type AnswerResult = "correct" | "wrong" | "revealed" | "incomplete";

type Answer = {
  wordId: string;
  input: string;
  result: AnswerResult;
};

type DailyRecord = {
  date: string;
  answers: Answer[];
  correctCount: number;
  completed: boolean;
};

type LevelRecord = {
  answers: Answer[];
  completed: boolean;
  stars: number;
};

type AppProgress = {
  loggedIn: boolean;
  nickname: string;
  xp: number;
  totalCheckins: number;
  streak: number;
  lastCheckinDate: string;
  completedWords: number;
  correctWords: number;
  daily: Record<string, DailyRecord>;
  completedLevels: Record<string, LevelRecord>;
  settings: {
    sound: boolean;
    vibration: boolean;
    dark: boolean;
    largeText: boolean;
  };
};

type LevelSession = {
  levelId: string;
  wordIds: string[];
  index: number;
  answers: Answer[];
};

type Point = {
  x: number;
  y: number;
};

const STORAGE_KEY = "forgotten-words-progress-v1";
const EVENTS_KEY = "forgotten-words-events-v1";
const EMPTY_ANSWER_SLOT = "\uE000";

const defaultProgress: AppProgress = {
  loggedIn: false,
  nickname: "游客",
  xp: 0,
  totalCheckins: 0,
  streak: 0,
  lastCheckinDate: "",
  completedWords: 0,
  correctWords: 0,
  daily: {},
  completedLevels: {},
  settings: {
    sound: true,
    vibration: true,
    dark: false,
    largeText: false
  }
};

const badges = [
  { id: "first-daily", title: "初次提笔", condition: "完成第一次每日挑战" },
  { id: "week", title: "坚持一周", condition: "连续打卡 7 天" },
  { id: "month", title: "月下有字", condition: "累计打卡 30 天" },
  { id: "chapter", title: "初窥门径", condition: "完成第一个章节" },
  { id: "words", title: "博闻强识", condition: "累计完成 500 个词" },
  { id: "idiom", title: "成语行者", condition: "完成成语章节" }
];

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function loadProgress(): AppProgress {
  if (typeof window === "undefined") return defaultProgress;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultProgress;
  try {
    const parsed = JSON.parse(raw);
    return {
      ...defaultProgress,
      ...parsed,
      settings: { ...defaultProgress.settings, ...(parsed.settings ?? {}) },
      daily: { ...(parsed.daily ?? {}) },
      completedLevels: { ...(parsed.completedLevels ?? {}) }
    };
  } catch {
    return defaultProgress;
  }
}

function getLevelTitle(levelId: string) {
  for (const chapter of chapters) {
    const level = chapter.levels.find((item) => item.id === levelId);
    if (level) return level.title;
  }
  return "未命名关卡";
}

function levelStage(xp: number) {
  const level = Math.max(1, Math.floor(xp / 120) + 1);
  if (level >= 50) return { level, title: "字魂守护者" };
  if (level >= 30) return { level, title: "汉字行者" };
  if (level >= 20) return { level, title: "寻字达人" };
  if (level >= 10) return { level, title: "文墨学徒" };
  if (level >= 5) return { level, title: "寻字新人" };
  return { level, title: "重新提笔" };
}

function earnedBadges(progress: AppProgress) {
  const chapterCompletedLevels = chapters.map((chapter) =>
    chapter.levels.filter((level) => progress.completedLevels[level.id]?.completed).length
  );

  return new Set(
    badges
      .filter((badge) => {
        if (badge.id === "first-daily") return progress.totalCheckins > 0;
        if (badge.id === "week") return progress.streak >= 7;
        if (badge.id === "month") return progress.totalCheckins >= 30;
        if (badge.id === "chapter") return chapterCompletedLevels.some((count) => count >= 50);
        if (badge.id === "words") return progress.completedWords >= 500;
        if (badge.id === "idiom") return chapterCompletedLevels[3] >= 30;
        return false;
      })
      .map((badge) => badge.id)
  );
}

const LEVELS_TO_UNLOCK_NEXT = 20;

function isChapterUnlocked(chapter: Chapter, progress: AppProgress) {
  const chapterIndex = chapters.findIndex((item) => item.id === chapter.id);
  if (chapterIndex === 0) return true;
  const previous = chapters[chapterIndex - 1];
  let completedCount = 0;
  for (const level of previous.levels) {
    if (progress.completedLevels[level.id]?.completed) {
      completedCount++;
      if (completedCount >= LEVELS_TO_UNLOCK_NEXT) return true;
    }
  }
  return false;
}

function isLevelUnlocked(chapter: Chapter, level: Level, progress: AppProgress) {
  if (!isChapterUnlocked(chapter, progress)) return false;
  const levelIndex = chapter.levels.findIndex((item) => item.id === level.id);
  if (levelIndex === 0) return true;
  return progress.completedLevels[chapter.levels[levelIndex - 1].id]?.completed;
}

function starCount(answers: Answer[]) {
  const independentCorrect = answers.filter((answer) => answer.result === "correct").length;
  const rate = answers.length ? independentCorrect / answers.length : 0;
  if (rate >= 0.9) return 3;
  if (rate >= 0.6) return 2;
  return 1;
}

function compareAnswer(word: Word, input: string) {
  const trimmed = cleanAnswer(input);
  if (Array.from(trimmed).length < word.text.length) return "incomplete";
  return trimmed === word.text ? "correct" : "wrong";
}

function cleanAnswer(input: string) {
  return Array.from(input)
    .filter((char) => char !== EMPTY_ANSWER_SLOT)
    .join("")
    .trim();
}

function answerSlotValue(input: string, slotIndex: number) {
  const char = input[slotIndex];
  return !char || char === EMPTY_ANSWER_SLOT ? "" : char;
}

function diffText(correct: string, input: string) {
  return Array.from(correct).map((char, index) => ({
    char,
    input: Array.from(input)[index] ?? "空",
    ok: Array.from(input)[index] === char
  }));
}

function track(event: string, properties: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const payload = {
    event,
    timestamp: new Date().toISOString(),
    properties
  };
  const raw = window.localStorage.getItem(EVENTS_KEY);
  const events = raw ? JSON.parse(raw) : [];
  events.push(payload);
  window.localStorage.setItem(EVENTS_KEY, JSON.stringify(events.slice(-120)));
}

export default function ForgottenWordsApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [progress, setProgress] = useState<AppProgress>(defaultProgress);
  const [hydrated, setHydrated] = useState(false);
  const [wordsLoaded, setWordsLoaded] = useState(false);
  const [levelsLoaded, setLevelsLoaded] = useState(false);
  const [dailyAnswers, setDailyAnswers] = useState<Answer[]>([]);
  const [levelSession, setLevelSession] = useState<LevelSession | null>(null);
  const [feedback, setFeedback] = useState<Answer | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [retrying, setRetrying] = useState(false);

  const today = useMemo(() => dateKey(), []);
  const dailyWords = useMemo(() => todaysWords(), [wordsLoaded]);
  const todayRecord = progress.daily[today];
  const currentDailyWord = feedback && screen === "daily" ? getWord(feedback.wordId) : dailyWords[dailyAnswers.length];
  const currentLevelWord =
    feedback && screen === "levels" ? getWord(feedback.wordId) : levelSession ? getWord(levelSession.wordIds[levelSession.index]) : undefined;
  const currentWord = screen === "levels" && levelSession ? currentLevelWord : currentDailyWord;
  const level = levelStage(progress.xp);
  const badgeSet = earnedBadges(progress);

  useEffect(() => {
    const saved = loadProgress();
    setProgress(saved);
    setDailyAnswers(saved.daily[today]?.answers ?? []);
    loadDailyWords().then(() => {
      setWordsLoaded(true);
      setHydrated(true);
      track("page_view", { page: "home" });
      track("home_view");
    });
  }, [today]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    document.documentElement.dataset.theme = progress.settings.dark ? "dark" : "light";
    document.documentElement.dataset.text = progress.settings.largeText ? "large" : "normal";
  }, [progress, hydrated]);

  function navigate(next: Screen) {
    if (next === "levels" && !levelsLoaded) {
      loadFullWords().then(() => setLevelsLoaded(true));
    }
    setScreen(next);
    setFeedback(null);
    const map: Record<Screen, string> = {
      home: "home_view",
      daily: "daily_challenge_view",
      levels: "level_list_view",
      profile: "profile_view",
      admin: "admin_view"
    };
    track("page_view", { page: next });
    track(map[next]);
  }

  function saveDailyAnswer(answer: Answer) {
    const nextAnswers = [...dailyAnswers, answer];
    const completed = nextAnswers.length === dailyWords.length;
    setDailyAnswers(nextAnswers);
    setFeedback(answer);

    setProgress((previous) => {
      const alreadyCompleted = previous.daily[today]?.completed;
      const correctCount = nextAnswers.filter((item) => item.result === "correct").length;
      const xpGain = 10 + (completed && !alreadyCompleted ? 20 : 0);
      const dailyRecord: DailyRecord = {
        date: today,
        answers: nextAnswers,
        correctCount,
        completed
      };

      let newStreak = previous.streak;
      if (completed && !alreadyCompleted) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayKey = dateKey(yesterday);
        if (previous.lastCheckinDate === yesterdayKey || previous.lastCheckinDate === today) {
          newStreak = previous.streak + 1;
        } else {
          newStreak = 1;
        }
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 90);
      const cutoffKey = dateKey(cutoffDate);
      const cleanedDaily: Record<string, DailyRecord> = {};
      for (const [key, record] of Object.entries(previous.daily)) {
        if (key >= cutoffKey || key === today) cleanedDaily[key] = record;
      }
      cleanedDaily[today] = dailyRecord;

      return {
        ...previous,
        xp: previous.xp + xpGain,
        totalCheckins: completed && !alreadyCompleted ? previous.totalCheckins + 1 : previous.totalCheckins,
        streak: newStreak,
        lastCheckinDate: completed && !alreadyCompleted ? today : previous.lastCheckinDate,
        completedWords: previous.completedWords + 1,
        correctWords: answer.result === "correct" ? previous.correctWords + 1 : previous.correctWords,
        daily: cleanedDaily
      };
    });

    track(answer.result === "correct" ? "word_answer_correct" : answer.result === "wrong" ? "word_answer_wrong" : "word_answer_reveal", {
      wordId: answer.wordId,
      source: "daily"
    });
    if (completed) track("daily_challenge_complete", { correctCount: nextAnswers.filter((item) => item.result === "correct").length });
  }

  function judgeDaily(result: "correct" | "wrong") {
    if (!currentDailyWord) return;
    if (!retrying && todayRecord?.completed) return;

    if (retrying) {
      const answer: Answer = { wordId: currentDailyWord.id, input: currentDailyWord.text, result };
      setDailyAnswers((prev) => [...prev, answer]);
      setFeedback(answer);
      track(result === "correct" ? "word_answer_correct" : "word_answer_wrong", { wordId: answer.wordId, source: "daily_retry" });
      return;
    }
    saveDailyAnswer({
      wordId: currentDailyWord.id,
      input: currentDailyWord.text,
      result
    });
  }

  function startLevel(levelItem: Level) {
    setLevelSession({
      levelId: levelItem.id,
      wordIds: levelItem.words,
      index: 0,
      answers: []
    });
    setFeedback(null);
    track("level_start", { levelId: levelItem.id });
  }

  function startRetry() {
    setDailyAnswers([]);
    setFeedback(null);
    setRetrying(true);
    track("daily_retry_start");
  }

  function saveLevelAnswer(answer: Answer) {
    if (!levelSession) return;
    const nextAnswers = [...levelSession.answers, answer];
    const completed = nextAnswers.length === levelSession.wordIds.length;
    const stars = starCount(nextAnswers);
    setFeedback(answer);

    setProgress((previous) => {
      const alreadyCompleted = previous.completedLevels[levelSession.levelId]?.completed;
      return {
        ...previous,
        xp: previous.xp + 10 + (completed && !alreadyCompleted ? 50 : 0),
        completedWords: previous.completedWords + 1,
        correctWords: answer.result === "correct" ? previous.correctWords + 1 : previous.correctWords,
        completedLevels: completed
          ? {
              ...previous.completedLevels,
              [levelSession.levelId]: {
                answers: nextAnswers,
                completed: true,
                stars
              }
            }
          : previous.completedLevels
      };
    });

    if (!completed) {
      setLevelSession({ ...levelSession, answers: nextAnswers, index: levelSession.index + 1 });
    } else {
      track("level_complete", { levelId: levelSession.levelId, stars });
      setLevelSession({ ...levelSession, answers: nextAnswers, index: levelSession.index + 1 });
    }

    track(answer.result === "correct" ? "word_answer_correct" : answer.result === "wrong" ? "word_answer_wrong" : "word_answer_reveal", {
      wordId: answer.wordId,
      levelId: levelSession.levelId
    });
  }

  function judgeLevel(result: "correct" | "wrong") {
    if (!currentLevelWord || !levelSession) return;
    saveLevelAnswer({
      wordId: currentLevelWord.id,
      input: currentLevelWord.text,
      result
    });
  }

  function resetLocalData() {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(EVENTS_KEY);
    setProgress(defaultProgress);
    setDailyAnswers([]);
    setLevelSession(null);
    setFeedback(null);
  }

  if (!hydrated) {
    return <div className="boot-screen">正在准备今日字词…</div>;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate("home")} aria-label="回到首页">
          <span className="brand-mark">字</span>
          <span>
            <strong>遗忘的字</strong>
            <small>每天找回 3 个快忘记怎么写的汉字</small>
          </span>
        </button>
        <nav className="desktop-nav" aria-label="主导航">
          <NavButton active={screen === "home"} icon={<Home size={18} />} label="首页" onClick={() => navigate("home")} />
          <NavButton active={screen === "levels"} icon={<BookOpen size={18} />} label="闯关" onClick={() => navigate("levels")} />
          <NavButton active={screen === "profile"} icon={<CircleUserRound size={18} />} label="我的" onClick={() => navigate("profile")} />
        </nav>
        <button
          className="login-pill"
          onClick={() => {
            setProgress((previous) => ({ ...previous, loggedIn: true, nickname: "寻字人" }));
            track("login_success", { method: "mock" });
          }}
        >
          {progress.loggedIn ? <BadgeCheck size={17} /> : <LogIn size={17} />}
          {progress.loggedIn ? progress.nickname : "登录保存"}
        </button>
      </header>

      {screen === "home" && (
        <HomeView
          progress={progress}
          todayRecord={todayRecord}
          dailyAnswers={dailyAnswers}
          dailyWords={dailyWords}
          level={level}
          onStartDaily={() => {
            navigate("daily");
            track("daily_challenge_start");
          }}
          onOpenLevels={() => navigate("levels")}
        />
      )}

      {screen === "daily" && (
        <DailyView
          words={dailyWords}
          answers={dailyAnswers}
          todayRecord={todayRecord}
          retrying={retrying}
          currentWord={currentDailyWord}
          feedback={feedback}
          onJudgeComplete={judgeDaily}
          onNext={() => setFeedback(null)}
          onBackHome={() => { setRetrying(false); navigate("home"); }}
          onOpenLevels={() => { setRetrying(false); navigate("levels"); }}
          onRetry={startRetry}
        />
      )}

      {screen === "levels" && !levelsLoaded && !levelSession && (
        <section className="levels-shell">
          <div className="boot-screen">正在加载词库…</div>
        </section>
      )}

      {screen === "levels" && (levelsLoaded || levelSession) && (
        <LevelsView
          progress={progress}
          session={levelSession}
          currentWord={currentLevelWord}
          feedback={feedback}
          onJudgeComplete={judgeLevel}
          onNext={() => setFeedback(null)}
          onStartLevel={startLevel}
          onExitSession={() => {
            setLevelSession(null);
            setFeedback(null);
          }}
          onBackHome={() => navigate("home")}
        />
      )}

      {screen === "profile" && (
        <ProfileView
          progress={progress}
          level={level}
          badges={badgeSet}
          monthOffset={monthOffset}
          onMonthChange={setMonthOffset}
          onToggleSetting={(key) => {
            setProgress((previous) => ({
              ...previous,
              settings: {
                ...previous.settings,
                [key]: !previous.settings[key]
              }
            }));
          }}
          onAdmin={() => navigate("admin")}
          onReset={resetLocalData}
        />
      )}

      {screen === "admin" && <AdminView progress={progress} onBack={() => navigate("profile")} />}

      <nav className="bottom-nav" aria-label="移动端主导航">
        <NavButton active={screen === "home"} icon={<Home size={20} />} label="首页" onClick={() => navigate("home")} />
        <NavButton active={screen === "levels"} icon={<BookOpen size={20} />} label="闯关" onClick={() => navigate("levels")} />
        <NavButton active={screen === "profile" || screen === "admin"} icon={<CircleUserRound size={20} />} label="我的" onClick={() => navigate("profile")} />
      </nav>
    </main>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function HomeView({
  progress,
  todayRecord,
  dailyAnswers,
  dailyWords,
  level,
  onStartDaily,
  onOpenLevels
}: {
  progress: AppProgress;
  todayRecord?: DailyRecord;
  dailyAnswers: Answer[];
  dailyWords: Word[];
  level: { level: number; title: string };
  onStartDaily: () => void;
  onOpenLevels: () => void;
}) {
  const completed = todayRecord?.completed;
  const nextChapter = chapters.find((chapter) => chapter.levels.some((levelItem) => !progress.completedLevels[levelItem.id]?.completed)) ?? chapters[0];
  const completedLevels = nextChapter?.levels?.filter((levelItem) => progress.completedLevels[levelItem.id]?.completed).length ?? 0;

  return (
    <section className="home-grid">
      <div className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">今日写字</p>
          <h1>今天，你还会写这些字吗？</h1>
          <p>只看拼音，亲手写出 3 个快被遗忘的词。</p>
          <button className="primary-action" onClick={completed ? onOpenLevels : onStartDaily}>
            <PencilLine size={20} />
            {completed ? "去闯关" : dailyAnswers.length > 0 ? "继续挑战" : "开始今日挑战"}
          </button>
        </div>
        <div className="ink-visual" aria-hidden="true">
          <span>忘</span>
          <i />
        </div>
      </div>

      <div className="status-strip">
        <Metric label="今日挑战" value={`${Math.min(dailyAnswers.length, 3)}/3`} />
        <Metric label="连续打卡" value={`${progress.streak} 天`} />
        <Metric label="当前等级" value={`Lv.${level.level}`} detail={level.title} />
      </div>

      <section className="section-band compact">
        <div className="section-title">
          <div>
            <p className="eyebrow">今日词单</p>
            <h2>{completed ? "今日找回的字" : "等你提笔的字"}</h2>
          </div>
          <button className="ghost-button" onClick={onStartDaily}>
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="word-preview-grid">
          {dailyWords.map((word, index) => (
            <article className="word-preview" key={word.id}>
              <span>{index + 1}</span>
              <strong>{completed ? word.text : word.pinyin}</strong>
              <small>{word.definition}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="section-band compact">
        <div className="section-title">
          <div>
            <p className="eyebrow">闯关推荐</p>
            <h2>{nextChapter?.title ?? "词库加载中"}</h2>
          </div>
          <button className="secondary-action" onClick={onOpenLevels}>
            <BookOpen size={18} />
            进入
          </button>
        </div>
        <p className="muted">{nextChapter?.subtitle ?? "正在准备词库…"}</p>
        <div className="progress-rail" role="progressbar" aria-label={`${nextChapter?.title ?? "词库"}完成进度`} aria-valuenow={completedLevels} aria-valuemin={0} aria-valuemax={nextChapter?.levels?.length ?? 0}>
          <span style={{ width: `${nextChapter?.levels?.length ? (completedLevels / nextChapter.levels.length) * 100 : 0}%` }} />
        </div>
        <p className="subtle">{completedLevels}/{nextChapter?.levels?.length ?? 0} 关已完成</p>
      </section>
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function DailyView(props: {
  words: Word[];
  answers: Answer[];
  todayRecord?: DailyRecord;
  retrying: boolean;
  currentWord?: Word;
  feedback: Answer | null;
  onJudgeComplete: (result: "correct" | "wrong") => void;
  onNext: () => void;
  onBackHome: () => void;
  onOpenLevels: () => void;
  onRetry: () => void;
}) {
  if (!props.feedback && (props.answers.length >= props.words.length || (!props.retrying && props.todayRecord?.completed))) {
    const answers = props.retrying ? props.answers : (props.todayRecord?.answers ?? props.answers);
    const correctCount = answers.filter((answer) => answer.result === "correct").length;
    return (
      <CompletionView
        title={props.retrying ? "再练完成" : "今日挑战完成"}
        subtitle={`你找回了 ${answers.length} 个词`}
        words={props.words}
        correctCount={correctCount}
        onPrimary={props.onOpenLevels}
        onSecondary={props.onBackHome}
        onRetry={props.onRetry}
      />
    );
  }

  if (!props.currentWord) return null;

  return (
    <ChallengeView
      mode="daily"
      word={props.currentWord}
      index={props.feedback && props.feedback.result !== "incomplete" ? Math.max(props.answers.length - 1, 0) : props.answers.length}
      total={props.words.length}
      feedback={props.feedback}
      onJudgeComplete={props.onJudgeComplete}
      onNext={props.onNext}
      onBack={props.onBackHome}
    />
  );
}

function LevelsView({
  progress,
  session,
  currentWord,
  feedback,
  onJudgeComplete,
  onNext,
  onStartLevel,
  onExitSession,
  onBackHome
}: {
  progress: AppProgress;
  session: LevelSession | null;
  currentWord?: Word;
  feedback: Answer | null;
  onJudgeComplete: (result: "correct" | "wrong") => void;
  onNext: () => void;
  onStartLevel: (level: Level) => void;
  onExitSession: () => void;
  onBackHome: () => void;
}) {
  if (!feedback && session && session.index >= session.wordIds.length) {
    const stars = starCount(session.answers);
    const sessionWords = session.wordIds.map((id) => getWord(id)).filter(Boolean) as Word[];
    return (
      <CompletionView
        title="关卡完成"
        subtitle={`${getLevelTitle(session.levelId)} · ${"★".repeat(stars)}${"☆".repeat(3 - stars)}`}
        words={sessionWords}
        correctCount={session.answers.filter((answer) => answer.result === "correct").length}
        onPrimary={onExitSession}
        onSecondary={onBackHome}
        primaryLabel="继续闯关"
        secondaryLabel="返回首页"
      />
    );
  }

  if (session && currentWord) {
    return (
      <ChallengeView
        mode="level"
        word={currentWord}
        index={feedback && feedback.result !== "incomplete" ? Math.max(session.index - 1, 0) : session.index}
        total={session.wordIds.length}
        feedback={feedback}
        onJudgeComplete={onJudgeComplete}
        onNext={onNext}
        onBack={onExitSession}
      />
    );
  }

  const [levelPages, setLevelPages] = useState<Record<string, number>>({});
  const LEVELS_PER_PAGE = 50;

  return (
    <section className="levels-shell">
      <div className="page-heading">
        <p className="eyebrow">闯关模式</p>
        <h1>从熟悉的字，到更久远的词</h1>
      </div>
      <div className="chapter-list">
        {chapters.map((chapter) => {
          const chapterUnlocked = isChapterUnlocked(chapter, progress);
          const completedCount = chapter.levels.filter((level) => progress.completedLevels[level.id]?.completed).length;
          const page = levelPages[chapter.id] || 0;
          const visibleCount = (page + 1) * LEVELS_PER_PAGE;
          const visibleLevels = chapter.levels.slice(0, visibleCount);
          const hasMore = visibleCount < chapter.levels.length;
          return (
            <section className={`chapter-card ${chapterUnlocked ? "" : "locked"}`} key={chapter.id} style={{ "--chapter-color": chapter.color } as CSSProperties}>
              <div className="chapter-head">
                <div>
                  <p className="eyebrow">{completedCount}/{chapter.levels.length} 关</p>
                  <h2>{chapter.title}</h2>
                  <p>{chapter.subtitle}</p>
                </div>
                {!chapterUnlocked && <Lock size={22} />}
              </div>
              <div className="level-list">
                {visibleLevels.map((level, idx) => {
                  const unlocked = chapterUnlocked && (idx === 0 || progress.completedLevels[chapter.levels[idx - 1].id]?.completed);
                  const record = progress.completedLevels[level.id];
                  return (
                    <article className={`level-row ${!unlocked ? "locked" : ""}`} key={level.id}>
                      <div>
                        <strong>{level.title}</strong>
                        <span>{level.words.length} 个词 · {record?.completed ? `${"★".repeat(record.stars)}` : unlocked ? "待挑战" : "未解锁"}</span>
                      </div>
                      <button className="icon-action" onClick={() => onStartLevel(level)} disabled={!unlocked} title={unlocked ? "开始关卡" : "未解锁"}>
                        {unlocked ? <PencilLine size={18} /> : <Lock size={18} />}
                      </button>
                    </article>
                  );
                })}
                {hasMore && (
                  <button
                    className="ghost-button load-more-btn"
                    onClick={() => setLevelPages((prev) => ({ ...prev, [chapter.id]: page + 1 }))}
                  >
                    加载更多（已显示 {visibleCount}/{chapter.levels.length}）
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function ChallengeView({
  mode,
  word,
  index,
  total,
  feedback,
  onJudgeComplete,
  onNext,
  onBack
}: {
  mode: "daily" | "level";
  word: Word;
  index: number;
  total: number;
  feedback: Answer | null;
  onJudgeComplete: (result: "correct" | "wrong") => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const strokesRef = useRef<Point[][]>([]);
  const [strokeCount, setStrokeCount] = useState(0);
  const [showCanvasHint, setShowCanvasHint] = useState(true);
  const [charIndex, setCharIndex] = useState(0);
  const [revealedChars, setRevealedChars] = useState<boolean[]>([]);
  const [charImages, setCharImages] = useState<(string | null)[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [peeking, setPeeking] = useState(false);

  const chars = Array.from(word.text);
  const statusWord = feedback?.wordId === word.id ? feedback : null;
  const hasCommittedResult = Boolean(statusWord && statusWord.result !== "incomplete");

  useEffect(() => {
    setCharIndex(0);
    setRevealedChars(new Array(chars.length).fill(false));
    setCharImages(new Array(chars.length).fill(null));
    setSubmitted(false);
    setPeeking(false);
    setShowCanvasHint(true);
    clearCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.id]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Enter" && hasCommittedResult) {
        onNext();
      }
      if (event.key.toLowerCase() === "r" && document.activeElement?.tagName !== "INPUT") clearCanvas();
      if (event.key === "Backspace" && document.activeElement?.tagName !== "INPUT") {
        event.preventDefault();
        undoStroke();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCommittedResult, word.id]);

  function canvasPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  }

  function drawLine(from: Point, to: Point) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 7;
    context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#1d1a16";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }

  function redraw() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    strokesRef.current.forEach((stroke) => {
      stroke.forEach((point, pointIndex) => {
        if (pointIndex > 0) drawLine(stroke[pointIndex - 1], point);
      });
    });
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    strokesRef.current = [];
    setStrokeCount(0);
    track("handwriting_clear", { wordId: word.id, mode });
  }

  function undoStroke() {
    strokesRef.current = strokesRef.current.slice(0, -1);
    setStrokeCount(strokesRef.current.length);
    redraw();
    track("handwriting_undo", { wordId: word.id, mode });
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    setShowCanvasHint(false);
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    strokesRef.current = [...strokesRef.current, [canvasPoint(event)]];
    setStrokeCount(strokesRef.current.length);
    track("handwriting_start", { wordId: word.id, mode });
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const currentStroke = strokesRef.current[strokesRef.current.length - 1];
    const nextPoint = canvasPoint(event);
    const previousPoint = currentStroke[currentStroke.length - 1];
    currentStroke.push(nextPoint);
    drawLine(previousPoint, nextPoint);
  }

  function onPointerUp() {
    drawingRef.current = false;
  }

  function confirmChar() {
    if (submitted || hasCommittedResult) return;

    const canvas = canvasRef.current;
    const imageData = canvas?.toDataURL("image/png") ?? null;

    setCharImages((prev) => {
      const next = [...prev];
      next[charIndex] = imageData;
      return next;
    });
    setRevealedChars((prev) => {
      const next = [...prev];
      next[charIndex] = true;
      return next;
    });

    track("char_confirm", { wordId: word.id, charIndex, mode });

    const nextIndex = charIndex + 1;
    if (nextIndex < chars.length) {
      setCharIndex(nextIndex);
      setShowCanvasHint(true);
      clearCanvas();
    } else {
      setSubmitted(true);
    }
  }

  function judgeChar(result: "correct" | "wrong") {
    onJudgeComplete(result);
  }

  function peekChar() {
    if (peeking || submitted || hasCommittedResult) return;
    setPeeking(true);
    track("char_peek", { wordId: word.id, charIndex, mode });
    window.setTimeout(() => setPeeking(false), 1500);
  }

  return (
    <section className="challenge-shell">
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={18} />
        返回
      </button>
      <div className="challenge-card">
        <div className="question-head">
          <span>第 {index + 1} 题 / {total}</span>
          <strong>{word.pinyin}</strong>
          <p>{word.definition}</p>
        </div>

        <div className="answer-slots" aria-label="答案展示">
          {chars.map((char, slotIndex) => (
            <div
              key={`${word.id}-${slotIndex}`}
              className={`slot ${slotIndex === charIndex && !submitted && !hasCommittedResult ? "active" : ""} ${revealedChars[slotIndex] ? "revealed" : ""} ${peeking && slotIndex === charIndex ? "peeking" : ""}`}
            >
              {revealedChars[slotIndex] ? char : peeking && slotIndex === charIndex ? char : ""}
            </div>
          ))}
        </div>

        <p className="active-slot-label">
          {hasCommittedResult
            ? ""
            : submitted
              ? "对照一下你写的和正确答案一样吗？"
              : `正在写第 ${charIndex + 1} 个字，写完点确认`}
        </p>

        {!submitted && !hasCommittedResult && (
          <>
            <div className="canvas-wrap">
              <div className={`canvas-hint ${showCanvasHint && strokeCount === 0 ? "" : "hidden"}`}>
                用手指或鼠标在这里练字
              </div>
              <canvas
                ref={canvasRef}
                width={760}
                height={420}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                aria-label="手写区域"
              />
              <div className="writing-grid" style={{ "--slots": 1 } as CSSProperties} aria-hidden="true">
                <i key={`${word.id}-grid-${charIndex}`} />
              </div>
            </div>

            <div className="input-row answer-actions">
              <button className="secondary-action" onClick={confirmChar}>
                <Check size={18} />
                确认此字
              </button>
            </div>

            <div className="tool-row">
              <button className="tool-button" onClick={peekChar} disabled={peeking} title="看一眼这个字">
                <Eye size={18} />
                {peeking ? "看眼中…" : "看一眼"}
              </button>
              <button className="tool-button" onClick={undoStroke} title="撤销">
                <Undo2 size={18} />
                撤销
              </button>
              <button className="tool-button" onClick={clearCanvas} title="清空">
                <Eraser size={18} />
                清空
              </button>
              <span>{strokeCount} 笔</span>
            </div>
          </>
        )}

        {submitted && !hasCommittedResult && (
          <div className="comparison-view">
            <div className="comparison-grid">
              {chars.map((char, i) => (
                <div key={i} className="comparison-item">
                  <div className="comparison-cell">
                    <span className="comparison-tag">正确答案</span>
                    <span className="comparison-correct">{char}</span>
                  </div>
                  <div className="comparison-cell">
                    <span className="comparison-tag">你写的</span>
                    {charImages[i] ? (
                      <img src={charImages[i]} alt="手写字" className="comparison-img" />
                    ) : (
                      <span className="comparison-empty">未写</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="input-row answer-actions judge-actions">
              <button className="danger-button" onClick={() => judgeChar("wrong")}>
                <X size={18} />
                再练练
              </button>
              <button className="primary-action" onClick={() => judgeChar("correct")}>
                <Check size={18} />
                写对了
              </button>
            </div>
          </div>
        )}

        {statusWord && (
          <div className={`feedback ${statusWord.result}`}>
            {statusWord.result === "correct" && (
              <>
                <BadgeCheck size={24} />
                <div>
                  <strong>写对了</strong>
                  <p>{word.text} · {word.definition}</p>
                </div>
              </>
            )}
            {statusWord.result === "wrong" && (
              <>
                <RotateCcw size={24} />
                <div>
                  <strong>再练练</strong>
                  <p>正确写法：{word.text} · {word.definition}</p>
                </div>
              </>
            )}
            {statusWord.result === "revealed" && (
              <>
                <Eye size={24} />
                <div>
                  <strong>先看一眼也很好</strong>
                  <p>{word.text} · {word.definition}</p>
                </div>
              </>
            )}
          </div>
        )}

        {hasCommittedResult && (
          <div className="input-row answer-actions">
            <button className="secondary-action" onClick={onNext}>
              <ChevronRight size={18} />
              {index + 1 >= total ? "完成" : "下一题"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function CompletionView({
  title,
  subtitle,
  words: completedWords,
  correctCount,
  onPrimary,
  onSecondary,
  onRetry,
  primaryLabel = "进入闯关",
  secondaryLabel = "返回首页"
}: {
  title: string;
  subtitle: string;
  words: Word[];
  correctCount: number;
  onPrimary: () => void;
  onSecondary: () => void;
  onRetry?: () => void;
  primaryLabel?: string;
  secondaryLabel?: string;
}) {
  const [shareToast, setShareToast] = useState(false);

  return (
    <section className="completion-shell">
      <div className="stamp">完成</div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      <div className="completion-stats">
        <Metric label="独立写对" value={`${correctCount}/${completedWords.length}`} />
        <Metric label="获得经验" value={`+${completedWords.length * 10 + 20}`} />
      </div>
      <div className="found-words">
        {completedWords.map((word) => (
          <span key={word.id}>{word.text}</span>
        ))}
      </div>
      <div className="completion-actions">
        {onRetry && (
          <button className="ghost-button" onClick={onRetry}>
            <RotateCcw size={18} />
            再练一次
          </button>
        )}
        <button className="primary-action" onClick={onPrimary}>
          <BookOpen size={20} />
          {primaryLabel}
        </button>
        <button className="secondary-action" onClick={onSecondary}>
          <Home size={18} />
          {secondaryLabel}
        </button>
        <button
          className="tool-button"
          onClick={() => {
            track("share_click", { source: "completion" });
            window.navigator.clipboard?.writeText("今天我在“遗忘的字”找回了几个汉字。你还会只看拼音写出来吗？");
            setShareToast(true);
            window.setTimeout(() => setShareToast(false), 2500);
          }}
        >
          <Share2 size={18} />
          分享
        </button>
      </div>
      {shareToast && <div className="share-toast">分享文案已复制到剪贴板</div>}
    </section>
  );
}

function ProfileView({
  progress,
  level,
  badges: earned,
  monthOffset,
  onMonthChange,
  onToggleSetting,
  onAdmin,
  onReset
}: {
  progress: AppProgress;
  level: { level: number; title: string };
  badges: Set<string>;
  monthOffset: number;
  onMonthChange: (value: number) => void;
  onToggleSetting: (key: keyof AppProgress["settings"]) => void;
  onAdmin: () => void;
  onReset: () => void;
}) {
  const currentMonth = new Date();
  currentMonth.setMonth(currentMonth.getMonth() + monthOffset);
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const blanks = firstDay.getDay();

  return (
    <section className="profile-shell">
      <div className="profile-head">
        <div className="avatar">{progress.loggedIn ? "寻" : "游"}</div>
        <div>
          <p className="eyebrow">{progress.loggedIn ? "已登录" : "游客模式"}</p>
          <h1>{progress.nickname}</h1>
          <span>Lv.{level.level} · {level.title}</span>
        </div>
      </div>

      <div className="status-strip">
        <Metric label="连续打卡" value={`${progress.streak} 天`} />
        <Metric label="累计打卡" value={`${progress.totalCheckins} 天`} />
        <Metric label="找回词语" value={`${progress.completedWords} 个`} />
        <Metric label="独立写对" value={`${progress.correctWords} 个`} />
      </div>

      <section className="section-band compact">
        <div className="section-title">
          <div>
            <p className="eyebrow">打卡日历</p>
            <h2>{year} 年 {month + 1} 月</h2>
          </div>
          <div className="month-actions">
            <button className="icon-action" onClick={() => onMonthChange(monthOffset - 1)} title="上个月">
              <ArrowLeft size={18} />
            </button>
            <button className="icon-action" onClick={() => onMonthChange(0)} title="回到本月">
              <CalendarDays size={18} />
            </button>
            <button className="icon-action" onClick={() => onMonthChange(monthOffset + 1)} title="下个月">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
        <div className="calendar-grid">
          {["日", "一", "二", "三", "四", "五", "六"].map((item) => (
            <b key={item}>{item}</b>
          ))}
          {Array.from({ length: blanks }).map((_, index) => (
            <i key={`blank-${index}`} />
          ))}
          {Array.from({ length: days }).map((_, index) => {
            const day = index + 1;
            const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const record = progress.daily[key];
            return (
              <span className={record?.completed ? "done" : dateKey() === key ? "today" : ""} key={key} title={record?.completed ? `找回 ${record.answers.length} 个词` : ""}>
                {day}
              </span>
            );
          })}
        </div>
        <div className="calendar-legend">
          <span><i className="done" /> 已完成</span>
          <span><i className="today" /> 今天</span>
          <span><i /> 未完成</span>
        </div>
      </section>

      <section className="section-band compact">
        <div className="section-title">
          <div>
            <p className="eyebrow">徽章</p>
            <h2>一点一点写回来</h2>
          </div>
        </div>
        <div className="badge-grid">
          {badges.map((badge) => (
            <article className={`badge-card ${earned.has(badge.id) ? "earned" : ""}`} key={badge.id}>
              <Trophy size={22} />
              <strong>{badge.title}</strong>
              <span>{badge.condition}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="section-band compact">
        <div className="section-title">
          <div>
            <p className="eyebrow">设置</p>
            <h2>书写偏好</h2>
          </div>
          <button className="tool-button" onClick={onAdmin}>
            <Sparkles size={18} />
            管理
          </button>
        </div>
        <div className="settings-list">
          <SettingButton active={progress.settings.sound} icon={<Volume2 size={18} />} label="音效" onClick={() => onToggleSetting("sound")} />
          <SettingButton active={progress.settings.dark} icon={<Moon size={18} />} label="深色模式" onClick={() => onToggleSetting("dark")} />
          <SettingButton active={progress.settings.largeText} icon={<PencilLine size={18} />} label="大字号" onClick={() => onToggleSetting("largeText")} />
          <button className="danger-button" onClick={onReset}>
            <RotateCcw size={18} />
            清除本地缓存
          </button>
        </div>
      </section>
    </section>
  );
}

function SettingButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={`setting-button ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
      <i>{active ? "开" : "关"}</i>
    </button>
  );
}

function AdminView({ progress, onBack }: { progress: AppProgress; onBack: () => void }) {
  const [filter, setFilter] = useState("全部");
  const [eventCount, setEventCount] = useState(0);
  const categories = ["全部", "常见词", "文学", "古典", "成语"];
  const loadedWords = getLoadedWords();
  const filteredWords = filter === "全部" ? loadedWords : loadedWords.filter((word) => word.category === filter);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(EVENTS_KEY);
      const events = raw ? JSON.parse(raw) : [];
      setEventCount(Array.isArray(events) ? events.length : 0);
    } catch {
      setEventCount(0);
    }
  }, []);

  return (
    <section className="admin-shell">
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={18} />
        返回
      </button>
      <div className="page-heading">
        <p className="eyebrow">内容管理后台</p>
        <h1>词库、章节与基础埋点</h1>
      </div>

      <div className="status-strip">
        <Metric label="词库数量" value={`${loadedWords.length}`} />
        <Metric label="每日题库" value={`${loadedWords.filter((word) => word.daily).length}`} />
        <Metric label="完成挑战" value={`${progress.totalCheckins}`} />
        <Metric label="埋点记录" value={`${eventCount}`} />
      </div>

      <section className="section-band compact">
        <div className="filter-row">
          {categories.map((category) => (
            <button className={filter === category ? "active" : ""} onClick={() => setFilter(category)} key={category}>
              {category}
            </button>
          ))}
        </div>
        <div className="word-table">
          {filteredWords.map((word) => (
            <article key={word.id}>
              <strong>{word.text}</strong>
              <span>{word.pinyin}</span>
              <span>{word.category}</span>
              <span>难度 {word.difficulty}</span>
              <small>{word.definition}</small>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
