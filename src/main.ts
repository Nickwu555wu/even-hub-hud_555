import './style.css';

import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerUpgrade,
  OsEventTypeList
} from '@evenrealities/even_hub_sdk';

const STORAGE_KEY = 'even_hud_555_config_v140';

export type Vocab = {
  word: string;
  pos: string;
  meaning: string;
  example: string;
};

type Quote = {
  price: number | null;
  change: number | null;
  tradeTime: string;
  isLive: boolean;
};

type NewsItem = {
  title: string;
  source: string;
  time: string;
};

type AppConfig = {
  vocabInterval: number;
  stockInterval: number;
  newsInterval: number;
  borderMode: number;
  twseApiUrl: string;
  newsApiUrl: string;
  vocabList: Vocab[];
};

const DEFAULT_VOCAB: Vocab[] = [
  { word: 'IMPEDANCE', pos: 'n.', meaning: '阻抗匹配', example: 'Controlled trace impedance matching prevents high-speed reflections.' },
  { word: 'RESILIENT', pos: 'adj.', meaning: '適應力強的', example: 'The power distribution network is highly resilient against transients.' },
  { word: 'ATTENUATION', pos: 'n.', meaning: '訊號衰減', example: 'Dielectric loss attenuation increases rapidly with gigahertz frequency.' },
  { word: 'DECOUPLING', pos: 'n.', meaning: '電源去耦', example: 'Decoupling caps must be placed directly adjacent to VDD pins.' },
  { word: 'BANDWIDTH', pos: 'n.', meaning: '頻寬能力', example: 'PCIe Gen 6 delivers double the raw throughput lane bandwidth.' },
  { word: 'CONSISTENCY', pos: 'n.', meaning: '持續一致性', example: 'Consistent daily execution compounds into remarkable engineering results.' }
];

const DEFAULT_CONFIG: AppConfig = {
  vocabInterval: 15000,
  stockInterval: 60000,
  newsInterval: 30000,
  borderMode: 1,
  twseApiUrl: 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp',
  newsApiUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fnews.google.com%2Frss%2Fsearch%3Fq%3Dsemiconductor%2BPCIe%2BAI%2Bhardware%26hl%3Den-US%26gl%3DUS%26ceid%3DUS%3Aen',
  vocabList: [...DEFAULT_VOCAB]
};

let config: AppConfig = { ...DEFAULT_CONFIG };

const DEFAULT_NEWS: NewsItem[] = [
  { title: 'Connecting to live news feeds...', source: 'SYS', time: '--:--' }
];
let liveNews: NewsItem[] = [...DEFAULT_NEWS];

type PageType = 'VOCAB' | 'ETF' | 'NEWS';
const PAGES: PageType[] = ['VOCAB', 'ETF', 'NEWS'];
let pageIndex = 0;
let vocabIndex = 0;
let newsIndex = 0;

const quotes: Record<string, Quote> = {
  '0050': { price: null, change: null, tradeTime: '--', isLive: false },
  '00631L': { price: null, change: null, tradeTime: '--', isLive: false }
};

type MarketStateType = 'LIVE' | 'CLOSE' | 'STALE' | 'OFFLINE' | 'UPDATING';
let marketStatus: MarketStateType = 'CLOSE';
let lastQuoteTimestamp = 0;
let lastQuoteTimeStr = '--';

let bridge: any = null;
let isGlassesStarted = false;
let isEventSubscribed = false;

let isUpdatingGlasses = false;
let hasPendingUpdate = false;
let lastActionTimestamp = 0;

let vocabTimer: any = null;
let stockTimer: any = null;
let newsTimer: any = null;

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

// ==========================================
// 斷行演算法 (Word Boundary + 超長單字防禦)
// ==========================================
function wrapSafe(text: string, maxLen: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';

  for (let w of words) {
    while (w.length > maxLen) {
      if (cur) {
        lines.push(cur);
        cur = '';
        if (lines.length >= maxLines) break;
      }
      lines.push(w.slice(0, maxLen));
      w = w.slice(maxLen);
      if (lines.length >= maxLines) break;
    }
    if (lines.length >= maxLines) break;
    if (!w) continue;

    if (!cur) {
      cur = w;
    } else if ((cur + ' ' + w).length <= maxLen) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    }
  }

  if (cur && lines.length < maxLines) {
    lines.push(cur);
  }
  return lines;
}

function parseCSVLine(text: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

// ==========================================
// 全域 JSON Schema 深度驗證 (SPEC.md Section 7)
// ==========================================
function validateAndSanitizeConfig(raw: any): AppConfig | null {
  if (!raw || typeof raw !== 'object') return null;

  const validVocab: Vocab[] = [];
  if (Array.isArray(raw.vocabList) && raw.vocabList.length > 0) {
    for (const item of raw.vocabList) {
      if (item && typeof item.word === 'string' && typeof item.meaning === 'string') {
        validVocab.push({
          word: String(item.word).trim().toUpperCase(),
          pos: String(item.pos || 'n.').trim(),
          meaning: String(item.meaning).trim(),
          example: String(item.example || '').trim()
        });
      }
    }
  }
  if (validVocab.length === 0) return null;

  return {
    vocabInterval: typeof raw.vocabInterval === 'number' && raw.vocabInterval >= 0 ? raw.vocabInterval : 15000,
    stockInterval: typeof raw.stockInterval === 'number' && raw.stockInterval >= 10000 ? raw.stockInterval : 60000,
    newsInterval: typeof raw.newsInterval === 'number' && raw.newsInterval >= 0 ? raw.newsInterval : 30000,
    borderMode: raw.borderMode === 0 ? 0 : 1,
    twseApiUrl: typeof raw.twseApiUrl === 'string' && raw.twseApiUrl.startsWith('http') ? raw.twseApiUrl : DEFAULT_CONFIG.twseApiUrl,
    newsApiUrl: typeof raw.newsApiUrl === 'string' && raw.newsApiUrl.startsWith('http') ? raw.newsApiUrl : DEFAULT_CONFIG.newsApiUrl,
    vocabList: validVocab
  };
}

function loadConfig(): void {
  try {
    const rawStr = localStorage.getItem(STORAGE_KEY);
    if (rawStr) {
      const parsed = JSON.parse(rawStr);
      const validated = validateAndSanitizeConfig(parsed);
      if (validated) config = validated;
    }
  } catch (e) {
    console.warn('Config load fallback:', e);
  }
}

function saveConfig(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn('Config save error:', e);
  }
}

// ==========================================
// G2 HUD 文字容器格式化 (184px + 96px)
// ==========================================
function getTopHUDContent(): string {
  const now = new Date();
  const timeStr = now.toTimeString().slice(0, 5);
  const curPage = PAGES[pageIndex];

  if (curPage === 'VOCAB') {
    const v = config.vocabList[vocabIndex] || config.vocabList[0];
    const lines = wrapSafe(v.example || '', 52, 2);

    return [
      `555 HUD     ${vocabIndex + 1}/${config.vocabList.length}     ${timeStr}`,
      '',
      `${v.word}  ${v.pos}`,
      v.meaning,
      `EX: ${lines[0] || ''}`,
      lines[1] || '',
      'TAP: NEXT     DOUBLE TAP: ETF'
    ].filter((line, i) => line !== '' || i === 1).join('\n');
  }

  if (curPage === 'ETF') {
    const a = quotes['0050'];
    const b = quotes['00631L'];
    const pA = a.price !== null ? a.price.toFixed(2) : '--.--';
    const pB = b.price !== null ? b.price.toFixed(2) : '--.--';
    const cA = a.change !== null ? `${a.change > 0 ? '+' : ''}${a.change.toFixed(2)}%` : '--%';
    const cB = b.change !== null ? `${b.change > 0 ? '+' : ''}${b.change.toFixed(2)}%` : '--%';

    return [
      `ETF WATCH     ${timeStr}`,
      '',
      `0050    ${pA}    ${cA}`,
      `00631L  ${pB}    ${cB}`,
      '',
      'TAP: REFRESH     DOUBLE TAP: NEWS'
    ].join('\n');
  }

  // NEWS 頁面
  const item = liveNews[newsIndex] || { title: 'No news feeds available', source: 'SYS', time: '--:--' };
  const tLines = wrapSafe(item.title, 52, 2);

  return [
    `NEWS TICKER [${newsIndex + 1}/${liveNews.length}]    ${timeStr}`,
    '',
    `[${item.source}] ${item.time}`,
    tLines[0] || '',
    tLines[1] || '',
    '',
    'TAP: NEXT     DOUBLE TAP: VOCAB'
  ].filter((line, i) => line !== '' || i === 1).join('\n');
}

function getBottomMiniContent(): string {
  const curPage = PAGES[pageIndex];
  const a = quotes['0050'];
  const b = quotes['00631L'];
  const pA = a.price !== null ? a.price.toFixed(2) : '--.--';
  const pB = b.price !== null ? b.price.toFixed(2) : '--.--';

  if (curPage === 'VOCAB') {
    return [
      `MARKET  0050 ${pA}  |  00631L ${pB}`,
      `STATUS  ${marketStatus}  |  AUTO ${config.stockInterval / 1000}S`
    ].join('\n');
  }

  if (curPage === 'ETF') {
    return [
      `LAST UPDATE  ${lastQuoteTimeStr}`,
      `SOURCE  TWSE  |  STATE: ${marketStatus}`
    ].join('\n');
  }

  return [
    `MARKET  0050 ${pA}  |  00631L ${pB}`,
    `NEWS FEED: ACTIVE  |  ${marketStatus}`
  ].join('\n');
}

// ==========================================
// BLE 封包佇列防抖：最新狀態優先
// ==========================================
async function updateViews() {
  const curPage = PAGES[pageIndex];
  byId('page-indicator').textContent = `PAGE: ${curPage}`;
  byId('qv-title').textContent = curPage === 'VOCAB'
    ? `VOCABULARY (${vocabIndex + 1}/${config.vocabList.length})`
    : (curPage === 'ETF' ? `ETF WATCH [${marketStatus}]` : `NEWS (${newsIndex + 1}/${liveNews.length})`);
  byId('qv-body').textContent = getTopHUDContent() + '\n---\n' + getBottomMiniContent();

  if (!bridge) return;

  if (isUpdatingGlasses) {
    hasPendingUpdate = true;
    return;
  }

  isUpdatingGlasses = true;
  hasPendingUpdate = false;

  try {
    const topText = getTopHUDContent();
    const btmText = getBottomMiniContent();

    await bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: 1,
      containerName: 'top_hud',
      content: topText
    }));
    await bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: 2,
      containerName: 'btm_hud',
      content: btmText
    }));
  } catch (e) {
    console.error('BLE upgrade failed:', e);
  } finally {
    isUpdatingGlasses = false;
    if (hasPendingUpdate) {
      updateViews();
    }
  }
}

function throttleAction(action: () => void) {
  const now = Date.now();
  if (now - lastActionTimestamp < 150) return;
  lastActionTimestamp = now;
  action();
}

function nextPage() {
  throttleAction(() => {
    pageIndex = (pageIndex + 1) % PAGES.length;
    updateViews();
  });
}

function handlePrimaryAction() {
  throttleAction(() => {
    const curPage = PAGES[pageIndex];
    if (curPage === 'VOCAB') {
      vocabIndex = (vocabIndex + 1) % config.vocabList.length;
    } else if (curPage === 'ETF') {
      fetchQuotes();
    } else {
      newsIndex = (newsIndex + 1) % liveNews.length;
    }
    updateViews();
  });
}

function handlePrevAction() {
  throttleAction(() => {
    const curPage = PAGES[pageIndex];
    if (curPage === 'VOCAB') {
      vocabIndex = (vocabIndex - 1 + config.vocabList.length) % config.vocabList.length;
    } else if (curPage === 'NEWS') {
      newsIndex = (newsIndex - 1 + liveNews.length) % liveNews.length;
    }
    updateViews();
  });
}

// ==========================================
// 外部 API 串接：即時新聞
// ==========================================
async function fetchNews() {
  try {
    const res = await fetch(config.newsApiUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data && Array.isArray(data.items) && data.items.length > 0) {
      liveNews = data.items.slice(0, 8).map((it: any) => ({
        title: String(it.title || 'Untitled').trim(),
        source: 'TECH',
        time: it.pubDate ? it.pubDate.split(' ')[1]?.substring(0, 5) || 'LIVE' : 'LIVE'
      }));
      newsIndex = 0;
      updateViews();
    }
  } catch (e) {
    console.warn('News RSS fetch fallback:', e);
  }
}

// ==========================================
// 外部 API 串接：TWSE 行情狀態機
// ==========================================
async function fetchQuotes() {
  try {
    marketStatus = 'UPDATING';
    updateViews();

    const url = `${config.twseApiUrl}?ex_ch=tse_0050.tw|tse_00631L.tw&json=1&delay=0&_=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    let hasLiveTrade = false;
    let validRecords = 0;

    if (Array.isArray(data.msgArray) && data.msgArray.length > 0) {
      for (const item of data.msgArray) {
        const symbol = String(item.c);
        if (symbol in quotes) {
          const y = (item.y && item.y !== '-') ? Number(item.y) : null;
          const z = (item.z && item.z !== '-') ? Number(item.z) : null;
          const price = z ?? y;

          if (z !== null) hasLiveTrade = true;

          quotes[symbol] = {
            price,
            change: (price !== null && y !== null) ? ((price - y) / y) * 100 : null,
            tradeTime: item.t || '--',
            isLive: z !== null
          };
          validRecords++;
        }
      }

      if (validRecords > 0) {
        lastQuoteTimestamp = Date.now();
        lastQuoteTimeStr = new Date().toLocaleTimeString('zh-TW', { hour12: false });
        marketStatus = hasLiveTrade ? 'LIVE' : 'CLOSE';
      } else {
        marketStatus = 'CLOSE';
      }
    } else {
      marketStatus = 'CLOSE';
    }
  } catch (err) {
    // 若超過 180 秒未成功更新且原先有資料，標示 STALE，否則 OFFLINE
    if (lastQuoteTimestamp > 0 && Date.now() - lastQuoteTimestamp > 180000) {
      marketStatus = 'STALE';
    } else if (lastQuoteTimestamp === 0) {
      marketStatus = 'OFFLINE';
    }
  }
  updateViews();
}

// ==========================================
// G2 容器生命週期控制 (解耦註冊與容器構建)
// ==========================================
function buildContainerProperties() {
  const bw = config.borderMode === 1 ? 1 : 0;
  return [
    new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 184,
      borderWidth: bw,
      borderColor: bw ? 12 : 0,
      paddingLength: 8,
      containerID: 1,
      containerName: 'top_hud',
      content: getTopHUDContent(),
      isEventCapture: 1
    }),
    new TextContainerProperty({
      xPosition: 0,
      yPosition: 192,
      width: 576,
      height: 96,
      borderWidth: bw,
      borderColor: bw ? 8 : 0,
      paddingLength: 6,
      containerID: 2,
      containerName: 'btm_hud',
      content: getBottomMiniContent(),
      isEventCapture: 0
    })
  ];
}

async function syncG2Layout() {
  if (!bridge) return;
  const containers = buildContainerProperties();

  try {
    if (!isGlassesStarted) {
      await bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          containerTotalNum: 2,
          textObject: containers
        })
      );
      isGlassesStarted = true;
    } else {
      // 後續版面重構使用 RebuildPageContainer，不重複啟動
      if (typeof bridge.rebuildPageContainer === 'function') {
        await bridge.rebuildPageContainer(
          new RebuildPageContainer({
            containerTotalNum: 2,
            textObject: containers
          })
        );
      } else {
        updateViews();
      }
    }
  } catch (e) {
    console.warn('G2 sync layout error:', e);
  }
}

async function initGlassesBridge() {
  try {
    bridge = await waitForEvenAppBridge();
    await syncG2Layout();

    // 手勢事件全域僅註冊一次
    if (!isEventSubscribed && bridge && typeof bridge.onEvenHubEvent === 'function') {
      bridge.onEvenHubEvent((event: any) => {
        const env = event.sysEvent || event.textEvent;
        if (!env || env.eventType === undefined || env.eventType === null) return;
        const type = env.eventType;

        if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
          nextPage();
          return;
        }
        if (type === OsEventTypeList.CLICK_EVENT) {
          handlePrimaryAction();
          return;
        }
        if (type === OsEventTypeList.SLIDE_TO_TOP || type === OsEventTypeList.SCROLL_TOP_EVENT) {
          handlePrevAction();
          return;
        }
        if (type === OsEventTypeList.SLIDE_TO_BOTTOM || type === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
          handlePrimaryAction();
          return;
        }
      });
      isEventSubscribed = true;
    }
  } catch (e) {
    console.error('Bridge initialization error:', e);
  }
}

// ==========================================
// 計時器排程管理
// ==========================================
function applyTimers() {
  if (vocabTimer) clearInterval(vocabTimer);
  if (stockTimer) clearInterval(stockTimer);
  if (newsTimer) clearInterval(newsTimer);

  if (config.vocabInterval > 0) {
    vocabTimer = setInterval(() => {
      if (PAGES[pageIndex] === 'VOCAB') {
        vocabIndex = (vocabIndex + 1) % config.vocabList.length;
        updateViews();
      }
    }, config.vocabInterval);
  }

  if (config.stockInterval > 0) {
    stockTimer = setInterval(fetchQuotes, config.stockInterval);
  }

  if (config.newsInterval > 0) {
    newsTimer = setInterval(() => {
      if (PAGES[pageIndex] === 'NEWS') {
        newsIndex = (newsIndex + 1) % liveNews.length;
        updateViews();
      }
    }, config.newsInterval);
  }
}

// ==========================================
// 手機 UI 與設定事件綁定
// ==========================================
function setupUI() {
  byId('btn-page').onclick = () => nextPage();
  byId('btn-next').onclick = () => handlePrimaryAction();
  byId('btn-prev').onclick = () => handlePrevAction();

  const vSel = byId<HTMLSelectElement>('cfg-vocab-interval');
  const sSel = byId<HTMLSelectElement>('cfg-stock-interval');
  const nSel = byId<HTMLSelectElement>('cfg-news-interval');
  const bSel = byId<HTMLSelectElement>('cfg-border-mode');
  const twseInput = byId<HTMLInputElement>('cfg-twse-url');
  const newsInput = byId<HTMLInputElement>('cfg-news-url');

  vSel.value = String(config.vocabInterval);
  sSel.value = String(config.stockInterval);
  nSel.value = String(config.newsInterval);
  bSel.value = String(config.borderMode);
  twseInput.value = config.twseApiUrl;
  newsInput.value = config.newsApiUrl;

  vSel.onchange = () => { config.vocabInterval = Number(vSel.value); saveConfig(); applyTimers(); };
  sSel.onchange = () => { config.stockInterval = Number(sSel.value); saveConfig(); applyTimers(); };
  nSel.onchange = () => { config.newsInterval = Number(nSel.value); saveConfig(); applyTimers(); };
  bSel.onchange = () => {
    config.borderMode = Number(bSel.value);
    saveConfig();
    syncG2Layout();
  };

  // API 設置與連線測試
  byId('btn-save-api').onclick = () => {
    const tUrl = twseInput.value.trim();
    const nUrl = newsInput.value.trim();
    if (tUrl.startsWith('http') && nUrl.startsWith('http')) {
      config.twseApiUrl = tUrl;
      config.newsApiUrl = nUrl;
      saveConfig();
      byId('api-status').textContent = '已保存！';
      fetchQuotes();
      fetchNews();
    } else {
      byId('api-status').textContent = 'URL 必須以 http 開頭';
    }
  };

  byId('btn-test-api').onclick = async () => {
    byId('api-status').textContent = '連線測試中...';
    try {
      await Promise.all([fetchQuotes(), fetchNews()]);
      byId('api-status').textContent = '連線測試正常';
    } catch (e) {
      byId('api-status').textContent = '測試失敗';
    }
  };

  // 單字匯入
  byId('btn-import-vocab').onclick = () => {
    const raw = byId<HTMLTextAreaElement>('vocab-input').value.trim();
    const msg = byId('vocab-msg');
    if (!raw) return;

    try {
      const list: Vocab[] = [];
      if (raw.startsWith('[') && raw.endsWith(']')) {
        const json = JSON.parse(raw);
        for (const item of json) {
          if (item.word && item.meaning) {
            list.push({ word: String(item.word).toUpperCase(), pos: item.pos || '', meaning: item.meaning, example: item.example || '' });
          }
        }
      } else {
        const lines = raw.split('\n');
        for (const line of lines) {
          const parts = parseCSVLine(line);
          if (parts.length >= 2 && parts[0]) {
            list.push({
              word: parts[0].toUpperCase(),
              pos: parts[1] || 'n.',
              meaning: parts[2] || parts[1],
              example: parts[3] || ''
            });
          }
        }
      }

      if (list.length > 0) {
        config.vocabList = list;
        vocabIndex = 0;
        saveConfig();
        msg.textContent = `成功匯入 ${list.length} 筆單字！`;
        byId<HTMLTextAreaElement>('vocab-input').value = '';
        updateViews();
      }
    } catch (e) {
      msg.textContent = '單字解析錯誤';
    }
  };

  byId('btn-export-vocab').onclick = () => {
    byId<HTMLTextAreaElement>('vocab-input').value = JSON.stringify(config.vocabList, null, 2);
    byId('vocab-msg').textContent = '已匯出單字 JSON';
  };

  // 全域設定 JSON 備份、還原與重置 (經 Schema 防禦校驗)
  byId('btn-export-all').onclick = () => {
    byId<HTMLTextAreaElement>('backup-input').value = JSON.stringify(config, null, 2);
    byId('backup-msg').textContent = '全域設定已匯出';
  };

  byId('btn-import-all').onclick = () => {
    const raw = byId<HTMLTextAreaElement>('backup-input').value.trim();
    const msg = byId('backup-msg');
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      const validated = validateAndSanitizeConfig(parsed);
      if (validated) {
        config = validated;
        saveConfig();
        vSel.value = String(config.vocabInterval);
        sSel.value = String(config.stockInterval);
        nSel.value = String(config.newsInterval);
        bSel.value = String(config.borderMode);
        twseInput.value = config.twseApiUrl;
        newsInput.value = config.newsApiUrl;

        applyTimers();
        syncG2Layout();
        updateViews();
        msg.textContent = '全域設定驗證通過並還原！';
      } else {
        msg.textContent = 'JSON 格式或欄位驗證未通過';
      }
    } catch (e) {
      msg.textContent = 'JSON 語法錯誤';
    }
  };

  byId('btn-reset-all').onclick = () => {
    config = { ...DEFAULT_CONFIG, vocabList: [...DEFAULT_VOCAB] };
    saveConfig();
    vSel.value = '15000';
    sSel.value = '60000';
    nSel.value = '30000';
    bSel.value = '1';
    twseInput.value = config.twseApiUrl;
    newsInput.value = config.newsApiUrl;

    applyTimers();
    syncG2Layout();
    updateViews();
    byId('backup-msg').textContent = '已重置為預設值';
  };
}

async function start() {
  loadConfig();
  setupUI();
  applyTimers();
  updateViews();
  await initGlassesBridge();
  await fetchQuotes();
  await fetchNews();
}

window.addEventListener('DOMContentLoaded', start);
