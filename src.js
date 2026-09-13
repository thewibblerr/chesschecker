import { createRecognizer, resolveOrientation, placementToFen } from 'https://esm.sh/@scoriiu/fenshot@0.1.4?deps=onnxruntime-web@1.26.0';
import { Chess } from 'https://esm.sh/chess.js@1.4.0';

const $ = (s) => document.querySelector(s);

const recognizer = createRecognizer({
  modelUrl: 'https://cdn.jsdelivr.net/npm/@scoriiu/fenshot@0.1.4/model/chess-tiles-v2.onnx',
  wasmPaths: {
    mjs: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort-wasm-simd-threaded.mjs',
    wasm: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort-wasm-simd-threaded.wasm'
  }
});

const pieceGlyph = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟'
};

let placement = '';
let boardFlipped = false;
let coachessUrl = '';
let board = Array(64).fill(null);
let selectedSquare = null;
let bestMoveUci = '';
let engineWorker = null;
let engineLoading = null;
let engineLines = new Map();
let engineBusy = false;

function ensureEnhancements() {
  const result = $('#result');
  if (!result || $('#board-editor')) return;
  const actions = result.querySelector('.buttons');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div id="board-editor" class="enhancement-block">
      <div class="enhancement-heading">
        <div><span class="eyebrow">Board check</span><h3>Tap any square to correct it</h3></div>
        <span id="position-validity" class="mini-pill">Ready</span>
      </div>
      <div id="detected-board" class="detected-board" aria-label="Detected chess position"></div>
      <p class="enhancement-note">Chess Checker has reconstructed the board. Correct any misread piece before analysing.</p>
    </div>
    <div id="engine-panel" class="enhancement-block engine-panel">
      <div class="enhancement-heading">
        <div><span class="eyebrow">On-device analysis</span><h3>Best moves</h3></div>
        <span id="engine-badge" class="mini-pill">Stockfish</span>
      </div>
      <button id="find-best" class="primary engine-button" type="button">Find best move</button>
      <div id="engine-status" class="engine-status">Analyse the recognised position directly on this device.</div>
      <div id="engine-results" class="engine-results"></div>
      <p class="enhancement-note">For post-game analysis, puzzles and study positions.</p>
    </div>
    <div id="piece-picker" class="piece-picker" hidden>
      <div class="piece-picker-card" role="dialog" aria-modal="true" aria-label="Choose a piece">
        <div class="piece-picker-head"><strong>Set square</strong><button id="piece-picker-close" class="picker-close" type="button">×</button></div>
        <div id="piece-options" class="piece-options"></div>
      </div>
    </div>`;
  while (wrapper.firstChild) result.insertBefore(wrapper.firstChild, actions);

  const options = $('#piece-options');
  const choices = [null, 'K','Q','R','B','N','P','k','q','r','b','n','p'];
  choices.forEach(piece => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'piece-option';
    b.dataset.piece = piece || '';
    b.textContent = piece ? pieceGlyph[piece] : 'Empty';
    b.onclick = () => setSelectedSquare(piece);
    options.appendChild(b);
  });
  $('#piece-picker-close').onclick = closePiecePicker;
  $('#piece-picker').addEventListener('click', e => { if (e.target.id === 'piece-picker') closePiecePicker(); });
  $('#find-best').onclick = analyseWithStockfish;
}

function parsePlacement(value) {
  const out = [];
  const rows = value.split('/');
  for (const row of rows) {
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) out.push(null);
      } else out.push(ch);
    }
  }
  return out.length === 64 ? out : Array(64).fill(null);
}

function boardToPlacement(items) {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let row = '';
    let empties = 0;
    for (let f = 0; f < 8; f++) {
      const piece = items[r * 8 + f];
      if (!piece) empties++;
      else {
        if (empties) row += empties;
        empties = 0;
        row += piece;
      }
    }
    if (empties) row += empties;
    rows.push(row || '8');
  }
  return rows.join('/');
}

function squareName(index) {
  const rank = 8 - Math.floor(index / 8);
  const file = 'abcdefgh'[index % 8];
  return file + rank;
}

function squareIndex(name) {
  if (!/^[a-h][1-8]$/.test(name)) return -1;
  return (8 - Number(name[1])) * 8 + 'abcdefgh'.indexOf(name[0]);
}

function renderBoard() {
  const el = $('#detected-board');
  if (!el) return;
  el.innerHTML = '';
  const from = bestMoveUci ? squareIndex(bestMoveUci.slice(0, 2)) : -1;
  const to = bestMoveUci ? squareIndex(bestMoveUci.slice(2, 4)) : -1;
  for (let display = 0; display < 64; display++) {
    const index = boardFlipped ? 63 - display : display;
    const row = Math.floor(display / 8);
    const col = display % 8;
    const sq = document.createElement('button');
    sq.type = 'button';
    sq.className = 'board-square ' + ((row + col) % 2 ? 'dark' : 'light');
    if (index === from) sq.classList.add('best-from');
    if (index === to) sq.classList.add('best-to');
    sq.dataset.index = String(index);
    sq.setAttribute('aria-label', squareName(index) + (board[index] ? ' ' + board[index] : ' empty'));
    sq.textContent = board[index] ? pieceGlyph[board[index]] : '';
    sq.onclick = () => openPiecePicker(index);
    el.appendChild(sq);
  }
  updateValidity();
}

function updateValidity() {
  const pill = $('#position-validity');
  if (!pill) return;
  const whiteKings = board.filter(x => x === 'K').length;
  const blackKings = board.filter(x => x === 'k').length;
  if (whiteKings !== 1 || blackKings !== 1) {
    pill.textContent = 'Check kings';
    pill.classList.add('warning');
  } else {
    pill.textContent = 'Looks valid';
    pill.classList.remove('warning');
  }
}

function openPiecePicker(index) {
  selectedSquare = index;
  const picker = $('#piece-picker');
  if (picker) picker.hidden = false;
}

function closePiecePicker() {
  const picker = $('#piece-picker');
  if (picker) picker.hidden = true;
  selectedSquare = null;
}

function setSelectedSquare(piece) {
  if (selectedSquare == null) return;
  board[selectedSquare] = piece || null;
  placement = boardToPlacement(board);
  bestMoveUci = '';
  updateFen();
  renderBoard();
  clearEngineResults('Position corrected. Ready to analyse.');
  closePiecePicker();
}

function updateFen() {
  if (!placement) return '';
  const fen = placementToFen(placement, $('#turn').value);
  $('#fen').textContent = fen;
  $('#analyse').href = 'https://lichess.org/analysis/standard/' + fen.replaceAll(' ', '_');
  coachessUrl = 'https://coachess.app/coach/position?fen=' + encodeURIComponent(fen)
    + (boardFlipped ? '&pov=black' : '')
    + '&ref=chesschecker';
  return fen;
}

function regionMetrics(ctx, x0, y0, x1, y1) {
  const w = Math.max(1, Math.floor(x1 - x0));
  const h = Math.max(1, Math.floor(y1 - y0));
  if (w < 4 || h < 4) return null;
  const data = ctx.getImageData(Math.floor(x0), Math.floor(y0), w, h).data;
  let total = 0;
  let bright = 0;
  let count = 0;
  const step = 16;
  for (let i = 0; i < data.length; i += step) {
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    total += lum;
    if (lum > 165) bright++;
    count++;
  }
  return { mean: total / count, bright: bright / count };
}

async function inferTurnFromScreenshot(file, corners, bottomSide) {
  const fallback = { side: bottomSide, source: 'orientation' };
  if (!corners || !('createImageBitmap' in window)) return fallback;
  try {
    const image = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    image.close?.();

    const bw = corners.x1 - corners.x0;
    const bh = corners.y1 - corners.y0;
    const x0 = Math.max(0, corners.x0 + bw * 0.55);
    const x1 = Math.min(canvas.width, corners.x1);
    const top0 = Math.max(0, corners.y0 - bh * 0.20);
    const top1 = Math.max(0, corners.y0 - bh * 0.015);
    const bottom0 = Math.min(canvas.height, corners.y1 + bh * 0.015);
    const bottom1 = Math.min(canvas.height, corners.y1 + bh * 0.20);
    const top = regionMetrics(ctx, x0, top0, x1, top1);
    const bottom = regionMetrics(ctx, x0, bottom0, x1, bottom1);
    if (!top || !bottom) return fallback;

    const topSignal = top.mean + top.bright * 90;
    const bottomSignal = bottom.mean + bottom.bright * 90;
    const difference = topSignal - bottomSignal;
    if (Math.abs(difference) < 18) return fallback;

    const topSide = bottomSide === 'w' ? 'b' : 'w';
    return {
      side: difference > 0 ? topSide : bottomSide,
      source: 'active-clock'
    };
  } catch (e) {
    console.debug('Turn detection fallback', e);
    return fallback;
  }
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.top = '0';
  ta.style.fontSize = '16px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) {}
  ta.remove();
  return ok;
}

async function tryAutomaticCopy(fen) {
  if (!fen || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(fen);
    return true;
  } catch (_) {
    return false;
  }
}

async function scan(file) {
  ensureEnhancements();
  $('#status').textContent = 'Reading chessboard…';
  $('#result').hidden = true;
  $('#preview').src = URL.createObjectURL(file);
  $('#preview').hidden = false;
  try {
    const result = await recognizer.recognize(file);
    if (!result) {
      $('#status').textContent = 'No chessboard detected.';
      return;
    }

    const oriented = resolveOrientation(result.placement);
    placement = oriented.placement;
    boardFlipped = oriented.orientation === 'black';
    board = parsePlacement(placement);
    bestMoveUci = '';

    const bottomSide = boardFlipped ? 'b' : 'w';
    const turn = await inferTurnFromScreenshot(file, result.corners, bottomSide);
    $('#turn').value = turn.side;
    const hint = $('#result .hint');
    if (hint) hint.textContent = turn.source === 'active-clock'
      ? 'Side to move detected from the active player clock. Change it if needed.'
      : 'Side to move estimated from board orientation. Change it if needed.';

    $('#confidence').textContent = Math.round(result.meanConfidence * 100) + '%';
    const fen = updateFen();
    renderBoard();
    clearEngineResults('Analyse the recognised position directly on this device.');
    $('#result').hidden = false;
    const copied = await tryAutomaticCopy(fen);
    const recognised = result.reliable
      ? 'Board recognised.'
      : 'Board recognised with low confidence. Check the board and correct any piece if needed.';
    $('#status').textContent = copied
      ? recognised + ' FEN copied automatically.'
      : recognised + ' Tap Copy FEN to copy it.';
  } catch (e) {
    console.error(e);
    $('#status').textContent = 'Recognition failed. Reload and try again.';
  }
}

async function scanClipboardImage() {
  $('#status').textContent = 'Reading clipboard screenshot…';
  try {
    if (!navigator.clipboard?.read) throw new Error('Clipboard image access is unavailable');
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      const file = new File([blob], 'clipboard-screenshot', { type });
      await scan(file);
      return;
    }
    $('#status').textContent = 'No image found on the clipboard. Copy or share the screenshot and try again.';
  } catch (e) {
    console.error(e);
    $('#status').textContent = 'Clipboard access was blocked. Tap Upload screenshot instead.';
  }
}

function clearEngineResults(message) {
  const results = $('#engine-results');
  const status = $('#engine-status');
  if (results) results.innerHTML = '';
  if (status && message) status.textContent = message;
  engineLines.clear();
  bestMoveUci = '';
  renderBoard();
}

function waitForEngine(worker, command, expected, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.removeEventListener('message', handler);
      reject(new Error('Stockfish timed out'));
    }, timeout);
    const handler = (e) => {
      const line = String(e.data || '');
      if (line.includes(expected)) {
        clearTimeout(timer);
        worker.removeEventListener('message', handler);
        resolve();
      }
    };
    worker.addEventListener('message', handler);
    worker.postMessage(command);
  });
}

async function getEngine() {
  if (engineWorker) return engineWorker;
  if (engineLoading) return engineLoading;
  engineLoading = (async () => {
    $('#engine-status').textContent = 'Loading Stockfish on this device…';
    const url = 'https://cdn.jsdelivr.net/npm/stockfish@18.0.8/bin/stockfish-18-asm.js';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not load Stockfish');
    const code = await response.text();
    const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const worker = new Worker(blobUrl);
    worker.addEventListener('message', handleEngineMessage);
    await waitForEngine(worker, 'uci', 'uciok');
    worker.postMessage('setoption name MultiPV value 3');
    await waitForEngine(worker, 'isready', 'readyok');
    engineWorker = worker;
    return worker;
  })().finally(() => { engineLoading = null; });
  return engineLoading;
}

function parseEngineInfo(line) {
  const multipv = Number(line.match(/\bmultipv\s+(\d+)/)?.[1] || 1);
  const depth = Number(line.match(/\bdepth\s+(\d+)/)?.[1] || 0);
  const score = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
  const pv = line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
  if (!score || !pv) return null;
  return { multipv, depth, type: score[1], value: Number(score[2]), move: pv[1] };
}

function normalisedEvaluation(info) {
  let value = info.value;
  if ($('#turn').value === 'b') value = -value;
  if (info.type === 'mate') return value > 0 ? `Mate +${value}` : `Mate ${value}`;
  const pawns = value / 100;
  return (pawns > 0 ? '+' : '') + pawns.toFixed(2);
}

function moveToSan(uci) {
  try {
    const chess = new Chess($('#fen').textContent);
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] || 'q'
    });
    return move?.san || uci;
  } catch (_) {
    return uci;
  }
}

function renderEngineResults() {
  const results = $('#engine-results');
  if (!results) return;
  const rows = [...engineLines.values()].sort((a, b) => a.multipv - b.multipv).slice(0, 3);
  results.innerHTML = '';
  rows.forEach((info, i) => {
    const row = document.createElement('div');
    row.className = 'engine-result-row';
    row.innerHTML = `<span class="engine-rank">${i + 1}</span><strong>${moveToSan(info.move)}</strong><span class="engine-uci">${info.move}</span><span class="engine-eval">${normalisedEvaluation(info)}</span>`;
    results.appendChild(row);
  });
  if (rows[0]) {
    bestMoveUci = rows[0].move;
    renderBoard();
  }
}

function handleEngineMessage(e) {
  const line = String(e.data || '');
  if (line.startsWith('info ')) {
    const info = parseEngineInfo(line);
    if (info) {
      const previous = engineLines.get(info.multipv);
      if (!previous || info.depth >= previous.depth) engineLines.set(info.multipv, info);
      renderEngineResults();
      $('#engine-status').textContent = `Analysing… depth ${info.depth}`;
    }
  }
  if (line.startsWith('bestmove')) {
    engineBusy = false;
    const best = line.match(/^bestmove\s+([^\s]+)/)?.[1];
    if (best && best !== '(none)') bestMoveUci = best;
    renderEngineResults();
    $('#engine-status').textContent = engineLines.size
      ? 'Best move highlighted on the board. Evaluation is from White’s point of view.'
      : 'Analysis finished.';
    const btn = $('#find-best');
    if (btn) btn.textContent = 'Analyse again';
  }
}

async function analyseWithStockfish() {
  const fen = $('#fen').textContent;
  if (!fen || engineBusy) return;
  try {
    new Chess(fen);
  } catch (_) {
    $('#engine-status').textContent = 'Correct the position before analysing. It is not a valid chess position.';
    return;
  }
  const btn = $('#find-best');
  btn.textContent = 'Analysing…';
  engineLines.clear();
  bestMoveUci = '';
  renderBoard();
  $('#engine-results').innerHTML = '';
  try {
    const worker = await getEngine();
    engineBusy = true;
    worker.postMessage('stop');
    worker.postMessage('ucinewgame');
    worker.postMessage(`position fen ${fen}`);
    worker.postMessage('go depth 14');
  } catch (e) {
    console.error(e);
    engineBusy = false;
    btn.textContent = 'Find best move';
    $('#engine-status').textContent = 'Stockfish could not load. You can still analyse on Lichess or Coachess.';
  }
}

ensureEnhancements();

$('#clipboard').onclick = scanClipboardImage;
$('#choose').onclick = () => $('#file').click();
$('#file').onchange = () => {
  const f = $('#file').files?.[0];
  if (f) scan(f);
};
$('#turn').onchange = async () => {
  const fen = updateFen();
  clearEngineResults('Side to move updated. Ready to analyse.');
  const copied = await tryAutomaticCopy(fen);
  $('#status').textContent = copied
    ? 'Side to move updated. FEN copied automatically.'
    : 'Side to move updated. Tap Copy FEN to copy it.';
};

$('#copy').onclick = async () => {
  const fen = $('#fen').textContent;
  if (!fen) return;
  let copied = legacyCopy(fen);
  if (!copied && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(fen);
      copied = true;
    } catch (_) {}
  }
  if (copied) {
    $('#copy').textContent = 'Copied ✓';
    $('#status').textContent = 'FEN copied.';
    setTimeout(() => $('#copy').textContent = 'Copy FEN', 1200);
  } else {
    $('#status').textContent = 'Safari blocked clipboard access. Press and hold the FEN, then choose Copy.';
  }
};

$('#coachess').onclick = () => {
  if (!coachessUrl) {
    $('#status').textContent = 'Recognise a board first.';
    return;
  }
  window.location.assign(coachessUrl);
};

window.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  const f = item?.getAsFile();
  if (f) scan(f);
});

recognizer.warmUp().catch(() => {});