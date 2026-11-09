#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

echo "=== EVEN HUD 555 v1.1.2 ==="

# 備份
BACKUP="../even_hud_project_backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP"
for f in app.json package.json tsconfig.json index.html src; do
  [ ! -e "$f" ] || cp -r "$f" "$BACKUP/"
done
echo "[1/6] Backup: $BACKUP"

mkdir -p src

cat > package.json <<'EOF'
{
  "name": "even-hud-555",
  "private": true,
  "version": "1.1.2",
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "tsc --noEmit && vite build",
    "pack": "npm run build && npx evenhub pack app.json dist -o even-hud-555-v1.1.2.ehpk"
  },
  "dependencies": {
    "@evenrealities/even_hub_sdk": "latest"
  },
  "devDependencies": {
    "@evenrealities/evenhub-cli": "latest",
    "typescript": "latest",
    "vite": "^6.0.0"
  }
}
EOF

cat > app.json <<'EOF'
{
  "package_id": "com.nickwu.hud555",
  "edition": "202601",
  "name": "Even HUD for 555",
  "version": "1.1.2",
  "min_app_version": "2.0.0",
  "min_sdk_version": "0.0.12",
  "entrypoint": "index.html",
  "permissions": [],
  "supported_languages": ["en", "zh-TW"]
}
EOF

cat > index.html <<'EOF'
<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Even HUD 555</title>
</head>
<body>
<div id="app"></div>
<script type="module" src="/src/main.ts"></script>
</body>
</html>
EOF

cat > tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "noEmit": true
  },
  "include": ["src"]
}
EOF

cat > src/style.css <<'EOF'
:root{font-family:system-ui,sans-serif;color:#e8f5ee;background:#07110e}
*{box-sizing:border-box}
body{margin:0;min-width:320px;background:radial-gradient(circle at 20% 0%,#17382b,transparent 40%),#07110e}
button,textarea{font:inherit}
.app{width:min(720px,100%);margin:auto;padding:22px 16px 48px}
.header{display:flex;justify-content:space-between;margin-bottom:20px}
.logo{font-size:19px;font-weight:800;letter-spacing:1px}
.version,.hint,.status{color:#8eb6a0;font-size:12px}
.card{border:1px solid #244638;border-radius:18px;padding:18px;margin-bottom:14px;background:#0f231b}
.card-title{color:#8db9a0;font-size:12px;letter-spacing:1.5px;margin-bottom:14px;font-weight:700}
.word{font-size:34px;font-weight:800;margin-bottom:8px;overflow-wrap:anywhere}
.meaning{font-size:18px}
.example{margin-top:12px;color:#8eaa9a;line-height:1.6;font-size:14px}
.quote-row{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid #244638}
.quote-price{text-align:right;font-size:20px;font-weight:800}
.quote-change{text-align:right;font-size:12px;margin-top:4px}
.up{color:#ff8c8c}.down{color:#77d8a1}.neutral{color:#a6b8ad}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
button{border:1px solid #37664e;border-radius:12px;padding:11px 15px;background:#173c2b;color:#e8f5ee}
button.primary{background:#b8f3c9;color:#082013;font-weight:800}
textarea{width:100%;min-height:110px;padding:12px;border:1px solid #37664e;border-radius:12px;background:#081710;color:#e8f5ee}
.footer{text-align:center;color:#658574;font-size:11px;padding-top:8px}
EOF

cat > src/main.ts <<'EOF'
import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList
} from '@evenrealities/even_hub_sdk';
import './style.css';

type Word={word:string;meaning:string;example?:string};
type Quote={symbol:string;name:string;price:number|null;previousClose:number|null;time:string};

const STORAGE_KEY='nickwu_even_hud_words_v1';
const DEFAULT_WORDS:Word[]=[
 {word:'validate',meaning:'驗證、確認有效性',example:'We need to validate the test result.'},
 {word:'integrity',meaning:'完整性',example:'Signal integrity is important.'},
 {word:'margin',meaning:'裕量、餘裕',example:'We still have enough timing margin.'},
 {word:'transient',meaning:'暫態、瞬態',example:'Check the transient response.'},
 {word:'intermittent',meaning:'間歇性的',example:'The issue is intermittent.'}
];
const SYMBOLS=[
 {symbol:'tse_0050.tw',name:'元大 0050'},
 {symbol:'tse_00631L.tw',name:'元大 00631L'}
];

let words:Word[]=[...DEFAULT_WORDS];
let currentWord=0;
let quotes:Quote[]=[];
let quoteStatus='尚未更新行情';
let quoteUpdatedAt='';
let bridge:Awaited<ReturnType<typeof waitForEvenAppBridge>>|null=null;
let appStarted=false;
let ioQueue:Promise<unknown>=Promise.resolve();

const $=(s:string):HTMLElement=>{
 const e=document.querySelector<HTMLElement>(s);
 if(!e)throw new Error('Missing element '+s);
 return e;
};
function serialize<T>(task:()=>Promise<T>):Promise<T>{
 const next=ioQueue.then(task,task);
 ioQueue=next.then(()=>undefined,()=>undefined);
 return next;
}
function escapeHtml(s:string):string{
 return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]??c));
}
function mountPhoneUI(){
 $('#app').innerHTML=`
 <main class="app">
 <header class="header"><div class="logo">EVEN HUD 555</div><div class="version">v1.1.2</div></header>
 <p class="status" id="connection-status">正在連接 Even Hub SDK…</p>
 <section class="card">
 <div class="card-title">ENGLISH VOCABULARY</div>
 <div class="word" id="word">準備中</div><div class="meaning" id="meaning"></div><div class="example" id="example"></div>
 <div class="actions"><button id="prev-word">上一個</button><button class="primary" id="next-word">下一個單字</button></div>
 <div class="hint" id="word-index"></div></section>
 <section class="card"><div class="card-title">TAIWAN ETF MARKET</div><div id="quotes"></div>
 <div class="hint" id="quote-status">${escapeHtml(quoteStatus)}</div>
 <div class="actions"><button class="primary" id="refresh-quotes">更新行情</button></div></section>
 <section class="card"><div class="card-title">MY VOCABULARY</div>
 <textarea id="word-input" placeholder='貼上 JSON 或 CSV 單字資料'></textarea>
 <div class="actions"><button class="primary" id="import-words">匯入單字</button><button id="restore-words">還原預設</button></div>
 <div class="hint">JSON：[{ "word":"debug", "meaning":"除錯", "example":"Debug the issue." }]<br>CSV：word,meaning,example</div></section>
 <div class="footer">G2 原生文字顯示｜手機 UI 僅供管理</div></main>`;
 $('#prev-word').addEventListener('click',()=>changeWord(-1));
 $('#next-word').addEventListener('click',()=>changeWord(1));
 $('#refresh-quotes').addEventListener('click',()=>void refreshQuotes());
 $('#import-words').addEventListener('click',()=>void importWords());
 $('#restore-words').addEventListener('click',()=>void restoreWords());
 renderPhoneWord();
 renderPhoneQuotes();
}
function renderPhoneWord(){
 if(!words.length)return;
 const w=words[currentWord];
 $('#word').textContent=w.word;
 $('#meaning').textContent=w.meaning;
 $('#example').textContent=w.example??'';
 $('#word-index').textContent=`${currentWord+1} / ${words.length}`;
}
function changeWord(d:number){
 if(!words.length)return;
 currentWord=(currentWord+d+words.length)%words.length;
 renderPhoneWord();
 void renderGlasses();
}
function parseCsvLine(line:string):string[]{
 const out:string[]=[];let value='';let quoted=false;
 for(let i=0;i<line.length;i++){
  const c=line[i];
  if(c==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
  else if(c===','&&!quoted){out.push(value.trim());value='';}
  else value+=c;
 }
 out.push(value.trim());return out;
}
function parseWords(raw:string):Word[]{
 const input=raw.trim();if(!input)throw new Error('請先貼上單字資料');
 if(input.startsWith('[')){
  const parsed:unknown=JSON.parse(input);
  if(!Array.isArray(parsed))throw new Error('JSON 必須是陣列');
  const result=parsed.map((x:any)=>({word:String(x.word??'').trim(),meaning:String(x.meaning??'').trim(),example:String(x.example??'').trim()})).filter(x=>x.word&&x.meaning);
  if(!result.length)throw new Error('沒有有效的 word / meaning 欄位');
  return result;
 }
 const rows=input.split(/\r?\n/).filter(Boolean).map(parseCsvLine);
 const start=rows[0]?.[0]?.toLowerCase()==='word'?1:0;
 const result=rows.slice(start).map(r=>({word:r[0]??'',meaning:r[1]??'',example:r[2]??''})).filter(x=>x.word&&x.meaning);
 if(!result.length)throw new Error('CSV 至少需要 word,meaning');
 return result;
}
async function importWords(){
 try{
  words=parseWords((($('#word-input') as HTMLTextAreaElement).value));
  currentWord=0;await saveWords();renderPhoneWord();await renderGlasses();
  alert(`成功匯入 ${words.length} 個單字`);
 }catch(e){alert(e instanceof Error?e.message:'匯入失敗');}
}
async function restoreWords(){
 words=[...DEFAULT_WORDS];currentWord=0;await saveWords();renderPhoneWord();await renderGlasses();alert('已還原預設單字');
}
async function loadWords(){
 if(!bridge)return;
 try{
  const raw=await serialize(()=>bridge!.getLocalStorage(STORAGE_KEY));
  if(!raw)return;
  const parsed:unknown=JSON.parse(raw);
  if(Array.isArray(parsed)){
   const valid=parsed.filter((x:any)=>x&&typeof x.word==='string'&&typeof x.meaning==='string');
   if(valid.length)words=valid;
  }
 }catch(e){console.warn('讀取單字失敗',e);}
}
async function saveWords(){
 if(!bridge)return;
 try{await serialize(()=>bridge!.setLocalStorage(STORAGE_KEY,JSON.stringify(words)));}
 catch(e){console.warn('儲存單字失敗',e);}
}
function parseNumber(v:unknown):number|null{
 if(typeof v!=='string'&&typeof v!=='number')return null;
 const n=Number(v);return Number.isFinite(n)&&n>0?n:null;
}
async function fetchQuotes():Promise<Quote[]>{
 const url='https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch='+
 encodeURIComponent(SYMBOLS.map(x=>x.symbol).join('|'))+'&json=1&delay=0';
 const response=await fetch(url,{cache:'no-store'});
 if(!response.ok)throw new Error(`HTTP ${response.status}`);
 const data=await response.json() as {msgArray?:Array<{c?:string;n?:string;z?:string;y?:string;t?:string}>};
 if(!Array.isArray(data.msgArray))throw new Error('行情回傳格式不正確');
 return SYMBOLS.map(s=>{
  const q=data.msgArray!.find(x=>x.c===s.symbol);
  return {symbol:s.symbol,name:q?.n||s.name,price:parseNumber(q?.z),previousClose:parseNumber(q?.y),time:q?.t||''};
 });
}
function renderPhoneQuotes(){
 if(!quotes.length){$('#quotes').innerHTML='<div class="hint">尚未取得行情資料</div>';$('#quote-status').textContent=quoteStatus;return;}
 $('#quotes').innerHTML=quotes.map(q=>{
  const change=q.price!==null&&q.previousClose!==null?q.price-q.previousClose:null;
  const pct=change!==null&&q.previousClose?change/q.previousClose*100:null;
  const cls=change===null?'neutral':change>0?'up':change<0?'down':'neutral';
  const state=q.price===null?`未取得即時成交｜昨收 ${q.previousClose?.toFixed(2)??'--'}`:`${change!==null&&change>0?'+':''}${change?.toFixed(2)??'--'} (${pct?.toFixed(2)??'--'}%)`;
  return `<div class="quote-row"><div><b>${escapeHtml(q.name)}</b><div class="hint">${escapeHtml(q.symbol)}</div></div><div><div class="quote-price">${q.price?.toFixed(2)??'--'}</div><div class="quote-change ${cls}">${state}</div></div></div>`;
 }).join('');
 $('#quote-status').textContent=quoteStatus;
}
function renderGlassesQuotes():string{
 if(!quotes.length)return `ETF MARKET\n${quoteStatus}\n\n0050     --\n00631L   --`;
 return ['ETF MARKET',...quotes.map(q=>{
  if(q.price===null)return `${q.name} 未交易`;
  const d=q.previousClose!==null?q.price-q.previousClose:null;
  const p=d!==null&&q.previousClose?d/q.previousClose*100:null;
  return `${q.name} ${q.price.toFixed(2)} ${d!==null&&d>0?'+':''}${p?.toFixed(2)??'--'}%`;
 }),quoteUpdatedAt?`更新 ${quoteUpdatedAt}`:quoteStatus].join('\n');
}
async function refreshQuotes(){
 quoteStatus='正在取得行情…';renderPhoneQuotes();
 try{
  quotes=await fetchQuotes();
  quoteUpdatedAt=new Date().toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'});
  quoteStatus='行情取得成功';
 }catch(e){quoteStatus=e instanceof Error?`行情讀取失敗：${e.message}`:'行情讀取失敗';console.error(e);}
 renderPhoneQuotes();await renderGlasses();
}
function glassesWordText():string{
 if(!words.length)return 'NO VOCABULARY';
 const w=words[currentWord];
 return ['ENGLISH WORD',`${currentWord+1}/${words.length}`,'',w.word,w.meaning,'',w.example??'','','TAP: NEXT','SWIPE: PREV/NEXT'].join('\n');
}
async function renderGlasses(){
 if(!bridge||!appStarted)return;
 await serialize(async()=>{
  await bridge!.textContainerUpgrade(new TextContainerUpgrade({containerID:1,containerName:'vocab',content:glassesWordText()}));
  await bridge!.textContainerUpgrade(new TextContainerUpgrade({containerID:2,containerName:'stocks',content:renderGlassesQuotes()}));
 });
}
function eventTypeOf(envelope?:{eventType?:OsEventTypeList}):OsEventTypeList|null{
 if(!envelope)return null;
 return envelope.eventType??OsEventTypeList.CLICK_EVENT;
}
function registerGlassesEvents(){
 if(!bridge)return;
 bridge.onEvenHubEvent(event=>{
  const sys=eventTypeOf(event.sysEvent);
  const txt=eventTypeOf(event.textEvent);
  if(sys===OsEventTypeList.DOUBLE_CLICK_EVENT||txt===OsEventTypeList.DOUBLE_CLICK_EVENT){
   void bridge?.shutDownPageContainer(1);return;
  }
  if(txt===OsEventTypeList.SCROLL_TOP_EVENT){changeWord(-1);return;}
  if(txt===OsEventTypeList.SCROLL_BOTTOM_EVENT){changeWord(1);return;}
  if(sys===OsEventTypeList.CLICK_EVENT||txt===OsEventTypeList.CLICK_EVENT)changeWord(1);
 });
}
async function startGlassesPage(){
 bridge=await waitForEvenAppBridge();
 const vocab=new TextContainerProperty({
  xPosition:0,yPosition:0,width:576,height:154,borderWidth:0,borderColor:5,paddingLength:4,
  containerID:1,containerName:'vocab',content:glassesWordText(),isEventCapture:1
 });
 const stock=new TextContainerProperty({
  xPosition:0,yPosition:160,width:576,height:128,borderWidth:0,borderColor:5,paddingLength:4,
  containerID:2,containerName:'stocks',content:renderGlassesQuotes(),isEventCapture:0
 });
 const result=await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({
  containerTotalNum:2,textObject:[vocab,stock]
 }));
 if(result!==0)throw new Error(`G2 頁面建立失敗：${result}`);
 appStarted=true;registerGlassesEvents();await renderGlasses();
}
async function main(){
 mountPhoneUI();
 try{
  await startGlassesPage();
  $('#connection-status').textContent='Even Hub 已連線｜G2 原生頁面已建立';
  await loadWords();currentWord=0;renderPhoneWord();await renderGlasses();
  await refreshQuotes();
  window.setInterval(()=>changeWord(1),15000);
  window.setInterval(()=>void refreshQuotes(),60000);
 }catch(e){
  console.error(e);
  $('#connection-status').textContent=e instanceof Error?`SDK 啟動失敗：${e.message}`:'SDK 啟動失敗';
  alert('Even Hub SDK 啟動失敗。請確認在 Even Realities App 內開啟。');
 }
}
void main();
EOF

echo "[2/6] Source files created"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js 未安裝"
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: Node.js 版本過舊，請先安裝 Node.js 20 或以上"
  exit 1
fi

echo "[3/6] Installing dependencies..."
npm install

echo "[4/6] Building..."
npm run build

echo "[5/6] Packaging..."
npx evenhub pack app.json dist -o even-hud-555-v1.1.2.ehpk

echo "[6/6] DONE"
ls -lh even-hud-555-v1.1.2.ehpk
echo "封裝完成：$PWD/even-hud-555-v1.1.2.ehpk"
