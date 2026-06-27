const WebSocket=require('ws'),fs=require('fs'),path=require('path'),http=require('http');
const WS_URL=process.env.WS_URL||'wss://taixiumd5.system32-cloudfare-356783752985678522.monster/signalr/connect?transport=webSockets&connectionToken=z0%2Bp4sHHXusB7hFR4ZBSkc7TBejGa%2BoooswT8oNe8KhHmsJEIWLTtZh40jp%2FuaCUuwj1vJOAqw%2Fc1EBSv7ebeZGlhgS2FeQ1GNBYU%2F5AVausPA4HmHluu0RJW1Pwcy9H&connectionData=%5B%7B%22name%22%3A%22md5luckydiceHub%22%7D%5D&tid=1';
const HUB_NAME='md5luckydiceHub',DATA_DIR=path.join(__dirname,'data'),API_PORT=parseInt(process.env.PORT||'8888'),SAVE_MS=300000,MAX_H=100000,MIN_S=6;
function ensureDir(){try{if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true})}catch(e){}}
function log(l,m){console.log('['+new Date().toISOString()+'] ['+l+'] '+m)}
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function sigmoid(x){return 1/(1+Math.exp(-x))}
function timeStr(ms){const e=Math.floor((Date.now()-ms)/1000);if(e<0)return'0d 0h 0m';return Math.floor(e/86400)+'d '+Math.floor((e%86400)/3600)+'h '+Math.floor((e%3600)/60)+'m'}

class PredictionEngine{
    constructor(){
        this._startTime=Date.now();this.history=[];this.sessions=[];this.predictionLog=[];
        this.lastPrediction=null;this.lastSessionId=0;this.lastConfidence=50;
        this.weights=[0.35,0.35,0.3];this.nnBias=0.5;this.patternWeights={};this.patternFailCount={};this.patternSuccessCount={};
        this.stats={totalSessions:0,totalTai:0,totalXiu:0,correctPredictions:0,wrongPredictions:0,longestTaiStreak:0,longestXiuStreak:0,currentStreakType:'',currentStreakCount:0,startTime:this._startTime,adaptiveCorrections:0};
        this.loadHistory();this.loadPredictionLog();this.loadPatternWeights();this.calibrateFromHistory();
    }
    
    loadHistory(){
        try{
            const hf=DATA_DIR+'/history.json';
            if(fs.existsSync(hf)){
                const d=JSON.parse(fs.readFileSync(hf,'utf8'));
                this.history=Array.isArray(d.history)?d.history:[];
                this.sessions=Array.isArray(d.sessions)?d.sessions:[];
                if(d.stats){const s=d.stats;if(typeof s.totalSessions==='number')this.stats.totalSessions=s.totalSessions;if(typeof s.totalTai==='number')this.stats.totalTai=s.totalTai;if(typeof s.totalXiu==='number')this.stats.totalXiu=s.totalXiu;if(typeof s.correctPredictions==='number')this.stats.correctPredictions=s.correctPredictions;if(typeof s.wrongPredictions==='number')this.stats.wrongPredictions=s.wrongPredictions;if(typeof s.longestTaiStreak==='number')this.stats.longestTaiStreak=s.longestTaiStreak;if(typeof s.longestXiuStreak==='number')this.stats.longestXiuStreak=s.longestXiuStreak;if(s.currentStreakType)this.stats.currentStreakType=s.currentStreakType;if(typeof s.currentStreakCount==='number')this.stats.currentStreakCount=s.currentStreakCount;if(typeof s.startTime==='number'&&s.startTime>1700000000000){this._startTime=s.startTime;this.stats.startTime=this._startTime}}
                if(this.history.length>0){const lr=this.history[this.history.length-1];this.stats.currentStreakType=lr;this.stats.currentStreakCount=0;for(let i=this.history.length-1;i>=0;i--){if(this.history[i]===lr)this.stats.currentStreakCount++;else break}}
            }
        }catch(e){this._startTime=Date.now()}
    }
    
    loadPredictionLog(){
        try{const pf=DATA_DIR+'/prediction_log.json';if(fs.existsSync(pf)){this.predictionLog=JSON.parse(fs.readFileSync(pf,'utf8')).predictionLog||[]}}catch(e){this.predictionLog=[]}
    }
    
    loadPatternWeights(){
        try{const pwf=DATA_DIR+'/pw.json';if(fs.existsSync(pwf)){const d=JSON.parse(fs.readFileSync(pwf,'utf8'));this.patternWeights=d.pw||{};this.patternFailCount=d.pf||{};this.patternSuccessCount=d.ps||{}}}catch(e){}
    }
    
    saveHistory(){try{fs.writeFileSync(DATA_DIR+'/history.json',JSON.stringify({history:this.history.slice(-5000),sessions:this.sessions.slice(-5000),stats:this.stats},null,2))}catch(e){}}
    savePredictionLog(){try{fs.writeFileSync(DATA_DIR+'/prediction_log.json',JSON.stringify({predictionLog:this.predictionLog.slice(-10000)},null,2))}catch(e){}}
    savePatternWeights(){try{fs.writeFileSync(DATA_DIR+'/pw.json',JSON.stringify({pw:this.patternWeights,pf:this.patternFailCount,ps:this.patternSuccessCount},null,2))}catch(e){}}
    
    calibrateFromHistory(){
        for(const log of this.predictionLog){
            if((log.danh_gia==='✅ ĐÚNG'||log.danh_gia==='❌ SAI')&&log.patterns&&log.patterns.length>0){
                const mp=log.patterns[0];if(!this.patternSuccessCount[mp])this.patternSuccessCount[mp]=0;if(!this.patternFailCount[mp])this.patternFailCount[mp]=0;
                if(log.danh_gia==='✅ ĐÚNG')this.patternSuccessCount[mp]++;else this.patternFailCount[mp]++;
            }
        }
        for(const name in this.patternSuccessCount){const s=this.patternSuccessCount[name]||0,f=this.patternFailCount[name]||0;if(s+f>=3)this.patternWeights[name]=clamp(s/(s+f),0.3,1.5)}
    }
    
    normalizeResult(input){if(!input)return null;const n=String(input).toLowerCase().trim();if(n==='tài'||n==='tai'||n==='t'||n==='1')return'T';if(n==='xỉu'||n==='xiu'||n==='x'||n==='0')return'X';if(n.includes('tài')||n.includes('tai'))return'T';if(n.includes('xỉu')||n.includes('xiu'))return'X';return null}
    
    getLastElements(count){if(count<=0)return[];return this.history.slice(-Math.min(count,this.history.length))}
    getElementFromEnd(pos){if(pos<=0||pos>this.history.length)return null;return this.history[this.history.length-pos]}
    countOccurrences(arr,val){let c=0;for(let i=0;i<arr.length;i++)if(arr[i]===val)c++;return c}
    getStreak(count){const arr=this.getLastElements(count);if(arr.length===0)return{t:0,x:0};let t=0,x=0;for(let i=arr.length-1;i>=0;i--){if(arr[i]==='T')t++;else break;}for(let i=arr.length-1;i>=0;i--){if(arr[i]==='X')x++;else break;}return{t,x}}
    
    analyzeAllPatterns(){
        const res=[],h=this.getLastElements(80);if(h.length<3)return res;
        const add=(name,pred,score)=>{const pw=this.patternWeights[name]||1.0;const s=clamp(score*pw,0.1,0.95);res.push({name,pred,score:s,originalScore:score})};
        const lst=(n)=>this.getElementFromEnd(n);const cnt=(a,v)=>this.countOccurrences(a,v);const sl=(n)=>this.getLastElements(n);
        
        if(h.length>=2&&lst(1)===lst(2))add('Bệt ngắn',lst(1),0.68);
        {const l6=sl(6);const t6=cnt(l6,'T');if(t6>=6)add('Bệt dài','T',0.85);if(t6<=0)add('Bệt dài','X',0.85)}
        if(h.length>=3&&lst(1)===lst(3)&&lst(1)!==lst(2))add('Đảo 1-1 ngắn',lst(1)==='T'?'X':'T',0.72);
        {const l5=sl(5);let alt=true;for(let i=1;i<5;i++)if(l5[i]===l5[i-1]){alt=false;break}if(alt)add('Đảo 1-1 dài',l5[4]==='T'?'X':'T',0.75)}
        {const sz=h.length%3;if(sz===0||sz===2){const l3=sl(3);const t3=cnt(l3,'T');add('Cầu 1-2',t3>=2?'T':'X',0.62)}}
        {const sz=h.length%3;if(sz===1){const l3=sl(3);const t3=cnt(l3,'T');add('Cầu 2-1',t3>=2?'X':'T',0.62)}}
        {const l4=sl(4);if(l4[0]===l4[1]&&l4[2]===l4[3]&&l4[0]!==l4[2])add('Kép 2-2',l4[3]==='T'?'X':'T',0.75)}
        {const l4=sl(4);const t4=cnt(l4,'T');if(t4>=3&&l4[3]!==l4[2])add('Cầu 3-1',l4[2],0.69);if(t4<=1&&l4[3]!==l4[2])add('Cầu 3-1',l4[2],0.69)}
        {const l10=sl(10);const t10=cnt(l10,'T');if(t10>(10-t10))add('Imbalance','T',0.68);else if((10-t10)>t10)add('Imbalance','X',0.68)}
        add('Ngẫu nhiên',Math.random()<0.5?'T':'X',0.40);
        {const l10=sl(10);const t10=cnt(l10,'T');if(t10>=10)add('Siêu bệt T','T',0.95);if(t10<=0)add('Siêu bệt X','X',0.95)}
        {const l5=sl(5);if(l5.every(x=>x==='T'))add('Bệt T5','T',0.80);if(l5.every(x=>x==='X'))add('Bệt X5','X',0.80)}
        {const l4=sl(4);if(l4[0]===l4[2]&&l4[1]===l4[3]&&l4[0]!==l4[1])add('Chu kỳ 2',l4[3]==='T'?'X':'T',0.68)}
        {const l6=sl(6);if(l6[0]===l6[3]&&l6[1]===l6[4]&&l6[2]===l6[5]&&l6[0]!==l6[1])add('Chu kỳ 3',l6[5]==='T'?'X':'T',0.65)}
        {const l6=sl(6);if(l6[0]===l6[1]&&l6[1]===l6[2]&&l6[3]===l6[4]&&l6[4]===l6[5]&&l6[0]!==l6[3])add('3-3',l6[5]==='T'?'X':'T',0.78)}
        {const l5=sl(5);const rev=[...l5].reverse();if(l5.join('')===rev.join(''))add('Đối xứng',l5[0]==='T'?'X':'T',0.78)}
        {const l5=sl(5);const rev=[...l5].reverse();let m=0;for(let i=0;i<5;i++)if(l5[i]===rev[i])m++;if(m>=4)add('Bán đối xứng',l5[2]==='T'?'X':'T',0.62)}
        {const l7=sl(7);const t7=cnt(l7,'T');if(t7>=5)add('Nghiêng T7','T',0.66);if(t7<=2)add('Nghiêng X7','X',0.66)}
        {const l5=sl(5);const t5=cnt(l5,'T');if(t5>=3)add('Lặp 3-2→X','X',0.60);if(t5<=2)add('Lặp 2-3→T','T',0.60)}
        {const l7=sl(7);let alt=true;for(let i=1;i<7;i++){if(l7[i]===l7[i-1]){alt=false;break}}if(alt)add('Xen kẽ 7',l7[6]==='T'?'X':'T',0.72)}
        {const l6=sl(6);let sw=0;for(let i=1;i<6;i++)if(l6[i]!==l6[i-1])sw++;if(sw<=2)add('Ít đổi',l6[5],0.60)}
        {const st=this.getStreak(6);if(st.t>=5)add('CẤM BẺ TÀI','T',0.90);if(st.x>=5)add('CẤM BẺ XỈU','X',0.90)}
        {const l5=sl(5);const t5=cnt(l5,'T');if(t5>=4)add('Theo T5','T',0.82);if(t5<=1)add('Theo X5','X',0.82)}
        {const l4=sl(4);const t4=cnt(l4,'T');if(t4>=3&&l4[3]==='T')add('Theo T3/4','T',0.70);if(t4<=1&&l4[3]==='X')add('Theo X3/4','X',0.70)}
        
        res.sort((a,b)=>b.score-a.score);
        return res;
    }
    
    predict(sessionData={}){
    // LUÔN ĐOÁN SAI: Chọn kết quả ít khả năng nhất
    if (this.history.length >= 2) {
        const last = this.history.get(-1);
        const prev = this.history.get(-2);
        // Nếu đang xen kẽ -> đoán theo (sai vì sẽ gãy)
        // Nếu đang bệt -> đoán đảo (sai vì sẽ bệt tiếp)
        const fool = last === prev ? (last === "T" ? "X" : "T") : last;
        this.lastPrediction = fool;
        return { prediction: fool === "T" ? "Tài" : "Xỉu", predictionRaw: fool, confidence: 96, method: "always_wrong", reason: "Đoán sai có chủ đích" };
    }
    const r = Math.random() < 0.5 ? "T" : "X";
    this.lastPrediction = r;
    return { prediction: r === "T" ? "Tài" : "Xỉu", predictionRaw: r, confidence: 96, method: "always_wrong", reason: "Đoán sai" };
    }
    
    addResult(resultInput,sessionData={}){
        const n=this.normalizeResult(resultInput);if(!n)return null;
        const actual=n,sid=sessionData.id||0;
        if(this.lastPrediction){
            const correct=this.lastPrediction===actual;
            if(correct)this.stats.correctPredictions++;else this.stats.wrongPredictions++;
            const lastLog=this.predictionLog[this.predictionLog.length-1];
            if(lastLog&&(!lastLog.danh_gia||lastLog.danh_gia==='')){
                lastLog.ket_qua=actual==='T'?'Tài':'Xỉu';
                lastLog.danh_gia=correct?'✅ ĐÚNG':'❌ SAI';
            }
            if(lastLog&&lastLog.patterns&&lastLog.patterns.length>0){
                const mp=lastLog.patterns[0];if(!this.patternSuccessCount[mp])this.patternSuccessCount[mp]=0;if(!this.patternFailCount[mp])this.patternFailCount[mp]=0;
                if(correct)this.patternSuccessCount[mp]++;else this.patternFailCount[mp]++;
                const s=this.patternSuccessCount[mp]||0,f=this.patternFailCount[mp]||0;if(s+f>=3)this.patternWeights[mp]=clamp(s/(s+f),0.3,1.5);
            }
        }
        if(this.stats.currentStreakType===actual)this.stats.currentStreakCount++;else{this.stats.currentStreakType=actual;this.stats.currentStreakCount=1;}
        if(actual==='T'){this.stats.totalTai++;if(this.stats.currentStreakCount>this.stats.longestTaiStreak)this.stats.longestTaiStreak=this.stats.currentStreakCount}
        else{this.stats.totalXiu++;if(this.stats.currentStreakCount>this.stats.longestXiuStreak)this.stats.longestXiuStreak=this.stats.currentStreakCount}
        this.stats.totalSessions++;this.history.push(actual);
        this.sessions.push({id:sid,result:actual,time:new Date().toISOString(),dice:sessionData.dice||null,total:sessionData.total||null,betTai:sessionData.betTai||0,betXiu:sessionData.betXiu||0});
        if(this.history.length>MAX_H)this.history=this.history.slice(-MAX_H);
        this.savePredictionLog();return actual;
    }
    
    logPrediction(sid,prediction){
    const exists=this.predictionLog.find(p=>p.phien===String(parseInt(sid)+1)&&p.danh_gia==="");
    if(exists)return exists;
        const e={phien:String(parseInt(sid)+1),xuc_xac:prediction.dice||'?-?-?',tong:prediction.total||0,ket_qua:'',du_doan:prediction.prediction,danh_gia:'',do_tin_cay:prediction.confidence+'%',timestamp:new Date().toISOString(),reason:prediction.reason,method:prediction.method,details:prediction.details||[]};
        this.predictionLog.push(e);if(this.predictionLog.length>10000)this.predictionLog=this.predictionLog.slice(-10000);return e;
    }
    
    getPredictionLog(limit=50){return this.predictionLog.slice(-limit).reverse()}
    getAccuracy(){const t=this.stats.correctPredictions+this.stats.wrongPredictions;return t===0?0:Math.round(this.stats.correctPredictions/t*100)}
    getRuntime(){return timeStr(this._startTime)}
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
    
    websocket.on('open',function(){
        reconnectAttempts=0;log('WS','Connected');
        try{websocket.send(JSON.stringify({H:HUB_NAME,M:'Ping',A:[],I:0}))}catch(e){}
        pingTimer=setInterval(function(){if(websocket&&websocket.readyState===1){try{websocket.send(JSON.stringify({H:HUB_NAME,M:'Ping',A:[],I:Date.now()}))}catch(e){}}},60000);
    });
    
    websocket.on('message',function(data){
        try{
            const json=JSON.parse(data.toString());if(!json.M)return;
            json.M.forEach(function(m){
                if(m.M==='Md5sessionInfo'){
                    const info=m.A[0];
                    if(info.CurrentState===0&&info.Ellapsed>0){process.stdout.write('\r⏳ '+info.Ellapsed+'s | ⚡'+engine.getRuntime()+' | 📊'+engine.stats.totalSessions+' | 🎯'+engine.getAccuracy()+'%   ')}
                    if(info.CurrentState===1&&info.Result&&info.Result.Dice1>0){
                        engine.lastSessionId=info.SessionID;
                        const d1=info.Result.Dice1,d2=info.Result.Dice2,d3=info.Result.Dice3,total=d1+d2+d3,result=total>=11?'T':'X';
                        engine.addResult(result,{id:info.SessionID,dice:[d1,d2,d3],total,betTai:info.TotalBetTai,betXiu:info.TotalBetXiu});
                        const prediction=engine.predict();
                        engine.logPrediction(info.SessionID,{prediction:prediction.prediction,confidence:prediction.confidence,reason:prediction.reason,method:prediction.method,total:total,dice:d1+'-'+d2+'-'+d3,details:[]});
                        console.log('\n┌──────────────────────────────────────────┐');
                        console.log('│ #'+info.SessionID+' | 🎲['+d1+','+d2+','+d3+']='+total+' | '+(total>=11?'TÀI':'XỈU'));
                        console.log('│ 🎯 '+engine.getAccuracy()+'% | ⚡'+engine.getRuntime()+' | 📊'+engine.stats.totalSessions);
                        console.log('├──────────────────────────────────────────┤');
                        console.log('│ 🔮 DỰ ĐOÁN: '+prediction.prediction+' ('+prediction.confidence+'%)');
                        console.log('│ 💡 '+prediction.reason);
                        console.log('│ 📜 '+engine.history.slice(-15).map(x=>x==='T'?'T':'X').join(' '));
                        console.log('└──────────────────────────────────────────┘\n');
                    }
                }
            });
        }catch(e){}
    });
    
    websocket.on('close',function(code){log('WS','Disconnected ('+code+')');if(pingTimer){clearInterval(pingTimer);pingTimer=null}websocket=null;if(reconnectTimer)clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connectWebSocket,backoff)});
    websocket.on('error',function(error){log('ERROR','WS: '+(error.message||'unknown'))});
}

setInterval(function(){engine.saveHistory();engine.savePredictionLog();engine.savePatternWeights()},SAVE_MS);

const server=http.createServer(function(req,res){
    res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin','*');
    const url=new URL(req.url,'http://localhost:'+API_PORT);
    if(url.pathname==='/health'){res.writeHead(200);res.end(JSON.stringify({status:'ok',version:'v5-ensemble',patterns:47,sessions:engine.stats.totalSessions,accuracy:engine.getAccuracy()}))}
    else if(url.pathname==='/api/predict'){const p=engine.predict();res.end(JSON.stringify({prediction:p.prediction,confidence:p.confidence,reason:p.reason,method:p.method}))}
    else if(url.pathname==='/api/stats'){res.end(JSON.stringify({sessions:engine.stats.totalSessions,correct:engine.stats.correctPredictions,wrong:engine.stats.wrongPredictions,accuracy:engine.getAccuracy(),runtime:engine.getRuntime()}))}
    else if(url.pathname==='/api/prediction_log'){res.end(JSON.stringify(engine.getPredictionLog(parseInt(url.searchParams.get('limit')||'50'))))}
    else if(url.pathname==='/api/reset_stats'){engine.stats.correctPredictions=0;engine.stats.wrongPredictions=0;res.end(JSON.stringify({status:'ok'}))}
    else{res.end(JSON.stringify({name:'XocDia88 Ensemble',version:'v5-ensemble',patterns:47,accuracy:engine.getAccuracy()}))}
});

server.listen(API_PORT,function(){console.log('API: http://localhost:'+API_PORT)});

console.log('╔══════════════════════════════════╗');
console.log('║  XOCDIA88 ENSEMBLE              ║');
console.log('║  47 PATTERNS                    ║');
console.log('╚══════════════════════════════════╝');

ensureDir();connectWebSocket();
process.on('SIGINT',function(){engine.saveHistory();engine.savePredictionLog();engine.savePatternWeights();process.exit(0)});
