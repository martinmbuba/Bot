// backend/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const WebSocket = require("ws");

const path = require('path');
const app = express();
app.use(cors());
app.use(express.json());

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});
const PORT = process.env.PORT || 3001;

let ws = null;
let connected = false;
let authorized = false;
let recentTicks = [];
let tickSubscribed = false;
let reconnectAttempts = 0;
const MAX_RECONNECTS = 5;
let cachedBalance = null;
let cachedCurrency = null;
let pendingRequests = new Map(); // For tracking async WS responses

// Connect to Deriv API
async function connectToDeriv() {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log("Already connected");
      return resolve();
    }

    const app_id = process.env.DERIV_APP_ID || 1089; // test app_id
    const token = process.env.DERIV_TOKEN;

    if (!token) {
      return reject(new Error("Missing DERIV_TOKEN in .env"));
    }

    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${app_id}`);

    ws.on("open", () => {
      console.log("✅ WebSocket opened, sending authorize...");
      connected = true;
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ authorize: token }));
        } else {
          console.error("WebSocket not open yet, retrying in 500ms...");
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ authorize: token }));
            }
          }, 500);
        }
      }, 100);
    });

    ws.on("message", (msg) => {
      const data = JSON.parse(msg);
      console.log("📩 WS message:", data);

      if (data.error) {
        console.error("❌ API error:", data.error);
        authorized = false;
        return reject(new Error(data.error.message));
      }

      if (data.msg_type === "authorize") {
        authorized = true;
        console.log("🎉 Authorized as:", data.authorize.loginid);
        cachedBalance = data.authorize.balance;
        cachedCurrency = data.authorize.currency;
        // Auto-subscribe to ticks after authorization
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ ticks: "R_100", subscribe: 1 }));
          tickSubscribed = true;
          console.log("📡 Auto-subscribed to R_100 ticks");
        }
        return resolve();
      }

      if (data.msg_type === "tick" && data.tick.symbol === "R_100") {
        recentTicks.push(data.tick);
        if (recentTicks.length > 50) { // Keep last 50 to avoid memory issues
          recentTicks.shift();
        }
        console.log("📊 New tick for R_100:", data.tick.quote);
      }

      if (data.msg_type === "statement") {
        console.log("📄 Statement response received");
        const reqId = data.req_id;
        if (pendingRequests.has(reqId)) {
          const { resolve, reject } = pendingRequests.get(reqId);
          pendingRequests.delete(reqId);
          if (data.error) {
            reject(new Error(`API Error: ${data.error.message}`));
          } else {
            resolve(data.statement);
          }
        }
      }
    });

    ws.on("error", (err) => {
      console.error("WS error:", err.message);
      connected = false;
      authorized = false;
      return reject(err);
    });

    ws.on("close", () => {
      console.log("⚠️ WebSocket closed");
      connected = false;
      authorized = false;
      if (reconnectAttempts < MAX_RECONNECTS) {
        console.log(`🔄 Reconnecting... (attempt ${reconnectAttempts + 1})`);
        reconnectAttempts++;
        setTimeout(() => connectToDeriv().catch(err => console.error("Reconnect failed:", err)), 2000 * reconnectAttempts);
      }
    });
  });
}

// Serve frontend at root
app.get('/', (req, res) => {
  const fs = require('fs');
  const pathToIndex = path.join(__dirname, '../frontend/index.html');
  try {
    const html = fs.readFileSync(pathToIndex, 'utf8');
    console.log('Serving index.html successfully');
    res.send(html);
  } catch (err) {
    console.error('Error reading index.html:', err);
    res.status(500).send('Error loading page');
  }
});

// Serve frontend explicitly
app.get('/index.html', (req, res) => {
  const fs = require('fs');
  const pathToIndex = path.join(__dirname, '../frontend/index.html');
  try {
    const html = fs.readFileSync(pathToIndex, 'utf8');
    console.log('Serving index.html successfully');
    res.send(html);
  } catch (err) {
    console.error('Error reading index.html:', err);
    res.status(500).send('Error loading page');
  }
});

// API routes
app.get("/api/", (req, res) => {
  res.send("Deriv bot backend running ✅");
});

app.get("/api/ticks", (req, res) => {
  if (!authorized || !ws || ws.readyState !== WebSocket.OPEN) {
    return res.status(400).json({ error: "Not connected/authorized" });
  }

  if (!tickSubscribed) {
    ws.send(JSON.stringify({ ticks: "R_100", subscribe: 1 }));
    tickSubscribed = true;
    console.log("📡 Subscribed to R_100 ticks");
  }

  const lastTicks = recentTicks.slice(-10).map(tick => ({
    epoch: tick.epoch,
    quote: tick.quote,
    symbol: tick.symbol
  }));

  res.json({ ok: true, ticks: lastTicks, total: recentTicks.length });
});

// History endpoint (recent account statement for last hour)
app.get("/api/history", async (req, res) => {
  if (!authorized || !ws || ws.readyState !== WebSocket.OPEN) {
    return res.status(400).json({ error: "Not connected/authorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  const from = now - 3600; // Last hour
  const to = now;

  const payload = {
    statement: 1,
    granularity: 60,
    from: from,
    to: to,
    description: "Last hour transactions"
  };
  const reqId = Date.now();

  // Create a promise for the async response
  const statementPromise = new Promise((resolve, reject) => {
    pendingRequests.set(reqId, { resolve, reject });
    // Timeout after 10 seconds
    setTimeout(() => {
      if (pendingRequests.has(reqId)) {
        pendingRequests.delete(reqId);
        reject(new Error("Statement request timeout"));
      }
    }, 10000);
  });

  ws.send(JSON.stringify({ ...payload, req_id: reqId }));

  try {
    const statement = await statementPromise;
    const history = statement.transactions || [];
    res.json({ ok: true, history });
  } catch (err) {
    console.error("Statement error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to fetch history" });
  }
});

// Predict endpoint
app.get("/api/predict", (req, res) => {
  if (recentTicks.length < 5) {
    return res.status(400).json({ error: "Not enough ticks for prediction (need at least 5)" });
  }

  const last5 = recentTicks.slice(-5);
  const deltas = [];
  for (let i = 1; i < last5.length; i++) {
    const delta = last5[i].quote - last5[i-1].quote;
    deltas.push(delta);
  }

  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const prediction = avgDelta > 0 ? "CALL" : "PUT";
  const confidence = Math.abs(avgDelta) * 100; // Simple scaling

  res.json({
    ok: true,
    prediction,
    avg_delta: avgDelta,
    confidence,
    last_tick: recentTicks[recentTicks.length - 1].quote
  });
});

// Connect endpoint
app.post("/api/connect", async (req, res) => {
  reconnectAttempts = 0; // Reset on manual connect
  try {
    await connectToDeriv();
    res.json({ ok: true, connected, authorized });
  } catch (err) {
    res.json({ ok: false, error: err.message, connected, authorized });
  }
});

// Fetch balance from cache
app.get("/api/status", (req, res) => {
  res.json({ connected, authorized });
});

app.get("/api/balance", (req, res) => {
  if (!authorized) {
    return res.status(400).json({ error: "Not authorized" });
  }
  if (cachedBalance === null) {
    return res.status(400).json({ error: "Balance not available yet, try connecting first" });
  }
  res.json({ ok: true, balance: cachedBalance, currency: cachedCurrency });
});

// Buy endpoint - accepts direction (CALL/PUT) from request body
app.post("/api/buy", (req, res) => {
  if (!authorized || !ws || ws.readyState !== WebSocket.OPEN) {
    return res.status(400).json({ error: "Not connected/authorized" });
  }

  const { direction = "CALL" } = req.body; // Default to CALL if not provided
  const contractType = direction.toUpperCase();

  if (!["CALL", "PUT"].includes(contractType)) {
    return res.status(400).json({ error: "Direction must be CALL or PUT" });
  }

  // ⚠️ This is just an example — replace with your real contract parameters
  const buyPayload = {
    buy: 1,
    parameters: {
      amount: 10,
      basis: "stake",
      contract_type: contractType,
      currency: "USD",
      duration: 1,
      duration_unit: "m",
      symbol: "R_100",
    },
  };

  ws.send(JSON.stringify(buyPayload));
  res.json({ ok: true, message: `Buy ${contractType} request sent`, buyPayload });
});

// Serve static files (frontend) after API routes
app.use(express.static(path.join(__dirname, '../frontend')));

// Auto-connect on startup and start server
async function startServer() {
  try {
    await connectToDeriv();
    app.listen(PORT, () => {
      console.log(`🚀 Backend running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Initial connect failed:", err);
    // Still start server even if connect fails, so frontend can load and try manual connect
    app.listen(PORT, () => {
      console.log(`🚀 Backend running on http://localhost:${PORT} (connection failed, use manual connect)`);
    });
  }
}

startServer();
