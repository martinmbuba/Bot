# TODO: Fix Money Loader Bot Issues

## Steps to Complete:

- [ ] Update backend/server.js: Wrap server startup in async function to await connectToDeriv() before app.listen().
- [ ] Update backend/server.js: In WS on("message") authorize handler, auto-subscribe to ticks after setting authorized=true and tickSubscribed=true.
- [ ] Update backend/server.js: For /api/history, implement async waiting for WS response using a Map for pending requests; send get_account_statement with req_id, resolve Promise in WS handler for msg_type "statement", return data.statement.history.
- [ ] Update backend/server.js: Remove duplicate /ticks endpoint (keep /api/ticks only).
- [ ] Update backend/server.js: Add logging for statement responses in WS handler.
- [ ] Update frontend/app.js: Add retry logic (up to 3 attempts with 1s delay) to fetchBalance, fetchTicks, fetchHistory if 400 error.
- [ ] Update frontend/app.js: In connectBtn handler, after success, call fetchBalance(), fetchTicks(), fetchHistory() immediately.
- [ ] Restart backend server: Execute `pkill -f "node server.js" && cd backend && npm start`.
- [ ] Test: Use browser_action to launch http://localhost:3001, verify no errors, data loads, buttons work; close browser.
