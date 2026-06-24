// ============================================================
// xocdia88.js — Gộp 2 engine Smali (MD5 + 88) + Ensemble Voting
// Bảng điểm xúc xắc + Tự điều chỉnh trọng số
// Target accuracy: ≥85%
// Chạy: node xocdia88.js
// ============================================================

const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

// ============================================================
// HÀM TIỆN ÍCH CHUNG
// ============================================================

function sigmoid(x) { return 1.0 / (1.0 + Math.exp(-x)); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function laplaceProb(successCount, totalCount) { return (successCount + 1) / (totalCount + 2); }

function normalizeResult(raw) {
    if (!raw) return raw;
    const trimmed = raw.trim();
    const lower = trimmed.toLowerCase();
    const hashMap = {
        't': 'Tài', 'tai': 'Tài', 'tài': 'Tài',
        'x': 'Xỉu', 'xiu': 'Xỉu', 'xỉu': 'Xỉu',
        'c': 'Tài', 'chan': 'Tài', 'chẵn': 'Tài',
        'l': 'Xỉu', 'le': 'Xỉu', 'lẻ': 'Xỉu'
    };
    if (hashMap[lower]) return hashMap[lower];
    return trimmed;
}

function getLastN(deque, n) {
    if (n <= 0) return [];
    const result = [];
    const arr = [...deque];
    for (let i = arr.length - 1; i >= 0 && result.length < n; i--) { result.push(arr[i]); }
    result.reverse();
    return result;
}

function calcProb(c, score) {
    const clampedScore = clamp(score, 0.1, 0.95);
    const half = clampedScore * 0.5;
    return c ? (0.5 + half) : (0.5 - half);
}

function forward(input, weights, bias) {
    let sum = bias;
    for (let i = 0; i < input.length && i < weights.length; i++) { sum += input[i] * weights[i]; }
    return clamp(sigmoid(sum), 0.0, 1.0);
}

function getQuickAnalysis(deque) {
    const sessions = getLastN(deque, 20);
    if (sessions.length === 0) { return { prediction: true, confidence: 0.5 }; }
    let taiCount = 0;
    for (const s of sessions) { if (s.result === 'Tài') taiCount++; }
    const total = sessions.length;
    const xiuCount = total - taiCount;
    const probTai = laplaceProb(taiCount, total);
    const diff = probTai - 0.5;
    const imbalance = Math.abs(diff) * 1.5;
    const clampedImbalance = clamp(imbalance, 0.3, 0.88);
    const prediction = taiCount >= xiuCount;
    return { prediction, confidence: clampedImbalance };
}

// ============================================================
// CLASS EngineMD5
// ============================================================

class EngineMD5 {
    constructor() {
        this.weights = [0.35, 0.35, 0.3]; this.bias = 0.5; this.MIN_S = 6;
        this.history = []; this.predictionLog = []; this.patternWeights = new Map();
        this.patternMap = this._buildPatternMap(); this.y = [];
    }

    _buildPatternMap() {
        const self = this;
        const lastResult = (list) => list.length > 0 ? list[list.length - 1] : null;

        return new Map([
            ['Bệt', (list) => {
                if (list.length === 0) return false;
                const last = lastResult(list);
                let streak = list.slice().reverse(); let count = 0;
                for (const s of streak) { if (s !== last) break; count++; }
                const minS = self.y.length > 0 ? Math.max(6, Math.min(Math.floor((self.y.reduce((a,b)=>a+b,0)/self.y.length) * 1.5), 10)) : 6;
                if (count < minS) { const qa = getQuickAnalysis(self.history); return qa.prediction ? (last === 'Tài') : (last !== 'Tài'); }
                const qa = getQuickAnalysis(self.history);
                const base = qa.prediction ? 0.3 : -0.3;
                const extra = (count - minS + 1) * 0.2;
                const score = base + extra;
                if (score > 0.5) return last === 'Tài';
                return last !== 'Tài';
            }],
            ['Bệt siêu dài', (list) => {
                const last = lastResult(list);
                const qa = getQuickAnalysis(self.history);
                const minS = self.y.length > 0 ? Math.max(6, Math.min(Math.floor((self.y.reduce((a,b)=>a+b,0)/self.y.length) * 1.5), 10)) : 6;
                const streakLen = self._getStreak(list);
                if (streakLen < minS) { return qa.prediction ? (last === 'Tài') : (last !== 'Tài'); }
                const base = qa.prediction ? 0.3 : -0.3;
                const extra = (streakLen - minS + 1) * 0.2;
                const score = base + extra;
                if (score > 0.5) return last === 'Tài';
                return last !== 'Tài';
            }],
            ['Bệt xen kẽ ngắn', (list) => {
                const last = lastResult(list);
                const qa = getQuickAnalysis(self.history);
                const minS = self.y.length > 0 ? Math.max(6, Math.min(Math.floor((self.y.reduce((a,b)=>a+b,0)/self.y.length) * 1.5), 10)) : 6;
                const streakLen = self._getStreak(list);
                if (streakLen < minS) { return qa.prediction ? (last === 'Tài') : (last !== 'Tài'); }
                const base = qa.prediction ? 0.3 : -0.3;
                const extra = (streakLen - minS + 1) * 0.2;
                const score = base + extra;
                if (score > 0.5) return last === 'Tài';
                return last !== 'Tài';
            }],
            ['Bệt gãy nhẹ', (list) => {
                const last = lastResult(list);
                const qa = getQuickAnalysis(self.history);
                const minS = self.y.length > 0 ? Math.max(6, Math.min(Math.floor((self.y.reduce((a,b)=>a+b,0)/self.y.length) * 1.5), 10)) : 6;
                const streakLen = self._getStreak(list);
                if (streakLen < minS) { return qa.prediction ? (last === 'Tài') : (last !== 'Tài'); }
                const base = qa.prediction ? 0.3 : -0.3;
                const extra = (streakLen - minS + 1) * 0.2;
                const score = base + extra;
                if (score > 0.5) return last === 'Tài';
                return last !== 'Tài';
            }],
            ['Đảo 1-1', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Kép 2-2', (list) => { const last2 = list.length >= 2 ? list[list.length - 2] : null; return last2 === 'Tài'; }],
            ['3-3', (list) => { const last3 = list.length >= 3 ? list[list.length - 3] : null; return last3 === 'Tài'; }],
            ['Chu kỳ 2', (list) => { const last2 = list.length >= 2 ? list[list.length - 2] : null; return last2 === 'Tài'; }],
            ['Chu kỳ 3', (list) => { const last3 = list.length >= 3 ? list[list.length - 3] : null; return last3 === 'Tài'; }],
            ['Lặp 2-1', (list) => { const last2 = list.length >= 2 ? list[list.length - 2] : null; return last2 === 'Tài'; }],
            ['Lặp 3-2', (list) => { const last3 = list.length >= 3 ? list[list.length - 3] : null; return last3 === 'Tài'; }],
            ['Đối xứng', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Bán đối xứng', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Bệt ngược', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Xỉu kép', (list) => {
                const last = lastResult(list); const qa = getQuickAnalysis(self.history);
                const minS = self.y.length > 0 ? Math.max(6, Math.min(Math.floor((self.y.reduce((a,b)=>a+b,0)/self.y.length) * 1.5), 10)) : 6;
                const streakLen = self._getStreak(list);
                if (streakLen < minS) { return qa.prediction ? (last === 'Tài') : (last !== 'Tài'); }
                const base = qa.prediction ? 0.3 : -0.3;
                const extra = (streakLen - minS + 1) * 0.2;
                const score = base + extra;
                if (score > 0.5) return last === 'Tài';
                return last !== 'Tài';
            }],
            ['Tài kép', (list) => {
                const last = lastResult(list); const qa = getQuickAnalysis(self.history);
                const minS = self.y.length > 0 ? Math.max(6, Math.min(Math.floor((self.y.reduce((a,b)=>a+b,0)/self.y.length) * 1.5), 10)) : 6;
                const streakLen = self._getStreak(list);
                if (streakLen < minS) { return qa.prediction ? (last === 'Tài') : (last !== 'Tài'); }
                const base = qa.prediction ? 0.3 : -0.3;
                const extra = (streakLen - minS + 1) * 0.2;
                const score = base + extra;
                if (score > 0.5) return last === 'Tài';
                return last !== 'Tài';
            }],
            ['Xen kẽ', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Gập ghềnh', (list) => { const last10 = list.slice(-10); const taiCount = last10.filter(r => r === 'Tài').length; return taiCount >= 6; }],
            ['Bậc thang', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Gãy ngang', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Cầu đôi', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Ngẫu nhiên', (list) => { const last10 = list.slice(-10); const taiCount = last10.filter(r => r === 'Tài').length; return taiCount >= 5; }],
            ['Đa dạng', (list) => { const last10 = list.slice(-10); const taiCount = last10.filter(r => r === 'Tài').length; return taiCount >= 5; }],
            ['Chu kỳ tăng', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Chu kỳ giảm', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Cầu lặp', (list) => { const last6 = list.slice(-6); const firstOf6 = last6.length > 0 ? last6[0] : null; return firstOf6 === 'Tài'; }],
            ['Đối ngược', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Phân cụm', (list) => { const last10 = list.slice(-10); const taiCount = last10.filter(r => r === 'Tài').length; return taiCount > 5; }],
            ['Lệch ngẫu nhiên', (list) => { const last10 = list.slice(-10); const taiCount = last10.filter(r => r === 'Tài').length; return taiCount >= 5; }],
            ['Xen kẽ dài', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Cầu gập', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Xỉu lắc', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Tài lắc', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Phối hợp 1', (list) => { const last10 = list.slice(-10); const taiCount = last10.filter(r => r === 'Tài').length; return taiCount > 5; }],
            ['Phối hợp 2', (list) => { const qa = getQuickAnalysis(self.history); return qa.prediction; }],
            ['Phối hợp 3', (list) => { const qa = getQuickAnalysis(self.history); return qa.prediction; }],
            ['Chẵn lẻ lặp', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Dài ngắn đảo', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Ngẫu nhiên bệt', (list) => { const last = lastResult(list); return last === 'Tài'; }],
            ['Cầu dài ngẫu', (list) => { const last10 = list.slice(-10); const taiCount = last10.filter(r => r === 'Tài').length; return taiCount >= 5; }],
            ['Ngược chu kỳ', (list) => { const last = lastResult(list); return last === 'Tài'; }],
            ['Chu kỳ biến đổi', (list) => { const last10 = list.slice(-10); const taiCount = last10.filter(r => r === 'Tài').length; return taiCount > 5; }],
            ['Cầu linh hoạt', (list) => { const last10 = list.slice(-10); const taiCount = last10.filter(r => r === 'Tài').length; return taiCount > 5; }],
            ['Cầu 3-1', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Cầu 2-1-2', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Cầu thời gian nhanh', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Cầu thời gian chậm', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
        ]);
    }

    _getStreak(list) {
        if (list.length === 0) return 0;
        const last = list[list.length - 1]; let count = 0;
        for (let i = list.length - 1; i >= 0; i--) { if (list[i] !== last) break; count++; }
        return count;
    }

    analyze() {
        if (this.history.length < 8) return [];
        const sessions = getLastN(this.history, 80);
        const results = sessions.map(s => s.result);
        const matchedPatterns = [];
        for (const [patternName, checkFn] of this.patternMap) { if (checkFn(results)) { matchedPatterns.push({ name: patternName, checkFn }); } }
        const scoredPatterns = [];
        for (const { name, checkFn } of matchedPatterns) {
            const stats = this.patternWeights.get(name) || { success: 0, total: 0 };
            let successRate = 0.5; if (stats.total > 0) { successRate = stats.success / stats.total; }
            let recentMatchRate = 0.1;
            if (this.history.length >= 20) {
                const chunks = [];
                for (let i = 0; i < 6; i++) { const start = this.history.length - 6 * (i + 1); const end = start + 6; if (start >= 0 && end <= this.history.length) { chunks.push(results.slice(start, end)); } }
                let matchCount = 0; for (const chunk of chunks) { if (checkFn(chunk)) matchCount++; }
                recentMatchRate = Math.max(0.1, matchCount / Math.max(chunks.length, 1));
            }
            const score = clamp(successRate * 0.7 + recentMatchRate * 0.3, 0.25, 0.98);
            const prediction = checkFn(results);
            scoredPatterns.push({ name, score, prediction, successRate, recentMatchRate });
        }
        scoredPatterns.sort((a, b) => b.score - a.score);
        return scoredPatterns;
    }

    predict(sessionData) {
        if (this.history.length < this.MIN_S) {
            const last = this.history.length > 0 ? this.history[this.history.length - 1].result : null;
            if (last === 'Tài') { const rand = Math.random(); const prediction = rand < 0.52; this._lastPrediction = prediction; return { prediction: prediction ? 'T' : 'X', confidence: Math.round(0.5 * 100), method: 'warmup' }; }
            else if (last === 'Xỉu') { const rand = Math.random(); const prediction = rand < 0.48; this._lastPrediction = prediction; return { prediction: prediction ? 'T' : 'X', confidence: Math.round(0.5 * 100), method: 'warmup' }; }
            else { const prediction = Math.random() < 0.5; this._lastPrediction = prediction; return { prediction: prediction ? 'T' : 'X', confidence: Math.round(0.5 * 100), method: 'warmup' }; }
        }
        const analyzed = this.analyze();
        if (analyzed.length > 0 && analyzed[0].score > 0.72) {
            const best = analyzed[0]; const invertedPrediction = !best.prediction;
            const confidence = clamp(best.score, 0.4, 0.6); this._lastPrediction = invertedPrediction;
            return { prediction: invertedPrediction ? 'T' : 'X', confidence: Math.round(confidence * 100), method: 'strong_inverted', pattern: best.name };
        }
        if (analyzed.length > 0 && analyzed[0].score > 0.55) {
            const best = analyzed[0]; const adjustedScore = best.prediction ? best.score : (1 - best.score);
            const qa = getQuickAnalysis(this.history); const combinedScore = adjustedScore * 0.6 + best.successRate * 0.4;
            const prediction = combinedScore >= 0.5; const confidence = clamp(combinedScore, 0.4, 0.6); this._lastPrediction = prediction;
            return { prediction: prediction ? 'T' : 'X', confidence: Math.round(confidence * 100), method: 'medium_combined', pattern: best.name };
        }
        const qa = getQuickAnalysis(this.history); const recent10 = getLastN(this.history, 10); const results10 = recent10.map(s => s.result);
        let fallbackScore;
        if (results10.length < 6) { fallbackScore = 0.5; }
        else {
            const pairs = []; for (let i = 0; i < results10.length - 1; i++) { pairs.push({ a: results10[i], b: results10[i+1] }); }
            let diffCount = 0; for (const p of pairs) { if (p.a !== p.b) diffCount++; }
            const diffRate = diffCount / Math.max(pairs.length, 1);
            const lastResult = results10[results10.length - 1];
            const pred = diffRate > 0.6 ? (lastResult !== 'Tài') : (lastResult === 'Tài');
            const rawScore = clamp(diffRate, 0.4, 0.9); fallbackScore = pred ? rawScore : (1 - rawScore);
        }
        const neuralScore = forward([calcProb(qa.prediction, qa.confidence), fallbackScore, 0.5], this.weights, this.bias);
        const prediction = neuralScore >= 0.5; const confidence = clamp(neuralScore, 0.4, 0.6); this._lastPrediction = prediction;
        return { prediction: prediction ? 'T' : 'X', confidence: Math.round(confidence * 100), method: 'neural_fallback' };
    }

    addResult(sessionId, result, timestamp) {
        const normalized = normalizeResult(result);
        this.history.push({ sessionId, result: normalized, timestamp: timestamp || Date.now() });
        if (this.history.length > 200) { this.history.shift(); }
        if (this.history.length >= 2) {
            const last = this.history[this.history.length - 1]; const prev = this.history[this.history.length - 2];
            const delta = (last.timestamp - prev.timestamp) / 1000; this.y.push(delta);
            if (this.y.length > 20) this.y.shift();
        }
        if (this._lastPrediction !== undefined) { const actual = normalized === 'Tài'; this.predictionLog.push({ predicted: this._lastPrediction, actual }); if (this.predictionLog.length > 200) this.predictionLog.shift(); }
    }
}

// ============================================================
// CLASS Engine88
// ============================================================

class Engine88 {
    constructor() {
        this.weights = [0.35, 0.35, 0.3]; this.bias = 0.5; this.MIN_S = 6;
        this.history = []; this.predictionLog = []; this.patternWeights = new Map();
        this.patternMap = this._buildPatternMap(); this.y = [];
    }

    _buildPatternMap() {
        const self = this;
        const lastResult = (list) => list.length > 0 ? list[list.length - 1] : null;

        return new Map([
            ['Bệt', (list) => {
                const last = lastResult(list); const qa = getQuickAnalysis(self.history);
                const minS = self.y.length > 0 ? Math.max(6, Math.min(Math.floor((self.y.reduce((a,b)=>a+b,0)/self.y.length) * 1.5), 10)) : 6;
                const streakLen = self._getStreak(list);
                if (streakLen < minS) { return qa.prediction ? (last === 'Tài') : (last !== 'Tài'); }
                const base = qa.prediction ? 0.3 : -0.3; const extra = (streakLen - minS + 1) * 0.2;
                const score = base + extra; if (score > 0.5) return last === 'Tài'; return last !== 'Tài';
            }],
            ['Bệt siêu dài', (list) => {
                const last = lastResult(list); const qa = getQuickAnalysis(self.history);
                const minS = self.y.length > 0 ? Math.max(6, Math.min(Math.floor((self.y.reduce((a,b)=>a+b,0)/self.y.length) * 1.5), 10)) : 6;
                const streakLen = self._getStreak(list);
                if (streakLen < minS) { return qa.prediction ? (last === 'Tài') : (last !== 'Tài'); }
                const base = qa.prediction ? 0.3 : -0.3; const extra = (streakLen - minS + 1) * 0.2;
                const score = base + extra; if (score > 0.5) return last === 'Tài'; return last !== 'Tài';
            }],
            ['Đảo 1-1', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Kép 2-2', (list) => { const last2 = list.length >= 2 ? list[list.length - 2] : null; return last2 === 'Tài'; }],
            ['3-3', (list) => { const last3 = list.length >= 3 ? list[list.length - 3] : null; return last3 === 'Tài'; }],
            ['Chu kỳ 2', (list) => { const last2 = list.length >= 2 ? list[list.length - 2] : null; return last2 === 'Tài'; }],
            ['Chu kỳ 3', (list) => { const last3 = list.length >= 3 ? list[list.length - 3] : null; return last3 === 'Tài'; }],
            ['Lặp 2-1', (list) => { const last2 = list.length >= 2 ? list[list.length - 2] : null; return last2 === 'Tài'; }],
            ['Lặp 3-2', (list) => { const last3 = list.length >= 3 ? list[list.length - 3] : null; return last3 === 'Tài'; }],
            ['Đối xứng', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Bán đối xứng', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Bệt ngược', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Xỉu kép', (list) => {
                const last = lastResult(list); const qa = getQuickAnalysis(self.history);
                const minS = self.y.length > 0 ? Math.max(6, Math.min(Math.floor((self.y.reduce((a,b)=>a+b,0)/self.y.length) * 1.5), 10)) : 6;
                const streakLen = self._getStreak(list);
                if (streakLen < minS) { return qa.prediction ? (last === 'Tài') : (last !== 'Tài'); }
                const base = qa.prediction ? 0.3 : -0.3; const extra = (streakLen - minS + 1) * 0.2;
                const score = base + extra; if (score > 0.5) return last === 'Tài'; return last !== 'Tài';
            }],
            ['Tài kép', (list) => {
                const last = lastResult(list); const qa = getQuickAnalysis(self.history);
                const minS = self.y.length > 0 ? Math.max(6, Math.min(Math.floor((self.y.reduce((a,b)=>a+b,0)/self.y.length) * 1.5), 10)) : 6;
                const streakLen = self._getStreak(list);
                if (streakLen < minS) { return qa.prediction ? (last === 'Tài') : (last !== 'Tài'); }
                const base = qa.prediction ? 0.3 : -0.3; const extra = (streakLen - minS + 1) * 0.2;
                const score = base + extra; if (score > 0.5) return last === 'Tài'; return last !== 'Tài';
            }],
            ['Xen kẽ', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Gập ghềnh', (list) => { const last10 = list.slice(-10); const taiCount = last10.filter(r => r === 'Tài').length; return taiCount >= 6; }],
            ['Bậc thang', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Gãy ngang', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Cầu đôi', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Ngẫu nhiên', (list) => { const last10 = list.slice(-10); const taiCount = last10.filter(r => r === 'Tài').length; return taiCount >= 5; }],
            ['Đa dạng', (list) => { const last10 = list.slice(-10); const taiCount = last10.filter(r => r === 'Tài').length; return taiCount >= 5; }],
            ['Chu kỳ tăng', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Chu kỳ giảm', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Cầu lặp', (list) => { const last6 = list.slice(-6); const firstOf6 = last6.length > 0 ? last6[0] : null; return firstOf6 === 'Tài'; }],
            ['Đối ngược', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Phân cụm', (list) => { const last10 = list.slice(-10); const taiCount = last10.filter(r => r === 'Tài').length; return taiCount > 5; }],
            ['Lệch ngẫu nhiên', (list) => { const last10 = list.slice(-10); const taiCount = last10.filter(r => r === 'Tài').length; return taiCount >= 5; }],
            ['Xen kẽ dài', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Cầu gập', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Xỉu lắc', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Tài lắc', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Phối hợp 1', (list) => { const last10 = list.slice(-10); const taiCount = last10.filter(r => r === 'Tài').length; return taiCount > 5; }],
            ['Phối hợp 2', (list) => { const qa = getQuickAnalysis(self.history); return qa.prediction; }],
            ['Phối hợp 3', (list) => { const qa = getQuickAnalysis(self.history); return qa.prediction; }],
            ['Chẵn lẻ lặp', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Dài ngắn đảo', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Ngẫu nhiên bệt', (list) => { const last = lastResult(list); return last === 'Tài'; }],
            ['Cầu dài ngẫu', (list) => { const last10 = list.slice(-10); const taiCount = last10.filter(r => r === 'Tài').length; return taiCount >= 5; }],
            ['Ngược chu kỳ', (list) => { const last = lastResult(list); return last === 'Tài'; }],
            ['Chu kỳ biến đổi', (list) => { const last10 = list.slice(-10); const taiCount = last10.filter(r => r === 'Tài').length; return taiCount > 5; }],
            ['Cầu linh hoạt', (list) => { const last10 = list.slice(-10); const taiCount = last10.filter(r => r === 'Tài').length; return taiCount > 5; }],
            ['Cầu 3-1', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Cầu 2-1-2', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Cầu thời gian nhanh', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
            ['Cầu thời gian chậm', (list) => { const last = lastResult(list); return last !== 'Tài'; }],
        ]);
    }

    _getStreak(list) {
        if (list.length === 0) return 0;
        const last = list[list.length - 1]; let count = 0;
        for (let i = list.length - 1; i >= 0; i--) { if (list[i] !== last) break; count++; }
        return count;
    }

    analyze() {
        if (this.history.length < 8) return [];
        const sessions = getLastN(this.history, 80);
        const results = sessions.map(s => s.result);
        const matchedPatterns = [];
        for (const [patternName, checkFn] of this.patternMap) { if (checkFn(results)) { matchedPatterns.push({ name: patternName, checkFn }); } }
        const scoredPatterns = [];
        for (const { name, checkFn } of matchedPatterns) {
            const stats = this.patternWeights.get(name) || { success: 0, total: 0 };
            let successRate = 0.5; if (stats.total > 0) { successRate = stats.success / stats.total; }
            let recentMatchRate = 0.1;
            if (this.history.length >= 20) {
                const chunks = [];
                for (let i = 0; i < 6; i++) { const start = this.history.length - 6 * (i + 1); const end = start + 6; if (start >= 0 && end <= this.history.length) { chunks.push(results.slice(start, end)); } }
                let matchCount = 0; for (const chunk of chunks) { if (checkFn(chunk)) matchCount++; }
                recentMatchRate = Math.max(0.1, matchCount / Math.max(chunks.length, 1));
            }
            const score = clamp(successRate * 0.7 + recentMatchRate * 0.3, 0.25, 0.98);
            const prediction = checkFn(results);
            scoredPatterns.push({ name, score, prediction, successRate, recentMatchRate });
        }
        scoredPatterns.sort((a, b) => b.score - a.score);
        return scoredPatterns;
    }

    predict(sessionData) {
        if (this.history.length < this.MIN_S) {
            const last = this.history.length > 0 ? this.history[this.history.length - 1].result : null;
            if (last === 'Tài') { const rand = Math.random(); const prediction = rand < 0.52; this._lastPrediction = prediction; return { prediction: prediction ? 'T' : 'X', confidence: Math.round(0.5 * 100), method: 'warmup' }; }
            else if (last === 'Xỉu') { const rand = Math.random(); const prediction = rand < 0.48; this._lastPrediction = prediction; return { prediction: prediction ? 'T' : 'X', confidence: Math.round(0.5 * 100), method: 'warmup' }; }
            else { const prediction = Math.random() < 0.5; this._lastPrediction = prediction; return { prediction: prediction ? 'T' : 'X', confidence: Math.round(0.5 * 100), method: 'warmup' }; }
        }
        const analyzed = this.analyze();
        if (analyzed.length > 0 && analyzed[0].score > 0.72) {
            const best = analyzed[0]; const confidence = clamp(best.score, 0.4, 0.6); this._lastPrediction = best.prediction;
            return { prediction: best.prediction ? 'T' : 'X', confidence: Math.round(confidence * 100), method: 'strong_kept', pattern: best.name };
        }
        if (analyzed.length > 0 && analyzed[0].score > 0.55) {
            const best = analyzed[0]; const adjustedScore = best.prediction ? best.score : (1 - best.score);
            const qa = getQuickAnalysis(this.history); const combinedScore = adjustedScore * 0.6;
            const prediction = combinedScore >= 0.5; const confidence = clamp(combinedScore, 0.4, 0.6); this._lastPrediction = prediction;
            return { prediction: prediction ? 'T' : 'X', confidence: Math.round(confidence * 100), method: 'medium_qa', pattern: best.name };
        }
        const qa = getQuickAnalysis(this.history); const recent10 = getLastN(this.history, 10); const results10 = recent10.map(s => s.result);
        let fallbackScore;
        if (results10.length < 6) { fallbackScore = 0.5; }
        else {
            const pairs = []; for (let i = 0; i < results10.length - 1; i++) { pairs.push({ a: results10[i], b: results10[i+1] }); }
            let diffCount = 0; for (const p of pairs) { if (p.a !== p.b) diffCount++; }
            const diffRate = diffCount / Math.max(pairs.length, 1);
            const lastResult = results10[results10.length - 1];
            const pred = diffRate > 0.6 ? (lastResult !== 'Tài') : (lastResult === 'Tài');
            const rawScore = clamp(diffRate, 0.4, 0.9); fallbackScore = pred ? rawScore : (1 - rawScore);
        }
        const neuralScore = forward([calcProb(qa.prediction, qa.confidence), fallbackScore, 0.5], this.weights, this.bias);
        const prediction = neuralScore < 0.5; const confidence = clamp(neuralScore, 0.4, 0.6); this._lastPrediction = prediction;
        return { prediction: prediction ? 'T' : 'X', confidence: Math.round(confidence * 100), method: 'neural_fallback' };
    }

    addResult(sessionId, result, timestamp) {
        const normalized = normalizeResult(result);
        this.history.push({ sessionId, result: normalized, timestamp: timestamp || Date.now() });
        if (this.history.length > 200) { this.history.shift(); }
        if (this.history.length >= 2) {
            const last = this.history[this.history.length - 1]; const prev = this.history[this.history.length - 2];
            const delta = (last.timestamp - prev.timestamp) / 1000; this.y.push(delta);
            if (this.y.length > 20) this.y.shift();
        }
        if (this._lastPrediction !== undefined) { const actual = normalized === 'Tài'; this.predictionLog.push({ predicted: this._lastPrediction, actual }); if (this.predictionLog.length > 200) this.predictionLog.shift(); }
    }
}

// ============================================================
// CLASS EnsembleEngine
// ============================================================

class EnsembleEngine {
    constructor() {
        this.engineMD5 = new EngineMD5();
        this.engine88 = new Engine88();
        this.engineWeights = { md5: 0.45, xocdia88: 0.55 };
        this.history = [];
        this.stats = { totalSessions: 0, correctPredictions: 0, wrongPredictions: 0, engineMD5Correct: 0, engine88Correct: 0 };
        this.lastEnsemblePrediction = null;
    }

    getDiceScore(total) {
        if (total <= 4) return { prediction: 'X', score: 0.95 };
        if (total === 5) return { prediction: 'X', score: 0.55 };
        if (total >= 6 && total <= 10) return { prediction: 'X', score: 0.65 };
        if (total === 11) return { prediction: 'T', score: 0.60 };
        if (total >= 12 && total <= 14) return { prediction: 'T', score: 0.75 };
        if (total >= 15) return { prediction: 'T', score: 0.95 };
        return { prediction: 'T', score: 0.5 };
    }

    predict(sessionData) {
        const pMD5 = this.engineMD5.predict(sessionData);
        const p88 = this.engine88.predict(sessionData);
        const wMD5 = this.engineWeights.md5, w88 = this.engineWeights.xocdia88;
        let taiScore = 0, xiuScore = 0;
        if (pMD5.prediction === 'T') taiScore += wMD5 * (pMD5.confidence / 100);
        else xiuScore += wMD5 * (pMD5.confidence / 100);
        if (p88.prediction === 'T') taiScore += w88 * (p88.confidence / 100);
        else xiuScore += w88 * (p88.confidence / 100);
        if (sessionData && sessionData.total) {
            const diceScore = this.getDiceScore(sessionData.total);
            if (diceScore.prediction === 'T') taiScore += diceScore.score * 0.25;
            else xiuScore += diceScore.score * 0.25;
        }
        const total = taiScore + xiuScore || 1;
        const prediction = taiScore > xiuScore ? 'T' : 'X';
        const rawConf = Math.max(taiScore, xiuScore) / total;
        const confidence = Math.round(clamp(rawConf, 0.6, 0.95) * 100);
        this.lastEnsemblePrediction = prediction;
        return { prediction, confidence, engineMD5: pMD5.prediction, engine88: p88.prediction, engineMD5Method: pMD5.method, engine88Method: p88.method, reason: `MD5→${pMD5.prediction}(${pMD5.confidence}%) 88→${p88.prediction}(${p88.confidence}%)`, method: 'ensemble_voting' };
    }

    addResult(sessionId, result, timestamp, sessionData) {
        const normalized = normalizeResult(result); const actual = normalized === 'Tài' ? 'T' : 'X';
        this.engineMD5.addResult(sessionId, result, timestamp);
        this.engine88.addResult(sessionId, result, timestamp);
        this.history.push({ sessionId, result: normalized, timestamp: timestamp || Date.now() });
        if (this.history.length > 200) { this.history.shift(); }
        if (this.lastEnsemblePrediction) { this.stats.totalSessions++; if (this.lastEnsemblePrediction === actual) { this.stats.correctPredictions++; } else { this.stats.wrongPredictions++; } }
        if (this.stats.totalSessions > 0 && this.stats.totalSessions % 20 === 0) { this._adjustWeights(); }
    }

    _adjustWeights() {
        const md5Total = this.engineMD5.predictionLog.length;
        const md5Correct = this.engineMD5.predictionLog.filter(p => p.predicted === p.actual).length;
        const md5Acc = md5Total > 0 ? md5Correct / md5Total : 0.5;
        const xocdia88Total = this.engine88.predictionLog.length;
        const xocdia88Correct = this.engine88.predictionLog.filter(p => p.predicted === p.actual).length;
        const xocdia88Acc = xocdia88Total > 0 ? xocdia88Correct / xocdia88Total : 0.5;
        if (md5Acc > xocdia88Acc) { this.engineWeights.md5 = clamp(this.engineWeights.md5 + 0.03, 0.3, 0.7); this.engineWeights.xocdia88 = clamp(this.engineWeights.xocdia88 - 0.03, 0.3, 0.7); }
        else if (xocdia88Acc > md5Acc) { this.engineWeights.xocdia88 = clamp(this.engineWeights.xocdia88 + 0.03, 0.3, 0.7); this.engineWeights.md5 = clamp(this.engineWeights.md5 - 0.03, 0.3, 0.7); }
        const totalWeight = this.engineWeights.md5 + this.engineWeights.xocdia88;
        this.engineWeights.md5 = this.engineWeights.md5 / totalWeight; this.engineWeights.xocdia88 = this.engineWeights.xocdia88 / totalWeight;
        console.log(`[ENSEMBLE] Weights: MD5=${this.engineWeights.md5.toFixed(3)} 88=${this.engineWeights.xocdia88.toFixed(3)} | MD5 acc=${(md5Acc*100).toFixed(1)}% 88 acc=${(xocdia88Acc*100).toFixed(1)}%`);
    }

    getStats() {
        const total = this.stats.totalSessions;
        const acc = total > 0 ? (this.stats.correctPredictions / total * 100) : 0;
        return { totalSessions: total, correctPredictions: this.stats.correctPredictions, wrongPredictions: this.stats.wrongPredictions, accuracy: acc.toFixed(1) + '%', weights: { md5: this.engineWeights.md5.toFixed(3), xocdia88: this.engineWeights.xocdia88.toFixed(3) } };
    }
}

// ============================================================
// KHỞI TẠO ENSEMBLE ENGINE
// ============================================================
const ensemble = new EnsembleEngine();

// ============================================================
// WEB SOCKET SERVER
// ============================================================

wss.on('connection', (ws) => {
    console.log('[WS] Client connected');
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'new_session' || msg.sessionId) {
                const sessionData = { sessionId: msg.sessionId || 'unknown', total: msg.total || null, timestamp: msg.timestamp || Date.now() };
                const prediction = ensemble.predict(sessionData);
                ws.send(JSON.stringify({ type: 'prediction', sessionId: sessionData.sessionId, ...prediction }));
            }
            if (msg.type === 'result' || msg.result) {
                ensemble.addResult(msg.sessionId, msg.result || msg.data, msg.timestamp || Date.now(), msg);
                ws.send(JSON.stringify({ type: 'stats', ...ensemble.getStats() }));
            }
            if (msg.type === 'get_stats') { ws.send(JSON.stringify({ type: 'stats', ...ensemble.getStats() })); }
        } catch (e) { console.error('[WS] Error:', e.message); }
    });
    ws.on('close', () => { console.log('[WS] Client disconnected'); });
});

// ============================================================
// API SERVER
// ============================================================

app.use(express.json());
app.post('/predict', (req, res) => { const { sessionId, total, timestamp } = req.body; res.json({ success: true, ...ensemble.predict({ sessionId, total, timestamp }) }); });
app.post('/result', (req, res) => { const { sessionId, result, timestamp } = req.body; ensemble.addResult(sessionId, result, timestamp, req.body); res.json({ success: true, stats: ensemble.getStats() }); });
app.get('/stats', (req, res) => { res.json(ensemble.getStats()); });
app.get('/', (req, res) => { const s = ensemble.getStats(); res.send(`<html><head><title>XocDia88 Ensemble</title></head><body><h1>XocDia88 Ensemble</h1><p>Sessions: ${s.totalSessions}</p><p>Accuracy: ${s.accuracy}</p><p>Weights: MD5=${s.weights.md5} 88=${s.weights.xocdia88}</p></body></html>`); });

// ============================================================
// START SERVER
// ============================================================

server.listen(PORT, () => { console.log(`[SERVER] Port ${PORT} | Ensemble Engine (MD5 + 88) | Target: ≥85%`); });
process.on('SIGINT', () => { console.log('[SERVER] Shutting down...'); server.close(); process.exit(0); });
