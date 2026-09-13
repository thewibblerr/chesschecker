import { createRecognizer, resolveOrientation, placementToFen } from 'https://esm.sh/@scoriiu/fenshot@0.1.4?deps=onnxruntime-web@1.26.0';
import { Chess } from 'https://esm.sh/chess.js@1.4.0';

const $ = s => document.querySelector(s);
const HISTORY_KEY = 'chesschecker-history-v1';
const THEME_KEY = 'chesschecker-theme';
const MAX_HISTORY = 15;

const recognizer = createRecognizer({
  modelUrl: 'https://cdn.jsdelivr.net/npm/@scoriiu/fenshot@0.1.4/model/chess-tiles-v2.onnx',
  wasmPaths: {
    mjs: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort-wasm-simd-threaded.mjs',
    wasm: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort-wasm-simd-threaded.wasm'
  }
});

const pieceGlyph = {
  K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙',
  k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'
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
let currentThumb = '';

const OPENING_LINES = [
  ['King’s Pawn Game',['e2e4']],['Queen’s Pawn Game',['d2d4']],['English Opening',['c2c4']],['Réti Opening',['g1f3']],
  ['Sicilian Defence',['e2e4','c7c5']],['French Defence',['e2e4','e7e6']],['Caro-Kann Defence',['e2e4','c7c6']],
  ['Scandinavian Defence',['e2e4','d7d5']],['Pirc Defence',['e2e4','d7d6']],['Alekhine Defence',['e2e4','g8f6']],
  ['Open Game',['e2e4','e7e5']],['Italian Game',['e2e4','e7e5','g1f3','b8c6','f1c4']],
  ['Ruy Lopez',['e2e4','e7e5','g1f3','b8c6','f1b5']],['Scotch Game',['e2e4','e7e5','g1f3','b8c6','d2d4']],
  ['Four Knights Game',['e2e4','e7e5','g1f3','b8c6','b1c3','g8f6']],
  ['Sicilian Defence: Open',['e2e4','c7c5','g1f3','d7d6','d2d4','c5d4','f3d4']],
  ['Sicilian Defence: Najdorf',['e2e4','c7c5','g1f3','d7d6','d2d4','c5d4','f3d4','g8f6','b1c3','a7a6']],
  ['Queen’s Gambit',['d2d4','d7d5','c2c4']],['Queen’s Gambit Declined',['d2d4','d7d5','c2c4','e7e6']],
  ['Queen’s Gambit Accepted',['d2d4','d7d5','c2c4','d5c4']],['Slav Defence',['d2d4','d7d5','c2c4','c7c6']],
  ['King’s Indian Defence',['d2d4','g8f6','c2c4','g7g6','b1c3','f8g7']],
  ['Nimzo-Indian Defence',['d2d4','g8f6','c2c4','e7e6','b1c3','f8b4']],
  ['London System',['d2d4','d7d5','g1f3','g8f6','c1f4']],['English Opening: Symmetrical',['c2c4','c7c5']]
];

const OPENINGS = (() => {
  const map = new Map();
  for (const [name,moves] of OPENING_LINES) {
    try {
      const chess = new Chess();
      for (const uci of moves) chess.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]||'q'});
      const [p,t] = chess.fen().split(' ');
      map.set(`${p} ${t}`, name);
    } catch (_) {}
  }
  return map;
})();

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  const b = $('#theme-toggle');
  if (b) b.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  const editorLink = $('#board-correct-toggle');
  if (editorLink) editorLink.style.color = theme === 'dark' ? '#93c5fd' : '#2563eb';
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  setTheme(saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
}

function resetBoardEditor() {
  const editor = $('#board-editor');
  const toggle = $('#board-correct-toggle');
  if (editor) editor.hidden = true;
  if (toggle) {
    toggle.textContent = 'Open editor';
    toggle.setAttribute('aria-expanded','false');
  }
}

function toggleBoardEditor() {
  const editor = $('#board-editor');
  const toggle = $('#board-correct-toggle');
  if (!editor || !toggle) return;
  editor.hidden = !editor.hidden;
  toggle.textContent = editor.hidden ? 'Open editor' : 'Close editor';
  toggle.setAttribute('aria-expanded', String(!editor.hidden));
}

function ensureEnhancements() {
  const result = $('#result');
  if (!result || $('#board-editor')) return;

  const hero = document.querySelector('.hero');
  if (hero && !$('#theme-toggle')) {
    const toggle = document.createElement('button');
    toggle.id='theme-toggle'; toggle.className='theme-toggle'; toggle.type='button';
    toggle.onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
    hero.appendChild(toggle);
  }

  const topLine = result.querySelector('.result-topline');
  const confidence = result.querySelector('.confidence-pill');
  if (confidence && !$('#board-correct-toggle')) {
    const tools = document.createElement('div');
    tools.className = 'confidence-tools';
    tools.style.display='grid';
    tools.style.justifyItems='end';
    tools.style.gap='4px';
    confidence.parentNode.insertBefore(tools,confidence);
    tools.appendChild(confidence);

    const link = document.createElement('button');
    link.id='board-correct-toggle'; link.type='button'; link.textContent='Open editor';
    link.setAttribute('aria-expanded','false');
    Object.assign(link.style,{
      minHeight:'0',padding:'2px 1px',borderRadius:'0',background:'transparent',boxShadow:'none',
      fontSize:'11px',fontWeight:'650',textDecoration:'underline',textUnderlineOffset:'2px'
    });
    link.onclick=toggleBoardEditor;
    tools.appendChild(link);
  }

  const boardEditor = document.createElement('div');
  boardEditor.id='board-editor'; boardEditor.className='enhancement-block'; boardEditor.hidden=true;
  boardEditor.innerHTML=`
    <div class="enhancement-heading"><div><span class="eyebrow">Board check</span><h3>Tap any square to correct it</h3></div><span id="position-validity" class="mini-pill">Ready</span></div>
    <div id="detected-board" class="detected-board" aria-label="Detected chess position"></div>
    <p class="enhancement-note">Chess Checker has reconstructed the board. Correct any misread piece before analysing.</p>`;
  topLine.insertAdjacentElement('afterend',boardEditor);

  const actions = result.querySelector('.buttons');
  const wrapper = document.createElement('div');
  wrapper.innerHTML=`
    <div id="opening-panel" class="enhancement-block compact-block" hidden><span class="eyebrow">Opening</span><div id="opening-name" class="opening-name"></div></div>
    <div id="engine-panel" class="enhancement-block engine-panel">
      <div class="enhancement-heading"><div><span class="eyebrow">Stockfish analysis</span><h3>Best moves</h3></div><span id="engine-badge" class="mini-pill">Stockfish</span></div>
      <button id="find-best" class="primary engine-button" type="button">Find best move</button>
      <div id="engine-status" class="engine-status">Analyse the recognised position.</div>
      <div id="engine-results" class="engine-results"></div>
      <p class="enhancement-note">For post-game analysis, puzzles and study positions.</p>
    </div>
    <div id="share-panel" class="enhancement-block compact-block">
      <div class="enhancement-heading"><div><span class="eyebrow">Share</span><h3>Share this position</h3></div></div>
      <div class="share-actions"><button id="share-position" class="secondary" type="button">Share position</button><button id="copy-link" class="secondary" type="button">Copy link</button></div>
    </div>
    <div id="piece-picker" class="piece-picker" hidden><div class="piece-picker-card" role="dialog" aria-modal="true" aria-label="Choose a piece"><div class="piece-picker-head"><strong>Set square</strong><button id="piece-picker-close" class="picker-close" type="button">×</button></div><div id="piece-options" class="piece-options"></div></div></div>`;
  while(wrapper.firstChild) result.insertBefore(wrapper.firstChild,actions);

  const history=document.createElement('section');
  history.id='history-panel'; history.className='card history-card';
  history.innerHTML='<div class="history-head"><div><span class="eyebrow">On this device</span><h2>Recent positions</h2></div><button id="clear-history" class="text-button" type="button">Clear</button></div><div id="history-list" class="history-list"></div>';
  result.insertAdjacentElement('afterend',history);

  for(const piece of [null,'K','Q','R','B','N','P','k','q','r','b','n','p']){
    const b=document.createElement('button'); b.type='button'; b.className='piece-option';
    b.textContent=piece?pieceGlyph[piece]:'Empty'; b.onclick=()=>setSelectedSquare(piece); $('#piece-options').appendChild(b);
  }

  $('#piece-picker-close').onclick=closePiecePicker;
  $('#piece-picker').addEventListener('click',e=>{if(e.target.id==='piece-picker')closePiecePicker();});
  $('#find-best').onclick=analyseWithStockfish;
  $('#copy-link').onclick=copyShareLink;
  $('#share-position').onclick=sharePosition;
  $('#clear-history').onclick=()=>{localStorage.removeItem(HISTORY_KEY);renderHistory();};
  renderHistory();
  resetBoardEditor();
  setTheme(document.documentElement.dataset.theme || 'light');
}

function parsePlacement(value){
  const out=[];
  for(const row of value.split('/')) for(const ch of row){
    if(/\d/.test(ch)) for(let i=0;i<Number(ch);i++) out.push(null); else out.push(ch);
  }
  return out.length===64?out:Array(64).fill(null);
}

function boardToPlacement(items){
  const rows=[];
  for(let r=0;r<8;r++){
    let row='',empties=0;
    for(let f=0;f<8;f++){
      const p=items[r*8+f];
      if(!p) empties++; else {if(empties)row+=empties;empties=0;row+=p;}
    }
    if(empties)row+=empties; rows.push(row||'8');
  }
  return rows.join('/');
}

function squareName(index){return 'abcdefgh'[index%8]+(8-Math.floor(index/8));}
function squareIndex(name){return /^[a-h][1-8]$/.test(name)?(8-Number(name[1]))*8+'abcdefgh'.indexOf(name[0]):-1;}

function renderBoard(){
  const el=$('#detected-board'); if(!el)return; el.innerHTML='';
  const from=bestMoveUci?squareIndex(bestMoveUci.slice(0,2)):-1,to=bestMoveUci?squareIndex(bestMoveUci.slice(2,4)):-1;
  for(let display=0;display<64;display++){
    const index=boardFlipped?63-display:display,row=Math.floor(display/8),col=display%8;
    const sq=document.createElement('button'); sq.type='button'; sq.className='board-square '+((row+col)%2?'dark':'light');
    if(index===from)sq.classList.add('best-from'); if(index===to)sq.classList.add('best-to');
    sq.textContent=board[index]?pieceGlyph[board[index]]:''; sq.onclick=()=>openPiecePicker(index); el.appendChild(sq);
  }
  updateValidity();
}

function updateValidity(){
  const pill=$('#position-validity'); if(!pill)return;
  const ok=board.filter(x=>x==='K').length===1&&board.filter(x=>x==='k').length===1;
  pill.textContent=ok?'Looks valid':'Check kings'; pill.classList.toggle('warning',!ok);
}
function openPiecePicker(index){selectedSquare=index;$('#piece-picker').hidden=false;}
function closePiecePicker(){if($('#piece-picker'))$('#piece-picker').hidden=true;selectedSquare=null;}
function setSelectedSquare(piece){
  if(selectedSquare==null)return;
  board[selectedSquare]=piece||null; placement=boardToPlacement(board); bestMoveUci='';
  updateFen(); renderBoard(); clearEngineResults('Position corrected. Ready to analyse.'); saveCurrentToHistory(); closePiecePicker();
}

function openingForFen(fen){const [p,t]=fen.split(' ');return OPENINGS.get(`${p} ${t}`)||'';}
function updateOpening(){
  const fen=$('#fen')?.textContent||'',name=openingForFen(fen),panel=$('#opening-panel');
  if(!panel)return; panel.hidden=!name; if(name)$('#opening-name').textContent=name;
}
function updateFen(){
  if(!placement)return'';
  const fen=placementToFen(placement,$('#turn').value); $('#fen').textContent=fen;
  $('#analyse').href='https://lichess.org/analysis/standard/'+fen.replaceAll(' ','_');
  coachessUrl='https://coachess.app/coach/position?fen='+encodeURIComponent(fen)+(boardFlipped?'&pov=black':'')+'&ref=chesschecker';
  updateOpening(); return fen;
}

function shareUrl(){
  const fen=$('#fen')?.textContent;if(!fen)return'';
  const u=new URL(location.origin+location.pathname);u.searchParams.set('fen',fen);if(boardFlipped)u.searchParams.set('pov','black');return u.toString();
}
function legacyCopy(text){
  const ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.left='-9999px';ta.style.fontSize='16px';document.body.appendChild(ta);ta.focus();ta.select();ta.setSelectionRange(0,ta.value.length);
  let ok=false;try{ok=document.execCommand('copy');}catch(_){}ta.remove();return ok;
}
async function copyText(text){try{await navigator.clipboard.writeText(text);return true;}catch(_){return legacyCopy(text);}}
async function tryAutomaticCopy(fen){if(!fen||!navigator.clipboard?.writeText)return false;try{await navigator.clipboard.writeText(fen);return true;}catch(_){return false;}}
async function copyShareLink(){const url=shareUrl();if(!url)return;const ok=await copyText(url);$('#copy-link').textContent=ok?'Copied ✓':'Copy failed';setTimeout(()=>$('#copy-link').textContent='Copy link',1200);}
async function sharePosition(){
  const url=shareUrl();if(!url)return;
  if(navigator.share){try{await navigator.share({title:'Chess Checker position',text:'Analyse this chess position',url});return;}catch(_){}}
  await copyShareLink();
}

function getHistory(){try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');}catch(_){return[];}}
function putHistory(items){localStorage.setItem(HISTORY_KEY,JSON.stringify(items.slice(0,MAX_HISTORY)));}
function saveCurrentToHistory(extra={}){
  const fen=$('#fen')?.textContent;if(!fen)return;
  const items=getHistory().filter(x=>x.fen!==fen);items.unshift({fen,ts:Date.now(),opening:openingForFen(fen),thumb:currentThumb||'',best:bestMoveUci||'',...extra});putHistory(items);renderHistory();
}
function updateHistoryAnalysis(){
  const fen=$('#fen')?.textContent;if(!fen)return;const rows=[...engineLines.values()].sort((a,b)=>a.multipv-b.multipv);
  const items=getHistory(),hit=items.find(x=>x.fen===fen);if(hit&&rows[0]){hit.best=rows[0].move;hit.eval=normalisedEvaluation(rows[0]);hit.ts=Date.now();putHistory(items);renderHistory();}
}
function renderHistory(){
  const list=$('#history-list');if(!list)return;const items=getHistory();list.innerHTML='';$('#history-panel').hidden=items.length===0;
  for(const item of items){
    const row=document.createElement('button');row.type='button';row.className='history-item';
    const when=new Date(item.ts).toLocaleString([],{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
    row.innerHTML=`${item.thumb?`<img src="${item.thumb}" alt="">`:'<div class="history-thumb-placeholder">♞</div>'}<div class="history-copy"><strong>${item.opening||'Chess position'}</strong><span>${when}${item.best?` · ${item.best}${item.eval?` (${item.eval})`:''}`:''}</span></div><span class="history-open">Open</span>`;
    row.onclick=()=>loadFen(item.fen,false,item.thumb||'');list.appendChild(row);
  }
}
async function makeThumbnail(file){
  try{
    const img=await createImageBitmap(file),canvas=document.createElement('canvas'),size=128;canvas.width=size;canvas.height=size;
    const ctx=canvas.getContext('2d'),scale=Math.max(size/img.width,size/img.height),w=img.width*scale,h=img.height*scale;
    ctx.drawImage(img,(size-w)/2,(size-h)/2,w,h);img.close?.();return canvas.toDataURL('image/jpeg',0.55);
  }catch(_){return'';}
}

function loadFen(fen,fromUrl=false,thumb=''){
  ensureEnhancements();
  try{
    const chess=new Chess(fen),parts=chess.fen().split(' ');placement=parts[0];board=parsePlacement(placement);$('#turn').value=parts[1];
    boardFlipped=new URLSearchParams(location.search).get('pov')==='black';currentThumb=thumb;bestMoveUci='';
    updateFen();renderBoard();resetBoardEditor();clearEngineResults('Analyse this position.');$('#confidence').textContent=fromUrl?'Shared':'Saved';$('#result').hidden=false;$('#preview').hidden=true;
    $('#status').textContent=fromUrl?'Shared position loaded.':'Saved position loaded.';saveCurrentToHistory();
  }catch(e){if(fromUrl)$('#status').textContent='That shared position is not valid.';}
}

function regionMetrics(ctx,x0,y0,x1,y1){
  const w=Math.max(1,Math.floor(x1-x0)),h=Math.max(1,Math.floor(y1-y0));if(w<4||h<4)return null;
  const data=ctx.getImageData(Math.floor(x0),Math.floor(y0),w,h).data;let total=0,bright=0,count=0;
  for(let i=0;i<data.length;i+=16){const lum=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];total+=lum;if(lum>165)bright++;count++;}
  return{mean:total/count,bright:bright/count};
}
async function inferTurnFromScreenshot(file,corners,bottomSide){
  const fallback={side:bottomSide,source:'orientation'};if(!corners||!('createImageBitmap'in window))return fallback;
  try{
    const image=await createImageBitmap(file),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);image.close?.();
    const bw=corners.x1-corners.x0,bh=corners.y1-corners.y0,x0=Math.max(0,corners.x0+bw*.55),x1=Math.min(canvas.width,corners.x1);
    const top=regionMetrics(ctx,x0,Math.max(0,corners.y0-bh*.20),x1,Math.max(0,corners.y0-bh*.015));
    const bottom=regionMetrics(ctx,x0,Math.min(canvas.height,corners.y1+bh*.015),x1,Math.min(canvas.height,corners.y1+bh*.20));
    if(!top||!bottom)return fallback;const difference=(top.mean+top.bright*90)-(bottom.mean+bottom.bright*90);if(Math.abs(difference)<18)return fallback;
    const topSide=bottomSide==='w'?'b':'w';return{side:difference>0?topSide:bottomSide,source:'active-clock'};
  }catch(_){return fallback;}
}

async function scan(file){
  ensureEnhancements();resetBoardEditor();$('#status').textContent='Reading chessboard…';$('#result').hidden=true;$('#preview').src=URL.createObjectURL(file);$('#preview').hidden=false;currentThumb=await makeThumbnail(file);
  try{
    const result=await recognizer.recognize(file);if(!result){$('#status').textContent='No chessboard detected.';return;}
    const oriented=resolveOrientation(result.placement);placement=oriented.placement;boardFlipped=oriented.orientation==='black';board=parsePlacement(placement);bestMoveUci='';
    const bottomSide=boardFlipped?'b':'w',turn=await inferTurnFromScreenshot(file,result.corners,bottomSide);$('#turn').value=turn.side;
    const hint=$('#result .hint');if(hint)hint.textContent=turn.source==='active-clock'?'Side to move detected from the active player clock. Change it if needed.':'Side to move estimated from board orientation. Change it if needed.';
    $('#confidence').textContent=Math.round(result.meanConfidence*100)+'%';const fen=updateFen();renderBoard();clearEngineResults('Analyse the recognised position.');$('#result').hidden=false;saveCurrentToHistory();
    const copied=await tryAutomaticCopy(fen),recognised=result.reliable?'Board recognised.':'Board recognised with low confidence. Open the editor to check the board.';
    $('#status').textContent=copied?recognised+' FEN copied automatically.':recognised+' Tap Copy FEN to copy it.';
  }catch(e){console.error(e);$('#status').textContent='Recognition failed. Reload and try again.';}
}
async function scanClipboardImage(){
  $('#status').textContent='Reading clipboard screenshot…';
  try{
    if(!navigator.clipboard?.read)throw new Error('Clipboard unavailable');const items=await navigator.clipboard.read();
    for(const item of items){const type=item.types.find(t=>t.startsWith('image/'));if(!type)continue;const blob=await item.getType(type);await scan(new File([blob],'clipboard-screenshot',{type}));return;}
    $('#status').textContent='No image found on the clipboard. Copy or share the screenshot and try again.';
  }catch(e){console.error(e);$('#status').textContent='Clipboard access was blocked. Tap Upload screenshot instead.';}
}

function clearEngineResults(message){if($('#engine-results'))$('#engine-results').innerHTML='';if($('#engine-status')&&message)$('#engine-status').textContent=message;engineLines.clear();bestMoveUci='';renderBoard();}
function waitForEngine(worker,command,expected,timeout=30000){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{worker.removeEventListener('message',handler);reject(new Error('Stockfish timed out'));},timeout);
    const handler=e=>{if(String(e.data||'').includes(expected)){clearTimeout(timer);worker.removeEventListener('message',handler);resolve();}};
    worker.addEventListener('message',handler);worker.postMessage(command);
  });
}
async function createStockfishWorker(){
  const base='https://cdn.jsdelivr.net/npm/stockfish@18.0.8/bin/';
  const js=base+'stockfish-18-lite-single.js';
  const wasm=base+'stockfish-18-lite-single.wasm';
  const bootstrap=`importScripts(${JSON.stringify(js+'#'+wasm)});`;
  const blobUrl=URL.createObjectURL(new Blob([bootstrap],{type:'text/javascript'}));
  const worker=new Worker(blobUrl);worker.__blobUrl=blobUrl;return worker;
}
async function initialiseWorker(worker){
  worker.addEventListener('message',handleEngineMessage);await waitForEngine(worker,'uci','uciok',30000);worker.postMessage('setoption name MultiPV value 3');await waitForEngine(worker,'isready','readyok',20000);return worker;
}
async function getEngine(){
  if(engineWorker)return engineWorker;if(engineLoading)return engineLoading;
  engineLoading=(async()=>{
    $('#engine-status').textContent='Loading Stockfish…';
    engineWorker=await initialiseWorker(await createStockfishWorker());$('#engine-badge').textContent='Stockfish 18';return engineWorker;
  })().finally(()=>engineLoading=null);
  return engineLoading;
}
function parseEngineInfo(line){
  const multipv=Number(line.match(/\bmultipv\s+(\d+)/)?.[1]||1),depth=Number(line.match(/\bdepth\s+(\d+)/)?.[1]||0),score=line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/),pv=line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
  return score&&pv?{multipv,depth,type:score[1],value:Number(score[2]),move:pv[1]}:null;
}
function normalisedEvaluation(info){
  let value=info.value;if($('#turn').value==='b')value=-value;if(info.type==='mate')return value>0?`Mate +${value}`:`Mate ${value}`;const pawns=value/100;return(pawns>0?'+':'')+pawns.toFixed(2);
}
function moveToSan(uci){
  try{const chess=new Chess($('#fen').textContent),move=chess.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]||'q'});return move?.san||uci;}catch(_){return uci;}
}
function renderEngineResults(){
  const results=$('#engine-results');if(!results)return;const rows=[...engineLines.values()].sort((a,b)=>a.multipv-b.multipv).slice(0,3);results.innerHTML='';
  rows.forEach((info,i)=>{const row=document.createElement('div');row.className='engine-result-row';row.innerHTML=`<span class="engine-rank">${i+1}</span><strong>${moveToSan(info.move)}</strong><span class="engine-uci">${info.move}</span><span class="engine-eval">${normalisedEvaluation(info)}</span>`;results.appendChild(row);});
  if(rows[0]){bestMoveUci=rows[0].move;renderBoard();}
}
function handleEngineMessage(e){
  const line=String(e.data||'');
  if(line.startsWith('info ')){const info=parseEngineInfo(line);if(info){const previous=engineLines.get(info.multipv);if(!previous||info.depth>=previous.depth)engineLines.set(info.multipv,info);renderEngineResults();$('#engine-status').textContent=`Analysing… depth ${info.depth}`;}}
  if(line.startsWith('bestmove')){engineBusy=false;const best=line.match(/^bestmove\s+([^\s]+)/)?.[1];if(best&&best!=='(none)')bestMoveUci=best;renderEngineResults();updateHistoryAnalysis();$('#engine-status').textContent=engineLines.size?'Best move highlighted on the board. Evaluation is from White’s point of view.':'Analysis finished.';$('#find-best').textContent='Analyse again';}
}
async function analyseWithCloud(fen){
  $('#engine-status').textContent='Using Stockfish cloud analysis…';
  const url='https://lichess.org/api/cloud-eval?fen='+encodeURIComponent(fen)+'&multiPv=3&variant=standard';
  const response=await fetch(url,{headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error('Cloud analysis unavailable');
  const data=await response.json();
  if(!Array.isArray(data.pvs)||!data.pvs.length)throw new Error('No cloud analysis');
  engineLines.clear();
  data.pvs.slice(0,3).forEach((pv,i)=>{
    const move=String(pv.moves||'').split(' ')[0];
    if(!move)return;
    const info={multipv:i+1,depth:Number(data.depth||0),type:pv.mate!=null?'mate':'cp',value:Number(pv.mate!=null?pv.mate:pv.cp||0),move};
    engineLines.set(i+1,info);
  });
  renderEngineResults();updateHistoryAnalysis();
  $('#engine-badge').textContent='Stockfish cloud';
  $('#engine-status').textContent='Best move highlighted on the board. Cloud evaluation from Lichess.';
  $('#find-best').textContent='Analyse again';
}
async function analyseWithStockfish(){
  const fen=$('#fen').textContent;if(!fen||engineBusy)return;
  try{new Chess(fen);}catch(_){$('#engine-status').textContent='Correct the position before analysing. It is not a valid chess position.';return;}
  const btn=$('#find-best');btn.textContent='Loading…';engineLines.clear();bestMoveUci='';renderBoard();$('#engine-results').innerHTML='';
  try{
    const worker=await getEngine();engineBusy=true;btn.textContent='Analysing…';worker.postMessage('stop');worker.postMessage('ucinewgame');worker.postMessage(`position fen ${fen}`);worker.postMessage('go depth 14');
  }catch(localError){
    console.warn('Local Stockfish unavailable, using cloud analysis',localError);engineWorker=null;engineBusy=false;
    try{await analyseWithCloud(fen);}catch(cloudError){console.error(cloudError);btn.textContent='Find best move';$('#engine-status').textContent='Analysis could not load. Use Analyse on Lichess below.';}
  }
}

initTheme();ensureEnhancements();
$('#clipboard').onclick=scanClipboardImage;
$('#choose').onclick=()=>$('#file').click();
$('#file').onchange=()=>{const f=$('#file').files?.[0];if(f)scan(f);};
$('#turn').onchange=async()=>{const fen=updateFen();clearEngineResults('Side to move updated. Ready to analyse.');saveCurrentToHistory();const copied=await tryAutomaticCopy(fen);$('#status').textContent=copied?'Side to move updated. FEN copied automatically.':'Side to move updated. Tap Copy FEN to copy it.';};
$('#copy').onclick=async()=>{const fen=$('#fen').textContent;if(!fen)return;const copied=await copyText(fen);if(copied){$('#copy').textContent='Copied ✓';$('#status').textContent='FEN copied.';setTimeout(()=>$('#copy').textContent='Copy FEN',1200);}else $('#status').textContent='Safari blocked clipboard access. Press and hold the FEN, then choose Copy.';};
$('#coachess').onclick=()=>{if(!coachessUrl){$('#status').textContent='Recognise a board first.';return;}window.location.assign(coachessUrl);};
window.addEventListener('paste',e=>{const item=[...(e.clipboardData?.items||[])].find(i=>i.type.startsWith('image/')),f=item?.getAsFile();if(f)scan(f);});
const params=new URLSearchParams(location.search);if(params.get('fen'))loadFen(params.get('fen'),true);
recognizer.warmUp().catch(()=>{});