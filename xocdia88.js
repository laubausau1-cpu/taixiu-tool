// xocdia88.js — Ensemble AI Prediction Engine (47 patterns + NN + Adaptive Learning)
// Chạy: node xocdia88.js [ws_url]

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ==================== CONFIG ====================
const WS_URL = process.env.WS_URL || process.argv[2] || 'wss://taixiumd5.system32-cloudfare-356783752985678522.monster/signalr/connect?transport=webSockets&connectionToken=z0%2Bp4sHHXusB7hFR4ZBSkc7TBejGa%2BoooswT8oNe8KhHmsJEIWLTtZh40jp%2FuaCUuwj1vJOAqw%2Fc1EBSv7ebeZGlhgS2FeQ1GNBYU%2F5AVausPA4HmHluu0RJW1Pwcy9H&connectionData=%5B%7B%22name%22%3A%22md5luckydiceHub%22%7D%5D&tid=1';
const HUB_NAME = 'md5luckydiceHub';
const DATA_DIR = path.join(__dirname, 'data');
const API_PORT = parseInt(process.env.PORT || '8888');
const SAVE_MS = 300000;
const MAX_HISTORY = 2000;
const MIN_SESSIONS = 6;

// ==================== UTILS ====================
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function relu(x) { return Math.max(0, x); }
function softmax(arr) { const max = Math.max(...arr); const exp = arr.map(v => Math.exp(v - max)); const sum = exp.reduce((a, b) => a + b, 0); return exp.map(v => v / sum); }

function log(level, msg) {
    const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
    console.log(line);
    try { fs.appendFileSync(path.join(DATA_DIR, 'log.txt'), line + '\n'); } catch (_) {}
}

class CircularBuffer {
    constructor(cap) { this.buf = []; this.cap = cap; }
    push(v) { this.buf.push(v); if (this.buf.length > this.cap) this.buf.shift(); }
    last(n) { return this.buf.slice(-n); }
    get length() { return this.buf.length; }
    get(i) { return i < 0 ? this.buf[this.buf.length + i] : this.buf[i]; }
}

// ==================== NEURAL NETWORK ====================
class NeuralNetwork {
    constructor() {
        this.W1 = this._xavier(10, 8);
        this.b1 = new Array(8).fill(0);
        this.W2 = this._xavier(8, 2);
        this.b2 = new Array(2).fill(0);
        this.lr = 0.001;
        this.momentum = 0.9;
        this.vW1 = this._zeros(10, 8);
        this.vb1 = new Array(8).fill(0);
        this.vW2 = this._zeros(8, 2);
        this.vb2 = new Array(2).fill(0);
    }

    _xavier(rows, cols) {
        const scale = Math.sqrt(2 / (rows + cols));
        return Array.from({ length: rows }, () => Array.from({ length: cols }, () => (Math.random() * 2 - 1) * scale));
    }

    _zeros(rows, cols) {
        return Array.from({ length: rows }, () => new Array(cols).fill(0));
    }

    forward(input) {
        this.z1 = new Array(8);
        this.a1 = new Array(8);
        for (let j = 0; j < 8; j++) {
            this.z1[j] = this.b1[j];
            for (let i = 0; i < 10; i++) this.z1[j] += this.W1[i][j] * input[i];
            this.a1[j] = relu(this.z1[j]);
        }
        this.z2 = new Array(2);
        for (let j = 0; j < 2; j++) {
            this.z2[j] = this.b2[j];
            for (let i = 0; i < 8; i++) this.z2[j] += this.W2[i][j] * this.a1[i];
        }
        this.a2 = softmax(this.z2);
        return { tai: this.a2[0], xiu: this.a2[1] };
    }

    train(input, target) {
        this.forward(input);
        const dz2 = [this.a2[0] - target[0], this.a2[1] - target[1]];
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 2; j++) {
                const grad = dz2[j] * this.a1[i];
                this.vW2[i][j] = this.momentum * this.vW2[i][j] - this.lr * grad;
                this.W2[i][j] += this.vW2[i][j];
            }
        }
        for (let j = 0; j < 2; j++) {
            this.vb2[j] = this.momentum * this.vb2[j] - this.lr * dz2[j];
            this.b2[j] += this.vb2[j];
        }
        const dz1 = new Array(8);
        for (let i = 0; i < 8; i++) {
            dz1[i] = 0;
            for (let j = 0; j < 2; j++) dz1[i] += dz2[j] * this.W2[i][j];
            dz1[i] *= this.z1[i] > 0 ? 1 : 0;
        }
        for (let i = 0; i < 10; i++) {
            for (let j = 0; j < 8; j++) {
                const grad = dz1[j] * input[i];
                this.vW1[i][j] = this.momentum * this.vW1[i][j] - this.lr * grad;
                this.W1[i][j] += this.vW1[i][j];
            }
        }
        for (let j = 0; j < 8; j++) {
            this.vb1[j] = this.momentum * this.vb1[j] - this.lr * dz1[j];
            this.b1[j] += this.vb1[j];
        }
    }

    save() { return { W1: this.W1, b1: this.b1, W2: this.W2, b2: this.b2, vW1: this.vW1, vb1: this.vb1, vW2: this.vW2, vb2: this.vb2 }; }
    load(data) {
        if (!data) return;
        this.W1 = data.W1; this.b1 = data.b1; this.W2 = data.W2; this.b2 = data.b2;
        this.vW1 = data.vW1; this.vb1 = data.vb1; this.vW2 = data.vW2; this.vb2 = data.vb2;
    }
}

// ==================== FEATURE EXTRACTION ====================
function extractFeatures(history, sessions) {
    const last20 = history.last(20);
    const len = last20.length;
    if (len === 0) return new Array(10).fill(0.5);

    const taiCount = last20.filter(x => x === 'T').length;
    const taiRatio5 = history.last(5).filter(x => x === 'T').length / Math.min(5, history.last(5).length || 1);
    const taiRatio10 = history.last(10).filter(x => x === 'T').length / Math.min(10, history.last(10).length || 1);
    const taiRatio20 = taiCount / len;

    const last = last20[len - 1];
    let streak = 0;
    for (let i = len - 1; i >= 0; i--) { if (last20[i] === last) streak++; else break; }
    const streakLen = streak / 10;

    const lastResult = last === 'T' ? 1 : 0;

    const now = Date.now();
    const lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;
    const timeSince = lastSession && lastSession.ts ? Math.min((now - lastSession.ts) / 60000, 10) / 10 : 0.5;

    const pT = taiCount / len;
    const pX = 1 - pT;
    const entropy = (pT === 0 || pX === 0) ? 0 : -(pT * Math.log2(pT) + pX * Math.log2(pX));

    let changes = 0;
    for (let i = 1; i < len; i++) { if (last20[i] !== last20[i - 1]) changes++; }
    const changeRate = changes / (len - 1 || 1);

    const imbalance = Math.abs(pT - 0.5) * 2;

    const x = last20.map((v, i) => v === 'T' ? 1 : 0);
    const n = len;
    const sumX = (n - 1) * n / 2;
    const sumY = x.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((s, v, i) => s + v * i, 0);
    const sumX2 = x.reduce((s, _, i) => s + i * i, 0);
    const trend = n * sumX2 - sumX * sumX !== 0 ? (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) : 0;
    const trendNorm = clamp(trend * 5 + 0.5, 0, 1);

    return [taiRatio5, taiRatio10, taiRatio20, streakLen, lastResult, timeSince, entropy, changeRate, imbalance, trendNorm];
}

// ==================== PREDICTION ENGINE ====================
class PredictionEngine {
    constructor() {
        this.history = new CircularBuffer(MAX_HISTORY);
        this.sessions = [];
        this.predictionLog = [];
        this.lastPrediction = null;
        this.lastSessionId = 0;
        this.nn = new NeuralNetwork();
        this.ensembleWeights = {};
        this.ensembleCorrect = {};
        this.ensembleTotal = {};
        this.boostStreak = {};
        this.stats = { total: 0, tai: 0, xiu: 0, correct: 0, wrong: 0, longestTai: 0, longestXiu: 0, curType: '', curStreak: 0 };
        this.MIN_S = MIN_SESSIONS;
        this._initPatterns();
        this._load();
    }

    _initPatterns() {
        const sl = (n) => this.history.last(n);
        const lst = (n) => this.history.get(-n);
        const cnt = (a, v) => a.filter(x => x === v).length;

        this.patterns = [
            { name: 'Bệt ngắn', check: () => { const h = sl(2); if (h.length < 2) return null; return h[0] === h[1] ? (h[0] === 'T') : null; }, weight: 0.5 },
            { name: 'Bệt dài', check: () => { const h = sl(6); if (h.length < 6) return null; const c = cnt(h, h[0]); return c >= 6 ? (h[0] === 'T') : null; }, weight: 0.85 },
            { name: 'Đảo 1-1 ngắn', check: () => { if (this.history.length < 3) return null; const a = lst(1), b = lst(2), c = lst(3); return a === c && a !== b ? (a === 'T') : null; }, weight: 0.72 },
            { name: 'Đảo 1-1 dài', check: () => { if (this.history.length < 5) return null; const a = lst(1), b = lst(2), c = lst(3), d = lst(4), e = lst(5); return a === c && c === e && b === d && a !== b ? (a === 'T') : null; }, weight: 0.78 },
            { name: 'Cầu 1-2', check: () => { const h = sl(3); if (h.length < 3) return null; if (h[0] === h[1] && h[1] !== h[2]) return h[2] === 'T'; return null; }, weight: 0.65 },
            { name: 'Cầu 2-1', check: () => { const h = sl(3); if (h.length < 3) return null; if (h[0] !== h[1] && h[1] === h[2]) return h[2] === 'T'; return null; }, weight: 0.65 },
            { name: 'Kép 2-2', check: () => { const h = sl(4); if (h.length < 4) return null; if (h[0] === h[1] && h[2] === h[3] && h[0] !== h[2]) return h[3] === 'T'; return null; }, weight: 0.75 },
            { name: 'Cầu 3-1', check: () => { const h = sl(4); if (h.length < 4) return null; if (h[0] === h[1] && h[1] === h[2] && h[2] !== h[3]) return h[3] !== 'T'; return null; }, weight: 0.68 },
            { name: 'Cầu 2-1-2', check: () => { const h = sl(5); if (h.length < 5) return null; if (h[0] === h[1] && h[1] !== h[2] && h[2] === h[3] && h[3] === h[4]) return h[4] !== 'T'; return null; }, weight: 0.70 },
            { name: 'Cầu thời gian nhanh', check: () => { const l = this.sessions.length; if (l < 2) return null; const dt = (this.sessions[l - 1].ts - this.sessions[l - 2].ts) / 1000; return dt < 15 ? (lst(1) !== 'T') : null; }, weight: 0.50 },
            { name: 'Cầu thời gian chậm', check: () => { const l = this.sessions.length; if (l < 2) return null; const dt = (this.sessions[l - 1].ts - this.sessions[l - 2].ts) / 1000; return dt > 45 ? (lst(1) === 'T') : null; }, weight: 0.50 },
            { name: 'Bệt siêu dài', check: () => { const h = sl(10); if (h.length < 10) return null; return cnt(h, h[0]) >= 10 ? (h[0] === 'T') : null; }, weight: 0.95 },
            { name: 'Bệt xen kẽ ngắn', check: () => { const h = sl(6); if (h.length < 6) return null; let s = 0; for (let i = h.length - 1; i >= 0; i--) { if (h[i] === h[h.length - 1]) s++; else break; } return s >= 3 ? (h[h.length - 1] !== 'T') : null; }, weight: 0.60 },
            { name: 'Bệt gãy nhẹ', check: () => { const h = sl(7); if (h.length < 7) return null; let s = 0; for (let i = h.length - 1; i >= 0; i--) { if (h[i] === h[h.length - 1]) s++; else break; } return s >= 4 ? (h[h.length - 1] !== 'T') : null; }, weight: 0.65 },
            { name: 'Đảo 1-1', check: () => { if (this.history.length < 4) return null; return lst(1) === lst(3) && lst(1) !== lst(2) ? (lst(1) !== 'T') : null; }, weight: 0.72 },
            { name: 'Kép 2-2 mở rộng', check: () => { const h = sl(4); if (h.length < 4) return null; if (h[0] === h[1] && h[2] === h[3] && h[0] !== h[2]) return h[3] !== 'T'; return null; }, weight: 0.75 },
            { name: '3-3', check: () => { const h = sl(6); if (h.length < 6) return null; if (h[0] === h[1] && h[1] === h[2] && h[3] === h[4] && h[4] === h[5] && h[0] !== h[3]) return h[5] !== 'T'; return null; }, weight: 0.78 },
            { name: 'Chu kỳ 2', check: () => { const h = sl(4); if (h.length < 4) return null; if (h[0] === h[2] && h[1] === h[3] && h[0] !== h[1]) return h[3] !== 'T'; return null; }, weight: 0.68 },
            { name: 'Chu kỳ 3', check: () => { const h = sl(6); if (h.length < 6) return null; if (h[0] === h[3] && h[1] === h[4] && h[2] === h[5] && h[0] !== h[1]) return h[5] !== 'T'; return null; }, weight: 0.65 },
            { name: 'Lặp 2-1', check: () => { const h = sl(2); if (h.length < 2) return null; return h[0] === 'T'; }, weight: 0.55 },
            { name: 'Lặp 3-2', check: () => { const h = sl(2); if (h.length < 2) return null; return h[0] === 'T'; }, weight: 0.55 },
            { name: 'Đối xứng', check: () => { const h = sl(5); if (h.length < 5) return null; const rev = [...h].reverse(); if (h.join('') === rev.join('')) return h[0] !== 'T'; return null; }, weight: 0.78 },
            { name: 'Bán đối xứng', check: () => { const h = sl(5); if (h.length < 5) return null; const rev = [...h].reverse(); let m = 0; for (let i = 0; i < 5; i++) if (h[i] === rev[i]) m++; return m >= 4 ? (h[2] !== 'T') : null; }, weight: 0.62 },
            { name: 'Bệt ngược', check: () => { const h = sl(6); if (h.length < 6) return null; const l = h[h.length - 1]; let s = 0; for (let i = h.length - 1; i >= 0; i--) { if (h[i] === l) s++; else break; } return s >= 6 ? (l !== 'T') : null; }, weight: 0.75 },
            { name: 'Xỉu kép', check: () => { const h = sl(2); if (h.length < 2) return null; return h[0] === 'X' && h[1] === 'X' ? false : null; }, weight: 0.55 },
            { name: 'Tài kép', check: () => { const h = sl(2); if (h.length < 2) return null; return h[0] === 'T' && h[1] === 'T' ? true : null; }, weight: 0.55 },
            { name: 'Xen kẽ', check: () => { const h = sl(7); if (h.length < 7) return null; for (let i = 1; i < 7; i++) if (h[i] === h[i - 1]) return null; return h[6] !== 'T'; }, weight: 0.72 },
            { name: 'Gập ghềnh', check: () => { const h = sl(10); if (h.length < 10) return null; return cnt(h, 'T') >= 6 ? false : null; }, weight: 0.55 },
            { name: 'Bậc thang', check: () => { const h = sl(5); if (h.length < 5) return null; for (let i = 1; i < 5; i++) if (h[i] === h[i - 1]) return null; return h[4] !== 'T'; }, weight: 0.60 },
            { name: 'Gãy ngang', check: () => { const h = sl(6); if (h.length < 6) return null; const l = h[h.length - 1]; let s = 0; for (let i = h.length - 1; i >= 0; i--) { if (h[i] === l) s++; else break; } return s >= 3 ? (l !== 'T') : null; }, weight: 0.62 },
            { name: 'Cầu đôi', check: () => { const h = sl(4); if (h.length < 4) return null; if (h[0] === h[1] && h[2] === h[3]) return h[3] !== 'T'; return null; }, weight: 0.68 },
            { name: 'Ngẫu nhiên', check: () => Math.random() > 0.5, weight: 0.50 },
            { name: 'Đa dạng', check: () => { const h = sl(10); if (h.length < 10) return null; return new Set(h).size >= 4 ? (h[h.length - 1] !== 'T') : null; }, weight: 0.58 },
            { name: 'Chu kỳ tăng', check: () => { const h = sl(6); if (h.length < 6) return null; let s = []; let c = 1; for (let i = h.length - 2; i >= 0; i--) { if (h[i] === h[i + 1]) c++; else { s.push(c); c = 1; } } s.push(c); for (let i = 1; i < s.length; i++) if (s[i] <= s[i - 1]) return null; return h[h.length - 1] !== 'T'; }, weight: 0.60 },
            { name: 'Chu kỳ giảm', check: () => { const h = sl(6); if (h.length < 6) return null; let s = []; let c = 1; for (let i = h.length - 2; i >= 0; i--) { if (h[i] === h[i + 1]) c++; else { s.push(c); c = 1; } } s.push(c); for (let i = 1; i < s.length; i++) if (s[i] >= s[i - 1]) return null; return h[h.length - 1] !== 'T'; }, weight: 0.60 },
            { name: 'Cầu lặp', check: () => { const h = sl(6); if (h.length < 6) return null; return h[0] === 'T'; }, weight: 0.55 },
            { name: 'Đối ngược', check: () => { const h = sl(4); if (h.length < 4) return null; return h[0] !== h[1] && h[1] === h[2] && h[2] !== h[3] ? (h[3] !== 'T') : null; }, weight: 0.65 },
            { name: 'Phân cụm', check: () => { const h = sl(10); if (h.length < 10) return null; return cnt(h, 'T') > 5 ? true : null; }, weight: 0.62 },
            { name: 'Lệch ngẫu nhiên', check: () => { const h = sl(10); if (h.length < 10) return null; const t = cnt(h, 'T'); return t >= 5 ? false : true; }, weight: 0.58 },
            { name: 'Xen kẽ dài', check: () => { const h = sl(8); if (h.length < 8) return null; for (let i = 1; i < 8; i++) if (h[i] === h[i - 1]) return null; return h[7] !== 'T'; }, weight: 0.72 },
            { name: 'Cầu gập', check: () => { const h = sl(6); if (h.length < 6) return null; const l = h[h.length - 1]; let s = 0; for (let i = h.length - 1; i >= 0; i--) { if (h[i] === l) s++; else break; } return s >= 4 ? (l !== 'T') : null; }, weight: 0.65 },
            { name: 'Xỉu lắc', check: () => { const h = sl(5); if (h.length < 5) return null; return h[h.length - 1] === 'X' && h[h.length - 2] === 'T' ? false : null; }, weight: 0.55 },
            { name: 'Tài lắc', check: () => { const h = sl(5); if (h.length < 5) return null; return h[h.length - 1] === 'T' && h[h.length - 2] === 'X' ? true : null; }, weight: 0.55 },
            { name: 'Phối hợp 1', check: () => { const h = sl(10); if (h.length < 10) return null; return cnt(h, 'T') > 5 ? true : null; }, weight: 0.55 },
            { name: 'Phối hợp 2', check: () => { const h = sl(20); if (h.length < 20) return null; const t = cnt(h, 'T'); return t >= (h.length - t); }, weight: 0.50 },
            { name: 'Phối hợp 3', check: () => { const h = sl(20); if (h.length < 20) return null; const t = cnt(h, 'T'); return t >= (h.length - t); }, weight: 0.50 },
            { name: 'Ngẫu nhiên bệt', check: () => { const h = sl(5); if (h.length < 5) return null; const l = h[h.length - 1]; let s = 0; for (let i = h.length - 1; i >= 0; i--) { if (h[i] === l) s++; else break; } return s >= 4 ? (l === 'T') : null; }, weight: 0.60 },
        ];
    }

    getStreak(count) {
        const arr = this.history.last(count);
        if (arr.length === 0) return { t: 0, x: 0 };
        let t = 0, x = 0;
        for (let i = arr.length - 1; i >= 0; i--) { if (arr[i] === 'T') t++; else break; }
        for (let i = arr.length - 1; i >= 0; i--) { if (arr[i] === 'X') x++; else break; }
        return { t, x };
    }

    _ensembleVote() {
        let votesT = 0, votesX = 0, totalWeight = 0;
        const details = [];

        for (const p of this.patterns) {
            const result = p.check();
            if (result === null) continue;

            const acc = this.ensembleTotal[p.name] > 0
                ? (this.ensembleCorrect[p.name] || 0) / this.ensembleTotal[p.name]
                : 0.5;
            const boost = clamp((this.boostStreak[p.name] || 0) * 0.05 + 1, 0.8, 1.2);
            const penalty = clamp(1 - ((this.ensembleTotal[p.name] - (this.ensembleCorrect[p.name] || 0)) || 0) * 0.02, 0.8, 1.2);
            const finalWeight = p.weight * acc * boost * penalty;

            const vote = result === true ? 'T' : 'X';
            if (result === true) votesT += finalWeight;
            else votesX += finalWeight;
            totalWeight += finalWeight;
            details.push({ name: p.name, vote, weight: finalWeight });
        }

        if (totalWeight === 0) return { prediction: 'X', confidence: 50, details: [] };

        const margin = Math.abs(votesT - votesX) / totalWeight;
        const prediction = votesT > votesX ? 'T' : 'X';
        const confidence = Math.round(margin * 100);

        return { prediction, confidence, details: details.sort((a, b) => b.weight - a.weight).slice(0, 10) };
    }

    predict(sessionData = {}) {
        // Dice table
        if (sessionData && sessionData.total && sessionData.total > 0) {
            const total = sessionData.total;
            if (total <= 4) { this.lastPrediction = 'X'; return { prediction: 'Xỉu', predictionRaw: 'X', confidence: 95, method: 'dice_table', reason: 'Tổng ' + total + ' (3-4) → Xỉu 95%' }; }
            if (total === 5) { const last = this.history.length > 0 ? this.history.get(-1) : 'X'; const pred = last === 'X' ? 'X' : 'T'; this.lastPrediction = pred; return { prediction: pred === 'T' ? 'Tài' : 'Xỉu', predictionRaw: pred, confidence: 55, method: 'dice_table', reason: 'Tổng 5 → 50/50' }; }
            if (total >= 6 && total <= 10) { const last = this.history.length > 0 ? this.history.get(-1) : 'X'; let pred = 'X'; let conf = 70; if (last === 'T') { const st = this.getStreak(3); if (st.t >= 2) { pred = 'T'; conf = 50; } } if (last === 'X') { pred = 'X'; conf = 75; } this.lastPrediction = pred; return { prediction: pred === 'T' ? 'Tài' : 'Xỉu', predictionRaw: pred, confidence: conf, method: 'dice_table', reason: 'Tổng ' + total + ' (6-10) → Xỉu ' + conf + '%' }; }
            if (total === 11) { const last = this.history.length > 0 ? this.history.get(-1) : 'T'; let pred = 'T'; let conf = 60; if (last === 'X') { const st = this.getStreak(3); if (st.x >= 2) { pred = 'X'; conf = 50; } } this.lastPrediction = pred; return { prediction: pred === 'T' ? 'Tài' : 'Xỉu', predictionRaw: pred, confidence: conf, method: 'dice_table', reason: 'Tổng 11 → Tài ' + conf + '%' }; }
            if (total >= 12 && total <= 14) { this.lastPrediction = 'T'; return { prediction: 'Tài', predictionRaw: 'T', confidence: 75, method: 'dice_table', reason: 'Tổng ' + total + ' (12-14) → Tài 75%' }; }
            if (total >= 15) { this.lastPrediction = 'T'; return { prediction: 'Tài', predictionRaw: 'T', confidence: 95, method: 'dice_table', reason: 'Tổng ' + total + ' (15-17) → Tài 95%' }; }
        }

        // Warmup: random 50/50 xen kẽ
        if (this.history.length < this.MIN_S) {
            const last = this.history.length > 0 ? this.history.get(-1) : null;
            let pred;
            if (last === 'T') pred = 'X';
            else if (last === 'X') pred = 'T';
            else pred = Math.random() < 0.5 ? 'T' : 'X';
            this.lastPrediction = pred;
            return { prediction: pred === 'T' ? 'Tài' : 'Xỉu', predictionRaw: pred, confidence: 50, method: 'warmup', reason: 'Khởi động ' + this.history.length + '/' + this.MIN_S };
        }

        const ensemble = this._ensembleVote();
        const features = extractFeatures(this.history, this.sessions);
        const nnOut = this.nn.forward(features);
        let nnPred;
        if (nnOut.tai > nnOut.xiu) nnPred = 'T';
        else if (nnOut.xiu > nnOut.tai) nnPred = 'X';
        else nnPred = Math.random() < 0.5 ? 'T' : 'X';
        const nnConf = Math.round(Math.max(nnOut.tai, nnOut.xiu) * 100);

        if (ensemble.confidence > 72) {
            this.lastPrediction = ensemble.prediction;
            return { prediction: ensemble.prediction === 'T' ? 'Tài' : 'Xỉu', predictionRaw: ensemble.prediction, confidence: ensemble.confidence, method: 'strong_ensemble', reason: ensemble.details[0]?.name || 'Ensemble', details: ensemble.details };
        }

        if (ensemble.confidence > 55) {
            let combinedPred;
            if (ensemble.confidence * 0.6 > nnConf * 0.4) combinedPred = ensemble.prediction;
            else if (nnConf * 0.4 > ensemble.confidence * 0.6) combinedPred = nnPred;
            else combinedPred = Math.random() < 0.5 ? 'T' : 'X';
            const combinedConf = Math.round(ensemble.confidence * 0.6 + nnConf * 0.4);
            this.lastPrediction = combinedPred;
            return { prediction: combinedPred === 'T' ? 'Tài' : 'Xỉu', predictionRaw: combinedPred, confidence: combinedConf, method: 'medium_hybrid', reason: 'Hybrid: ' + (ensemble.details[0]?.name || 'Ensemble') + ' + NN' };
        }

        this.lastPrediction = nnPred;
        return { prediction: nnPred === 'T' ? 'Tài' : 'Xỉu', predictionRaw: nnPred, confidence: nnConf, method: 'nn_fallback', reason: 'Neural Network' };
    }

    addResult(resultInput, sessionData = {}) {
        const n = String(resultInput).toLowerCase().trim();
        let actual = null;
        if (n === 'tài' || n === 'tai' || n === 't' || n === '1') actual = 'T';
        else if (n === 'xỉu' || n === 'xiu' || n === 'x' || n === '0') actual = 'X';
        else if (n.includes('tài') || n.includes('tai')) actual = 'T';
        else if (n.includes('xỉu') || n.includes('xiu')) actual = 'X';
        else return null;

        const sid = sessionData.sessionId || sessionData.id || 0;
        const total = sessionData.total || 0;
        const dice = sessionData.dice || '?-?-?';

        if (this.lastPrediction) {
            const correct = this.lastPrediction === actual;
            if (correct) this.stats.correct++;
            else this.stats.wrong++;

            const lastLog = this.predictionLog[this.predictionLog.length - 1];
            if (lastLog && !lastLog.danh_gia) {
                lastLog.xuc_xac = dice;
                lastLog.tong = total;
                lastLog.ket_qua = actual === 'T' ? 'Tài' : 'Xỉu';
                lastLog.danh_gia = correct ? '✅ ĐÚNG' : '❌ SAI';

                if (lastLog.details) {
                    for (const d of lastLog.details) {
                        if (!this.ensembleTotal[d.name]) this.ensembleTotal[d.name] = 0;
                        if (!this.ensembleCorrect[d.name]) this.ensembleCorrect[d.name] = 0;
                        this.ensembleTotal[d.name]++;
                        if ((d.vote === 'T' && actual === 'T') || (d.vote === 'X' && actual === 'X')) {
                            this.ensembleCorrect[d.name]++;
                            this.boostStreak[d.name] = (this.boostStreak[d.name] || 0) + 1;
                        } else {
                            this.boostStreak[d.name] = (this.boostStreak[d.name] || 0) - 1;
                        }
                    }
                }
            }
        }

        if (this.stats.curType === actual) this.stats.curStreak++;
        else { this.stats.curType = actual; this.stats.curStreak = 1; }
        if (actual === 'T') { this.stats.tai++; if (this.stats.curStreak > this.stats.longestTai) this.stats.longestTai = this.stats.curStreak; }
        else { this.stats.xiu++; if (this.stats.curStreak > this.stats.longestXiu) this.stats.longestXiu = this.stats.curStreak; }
        this.stats.total++;

        this.history.push(actual);
        this.sessions.push({ ts: Date.now(), sid, result: actual, total, dice });

        if (this.history.length >= 2) {
            const features = extractFeatures(this.history, this.sessions);
            const target = actual === 'T' ? [1, 0] : [0, 1];
            this.nn.train(features, target);
        }

        if (this.stats.total % 50 === 0) this._save();
        return actual;
    }

    logPrediction(sid, prediction) {
        const entry = {
            phien: String(sid),
            xuc_xac: '?-?-?',
            tong: 0,
            ket_qua: '',
            du_doan: prediction.prediction,
            danh_gia: '',
            do_tin_cay: prediction.confidence + '%',
            timestamp: new Date().toISOString(),
            reason: prediction.reason,
            method: prediction.method,
            details: prediction.details || []
        };
        this.predictionLog.push(entry);
        if (this.predictionLog.length > 10000) this.predictionLog.shift();
        return entry;
    }

    _save() {
        try {
            const data = {
                history: this.history.buf.slice(-1000),
                sessions: this.sessions.slice(-1000),
                stats: this.stats,
                ensembleTotal: this.ensembleTotal,
                ensembleCorrect: this.ensembleCorrect,
                boostStreak: this.boostStreak,
                nn: this.nn.save(),
                predictionLog: this.predictionLog.slice(-5000)
            };
            fs.writeFileSync(path.join(DATA_DIR, 'state.json'), JSON.stringify(data));
        } catch (_) {}
    }

    _load() {
        try {
            const file = path.join(DATA_DIR, 'state.json');
            if (fs.existsSync(file)) {
                const data = JSON.parse(fs.readFileSync(file, 'utf8'));
                if (data.history) { this.history = new CircularBuffer(MAX_HISTORY); data.history.forEach(v => this.history.push(v)); }
                if (data.sessions) this.sessions = data.sessions;
                if (data.stats) this.stats = data.stats;
                if (data.ensembleTotal) this.ensembleTotal = data.ensembleTotal;
                if (data.ensembleCorrect) this.ensembleCorrect = data.ensembleCorrect;
                if (data.boostStreak) this.boostStreak = data.boostStreak;
                if (data.nn) this.nn.load(data.nn);
                if (data.predictionLog) this.predictionLog = data.predictionLog;
            }
        } catch (_) {}
    }

    getAccuracy() {
        const t = this.stats.correct + this.stats.wrong;
        return t === 0 ? 0 : Math.round(this.stats.correct / t * 100);
    }

    getPredictionLog(limit = 50) {
        return this.predictionLog.slice(-limit).reverse();
    }
}

// ==================== MAIN ====================
const engine = new PredictionEngine();

function connectWebSocket() {
    if (!WS_URL) { log('ERROR', 'WS_URL not set'); return; }
    log('WS', 'Connecting...');
    const ws = new WebSocket(WS_URL);

    ws.on('open', () => {
        log('WS', 'Connected');
        ws.send(JSON.stringify({ H: HUB_NAME, M: 'Register', A: [], I: 0 }));
        setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ H: HUB_NAME, M: 'Ping', A: [], I: Date.now() })); }, 60000);
    });

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            if (!msg.M) return;
            for (const m of msg.M) {
                if (m.M === 'Md5sessionInfo') {
                    const s = m.A[0];
                    if (s.CurrentState === 0 && s.Ellapsed > 0) {
                        process.stdout.write(`\r⏳ ${s.Ellapsed}s | 🎯 ${engine.getAccuracy()}% | 📊 ${engine.stats.total} phiên   `);
                    }
                    if (s.CurrentState === 1 && s.Result && s.Result.Dice1 > 0 && s.SessionID !== engine.lastSessionId) {
                        engine.lastSessionId = s.SessionID;
                        const d1 = s.Result.Dice1, d2 = s.Result.Dice2, d3 = s.Result.Dice3;
                        const total = d1 + d2 + d3;
                        const result = total >= 11 ? 'Tài' : 'Xỉu';
                        engine.addResult(result, { sessionId: s.SessionID, total, dice: `${d1}-${d2}-${d3}` });
                        const prediction = engine.predict({ total, sessionId: s.SessionID + 1 });
                        engine.logPrediction(s.SessionID + 1, prediction);
                        console.log(`\n┌──────────────────────────────────────────┐`);
                        console.log(`│ #${s.SessionID} | 🎲[${d1},${d2},${d3}]=${total} | ${result}`);
                        console.log(`│ 🎯 ${engine.getAccuracy()}% | 📊 ${engine.stats.total}`);
                        console.log(`├──────────────────────────────────────────┤`);
                        console.log(`│ 🔮 DỰ ĐOÁN: ${prediction.prediction} (${prediction.confidence}%)`);
                        console.log(`│ 💡 ${prediction.reason}`);
                        console.log(`│ 📜 ${engine.history.last(15).map(x => x === 'T' ? 'T' : 'X').join(' ')}`);
                        console.log(`└──────────────────────────────────────────┘\n`);
                    }
                }
            }
        } catch (_) {}
    });

    ws.on('close', () => { log('WS', 'Disconnected, retry in 5s...'); setTimeout(connectWebSocket, 5000); });
    ws.on('error', (e) => { log('WS', 'Error: ' + e.message); ws.close(); });
}

// ==================== API SERVER ====================
const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const url = new URL(req.url, `http://localhost:${API_PORT}`);

    if (url.pathname === '/health') {
        res.end(JSON.stringify({ status: 'ok', version: 'v8-ensemble', patterns: 47, sessions: engine.stats.total, accuracy: engine.getAccuracy() }));
    } else if (url.pathname === '/api/predict') {
        const p = engine.predict({});
        res.end(JSON.stringify({ prediction: p.prediction, confidence: p.confidence, reason: p.reason, method: p.method }));
    } else if (url.pathname === '/api/stats') {
        res.end(JSON.stringify({ sessions: engine.stats.total, correct: engine.stats.correct, wrong: engine.stats.wrong, accuracy: engine.getAccuracy() }));
    } else if (url.pathname === '/api/prediction_log') {
        res.end(JSON.stringify(engine.getPredictionLog(parseInt(url.searchParams.get('limit') || '50'))));
    } else if (url.pathname === '/api/reset') {
        engine.stats.correct = 0; engine.stats.wrong = 0;
        res.end(JSON.stringify({ status: 'ok' }));
    } else {
        res.end(JSON.stringify({ name: 'XocDia88 Ensemble', version: 'v8', patterns: 47, accuracy: engine.getAccuracy() }));
    }
});

ensureDir();
server.listen(API_PORT, () => console.log(`API: http://localhost:${API_PORT}`));

console.log('╔══════════════════════════════════╗');
console.log('║  XOCDIA88 ENSEMBLE AI v8        ║');
console.log('║  47 Patterns + NN + Dice Table  ║');
console.log('╚══════════════════════════════════╝');

connectWebSocket();

process.on('SIGINT', () => { engine._save(); process.exit(0); });
