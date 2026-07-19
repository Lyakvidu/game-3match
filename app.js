"use strict";

/* ============================================================
   КРИСТАЛЛ КРАШ — статическая игра для VK Mini Apps
   ============================================================ */

const LEVELS = [
  { id: 1,  size: 6, colors: 4, moves: 22, target: 450  },
  { id: 2,  size: 6, colors: 4, moves: 20, target: 600  },
  { id: 3,  size: 6, colors: 4, moves: 19, target: 750  },
  { id: 4,  size: 7, colors: 4, moves: 20, target: 900  },
  { id: 5,  size: 7, colors: 5, moves: 19, target: 1100 },
  { id: 6,  size: 7, colors: 5, moves: 18, target: 1250 },
  { id: 7,  size: 8, colors: 5, moves: 20, target: 1450 },
  { id: 8,  size: 8, colors: 5, moves: 19, target: 1650 },
  { id: 9,  size: 8, colors: 5, moves: 18, target: 1850 },
  { id: 10, size: 8, colors: 6, moves: 20, target: 2100 },
  { id: 11, size: 8, colors: 6, moves: 19, target: 2350 },
  { id: 12, size: 8, colors: 6, moves: 18, target: 2600 },
  { id: 13, size: 9, colors: 6, moves: 20, target: 2900 },
  { id: 14, size: 9, colors: 6, moves: 19, target: 3250 },
  { id: 15, size: 9, colors: 6, moves: 18, target: 3600 },
];

const GEM_TYPES = ["red", "blue", "green", "yellow", "purple", "orange"];
const GEM_EMOJI = {
  red: "♦️",
  blue: "🔷",
  green: "🟢",
  yellow: "⭐",
  purple: "🔮",
  orange: "🔶",
};

const MOVE_MS = 180;
const MATCH_MS = 170;
const PROGRESS_KEY = "crystal_crash_progress_v2";
const LEGACY_PROGRESS_KEY = "gems_progress_v1";
const QUERY = new URLSearchParams(window.location.search);
const DEBUG_ADS = QUERY.get("debugAds") === "1";
const IS_VK_LAUNCH = QUERY.has("vk_app_id") || /(^|\.)vk\.(com|ru)$/i.test(new URL(document.referrer || window.location.href).hostname);

const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => window.requestAnimationFrame(resolve));
const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => window.setTimeout(() => reject(new Error("timeout")), ms)),
]);
const rnd = (n) => Math.floor(Math.random() * n);

/* ---------------- VK BRIDGE ---------------- */
const VK = {
  ready: false,
  launchParams: null,
  bridge: null,

  async init() {
    this.bridge = window.vkBridge || null;
    if (!this.bridge || !IS_VK_LAUNCH) return false;

    this.bridge.subscribe((event) => {
      const type = event && event.detail && event.detail.type;
      if (type === "VKWebAppViewHide") pauseMusic();
      if (type === "VKWebAppViewRestore") syncMusic();
    });

    try {
      await withTimeout(this.bridge.send("VKWebAppInit", {}), 3500);
      this.ready = true;

      try {
        this.launchParams = await withTimeout(this.bridge.send("VKWebAppGetLaunchParams", {}), 2000);
      } catch (_) {
        this.launchParams = null;
      }

      try {
        await this.bridge.send("VKWebAppSetViewSettings", {
          status_bar_style: "light",
          action_bar_color: "#1c1330",
          navigation_bar_color: "#150d27",
        });
      } catch (_) {
        // Часть клиентов не поддерживает все параметры оформления.
      }
      return true;
    } catch (_) {
      this.ready = false;
      return false;
    }
  },

  async storageGet(key) {
    if (!this.ready) return null;
    try {
      const response = await withTimeout(this.bridge.send("VKWebAppStorageGet", { keys: [key] }), 2500);
      const item = response.keys && response.keys.find((entry) => entry.key === key);
      return item && item.value ? item.value : null;
    } catch (_) {
      return null;
    }
  },

  async storageSet(key, value) {
    if (!this.ready) return false;
    try {
      await withTimeout(this.bridge.send("VKWebAppStorageSet", { key, value }), 2500);
      return true;
    } catch (_) {
      return false;
    }
  },

  async showRewarded() {
    if (!this.ready) return DEBUG_ADS;
    try {
      const check = await this.bridge.send("VKWebAppCheckNativeAds", { ad_format: "reward" });
      if (!check.result) return false;
      const result = await this.bridge.send("VKWebAppShowNativeAds", { ad_format: "reward" });
      return result.result === true;
    } catch (_) {
      return false;
    }
  },

  async showInterstitial() {
    if (!this.ready) return false;
    try {
      const check = await this.bridge.send("VKWebAppCheckNativeAds", { ad_format: "interstitial" });
      if (!check.result) return false;
      const result = await this.bridge.send("VKWebAppShowNativeAds", { ad_format: "interstitial" });
      return result.result === true;
    } catch (_) {
      return false;
    }
  },

  async share() {
    if (this.ready) {
      try {
        await this.bridge.send("VKWebAppShare", { link: window.location.href });
        return true;
      } catch (_) {
        return false;
      }
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Кристалл Краш",
          text: "Сыграй со мной в Кристалл Краш!",
          url: window.location.href,
        });
        return true;
      } catch (_) {
        return false;
      }
    }
    return false;
  },
};

/* ---------------- PROGRESS ---------------- */
const DEFAULT_PROGRESS = {
  version: 2,
  stars: {},
  unlocked: 1,
  settings: { music: true, sfx: true },
  updatedAt: 0,
};

let progress = structuredCloneSafe(DEFAULT_PROGRESS);

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseProgress(raw) {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;

    const clean = structuredCloneSafe(DEFAULT_PROGRESS);
    clean.unlocked = Math.max(1, Math.min(LEVELS.length, Number(data.unlocked) || 1));
    clean.updatedAt = Number(data.updatedAt) || 0;

    if (data.stars && typeof data.stars === "object") {
      for (const gameLevel of LEVELS) {
        const stars = Number(data.stars[gameLevel.id]);
        if (Number.isFinite(stars) && stars > 0) {
          clean.stars[gameLevel.id] = Math.max(0, Math.min(3, Math.floor(stars)));
        }
      }
    }

    if (data.settings && typeof data.settings === "object") {
      clean.settings.music = data.settings.music !== false;
      clean.settings.sfx = data.settings.sfx !== false;
    }
    return clean;
  } catch (_) {
    return null;
  }
}

function getLocalProgress() {
  try {
    return parseProgress(localStorage.getItem(PROGRESS_KEY))
      || parseProgress(localStorage.getItem(LEGACY_PROGRESS_KEY));
  } catch (_) {
    return null;
  }
}

async function syncProgressWithVK() {
  if (!VK.ready) return;
  const vkProgress = parseProgress(await VK.storageGet(PROGRESS_KEY));
  if (vkProgress && vkProgress.updatedAt > progress.updatedAt) {
    progress = vkProgress;
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (_) {}
    syncSettingsUi();
    updateMenuStats();
    if (document.getElementById("screen-levels").classList.contains("active")) renderLevels();
  } else if (progress.updatedAt > 0) {
    void VK.storageSet(PROGRESS_KEY, JSON.stringify(progress));
  }
}

function saveProgress() {
  progress.updatedAt = Date.now();
  const raw = JSON.stringify(progress);
  try {
    localStorage.setItem(PROGRESS_KEY, raw);
  } catch (_) {
    showToast("Не удалось сохранить прогресс на устройстве");
  }
  void VK.storageSet(PROGRESS_KEY, raw);
}

function totalStars() {
  return Object.values(progress.stars).reduce((sum, value) => sum + Number(value || 0), 0);
}

/* ---------------- AUDIO ---------------- */
const musicEl = document.getElementById("music");
musicEl.volume = 0.24;
let audioContext = null;
let audioUnlocked = false;

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  syncMusic();
}

function syncMusic() {
  if (!progress.settings.music || document.hidden) {
    pauseMusic();
    return;
  }
  if (!audioUnlocked) return;
  const playPromise = musicEl.play();
  if (playPromise) playPromise.catch(() => {});
}

function pauseMusic() {
  musicEl.pause();
}

function playTone(frequency, duration = 0.08, volume = 0.025, delay = 0) {
  if (!progress.settings.sfx || !audioUnlocked) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioContext ||= new AudioContextClass();
    if (audioContext.state === "suspended") void audioContext.resume();

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const start = audioContext.currentTime + delay;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.01);
  } catch (_) {
    // Звук не должен влиять на игровой процесс.
  }
}

function playWinSound() {
  playTone(523, 0.12, 0.035, 0);
  playTone(659, 0.12, 0.035, 0.12);
  playTone(784, 0.18, 0.04, 0.24);
}

document.addEventListener("pointerdown", unlockAudio, { once: true, passive: true });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseMusic();
  else syncMusic();
});

/* ---------------- GAME STATE ---------------- */
let level = null;
let size = 6;
let board = [];
let cellSize = 40;
let score = 0;
let movesLeft = 0;
let bombsLeft = 1;
let locked = true;
let selectedGem = null;
let pointerStart = null;
let bombArmed = false;
let gemIdSeq = 1;
let resizeFrame = 0;
let adBreakCounter = 0;
let lastInterstitialAt = 0;
let toastTimer = 0;

const boardEl = document.getElementById("board");

function randomType(colorsCount) {
  return GEM_TYPES[rnd(colorsCount)];
}

function makeGem(type, row, col) {
  return { id: gemIdSeq++, type, row, col, el: null };
}

function wouldMatch(grid, row, col, type) {
  const horizontal = col >= 2
    && grid[row][col - 1]
    && grid[row][col - 2]
    && grid[row][col - 1].type === type
    && grid[row][col - 2].type === type;
  const vertical = row >= 2
    && grid[row - 1][col]
    && grid[row - 2][col]
    && grid[row - 1][col].type === type
    && grid[row - 2][col].type === type;
  return horizontal || vertical;
}

function generateBoard() {
  const grid = Array.from({ length: size }, () => Array(size).fill(null));
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      let type = randomType(level.colors);
      let attempts = 0;
      while (wouldMatch(grid, row, col, type) && attempts < 50) {
        type = randomType(level.colors);
        attempts++;
      }
      grid[row][col] = makeGem(type, row, col);
    }
  }
  return grid;
}

function generatePlayableBoard() {
  for (let attempt = 0; attempt < 100; attempt++) {
    board = generateBoard();
    if (boardHasAnyMove()) return;
  }
  board = generateBoard();
}

/* ---------------- RENDERING ---------------- */
function computeCellSize() {
  const wrap = document.querySelector(".board-wrap");
  const availableWidth = Math.max(220, wrap.clientWidth - 20);
  const availableHeight = Math.max(220, wrap.clientHeight - 12);
  cellSize = Math.max(25, Math.floor(Math.min(availableWidth / size, availableHeight / size, 60)));
}

function renderBoardShell() {
  computeCellSize();
  const total = cellSize * size;
  boardEl.style.width = `${total}px`;
  boardEl.style.height = `${total}px`;
  boardEl.innerHTML = "";

  const fragment = document.createDocumentFragment();
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const background = document.createElement("div");
      background.className = "cell-bg";
      background.style.width = `${cellSize - 4}px`;
      background.style.height = `${cellSize - 4}px`;
      background.style.transform = `translate3d(${col * cellSize + 2}px, ${row * cellSize + 2}px, 0)`;
      fragment.appendChild(background);
    }
  }
  boardEl.appendChild(fragment);
}

function setGemVisual(gem) {
  gem.el.className = `gem gem-${gem.type}`;
  gem.el.textContent = GEM_EMOJI[gem.type];
  gem.el.setAttribute("aria-label", `Кристалл: ${gem.type}`);
}

function setGemPosition(gem, row = gem.row, col = gem.col) {
  if (!gem.el) return;
  const inset = cellSize * 0.09;
  gem.el.style.setProperty("--gem-x", `${col * cellSize + inset}px`);
  gem.el.style.setProperty("--gem-y", `${row * cellSize + inset}px`);
  gem.el.style.width = `${cellSize * 0.82}px`;
  gem.el.style.height = `${cellSize * 0.82}px`;
  gem.el.style.fontSize = `${Math.max(15, cellSize * 0.45)}px`;
}

function createGemEl(gem, spawnRow = gem.row, withoutTransition = false) {
  const element = document.createElement("div");
  element.dataset.id = String(gem.id);
  element.setAttribute("role", "button");
  if (withoutTransition) element.classList.add("no-transition");
  boardEl.appendChild(element);
  gem.el = element;
  setGemVisual(gem);
  if (withoutTransition) element.classList.add("no-transition");
  setGemPosition(gem, spawnRow, gem.col);

  element.addEventListener("pointerdown", (event) => onGemPointerDown(gem, event));
  element.addEventListener("pointerup", (event) => onGemPointerUp(gem, event));
  element.addEventListener("pointercancel", onPointerCancel);
  return element;
}

function renderFullBoard() {
  renderBoardShell();
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const gem = board[row][col];
      if (!gem) continue;
      createGemEl(gem, gem.row, true);
    }
  }
  void nextFrame().then(() => {
    boardEl.querySelectorAll(".gem.no-transition").forEach((element) => element.classList.remove("no-transition"));
  });
}

/* ---------------- INPUT ---------------- */
function onGemPointerDown(gem, event) {
  if (locked) return;
  event.preventDefault();
  if (event.currentTarget.setPointerCapture) {
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) {}
  }
  pointerStart = { x: event.clientX, y: event.clientY, gem };
}

function onGemPointerUp(gem, event) {
  if (locked || !pointerStart) return;
  event.preventDefault();

  const startGem = pointerStart.gem;
  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  const distance = Math.hypot(dx, dy);
  pointerStart = null;

  if (bombArmed) {
    void useBombOn(startGem);
    return;
  }

  if (distance > cellSize * 0.3) {
    let rowDelta = 0;
    let colDelta = 0;
    if (Math.abs(dx) > Math.abs(dy)) colDelta = dx > 0 ? 1 : -1;
    else rowDelta = dy > 0 ? 1 : -1;

    const targetRow = startGem.row + rowDelta;
    const targetCol = startGem.col + colDelta;
    if (targetRow >= 0 && targetRow < size && targetCol >= 0 && targetCol < size) {
      clearSelection();
      void attemptSwap(startGem, board[targetRow][targetCol]);
    }
    return;
  }

  if (selectedGem && selectedGem.id === gem.id) {
    clearSelection();
  } else if (selectedGem && isAdjacent(selectedGem, gem)) {
    const first = selectedGem;
    clearSelection();
    void attemptSwap(first, gem);
  } else {
    clearSelection();
    selectedGem = gem;
    gem.el.classList.add("selected");
  }
}

function onPointerCancel() {
  pointerStart = null;
}

function clearSelection() {
  if (selectedGem && selectedGem.el) selectedGem.el.classList.remove("selected");
  selectedGem = null;
}

function isAdjacent(first, second) {
  return Math.abs(first.row - second.row) + Math.abs(first.col - second.col) === 1;
}

/* ---------------- MATCH LOGIC ---------------- */
function findAllMatches() {
  const matched = new Set();

  for (let row = 0; row < size; row++) {
    let runStart = 0;
    for (let col = 1; col <= size; col++) {
      const same = col < size
        && board[row][col]
        && board[row][runStart]
        && board[row][col].type === board[row][runStart].type;
      if (!same) {
        if (col - runStart >= 3) {
          for (let index = runStart; index < col; index++) matched.add(`${row},${index}`);
        }
        runStart = col;
      }
    }
  }

  for (let col = 0; col < size; col++) {
    let runStart = 0;
    for (let row = 1; row <= size; row++) {
      const same = row < size
        && board[row][col]
        && board[runStart][col]
        && board[row][col].type === board[runStart][col].type;
      if (!same) {
        if (row - runStart >= 3) {
          for (let index = runStart; index < row; index++) matched.add(`${index},${col}`);
        }
        runStart = row;
      }
    }
  }
  return matched;
}

function swapCells(row1, col1, row2, col2) {
  const first = board[row1][col1];
  const second = board[row2][col2];
  board[row1][col1] = second;
  board[row2][col2] = first;
  if (first) {
    first.row = row2;
    first.col = col2;
  }
  if (second) {
    second.row = row1;
    second.col = col1;
  }
}

function boardHasAnyMove() {
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (col < size - 1) {
        swapCells(row, col, row, col + 1);
        const hasMatch = findAllMatches().size > 0;
        swapCells(row, col, row, col + 1);
        if (hasMatch) return true;
      }
      if (row < size - 1) {
        swapCells(row, col, row + 1, col);
        const hasMatch = findAllMatches().size > 0;
        swapCells(row, col, row + 1, col);
        if (hasMatch) return true;
      }
    }
  }
  return false;
}

function shuffle(values) {
  for (let index = values.length - 1; index > 0; index--) {
    const other = rnd(index + 1);
    [values[index], values[other]] = [values[other], values[index]];
  }
}

async function reshuffleBoard() {
  showToast("Нет доступных ходов — перемешиваем поле");
  const types = board.flat().filter(Boolean).map((gem) => gem.type);

  for (let attempt = 0; attempt < 300; attempt++) {
    shuffle(types);
    let index = 0;
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) board[row][col].type = types[index++];
    }
    if (findAllMatches().size === 0 && boardHasAnyMove()) {
      for (const gem of board.flat()) setGemVisual(gem);
      playTone(410, 0.08, 0.02);
      await sleep(140);
      return;
    }
  }

  generatePlayableBoard();
  renderFullBoard();
}

/* ---------------- SWAP AND CASCADE ---------------- */
async function attemptSwap(first, second) {
  if (!first || !second || !isAdjacent(first, second) || locked) return;
  locked = true;

  const row1 = first.row;
  const col1 = first.col;
  const row2 = second.row;
  const col2 = second.col;
  swapCells(row1, col1, row2, col2);
  setGemPosition(first);
  setGemPosition(second);
  await sleep(MOVE_MS + 15);

  if (findAllMatches().size === 0) {
    swapCells(row1, col1, row2, col2);
    setGemPosition(first);
    setGemPosition(second);
    playTone(170, 0.07, 0.018);
    await sleep(MOVE_MS + 10);
    locked = false;
    return;
  }

  movesLeft--;
  updateHud();
  await resolveCascade();
  locked = false;
  await checkEndConditions();
}

async function resolveCascade() {
  let cascadeIndex = 0;
  while (true) {
    const matches = findAllMatches();
    if (matches.size === 0) break;

    const gained = Math.round(matches.size * 10 * (1 + cascadeIndex * 0.45));
    score += gained;
    updateHud();
    showFloatingScore(gained, matches);
    playTone(420 + Math.min(cascadeIndex, 5) * 75, 0.09, 0.026);

    const removedElements = [];
    for (const key of matches) {
      const [row, col] = key.split(",").map(Number);
      const gem = board[row][col];
      if (!gem) continue;
      gem.el.classList.add("matched");
      removedElements.push(gem.el);
      board[row][col] = null;
    }

    await sleep(MATCH_MS);
    removedElements.forEach((element) => element.remove());
    await applyGravityAndRefill();
    cascadeIndex++;
  }

  if (!boardHasAnyMove()) await reshuffleBoard();
}

async function applyGravityAndRefill() {
  const spawned = [];

  for (let col = 0; col < size; col++) {
    const existing = [];
    for (let row = size - 1; row >= 0; row--) {
      if (board[row][col]) existing.push(board[row][col]);
      board[row][col] = null;
    }

    let writeRow = size - 1;
    for (const gem of existing) {
      gem.row = writeRow;
      gem.col = col;
      board[writeRow][col] = gem;
      writeRow--;
    }

    let spawnOffset = 1;
    for (let row = writeRow; row >= 0; row--) {
      const gem = makeGem(randomType(level.colors), row, col);
      board[row][col] = gem;
      createGemEl(gem, -spawnOffset, true);
      spawned.push(gem);
      spawnOffset++;
    }
  }

  // Два кадра разделяют стартовую и конечную позиции. Браузер выполняет
  // падение одним compositor-transform без перерасчёта layout на каждом кадре.
  await nextFrame();
  for (const gem of spawned) gem.el.classList.remove("no-transition");
  await nextFrame();

  for (const gem of board.flat()) setGemPosition(gem);
  await sleep(MOVE_MS + 25);
}

function showFloatingScore(amount, matches) {
  const keys = [...matches];
  if (!keys.length) return;
  const [row, col] = keys[Math.floor(keys.length / 2)].split(",").map(Number);
  const element = document.createElement("div");
  element.className = "floating-score";
  element.textContent = `+${amount}`;
  element.style.left = `${col * cellSize + cellSize * 0.16}px`;
  element.style.top = `${row * cellSize + cellSize * 0.08}px`;
  boardEl.appendChild(element);
  window.setTimeout(() => element.remove(), 760);
}

/* ---------------- BOOSTERS ---------------- */
function findHintMove() {
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (col < size - 1) {
        swapCells(row, col, row, col + 1);
        const hasMatch = findAllMatches().size > 0;
        swapCells(row, col, row, col + 1);
        if (hasMatch) return [board[row][col], board[row][col + 1]];
      }
      if (row < size - 1) {
        swapCells(row, col, row + 1, col);
        const hasMatch = findAllMatches().size > 0;
        swapCells(row, col, row + 1, col);
        if (hasMatch) return [board[row][col], board[row + 1][col]];
      }
    }
  }
  return null;
}

async function showHint() {
  if (locked) return;
  const pair = findHintMove();
  if (!pair) {
    await reshuffleBoard();
    return;
  }
  pair.forEach((gem) => gem.el.classList.add("hint"));
  playTone(620, 0.09, 0.02);
  await sleep(1000);
  pair.forEach((gem) => gem.el && gem.el.classList.remove("hint"));
}

function armBomb() {
  if (locked) return;
  if (bombsLeft <= 0) {
    showToast("Бомба на этом уровне уже использована");
    return;
  }
  bombArmed = !bombArmed;
  clearSelection();
  document.getElementById("booster-bomb").classList.toggle("active-armed", bombArmed);
  showToast(bombArmed ? "Выбери кристалл для взрыва" : "Бомба отменена");
}

async function useBombOn(gem) {
  if (locked || bombsLeft <= 0 || !gem) return;
  bombArmed = false;
  bombsLeft--;
  document.getElementById("booster-bomb").classList.remove("active-armed");
  locked = true;

  const affected = [];
  const centerRow = gem.row;
  const centerCol = gem.col;
  for (let row = Math.max(0, centerRow - 1); row <= Math.min(size - 1, centerRow + 1); row++) {
    for (let col = Math.max(0, centerCol - 1); col <= Math.min(size - 1, centerCol + 1); col++) {
      if (Math.abs(row - centerRow) + Math.abs(col - centerCol) > 1) continue;
      const target = board[row][col];
      if (!target) continue;
      target.el.classList.add("matched");
      affected.push(target.el);
      board[row][col] = null;
    }
  }

  score += affected.length * 15;
  updateHud();
  playTone(145, 0.16, 0.045);
  await sleep(MATCH_MS);
  affected.forEach((element) => element.remove());
  await applyGravityAndRefill();
  await resolveCascade();
  locked = false;
  await checkEndConditions();
}

async function watchAdForMoves(fromLoseModal = false) {
  if (locked && !fromLoseModal) return;
  const button = fromLoseModal
    ? document.getElementById("lose-btn-ad")
    : document.getElementById("booster-moves");
  button.disabled = true;

  const previousLocked = locked;
  locked = true;
  const rewarded = await VK.showRewarded();
  if (rewarded) {
    movesLeft += 5;
    updateHud();
    hideModal("modal-lose");
    showToast("Начислено 5 дополнительных ходов");
    playTone(720, 0.12, 0.03);
    locked = false;
  } else {
    locked = previousLocked;
    showToast(VK.ready ? "Реклама сейчас недоступна" : "Реклама доступна внутри VK");
  }
  button.disabled = false;
}

/* ---------------- HUD AND LEVEL RESULT ---------------- */
function updateHud() {
  if (!level) return;
  document.getElementById("hud-moves").textContent = String(movesLeft);
  document.getElementById("hud-level").textContent = `Уровень ${level.id}`;
  document.getElementById("hud-score").textContent = `${score} / ${level.target}`;
  const percentage = Math.min(100, Math.round((score / level.target) * 100));
  document.getElementById("hud-progress-fill").style.width = `${percentage}%`;
  document.getElementById("bomb-count").textContent = String(bombsLeft);
  const bombButton = document.getElementById("booster-bomb");
  bombButton.disabled = bombsLeft <= 0;
  bombButton.setAttribute("aria-label", `Бомба, осталось: ${bombsLeft}`);
}

async function checkEndConditions() {
  if (score >= level.target) await finishLevel(true);
  else if (movesLeft <= 0) await finishLevel(false);
}

function starsForResult() {
  if (!level || score < level.target) return 0;
  const remainingRatio = movesLeft / level.moves;
  if (remainingRatio >= 0.45) return 3;
  if (remainingRatio >= 0.2) return 2;
  return 1;
}

async function maybeShowInterstitial() {
  adBreakCounter++;
  const enoughGames = adBreakCounter >= 2;
  const enoughTime = Date.now() - lastInterstitialAt >= 90000;
  if (!enoughGames || !enoughTime) return;
  const shown = await VK.showInterstitial();
  if (shown) {
    adBreakCounter = 0;
    lastInterstitialAt = Date.now();
  }
}

async function finishLevel(won) {
  locked = true;
  clearSelection();
  bombArmed = false;
  document.getElementById("booster-bomb").classList.remove("active-armed");

  if (won) {
    const stars = starsForResult();
    const previousStars = progress.stars[level.id] || 0;
    progress.stars[level.id] = Math.max(previousStars, stars);
    progress.unlocked = Math.max(progress.unlocked, Math.min(LEVELS.length, level.id + 1));
    saveProgress();
    updateMenuStats();
    playWinSound();

    document.querySelectorAll("#win-stars .big-star").forEach((element, index) => {
      element.classList.toggle("lit", index < stars);
    });
    document.getElementById("win-score-text").textContent = `Счёт: ${score}. Осталось ходов: ${movesLeft}.`;
    document.getElementById("win-btn-next").hidden = !LEVELS.some((item) => item.id === level.id + 1);
  } else {
    playTone(210, 0.22, 0.03);
    document.getElementById("lose-score-text").textContent = `Счёт: ${score} из ${level.target}.`;
  }

  await maybeShowInterstitial();
  showModal(won ? "modal-win" : "modal-lose");
}

/* ---------------- SCREENS AND UI ---------------- */
function showScreen(name) {
  document.querySelectorAll(".screen").forEach((screen) => {
    const active = screen.id === `screen-${name}`;
    screen.classList.toggle("active", active);
    screen.setAttribute("aria-hidden", active ? "false" : "true");
  });
  if (name === "menu") updateMenuStats();
}

function showModal(id) {
  document.getElementById(id).classList.add("active");
}

function hideModal(id) {
  document.getElementById(id).classList.remove("active");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("active");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("active"), 2400);
}

function updateMenuStats() {
  document.getElementById("menu-stars").textContent = String(totalStars());
  document.getElementById("menu-level").textContent = String(Math.min(progress.unlocked, LEVELS.length));
}

function renderLevels() {
  const grid = document.getElementById("levels-grid");
  const fragment = document.createDocumentFragment();
  grid.innerHTML = "";

  for (const gameLevel of LEVELS) {
    const stars = progress.stars[gameLevel.id] || 0;
    const isLocked = gameLevel.id > progress.unlocked;
    const card = document.createElement("button");
    card.type = "button";
    card.className = `level-card${isLocked ? " locked" : ""}${stars > 0 ? " done" : ""}`;
    card.disabled = isLocked;
    card.setAttribute("aria-label", isLocked ? `Уровень ${gameLevel.id} заблокирован` : `Уровень ${gameLevel.id}, звёзд: ${stars}`);

    if (isLocked) {
      card.innerHTML = '<span class="lock-icon" aria-hidden="true">🔒</span>';
    } else {
      card.innerHTML = `<span>${gameLevel.id}</span><span class="lv-stars" aria-hidden="true">${"★".repeat(stars)}${"☆".repeat(3 - stars)}</span>`;
      card.addEventListener("click", () => startLevel(gameLevel.id));
    }
    fragment.appendChild(card);
  }
  grid.appendChild(fragment);
  document.getElementById("total-stars").textContent = String(totalStars());
}

function syncSettingsUi() {
  document.getElementById("setting-music").checked = progress.settings.music;
  document.getElementById("setting-sfx").checked = progress.settings.sfx;
}

async function startLevel(id) {
  const nextLevel = LEVELS.find((item) => item.id === id);
  if (!nextLevel || id > progress.unlocked) return;

  level = nextLevel;
  size = level.size;
  score = 0;
  movesLeft = level.moves;
  bombsLeft = 1;
  locked = true;
  bombArmed = false;
  clearSelection();
  document.getElementById("booster-bomb").classList.remove("active-armed");

  generatePlayableBoard();
  showScreen("game");
  renderFullBoard();
  updateHud();
  await nextFrame();
  locked = false;
}

function returnToLevels() {
  hideModal("modal-win");
  hideModal("modal-lose");
  locked = true;
  showScreen("levels");
  renderLevels();
}

/* ---------------- EVENT HANDLERS ---------------- */
document.getElementById("btn-play").addEventListener("click", () => startLevel(Math.min(progress.unlocked, LEVELS.length)));
document.getElementById("btn-levels").addEventListener("click", () => {
  renderLevels();
  showScreen("levels");
});
document.getElementById("btn-settings").addEventListener("click", () => showScreen("settings"));
document.getElementById("btn-share").addEventListener("click", async () => {
  const shared = await VK.share();
  showToast(shared ? "Спасибо!" : "Поделиться можно после запуска игры в VK");
});

document.getElementById("levels-back").addEventListener("click", () => showScreen("menu"));
document.getElementById("settings-back").addEventListener("click", () => showScreen("menu"));
document.getElementById("btn-back").addEventListener("click", returnToLevels);
document.getElementById("btn-restart").addEventListener("click", () => level && startLevel(level.id));

document.getElementById("booster-hint").addEventListener("click", showHint);
document.getElementById("booster-bomb").addEventListener("click", armBomb);
document.getElementById("booster-moves").addEventListener("click", () => watchAdForMoves(false));

document.getElementById("win-btn-levels").addEventListener("click", returnToLevels);
document.getElementById("win-btn-next").addEventListener("click", () => {
  const nextId = level.id + 1;
  hideModal("modal-win");
  void startLevel(nextId);
});
document.getElementById("lose-btn-levels").addEventListener("click", returnToLevels);
document.getElementById("lose-btn-retry").addEventListener("click", () => {
  hideModal("modal-lose");
  void startLevel(level.id);
});
document.getElementById("lose-btn-ad").addEventListener("click", () => watchAdForMoves(true));

document.getElementById("setting-music").addEventListener("change", (event) => {
  progress.settings.music = event.target.checked;
  saveProgress();
  syncMusic();
});
document.getElementById("setting-sfx").addEventListener("change", (event) => {
  progress.settings.sfx = event.target.checked;
  saveProgress();
  if (progress.settings.sfx) playTone(640, 0.08, 0.025);
});

document.getElementById("btn-reset-progress").addEventListener("click", () => showModal("modal-confirm-reset"));
document.getElementById("reset-cancel").addEventListener("click", () => hideModal("modal-confirm-reset"));
document.getElementById("reset-confirm").addEventListener("click", () => {
  progress = structuredCloneSafe(DEFAULT_PROGRESS);
  saveProgress();
  syncSettingsUi();
  updateMenuStats();
  hideModal("modal-confirm-reset");
  showToast("Прогресс сброшен");
});

document.getElementById("loading-retry").addEventListener("click", () => window.location.reload());

window.addEventListener("resize", () => {
  window.cancelAnimationFrame(resizeFrame);
  resizeFrame = window.requestAnimationFrame(() => {
    if (level && document.getElementById("screen-game").classList.contains("active")) renderFullBoard();
  });
});

window.addEventListener("pagehide", saveProgress);
window.addEventListener("error", () => {
  if (document.getElementById("screen-loading").classList.contains("active")) {
    document.querySelector(".loader-text").textContent = "Не удалось запустить игру";
    document.getElementById("loading-retry").hidden = false;
  }
});

/* ---------------- BOOTSTRAP ---------------- */
async function boot() {
  const bridgeInit = VK.init();
  progress = getLocalProgress() || structuredCloneSafe(DEFAULT_PROGRESS);
  syncSettingsUi();
  updateMenuStats();
  showScreen("menu");

  try {
    await bridgeInit;
    await syncProgressWithVK();
  } catch (_) {
    showToast("Игра запущена в автономном режиме");
  }
}

void boot();
