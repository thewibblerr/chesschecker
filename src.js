import { createRecognizer, resolveOrientation, placementToFen } from 'https://esm.sh/@scoriiu/fenshot@0.1.4?deps=onnxruntime-web@1.26.0';

const $ = (s) => document.querySelector(s);

const recognizer = createRecognizer({
  modelUrl: 'https://cdn.jsdelivr.net/npm/@scoriiu/fenshot@0.1.4/model/chess-tiles-v2.onnx',
  wasmPaths: {
    mjs: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort-wasm-simd-threaded.mjs',
    wasm: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort-wasm-simd-threaded.wasm'
  }
});

let placement = '';
let boardFlipped = false;
let coachessUrl = '';

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
    boardFlipped = Boolean(oriented.flipped);
    $('#turn').value = boardFlipped ? 'b' : 'w';
    $('#confidence').textContent = Math.round(result.meanConfidence * 100) + '%';
    const fen = updateFen();
    $('#result').hidden = false;
    const copied = await tryAutomaticCopy(fen);
    const recognised = result.reliable
      ? 'Board recognised.'
      : 'Board recognised with low confidence. Check the pieces carefully.';
    $('#status').textContent = copied
      ? recognised + ' FEN copied automatically.'
      : recognised + ' Tap Copy FEN to copy it.';
  } catch (e) {
    console.error(e);
    $('#status').textContent = 'Recognition failed. Reload and try again.';
  }
}

async function scanClipboardImage() {
  $('#status').textContent = 'Reading shared screenshot…';
  try {
    if (!navigator.clipboard?.read) throw new Error('Clipboard image access is unavailable');
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      const file = new File([blob], 'shared-screenshot', { type });
      await scan(file);
      return;
    }
    $('#status').textContent = 'No image found on the clipboard. Share the screenshot to Chess Checker again.';
  } catch (e) {
    console.error(e);
    $('#status').textContent = 'Clipboard access was blocked. Tap Choose screenshot instead.';
  }
}

$('#clipboard').onclick = scanClipboardImage;
$('#choose').onclick = () => $('#file').click();
$('#file').onchange = () => {
  const f = $('#file').files?.[0];
  if (f) scan(f);
};
$('#turn').onchange = async () => {
  const fen = updateFen();
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