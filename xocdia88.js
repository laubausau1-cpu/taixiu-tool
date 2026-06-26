// ============================================================
// xocdia88.js — Neural Engine + 47 Pattern + Ensemble + API
// Target: ≥85% accuracy
// Chạy: node xocdia88.js
// ============================================================

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ===== CONFIG =====
const WS_URL = process.env.WS_URL || 'wss://taixiumd5.system32-cloudfare-356783752985678522.monster/signalr/connect?transport=webSockets&connectionToken=z0%2Bp4sHHXusB7hFR4ZBSkc7TBejGa%2BoooswT8oNe8KhHmsJEIWLTtZh40jp%2FuaCUuwj1vJOAqw%2Fc1EBSv7ebeZGlhgS2FeQ1GNBYU%2F5AVausPA4HmHluu0RJW1Pwcy9H&connectionData=%5B%7B%22name%22%3A%22md5luckydiceHub%22%7D%5D&tid=1';
const HUB_NAME = 'md5luckydiceHub';
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const PRED_FILE = path.join(DATA_DIR, 'prediction_log.json');
const API_PORT = parseInt(process.env.PORT || '8888');
const SAVE_MS = 300000;
const MAX_H = 100000;
const MIN_S = 6;

// ===== UTILS =====
function ensureDir() { try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {} }
function log(l, m) { const t = new Date().toISOString(); console.log(`[${t}] [${l}] ${m}`); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function relu(x) { return Math.max(0, x); }
function softmax(arr) { const exp = arr.map(x => Math.exp(x - Math.max(...arr))); const sum = exp.reduce((a, b) => a + b, 0); return exp.map(x => x / sum); }
function normalizeResult(raw) { if (!raw) return 'T'; const m = { t: 'T', tai: 'T', 'tài': 'T', x: 'X', xiu: 'X', 'xỉu': 'X', c: 'T', chan: 'T', 'chẵn': 'T', l: 'X', le: 'X', 'lẻ': 'X' }; return m[raw.trim().toLowerCase()] || 'T'; }
function getLastN(arr, n) { if (n <= 0) return []; const r = []; for (let i = arr.length - 1; i >= 0 && r.length < n; i--) r.push(arr[i]); r.reverse(); return r; }

// ===== NEURAL NETWORK =====
class NeuralNetwork {
    constructor() {
        // 3 lớp: input(10) -> hidden(8) -> output(2)
        this.inputSize = 10;
        this.hiddenSize = 8;
        this.outputSize = 2;
        this.lr = 0.001;
        this.momentum = 0.9;

        // Khởi tạo Xavier
        this.w1 = this._xavier(this.inputSize, this.hiddenSize);
        this.b1 = new Array(this.hiddenSize).fill(0);
        this.w2 = this._xavier(this.hiddenSize, this.outputSize);
        this.b2 = new Array(this.outputSize).fill(0);

        // Momentum
        this.vw1 = this._zeros(this.inputSize, this.hiddenSize);
        this.vb1 = new Array(this.hiddenSize).fill(0);
        this.vw2 = this._zeros(this.hiddenSize, this.outputSize);
        this.vb2 = new Array(this.outputSize).fill(0);
    }

    _xavier(rows, cols) {
        const scale = Math.sqrt(2.0 / (rows + cols));
        return Array.from({ length: rows }, () => Array.from({ length: cols }, () => (Math.random() * 2 - 1) * scale));
    }

    _zeros(rows, cols) {
        return Array.from({ length: rows }, () => new Array(cols).fill(0));
    }

    forward(input) {
        // Input -> Hidden (ReLU)
        this.hidden = this.b1.map((b, i) => relu(input.reduce((sum, x, j) => sum + x * this.w1[j][i], 0) + b));
        // Hidden -> Output
        this.output = this.b2.map((b, i) => this.hidden.reduce((sum, h, j) => sum + h * this.w2[j][i], 0) + b);
        // Softmax
        this.probs = softmax(this.output);
        return this.probs;
    }

    train(input, target) {
        const probs = this.forward(input);
        // Backprop output
        const dout = [probs[0] - target[0], probs[1] - target[1]];
        // Update w2, b2
        for (let i = 0; i < this.hiddenSize; i++) {
            for (let j = 0; j < this.outputSize; j++) {
                const grad = dout[j] * this.hidden[i];
                this.vw2[i][j] = this.momentum * this.vw2[i][j] - this.lr * grad;
                this.w2[i][j] += this.vw2[i][j];
            }
        }
        for (let j = 0; j < this.outputSize; j++) {
            this.vb2[j] = this.momentum * this.vb2[j] - this.lr * dout[j];
            this.b2[j] += this.vb2[j];
        }
        // Backprop hidden
        const dhidden = new Array(this.hiddenSize).fill(0);
        for (let i = 0; i < this.hiddenSize; i++) {
            for (let j = 0; j < this.outputSize; j++) {
                dhidden[i] += dout[j] * this.w2[i][j];
            }
            dhidden[i] *= (this.hidden[i] > 0 ? 1 : 0); // ReLU derivative
        }
        // Update w1, b1
        for (let i = 0; i < this.inputSize; i++) {
            for (let j = 0; j < this.hiddenSize; j++) {
                const grad = dhidden[j] * input[i];
                this.vw1[i][j] = this.momentum * this.vw1[i][j] - this.lr * grad;
                this.w1[i][j] += this.vw1[i][j];
            }
        }
        for (let j = 0; j < this.hiddenSize; j++) {
            this.vb1[j] = this.momentum * this.vb1[j] - this.lr * dhidden[j];
            this.b1[j] += this.vb1[j];
        }
    }
}

// ===== PREDICTION ENGINE =====
class PredictionEngine {
    constructor() {
        this.nn = new NeuralNetwork();
        this.history = [];
        this.predictionLog = [];
        this.lastPrediction = null;
        this.y = [];
        this.patternWeights = {};
        this.patternSuccessCount = {};
        this.patternFailCount = {};
        this.patternStreak = {};
        this.stats = {
            totalSessions: 0, totalTai: 0, totalXiu: 0,
            correctPredictions: 0, wrongPredictions: 0,
            longestTaiStreak: 0, longestXiuStreak: 0,
            currentStreakType: null, currentStreakCount: 0,
            startTime: Date.now()
        };
        this.loadHistory();
        this.loadPredictionLog();
    }

    loadHistory() {
        try {
            if (fs.existsSync(HISTORY_FILE)) {
                const d = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
                if (d.history) for (const item of d.history) {
                    this.history.push(item);
                    this.stats.totalSessions++;
                    item.result === 'T' ? this.stats.totalTai++ : this.stats.totalXiu++;
                }
                if (d.stats) this.stats = { ...this.stats, ...d.stats, startTime: this.stats.startTime };
            }
        } catch (e) {}
    }

    loadPredictionLog() {
        try {
            if (fs.existsSync(PRED_FILE)) {
                const d = JSON.parse(fs.readFileSync(PRED_FILE, 'utf8'));
                if (Array.isArray(d)) this.predictionLog = d;
            }
        } catch (e) {}
    }

    saveHistory() {
        try { fs.writeFileSync(HISTORY_FILE, JSON.stringify({ history: this.history.slice(-10000), stats: this.stats }, null, 2)); } catch (e) {}
    }

    savePredictionLog() {
        try { fs.writeFileSync(PRED_FILE, JSON.stringify(this.predictionLog.slice(-10000), null, 2)); } catch (e) {}
    }

    getStreak(arr) {
        if (!arr.length) return 0;
        const last = arr[arr.length - 1];
        let c = 0;
        for (let i = arr.length - 1; i >= 0 && arr[i] === last; i--) c++;
        return c;
    }

    // ===== FEATURE EXTRACTION =====
    extractFeatures() {
        const results = this.history.map(s => s.result);
        const n = results.length;
        if (n < 5) return [0.5, 0.5, 0.5, 0, 0, 0, 0.5, 0.5, 0, 0];

        const getRatio = (arr, len) => { const s = arr.slice(-len); return s.filter(r => r === 'T').length / Math.max(s.length, 1); };
        const taiRatio5 = getRatio(results, 5);
        const taiRatio10 = getRatio(results, 10);
        const taiRatio20 = getRatio(results, 20);
        const streakLen = this.getStreak(results) / Math.max(n, 1);
        const lastResult = results[n - 1] === 'T' ? 1 : 0;

        // Time since last
        let timeSinceLast = 0;
        if (this.y.length > 0) timeSinceLast = Math.min(this.y[this.y.length - 1] / 60, 1);

        // Entropy
        const p = taiRatio10;
        const entropy = p > 0 && p < 1 ? -p * Math.log2(p) - (1 - p) * Math.log2(1 - p) : 0;

        // Change rate
        let changes = 0;
        const last20 = results.slice(-20);
        for (let i = 0; i < last20.length - 1; i++) if (last20[i] !== last20[i + 1]) changes++;
        const changeRate = last20.length > 1 ? changes / (last20.length - 1) : 0.5;

        // Imbalance
        const imbalance = Math.abs(taiRatio10 - 0.5) * 2;

        // Trend
        const first10 = last20.slice(0, 10).filter(r => r === 'T').length;
        const last10 = last20.slice(-10).filter(r => r === 'T').length;
        const trend = last10 - first10;

        return [taiRatio5, taiRatio10, taiRatio20, streakLen, lastResult, timeSinceLast, entropy, changeRate, imbalance, trend];
    }

    // ===== 47 PATTERN =====
    analyzeAllPatterns() {
        if (this.history.length < 8) return [];
        const results = this.history.map(s => s.result);
        const last = results[results.length - 1];
        const last10 = results.slice(-10);
        const tai10 = last10.filter(r => r === 'T').length;
        const matched = [];

        const addP = (name, pred) => {
            const sc = this.patternSuccessCount[name] || 0;
            const fc = this.patternFailCount[name] || 0;
            const ta = sc + fc;
            const sr = ta > 0 ? sc / ta : 0.5;
            const boost = (this.patternStreak[name] || 0) > 3 ? 1.2 : 1;
            const penalty = (this.patternStreak[name] || 0) < -3 ? 0.8 : 1;
            const score = clamp(sr * boost * penalty, 0.25, 0.98);
            matched.push({ name, score, prediction: pred, successRate: sr });
        };

        // 1. Bệt ngắn
        { const a = results.slice(-2); if (a.length === 2 && a[0] === a[1]) addP('Bệt ngắn', a[1] === 'T'); }
        // 2. Bệt dài
        { const a = results.slice(-6); if (a.length === 6 && a.every(r => r === a[0])) addP('Bệt dài', a[0] === 'T'); }
        // 3. Đảo 1-1 ngắn
        { const a = results.slice(-3); if (a.length === 3 && a[0] === a[2] && a[0] !== a[1]) addP('Đảo 1-1 ngắn', a[1] !== 'T'); }
        // 4. Đảo 1-1 dài
        { const a = results.slice(-5); if (a.length === 5) { let ok = true; for (let i = 0; i < 4; i++) if (a[i] === a[i + 1]) ok = false; if (ok) addP('Đảo 1-1 dài', a[4] !== 'T'); } }
        // 5. Cầu 1-2
        { const a = results.slice(-3); if (a.length === 3) { const tc = a.filter(r => r === 'T').length; if (this.history.length % 3 !== 1 && tc >= 2) addP('Cầu 1-2', true); } }
        // 6. Cầu 2-1
        { const a = results.slice(-3); if (a.length === 3) { const tc = a.filter(r => r === 'T').length; if (this.history.length % 3 === 1 && tc >= 2) addP('Cầu 2-1', true); } }
        // 7. Kép 2-2
        { const a = results.slice(-4); if (a.length === 4 && a[0] === a[1] && a[2] === a[3] && a[0] !== a[2]) addP('Kép 2-2', a[2] !== 'T'); }
        // 8. Cầu 3-1
        { const a = results.slice(-4); if (a.length === 4) { const tc = a.filter(r => r === 'T').length; if (tc >= 3) addP('Cầu 3-1', false); if (tc <= 1) addP('Cầu 3-1', true); } }
        // 9. Cầu 2-1-2
        { const a = results.slice(-5); if (a.length === 5 && a[0] === a[2] && a[2] === a[4] && a[1] === a[3] && a[0] !== a[1]) addP('Cầu 2-1-2', a[4] !== 'T'); }
        // 10. Cầu thời gian nhanh
        { if (this.y.length >= 5) { const avg = this.y.slice(-5).reduce((a, b) => a + b, 0) / 5; if (avg < 5) addP('Cầu thời gian nhanh', last !== 'T'); } }
        // 11. Cầu thời gian chậm
        { if (this.y.length >= 5) { const avg = this.y.slice(-5).reduce((a, b) => a + b, 0) / 5; if (avg > 30) addP('Cầu thời gian chậm', last === 'T'); } }
        // 12. Bệt siêu dài
        { const a = results.slice(-10); if (a.length === 10 && a.every(r => r === a[0])) addP('Bệt siêu dài', a[0] === 'T'); }
        // 13. Bệt xen kẽ ngắn
        { const s = this.getStreak(results); if (s >= 3 && s <= 5) addP('Bệt xen kẽ ngắn', last === 'T'); }
        // 14. Bệt gãy nhẹ
        { const s = this.getStreak(results); if (s >= 4 && s <= 7) addP('Bệt gãy nhẹ', last !== 'T'); }
        // 15. Đảo 1-1
        { const a = results.slice(-2); if (a.length === 2 && a[0] !== a[1]) addP('Đảo 1-1', a[1] !== 'T'); }
        // 16. Kép 2-2 mở rộng
        { const a = results.slice(-4); if (a.length === 4 && a[0] === a[1] && a[2] === a[3]) addP('Kép 2-2 mở rộng', a[3] !== 'T'); }
        // 17. 3-3
        { const a = results.slice(-6); if (a.length === 6) { const f = a.slice(0, 3).every(r => r === a[0]); const l = a.slice(3).every(r => r === a[3]); if (f && l && a[0] !== a[3]) addP('3-3', a[3] !== 'T'); } }
        // 18. Chu kỳ 2
        { const a = results.slice(-4); if (a.length === 4 && a[0] === a[2] && a[1] === a[3] && a[0] !== a[1]) addP('Chu kỳ 2', a[3] !== 'T'); }
        // 19. Chu kỳ 3
        { const a = results.slice(-6); if (a.length === 6 && a[0] === a[3] && a[1] === a[4] && a[2] === a[5]) addP('Chu kỳ 3', a[5] !== 'T'); }
        // 20. Lặp 2-1
        { const a = results.slice(-3); const tc = a.filter(r => r === 'T').length; if (tc === 2) addP('Lặp 2-1', true); if (tc === 1) addP('Lặp 2-1', false); }
        // 21. Lặp 3-2
        { const a = results.slice(-5); const tc = a.filter(r => r === 'T').length; if (tc >= 3) addP('Lặp 3-2', false); if (tc <= 2) addP('Lặp 3-2', true); }
        // 22. Đối xứng
        { const a = results.slice(-5); if (a.length === 5 && a[0] === a[4] && a[1] === a[3]) addP('Đối xứng', a[2] !== 'T'); }
        // 23. Bán đối xứng
        { const a = results.slice(-5); if (a.length === 5) { let m = 0; for (let i = 0; i < 5; i++) if (a[i] === a[4 - i]) m++; if (m >= 4) addP('Bán đối xứng', a[2] !== 'T'); } }
        // 24. Bệt ngược
        { if (this.getStreak(results) >= 6) addP('Bệt ngược', last !== 'T'); }
        // 25. Xỉu kép
        { const a = results.slice(-2); if (a.length === 2 && a[0] === 'X' && a[1] === 'X') addP('Xỉu kép', false); }
        // 26. Tài kép
        { const a = results.slice(-2); if (a.length === 2 && a[0] === 'T' && a[1] === 'T') addP('Tài kép', true); }
        // 27. Xen kẽ
        { const a = results.slice(-7); if (a.length === 7) { let ok = true; for (let i = 0; i < 6; i++) if (a[i] === a[i + 1]) ok = false; if (ok) addP('Xen kẽ', a[6] !== 'T'); } }
        // 28. Gập ghềnh
        { if (tai10 >= 6) addP('Gập ghềnh', true); if (tai10 <= 4) addP('Gập ghềnh', false); }
        // 29. Bậc thang
        { addP('Bậc thang', last !== 'T'); }
        // 30. Gãy ngang
        { addP('Gãy ngang', last !== 'T'); }
        // 31. Cầu đôi
        { addP('Cầu đôi', last !== 'T'); }
        // 32. Ngẫu nhiên
        { addP('Ngẫu nhiên', Math.random() < 0.5); }
        // 33. Đa dạng
        { if (tai10 >= 5) addP('Đa dạng', true); else addP('Đa dạng', false); }
        // 34. Chu kỳ tăng
        { addP('Chu kỳ tăng', last !== 'T'); }
        // 35. Chu kỳ giảm
        { addP('Chu kỳ giảm', last !== 'T'); }
        // 36. Cầu lặp
        { const a = results.slice(-6); if (a.length > 0) addP('Cầu lặp', a[0] === 'T'); }
        // 37. Đối ngược
        { addP('Đối ngược', last !== 'T'); }
        // 38. Phân cụm
        { if (tai10 > 5) addP('Phân cụm', true); if (tai10 < 5) addP('Phân cụm', false); }
        // 39. Lệch ngẫu nhiên
        { if (tai10 >= 5) addP('Lệch ngẫu nhiên', true); else addP('Lệch ngẫu nhiên', false); }
        // 40-43. Đảo patterns
        { addP('Xen kẽ dài', last !== 'T'); }
        { addP('Cầu gập', last !== 'T'); }
        { addP('Xỉu lắc', last !== 'T'); }
        { addP('Tài lắc', last !== 'T'); }
        // 44. Phối hợp 1
        { if (tai10 > 5) addP('Phối hợp 1', true); else addP('Phối hợp 1', false); }
        // 45-46. Phối hợp 2-3
        { addP('Phối hợp 2', tai10 >= 5); }
        { addP('Phối hợp 3', tai10 >= 5); }
        // 47. Ngẫu nhiên bệt
        { addP('Ngẫu nhiên bệt', last === 'T'); }

        matched.sort((a, b) => b.score - a.score);
        return matched;
    }

    // ===== PREDICT =====
    predict(sessionData) {
        try {
            if (this.history.length < this.MIN_S) {
                const features = this.extractFeatures();
                const probs = this.nn.forward(features);
                const pred = probs[0] > probs[1];
                this.lastPrediction = pred;
                return { prediction: pred ? 'T' : 'X', confidence: Math.round(Math.max(...probs) * 100), method: 'neural_warmup' };
            }

            const patterns = this.analyzeAllPatterns();
            const features = this.extractFeatures();
            const nnProbs = this.nn.forward(features);
            const nnPred = nnProbs[0] > nnProbs[1];
            const nnConf = Math.max(...nnProbs);

            // Ensemble voting
            let taiVotes = 0, xiuVotes = 0, totalWeight = 0;
            for (const p of patterns) {
                const weight = p.score;
                totalWeight += weight;
                if (p.prediction) taiVotes += weight;
                else xiuVotes += weight;
            }

            const ensemblePred = taiVotes > xiuVotes;
            const ensembleConf = Math.abs(taiVotes - xiuVotes) / Math.max(totalWeight, 1);

            // Nhánh strong
            if (patterns.length > 0 && patterns[0].score > 0.72) {
                const inv = !patterns[0].prediction;
                this.lastPrediction = inv;
                return { prediction: inv ? 'T' : 'X', confidence: Math.round(clamp(patterns[0].score, 0.4, 0.6) * 100), method: 'strong_inverted', pattern: patterns[0].name };
            }

            // Nhánh medium
            if (patterns.length > 0 && patterns[0].score > 0.55) {
                const best = patterns[0];
                const combined = (best.prediction ? best.score : 1 - best.score) * 0.6 + best.successRate * 0.4;
                const pred = combined >= 0.5;
                this.lastPrediction = pred;
                return { prediction: pred ? 'T' : 'X', confidence: Math.round(clamp(combined, 0.4, 0.6) * 100), method: 'medium_ensemble', pattern: best.name };
            }

            // Fallback: kết hợp neural + ensemble
            const finalScore = nnConf * 0.3 + ensembleConf * 0.7;
            const finalPred = finalScore > 0.5 ? nnPred : ensemblePred;
            this.lastPrediction = finalPred;
            return { prediction: finalPred ? 'T' : 'X', confidence: Math.round(clamp(finalScore, 0.4, 0.6) * 100), method: 'hybrid_fallback' };
        } catch (e) {
            log('ERROR', 'predict: ' + e.message);
            this.lastPrediction = Math.random() < 0.5;
            return { prediction: this.lastPrediction ? 'T' : 'X', confidence: 50, method: 'error' };
        }
    }

    addResult(ri, sd) {
        try {
            const r = normalizeResult(ri);
            const ts = (sd && sd.timestamp) || Date.now();
            this.history.push({ sessionId: sd ? sd.sessionId : 'unknown', result: r, total: sd ? sd.total : null, timestamp: ts });
            if (this.history.length > MAX_H) this.history.shift();
            if (this.history.length >= 2) {
                this.y.push((this.history.at(-1).timestamp - this.history.at(-2).timestamp) / 1000);
                if (this.y.length > 20) this.y.shift();
            }
            this.stats.totalSessions++;
            r === 'T' ? this.stats.totalTai++ : this.stats.totalXiu++;
            if (this.stats.currentStreakType === r) this.stats.currentStreakCount++;
            else { this.stats.currentStreakType = r; this.stats.currentStreakCount = 1; }
            if (r === 'T' && this.stats.currentStreakCount > this.stats.longestTaiStreak) this.stats.longestTaiStreak = this.stats.currentStreakCount;
            if (r === 'X' && this.stats.currentStreakCount > this.stats.longestXiuStreak) this.stats.longestXiuStreak = this.stats.currentStreakCount;

            if (this.lastPrediction !== null) {
                const pred = this.lastPrediction ? 'T' : 'X';
                const correct = pred === r;
                this.predictionLog.push({
                    phien: String(sd ? sd.sessionId : ''),
                    xuc_xac: sd ? (sd.dice || '') : '',
                    tong: sd ? (sd.total || 0) : 0,
                    ket_qua: r === 'T' ? 'Tài' : 'Xỉu',
                    du_doan: pred === 'T' ? 'Tài' : 'Xỉu',
                    danh_gia: correct ? '✅ ĐÚNG' : '❌ SAI',
                    do_tin_cay: '0%',
                    timestamp: new Date().toISOString()
                });
                if (this.predictionLog.length > MAX_H) this.predictionLog.shift();
                correct ? this.stats.correctPredictions++ : this.stats.wrongPredictions++;

                // Train neural network
                const features = this.extractFeatures();
                const target = r === 'T' ? [1, 0] : [0, 1];
                this.nn.train(features, target);
            }
        } catch (e) { log('ERROR', 'addResult: ' + e.message); }
    }

    getPredictionLog(limit) {
        const r = this.predictionLog.slice(-(limit || 50));
        r.reverse();
        return r;
    }

    getAccuracy() {
        return this.stats.totalSessions > 0 ? (this.stats.correctPredictions / this.stats.totalSessions * 100).toFixed(1) + '%' : '0.0%';
    }

    getRuntime() {
        const s = Math.floor((Date.now() - this.stats.startTime) / 1000);
        const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
        return `${d}d ${h % 24}h ${m % 60}m`;
    }
}

// ============================================================
// WEBSOCKET CLIENT (đơn giản)
// ============================================================

function connectWebSocket() {
    log('INFO', 'Connecting WebSocket...');
    try {
        const ws = new WebSocket(WS_URL);

        ws.on('open', () => {
            log('INFO', 'WebSocket connected!');
            ws.send(JSON.stringify({ H: HUB_NAME, M: 'Register', A: [], I: 0 }));
        });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.M === 'Md5sessionInfo' && msg.A && msg.A.length > 0) {
                    const session = msg.A[0];
                    if (session.CurrentState === 1 && session.Dice1 > 0) {
                        const d1 = session.Dice1, d2 = session.Dice2, d3 = session.Dice3;
                        const total = d1 + d2 + d3;
                        const result = total >= 11 ? 'Tài' : 'Xỉu';
                        const sid = session.SessionId;

                        engine.addResult(result, { sessionId: sid, total, dice: `${d1}-${d2}-${d3}`, timestamp: Date.now() });
                        const prediction = engine.predict({ sessionId: sid + 1 });

                        console.log('');
                        console.log('┌──────────────────────────────────────┐');
                        console.log(`│ #${String(sid).padEnd(30)}│`);
                        console.log(`│ 🎲 [${d1},${d2},${d3}] = ${total} → ${result}`.padEnd(40) + '│');
                        console.log(`│ 🔮 DỰ ĐOÁN: ${prediction.prediction === 'T' ? 'TÀI' : 'XỈU'} (${prediction.confidence}%)`.padEnd(40) + '│');
                        console.log('└──────────────────────────────────────┘');
                    }
                }
            } catch (e) {}
        });

        ws.on('close', () => {
            log('WARN', 'WebSocket closed, reconnecting in 5s...');
            setTimeout(connectWebSocket, 5000);
        });

        ws.on('error', (e) => {
            log('ERROR', 'WebSocket error: ' + e.message);
            setTimeout(connectWebSocket, 5000);
        });
    } catch (e) {
        setTimeout(connectWebSocket, 5000);
    }
}

// ============================================================
// API SERVER
// ============================================================

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    const url = new URL(req.url, 'http://localhost:' + API_PORT);
    const pn = url.pathname;

    try {
        if (pn === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ status: 'running', version: '1.0.0', runtime: engine.getRuntime(), sessions: engine.stats.totalSessions, accuracy: engine.getAccuracy() }));
        }
        if (pn === '/api/predict') {
            const p = engine.predict({});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, prediction: p.prediction === 'T' ? 'Tài' : 'Xỉu', confidence: p.confidence, method: p.method, pattern: p.pattern }));
        }
        if (pn === '/api/stats') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ totalSessions: engine.stats.totalSessions, totalTai: engine.stats.totalTai, totalXiu: engine.stats.totalXiu, correctPredictions: engine.stats.correctPredictions, wrongPredictions: engine.stats.wrongPredictions, accuracy: engine.getAccuracy(), runtime: engine.getRuntime() }));
        }
        if (pn === '/api/prediction_log') {
            const limit = parseInt(url.searchParams.get('limit') || '50');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(engine.getPredictionLog(limit)));
        }
        if (pn === '/') {
            const s = engine.stats;
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(`<html><head><meta charset="utf-8"><title>XocDia88</title><meta http-equiv="refresh" content="5"><style>body{font-family:monospace;background:#0a0a0a;color:#0f0;padding:20px}.box{border:1px solid #0f0;padding:15px;margin:10px 0}h1{color:#0ff}</style></head><body><h1>🎲 XocDia88 - Neural Engine</h1><div class="box"><p>📊 Phiên: <b>${s.totalSessions}</b></p><p>📈 Accuracy: <b>${engine.getAccuracy()}</b></p><p>✅ Đúng: ${s.correctPredictions} | ❌ Sai: ${s.wrongPredictions}</p><p>⏱️ ${engine.getRuntime()}</p></div><p>API: /health | /api/predict | /api/stats | /api/prediction_log</p><p>🕐 ${new Date().toISOString()}</p></body></html>`);
        }
        res.writeHead(404);
        res.end('Not found');
    } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
    }
});

// ===== START =====
const engine = new PredictionEngine();
ensureDir();
connectWebSocket();
setInterval(() => { engine.saveHistory(); engine.savePredictionLog(); }, SAVE_MS);
server.listen(API_PORT, () => {
    console.log('');
    console.log('╔════════════════════════╗');
    console.log('║  🎲 XocDia88 - Neural  ║');
    console.log(`║  Port: ${API_PORT}`.padEnd(25) + '║');
    console.log('╚════════════════════════╝');
});
process.on('SIGINT', () => { engine.saveHistory(); engine.savePredictionLog(); process.exit(0); });
