#!/data/data/com.termux/files/usr/bin/bash
set -e

MSG=${1:-"update: auto-deploy from termux"}

echo "===== 1. 提交變更並同步至 GitHub ====="
git add .
if git diff-index --quiet HEAD --; then
  echo "本地無程式碼變更，跳過 Commit。"
else
  git commit -m "$MSG"
  git push origin main
  echo "GitHub 倉庫同步成功！"
fi

echo "===== 2. 編譯 Vite 前端專案 ====="
npm run build

echo "===== 3. 讀取版本號並打包 EHPK ====="
VERSION=$(grep '"version"' app.json | head -1 | sed -E 's/.*"version": "([^"]+)".*/\1/' | tr -d '.')
PKG_NAME="hud_555_v${VERSION}.ehpk"

npx evenhub pack app.json dist -o "$PKG_NAME"

echo "===== 4. 匯出安裝包至手機下載目錄 ====="
mkdir -p ~/storage/downloads
cp -f "$PKG_NAME" ~/storage/downloads/"$PKG_NAME"

echo "=========================================="
echo "發布完成！"
echo "GitHub: 已同步"
echo "安裝包: ~/storage/downloads/$PKG_NAME"
echo "請至 Even Hub 後台點選 Upload a build 上傳！"
echo "=========================================="
