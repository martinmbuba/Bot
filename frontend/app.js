const API_BASE = 'https://bot-1-7ihp.onrender.com/api';

const statusEl = document.getElementById('status');
const connectBtn = document.getElementById('connectBtn');
const predictBtn = document.getElementById('predictBtn');
const buyBtn = document.getElementById('buyBtn');
const startAutoBuyBtn = document.getElementById('startAutoBuyBtn');
const stopAutoBuyBtn = document.getElementById('stopAutoBuyBtn');

const predictOutput = document.getElementById('predictOutput');

let autoBuyInterval = null;
let isAutoBuying = false;

// Helper to format data for display
function formatPredict(data) {
  if (data.ok) {
    return `Prediction: ${data.prediction} (avg delta: ${data.avg_delta.toFixed(4)}, confidence: ${data.confidence.toFixed(2)}, last tick: ${data.last_tick})`;
  } else {
    return `Error: ${data.error}`;
  }
}

let isConnected = false;

// Utility to update status
function updateStatus(msg, connected = false) {
  statusEl.textContent = `Status: ${msg}`;
  isConnected = connected;
  connectBtn.disabled = connected;
  predictBtn.disabled = !connected;
  buyBtn.disabled = !connected;
  startAutoBuyBtn.disabled = !connected || isAutoBuying;
  stopAutoBuyBtn.disabled = !isAutoBuying;
}

// Connect to Deriv
connectBtn.addEventListener('click', async () => {
  try {
    const res = await fetch(`${API_BASE}/connect`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      updateStatus('Connected and Authorized', true);
    } else {
      updateStatus(`Connection failed: ${data.error}`);
    }
  } catch (err) {
    updateStatus(`Error: ${err.message}`);
  }
});


// Get Prediction
predictBtn.addEventListener('click', async () => {
  try {
    const res = await fetch(`${API_BASE}/predict`);
    const data = await res.json();
    predictOutput.textContent = formatPredict(data);
  } catch (err) {
    predictOutput.textContent = `Error: ${err.message}`;
  }
});

// Buy based on prediction
buyBtn.addEventListener('click', async () => {
  try {
    // First get prediction
    const predictRes = await fetch(`${API_BASE}/predict`);
    const predictData = await predictRes.json();
    if (!predictData.ok) {
      alert(`Prediction failed: ${predictData.error}`);
      return;
    }

    const direction = predictData.prediction;
    const confirmMsg = `Buy ${direction} based on prediction (avg delta: ${predictData.avg_delta.toFixed(4)})?`;
    if (!confirm(confirmMsg)) return;

    const buyRes = await fetch(`${API_BASE}/buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction })
    });
    const buyData = await buyRes.json();
    alert(buyData.ok ? `Buy ${direction} sent!` : `Buy failed: ${buyData.error}`);
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
});

// Auto buy function (without confirmation)
async function autoBuy() {
  try {
    const predictRes = await fetch(`${API_BASE}/predict`);
    const predictData = await predictRes.json();
    if (!predictData.ok) {
      console.log('Prediction failed:', predictData.error);
      return;
    }

    const direction = predictData.prediction;
    const buyRes = await fetch(`${API_BASE}/buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction })
    });
    const buyData = await buyRes.json();
    console.log(buyData.ok ? `Auto buy ${direction} sent` : `Auto buy failed: ${buyData.error}`);
  } catch (err) {
    console.log('Auto buy error:', err.message);
  }
}

// Start auto buy
startAutoBuyBtn.addEventListener('click', () => {
  if (isAutoBuying) return;
  isAutoBuying = true;
  updateStatus(statusEl.textContent.replace('Status: ', ''), isConnected);
  autoBuyInterval = setInterval(autoBuy, 60000); // every 60 seconds
  console.log('Auto buy started');
});

// Stop auto buy
stopAutoBuyBtn.addEventListener('click', () => {
  if (!isAutoBuying) return;
  clearInterval(autoBuyInterval);
  autoBuyInterval = null;
  isAutoBuying = false;
  updateStatus(statusEl.textContent.replace('Status: ', ''), isConnected);
  console.log('Auto buy stopped');
});

// Check status on load
async function checkStatus() {
  try {
    const res = await fetch(`${API_BASE}/status`);
    const data = await res.json();
    if (data.authorized) {
      updateStatus('Connected and Authorized', true);
    } else {
      updateStatus('Disconnected');
    }
  } catch (err) {
    updateStatus('Error checking status');
  }
}

// Initial status
updateStatus('Disconnected');

// Check status on load
checkStatus();
