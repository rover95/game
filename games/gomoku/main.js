const BOARD_SIZE = 15;
const WIN_LENGTH = 5;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const CENTER = Math.floor(BOARD_SIZE / 2);
const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];
const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
const TERMINAL_SCORE = 1_000_000_000;
const SCORE = {
  FIVE: 120_000_000,
  OPEN_FOUR: 12_000_000,
  FOUR: 2_200_000,
  OPEN_THREE: 260_000,
  BROKEN_THREE: 42_000,
  OPEN_TWO: 6_000,
  BROKEN_TWO: 850,
  SINGLE: 24,
};
const PATTERN_RULES = [
  { key: "five", regex: /XXXXX/g, score: SCORE.FIVE },
  { key: "openFour", regex: /_XXXX_/g, score: SCORE.OPEN_FOUR },
  { key: "four", regex: /(?:OXXXX_|_XXXXO|XX_XX|X_XXX|XXX_X)/g, score: SCORE.FOUR },
  { key: "openThree", regex: /(?:_XXX_|_XX_X_|_X_XX_)/g, score: SCORE.OPEN_THREE },
  { key: "brokenThree", regex: /(?:OXXX__|__XXXO|OXX_X_|_X_XXO|OX_XX_|_XX_XO|_XX__X_|_X__XX_|_X_X_X_)/g, score: SCORE.BROKEN_THREE },
  { key: "openTwo", regex: /(?:__XX__|__X_X__|_X__X_)/g, score: SCORE.OPEN_TWO },
  { key: "brokenTwo", regex: /(?:OXX___|___XXO|OX_X__|__X_XO|O_X_X_|_X_X_O)/g, score: SCORE.BROKEN_TWO },
];
const AI_LEVELS = {
  easy: {
    label: "入门",
    depth: 1,
    timeLimit: 80,
    candidateLimit: 8,
    randomTop: 3,
  },
  medium: {
    label: "进阶",
    depth: 2,
    timeLimit: 220,
    candidateLimit: 10,
  },
  hard: {
    label: "困难",
    depth: 3,
    timeLimit: 700,
    candidateLimit: 12,
  },
  master: {
    label: "天元",
    depth: 5,
    timeLimit: 1800,
    candidateLimit: 14,
    threatExtension: true,
  },
};

const elements = {
  board: document.getElementById("board"),
  statusText: document.getElementById("status-text"),
  turnLabel: document.getElementById("turn-label"),
  modeLabel: document.getElementById("mode-label"),
  moveCount: document.getElementById("move-count"),
  lastMoveLabel: document.getElementById("last-move-label"),
  difficulty: document.getElementById("difficulty"),
  humanSide: document.getElementById("human-side"),
  newGame: document.getElementById("new-game"),
  undo: document.getElementById("undo"),
  turnChip: document.getElementById("turn-chip"),
  thinkingPill: document.getElementById("thinking-pill"),
  aiLevelPill: document.getElementById("ai-level-pill"),
  aiDepth: document.getElementById("ai-depth"),
  aiScore: document.getElementById("ai-score"),
  aiNodes: document.getElementById("ai-nodes"),
  aiTime: document.getElementById("ai-time"),
  modeButtons: Array.from(document.querySelectorAll("[data-mode]")),
  boardTitle: document.getElementById("board-title"),
  result: document.getElementById("result"),
  resultTitle: document.getElementById("result-title"),
  resultCopy: document.getElementById("result-copy"),
  resultRestart: document.getElementById("result-restart"),
};

const ctx = elements.board.getContext("2d");

const state = {
  board: new Uint8Array(CELL_COUNT),
  moveHistory: [],
  currentPlayer: BLACK,
  mode: "ai",
  humanSide: BLACK,
  difficulty: "easy",
  winner: EMPTY,
  winningLine: [],
  hoverCell: null,
  aiThinking: false,
  lastMove: null,
  renderMetrics: null,
  aiReport: {
    depth: null,
    score: null,
    nodes: 0,
    time: 0,
  },
};

const SEARCH_LINES = buildSearchLines();
const ZOBRIST = buildZobristTable();

function buildSearchLines() {
  const lines = [];

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    lines.push(Array.from({ length: BOARD_SIZE }, (_, x) => indexAt(x, y)));
  }

  for (let x = 0; x < BOARD_SIZE; x += 1) {
    lines.push(Array.from({ length: BOARD_SIZE }, (_, y) => indexAt(x, y)));
  }

  for (let startX = 0; startX < BOARD_SIZE; startX += 1) {
    const line = [];
    for (let x = startX, y = 0; x < BOARD_SIZE && y < BOARD_SIZE; x += 1, y += 1) {
      line.push(indexAt(x, y));
    }
    if (line.length >= WIN_LENGTH) {
      lines.push(line);
    }
  }

  for (let startY = 1; startY < BOARD_SIZE; startY += 1) {
    const line = [];
    for (let x = 0, y = startY; x < BOARD_SIZE && y < BOARD_SIZE; x += 1, y += 1) {
      line.push(indexAt(x, y));
    }
    if (line.length >= WIN_LENGTH) {
      lines.push(line);
    }
  }

  for (let startX = 0; startX < BOARD_SIZE; startX += 1) {
    const line = [];
    for (let x = startX, y = BOARD_SIZE - 1; x < BOARD_SIZE && y >= 0; x += 1, y -= 1) {
      line.push(indexAt(x, y));
    }
    if (line.length >= WIN_LENGTH) {
      lines.push(line);
    }
  }

  for (let startY = BOARD_SIZE - 2; startY >= 0; startY -= 1) {
    const line = [];
    for (let x = 0, y = startY; x < BOARD_SIZE && y >= 0; x += 1, y -= 1) {
      line.push(indexAt(x, y));
    }
    if (line.length >= WIN_LENGTH) {
      lines.push(line);
    }
  }

  return lines;
}

function buildZobristTable() {
  let seed = 0x9e3779b9;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };

  return Array.from({ length: CELL_COUNT }, () => [0, next(), next()]);
}

function otherPlayer(player) {
  return player === BLACK ? WHITE : BLACK;
}

function playerName(player) {
  return player === BLACK ? "黑棋" : "白棋";
}

function modeName(mode) {
  return mode === "ai" ? "人机" : "双人";
}

function indexAt(x, y) {
  return y * BOARD_SIZE + x;
}

function insideBoard(x, y) {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

function getCell(board, x, y) {
  return insideBoard(x, y) ? board[indexAt(x, y)] : null;
}

function makeSearchState(sourceBoard = state.board) {
  let hash = 0;

  for (let index = 0; index < CELL_COUNT; index += 1) {
    const value = sourceBoard[index];
    if (value !== EMPTY) {
      hash = (hash ^ ZOBRIST[index][value]) >>> 0;
    }
  }

  return {
    board: Uint8Array.from(sourceBoard),
    moveCount: state.moveHistory.length,
    hash,
  };
}

function applySearchMove(searchState, x, y, player) {
  const cellIndex = indexAt(x, y);
  searchState.board[cellIndex] = player;
  searchState.hash = (searchState.hash ^ ZOBRIST[cellIndex][player]) >>> 0;
  searchState.moveCount += 1;
}

function undoSearchMove(searchState, x, y, player) {
  const cellIndex = indexAt(x, y);
  searchState.board[cellIndex] = EMPTY;
  searchState.hash = (searchState.hash ^ ZOBRIST[cellIndex][player]) >>> 0;
  searchState.moveCount -= 1;
}

function countMatches(source, regex) {
  const matches = source.match(regex);
  return matches ? matches.length : 0;
}

function analyzeRelativeString(source) {
  const counts = {
    five: 0,
    openFour: 0,
    four: 0,
    openThree: 0,
    brokenThree: 0,
    openTwo: 0,
    brokenTwo: 0,
  };
  let total = 0;

  for (const rule of PATTERN_RULES) {
    const hitCount = countMatches(source, rule.regex);
    if (!hitCount) {
      continue;
    }
    counts[rule.key] += hitCount;
    total += hitCount * rule.score;
  }

  return { counts, total };
}

function buildRelativeLine(board, x, y, dx, dy, player, radius = 5) {
  let source = "O";

  for (let step = -radius; step <= radius; step += 1) {
    const nextX = x + dx * step;
    const nextY = y + dy * step;

    if (!insideBoard(nextX, nextY)) {
      source += "O";
      continue;
    }

    const value = board[indexAt(nextX, nextY)];
    if (value === EMPTY) {
      source += "_";
    } else if (value === player) {
      source += "X";
    } else {
      source += "O";
    }
  }

  return `${source}O`;
}

function classifyMove(board, x, y, player) {
  if (!insideBoard(x, y) || getCell(board, x, y) !== EMPTY) {
    return { score: -Infinity, counts: null };
  }

  const cellIndex = indexAt(x, y);
  board[cellIndex] = player;

  const aggregate = {
    five: 0,
    openFour: 0,
    four: 0,
    openThree: 0,
    brokenThree: 0,
    openTwo: 0,
    brokenTwo: 0,
  };
  let total = 0;

  for (const [dx, dy] of DIRECTIONS) {
    const analysis = analyzeRelativeString(buildRelativeLine(board, x, y, dx, dy, player));
    total += analysis.total;
    for (const key of Object.keys(aggregate)) {
      aggregate[key] += analysis.counts[key];
    }
  }

  board[cellIndex] = EMPTY;

  let bonus = 0;
  if (aggregate.five > 0) {
    bonus += SCORE.FIVE;
  }
  if (aggregate.openFour > 0) {
    bonus += SCORE.OPEN_FOUR * 2;
  }
  if (aggregate.four >= 2) {
    bonus += SCORE.OPEN_FOUR * 1.6;
  }
  if (aggregate.four > 0 && aggregate.openThree > 0) {
    bonus += SCORE.OPEN_FOUR * 1.2;
  }
  if (aggregate.openThree >= 2) {
    bonus += SCORE.FOUR * 1.4;
  }
  if (aggregate.openThree > 0) {
    bonus += SCORE.OPEN_THREE * 0.6;
  }
  if (aggregate.openTwo >= 2) {
    bonus += SCORE.OPEN_TWO * 0.8;
  }

  const centerBias = 20 - (Math.abs(CENTER - x) + Math.abs(CENTER - y));
  return {
    score: total + bonus + centerBias * SCORE.SINGLE,
    counts: aggregate,
  };
}

function evaluatePosition(board, player) {
  let total = 0;

  for (const line of SEARCH_LINES) {
    let source = "O";
    for (const cellIndex of line) {
      const value = board[cellIndex];
      if (value === EMPTY) {
        source += "_";
      } else if (value === player) {
        source += "X";
      } else {
        source += "O";
      }
    }
    source += "O";
    total += analyzeRelativeString(source).total;
  }

  return total;
}

function centralityScore(board, player) {
  let total = 0;

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (board[indexAt(x, y)] !== player) {
        continue;
      }
      total += 18 - (Math.abs(CENTER - x) + Math.abs(CENTER - y));
    }
  }

  return total * 12;
}

function staticEvaluate(searchState, aiPlayer) {
  const opponent = otherPlayer(aiPlayer);
  const aiScore = evaluatePosition(searchState.board, aiPlayer) + centralityScore(searchState.board, aiPlayer);
  const opponentScore = evaluatePosition(searchState.board, opponent) + centralityScore(searchState.board, opponent);
  return aiScore - opponentScore * 1.05;
}

function hasNeighbor(board, x, y, radius = 2) {
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      if (!offsetX && !offsetY) {
        continue;
      }
      const nextX = x + offsetX;
      const nextY = y + offsetY;
      if (!insideBoard(nextX, nextY)) {
        continue;
      }
      if (board[indexAt(nextX, nextY)] !== EMPTY) {
        return true;
      }
    }
  }

  return false;
}

function collectCandidates(board, player, limit = 12) {
  const opponent = otherPlayer(player);
  const candidates = [];
  let hasStone = false;

  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (board[index] !== EMPTY) {
      hasStone = true;
      break;
    }
  }

  if (!hasStone) {
    return [{
      x: CENTER,
      y: CENTER,
      attack: SCORE.OPEN_TWO,
      defense: SCORE.OPEN_TWO,
      priority: SCORE.OPEN_TWO,
    }];
  }

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (board[indexAt(x, y)] !== EMPTY || !hasNeighbor(board, x, y, 2)) {
        continue;
      }

      const attack = classifyMove(board, x, y, player).score;
      const defense = classifyMove(board, x, y, opponent).score;
      const centerBias = 28 - (Math.abs(CENTER - x) + Math.abs(CENTER - y));
      candidates.push({
        x,
        y,
        attack,
        defense,
        priority: Math.max(attack, defense * 1.12) + centerBias * 18,
      });
    }
  }

  candidates.sort((left, right) => right.priority - left.priority);
  return candidates.slice(0, limit);
}

function findForcedMove(board, player) {
  const candidates = collectCandidates(board, player, 18);
  const immediateWin = candidates.find((candidate) => candidate.attack >= SCORE.FIVE);
  if (immediateWin) {
    return { ...immediateWin, reason: "win" };
  }

  const forcedBlock = candidates.find((candidate) => candidate.defense >= SCORE.FIVE);
  if (forcedBlock) {
    return { ...forcedBlock, reason: "block-win" };
  }

  const createFour = candidates.find((candidate) => candidate.attack >= SCORE.OPEN_FOUR);
  if (createFour) {
    return { ...createFour, reason: "attack-four" };
  }

  const blockFour = candidates.find((candidate) => candidate.defense >= SCORE.OPEN_FOUR);
  if (blockFour) {
    return { ...blockFour, reason: "block-four" };
  }

  const forkThreat = candidates.find((candidate) => candidate.attack >= SCORE.FOUR && candidate.defense >= SCORE.OPEN_THREE);
  if (forkThreat) {
    return { ...forkThreat, reason: "fork" };
  }

  return null;
}

function checkWin(board, x, y, player) {
  for (const [dx, dy] of DIRECTIONS) {
    const line = [{ x, y }];

    for (let step = 1; step < WIN_LENGTH; step += 1) {
      const nextX = x + dx * step;
      const nextY = y + dy * step;
      if (!insideBoard(nextX, nextY) || board[indexAt(nextX, nextY)] !== player) {
        break;
      }
      line.push({ x: nextX, y: nextY });
    }

    for (let step = 1; step < WIN_LENGTH; step += 1) {
      const nextX = x - dx * step;
      const nextY = y - dy * step;
      if (!insideBoard(nextX, nextY) || board[indexAt(nextX, nextY)] !== player) {
        break;
      }
      line.unshift({ x: nextX, y: nextY });
    }

    if (line.length >= WIN_LENGTH) {
      const centerIndex = line.findIndex((cell) => cell.x === x && cell.y === y);
      const start = Math.max(0, Math.min(centerIndex, line.length - WIN_LENGTH));
      return {
        winner: player,
        line: line.slice(start, start + WIN_LENGTH),
      };
    }
  }

  return null;
}

function minimax(searchState, depth, alpha, beta, playerToMove, aiPlayer, lastMove, context, ply) {
  context.nodes += 1;
  if (performance.now() - context.startedAt > context.timeLimit) {
    context.aborted = true;
    return 0;
  }

  if (lastMove) {
    const win = checkWin(searchState.board, lastMove.x, lastMove.y, lastMove.player);
    if (win) {
      return lastMove.player === aiPlayer
        ? TERMINAL_SCORE - ply * 10_000
        : -TERMINAL_SCORE + ply * 10_000;
    }
  }

  if (searchState.moveCount >= CELL_COUNT) {
    return 0;
  }

  if (depth <= 0) {
    return staticEvaluate(searchState, aiPlayer);
  }

  const cacheKey = `${searchState.hash}:${playerToMove}:${depth}`;
  const cached = context.cache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const maximizing = playerToMove === aiPlayer;
  const candidateLimit = Math.min(
    context.config.candidateLimit + (depth >= 4 ? 2 : 0),
    18,
  );
  const candidates = collectCandidates(searchState.board, playerToMove, candidateLimit);

  if (!candidates.length) {
    return 0;
  }

  let bestScore = maximizing ? -Infinity : Infinity;

  for (const candidate of candidates) {
    applySearchMove(searchState, candidate.x, candidate.y, playerToMove);
    const extension = (
      context.config.threatExtension
      && depth <= 2
      && (candidate.attack >= SCORE.OPEN_FOUR || candidate.defense >= SCORE.OPEN_FOUR)
    ) ? 1 : 0;
    const score = minimax(
      searchState,
      depth - 1 + extension,
      alpha,
      beta,
      otherPlayer(playerToMove),
      aiPlayer,
      { x: candidate.x, y: candidate.y, player: playerToMove },
      context,
      ply + 1,
    );
    undoSearchMove(searchState, candidate.x, candidate.y, playerToMove);

    if (context.aborted) {
      return bestScore;
    }

    if (maximizing) {
      if (score > bestScore) {
        bestScore = score;
      }
      if (score > alpha) {
        alpha = score;
      }
    } else {
      if (score < bestScore) {
        bestScore = score;
      }
      if (score < beta) {
        beta = score;
      }
    }

    if (beta <= alpha) {
      break;
    }
  }

  context.cache.set(cacheKey, bestScore);
  return bestScore;
}

function searchBestMove(searchState, aiPlayer, config) {
  const forcedMove = findForcedMove(searchState.board, aiPlayer);
  if (forcedMove) {
    return {
      x: forcedMove.x,
      y: forcedMove.y,
      depth: 0,
      score: forcedMove.attack >= SCORE.FIVE ? TERMINAL_SCORE : forcedMove.priority,
      nodes: 0,
      time: 0,
    };
  }

  if (config.depth === 1 && config.randomTop) {
    const candidates = collectCandidates(searchState.board, aiPlayer, config.candidateLimit);
    const topMoves = candidates.slice(0, config.randomTop);
    const choice = topMoves[Math.floor(Math.random() * topMoves.length)] ?? candidates[0];
    return {
      x: choice.x,
      y: choice.y,
      depth: 1,
      score: choice.priority,
      nodes: 0,
      time: 0,
    };
  }

  const rootCandidates = collectCandidates(searchState.board, aiPlayer, config.candidateLimit);
  if (!rootCandidates.length) {
    return {
      x: CENTER,
      y: CENTER,
      depth: 0,
      score: 0,
      nodes: 0,
      time: 0,
    };
  }

  const context = {
    startedAt: performance.now(),
    timeLimit: config.timeLimit,
    nodes: 0,
    cache: new Map(),
    config,
    aborted: false,
  };
  let best = {
    ...rootCandidates[0],
    score: rootCandidates[0].priority,
    depth: 0,
  };

  for (let depth = 1; depth <= config.depth; depth += 1) {
    let currentBest = null;
    let alpha = -Infinity;
    let beta = Infinity;
    const ordered = depth > 1
      ? [best, ...rootCandidates.filter((candidate) => candidate.x !== best.x || candidate.y !== best.y)]
      : rootCandidates;

    for (const candidate of ordered) {
      if (performance.now() - context.startedAt > context.timeLimit) {
        context.aborted = true;
        break;
      }

      applySearchMove(searchState, candidate.x, candidate.y, aiPlayer);
      const score = minimax(
        searchState,
        depth - 1,
        alpha,
        beta,
        otherPlayer(aiPlayer),
        aiPlayer,
        { x: candidate.x, y: candidate.y, player: aiPlayer },
        context,
        1,
      );
      undoSearchMove(searchState, candidate.x, candidate.y, aiPlayer);

      if (context.aborted) {
        break;
      }

      if (!currentBest || score > currentBest.score) {
        currentBest = {
          ...candidate,
          score,
          depth,
        };
      }

      if (score > alpha) {
        alpha = score;
      }
    }

    if (context.aborted || !currentBest) {
      break;
    }

    best = currentBest;

    if (Math.abs(best.score) >= TERMINAL_SCORE - 20_000) {
      break;
    }
  }

  return {
    x: best.x,
    y: best.y,
    depth: best.depth,
    score: best.score,
    nodes: context.nodes,
    time: Math.round(performance.now() - context.startedAt),
  };
}

function coordLabel(x, y) {
  const letter = String.fromCharCode(65 + x);
  return `${letter}${BOARD_SIZE - y}`;
}

function isAiTurn() {
  return state.mode === "ai" && state.currentPlayer !== state.humanSide && !state.winner;
}

function canHumanAct() {
  return !state.aiThinking && !state.winner && (!isAiTurn() || state.mode === "pvp");
}

function resetAiReport() {
  state.aiReport = {
    depth: null,
    score: null,
    nodes: 0,
    time: 0,
  };
}

function setStatus(text) {
  elements.statusText.textContent = text;
}

function updateUi() {
  elements.turnLabel.textContent = playerName(state.currentPlayer);
  elements.modeLabel.textContent = modeName(state.mode);
  elements.moveCount.textContent = String(state.moveHistory.length);
  elements.lastMoveLabel.textContent = state.lastMove ? coordLabel(state.lastMove.x, state.lastMove.y) : "-";
  elements.aiLevelPill.textContent = AI_LEVELS[state.difficulty].label;
  elements.aiDepth.textContent = state.aiReport.depth ?? "-";
  elements.aiScore.textContent = state.aiReport.score == null ? "-" : Math.round(state.aiReport.score).toLocaleString("zh-CN");
  elements.aiNodes.textContent = state.aiReport.nodes ? state.aiReport.nodes.toLocaleString("zh-CN") : "-";
  elements.aiTime.textContent = state.aiReport.time ? `${state.aiReport.time} ms` : "-";
  elements.humanSide.disabled = state.mode !== "ai" || state.aiThinking;
  elements.difficulty.disabled = state.mode !== "ai" || state.aiThinking;
  elements.undo.disabled = state.aiThinking || state.moveHistory.length === 0;
  elements.thinkingPill.textContent = state.aiThinking ? "思考中" : "待机";
  elements.thinkingPill.className = state.aiThinking ? "pill" : "pill pill--muted";
  elements.boardTitle.textContent = state.winner
    ? (state.winner === 3 ? "平局" : `${playerName(state.winner)}获胜`)
    : (state.aiThinking ? "AI 思考中" : "对局进行中");
  elements.turnChip.textContent = state.aiThinking
    ? "AI 计算中"
    : `${playerName(state.currentPlayer)}回合`;
  elements.turnChip.className = state.aiThinking
    ? "turn-chip turn-chip--thinking"
    : state.currentPlayer === BLACK
      ? "turn-chip turn-chip--black"
      : "turn-chip";

  for (const button of elements.modeButtons) {
    button.classList.toggle("is-active", button.dataset.mode === state.mode);
    button.disabled = state.aiThinking;
  }
}

function showResult(title, copy) {
  elements.resultTitle.textContent = title;
  elements.resultCopy.textContent = copy;
  elements.result.classList.remove("hidden");
}

function hideResult() {
  elements.result.classList.add("hidden");
}

function finishGame(winner, line = []) {
  state.winner = winner;
  state.winningLine = line;

  if (winner === 3) {
    setStatus("棋盘已满，本局和棋。");
    showResult("和棋", "双方都没有形成连五。");
  } else {
    const victor = playerName(winner);
    const modeCopy = state.mode === "ai"
      ? (winner === state.humanSide ? "你完成了连五。" : "AI 抢先形成了连五。")
      : `${victor}完成了连五。`;
    setStatus(`${victor}连成五子，胜负已定。`);
    showResult(`${victor}获胜`, modeCopy);
  }

  updateUi();
  renderBoard();
}

function restartGame() {
  state.board.fill(EMPTY);
  state.moveHistory = [];
  state.currentPlayer = BLACK;
  state.winner = EMPTY;
  state.winningLine = [];
  state.hoverCell = null;
  state.aiThinking = false;
  state.lastMove = null;
  hideResult();
  resetAiReport();
  setStatus("黑棋先手。点击棋盘交叉点落子。");
  updateUi();
  renderBoard();
  queueAiTurnIfNeeded();
}

function placeStone(x, y, player) {
  const cellIndex = indexAt(x, y);
  if (state.board[cellIndex] !== EMPTY || state.winner) {
    return false;
  }

  state.board[cellIndex] = player;
  const move = { x, y, player };
  state.moveHistory.push(move);
  state.lastMove = move;

  const win = checkWin(state.board, x, y, player);
  if (win) {
    finishGame(player, win.line);
    return true;
  }

  if (state.moveHistory.length >= CELL_COUNT) {
    finishGame(3, []);
    return true;
  }

  state.currentPlayer = otherPlayer(player);
  setStatus(`${playerName(player)}落在 ${coordLabel(x, y)}。轮到${playerName(state.currentPlayer)}。`);
  updateUi();
  renderBoard();
  return true;
}

function undoMove() {
  if (!state.moveHistory.length || state.aiThinking) {
    return;
  }

  const steps = state.mode === "ai" && state.moveHistory.length >= 2 ? 2 : 1;
  for (let count = 0; count < steps; count += 1) {
    const move = state.moveHistory.pop();
    if (!move) {
      break;
    }
    state.board[indexAt(move.x, move.y)] = EMPTY;
  }

  state.winner = EMPTY;
  state.winningLine = [];
  state.lastMove = state.moveHistory.at(-1) ?? null;
  state.currentPlayer = state.lastMove ? otherPlayer(state.lastMove.player) : BLACK;
  hideResult();
  resetAiReport();
  setStatus("已悔棋。");
  updateUi();
  renderBoard();
}

function queueAiTurnIfNeeded() {
  if (!isAiTurn() || state.aiThinking) {
    return;
  }

  state.aiThinking = true;
  setStatus(`AI 正在为${playerName(state.currentPlayer)}计算落点。`);
  updateUi();

  window.setTimeout(() => {
    const config = AI_LEVELS[state.difficulty];
    const searchState = makeSearchState();
    const result = searchBestMove(searchState, state.currentPlayer, config);

    state.aiThinking = false;
    state.aiReport = {
      depth: result.depth,
      score: result.score,
      nodes: result.nodes,
      time: result.time,
    };

    if (state.winner) {
      updateUi();
      return;
    }

    placeStone(result.x, result.y, state.currentPlayer);
    if (!state.winner) {
      setStatus(`AI 落在 ${coordLabel(result.x, result.y)}。轮到${playerName(state.currentPlayer)}。`);
      updateUi();
    }
  }, 40);
}

function getBoardMetrics() {
  const rect = elements.board.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const size = Math.max(1, Math.floor(Math.min(rect.width, rect.height)));
  elements.board.width = Math.round(size * pixelRatio);
  elements.board.height = Math.round(size * pixelRatio);

  const padding = size * 0.08;
  const boardExtent = size - padding * 2;
  const cell = boardExtent / (BOARD_SIZE - 1);
  return {
    size,
    pixelRatio,
    padding,
    cell,
    stoneRadius: cell * 0.42,
  };
}

function boardToCanvas(metrics, x, y) {
  return {
    x: metrics.padding + metrics.cell * x,
    y: metrics.padding + metrics.cell * y,
  };
}

function canvasToBoard(clientX, clientY) {
  const rect = elements.board.getBoundingClientRect();
  const metrics = state.renderMetrics ?? getBoardMetrics();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const x = Math.round((localX - metrics.padding) / metrics.cell);
  const y = Math.round((localY - metrics.padding) / metrics.cell);

  if (!insideBoard(x, y)) {
    return null;
  }

  const snapped = boardToCanvas(metrics, x, y);
  const distance = Math.hypot(snapped.x - localX, snapped.y - localY);
  if (distance > metrics.cell * 0.46) {
    return null;
  }

  return { x, y };
}

function drawWoodBackground(metrics) {
  const gradient = ctx.createLinearGradient(0, 0, metrics.size, metrics.size);
  gradient.addColorStop(0, "#dab17d");
  gradient.addColorStop(0.42, "#c49461");
  gradient.addColorStop(1, "#936238");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, metrics.size, metrics.size);

  ctx.save();
  ctx.globalAlpha = 0.08;
  for (let stripe = -metrics.size; stripe < metrics.size * 2; stripe += metrics.size * 0.12) {
    ctx.fillStyle = stripe % 2 === 0 ? "#fff4d9" : "#6b4425";
    ctx.fillRect(stripe, 0, metrics.size * 0.05, metrics.size);
  }
  ctx.restore();

  ctx.lineWidth = Math.max(1, metrics.size * 0.008);
  ctx.strokeStyle = "rgba(66, 38, 18, 0.55)";
  ctx.strokeRect(metrics.padding * 0.45, metrics.padding * 0.45, metrics.size - metrics.padding * 0.9, metrics.size - metrics.padding * 0.9);
}

function drawGrid(metrics) {
  ctx.strokeStyle = "rgba(56, 33, 17, 0.86)";
  ctx.lineWidth = Math.max(1, metrics.size * 0.0025);

  for (let index = 0; index < BOARD_SIZE; index += 1) {
    const offset = metrics.padding + index * metrics.cell;

    ctx.beginPath();
    ctx.moveTo(metrics.padding, offset);
    ctx.lineTo(metrics.size - metrics.padding, offset);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(offset, metrics.padding);
    ctx.lineTo(offset, metrics.size - metrics.padding);
    ctx.stroke();
  }

  const starPoints = [
    [3, 3], [7, 3], [11, 3],
    [3, 7], [7, 7], [11, 7],
    [3, 11], [7, 11], [11, 11],
  ];
  ctx.fillStyle = "#3a2415";
  for (const [x, y] of starPoints) {
    const point = boardToCanvas(metrics, x, y);
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(2.2, metrics.size * 0.0055), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(57, 32, 13, 0.72)";
  ctx.font = `600 ${Math.round(metrics.size * 0.024)}px "Bahnschrift", "Aptos", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let x = 0; x < BOARD_SIZE; x += 1) {
    const point = boardToCanvas(metrics, x, 0);
    ctx.fillText(String.fromCharCode(65 + x), point.x, metrics.padding * 0.42);
    ctx.fillText(String.fromCharCode(65 + x), point.x, metrics.size - metrics.padding * 0.42);
  }

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    const point = boardToCanvas(metrics, 0, y);
    const label = String(BOARD_SIZE - y);
    ctx.fillText(label, metrics.padding * 0.4, point.y);
    ctx.fillText(label, metrics.size - metrics.padding * 0.4, point.y);
  }
}

function drawWinningLine(metrics) {
  if (!state.winningLine.length) {
    return;
  }

  const first = boardToCanvas(metrics, state.winningLine[0].x, state.winningLine[0].y);
  const last = boardToCanvas(metrics, state.winningLine.at(-1).x, state.winningLine.at(-1).y);

  ctx.save();
  ctx.strokeStyle = "rgba(235, 64, 52, 0.9)";
  ctx.lineWidth = Math.max(4, metrics.cell * 0.16);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

function drawHover(metrics) {
  if (!state.hoverCell || !canHumanAct() || getCell(state.board, state.hoverCell.x, state.hoverCell.y) !== EMPTY) {
    return;
  }

  const point = boardToCanvas(metrics, state.hoverCell.x, state.hoverCell.y);
  ctx.save();
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = state.currentPlayer === BLACK ? "#16181c" : "#eef4fb";
  ctx.beginPath();
  ctx.arc(point.x, point.y, metrics.stoneRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawStone(metrics, x, y, player, isLastMove) {
  const point = boardToCanvas(metrics, x, y);
  const radius = metrics.stoneRadius;
  const gradient = ctx.createRadialGradient(
    point.x - radius * 0.34,
    point.y - radius * 0.44,
    radius * 0.08,
    point.x,
    point.y,
    radius,
  );

  if (player === BLACK) {
    gradient.addColorStop(0, "#59616d");
    gradient.addColorStop(0.3, "#222831");
    gradient.addColorStop(1, "#090b0e");
  } else {
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.45, "#f4f5f8");
    gradient.addColorStop(1, "#bcc8d8");
  }

  ctx.beginPath();
  ctx.arc(point.x + radius * 0.08, point.y + radius * 0.12, radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  if (player === WHITE) {
    ctx.lineWidth = Math.max(1, radius * 0.08);
    ctx.strokeStyle = "rgba(70, 80, 96, 0.2)";
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(point.x - radius * 0.28, point.y - radius * 0.32, radius * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = player === BLACK ? "rgba(255, 255, 255, 0.18)" : "rgba(255, 255, 255, 0.52)";
  ctx.fill();

  if (isLastMove) {
    ctx.beginPath();
    ctx.strokeStyle = player === BLACK ? "#f3d169" : "#d94b39";
    ctx.lineWidth = Math.max(2, radius * 0.12);
    ctx.arc(point.x, point.y, radius * 0.44, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function renderBoard() {
  const metrics = getBoardMetrics();
  state.renderMetrics = metrics;

  ctx.setTransform(metrics.pixelRatio, 0, 0, metrics.pixelRatio, 0, 0);
  ctx.clearRect(0, 0, metrics.size, metrics.size);

  drawWoodBackground(metrics);
  drawGrid(metrics);
  drawWinningLine(metrics);

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const value = state.board[indexAt(x, y)];
      if (value === EMPTY) {
        continue;
      }
      drawStone(metrics, x, y, value, state.lastMove?.x === x && state.lastMove?.y === y);
    }
  }

  drawHover(metrics);
}

function handleBoardTap(x, y) {
  if (!canHumanAct() || getCell(state.board, x, y) !== EMPTY) {
    return;
  }

  placeStone(x, y, state.currentPlayer);
  if (!state.winner) {
    queueAiTurnIfNeeded();
  }
}

function onBoardPointerMove(event) {
  const cell = canvasToBoard(event.clientX, event.clientY);
  state.hoverCell = cell;
  renderBoard();
}

function onBoardPointerLeave() {
  state.hoverCell = null;
  renderBoard();
}

function onBoardPointerDown(event) {
  const cell = canvasToBoard(event.clientX, event.clientY);
  if (!cell) {
    return;
  }

  event.preventDefault();
  handleBoardTap(cell.x, cell.y);
}

elements.modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (state.aiThinking) {
      return;
    }
    state.mode = button.dataset.mode;
    resetAiReport();
    restartGame();
  });
});

elements.difficulty.addEventListener("change", () => {
  state.difficulty = elements.difficulty.value;
  resetAiReport();
  updateUi();
});

elements.humanSide.addEventListener("change", () => {
  state.humanSide = Number(elements.humanSide.value);
  restartGame();
});

elements.newGame.addEventListener("click", restartGame);
elements.resultRestart.addEventListener("click", restartGame);
elements.undo.addEventListener("click", undoMove);
elements.board.addEventListener("pointermove", onBoardPointerMove);
elements.board.addEventListener("pointerleave", onBoardPointerLeave);
elements.board.addEventListener("pointerdown", onBoardPointerDown);
window.addEventListener("resize", renderBoard);

elements.difficulty.value = state.difficulty;
elements.humanSide.value = String(state.humanSide);
updateUi();
restartGame();
