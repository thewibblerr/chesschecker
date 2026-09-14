import { createRecognizer, resolveOrientation } from 'https://esm.sh/@scoriiu/fenshot@0.1.4?deps=onnxruntime-web@1.26.0';
import { Chess } from 'https://esm.sh/chess.js@1.4.0';

const $=s=>document.querySelector(s);
const LAST_MOVE_THRESHOLD=36;
const recognizer=createRecognizer({modelUrl:'https://cdn.jsdelivr.net/npm/@scoriiu/fenshot@0.1.4/model/chess-tiles-v2.onnx',wasmPaths:{mjs:'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort-wasm-simd-threaded.mjs',wasm:'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort-wasm-simd-threaded.wasm'}});
let lastProcessedFile=null,lastMoveText='';

function waitForFen(timeout=12000){return new Promise(resolve=>{const started=Date.now();const tick=()=>{const fen=$('#fen')?.textContent?.trim();if(fen&&$('#result')&&!$('#result').hidden)return resolve(fen);if(Date.now()-started>timeout)return resolve('');setTimeout(tick,120);};tick();});}
function parsePlacement(placement){const out=[];for(const row of placement.split('/'))for(const ch of row){if(/\d/.test(ch))for(let i=0;i<+ch;i++)out.push(null);else out.push(ch);}return out;}
function squareName(i){return'abcdefgh'[i%8]+(8-Math.floor(i/8));}
function pieceColour(p){return !p?null:(p===p.toUpperCase()?'w':'b');}
function rgbDistance(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);}
function median(values){const x=[...values].sort((a,b)=>a-b),m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2;}
function medianRgb(samples){return[median(samples.map(x=>x[0])),median(samples.map(x=>x[1])),median(samples.map(x=>x[2]))];}
function sampleRgb(ctx,x,y){const d=ctx.getImageData(Math.max(0,Math.round(x)),Math.max(0,Math.round(y)),1,1).data;return[d[0],d[1],d[2]];}
function scaledCorners(c,w,h){const s=Math.min(1,1600/Math.max(w,h)),k=1/s;return{x0:c.x0*k,y0:c.y0*k,x1:c.x1*k,y1:c.y1*k};}

async function detectLastMove(file){try{const result=await recognizer.recognize(file);if(!result?.corners)return'';const oriented=resolveOrientation(result.placement),orientation=oriented.orientation;const img=await createImageBitmap(file),cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);const c=scaledCorners(result.corners,img.width,img.height),sw=(c.x1-c.x0)/8,sh=(c.y1-c.y0)/8,samples=[];
for(let r=0;r<8;r++)for(let f=0;f<8;f++){const pts=[[.13,.13],[.87,.13],[.13,.87],[.87,.87]],cols=pts.map(([px,py])=>sampleRgb(ctx,c.x0+(f+px)*sw,c.y0+(r+py)*sh));samples.push({r,f,rgb:medianRgb(cols),parity:(r+f)%2});}img.close?.();
const bases=[0,1].map(p=>medianRgb(samples.filter(s=>s.parity===p).map(s=>s.rgb)));for(const s of samples)s.score=rgbDistance(s.rgb,bases[s.parity]);const ranked=[...samples].sort((a,b)=>b.score-a.score);if(ranked[1].score<LAST_MOVE_THRESHOLD||ranked[1].score<ranked[2].score*1.18)return'';const idx=s=>{if(orientation==='black')return (7-s.r)*8+(7-s.f);return s.r*8+s.f;};const a=idx(ranked[0]),b=idx(ranked[1]),fen=$('#fen')?.textContent?.trim();if(!fen)return`${squareName(a)} ↔ ${squareName(b)}`;const board=parsePlacement(fen.split(' ')[0]),turn=fen.split(' ')[1],mover=turn==='w'?'b':'w',pa=board[a],pb=board[b];let from=a,to=b;if(pieceColour(pa)===mover&&pieceColour(pb)!==mover){from=b;to=a;}else if(pieceColour(pb)===mover&&pieceColour(pa)!==mover){from=a;to=b;}else if(!pa&&pb){from=a;to=b;}else if(!pb&&pa){from=b;to=a;}return`${squareName(from)} → ${squareName(to)}`;}catch(e){console.debug('Last-move detection skipped',e);return'';}}

function validationIssues(fen){const issues=[];let c;try{c=new Chess(fen);}catch(_){issues.push('The FEN is not a legal chess position.');return issues;}const placement=fen.split(' ')[0],b=parsePlacement(placement),count=x=>b.filter(p=>p===x).length,wPieces=b.filter(p=>p&&p===p.toUpperCase()).length,bPieces=b.filter(p=>p&&p===p.toLowerCase()).length;if(count('K')!==1)issues.push(`White should have exactly one king. Found ${count('K')}.`);if(count('k')!==1)issues.push(`Black should have exactly one king. Found ${count('k')}.`);if(count('P')>8)issues.push(`White has ${count('P')} pawns. Maximum is 8.`);if(count('p')>8)issues.push(`Black has ${count('p')} pawns. Maximum is 8.`);if(wPieces>16)issues.push(`White has ${wPieces} pieces. Maximum is 16.`);if(bPieces>16)issues.push(`Black has ${bPieces} pieces. Maximum is 16.`);for(let i=0;i<8;i++){if(b[i]==='P'||b[i]==='p'||b[56+i]==='P'||b[56+i]==='p'){issues.push('A pawn is on the first or eighth rank.');break;}}
const wk=b.indexOf('K'),bk=b.indexOf('k');if(wk>=0&&bk>=0){const wr=Math.floor(wk/8),wf=wk%8,br=Math.floor(bk/8),bf=bk%8;if(Math.max(Math.abs(wr-br),Math.abs(wf-bf))<=1)issues.push('The two kings are adjacent.');}
return issues;}

function pgnForFen(fen){const date=new Date().toISOString().slice(0,10).replaceAll('-','.');return`[Event "Chess Checker position"]\n[Site "https://chesschecker.com"]\n[Date "${date}"]\n[Round "-"]\n[White "?"]\n[Black "?"]\n[Result "*"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n*\n`;}
function downloadText(name,text,type='text/plain'){const blob=new Blob([text],{type}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
async function copyText(text){try{await navigator.clipboard.writeText(text);return true;}catch(_){const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();return ok;}}

function ensureFeatureUi(){if($('#cc-extra-tools'))return;const style=document.createElement('style');style.textContent=`.cc-import{margin:14px 0 0;display:grid;grid-template-columns:1fr auto;gap:8px}.cc-import input{min-width:0;padding:12px 13px;border:1px solid #d9e0ea;border-radius:12px;background:#fff;color:#172033;font:inherit}.cc-extra{margin-top:14px}.cc-validation{padding:11px 12px;border-radius:12px;background:#ecfdf3;color:#166534;font-size:12px;font-weight:650}.cc-validation.warning{background:#fff7ed;color:#9a3412}.cc-last{margin-top:8px;font-size:12px;color:#475467}.cc-export{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:10px}:root[data-theme="dark"] .cc-import input{background:#172033;border-color:#2b374b;color:#eef2f7}:root[data-theme="dark"] .cc-validation{background:#123322;color:#86efac}:root[data-theme="dark"] .cc-validation.warning{background:#3a2512;color:#fdba74}:root[data-theme="dark"] .cc-last{color:#b2bdd0}@media(max-width:520px){.cc-import{grid-template-columns:1fr}.cc-export{grid-template-columns:1fr}}`;document.head.appendChild(style);
const upload=$('.upload-card');if(upload){const block=document.createElement('div');block.className='cc-extra';block.innerHTML=`<div class="cc-import"><input id="cc-fen-input" type="text" spellcheck="false" autocomplete="off" placeholder="Or paste a FEN position"><button id="cc-load-fen" class="secondary" type="button">Load FEN</button></div>`;upload.appendChild(block);}
const result=$('#result');if(result){const panel=document.createElement('div');panel.id='cc-extra-tools';panel.className='enhancement-block compact-block cc-extra';panel.innerHTML=`<div class="enhancement-heading"><div><span class="eyebrow">Position check</span><h3>Validation & export</h3></div></div><div id="cc-validation" class="cc-validation">Checking position…</div><div id="cc-last-move" class="cc-last" hidden></div><div class="cc-export"><button id="cc-copy-pgn" class="secondary" type="button">Copy PGN</button><button id="cc-download-pgn" class="secondary" type="button">Download PGN</button></div>`;const share=$('#share-panel');if(share)share.insertAdjacentElement('beforebegin',panel);else result.appendChild(panel);}
$('#cc-load-fen')?.addEventListener('click',loadImportedFen);$('#cc-fen-input')?.addEventListener('keydown',e=>{if(e.key==='Enter')loadImportedFen();});$('#cc-copy-pgn')?.addEventListener('click',async()=>{const fen=$('#fen')?.textContent?.trim();if(!fen)return;const btn=$('#cc-copy-pgn'),ok=await copyText(pgnForFen(fen));btn.textContent=ok?'Copied ✓':'Copy failed';setTimeout(()=>btn.textContent='Copy PGN',1200);});$('#cc-download-pgn')?.addEventListener('click',()=>{const fen=$('#fen')?.textContent?.trim();if(fen)downloadText('chess-checker-position.pgn',pgnForFen(fen),'application/x-chess-pgn');});
const obs=new MutationObserver(updateValidationUi),fen=$('#fen');if(fen)obs.observe(fen,{childList:true,characterData:true,subtree:true});$('#turn')?.addEventListener('change',()=>setTimeout(updateValidationUi,0));updateValidationUi();}

function loadImportedFen(){const input=$('#cc-fen-input'),status=$('#status');let raw=input?.value.trim();if(!raw)return;try{const c=new Chess(raw),fen=c.fen(),u=new URL(location.href);u.searchParams.set('fen',fen);u.searchParams.delete('pov');history.pushState({},'',u);location.reload();}catch(_){if(status)status.textContent='That FEN is not valid. Check the position and try again.';input?.focus();}}
function updateValidationUi(){const fen=$('#fen')?.textContent?.trim(),box=$('#cc-validation');if(!fen||!box)return;const issues=validationIssues(fen);box.classList.toggle('warning',issues.length>0);box.textContent=issues.length?`Check position: ${issues.join(' ')}`:'✓ Position passes basic legality checks.';const last=$('#cc-last-move');if(last){last.hidden=!lastMoveText;last.textContent=lastMoveText?`Last move detected: ${lastMoveText}`:'';}}

async function processLastMove(file){if(!file||file===lastProcessedFile)return;lastProcessedFile=file;await waitForFen();lastMoveText=await detectLastMove(file);updateValidationUi();}

document.addEventListener('change',event=>{if(event.target?.id==='file'){const f=event.target.files?.[0];if(f)setTimeout(()=>processLastMove(f),0);}},false);

document.addEventListener('click',async event=>{
  const button=event.target.closest?.('#clipboard');
  if(!button)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const status=$('#status'),input=$('#file');
  if(status)status.textContent='Reading clipboard screenshot…';
  button.disabled=true;
  let timer;
  try{
    if(!navigator.clipboard?.read)throw new Error('unsupported');
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),5000);});
    const items=await Promise.race([navigator.clipboard.read(),timeout]);
    clearTimeout(timer);
    let image=null;
    for(const item of items){const type=item.types.find(t=>t.startsWith('image/'));if(type){image=await item.getType(type);break;}}
    if(!image){if(status)status.textContent='No image found on the clipboard. Copy or share the screenshot and try again.';return;}
    if(!input)throw new Error('input');
    const file=new File([image],'clipboard-screenshot',{type:image.type||'image/png'}),transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  }catch(error){clearTimeout(timer);if(status)status.textContent=error?.message==='timeout'?'Clipboard access timed out. Tap again or use Upload screenshot.':'Clipboard access was blocked. Tap Upload screenshot instead.';}
  finally{button.disabled=false;}
},true);

ensureFeatureUi();
