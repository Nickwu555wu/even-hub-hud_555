#!/data/data/com.termux/files/usr/bin/bash

set -e
cd "$(dirname "$0")"

PORT=5173
APP="even-hud-555"
VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo 1.1.2)"
OUT="${APP}-v${VERSION}.ehpk"

get_ip() {
  ip route get 1.1.1.1 2>/dev/null |
    awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1);exit}}'
}

case "${1:-start}" in
  build)
    echo "=== Building HUD ==="
    npm run build
    echo "=== Build complete ==="
    ;;

  pack)
    echo "=== Building HUD ==="
    npm run build
    echo "=== Packing EH​​PK ==="
    npx evenhub pack app.json dist -o "$OUT"
    echo "Output: $PWD/$OUT"
    ;;

  start|preview)
    echo "=== Starting Vite ==="
    if [ ! -d node_modules ]; then
      npm install
    fi

    if ! curl -fsS "http://127.0.0.1:$PORT" >/dev/null 2>&1; then
      nohup npm run dev -- --host 0.0.0.0 --port "$PORT" \
        > hud-vite.log 2>&1 &
      echo $! > .hud-vite.pid
    fi

    sleep 3

    IP="$(get_ip)"
    echo
    echo "=== Browser Preview ==="
    echo "Local: http://127.0.0.1:$PORT"
    echo "LAN:   http://${IP:-YOUR_TERMUX_IP}:$PORT"
    echo
    echo "=== Official Simulator ==="
    echo "On a desktop connected to the same Wi-Fi, run:"
    echo "npx -y @evenrealities/evenhub-simulator@0.9.5 http://${IP:-YOUR_TERMUX_IP}:$PORT"
    echo

    if command -v termux-open-url >/dev/null 2>&1; then
      termux-open-url "http://127.0.0.1:$PORT"
    fi
    ;;

  stop)
    if [ -f .hud-vite.pid ]; then
      kill "$(cat .hud-vite.pid)" 2>/dev/null || true
      rm -f .hud-vite.pid
    fi
    pkill -f "vite.*port $PORT" 2>/dev/null || true
    echo "Vite stopped."
    ;;

  *)
    echo "Usage: ./hud-dev.sh [start|build|pack|stop]"
    exit 1
    ;;
esac
