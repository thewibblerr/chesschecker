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

function updateFen() {
  if (!placement) return;
  const fen = placementToFen(placement, $('#turn').value);
  $('#fen').textContent = fen;
  $('#analyse').href = 'https://lichess.org/analysis/standard/' + fen.replaceAll(' ', '_');
  $('#coachess').href = 'https://coachess.app/coach/position?fen=' + encodeURIComponent(fen) + '&ref=chesschecker';
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
    $('#confidence').textContent = Math.round(result.meanConfidence * 100) + '%';
    $('#status').textContent = result.reliable
      ? 'Board recognised.'
      : 'Board recognised with low confidence. Check the pieces carefully.';
    updateFen();
    $('#result').hidden = false;
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
$('#turn').onchange = updateFen;
$('#copy').onclick = async () => {
  await navigator.clipboard.writeText($('#fen').textContent);
  $('#copy').textContent = 'Copied';
  setTimeout(() => $('#copy').textContent = 'Copy FEN', 1200);
};

window.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  const f = item?.getAsFile();
  if (f) scan(f);
});

recognizer.warmUp().catch(() => {});