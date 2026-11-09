// 輕量 SRS 間隔重複管理器 (Leitner 5-box 演算法)
const INTERVAL_DAYS = [0, 1, 3, 7, 14, 30];

export class VocabManager {
  constructor(initialVocabList = []) {
    this.storageKey = 'even_hud_vocab_srs';
    this.cards = this.loadState(initialVocabList);
    this.currentDeck = [];
    this.currentIndex = 0;
    this.isFlipped = false;
    this.rebuildDeck();
  }

  loadState(initialList) {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('載入本地 SRS 狀態失敗', e);
    }
    return initialList.map(item => ({
      ...item,
      level: 0,
      nextReview: 0,
      lastReviewed: 0
    }));
  }

  saveState() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.cards));
    } catch (e) {
      console.warn('儲存 SRS 狀態失敗', e);
    }
  }

  rebuildDeck() {
    const now = Date.now();
    this.currentDeck = this.cards.filter(card => (card.nextReview || 0) <= now);
    if (this.currentDeck.length === 0) {
      this.currentDeck = [...this.cards].sort((a, b) => (a.level || 0) - (b.level || 0)).slice(0, 5);
    }
    this.currentIndex = 0;
    this.isFlipped = false;
  }

  getCurrentCard() {
    if (!this.currentDeck || this.currentDeck.length === 0) return null;
    return this.currentDeck[this.currentIndex];
  }

  toggleFlip() {
    this.isFlipped = !this.isFlipped;
    return this.isFlipped;
  }

  rateCard(knowIt) {
    const card = this.getCurrentCard();
    if (!card) return;

    const now = Date.now();
    if (knowIt) {
      card.level = Math.min((card.level || 0) + 1, 5);
    } else {
      card.level = 0;
    }

    const intervalDays = INTERVAL_DAYS[card.level];
    card.lastReviewed = now;
    card.nextReview = now + (intervalDays * 24 * 60 * 60 * 1000);

    this.saveState();
    this.nextCard();
  }

  nextCard() {
    this.isFlipped = false;
    if (this.currentDeck.length > 0) {
      this.currentIndex = (this.currentIndex + 1) % this.currentDeck.length;
    }
  }
}
