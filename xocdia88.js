const WebSocket=require('ws'),fs=require('fs'),path=require('path'),http=require('http');
const WS_URL=process.env.WS_URL||'wss://taixiumd5.system32-cloudfare-356783752985678522.monster/signalr/connect?transport=webSockets&connectionToken=z0%2Bp4sHHXusB7hFR4ZBSkc7TBejGa%2BoooswT8oNe8KhHmsJEIWLTtZh40jp%2FuaCUuwj1vJOAqw%2Fc1EBSv7ebeZGlhgS2FeQ1GNBYU%2F5AVausPA4HmHluu0RJW1Pwcy9H&connectionData=%5B%7B%22name%22%3A%22md5luckydiceHub%22%7D%5D&tid=1';
const HUB_NAME='md5luckydiceHub',DATA_DIR=path.join(__dirname,'data'),HISTORY_FILE=path.join(DATA_DIR,'history.json'),PRED_FILE=path.join(DATA_DIR,'prediction_log.json'),API_PORT=parseInt(process.env.PORT||'8888'),SAVE_MS=300000,MAX_H=100000,MIN_S=6;

function ensureDir(){try{if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true})}catch(e){}}
function log(l,m){const t=new Date().toISOString();console.log('['+t+'] ['+l+'] '+m)}
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function sigmoid(x){return 1/(1+Math.exp(-x))}
function relu(x){return Math.max(0,x)}
function softmax(arr){const exp=arr.map(x=>Math.exp(x-Math.max(...arr))),sum=exp.reduce((a,b)=>a+b,0);return exp.map(x=>x/sum)}
function normalizeResult(raw){if(!raw)return'T';const m={t:'T',tai:'T','tài':'T',x:'X',xiu:'X','xỉu':'X',c:'T',chan:'T','chẵn':'T',l:'X',le:'X','lẻ':'X'};return m[raw.trim().toLowerCase()]||'T'}
function getLastN(arr,n){if(n<=0)return[];const r=[];for(let i=arr.length-1;i>=0&&r.length<n;i--)r.push(arr[i]);r.reverse();return r}

class NeuralNetwork{
    constructor(){this.inputSize=10;this.hiddenSize=8;this.outputSize=2;this.lr=0.001;this.momentum=0.9;this.w1=this._xavier(10,8);this.b1=new Array(8).fill(0);this.w2=this._xavier(8,2);this.b2=new Array(2).fill(0);this.vw1=this._zeros(10,8);this.vb1=new Array(8).fill(0);this.vw2=this._zeros(8,2);this.vb2=new Array(2).fill(0)}
    _xavier(r,c){const s=Math.sqrt(2/(r+c));return Array.from({length:r},()=>Array.from({length:c},()=>(Math.random()*2-1)*s))}
    _zeros(r,c){return Array.from({length:r},()=>new Array(c).fill(0))}
    forward(input){this.hidden=this.b1.map((b,i)=>relu(input.reduce((s,x,j)=>s+x*this.w1[j][i],0)+b));this.output=this.b2.map((b,i)=>this.hidden.reduce((s,h,j)=>s+h*this.w2[j][i],0)+b);this.probs=softmax(this.output);return this.probs}
    train(input,target){const probs=this.forward(input),dout=[probs[0]-target[0],probs[1]-target[1]];for(let i=0;i<8;i++)for(let j=0;j<2;j++){const g=dout[j]*this.hidden[i];this.vw2[i][j]=this.momentum*this.vw2[i][j]-this.lr*g;this.w2[i][j]+=this.vw2[i][j]}for(let j=0;j<2;j++){this.vb2[j]=this.momentum*this.vb2[j]-this.lr*dout[j];this.b2[j]+=this.vb2[j]}const dh=new Array(8).fill(0);for(let i=0;i<8;i++){for(let j=0;j<2;j++)dh[i]+=dout[j]*this.w2[i][j];dh[i]*=this.hidden[i]>0?1:0}for(let i=0;i<10;i++)for(let j=0;j<8;j++){const g=dh[j]*input[i];this.vw1[i][j]=this.momentum*this.vw1[i][j]-this.lr*g;this.w1[i][j]+=this.vw1[i][j]}for(let j=0;j<8;j++){this.vb1[j]=this.momentum*this.vb1[j]-this.lr*dh[j];this.b1[j]+=this.vb1[j]}}
}

class PredictionEngine{
    constructor(){this.nn=new NeuralNetwork();this.history=[];this.predictionLog=[];this.lastPrediction=null;this.y=[];this.patternSuccessCount={};this.patternFailCount={};this.patternStreak={};this.stats={totalSessions:0,totalTai:0,totalXiu:0,correctPredictions:0,wrongPredictions:0,longestTaiStreak:0,longestXiuStreak:0,currentStreakType:null,currentStreakCount:0,startTime:Date.now()};this.loadHistory();this.loadPredictionLog()}
    loadHistory(){try{if(fs.existsSync(HISTORY_FILE)){const d=JSON.parse(fs.readFileSync(HISTORY_FILE,'utf8'));if(d.history)for(const i of d.history){this.history.push(i);this.stats.totalSessions++;i.result==='T'?this.stats.totalTai++:this.stats.totalXiu++}if(d.stats)this.stats={...this.stats,...d.stats,startTime:this.stats.startTime}}}catch(e){}}
    loadPredictionLog(){try{if(fs.existsSync(PRED_FILE)){const d=JSON.parse(fs.readFileSync(PRED_FILE,'utf8'));if(Array.isArray(d))this.predictionLog=d}}catch(e){}}
    saveHistory(){try{fs.writeFileSync(HISTORY_FILE,JSON.stringify({history:this.history.slice(-10000),stats:this.stats},null,2))}catch(e){}}
    savePredictionLog(){try{fs.writeFileSync(PRED_FILE,JSON.stringify(this.predictionLog.slice(-10000),null,2))}catch(e){}}
    getStreak(arr){if(!arr.length)return 0;const l=arr[arr.length-1];let c=0;for(let i=arr.length-1;i>=0&&arr[i]===l;i--)c++;return c}
    extractFeatures(){const r=this.history.map(s=>s.result),n=r.length;if(n<5)return[0.5,0.5,0.5,0,0,0,0.5,0.5,0,0];const gr=(a,l)=>{const s=a.slice(-l);return s.filter(x=>x==='T').length/Math.max(s.length,1)};const r5=gr(r,5),r10=gr(r,10),r20=gr(r,20),sl=this.getStreak(r)/Math.max(n,1),lr=r[n-1]==='T'?1:0;let ts=0;if(this.y.length>0)ts=Math.min(this.y[this.y.length-1]/60,1);const p=r10,ent=p>0&&p<1?-p*Math.log2(p)-(1-p)*Math.log2(1-p):0;let ch=0;const l20=r.slice(-20);for(let i=0;i<l20.length-1;i++)if(l20[i]!==l20[i+1])ch++;const cr=l20.length>1?ch/(l20.length-1):0.5,im=Math.abs(r10-0.5)*2,f10=l20.slice(0,10).filter(x=>x==='T').length,l10=l20.slice(-10).filter(x=>x==='T').length,tr=l10-f10;return[r5,r10,r20,sl,lr,ts,ent,cr,im,tr]}
    analyzeAllPatterns(){if(this.history.length<8)return[];const r=this.history.map(s=>s.result),last=r[r.length-1],l10=r.slice(-10),t10=l10.filter(x=>x==='T').length,m=[];const add=(n,p)=>{const sc=this.patternSuccessCount[n]||0,fc=this.patternFailCount[n]||0,ta=sc+fc,sr=ta>0?sc/ta:0.5,boost=(this.patternStreak[n]||0)>3?1.2:1,penalty=(this.patternStreak[n]||0)<-3?0.8:1,score=clamp(sr*boost*penalty,0.25,0.98);m.push({name:n,score,prediction:p,successRate:sr})};
        {const a=r.slice(-2);if(a.length===2&&a[0]===a[1])add('Bệt ngắn',a[1]==='T')}
        {const a=r.slice(-6);if(a.length===6&&a.every(x=>x===a[0]))add('Bệt dài',a[0]==='T')}
        {const a=r.slice(-3);if(a.length===3&&a[0]===a[2]&&a[0]!==a[1])add('Đảo 1-1 ngắn',a[1]!=='T')}
        {const a=r.slice(-5);if(a.length===5){let ok=true;for(let i=0;i<4;i++)if(a[i]===a[i+1])ok=false;if(ok)add('Đảo 1-1 dài',a[4]!=='T')}}
        {const a=r.slice(-3);if(a.length===3){const tc=a.filter(x=>x==='T').length;if(this.history.length%3!==1&&tc>=2)add('Cầu 1-2',true)}}
        {const a=r.slice(-3);if(a.length===3){const tc=a.filter(x=>x==='T').length;if(this.history.length%3===1&&tc>=2)add('Cầu 2-1',true)}}
        {const a=r.slice(-4);if(a.length===4&&a[0]===a[1]&&a[2]===a[3]&&a[0]!==a[2])add('Kép 2-2',a[2]!=='T')}
        {const a=r.slice(-4);if(a.length===4){const tc=a.filter(x=>x==='T').length;if(tc>=3)add('Cầu 3-1',false);if(tc<=1)add('Cầu 3-1',true)}}
        {const a=r.slice(-5);if(a.length===5&&a[0]===a[2]&&a[2]===a[4]&&a[1]===a[3]&&a[0]!==a[1])add('Cầu 2-1-2',a[4]!=='T')}
        {if(this.y.length>=5){const avg=this.y.slice(-5).reduce((a,b)=>a+b,0)/5;if(avg<5)add('Nhanh',last!=='T');if(avg>30)add('Chậm',last==='T')}}
        {const a=r.slice(-10);if(a.length===10&&a.every(x=>x===a[0]))add('Bệt siêu dài',a[0]==='T')}
        {const s=this.getStreak(r);if(s>=3&&s<=5)add('Bệt xen kẽ',last==='T');if(s>=4&&s<=7)add('Bệt gãy nhẹ',last!=='T');if(s>=6)add('Bệt ngược',last!=='T')}
        {const a=r.slice(-2);if(a.length===2&&a[0]!==a[1])add('Đảo 1-1',a[1]!=='T')}
        {const a=r.slice(-4);if(a.length===4&&a[0]===a[1]&&a[2]===a[3])add('Kép 2-2 MR',a[3]!=='T')}
        {const a=r.slice(-6);if(a.length===6){const f=a.slice(0,3).every(x=>x===a[0]),l=a.slice(3).every(x=>x===a[3]);if(f&&l&&a[0]!==a[3])add('3-3',a[3]!=='T')}}
        {const a=r.slice(-4);if(a.length===4&&a[0]===a[2]&&a[1]===a[3]&&a[0]!==a[1])add('Chu kỳ 2',a[3]!=='T')}
        {const a=r.slice(-6);if(a.length===6&&a[0]===a[3]&&a[1]===a[4]&&a[2]===a[5])add('Chu kỳ 3',a[5]!=='T')}
        {const a=r.slice(-3);const tc=a.filter(x=>x==='T').length;if(tc===2)add('Lặp 2-1',true);if(tc===1)add('Lặp 2-1',false)}
        {const a=r.slice(-5);const tc=a.filter(x=>x==='T').length;if(tc>=3)add('Lặp 3-2',false);if(tc<=2)add('Lặp 3-2',true)}
        {const a=r.slice(-5);if(a.length===5&&a[0]===a[4]&&a[1]===a[3])add('Đối xứng',a[2]!=='T')}
        {const a=r.slice(-5);if(a.length===5){let m=0;for(let i=0;i<5;i++)if(a[i]===a[4-i])m++;if(m>=4)add('Bán đx',a[2]!=='T')}}
        {const a=r.slice(-2);if(a.length===2&&a[0]==='X'&&a[1]==='X')add('Xỉu kép',false);if(a.length===2&&a[0]==='T'&&a[1]==='T')add('Tài kép',true)}
        {const a=r.slice(-7);if(a.length===7){let ok=true;for(let i=0;i<6;i++)if(a[i]===a[i+1])ok=false;if(ok)add('Xen kẽ',a[6]!=='T')}}
        {if(t10>=6)add('Gập ghềnh',true);if(t10<=4)add('Gập ghềnh',false)}
        {add('Bậc thang',last!=='T');add('Gãy ngang',last!=='T');add('Cầu đôi',last!=='T')}
        {add('Ngẫu nhiên',Math.random()<0.5)}
        {if(t10>=5)add('Đa dạng',true);else add('Đa dạng',false)}
        {add('Chu kỳ tăng',last!=='T');add('Chu kỳ giảm',last!=='T')}
        {const a=r.slice(-6);if(a.length>0)add('Cầu lặp',a[0]==='T')}
        {add('Đối ngược',last!=='T')}
        {if(t10>5)add('Phân cụm',true);if(t10<5)add('Phân cụm',false)}
        {if(t10>=5)add('Lệch NN',true);else add('Lệch NN',false)}
        {add('Xen kẽ dài',last!=='T');add('Cầu gập',last!=='T');add('Xỉu lắc',last!=='T');add('Tài lắc',last!=='T')}
        {if(t10>5)add('Phối hợp 1',true);else add('Phối hợp 1',false)}
        {add('Phối hợp 2',t10>=5);add('Phối hợp 3',t10>=5)}
        {add('NN bệt',last==='T')}
        m.sort((a,b)=>b.score-a.score);return m
    }
    predict(sd){
        try{
            if(this.history.length<this.MIN_S){const f=this.extractFeatures(),p=this.nn.forward(f),pred=p[0]>p[1];this.lastPrediction=pred;return{prediction:pred?'T':'X',confidence:Math.round(Math.max(...p)*100),method:'warmup'}}
            const pat=this.analyzeAllPatterns(),f=this.extractFeatures(),nnP=this.nn.forward(f),nnPred=nnP[0]>nnP[1],nnConf=Math.max(...nnP);
            let tV=0,xV=0,tW=0;for(const p of pat){const w=p.score;tW+=w;if(p.prediction)tV+=w;else xV+=w}
            const ePred=tV>xV,eConf=Math.abs(tV-xV)/Math.max(tW,1);
            if(pat.length>0&&pat[0].score>0.72){const inv=!pat[0].prediction;this.lastPrediction=inv;return{prediction:inv?'T':'X',confidence:Math.round(clamp(pat[0].score,0.4,0.6)*100),method:'strong_inv',pattern:pat[0].name}}
            if(pat.length>0&&pat[0].score>0.55){const b=pat[0],combined=(b.prediction?b.score:1-b.score)*0.6+b.successRate*0.4,pred=combined>=0.5;this.lastPrediction=pred;return{prediction:pred?'T':'X',confidence:Math.round(clamp(combined,0.4,0.6)*100),method:'medium',pattern:b.name}}
            const fs=nnConf*0.3+eConf*0.7,fp=fs>0.5?nnPred:ePred;this.lastPrediction=fp;return{prediction:fp?'T':'X',confidence:Math.round(clamp(fs,0.4,0.6)*100),method:'hybrid'}
        }catch(e){log('ERROR','predict: '+e.message);this.lastPrediction=Math.random()<0.5;return{prediction:this.lastPrediction?'T':'X',confidence:50,method:'error'}}
    }
    addResult(ri,sd){
        try{
            const r=normalizeResult(ri),ts=(sd&&sd.timestamp)||Date.now();this.history.push({sessionId:sd?sd.sessionId:'unknown',result:r,total:sd?sd.total:null,timestamp:ts});if(this.history.length>MAX_H)this.history.shift();
            if(this.history.length>=2){this.y.push((this.history.at(-1).timestamp-this.history.at(-2).timestamp)/1000);if(this.y.length>20)this.y.shift()}
            this.stats.totalSessions++;r==='T'?this.stats.totalTai++:this.stats.totalXiu++;
            if(this.stats.currentStreakType===r)this.stats.currentStreakCount++;else{this.stats.currentStreakType=r;this.stats.currentStreakCount=1}
            if(r==='T'&&this.stats.currentStreakCount>this.stats.longestTaiStreak)this.stats.longestTaiStreak=this.stats.currentStreakCount;
            if(r==='X'&&this.stats.currentStreakCount>this.stats.longestXiuStreak)this.stats.longestXiuStreak=this.stats.currentStreakCount;
            if(this.lastPrediction!==null){const p=this.lastPrediction?'T':'X',correct=p===r;this.predictionLog.push({phien:String(sd?sd.sessionId:''),xuc_xac:sd?sd.dice||'':'',tong:sd?sd.total||0:0,ket_qua:r==='T'?'Tài':'Xỉu',du_doan:p==='T'?'Tài':'Xỉu',danh_gia:correct?'DUNG':'SAI',do_tin_cay:'0%',timestamp:new Date().toISOString()});if(this.predictionLog.length>MAX_H)this.predictionLog.shift();correct?this.stats.correctPredictions++:this.stats.wrongPredictions++;const f=this.extractFeatures(),t=r==='T'?[1,0]:[0,1];this.nn.train(f,t)}
        }catch(e){log('ERROR','addResult: '+e.message)}
    }
    getPredictionLog(l){const r=this.predictionLog.slice(-(l||50));r.reverse();return r}
    getAccuracy(){return this.stats.totalSessions>0?(this.stats.correctPredictions/this.stats.totalSessions*100).toFixed(1)+'%':'0.0%'}
    getRuntime(){const s=Math.floor((Date.now()-this.stats.startTime)/1000),m=Math.floor(s/60),h=Math.floor(m/60);return Math.floor(h/24)+'d '+h%24+'h '+m%60+'m'}
}

function connectWebSocket(){
    log('INFO','Connecting WS...');
    try{
        const ws=new WebSocket(WS_URL);
        ws.on('open',()=>{log('INFO','WS Connected!');ws.send(JSON.stringify({H:HUB_NAME,M:'Register',A:[],I:0}))});
        ws.on('message',(data)=>{
            try{
                const msg=JSON.parse(data.toString());
                if(msg.M==='Md5sessionInfo'&&msg.A&&msg.A.length>0){const s=msg.A[0];if(s.CurrentState===1&&s.Dice1>0){const d1=s.Dice1,d2=s.Dice2,d3=s.Dice3,total=d1+d2+d3,result=total>=11?'Tài':'Xỉu',sid=s.SessionId;engine.addResult(result,{sessionId:sid,total,dice:d1+'-'+d2+'-'+d3,timestamp:Date.now()});const p=engine.predict({sessionId:sid+1});console.log('#'+sid+': ['+d1+','+d2+','+d3+']='+total+'->'+result+' | Du doan: '+(p.prediction==='T'?'TAI':'XIU')+'('+p.confidence+'%) | Acc: '+engine.getAccuracy())}}
            }catch(e){}
        });
        ws.on('close',()=>{log('WARN','WS closed');setTimeout(connectWebSocket,5000)});
        ws.on('error',()=>setTimeout(connectWebSocket,5000));
    }catch(e){setTimeout(connectWebSocket,5000)}
}

const server=http.createServer((req,res)=>{
    res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');if(req.method==='OPTIONS'){res.writeHead(200);res.end();return}
    const url=new URL(req.url,'http://localhost:'+API_PORT),pn=url.pathname;
    try{
        if(pn==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'running',sessions:engine.stats.totalSessions,accuracy:engine.getAccuracy()}))}
        else if(pn==='/api/predict'){const p=engine.predict({});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({prediction:p.prediction==='T'?'Tài':'Xỉu',confidence:p.confidence,method:p.method}))}
        else if(pn==='/api/stats'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({sessions:engine.stats.totalSessions,correct:engine.stats.correctPredictions,wrong:engine.stats.wrongPredictions,accuracy:engine.getAccuracy()}))}
        else if(pn==='/api/prediction_log'){const l=parseInt(url.searchParams.get('limit')||'50');res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(engine.getPredictionLog(l)))}
        else if(pn==='/'){const s=engine.stats;res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end('<html><head><meta charset="utf-8"><title>XocDia88</title><meta http-equiv="refresh" content="5"><style>body{font-family:monospace;background:#0a0a0a;color:#0f0;padding:20px}</style></head><body><h1>XocDia88</h1><p>Sessions: '+s.totalSessions+'</p><p>Accuracy: '+engine.getAccuracy()+'</p><p>Correct: '+s.correctPredictions+' | Wrong: '+s.wrongPredictions+'</p><p>Runtime: '+engine.getRuntime()+'</p></body></html>')}
        else{res.writeHead(404);res.end('Not found')}
    }catch(e){res.writeHead(500);res.end(e.message)}
});

const engine=new PredictionEngine();ensureDir();connectWebSocket();setInterval(()=>{engine.saveHistory();engine.savePredictionLog()},SAVE_MS);server.listen(API_PORT,()=>console.log('XocDia88 port '+API_PORT));process.on('SIGINT',()=>{engine.saveHistory();engine.savePredictionLog();process.exit(0)});
