#!/bin/sh
# Runs the House Ledger tests with macOS's built-in JavaScriptCore (no Node needed).
# On Linux or with Node installed: node tests/run-node.js
cd "$(dirname "$0")/.." || exit 1
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
exec "$JSC" src/Config.gs src/Util.gs src/Parser.gs src/Ledger.gs src/Capture.gs src/Telegram.gs src/Close.gs src/Main.gs \
  tests/mocks.js tests/samples.js tests/tests.js
