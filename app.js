const STORAGE_KEY = "audit-ballpark-season-v1";
const DAILY_GOAL = 10;

const els = Object.fromEntries([
  "header-level", "attempts-today", "accuracy-stat", "streak-stat", "correct-stat", "pool-stat",
  "goal-copy", "goal-fill", "chapter-code", "chapter-title", "pitch-count", "question-text",
  "answer-list", "feedback-panel", "feedback-icon", "feedback-kicker", "feedback-title", "feedback-copy",
  "decision-panel", "next-panel", "master-button", "return-button", "next-button", "level-badge",
  "xp-copy", "xp-fill", "career-attempts", "best-streak", "mastered-count", "pool-total",
  "pool-note", "chapter-select", "reset-button", "reset-dialog", "toast", "question-stage"
].map(id => [id, document.getElementById(id)]));

let questions = [];
let currentQuestion = null;
let phase = "loading";
let lastAnsweredCorrectly = false;
let toastTimer;

const blankState = () => ({
  attempts: 0,
  correct: 0,
  streak: 0,
  bestStreak: 0,
  xp: 0,
  mastered: [],
  today: new Date().toISOString().slice(0, 10),
  todayAttempts: 0,
  todayCorrect: 0,
  chapter: "all",
  lastQuestionId: null
});

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const state = { ...blankState(), ...saved };
    const today = new Date().toISOString().slice(0, 10);
    if (state.today !== today) {
      state.today = today;
      state.todayAttempts = 0;
      state.todayCorrect = 0;
    }
    return state;
  } catch {
    return blankState();
  }
}

let state = loadState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function eligibleQuestions() {
  const mastered = new Set(state.mastered);
  return questions.filter(question =>
    !mastered.has(question.id) &&
    (state.chapter === "all" || String(question.chapter) === state.chapter)
  );
}

function randomQuestion() {
  const pool = eligibleQuestions();
  if (!pool.length) return null;
  const choices = pool.length > 1 ? pool.filter(q => q.id !== state.lastQuestionId) : pool;
  return choices[Math.floor(Math.random() * choices.length)];
}

function formatAverage() {
  if (!state.attempts) return ".000";
  return (state.correct / state.attempts).toFixed(3).replace(/^0/, "");
}

function levelInfo() {
  const level = Math.floor(state.xp / 100) + 1;
  return { level, current: state.xp % 100 };
}

function updateStats() {
  const pool = eligibleQuestions().length;
  const { level, current } = levelInfo();
  els["header-level"].textContent = `Lv. ${level}`;
  els["attempts-today"].textContent = state.todayAttempts;
  els["accuracy-stat"].textContent = formatAverage();
  els["streak-stat"].textContent = state.streak;
  els["correct-stat"].textContent = state.correct;
  els["pool-stat"].textContent = pool;
  els["goal-copy"].textContent = `${Math.min(state.todayAttempts, DAILY_GOAL)} / ${DAILY_GOAL}`;
  els["goal-fill"].style.width = `${Math.min(state.todayAttempts / DAILY_GOAL, 1) * 100}%`;
  els["goal-fill"].parentElement.setAttribute("aria-valuenow", Math.min(state.todayAttempts, DAILY_GOAL));
  els["level-badge"].textContent = String(level).padStart(2, "0");
  els["xp-copy"].textContent = `${current} / 100 XP`;
  els["xp-fill"].style.width = `${current}%`;
  els["career-attempts"].textContent = state.attempts;
  els["best-streak"].textContent = state.bestStreak;
  els["mastered-count"].textContent = state.mastered.length;
  els["pool-total"].textContent = `${pool} 題`;
}

function populateChapters() {
  const chapters = [...new Map(questions.map(q => [q.chapter, q.chapterTitle])).entries()];
  for (const [number, title] of chapters) {
    const option = document.createElement("option");
    option.value = String(number);
    option.textContent = `CH${String(number).padStart(2, "0")} ${title}`;
    els["chapter-select"].append(option);
  }
  if ([...els["chapter-select"].options].some(option => option.value === state.chapter)) {
    els["chapter-select"].value = state.chapter;
  } else {
    state.chapter = "all";
  }
}

function renderQuestion(question) {
  currentQuestion = question;
  phase = "answering";
  lastAnsweredCorrectly = false;
  els["feedback-panel"].hidden = true;
  els["decision-panel"].hidden = true;
  els["next-panel"].hidden = true;
  els["question-stage"].classList.remove("empty-state");
  els["chapter-code"].textContent = `CH ${String(question.chapter).padStart(2, "0")}`;
  els["chapter-title"].textContent = question.chapterTitle;
  els["pitch-count"].textContent = `第 ${state.todayAttempts + 1} 球`;
  els["question-text"].textContent = question.question;
  els["answer-list"].replaceChildren();

  question.options.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "answer-option";
    button.dataset.key = option.key;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", "false");
    button.innerHTML = `<span class="letter">${option.key}</span><span>${escapeHtml(option.text)}</span>`;
    button.addEventListener("click", () => submitAnswer(option.key));
    button.setAttribute("aria-keyshortcuts", String(index + 1));
    els["answer-list"].append(button);
  });
  updateStats();
}

function renderEmpty() {
  currentQuestion = null;
  phase = "empty";
  const selected = state.chapter === "all" ? "目前題庫" : "這個章節";
  els["chapter-code"].textContent = "CLEAR";
  els["chapter-title"].textContent = "練習池已清空";
  els["pitch-count"].textContent = "完賽";
  els["question-stage"].className = "question-stage empty-state";
  els["question-text"].textContent = `${selected}全部掌握`;
  els["answer-list"].innerHTML = `<div class="ball">✓</div><p>所有題目都已收入名人堂。可以換一個章節，或重置賽季重新挑戰。</p>`;
  els["feedback-panel"].hidden = true;
  els["decision-panel"].hidden = true;
  els["next-panel"].hidden = true;
  updateStats();
}

function drawNext() {
  const next = randomQuestion();
  if (!next) return renderEmpty();
  renderQuestion(next);
}

function advanceAfterReview() {
  if (phase !== "reviewing") return { ok: false, reason: "not_reviewing" };
  drawNext();
  return { ok: true, nextQuestionId: currentQuestion?.id || null };
}

function submitAnswer(key) {
  if (phase !== "answering" || !currentQuestion) return { ok: false, reason: "not_answering" };
  if (!currentQuestion.options.some(option => option.key === key)) return { ok: false, reason: "invalid_option" };
  const correct = key === currentQuestion.answer;
  lastAnsweredCorrectly = correct;
  state.attempts += 1;
  state.todayAttempts += 1;
  state.lastQuestionId = currentQuestion.id;

  if (correct) {
    state.correct += 1;
    state.todayCorrect += 1;
    state.streak += 1;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    state.xp += 18 + Math.min(state.streak, 7) * 2;
  } else {
    state.streak = 0;
    state.xp += 4;
  }

  for (const button of els["answer-list"].querySelectorAll("button")) {
    button.disabled = true;
    const optionKey = button.dataset.key;
    if (optionKey === currentQuestion.answer) button.classList.add("correct");
    if (optionKey === key && !correct) button.classList.add("wrong");
    button.setAttribute("aria-checked", String(optionKey === key));
  }

  const correctOption = currentQuestion.options.find(option => option.key === currentQuestion.answer);
  els["feedback-icon"].textContent = correct ? "✓" : "×";
  els["feedback-icon"].classList.toggle("miss", !correct);
  els["feedback-kicker"].textContent = correct ? "NICE HIT" : "FOUL BALL";
  els["feedback-title"].textContent = correct ? `答對了，連勝 ${state.streak}` : "這題會回到練習池";
  els["feedback-copy"].textContent = correct
    ? "這題由你決定：收入名人堂，或保留在練習池加深記憶。"
    : `正確答案是 ${currentQuestion.answer}：${correctOption?.text || "請參考題庫"}`;
  els["feedback-panel"].hidden = false;
  els["decision-panel"].hidden = !correct;
  els["next-panel"].hidden = correct;
  phase = correct ? "deciding" : "reviewing";
  saveState();
  updateStats();
  return { ok: true, correct, answer: currentQuestion.answer, streak: state.streak };
}

function resolveCorrect(mastered) {
  if (phase !== "deciding" || !currentQuestion || !lastAnsweredCorrectly) {
    return { ok: false, reason: "no_correct_answer_to_resolve" };
  }
  if (mastered && !state.mastered.includes(currentQuestion.id)) {
    state.mastered.push(currentQuestion.id);
    state.xp += 12;
    showToast("已收入名人堂，重置前不再出現");
  } else {
    showToast("已放回練習池");
  }
  saveState();
  drawNext();
  return { ok: true, mastered, remaining: eligibleQuestions().length };
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("show");
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2300);
}

function resetSeason() {
  const chapter = state.chapter;
  state = { ...blankState(), chapter };
  saveState();
  showToast("新賽季開始，全部題目已回到練習池");
  drawNext();
  return { ok: true, totalQuestions: questions.length };
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function registerWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const tools = [
    {
      name: "get_practice_state",
      title: "查看刷題狀態",
      description: "Read the visible quiz question, practice pool size, and season statistics without changing state.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: () => ({
        phase,
        question: currentQuestion ? { id: currentQuestion.id, text: currentQuestion.question, options: currentQuestion.options } : null,
        stats: { attempts: state.attempts, correct: state.correct, streak: state.streak, mastered: state.mastered.length },
        remaining: eligibleQuestions().length
      })
    },
    {
      name: "answer_current_question",
      title: "回答目前題目",
      description: "Submit one option key for the visible question. This updates the same season statistics as choosing an answer on screen.",
      inputSchema: { type: "object", properties: { option: { type: "string", enum: ["A", "B", "C", "D", "E", "F"] } }, required: ["option"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: input => {
        if (!input || typeof input.option !== "string") throw new Error("option is required");
        const result = submitAnswer(input.option);
        if (!result.ok) throw new Error(result.reason);
        return result;
      }
    },
    {
      name: "resolve_correct_question",
      title: "決定答對題目的去留",
      description: "After a correct answer, either mark the question mastered or return it to the practice pool.",
      inputSchema: { type: "object", properties: { mastered: { type: "boolean" } }, required: ["mastered"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: input => {
        if (!input || typeof input.mastered !== "boolean") throw new Error("mastered must be boolean");
        const result = resolveCorrect(input.mastered);
        if (!result.ok) throw new Error(result.reason);
        return result;
      }
    },
    {
      name: "draw_next_question",
      title: "抽下一題",
      description: "After reviewing a wrong answer, draw another random question from the current practice pool.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: () => {
        const result = advanceAfterReview();
        if (!result.ok) throw new Error(result.reason);
        return result;
      }
    }
  ];
  for (const tool of tools) {
    Promise.resolve(context.registerTool(tool)).catch(() => {});
  }
}

els["master-button"].addEventListener("click", () => resolveCorrect(true));
els["return-button"].addEventListener("click", () => resolveCorrect(false));
els["next-button"].addEventListener("click", advanceAfterReview);
els["chapter-select"].addEventListener("change", event => {
  state.chapter = event.target.value;
  saveState();
  drawNext();
});
els["reset-button"].addEventListener("click", () => els["reset-dialog"].showModal());
els["reset-dialog"].addEventListener("close", () => {
  if (els["reset-dialog"].returnValue === "confirm") resetSeason();
});

document.addEventListener("keydown", event => {
  if (els["reset-dialog"].open) return;
  if (phase === "answering" && /^[1-6]$/.test(event.key)) {
    const option = currentQuestion?.options[Number(event.key) - 1];
    if (option) submitAnswer(option.key);
  } else if (event.key === "Enter" && phase === "reviewing") {
    advanceAfterReview();
  }
});

fetch("./questions.json")
  .then(response => {
    if (!response.ok) throw new Error("題庫載入失敗");
    return response.json();
  })
  .then(data => {
    questions = data;
    populateChapters();
    drawNext();
    registerWebMcp();
  })
  .catch(error => {
    phase = "error";
    els["question-text"].textContent = "題庫暫時無法載入";
    els["answer-list"].innerHTML = `<p>${escapeHtml(error.message)}，請重新整理頁面。</p>`;
  });

