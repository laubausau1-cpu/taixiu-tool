const WebSocket=require('ws'),fs=require('fs'),path=require('path'),http=require('http');
const WS_URL=process.env.WS_URL||'',HUB_NAME='md5luckydiceHub',DATA_DIR=path.join(__dirname,'data');
const HISTORY_FILE=path.join(DATA_DIR,'history.json'),LOG_FILE=path.join(DATA_DIR,'log.txt');
const PREDICTION_LOG_FILE=path.join(DATA_DIR,'prediction_log.json'),PATTERN_WEIGHTS_FILE=path.join(DATA_DIR,'pattern_weights.json');
const API_PORT=parseInt(process.env.PORT||'8888'),AUTO_SAVE_INTERVAL=300000,MAX_HISTORY=100000,MIN_SAMPLES=6,STRONG_THRESHOLD=0.72;
function ensureDirectories(){if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true})}
function logMessage(l,m){const line='['+new Date().toISOString()+'] ['+l+'] '+m;console.log(line);try{fs.appendFileSync(LOG_FILE,line+'\n')}catch(e){}}
function clamp(v,min,max){return v<min?min:v>max?max:v}
function safeNow(){const n=Date.now();return(isNaN(n)||n<=0)?1750000000000:n}
function safeTimeString(ms){if(!ms||isNaN(ms)||ms<=0)return'0d 0h 0m';const e=Math.floor((safeNow()-ms)/1000);if(e<0)return'0d 0h 0m';const d=Math.floor(e/86400),h=Math.floor((e%86400)/3600),m=Math.floor((e%3600)/60);return d+'d '+h+'h '+m+'m'}

class PredictionEngine{
    constructor(){
        this._startTime=safeNow();this.history=[];this.sessions=[];this.predictionLog=[];
        this.lastPrediction=null;this.lastSessionId=0;this.lastConfidence=50;
        this.weights=[0.4,0.4,0.2];this.nnBias=0.5;this.nnLR=0.01;
        this.patternWeights={};this.patternFailCount={};this.patternSuccessCount={};
        this.stats={totalSessions:0,totalTai:0,totalXiu:0,correctPredictions:0,wrongPredictions:0,longestTaiStreak:0,longestXiuStreak:0,currentStreakType:'',currentStreakCount:0,startTime:this._startTime,adaptiveCorrections:0,highConfCorrect:0,highConfTotal:0};
        this.loadHistory();this.loadPredictionLog();this.loadPatternWeights();this.calibrateFromHistory();
    }
    loadHistory(){try{if(fs.existsSync(HISTORY_FILE)){const d=JSON.parse(fs.readFileSync(HISTORY_FILE,'utf8'));this.history=Array.isArray(d.history)?d.history:[];this.sessions=Array.isArray(d.sessions)?d.sessions:[];if(d.stats){const s=d.stats;if(typeof s.totalSessions==='number')this.stats.totalSessions=s.totalSessions;if(typeof s.totalTai==='number')this.stats.totalTai=s.totalTai;if(typeof s.totalXiu==='number')this.stats.totalXiu=s.totalXiu;if(typeof s.correctPredictions==='number')this.stats.correctPredictions=s.correctPredictions;if(typeof s.wrongPredictions==='number')this.stats.wrongPredictions=s.wrongPredictions;if(typeof s.longestTaiStreak==='number')this.stats.longestTaiStreak=s.longestTaiStreak;if(typeof s.longestXiuStreak==='number')this.stats.longestXiuStreak=s.longestXiuStreak;if(typeof s.adaptiveCorrections==='number')this.stats.adaptiveCorrections=s.adaptiveCorrections;if(typeof s.highConfCorrect==='number')this.stats.highConfCorrect=s.highConfCorrect;if(typeof s.highConfTotal==='number')this.stats.highConfTotal=s.highConfTotal;if(s.currentStreakType)this.stats.currentStreakType=s.currentStreakType;if(typeof s.currentStreakCount==='number')this.stats.currentStreakCount=s.currentStreakCount;if(typeof s.startTime==='number'&&s.startTime>1700000000000){this._startTime=s.startTime;this.stats.startTime=this._startTime}}if(this.history.length>0){const lr=this.history[this.history.length-1];this.stats.currentStreakType=lr;this.stats.currentStreakCount=0;for(let i=this.history.length-1;i>=0;i--){if(this.history[i]===lr)this.stats.currentStreakCount++;else break}}}}}catch(e){this._startTime=safeNow()}}
    loadPredictionLog(){try{if(fs.existsSync(PREDICTION_LOG_FILE)){const d=JSON.parse(fs.readFileSync(PREDICTION_LOG_FILE,'utf8'));this.predictionLog=Array.isArray(d.predictionLog)?d.predictionLog:[]}}catch(e){this.predictionLog=[]}}
    loadPatternWeights(){try{if(fs.existsSync(PATTERN_WEIGHTS_FILE)){const d=JSON.parse(fs.readFileSync(PATTERN_WEIGHTS_FILE,'utf8'));this.patternWeights=d.patternWeights||{};this.patternFailCount=d.patternFailCount||{};this.patternSuccessCount=d.patternSuccessCount||{}}}catch(e){}}
    saveHistory(){try{fs.writeFileSync(HISTORY_FILE,JSON.stringify({history:this.history.slice(-5000),sessions:this.sessions.slice(-5000),stats:this.stats},null,2))}catch(e){}}
    savePredictionLog(){try{fs.writeFileSync(PREDICTION_LOG_FILE,JSON.stringify({predictionLog:this.predictionLog.slice(-10000)},null,2))}catch(e){}}
    savePatternWeights(){try{fs.writeFileSync(PATTERN_WEIGHTS_FILE,JSON.stringify({patternWeights:this.patternWeights,patternFailCount:this.patternFailCount,patternSuccessCount:this.patternSuccessCount},null,2))}catch(e){}}
    calibrateFromHistory(){for(const log of this.predictionLog){if((log.danh_gia==='✅ ĐÚNG'||log.danh_gia==='❌ SAI')&&log.patterns&&log.patterns.length>0){const mp=log.patterns[0];if(!this.patternSuccessCount[mp])this.patternSuccessCount[mp]=0;if(!this.patternFailCount[mp])this.patternFailCount[mp]=0;if(log.danh_gia==='✅ ĐÚNG')this.patternSuccessCount[mp]++;else this.patternFailCount[mp]++}}for(const name in this.patternSuccessCount){const s=this.patternSuccessCount[name]||0,f=this.patternFailCount[name]||0;if(s+f>=3)this.patternWeights[name]=clamp(s/(s+f),0.3,1.5)}}
    normalizeResult(input){if(!input)return null;const n=String(input).toLowerCase().trim();if(n==='tài'||n==='tai'||n==='t'||n==='1')return'T';if(n==='xỉu'||n==='xiu'||n==='x'||n==='0')return'X';if(n.includes('tài')||n.includes('tai'))return'T';if(n.includes('xỉu')||n.includes('xiu'))return'X';return null}
    adjustPatternScore(name,base){if(this.patternWeights[name]){const adj=base*this.patternWeights[name];if(Math.abs(adj-base)>0.05)this.stats.adaptiveCorrections++;return clamp(adj,0.1,0.95)}return base}

    addResult(resultInput,sessionData={}){
        const normalized=this.normalizeResult(resultInput);if(!normalized)return null;
        const actualResult=normalized,currentSessionId=sessionData.id||0;
        let matchedLog=null;
        for(let i=this.predictionLog.length-1;i>=0;i--){if(String(this.predictionLog[i].phien)===String(currentSessionId)&&(!this.predictionLog[i].danh_gia||this.predictionLog[i].danh_gia==='')){matchedLog=this.predictionLog[i];break}}
        if(!matchedLog){for(let i=this.predictionLog.length-1;i>=0;i--){if(!this.predictionLog[i].danh_gia||this.predictionLog[i].danh_gia===''){matchedLog=this.predictionLog[i];break}}}
        if(matchedLog){
            const predictedResult=matchedLog.du_doan==='Tài'?'T':'X';
            matchedLog.ket_qua_thuc_te=actualResult==='T'?'Tài':'Xỉu';
            matchedLog.tong_diem_thuc_te=sessionData.total||0;
            if(predictedResult===actualResult){matchedLog.danh_gia='✅ ĐÚNG';this.stats.correctPredictions++;const conf=parseInt(matchedLog.do_tin_cay);if(conf>=70){this.stats.highConfCorrect++;this.stats.highConfTotal++}if(matchedLog.patterns&&matchedLog.patterns.length>0){const mp=matchedLog.patterns[0];if(!this.patternSuccessCount[mp])this.patternSuccessCount[mp]=0;this.patternSuccessCount[mp]++}}
            else{matchedLog.danh_gia='❌ SAI';this.stats.wrongPredictions++;const conf=parseInt(matchedLog.do_tin_cay);if(conf>=70)this.stats.highConfTotal++;if(matchedLog.patterns&&matchedLog.patterns.length>0){const mp=matchedLog.patterns[0];if(!this.patternFailCount[mp])this.patternFailCount[mp]=0;this.patternFailCount[mp]++}}
            if(matchedLog.patterns&&matchedLog.patterns.length>0){const mp=matchedLog.patterns[0],s=this.patternSuccessCount[mp]||0,f=this.patternFailCount[mp]||0;if(s+f>=3)this.patternWeights[mp]=clamp(s/(s+f),0.3,1.5)}
        }
        if(this.stats.currentStreakType===actualResult)this.stats.currentStreakCount++;else{this.stats.currentStreakType=actualResult;this.stats.currentStreakCount=1}
        if(actualResult==='T'){this.stats.totalTai++;if(this.stats.currentStreakCount>this.stats.longestTaiStreak)this.stats.longestTaiStreak=this.stats.currentStreakCount}
        else{this.stats.totalXiu++;if(this.stats.currentStreakCount>this.stats.longestXiuStreak)this.stats.longestXiuStreak=this.stats.currentStreakCount}
        this.stats.totalSessions++;this.history.push(actualResult);
        this.sessions.push({id:currentSessionId,result:actualResult,time:new Date().toISOString(),dice:sessionData.dice||null,total:sessionData.total||null,betTai:sessionData.betTai||0,betXiu:sessionData.betXiu||0});
        if(this.history.length>MAX_HISTORY)this.history=this.history.slice(-MAX_HISTORY);
        if(this.sessions.length>MAX_HISTORY)this.sessions=this.sessions.slice(-MAX_HISTORY);
        this.lastResult=actualResult;this.savePredictionLog();return actualResult;
    }
    logPrediction(sessionId,prediction){const logEntry={phien:String(parseInt(sessionId)+1),du_doan:prediction.prediction==='T'?'Tài':'Xỉu',danh_gia:'',do_tin_cay:prediction.confidence+'%',timestamp:new Date().toISOString(),patterns:prediction.patterns?prediction.patterns.slice(0,3).map(p=>p.name):[]};this.predictionLog.push(logEntry);if(this.predictionLog.length>10000)this.predictionLog=this.predictionLog.slice(-10000);return logEntry}
    getPredictionLog(limit=50){return this.predictionLog.slice(-limit).reverse()}
    getPredictionStats(){const ev=this.predictionLog.filter(l=>l.danh_gia==='✅ ĐÚNG'||l.danh_gia==='❌ SAI');return{total_logs:this.predictionLog.length,evaluated:ev.length,correct:ev.filter(l=>l.danh_gia==='✅ ĐÚNG').length,wrong:ev.filter(l=>l.danh_gia==='❌ SAI').length,accuracy:ev.length>0?Math.round(ev.filter(l=>l.danh_gia==='✅ ĐÚNG').length/ev.length*100):0,pending:this.predictionLog.length-ev.length,highConfAccuracy:this.stats.highConfTotal>0?Math.round(this.stats.highConfCorrect/this.stats.highConfTotal*100):0}}
    getLastElements(count){if(count<=0)return[];return this.history.slice(-Math.min(count,this.history.length))}
    getElementFromEnd(pos){if(pos<=0||pos>this.history.length)return null;return this.history[this.history.length-pos]}
    countOccurrences(arr,val){let c=0;for(let i=0;i<arr.length;i++)if(arr[i]===val)c++;return c}
    getRecentTotals(count){const totals=[];for(let i=this.sessions.length-1;i>=0&&totals.length<count;i--){if(this.sessions[i].total)totals.push(this.sessions[i].total)}return totals.reverse()}
    analyzeBasicPattern(){if(this.history.length<20)return{isTai:true,confidence:0.5};const r=this.getLastElements(20);const tc=this.countOccurrences(r,'T');const ratio=(tc+1)/(r.length+2);return{isTai:tc>r.length-tc,confidence:clamp(0.5+Math.abs(ratio-0.5)*1.5,0.3,0.88)}}
    createPatternResult(name,prediction,score){return{name,prediction,score:this.adjustPatternScore(name,score),originalScore:score}}

    P01(){if(this.history.length<6)return null;if(this.countOccurrences(this.getLastElements(6),'T')>=6)return this.createPatternResult('1. Bệt Tài','T',0.85);return null}
    P02(){if(this.history.length<6)return null;if(this.countOccurrences(this.getLastElements(6),'T')<=0)return this.createPatternResult('2. Bệt Xỉu','X',0.85);return null}
    P03(){if(this.history.length<10)return null;if(this.countOccurrences(this.getLastElements(10),'T')>=10)return this.createPatternResult('3. Siêu bệt Tài','T',0.95);return null}
    P04(){if(this.history.length<10)return null;if(this.countOccurrences(this.getLastElements(10),'T')<=0)return this.createPatternResult('4. Siêu bệt Xỉu','X',0.95);return null}
    P05(){if(this.history.length<6)return null;const l6=this.getLastElements(6);let sw=0;for(let i=1;i<6;i++)if(l6[i]!==l6[i-1])sw++;if(sw>=4)return this.createPatternResult('5. Xen kẽ ngắn',l6[5]==='T'?'X':'T',0.55);return null}
    P06(){if(this.history.length<6)return null;const l6=this.getLastElements(6),tc=this.countOccurrences(l6,'T');if((tc===5||tc===1)&&l6[5]!==l6[4])return this.createPatternResult('6. Bệt gãy nhẹ',l6[4],0.60);return null}
    P07(){if(this.history.length<3)return null;const a=this.getElementFromEnd(1),b=this.getElementFromEnd(2),c=this.getElementFromEnd(3);if(a===c&&a!==b)return this.createPatternResult('7. Đảo 1-1',a==='T'?'X':'T',0.72);return null}
    P08(){if(this.history.length<4)return null;const a=this.getElementFromEnd(1),b=this.getElementFromEnd(2),c=this.getElementFromEnd(3),d=this.getElementFromEnd(4);if(a===b&&c===d&&a!==c)return this.createPatternResult('8. Kép 2-2',a==='T'?'X':'T',0.75);return null}
    P09(){if(this.history.length<6)return null;const l6=this.getLastElements(6);if(l6[0]===l6[1]&&l6[1]===l6[2]&&l6[3]===l6[4]&&l6[4]===l6[5]&&l6[0]!==l6[3])return this.createPatternResult('9. 3-3',l6[5]==='T'?'X':'T',0.78);return null}
    P10(){if(this.history.length<4)return null;const l4=this.getLastElements(4);if(l4[0]===l4[2]&&l4[1]===l4[3]&&l4[0]!==l4[1])return this.createPatternResult('10. Chu kỳ 2',l4[3]==='T'?'X':'T',0.68);return null}
    P11(){if(this.history.length<6)return null;const l6=this.getLastElements(6);if(l6[0]===l6[3]&&l6[1]===l6[4]&&l6[2]===l6[5]&&l6[0]!==l6[1]&&l6[1]!==l6[2])return this.createPatternResult('11. Chu kỳ 3',l6[5]==='T'?'X':'T',0.65);return null}
    P12(){if(this.history.length<3)return null;if(this.countOccurrences(this.getLastElements(3),'T')>=2)return this.createPatternResult('12. Lặp 2-1→Xỉu','X',0.58);return null}
    P13(){if(this.history.length<3)return null;if(this.countOccurrences(this.getLastElements(3),'T')<=1)return this.createPatternResult('13. Lặp 1-2→Tài','T',0.58);return null}
    P14(){if(this.history.length<5)return null;if(this.countOccurrences(this.getLastElements(5),'T')>=3)return this.createPatternResult('14. Lặp 3-2→Xỉu','X',0.60);return null}
    P15(){if(this.history.length<5)return null;if(this.countOccurrences(this.getLastElements(5),'T')<=2)return this.createPatternResult('15. Lặp 2-3→Tài','T',0.60);return null}
    P16(){if(this.history.length<6)return null;const l6=this.getLastElements(6),rev=[...l6].reverse();let sym=true;for(let i=0;i<6;i++)if(l6[i]!==rev[i]){sym=false;break}if(sym)return this.createPatternResult('16. Đối xứng',l6[0]==='T'?'X':'T',0.82);return null}
    P17(){if(this.history.length<5)return null;const l5=this.getLastElements(5),rev=[...l5].reverse();let m=0;for(let i=0;i<5;i++)if(l5[i]===rev[i])m++;if(m>=4)return this.createPatternResult('17. Bán đối xứng',l5[2]==='T'?'X':'T',0.62);return null}
    P18(){if(this.history.length<4)return null;const l4=this.getLastElements(4);if(l4[0]===l4[1]&&l4[2]===l4[3]&&l4[1]!==l4[2])return this.createPatternResult('18. Bệt ngược',l4[3],0.68);return null}
    P19(){if(this.history.length<4)return null;if(this.countOccurrences(this.getLastElements(4),'T')===4)return this.createPatternResult('19. Tài kép→Xỉu','X',0.72);return null}
    P20(){if(this.history.length<4)return null;if(this.countOccurrences(this.getLastElements(4),'T')===0)return this.createPatternResult('20. Xỉu kép→Tài','T',0.72);return null}
    P21(){if(this.history.length<6)return null;const l6=this.getLastElements(6);let alt=true;for(let i=1;i<6;i++)if(l6[i]===l6[i-1]){alt=false;break}if(alt)return this.createPatternResult('21. Xen kẽ',l6[5]==='T'?'X':'T',0.78);return null}
    P22(){if(this.history.length<6)return null;const p=this.getLastElements(6).join('');if(p==='TXTXTX'||p==='XTXTXT')return this.createPatternResult('22. Gập ghềnh',p[5]==='T'?'X':'T',0.60);return null}
    P23(){if(this.history.length<6)return null;const l6=this.getLastElements(6),runs=[1];for(let i=1;i<6;i++){if(l6[i]===l6[i-1])runs[runs.length-1]++;else runs.push(1)}if(runs.length>=3){let inc=true;for(let i=1;i<runs.length;i++)if(runs[i]<=runs[i-1]){inc=false;break}if(inc)return this.createPatternResult('23. Chu kỳ tăng',l6[5]==='T'?'X':'T',0.65)}return null}
    P24(){if(this.history.length<6)return null;const l6=this.getLastElements(6),runs=[1];for(let i=1;i<6;i++){if(l6[i]===l6[i-1])runs[runs.length-1]++;else runs.push(1)}if(runs.length>=3){let dec=true;for(let i=1;i<runs.length;i++)if(runs[i]>=runs[i-1]){dec=false;break}if(dec)return this.createPatternResult('24. Chu kỳ giảm',l6[5]==='T'?'X':'T',0.65)}return null}
    P25(){if(this.history.length<5)return null;const l5=this.getLastElements(5);if(this.countOccurrences(l5,'T')===3&&l5[4]!==l5[3])return this.createPatternResult('25. Gãy ngang',l5[3],0.62);return null}
    P26(){if(this.history.length<4)return null;const l4=this.getLastElements(4);if(l4[0]===l4[1]&&l4[2]===l4[3]&&l4[1]!==l4[2])return this.createPatternResult('26. Cầu đôi',l4[3]==='T'?'X':'T',0.70);return null}
    P27(){if(this.history.length<6)return null;if(this.countOccurrences(this.getLastElements(6),'T')>=5)return this.createPatternResult('27. Ngẫu nhiên Tài','T',0.70);return null}
    P28(){if(this.history.length<6)return null;if(this.countOccurrences(this.getLastElements(6),'T')<=1)return this.createPatternResult('28. Ngẫu nhiên Xỉu','X',0.70);return null}
    P29(){if(this.history.length<8)return null;const tc=this.countOccurrences(this.getLastElements(8),'T');if(tc>=3&&tc<=5)return this.createPatternResult('29. Đa dạng',tc>=4?'X':'T',0.50);return null}
    P30(){if(this.history.length<6)return null;const l6=this.getLastElements(6);if(l6.slice(0,3).join('')===l6.slice(3,6).join(''))return this.createPatternResult('30. Cầu lặp 3-3',l6[5]==='T'?'X':'T',0.70);return null}
    P31(){if(this.history.length<8)return null;const l8=this.getLastElements(8);if(l8.slice(0,4).join('')===l8.slice(4,8).join(''))return this.createPatternResult('31. Cầu lặp 4-4',l8[7]==='T'?'X':'T',0.72);return null}
    P32(){if(this.history.length<6)return null;const l6=this.getLastElements(6);let opp=true;for(let i=0;i<3;i++)if(l6[i]===l6[5-i]){opp=false;break}if(opp)return this.createPatternResult('32. Đối ngược',l6[2]==='T'?'X':'T',0.63);return null}
    P33(){if(this.history.length<10)return null;const l10=this.getLastElements(10),t1=this.countOccurrences(l10.slice(0,5),'T'),t2=this.countOccurrences(l10.slice(5,10),'T');if(Math.abs(t1-t2)>=4)return this.createPatternResult('33. Phân cụm',t2>=3?'X':'T',0.58);return null}
    P34(){if(this.history.length<5)return null;return this.createPatternResult('34. Lệch ngẫu nhiên',Math.random()<0.5?'T':'X',0.40)}
    P35(){if(this.history.length<8)return null;const l8=this.getLastElements(8);let alt=true;for(let i=1;i<8;i++)if(l8[i]===l8[i-1]){alt=false;break}if(alt)return this.createPatternResult('35. Xen kẽ dài',l8[7]==='T'?'X':'T',0.75);return null}
    P36(){if(this.history.length<5)return null;const l5=this.getLastElements(5);if(l5[0]===l5[2]&&l5[2]===l5[4]&&l5[1]===l5[3]&&l5[0]!==l5[1])return this.createPatternResult('36. Cầu gập',l5[4]==='T'?'X':'T',0.68);return null}
    P37(){if(this.history.length<5)return null;const l5=this.getLastElements(5);if(this.countOccurrences(l5,'T')>=4&&l5[4]==='T')return this.createPatternResult('37. Tài lắc','T',0.55);return null}
    P38(){if(this.history.length<5)return null;const l5=this.getLastElements(5);if(this.countOccurrences(l5,'T')<=1&&l5[4]==='X')return this.createPatternResult('38. Xỉu lắc','X',0.55);return null}
    P39(){if(this.history.length<6)return null;if(this.countOccurrences(this.getLastElements(6),'T')>=5)return this.createPatternResult('39. Phối hợp 1→Xỉu','X',0.58);return null}
    P40(){if(this.history.length<6)return null;if(this.countOccurrences(this.getLastElements(6),'T')<=1)return this.createPatternResult('40. Phối hợp 2→Tài','T',0.58);return null}
    P41(){if(this.history.length<6)return null;const l6=this.getLastElements(6);if(this.countOccurrences(l6,'T')===3)return this.createPatternResult('41. Phối hợp 3',l6[5]==='T'?'X':'T',0.52);return null}
    P42(){if(this.history.length<4)return null;const l4=this.getLastElements(4);if(l4[0]===l4[2]&&l4[1]===l4[3]&&l4[0]!==l4[1])return this.createPatternResult('42. Chẵn lẻ lặp',l4[3]==='T'?'X':'T',0.65);return null}
    P43(){if(this.history.length<6)return null;const l6=this.getLastElements(6),runs=[1];for(let i=1;i<6;i++){if(l6[i]===l6[i-1])runs[runs.length-1]++;else runs.push(1)}if(runs.length>=3&&Math.max(...runs)>=3&&Math.min(...runs)<=1)return this.createPatternResult('43. Dài ngắn đảo',l6[5]==='T'?'X':'T',0.62);return null}
    P44(){if(this.history.length<6)return null;const l6=this.getLastElements(6),fh=l6.slice(0,3),sh=l6.slice(3,6),rev=[...fh].reverse();if(sh.join('')===rev.join('')&&fh.join('')!==rev.join(''))return this.createPatternResult('44. Ngược chu kỳ',sh[2]==='T'?'X':'T',0.67);return null}
    P45(){if(this.history.length<4)return null;const l4=this.getLastElements(4);if(l4[0]!==l4[1]&&l4[1]!==l4[2]&&l4[2]!==l4[3])return this.createPatternResult('45. Chu kỳ biến đổi',l4[3]==='T'?'X':'T',0.62);return null}
    P46(){if(this.history.length<5)return null;const l5=this.getLastElements(5);if(l5[0]===l5[1]&&l5[2]!==l5[1]&&l5[3]===l5[4]&&l5[2]!==l5[3])return this.createPatternResult('46. Cầu 2-1-2',l5[4]==='T'?'X':'T',0.65);return null}
    P47(){if(this.history.length<10)return null;const l10=this.getLastElements(10),tc=this.countOccurrences(l10,'T'),prob=1-(tc/l10.length),score=Math.min(0.7,Math.abs(prob-0.5)*2);return this.createPatternResult('47. Xác suất ngược',prob>0.5?'T':'X',score);}
    P48(){if(this.history.length<8)return null;const l8=this.getLastElements(8),f7=l8.slice(0,7),tc=this.countOccurrences(f7,'T');if(tc>=6&&l8[7]==='X')return this.createPatternResult('48. Bệt Tài gãy đột ngột→Tài','T',0.68);if(tc<=1&&l8[7]==='T')return this.createPatternResult('48. Bệt Xỉu gãy đột ngột→Xỉu','X',0.68);return null}
    P49(){if(this.sessions.length<5)return null;const totals=this.getRecentTotals(5);if(totals.length<5)return null;const avg=totals.reduce((a,b)=>a+b,0)/5;if(avg>12)return this.createPatternResult('49. Tổng điểm cao→Tài','T',0.62);if(avg<9)return this.createPatternResult('49. Tổng điểm thấp→Xỉu','X',0.62);return null}
    P50(){if(this.sessions.length<5)return null;let tb=0,xb=0;for(let i=this.sessions.length-5;i<this.sessions.length;i++){tb+=this.sessions[i].betTai||0;xb+=this.sessions[i].betXiu||0}if(tb+xb>0){const r=tb/(tb+xb);if(r>0.65)return this.createPatternResult('50. Cược lệch→Xỉu','X',0.58);if(r<0.35)return this.createPatternResult('50. Cược lệch→Tài','T',0.58)}return null}
    P51(){if(this.history.length<6)return null;const l6=this.getLastElements(6);if(l6.slice(0,3).join('')===[...l6.slice(3,6)].reverse().join(''))return this.createPatternResult('51. Mirror Flip',l6[5]==='T'?'X':'T',0.71);return null}
    P52(){if(this.predictionLog.length<5)return null;const recent=this.predictionLog.slice(-5);const wrongs=recent.filter(l=>l.danh_gia==='❌ SAI');if(wrongs.length>=4)return this.createPatternResult('52. Reverse Mode',this.lastPrediction==='T'?'X':'T',0.55);return null}
    P53(){if(this.history.length<7)return null;const patterns=this.analyzeAllPatterns();const top3=patterns.slice(0,3);if(top3.length>=3&&top3.every(p=>p.prediction===top3[0].prediction))return this.createPatternResult('53. Triple Confirm',top3[0].prediction,0.76);return null}
    P54(){if(this.history.length<15)return null;const l15=this.getLastElements(15),tc=this.countOccurrences(l15,'T');if(tc>=11)return this.createPatternResult('54. Hot Tai→Xỉu','X',0.60);if(tc<=4)return this.createPatternResult('54. Hot Xỉu→Tài','T',0.60);return null}
    P55(){if(this.history.length<8)return null;const fib=[1,1,2,3,5,8];for(const f of fib){if(this.history.length>=f*2){const recent=this.getLastElements(f*2);if(recent.slice(0,f).join('')===recent.slice(f).join(''))return this.createPatternResult('55. Fib'+f,recent[f-1]==='T'?'X':'T',0.63+f*0.01)}}return null}

    analyzeAllPatterns(){
        return [this.P01(),this.P02(),this.P03(),this.P04(),this.P05(),this.P06(),this.P07(),this.P08(),this.P09(),this.P10(),this.P11(),this.P12(),this.P13(),this.P14(),this.P15(),this.P16(),this.P17(),this.P18(),this.P19(),this.P20(),this.P21(),this.P22(),this.P23(),this.P24(),this.P25(),this.P26(),this.P27(),this.P28(),this.P29(),this.P30(),this.P31(),this.P32(),this.P33(),this.P34(),this.P35(),this.P36(),this.P37(),this.P38(),this.P39(),this.P40(),this.P41(),this.P42(),this.P43(),this.P44(),this.P45(),this.P46(),this.P47(),this.P48(),this.P49(),this.P50(),this.P51(),this.P52(),this.P53(),this.P54(),this.P55()].filter(p=>p!==null);
    }

    predict(){
        if(this.history.length<MIN_SAMPLES){const lr=this.history.length>0?this.history[this.history.length-1]:'T';this.lastPrediction=lr==='T'?'X':'T';return{prediction:this.lastPrediction,confidence:50,patterns:[{name:'Đợi thêm dữ liệu...',prediction:this.lastPrediction,score:0.5}],method:'default',adaptive:false}}
        const patterns=this.analyzeAllPatterns();patterns.sort((a,b)=>b.score-a.score);
        if(patterns.length>0&&patterns[0].score>STRONG_THRESHOLD){this.lastPrediction=patterns[0].prediction;return{prediction:patterns[0].prediction,confidence:Math.round(patterns[0].score*100),patterns:patterns.slice(0,5),method:'strong',adaptive:patterns[0].score!==patterns[0].originalScore}}
        let taiScore=0,xiuScore=0;for(const p of patterns){if(p.prediction==='T')taiScore+=p.score;else xiuScore+=p.score}
        const basic=this.analyzeBasicPattern();if(basic.isTai)taiScore+=basic.confidence*0.3;else xiuScore+=basic.confidence*0.3;
        taiScore*=this.weights[0];xiuScore*=this.weights[0];const total=taiScore+xiuScore;let conf=50;if(total>0)conf=Math.round(Math.max(taiScore,xiuScore)/total*100);
        this.lastPrediction=taiScore>xiuScore?'T':'X';return{prediction:this.lastPrediction,confidence:conf,patterns:patterns.slice(0,5),method:'weighted',adaptive:patterns.some(p=>p.score!==p.originalScore)};
    }
    getAccuracy(){const t=this.stats.correctPredictions+this.stats.wrongPredictions;return t===0?0:Math.round(this.stats.correctPredictions/t*100)}
    getRuntime(){return safeTimeString(this._startTime)}
}

const engine=new PredictionEngine();
let websocket=null,reconnectTimer=null,pingTimer=null,reconnectAttempts=0;
const MAX_RECONNECT_DELAY=30000;

function connectWebSocket(){
    if(!WS_URL){console.log('ERROR: WS_URL not set');setTimeout(connectWebSocket,10000);return}
    if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null}
    if(pingTimer){clearInterval(pingTimer);pingTimer=null}
    if(websocket){try{websocket.close()}catch(e){}websocket=null}
    try{websocket=new WebSocket(WS_URL)}catch(e){setTimeout(connectWebSocket,10000);return}
    reconnectAttempts++;const backoff=Math.min(1000*Math.pow(1.5,reconnectAttempts-1),MAX_RECONNECT_DELAY);
    websocket.on('open',function(){reconnectAttempts=0;logMessage('WS','Connected');try{websocket.send(JSON.stringify({H:HUB_NAME,M:'Ping',A:[],I:0}))}catch(e){}pingTimer=setInterval(function(){if(websocket&&websocket.readyState===1){try{websocket.send(JSON.stringify({H:HUB_NAME,M:'Ping',A:[],I:Date.now()}))}catch(e){}}},60000)});
    websocket.on('message',function(data){try{const json=JSON.parse(data.toString());if(!json.M)return;json.M.forEach(function(m){if(m.M==='Md5sessionInfo'){const info=m.A[0];if(info.CurrentState===0&&info.Ellapsed>0){process.stdout.write('\r'+info.Ellapsed+'s | '+engine.getRuntime()+' | '+engine.stats.totalSessions+' | '+engine.getAccuracy()+'%   ')}if(info.CurrentState===1&&info.Result&&info.Result.Dice1>0&&info.SessionID!==engine.lastSessionId){engine.lastSessionId=info.SessionID;const d1=info.Result.Dice1,d2=info.Result.Dice2,d3=info.Result.Dice3,total=d1+d2+d3,result=total>=11?'T':'X';engine.addResult(result,{id:info.SessionID,dice:[d1,d2,d3],total,betTai:info.TotalBetTai,betXiu:info.TotalBetXiu});const prediction=engine.predict();engine.logPrediction(info.SessionID,prediction);console.log('\n#'+info.SessionID+' | ['+d1+']['+d2+']['+d3+'] = '+total+' | '+(total>=11?'TAI':'XIU'));console.log('NEXT: '+(prediction.prediction==='T'?'TAI':'XIU')+' ('+prediction.confidence+'%)');for(const p of prediction.patterns.slice(0,3))console.log('  '+p.name+': '+(p.prediction==='T'?'T':'X'))}}})}catch(e){}});
    websocket.on('close',function(){logMessage('WS','Disconnected');if(pingTimer){clearInterval(pingTimer);pingTimer=null}websocket=null;reconnectTimer=setTimeout(connectWebSocket,backoff)});
    websocket.on('error',function(){if(websocket){try{websocket.close()}catch(e){}}});
}

setInterval(function(){engine.saveHistory();engine.savePredictionLog();engine.savePatternWeights()},AUTO_SAVE_INTERVAL);

const server=http.createServer(function(req,res){
    res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin','*');
    const url=new URL(req.url,'http://localhost:'+API_PORT);
    if(url.pathname==='/health'){res.writeHead(200);res.end(JSON.stringify({status:'ok',runtime:engine.getRuntime(),sessions:engine.stats.totalSessions,accuracy:engine.getAccuracy()}))}
    else if(url.pathname==='/api/predict'){const p=engine.predict();res.end(JSON.stringify({prediction:p.prediction==='T'?'TÀI':'XỈU',confidence:p.confidence,patterns:p.patterns,highConfAccuracy:engine.getPredictionStats().highConfAccuracy}))}
    else if(url.pathname==='/api/stats'){res.end(JSON.stringify({sessions:engine.stats.totalSessions,correct:engine.stats.correctPredictions,wrong:engine.stats.wrongPredictions,accuracy:engine.getAccuracy(),runtime:engine.getRuntime(),predictionLogStats:engine.getPredictionStats()}))}
    else if(url.pathname==='/api/prediction_log'){res.end(JSON.stringify({logs:engine.getPredictionLog(parseInt(url.searchParams.get('limit')||'50')),stats:engine.getPredictionStats()}))}
    else if(url.pathname==='/api/reset_stats'){engine.stats.correctPredictions=0;engine.stats.wrongPredictions=0;res.end(JSON.stringify({status:'ok'}))}
    else{res.end(JSON.stringify({name:'Tai Xiu Tool V8.0',version:'8.0',patterns:55,accuracy:engine.getAccuracy()}))}
});

server.listen(API_PORT,function(){console.log('API Port: '+API_PORT)});
console.log('TAI XIU TOOL V8.0 - 55 PATTERNS');
ensureDirectories();
connectWebSocket();
