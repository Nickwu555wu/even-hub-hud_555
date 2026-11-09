export function renderVocabView(manager, containerTop, containerBottom) {
  const card = manager.getCurrentCard();
  if (!card) {
    containerTop.innerText = "ALL REVIEWED";
    containerBottom.innerText = "今日卡片已全數複習！\n[雙擊鏡腳: 切換模式]";
    return;
  }

  // Tier 1: 目標核心單字放大置中
  const phoneticText = card.phonetic ? `\n[${card.phonetic}]` : '';
  containerTop.innerText = `${card.word.toUpperCase()}${phoneticText}`;

  // Tier 2 & Tier 3: 依翻面狀態切換顯示與手勢提示
  if (!manager.isFlipped) {
    containerBottom.innerText = `[點擊鏡腳: 翻面看解釋]\n進度: ${manager.currentIndex + 1}/${manager.currentDeck.length}`;
  } else {
    const meaning = card.translation || card.meaning || '';
    const example = card.example ? `\n"${card.example}"` : '';
    containerBottom.innerText = `${meaning}${example}\n[↑掌握  ↓生疏]`;
  }
}
