import { createRecognizer, resolveOrientation, placementToFen } from '@scoriiu/fenshot';
import ortMjsUrl from './generated/ort-wasm-simd-threaded.mjs?url';
import ortWasmUrl from './generated/ort-wasm-simd-threaded.wasm?url';
import modelUrl from './generated/chess-tiles-v2.onnx?url';
import './style.css';

const $ = (s) => document.querySelector(s);
const recognizer = createRecognizer({ modelUrl, wasmPaths: { mjs: ortMjsUrl, wasm: ortWasmUrl } });
let placement = '';

function updateFen() {
  if (!placement) return;
  const fen = placementToFen(placement, $('#turn').value);
  $('#fen').textContent = fen;
  $('#analyse').href = 'https://lichess.org/analysis/standard/' + fen.replaceAll(' ', '_');
}

async function scan(file) {
  $('#status').textContent = 'Reading chessboard…';
  $('#result').hidden = true;
  $('#preview').src = URL.createObjectURL(file);
  $('#preview').hidden = false;
  try {
    const result = await recognizer.recognize(file);
    if (!result) { $('#status').textContent = 'No chessboard detected.'; return; }
    const oriented = resolveOrientation(result.placement);
    placement = oriented.placement;
    $('#confidence').textContent = Math.round(result.meanConfidence * 100) + '%';
    $('#status').textContent = result.reliable ? 'Board recognised.' : 'Board recognised with low confidence. Check the pieces carefully.';
    updateFen();
    $('#result').hidden = false;
  } catch (e) {
    console.error(e);
    $('#status').textContent = 'Recognition failed. Reload and try again.';
  }
}

$('#choose').onclick = () => $('#file').click();
$('#file').onchange = () => { const f = $('#file').files?.[0]; if (f) scan(f); };
$('#turn').onchange = updateFen;
$('#copy').onclick = async () => { await navigator.clipboard.writeText($('#fen').textContent); $('#copy').textContent='Copied'; setTimeout(()=>$('#copy').textContent='Copy FEN',1200); };

// Supports image paste on desktop and future Shortcut/browser hand-off work.
window.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  const f = item?.getAsFile();
  if (f) scan(f);
});

recognizer.warmUp();