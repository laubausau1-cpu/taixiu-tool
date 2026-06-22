// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║                    TOOL DỰ ĐOÁN TÀI XỈU XÓC ĐĨA 88                          ║
// ║    Version 5.3 - 49 Patterns - Render Ready - Full Features                  ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const http = require('http');

const WS_URL = process.env.WS_URL || process.argv[2] || '';
const HUB_NAME = 'md5luckydiceHub';
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const LOG_FILE = path.join(DATA_DIR, 'log.txt');
const PREDICTION_LOG_FILE = path.join(DATA_DIR, 'prediction_log.json');
const PATTERN_WEIGHTS_FILE = path.join(DATA_DIR, 'pattern_weights.json');
const API_PORT = parseInt(process.env.PORT || '8888');
const AUTO_SAVE_INTERVAL = 300000;
const MAX_HISTORY = 100000;
const MIN_SAMPLES = 6;
const STRONG_THRESHOLD = 0.72;

function ensureDirectories() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function logMessage(level, message) { const line = '[' + new Date().toISOString() + '] [' + level + '] ' + message; console.log(line); try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {} }
function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
function safeNow() { const n = Date.now(); return (isNaN(n) || n <= 0) ? 1750000000000 : n; }
function safeTimeString(ms) { if (!ms || isNaN(ms) || ms <= 0) return '0d 0h 0m'; const elapsed = Math.floor((safeNow() - ms) / 1000); if (elapsed < 0 || isNaN(elapsed)) return '0d 0h 0m'; const d = Math.floor(elapsed / 86400), h = Math.floor((elapsed % 86400) / 3600), m = Math.floor((elapsed % 3600) / 60); return d + 'd ' + h + 'h ' + m + 'm'; }

class PredictionEngine {
    constructor() {
        this._startTime = safeNow();
        this.history = []; this.sessions = []; this.predictionLog = [];
        this.lastPrediction = null; this.lastResult = null; this.lastSessionId = 0;
        this.weights = [0.4, 0.4, 0.2]; this.nnBias = 0.5; this.nnLR = 0.01;
        this.patternWeights = {}; this.patternFailCount = {}; this.patternSuccessCount = {};
        this.stats = { totalSessions:0, totalTai:0, totalXiu:0, correctPredictions:0, wrongPredictions:0, longestTaiStreak:0, longestXiuStreak:0, currentStreakType:'', currentStreakCount:0, startTime:this._startTime, adaptiveCorrections:0 };
        this.loadHistory(); this.loadPredictionLog(); this.loadPatternWeights(); this.calibrateFromHistory();
    }
    loadHistory() {
        try {
            if (fs.existsSync(HISTORY_FILE)) {
                const d = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
                this.history = Array.isArray(d.history) ? d.history : [];
                this.sessions = Array.isArray(d.sessions) ? d.sessions : [];
                if (d.stats) {
                    const s = d.stats;
                    if (typeof s.totalSessions === 'number') this.stats.totalSessions = s.totalSessions;
                    if (typeof s.totalTai === 'number') this.stats.totalTai = s.totalTai;
                    if (typeof s.totalXiu === 'number') this.stats.totalXiu = s.totalXiu;
                    if (typeof s.correctPredictions === 'number') this.stats.correctPredictions = s.correctPredictions;
                    if (typeof s.wrongPredictions === 'number') this.stats.wrongPredictions = s.wrongPredictions;
                    if (typeof s.longestTaiStreak === 'number') this.stats.longestTaiStreak = s.longestTaiStreak;
                    if (typeof s.longestXiuStreak === 'number') this.stats.longestXiuStreak = s.longestXiuStreak;
                    if (typeof s.adaptiveCorrections === 'number') this.stats.adaptiveCorrections = s.adaptiveCorrections;
                    if (s.currentStreakType) this.stats.currentStreakType = s.currentStreakType;
                    if (typeof s.currentStreakCount === 'number') this.stats.currentStreakCount = s.currentStreakCount;
                    if (typeof s.startTime === 'number' && s.startTime > 1700000000000) { this._startTime = s.startTime; this.stats.startTime = this._startTime; }
                }
                if (this.history.length > 0) { const lr = this.history[this.history.length - 1]; this.stats.currentStreakType = lr; this.stats.currentStreakCount = 0; for (let i = this.history.length - 1; i >= 0; i--) { if (this.history[i] === lr) this.stats.currentStreakCount++; else break; } }
            }
        } catch (e) { this._startTime = safeNow(); this.stats.startTime = this._startTime; }
    }
    loadPredictionLog() { try { if (fs.existsSync(PREDICTION_LOG_FILE)) { const d = JSON.parse(fs.readFileSync(PREDICTION_LOG_FILE, 'utf8')); this.predictionLog = Array.isArray(d.predictionLog) ? d.predictionLog : []; } } catch (e) { this.predictionLog = []; } }
    loadPatternWeights() { try { if (fs.existsSync(PATTERN_WEIGHTS_FILE)) { const d = JSON.parse(fs.readFileSync(PATTERN_WEIGHTS_FILE, 'utf8')); this.patternWeights = d.patternWeights || {}; this.patternFailCount = d.patternFailCount || {}; this.patternSuccessCount = d.patternSuccessCount || {}; } } catch (e) {} }
    saveHistory() { try { fs.writeFileSync(HISTORY_FILE, JSON.stringify({ history: this.history.slice(-5000), sessions: this.sessions.slice(-5000), stats: this.stats, updated: new Date().toISOString() }, null, 2)); } catch (e) {} }
    savePredictionLog() { try { fs.writeFileSync(PREDICTION_LOG_FILE, JSON.stringify({ predictionLog: this.predictionLog.slice(-10000), updated: new Date().toISOString() }, null, 2)); } catch (e) {} }
    savePatternWeights() { try { fs.writeFileSync(PATTERN_WEIGHTS_FILE, JSON.stringify({ patternWeights: this.patternWeights, patternFailCount: this.patternFailCount, patternSuccessCount: this.patternSuccessCount, updated: new Date().toISOString() }, null, 2)); } catch (e) {} }
    calibrateFromHistory() {
        for (const log of this.predictionLog) {
            if ((log.danh_gia === '✅ ĐÚNG' || log.danh_gia === '❌ SAI') && log.patterns && log.patterns.length > 0) {
                const mp = log.patterns[0];
                if (!this.patternSuccessCount[mp]) this.patternSuccessCount[mp] = 0;
                if (!this.patternFailCount[mp]) this.patternFailCount[mp] = 0;
                if (log.danh_gia === '✅ ĐÚNG') this.patternSuccessCount[mp]++; else this.patternFailCount[mp]++;
            }
        }
        for (const name in this.patternSuccessCount) { const s = this.patternSuccessCount[name] || 0, f = this.patternFailCount[name] || 0; if (s + f >= 3) this.patternWeights[name] = clamp(s / (s + f), 0.3, 1.5); }
    }
    normalizeResult(input) { if (!input) return null; const n = String(input).toLowerCase().trim(); if (n === 'tài' || n === 'tai' || n === 't' || n === '1') return 'T'; if (n === 'xỉu' || n === 'xiu' || n === 'x' || n === '0') return 'X'; if (n.includes('tài') || n.includes('tai')) return 'T'; if (n.includes('xỉu') || n.includes('xiu')) return 'X'; return null; }
    adjustPatternScore(name, base) { if (this.patternWeights[name]) { const adj = base * this.patternWeights[name]; if (Math.abs(adj - base) > 0.05) this.stats.adaptiveCorrections++; return clamp(adj, 0.1, 0.95); } return base; }

    addResult(resultInput, sessionData = {}) {
        const normalized = this.normalizeResult(resultInput); if (!normalized) return null;
        const actualResult = normalized, currentSessionId = sessionData.id || 0;
        let matchedLog = null;
        for (let i = this.predictionLog.length - 1; i >= 0; i--) { if (String(this.predictionLog[i].phien) === String(currentSessionId) && (!this.predictionLog[i].danh_gia || this.predictionLog[i].danh_gia === '')) { matchedLog = this.predictionLog[i]; break; } }
        if (!matchedLog) { for (let i = this.predictionLog.length - 1; i >= 0; i--) { if (!this.predictionLog[i].danh_gia || this.predictionLog[i].danh_gia === '') { matchedLog = this.predictionLog[i]; break; } } }
        if (matchedLog) {
            const predictedResult = matchedLog.du_doan === 'Tài' ? 'T' : 'X';
            matchedLog.ket_qua_thuc_te = actualResult === 'T' ? 'Tài' : 'Xỉu';
            matchedLog.tong_diem_thuc_te = sessionData.total || 0;
            matchedLog.xuc_xac_thuc_te = sessionData.dice ? sessionData.dice.join('-') : '';
            if (predictedResult === actualResult) { matchedLog.danh_gia = '✅ ĐÚNG'; this.stats.correctPredictions++; if (matchedLog.patterns && matchedLog.patterns.length > 0) { const mp = matchedLog.patterns[0]; if (!this.patternSuccessCount[mp]) this.patternSuccessCount[mp] = 0; this.patternSuccessCount[mp]++; } }
            else { matchedLog.danh_gia = '❌ SAI'; this.stats.wrongPredictions++; if (matchedLog.patterns && matchedLog.patterns.length > 0) { const mp = matchedLog.patterns[0]; if (!this.patternFailCount[mp]) this.patternFailCount[mp] = 0; this.patternFailCount[mp]++; } }
            if (matchedLog.patterns && matchedLog.patterns.length > 0) { const mp = matchedLog.patterns[0], s = this.patternSuccessCount[mp] || 0, f = this.patternFailCount[mp] || 0; if (s + f >= 3) this.patternWeights[mp] = clamp(s / (s + f), 0.3, 1.5); }
        }
        if (this.stats.currentStreakType === actualResult) this.stats.currentStreakCount++; else { this.stats.currentStreakType = actualResult; this.stats.currentStreakCount = 1; }
        if (actualResult === 'T') { this.stats.totalTai++; if (this.stats.currentStreakCount > this.stats.longestTaiStreak) this.stats.longestTaiStreak = this.stats.currentStreakCount; }
        else { this.stats.totalXiu++; if (this.stats.currentStreakCount > this.stats.longestXiuStreak) this.stats.longestXiuStreak = this.stats.currentStreakCount; }
        this.stats.totalSessions++; this.history.push(actualResult);
        this.sessions.push({ id: currentSessionId, result: actualResult, time: new Date().toISOString(), dice: sessionData.dice || null, total: sessionData.total || null, betTai: sessionData.betTai || 0, betXiu: sessionData.betXiu || 0 });
        if (this.history.length > MAX_HISTORY) this.history = this.history.slice(-MAX_HISTORY);
        if (this.sessions.length > MAX_HISTORY) this.sessions = this.sessions.slice(-MAX_HISTORY);
        this.lastResult = actualResult; this.savePredictionLog(); return actualResult;
    }

    logPrediction(sessionId, prediction, dice, total, result) {
        const logEntry = { phien: String(parseInt(sessionId) + 1), xuc_xac: '', tong: 0, ket_qua: '', du_doan: prediction.prediction === 'T' ? 'Tài' : 'Xỉu', danh_gia: '', do_tin_cay: prediction.confidence + '%', timestamp: new Date().toISOString(), patterns: prediction.patterns ? prediction.patterns.slice(0, 3).map(p => p.name) : [], method: prediction.method, adaptive: prediction.adaptive || false };
        this.predictionLog.push(logEntry); if (this.predictionLog.length > 10000) this.predictionLog = this.predictionLog.slice(-10000);
        return logEntry;
    }

    getPredictionLog(limit = 50) { return this.predictionLog.slice(-limit).reverse(); }
    getPredictionStats() { const ev = this.predictionLog.filter(l => l.danh_gia === '✅ ĐÚNG' || l.danh_gia === '❌ SAI'); const c = ev.filter(l => l.danh_gia === '✅ ĐÚNG').length; return { total_logs: this.predictionLog.length, evaluated: ev.length, correct: c, wrong: ev.length - c, accuracy: ev.length > 0 ? Math.round(c / ev.length * 100) : 0, pending: this.predictionLog.length - ev.length }; }
    getLastElements(count) { if (count <= 0) return []; return this.history.slice(-Math.min(count, this.history.length)); }
    getElementFromEnd(pos) { if (pos <= 0 || pos > this.history.length) return null; return this.history[this.history.length - pos]; }
    countOccurrences(arr, val) { let c = 0; for (let i = 0; i < arr.length; i++) if (arr[i] === val) c++; return c; }
    analyzeBasicPattern() { if (this.history.length < 20) return { isTai: true, confidence: 0.5 }; const r = this.getLastElements(20), tc = this.countOccurrences(r, 'T'); return { isTai: tc > r.length - tc, confidence: clamp(0.5 + Math.abs((tc + 1) / (r.length + 2) - 0.5) * 1.5, 0.3, 0.88) }; }
    createPatternResult(name, prediction, score) { return { name, prediction, score: this.adjustPatternScore(name, score), originalScore: score }; }

    checkPattern_BetTai() { if (this.history.length < 6) return null; if (this.countOccurrences(this.getLastElements(6), 'T') >= 6) return this.createPatternResult('1. Bệt Tài', 'T', 0.85); return null; }
    checkPattern_BetXiu() { if (this.history.length < 6) return null; if (this.countOccurrences(this.getLastElements(6), 'T') <= 0) return this.createPatternResult('2. Bệt Xỉu', 'X', 0.85); return null; }
    checkPattern_SieuBetTai() { if (this.history.length < 10) return null; if (this.countOccurrences(this.getLastElements(10), 'T') >= 10) return this.createPatternResult('3. Siêu bệt Tài', 'T', 0.95); return null; }
    checkPattern_SieuBetXiu() { if (this.history.length < 10) return null; if (this.countOccurrences(this.getLastElements(10), 'T') <= 0) return this.createPatternResult('4. Siêu bệt Xỉu', 'X', 0.95); return null; }
    checkPattern_BetXenKeNgan() { if (this.history.length < 6) return null; const l6=this.getLastElements(6); let sw=0; for(let i=1;i<6;i++) if(l6[i]!==l6[i-1]) sw++; if(sw>=4) return this.createPatternResult('5. Bệt xen kẽ ngắn', l6[5]==='T'?'X':'T', 0.55); return null; }
    checkPattern_BetGayNhe() { if (this.history.length < 6) return null; const l6=this.getLastElements(6), tc=this.countOccurrences(l6,'T'); if((tc===5||tc===1)&&l6[5]!==l6[4]) return this.createPatternResult('6. Bệt gãy nhẹ', l6[4], 0.60); return null; }
    checkPattern_Dao1_1() { if (this.history.length < 3) return null; const a=this.getElementFromEnd(1),b=this.getElementFromEnd(2),c=this.getElementFromEnd(3); if(a===c&&a!==b) return this.createPatternResult('7. Đảo 1-1', a==='T'?'X':'T', 0.72); return null; }
    checkPattern_Kep2_2() { if (this.history.length < 4) return null; const a=this.getElementFromEnd(1),b=this.getElementFromEnd(2),c=this.getElementFromEnd(3),d=this.getElementFromEnd(4); if(a===b&&c===d&&a!==c) return this.createPatternResult('8. Kép 2-2', a==='T'?'X':'T', 0.75); return null; }
    checkPattern_3_3() { if (this.history.length < 6) return null; const l6=this.getLastElements(6); if(l6[0]===l6[1]&&l6[1]===l6[2]&&l6[3]===l6[4]&&l6[4]===l6[5]&&l6[0]!==l6[3]) return this.createPatternResult('9. 3-3', l6[5]==='T'?'X':'T', 0.78); return null; }
    checkPattern_ChuKy2() { if (this.history.length < 4) return null; const l4=this.getLastElements(4); if(l4[0]===l4[2]&&l4[1]===l4[3]&&l4[0]!==l4[1]) return this.createPatternResult('10. Chu kỳ 2', l4[3]==='T'?'X':'T', 0.68); return null; }
    checkPattern_ChuKy3() { if (this.history.length < 6) return null; const l6=this.getLastElements(6); if(l6[0]===l6[3]&&l6[1]===l6[4]&&l6[2]===l6[5]&&l6[0]!==l6[1]&&l6[1]!==l6[2]) return this.createPatternResult('11. Chu kỳ 3', l6[5]==='T'?'X':'T', 0.65); return null; }
    checkPattern_Lap2_1() { if (this.history.length < 3) return null; if(this.countOccurrences(this.getLastElements(3),'T')>=2) return this.createPatternResult('12. Lặp 2-1 → Xỉu','X',0.58); return null; }
    checkPattern_Lap1_2() { if (this.history.length < 3) return null; if(this.countOccurrences(this.getLastElements(3),'T')<=1) return this.createPatternResult('13. Lặp 1-2 → Tài','T',0.58); return null; }
    checkPattern_Lap3_2() { if (this.history.length < 5) return null; if(this.countOccurrences(this.getLastElements(5),'T')>=3) return this.createPatternResult('14. Lặp 3-2 → Xỉu','X',0.60); return null; }
    checkPattern_Lap2_3() { if (this.history.length < 5) return null; if(this.countOccurrences(this.getLastElements(5),'T')<=2) return this.createPatternResult('15. Lặp 2-3 → Tài','T',0.60); return null; }
    checkPattern_DoiXung() { if (this.history.length < 6) return null; const l6=this.getLastElements(6),rev=[...l6].reverse(); let sym=true; for(let i=0;i<6;i++) if(l6[i]!==rev[i]){sym=false;break;} if(sym) return this.createPatternResult('16. Đối xứng', l6[0]==='T'?'X':'T', 0.82); return null; }
    checkPattern_BanDoiXung() { if (this.history.length < 5) return null; const l5=this.getLastElements(5),rev=[...l5].reverse(); let m=0; for(let i=0;i<5;i++) if(l5[i]===rev[i]) m++; if(m>=4) return this.createPatternResult('17. Bán đối xứng', l5[2]==='T'?'X':'T', 0.62); return null; }
    checkPattern_BetNguoc() { if (this.history.length < 4) return null; const l4=this.getLastElements(4); if(l4[0]===l4[1]&&l4[2]===l4[3]&&l4[1]!==l4[2]) return this.createPatternResult('18. Bệt ngược', l4[3], 0.68); return null; }
    checkPattern_TaiKep() { if (this.history.length < 4) return null; if(this.countOccurrences(this.getLastElements(4),'T')===4) return this.createPatternResult('19. Tài kép → Xỉu','X',0.72); return null; }
    checkPattern_XiuKep() { if (this.history.length < 4) return null; if(this.countOccurrences(this.getLastElements(4),'T')===0) return this.createPatternResult('20. Xỉu kép → Tài','T',0.72); return null; }
    checkPattern_XenKe() { if (this.history.length < 6) return null; const l6=this.getLastElements(6); let alt=true; for(let i=1;i<6;i++) if(l6[i]===l6[i-1]){alt=false;break;} if(alt) return this.createPatternResult('21. Xen kẽ', l6[5]==='T'?'X':'T', 0.78); return null; }
    checkPattern_GapGhenh() { if (this.history.length < 6) return null; const p=this.getLastElements(6).join(''); if(p==='TXTXTX'||p==='XTXTXT') return this.createPatternResult('22. Gập ghềnh', p[5]==='T'?'X':'T', 0.60); return null; }
    checkPattern_ChuKyTang() { if (this.history.length < 6) return null; const l6=this.getLastElements(6),runs=[1]; for(let i=1;i<6;i++){if(l6[i]===l6[i-1])runs[runs.length-1]++;else runs.push(1);} if(runs.length>=3){let inc=true;for(let i=1;i<runs.length;i++)if(runs[i]<=runs[i-1]){inc=false;break;} if(inc)return this.createPatternResult('23. Chu kỳ tăng',l6[5]==='T'?'X':'T',0.65);} return null; }
    checkPattern_ChuKyGiam() { if (this.history.length < 6) return null; const l6=this.getLastElements(6),runs=[1]; for(let i=1;i<6;i++){if(l6[i]===l6[i-1])runs[runs.length-1]++;else runs.push(1);} if(runs.length>=3){let dec=true;for(let i=1;i<runs.length;i++)if(runs[i]>=runs[i-1]){dec=false;break;} if(dec)return this.createPatternResult('24. Chu kỳ giảm',l6[5]==='T'?'X':'T',0.65);} return null; }
    checkPattern_GayNgang() { if (this.history.length < 5) return null; const l5=this.getLastElements(5); if(this.countOccurrences(l5,'T')===3&&l5[4]!==l5[3]) return this.createPatternResult('25. Gãy ngang', l5[3], 0.62); return null; }
    checkPattern_CauDoi() { if (this.history.length < 4) return null; const l4=this.getLastElements(4); if(l4[0]===l4[1]&&l4[2]===l4[3]&&l4[1]!==l4[2]) return this.createPatternResult('26. Cầu đôi', l4[3]==='T'?'X':'T', 0.70); return null; }
    checkPattern_NgauNhienTai() { if (this.history.length < 6) return null; if(this.countOccurrences(this.getLastElements(6),'T')>=5) return this.createPatternResult('27. Ngẫu nhiên Tài','T',0.70); return null; }
    checkPattern_NgauNhienXiu() { if (this.history.length < 6) return null; if(this.countOccurrences(this.getLastElements(6),'T')<=1) return this.createPatternResult('28. Ngẫu nhiên Xỉu','X',0.70); return null; }
    checkPattern_DaDang() { if (this.history.length < 8) return null; const tc=this.countOccurrences(this.getLastElements(8),'T'); if(tc>=3&&tc<=5) return this.createPatternResult('29. Đa dạng', tc>=4?'X':'T', 0.50); return null; }
    checkPattern_CauLap3() { if (this.history.length < 6) return null; const l6=this.getLastElements(6); if(l6.slice(0,3).join('')===l6.slice(3,6).join('')) return this.createPatternResult('30. Cầu lặp 3-3', l6[5]==='T'?'X':'T', 0.70); return null; }
    checkPattern_CauLap4() { if (this.history.length < 8) return null; const l8=this.getLastElements(8); if(l8.slice(0,4).join('')===l8.slice(4,8).join('')) return this.createPatternResult('31. Cầu lặp 4-4', l8[7]==='T'?'X':'T', 0.72); return null; }
    checkPattern_DoiNguoc() { if (this.history.length < 6) return null; const l6=this.getLastElements(6); let opp=true; for(let i=0;i<3;i++) if(l6[i]===l6[5-i]){opp=false;break;} if(opp) return this.createPatternResult('32. Đối ngược', l6[2]==='T'?'X':'T', 0.63); return null; }
    checkPattern_PhanCum() { if (this.history.length < 10) return null; const l10=this.getLastElements(10),t1=this.countOccurrences(l10.slice(0,5),'T'),t2=this.countOccurrences(l10.slice(5,10),'T'); if(Math.abs(t1-t2)>=4) return this.createPatternResult('33. Phân cụm', t2>=3?'X':'T', 0.58); return null; }
    checkPattern_LechNgauNhien() { if (this.history.length < 5) return null; return this.createPatternResult('34. Lệch ngẫu nhiên', Math.random()<0.5?'T':'X', 0.40); }
    checkPattern_XenKeDai() { if (this.history.length < 8) return null; const l8=this.getLastElements(8); let alt=true; for(let i=1;i<8;i++) if(l8[i]===l8[i-1]){alt=false;break;} if(alt) return this.createPatternResult('35. Xen kẽ dài', l8[7]==='T'?'X':'T', 0.75); return null; }
    checkPattern_CauGap() { if (this.history.length < 5) return null; const l5=this.getLastElements(5); if(l5[0]===l5[2]&&l5[2]===l5[4]&&l5[1]===l5[3]&&l5[0]!==l5[1]) return this.createPatternResult('36. Cầu gập', l5[4]==='T'?'X':'T', 0.68); return null; }
    checkPattern_TaiLac() { if (this.history.length < 5) return null; const l5=this.getLastElements(5); if(this.countOccurrences(l5,'T')>=4&&l5[4]==='T') return this.createPatternResult('37. Tài lắc','T',0.55); return null; }
    checkPattern_XiuLac() { if (this.history.length < 5) return null; const l5=this.getLastElements(5); if(this.countOccurrences(l5,'T')<=1&&l5[4]==='X') return this.createPatternResult('38. Xỉu lắc','X',0.55); return null; }
    checkPattern_PhoiHop1() { if (this.history.length < 6) return null; if(this.countOccurrences(this.getLastElements(6),'T')>=5) return this.createPatternResult('39. Phối hợp 1 → Xỉu','X',0.58); return null; }
    checkPattern_PhoiHop2() { if (this.history.length < 6) return null; if(this.countOccurrences(this.getLastElements(6),'T')<=1) return this.createPatternResult('40. Phối hợp 2 → Tài','T',0.58); return null; }
    checkPattern_PhoiHop3() { if (this.history.length < 6) return null; const l6=this.getLastElements(6); if(this.countOccurrences(l6,'T')===3) return this.createPatternResult('41. Phối hợp 3', l6[5]==='T'?'X':'T', 0.52); return null; }
    checkPattern_ChanLeLap() { if (this.history.length < 4) return null; const l4=this.getLastElements(4); if(l4[0]===l4[2]&&l4[1]===l4[3]&&l4[0]!==l4[1]) return this.createPatternResult('42. Chẵn lẻ lặp', l4[3]==='T'?'X':'T', 0.65); return null; }
    checkPattern_DaiNganDao() { if (this.history.length < 6) return null; const l6=this.getLastElements(6),runs=[1]; for(let i=1;i<6;i++){if(l6[i]===l6[i-1])runs[runs.length-1]++;else runs.push(1);} if(runs.length>=3&&Math.max(...runs)>=3&&Math.min(...runs)<=1) return this.createPatternResult('43. Dài ngắn đảo', l6[5]==='T'?'X':'T', 0.62); return null; }
    checkPattern_NguocChuKy() { if (this.history.length < 6) return null; const l6=this.getLastElements(6),fh=l6.slice(0,3),sh=l6.slice(3,6),rev=[...fh].reverse(); if(sh.join('')===rev.join('')&&fh.join('')!==rev.join('')) return this.createPatternResult('44. Ngược chu kỳ', sh[2]==='T'?'X':'T', 0.67); return null; }
    checkPattern_ChuKyBienDoi() { if (this.history.length < 4) return null; const l4=this.getLastElements(4); if(l4[0]!==l4[1]&&l4[1]!==l4[2]&&l4[2]!==l4[3]) return this.createPatternResult('45. Chu kỳ biến đổi', l4[3]==='T'?'X':'T', 0.62); return null; }
    checkPattern_Cau2_1_2() { if (this.history.length < 5) return null; const l5=this.getLastElements(5); if(l5[0]===l5[1]&&l5[2]!==l5[1]&&l5[3]===l5[4]&&l5[2]!==l5[3]) return this.createPatternResult('46. Cầu 2-1-2', l5[4]==='T'?'X':'T', 0.65); return null; }
    checkPattern_XacSuatNguoc() { if (this.history.length < 10) return null; const l10=this.getLastElements(10),tc=this.countOccurrences(l10,'T'),prob=1-(tc/l10.length),score=Math.min(0.7,Math.abs(prob-0.5)*2); return this.createPatternResult('47. Xác suất ngược', prob>0.5?'T':'X', score); }
    checkPattern_BetTaiGayDotNgot() { if (this.history.length < 8) return null; const l8=this.getLastElements(8),f7=l8.slice(0,7),tc=this.countOccurrences(f7,'T'); if(tc>=6&&l8[7]==='X') return this.createPatternResult('48. Bệt Tài gãy đột ngột → Tài','T',0.68); if(tc<=1&&l8[7]==='T') return this.createPatternResult('48. Bệt Xỉu gãy đột ngột → Xỉu','X',0.68); return null; }
    checkPattern_TongDiemCaoThap() { if (this.sessions.length < 5) return null; const totals=[]; for(let i=this.sessions.length-5;i<this.sessions.length;i++) if(this.sessions[i].total) totals.push(this.sessions[i].total); if(totals.length<5) return null; const avg=totals.reduce((a,b)=>a+b,0)/5; if(avg>12) return this.createPatternResult('49. Tổng điểm cao → Tài','T',0.62); if(avg<9) return this.createPatternResult('49. Tổng điểm thấp → Xỉu','X',0.62); return null; }

    analyzeAllPatterns() {
        return [this.checkPattern_BetTai(),this.checkPattern_BetXiu(),this.checkPattern_SieuBetTai(),this.checkPattern_SieuBetXiu(),this.checkPattern_BetXenKeNgan(),this.checkPattern_BetGayNhe(),this.checkPattern_Dao1_1(),this.checkPattern_Kep2_2(),this.checkPattern_3_3(),this.checkPattern_ChuKy2(),this.checkPattern_ChuKy3(),this.checkPattern_Lap2_1(),this.checkPattern_Lap1_2(),this.checkPattern_Lap3_2(),this.checkPattern_Lap2_3(),this.checkPattern_DoiXung(),this.checkPattern_BanDoiXung(),this.checkPattern_BetNguoc(),this.checkPattern_TaiKep(),this.checkPattern_XiuKep(),this.checkPattern_XenKe(),this.checkPattern_GapGhenh(),this.checkPattern_ChuKyTang(),this.checkPattern_ChuKyGiam(),this.checkPattern_GayNgang(),this.checkPattern_CauDoi(),this.checkPattern_NgauNhienTai(),this.checkPattern_NgauNhienXiu(),this.checkPattern_DaDang(),this.checkPattern_CauLap3(),this.checkPattern_CauLap4(),this.checkPattern_DoiNguoc(),this.checkPattern_PhanCum(),this.checkPattern_LechNgauNhien(),this.checkPattern_XenKeDai(),this.checkPattern_CauGap(),this.checkPattern_TaiLac(),this.checkPattern_XiuLac(),this.checkPattern_PhoiHop1(),this.checkPattern_PhoiHop2(),this.checkPattern_PhoiHop3(),this.checkPattern_ChanLeLap(),this.checkPattern_DaiNganDao(),this.checkPattern_NguocChuKy(),this.checkPattern_ChuKyBienDoi(),this.checkPattern_Cau2_1_2(),this.checkPattern_XacSuatNguoc(),this.checkPattern_BetTaiGayDotNgot(),this.checkPattern_TongDiemCaoThap()].filter(p => p !== null);
    }

    predict() {
        if (this.history.length < MIN_SAMPLES) { const lr=this.history.length>0?this.history[this.history.length-1]:'T',dp=lr==='T'?'X':'T'; this.lastPrediction=dp; return {prediction:dp,confidence:50,patterns:[{name:'Đợi thêm dữ liệu...',prediction:dp,score:0.5}],method:'default',adaptive:false}; }
        const patterns=this.analyzeAllPatterns(); patterns.sort((a,b)=>b.score-a.score);
        if(patterns.length>0&&patterns[0].score>STRONG_THRESHOLD){this.lastPrediction=patterns[0].prediction;return{prediction:patterns[0].prediction,confidence:Math.round(patterns[0].score*100),patterns:patterns.slice(0,5),method:'strong_pattern',adaptive:patterns[0].score!==patterns[0].originalScore};}
        let taiScore=0,xiuScore=0; for(const p of patterns){if(p.prediction==='T')taiScore+=p.score;else xiuScore+=p.score;}
        const basic=this.analyzeBasicPattern(); if(basic.isTai)taiScore+=basic.confidence*0.3;else xiuScore+=basic.confidence*0.3;
        taiScore*=this.weights[0];xiuScore*=this.weights[0]; const total=taiScore+xiuScore; let conf=50; if(total>0)conf=Math.round(Math.max(taiScore,xiuScore)/total*100);
        const pred=taiScore>xiuScore?'T':'X'; this.lastPrediction=pred;
        return {prediction:pred,confidence:conf,patterns:patterns.slice(0,5),method:'weighted_sum',adaptive:patterns.some(p=>p.score!==p.originalScore)};
    }
    getAccuracy() { const t=this.stats.correctPredictions+this.stats.wrongPredictions; return t===0?0:Math.round(this.stats.correctPredictions/t*100); }
    getRuntime() { return safeTimeString(this._startTime); }
}

const engine = new PredictionEngine();
let websocket = null, reconnectTimer = null, pingTimer = null, reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;

function connectWebSocket() {
    if (!WS_URL) { console.log('ERROR: WS_URL not set. Set in Environment Variables.'); setTimeout(connectWebSocket, 10000); return; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (websocket) { try { websocket.close(); } catch(e) {} websocket = null; }
    try { websocket = new WebSocket(WS_URL); } catch(e) { console.log('WS Error: ' + e.message); setTimeout(connectWebSocket, 10000); return; }
    reconnectAttempts++;
    const backoff = Math.min(1000 * Math.pow(1.5, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
    websocket.on('open', function () {
        reconnectAttempts = 0;
        logMessage('WS', 'Connected');
        try { websocket.send(JSON.stringify({ H: HUB_NAME, M: 'Ping', A: [], I: 0 })); } catch(e) {}
        pingTimer = setInterval(function () { if (websocket && websocket.readyState === 1) { try { websocket.send(JSON.stringify({ H: HUB_NAME, M: 'Ping', A: [], I: Date.now() })); } catch(e) {} } }, 60000);
    });
    websocket.on('message', function (data) {
        const msg = data.toString(); if (msg === '{}') return;
        try {
            const json = JSON.parse(msg); if (!json.M) return;
            json.M.forEach(function (m) {
                if (m.M === 'Md5sessionInfo') {
                    const info = m.A[0];
                    if (info.CurrentState === 0 && info.Ellapsed > 0) { process.stdout.write('\r⏳ ' + info.Ellapsed + 's | ⚡' + engine.getRuntime() + ' | Phiên: ' + engine.stats.totalSessions + ' | 🎯' + engine.getAccuracy() + '%   '); }
                    if (info.CurrentState === 1 && info.Result && info.Result.Dice1 > 0 && info.SessionID !== engine.lastSessionId) {
                        engine.lastSessionId = info.SessionID;
                        const d1=info.Result.Dice1, d2=info.Result.Dice2, d3=info.Result.Dice3, total=d1+d2+d3, result=total>=11?'T':'X';
                        const normalized = engine.addResult(result, { id: info.SessionID, dice: [d1,d2,d3], total, betTai: info.TotalBetTai, betXiu: info.TotalBetXiu });
                        if (normalized) {
                            const prediction = engine.predict();
                            engine.logPrediction(info.SessionID, prediction, [d1,d2,d3], total, result);
                            const evaluatedLog = engine.predictionLog.find(l => String(l.phien) === String(info.SessionID) && l.danh_gia);
                            console.log('\n┌──────────────────────────────────────────┐');
                            console.log('│  #' + info.SessionID + ' | [' + d1 + '][' + d2 + '][' + d3 + '] = ' + total + ' | ' + (total>=11?'TÀI':'XỈU'));
                            console.log('│  ⏱ ' + engine.getRuntime() + ' | 📊 ' + engine.stats.totalSessions + ' | 🎯 ' + engine.getAccuracy() + '%');
                            if (evaluatedLog) console.log('│  📋 #' + evaluatedLog.phien + ': ' + evaluatedLog.danh_gia + ' | Đoán: ' + evaluatedLog.du_doan + ' | TT: ' + evaluatedLog.ket_qua_thuc_te + ' | ' + evaluatedLog.do_tin_cay);
                            console.log('│  🔮 DỰ ĐOÁN: ' + (prediction.prediction==='T'?'TÀI':'XỈU') + ' (' + prediction.confidence + '%)');
                            for (const p of prediction.patterns.slice(0,3)) console.log('│    └ ' + p.name + ': ' + (p.prediction==='T'?'T':'X'));
                            console.log('└──────────────────────────────────────────┘');
                        }
                    }
                }
            });
        } catch(e) {}
    });
    websocket.on('close', function (code) { logMessage('WS', 'Disconnected (' + code + ')'); if (pingTimer) { clearInterval(pingTimer); pingTimer = null; } websocket = null; reconnectTimer = setTimeout(connectWebSocket, backoff); });
    websocket.on('error', function (error) { logMessage('ERROR', 'WS: ' + (error.message || 'unknown')); });
}

setInterval(function () { engine.saveHistory(); engine.savePredictionLog(); engine.savePatternWeights(); }, AUTO_SAVE_INTERVAL);

const server = http.createServer(function (req, res) {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Access-Control-Allow-Origin', '*');
    const url = new URL(req.url, 'http://localhost:' + API_PORT);
    if (url.pathname === '/health') { res.writeHead(200); res.end(JSON.stringify({ status: 'ok', runtime: engine.getRuntime(), sessions: engine.stats.totalSessions })); }
    else if (url.pathname === '/api/predict') { const p = engine.predict(); res.end(JSON.stringify({ prediction: p.prediction==='T'?'TÀI':'XỈU', confidence: p.confidence, patterns: p.patterns })); }
    else if (url.pathname === '/api/prediction_log') { res.end(JSON.stringify({ logs: engine.getPredictionLog(parseInt(url.searchParams.get('limit')||'50')), stats: engine.getPredictionStats() })); }
    else if (url.pathname === '/api/stats') { res.end(JSON.stringify({ sessions: engine.stats.totalSessions, correct: engine.stats.correctPredictions, wrong: engine.stats.wrongPredictions, accuracy: engine.getAccuracy(), runtime: engine.getRuntime(), predictionLogStats: engine.getPredictionStats() })); }
    else if (url.pathname === '/api/reset_stats') { engine.stats.correctPredictions = 0; engine.stats.wrongPredictions = 0; res.end(JSON.stringify({ status: 'ok' })); }
    else { res.end(JSON.stringify({ name: 'Tai Xiu Tool v5.3', version: '5.3', patterns: 49, accuracy: engine.getAccuracy(), runtime: engine.getRuntime() })); }
});

server.listen(API_PORT, function () { logMessage('API', 'Port: ' + API_PORT); });

console.log('╔══════════════════════════════════╗');
console.log('║  TOOL TÀI XỈU v5.3 - 49 PATTERNS ║');
console.log('║  RENDER READY                    ║');
console.log('╚══════════════════════════════════╝');
ensureDirectories();
connectWebSocket();
