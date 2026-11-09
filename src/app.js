// === 1. 預設單字庫 (針對 HUD 特化排版) ===
const PRESET_VOCAB_DB = {
  si_hardware: [
    {
      term: 'attenuation',
      pos: 'n.',
      def_zh: '訊號衰減、減弱',
      example_en: 'Shielding minimizes signal attenuation.',
      collocation: 'attenuation loss / damping'
    },
    {
      term: 'impedance',
      pos: 'n.',
      def_zh: '阻抗',
      example_en: 'Controlled impedance prevents reflections.',
      collocation: '50-ohm matching / trace'
    },
    {
      term: 'crosstalk',
      pos: 'n.',
      def_zh: '串擾、串音',
      example_en: 'Spacing routing pairs reduces crosstalk.',
      collocation: 'NEXT / FEXT isolation'
    },
    {
      term: 'jitter',
      pos: 'n.',
      def_zh: '時序抖動',
      example_en: 'Phase jitter degrades clock accuracy.',
      collocation: 'random jitter / deterministic'
    },
    {
      term: 'decoupling',
      pos: 'n.',
      def_zh: '去耦、解耦',
      example_en: 'Place decoupling caps near IC pins.',
      collocation: 'bypass capacitor / PDN'
    }
  ],
  business: [
    {
      term: 'mitigate',
      pos: 'v.',
      def_zh: '減輕、緩和風險',
      example_en: 'Countermeasures mitigate supply risks.',
      collocation: 'mitigate impact / risk control'
    },
    {
      term: 'streamline',
      pos: 'v.',
      def_zh: '簡化、優化流程',
      example_en: 'Automation streamlines release testing.',
      collocation: 'streamline workflow / efficiency'
    },
    {
      term: 'bottleneck',
      pos: 'n.',
      def_zh: '瓶頸、阻礙點',
      example_en: 'Thermal throttling is the main bottleneck.',
      collocation: 'capacity bottleneck / resolve'
    }
  ],
  ai_arch: [
    {
      term: 'telemetry',
      pos: 'n.',
      def_zh: '遙測數據、監控',
      example_en: 'BMC gathers thermal sensor telemetry.',
      collocation: 'telemetry streaming / metrics'
    },
    {
      term: 'throughput',
      pos: 'n.',
      def_zh: '輸送量、總吞吐量',
      example_en: 'High throughput accelerates model train.',
      collocation: 'network throughput / I/O rate'
    },
    {
      term: 'interconnect',
      pos: 'n.',
      def_zh: '互連架構、互連線',
      example_en: 'Optical interconnect replaces copper runs.',
      collocation: 'die-to-die / PCIe interconnect'
    }
  ]
};

// 頻道對應關鍵字
const SOURCE_TOPICS = {
  custom: "",
  tech: "AI 晶片 OR 半導體 OR 伺服器硬體 OR 高速傳輸",
  finance: "台股 0050 OR 美股 VOO OR 聯準會 OR 科技股財報",
  world: "國際要聞焦點 OR 科技產業趨勢"
};

// === 2. 系統狀態管理 ===
const AppState = {
  geminiApiKey: localStorage.getItem('GEMINI_API_KEY') || '',
  mode: 'NEWS', // 'NEWS' | 'LEARN'
  isPaused: false,
  cardFlipped: false,
  newsQueue: [
    {
      headline: 'PCIe 7.0 認證規範釋出',
      insight: '光互連與 Retimer 需求擴大，高頻損耗補償成為關鍵'
    },
    {
      headline: 'AI 伺服器散熱改款',
      insight: '水冷板與 CDU 滲透率加速，功耗上限進一步放寬'
    }
  ],
  newsIndex: 0,
  learnQueue: [...PRESET_VOCAB_DB.si_hardware],
  learnIndex: 0,
  widgets: {
    time: '14:05',
    weather: '24°C',
    ticker: '0050 198.5',
    dueCount: PRESET_VOCAB_DB.si_hardware.length
  }
};

// === 3. Google Gemini API 呼叫模組 (具備 503 重試與多備用端點) ===
const delay = ms => new Promise(res => setTimeout(res, ms));

async function callGemini(prompt) {
  if (!AppState.geminiApiKey) {
    throw new Error('未設定 Gemini API Key，請先在上方輸入並儲存');
  }

  // 備用模型序列：遇到 503 或 404 時自動換模型重試
  const candidateModels = [
    'gemini-2.5-flash',
    'gemini-flash-latest',
    'gemini-2.5-pro'
  ];

  let lastError = null;

  for (const model of candidateModels) {
    // 每個模型最多重試 2 次（避免臨時 503 尖峰）
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${AppState.geminiApiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.candidates[0].content.parts[0].text;
          return JSON.parse(text);
        }

        const errText = await response.text();
        lastError = new Error(`模型 ${model} (HTTP ${response.status}): ${errText}`);

        // 若遇到 503 尖峰壅塞，延遲 1.5 秒後嘗試
        if (response.status === 503) {
          console.warn(`模型 ${model} 遇到 503 壅塞，等待重試中...`);
          await delay(1500);
          continue;
        }

        // 若是 404 或其他錯誤，直接切換到下一個模型
        break;
      } catch (err) {
        lastError = err;
        await delay(1000);
      }
    }
  }

  throw lastError || new Error('所有備用 AI 模型皆忙線中，請稍候重試');
}

// AI 濃縮新聞為 HUD 格式
async function processNewsWithAI(rawTitles) {
  const prompt = `
你是一個專為穿戴式 AR 抬頭顯示器（HUD）設計內容的精煉編輯。
以下是幾則原始新聞標題：
${rawTitles.map((t, idx) => `${idx + 1}. ${t}`).join('\n')}

請針對每一則進行提煉與延伸，嚴格遵守以下格式規則：
1. headline：12 個繁體中文字以內，直切核心，不帶廢話。
2. insight：25 個繁體中文字以內，點出「核心影響」或「關鍵數據/技術趨勢」。
3. 輸出純 JSON 陣列，不帶任何額外 markdown 標記。

範例輸出格式：
[
  {"headline": "PCIe 7.0 認證規範釋出", "insight": "光互連與 Retimer 需求擴大，高頻損耗補償成為關鍵"}
]
`;
  return await callGemini(prompt);
}

// AI 自動解析單字為學習卡片
async function analyzeVocabWithAI(wordList) {
  const prompt = `
你是一位專業的英文語言與工程科技術語教練。
請將以下輸入的英文單字清單，轉換為專為「穿戴式 AR 眼鏡 HUD」顯示的學習卡片。
單字清單：
${wordList.join(', ')}

嚴格遵守以下輸出規範：
1. def_zh：繁體中文釋義，不超過 8 個字。
2. example_en：極度精簡的實用英文例句，不超過 10~12 個單字，適合橫向寬度有限的 HUD 螢幕。
3. collocation：1~2 個核心搭配詞或常見情境片語。
4. 輸出標準 JSON 陣列，不帶任何額外 markdown 標記。

範例格式：
[
  {
    "term": "attenuation",
    "pos": "n.",
    "def_zh": "訊號衰減、減弱",
    "example_en": "Shielding minimizes signal attenuation.",
    "collocation": "attenuation loss / damping"
  }
]
`;
  return await callGemini(prompt);
}

// === 4. 新聞抓取模組 (具備多重 CORS 代理備援) ===
async function fetchGoogleNews(topic) {
  const query = topic.split(',').map(t => t.trim()).join(' OR ');
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;

  const proxies = [
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(rssUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(rssUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(rssUrl)}`
  ];

  let xmlText = null;

  for (const proxy of proxies) {
    try {
      const response = await fetch(proxy);
      if (response.ok) {
        xmlText = await response.text();
        if (xmlText && xmlText.includes('<rss')) {
          break;
        }
      }
    } catch (e) {
      console.warn(`代理連線失敗: ${proxy}，嘗試下一個...`);
    }
  }

  if (!xmlText) {
    throw new Error('所有新聞代理服務均連線逾時，請檢查網路連線。');
  }

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");
  const items = xmlDoc.querySelectorAll("item");

  const newsList = [];
  for (let i = 0; i < Math.min(items.length, 4); i++) {
    const rawTitle = items[i].querySelector("title")?.textContent || "";
    const cleanTitle = rawTitle.replace(/ - [^-]+$/, '').trim();
    if (cleanTitle) newsList.push(cleanTitle);
  }
  return newsList;
}

// === 5. HUD 繪圖與推播 ===
function renderHUD() {
  const { widgets, mode } = AppState;
  const widgetLine = `${widgets.time} | ${widgets.weather} | ${widgets.ticker} | DUE: ${AppState.learnQueue.length}`;

  let lineTitle = '';
  let lineBody = '';
  let lineSub = '';

  if (mode === 'NEWS') {
    const current = AppState.newsQueue[AppState.newsIndex] || { headline: '無快訊', insight: '請點擊更新新聞' };
    lineTitle = `[NEWS] ${current.headline}`;
    lineBody = current.insight;
    lineSub = AppState.isPaused ? '--- (已暫停) ---' : '----------------';
  } else if (mode === 'LEARN') {
    const item = AppState.learnQueue[AppState.learnIndex] || { term: '題庫已空', pos: '', def_zh: '' };
    if (!AppState.cardFlipped) {
      lineTitle = `[LEARN] ${item.term} (${item.pos || 'n.'})`;
      lineBody = '>> 點擊鏡腳翻面查看釋義';
      lineSub = `進度: ${AppState.learnIndex + 1}/${AppState.learnQueue.length}`;
    } else {
      lineTitle = `[釋義] ${item.term}: ${item.def_zh}`;
      lineBody = `EX: ${item.example_en}`;
      lineSub = `搭配: ${item.collocation}`;
    }
  }

  // 1. 更新手機端網頁預覽
  document.getElementById('prevWidget').innerText = widgetLine;
  document.getElementById('prevTitle').innerText = lineTitle;
  document.getElementById('prevBody').innerText = lineBody;
  document.getElementById('prevSub').innerText = lineSub;

  // 2. 推送至 Even Realities 眼鏡
  if (window.evenHub && window.evenHub.display) {
    window.evenHub.display.drawContainers([
      { id: 'w_bar', type: 'text', text: widgetLine, y: 10, fontSize: 14 },
      { id: 'b_title', type: 'text', text: lineTitle, y: 50, fontSize: 18 },
      { id: 'b_body', type: 'text', text: lineBody, y: 90, fontSize: 16 },
      { id: 'b_sub', type: 'text', text: lineSub, y: 130, fontSize: 12 }
    ]).catch(err => console.warn('Even Hub 繪圖失敗:', err));
  }
}

// === 6. 鏡腳手勢與鍵盤調試 ===
function handleTap() {
  if (AppState.mode === 'LEARN') {
    AppState.cardFlipped = !AppState.cardFlipped;
  } else {
    AppState.isPaused = !AppState.isPaused;
  }
  renderHUD();
}

function handleForward() {
  if (AppState.mode === 'NEWS') {
    AppState.newsIndex = (AppState.newsIndex + 1) % AppState.newsQueue.length;
  } else if (AppState.mode === 'LEARN') {
    AppState.cardFlipped = false;
    AppState.learnIndex = (AppState.learnIndex + 1) % AppState.learnQueue.length;
  }
  renderHUD();
}

function handleBackward() {
  if (AppState.mode === 'NEWS') {
    AppState.newsIndex = (AppState.newsIndex - 1 + AppState.newsQueue.length) % AppState.newsQueue.length;
  } else if (AppState.mode === 'LEARN') {
    AppState.cardFlipped = false;
    AppState.learnIndex = (AppState.learnIndex - 1 + AppState.learnQueue.length) % AppState.learnQueue.length;
  }
  renderHUD();
}

function handleLongPress() {
  AppState.mode = AppState.mode === 'NEWS' ? 'LEARN' : 'NEWS';
  AppState.cardFlipped = false;
  renderHUD();
}

function initGestures() {
  if (window.evenHub) {
    window.evenHub.on('GESTURE_TAP', handleTap);
    window.evenHub.on('GESTURE_SWIPE_FORWARD', handleForward);
    window.evenHub.on('GESTURE_SWIPE_BACKWARD', handleBackward);
    window.evenHub.on('GESTURE_LONG_PRESS', handleLongPress);
  }

  // 始終啟用鍵盤監聽以便電腦端調試
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    
    if (e.code === 'Space') { e.preventDefault(); handleTap(); }
    if (e.code === 'ArrowRight') handleForward();
    if (e.code === 'ArrowLeft') handleBackward();
    if (e.code === 'Enter') handleLongPress();
  });
}

// === 7. 預設題庫切換全域函式 ===
window.loadPresetVocab = function(categoryKey) {
  if (!PRESET_VOCAB_DB[categoryKey]) return;

  AppState.learnQueue = [...PRESET_VOCAB_DB[categoryKey]];
  AppState.learnIndex = 0;
  AppState.cardFlipped = false;
  AppState.widgets.dueCount = AppState.learnQueue.length;

  const wordsText = AppState.learnQueue.map(item => item.term).join('\n');
  document.getElementById('vocabInput').value = wordsText;

  renderHUD();
  alert(`已載入預設題庫【${categoryKey}】，共 ${AppState.learnQueue.length} 個單字！`);
};

// === 8. 初始化與事件綁定 ===
window.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('status');
  if (window.evenHub) {
    statusEl.innerText = 'Even Hub SDK 連線就緒';
    statusEl.style.color = '#00ff66';
  } else {
    statusEl.innerText = '瀏覽器模擬模式中（支援鍵盤快捷鍵調試）';
  }

  // 回填 API Key
  if (AppState.geminiApiKey) {
    document.getElementById('geminiApiKey').value = AppState.geminiApiKey;
  }

  // 儲存 Key
  document.getElementById('btnSaveKey').addEventListener('click', () => {
    const key = document.getElementById('geminiApiKey').value.trim();
    if (key) {
      AppState.geminiApiKey = key;
      localStorage.setItem('GEMINI_API_KEY', key);
      alert('Gemini API Key 已儲存！');
    }
  });

  // 來源下拉選單
  const sourceSelect = document.getElementById('newsSourceSelect');
  const topicInput = document.getElementById('newsTopic');
  sourceSelect.addEventListener('change', () => {
    if (sourceSelect.value === 'custom') {
      topicInput.disabled = false;
      topicInput.placeholder = "輸入關鍵字 (如：AI 晶片, 伺服器硬體)";
    } else {
      topicInput.disabled = true;
      topicInput.value = SOURCE_TOPICS[sourceSelect.value];
    }
  });

  // 更新新聞按鈕
  document.getElementById('btnSaveTopic').addEventListener('click', async () => {
    const topic = topicInput.value.trim();
    if (!topic) return;

    const btn = document.getElementById('btnSaveTopic');
    btn.disabled = true;
    btn.innerText = '抓取中...';

    try {
      const rawTitles = await fetchGoogleNews(topic);
      if (rawTitles.length === 0) {
        alert('未找到相關新聞');
        return;
      }

      let refined = [];
      if (AppState.geminiApiKey) {
        btn.innerText = 'AI 提煉中...';
        refined = await processNewsWithAI(rawTitles);
      } else {
        refined = rawTitles.map(t => ({
          headline: t.substring(0, 12),
          insight: t.substring(12, 37) || '最新焦點快訊即時更新'
        }));
      }

      AppState.newsQueue = refined;
      AppState.newsIndex = 0;
      renderHUD();
      alert(`已載入 ${refined.length} 則快訊！`);
    } catch (err) {
      console.error(err);
      alert(`新聞更新失敗: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerText = '更新新聞快訊';
    }
  });

  // 叫 AI 智能生成單字卡
  document.getElementById('btnAiAnalyzeVocab').addEventListener('click', async () => {
    const rawText = document.getElementById('vocabInput').value.trim();
    if (!rawText) {
      alert("請先輸入單字！");
      return;
    }

    const words = rawText.split(/[\n,]+/).map(w => w.trim()).filter(Boolean);
    if (words.length === 0) return;

    const btn = document.getElementById('btnAiAnalyzeVocab');
    btn.disabled = true;
    btn.innerText = "AI 正在分析生成中...";

    try {
      const cards = await analyzeVocabWithAI(words);
      AppState.learnQueue = [...cards, ...AppState.learnQueue];
      AppState.learnIndex = 0;
      AppState.cardFlipped = false;
      AppState.widgets.dueCount = AppState.learnQueue.length;

      renderHUD();
      alert(`成功生成並加入 ${cards.length} 張專屬卡片！`);
      document.getElementById('vocabInput').value = "";
    } catch (err) {
      console.error(err);
      alert(`生成失敗: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerText = "🤖 叫 AI 智能生成卡片";
    }
  });

  // 手動直接匯入
  document.getElementById('btnSaveVocab').addEventListener('click', () => {
    const rawText = document.getElementById('vocabInput').value.trim();
    const words = rawText.split(/[\n,]+/).map(w => w.trim()).filter(Boolean);
    if (words.length === 0) return;

    words.forEach(w => {
      AppState.learnQueue.unshift({
        term: w,
        pos: 'n.',
        def_zh: '手動匯入生字',
        example_en: `Example sentence for ${w}.`,
        collocation: 'custom note'
      });
    });

    AppState.learnIndex = 0;
    AppState.cardFlipped = false;
    AppState.widgets.dueCount = AppState.learnQueue.length;
    renderHUD();
    alert(`已手動加入 ${words.length} 個單字！`);
    document.getElementById('vocabInput').value = "";
  });

  // 定時器：時間更新 (每 60 秒)
  setInterval(() => {
    const now = new Date();
    AppState.widgets.time = now.toTimeString().substring(0, 5);
    renderHUD();
  }, 60000);

  // 定時器：新聞輪播 (每 12 秒)
  setInterval(() => {
    if (AppState.mode === 'NEWS' && !AppState.isPaused && AppState.newsQueue.length > 0) {
      AppState.newsIndex = (AppState.newsIndex + 1) % AppState.newsQueue.length;
      renderHUD();
    }
  }, 12000);

  initGestures();
  renderHUD();
});