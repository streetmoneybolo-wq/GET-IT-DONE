#!/bin/sh
# Start the StockMarketLoop Connect bot on Render.
# - Waits idle until BOT_ENABLED=1, so it never runs at the same time as another copy with the same token.
# - Keeps everything the bot saves (data/ and config/settings.json) on the persistent disk.
# - First start: downloads the data the bot had on the PC (scripts/render-seed.mjs), once.
set -e
cd "$(dirname "$0")/.."
DISK="${DATA_DISK:-/var/data}"

if [ "$BOT_ENABLED" != "1" ]; then
  echo "Connect bot is installed and waiting: set BOT_ENABLED=1 to start it."
  exec node -e "setInterval(() => {}, 1 << 30)"
fi

mkdir -p "$DISK"
if [ ! -f "$DISK/.seeded" ]; then
  node scripts/render-seed.mjs "$DISK"
fi
mkdir -p "$DISK/data"
rm -rf data
ln -s "$DISK/data" data
if [ -f "$DISK/settings.json" ]; then
  ln -sf "$DISK/settings.json" config/settings.json
fi
exec node index.js
