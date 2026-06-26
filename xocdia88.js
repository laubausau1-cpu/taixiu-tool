const WebSocket=require('ws'),fs=require('fs'),path=require('path'),http=require('http');
const WS_URL=process.env.WS_URL||'wss://taixiumd5.system32-cloudfare-356783752985678522.monster/signalr/connect?transport=webSockets&connectionToken=z0%2Bp4sHHXusB7hFR4ZBSkc7TBejGa%2BoooswT8oNe8KhHmsJEIWLTtZh40jp%2FuaCUuwj1vJOAqw%2Fc1EBSv7ebeZGlhgS2FeQ1GNBYU%2F5AVausPA4HmHluu0RJW1Pwcy9H&connectionData=%5B%7B%22name%22%3A%22md5luckydiceHub%22%7D%5D&tid=1';
const HUB_NAME='md5luckydiceHub',DATA_DIR=path.join(__dirname,'data');
const API_PORT=parseInt(process.env.PORT||'8888'),MAX_H=100000,MIN_S=6;

function log(l,m){console.log(`[${new Date().toISOString()}] [${l}] ${m}`);}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function sigmoid(x){return 1/(1+Math.exp(-x));}
function normalizeResult(r){if(!r)return'T';const m={t:'T',tai:'T','tài':'T',x:'X',xiu:'X','xỉu':'X'};return m[r.trim().toLowerCase()]||'T';}
function getLastN(a,n){const r=[];for(let i=a.length-1;i>=0&&r.length<n;i--)r.push(a[i]);r.reverse();return r;}

function getDiceScore(t){if(t<=4)return'X';if(t<=10)return'X';return'T';}

class Engine{
    constructor(){
        this.history=[];
        this.predictionLog=[];
        this.lastPrediction=null;
        this.y=[];
        this.patternWeights={};
        this.patternSuccessCount={};
        this.patternFailCount={};
        this.patternStreak={};
        this.stats={
            totalSessions:0,
            totalTai:0,
            totalXiu:0,
            correctPredictions:0,
            wrongPredictions:0,
            longestTaiStreak:0,
            longestXiuStreak:0,
            currentStreakType:null,
            currentStreakCount:0,
            startTime:Date.now()
        };
        this.loadHistory();
        this.loadPredictionLog();
    }

    loadHistory(){
        try{
            if(fs.existsSync(DATA_DIR+'/history.json')){
                const d=JSON.parse(fs.readFileSync(DATA_DIR+'/history.json','utf8'));
                if(d.history){
                    for(const i of d.history){
                        this.history.push(i);
                        this.stats.totalSessions++;
                        if(i.result==='T')this.stats.totalTai++;
                        else this.stats.totalXiu++;
                    }
                }
                if(d.stats)this.stats={...this.stats,...d.stats,startTime:this.stats.startTime};
            }
        }catch(e){}
    }

    loadPredictionLog(){
        try{
            if(fs.existsSync(DATA_DIR+'/prediction_log.json')){
                const d=JSON.parse(fs.readFileSync(DATA_DIR+'/prediction_log.json','utf8'));
                if(Array.isArray(d))this.predictionLog=d;
            }
        }catch(e){}
    }

    saveHistory(){
        try{
            fs.writeFileSync(DATA_DIR+'/history.json',JSON.stringify({
                history:this.history.slice(-10000),
                stats:this.stats
            },null,2));
        }catch(e){}
    }

    savePredictionLog(){
        try{
            fs.writeFileSync(DATA_DIR+'/prediction_log.json',JSON.stringify(
                this.predictionLog.slice(-10000),null,2
            ));
        }catch(e){}
    }

    getStreak(arr){
        if(!arr.length)return 0;
        const last=arr[arr.length-1];
        let c=0;
        for(let i=arr.length-1;i>=0;i--){
            if(arr[i]!==last)break;
            c++;
        }
        return c;
    }

    analyze(){
        if(this.history.length<8)return[];
        const results=this.history.map(s=>s.result);
        const last=results[results.length-1];
        const last10=results.slice(-10);
        const taiCount10=last10.filter(r=>r==='T').length;
        const lastTotal=this.history[this.history.length-1].total;
        const matched=[];

        function addP(name,pred){
            const sc=this.patternSuccessCount[name]||0;
            const fc=this.patternFailCount[name]||0;
            const ta=sc+fc;
            const sr=ta>0?sc/ta:0.5;
            const boost=(this.patternStreak[name]||0)>3?1.2:1;
            const penalty=(this.patternStreak[name]||0)<-3?0.8:1;
            const score=clamp(sr*boost*penalty,0.25,0.98);
            matched.push({name,score,prediction:pred,successRate:sr});
        }

        const add=addP.bind(this);

        // 1. Dice Score
        if(lastTotal){
            const dp=getDiceScore(lastTotal);
            add('DiceScore',dp==='T');
        }

        // 2. Bệt ngắn
        {
            const a=results.slice(-2);
            if(a.length===2&&a[0]===a[1])add('Bệt ngắn',a[1]==='T');
        }

        // 3. Bệt dài
        {
            const a=results.slice(-6);
            if(a.length===6&&a.every(r=>r===a[0]))add('Bệt dài',a[0]==='T');
        }

        // 4. Đảo 1-1 ngắn
        {
            const a=results.slice(-3);
            if(a.length===3&&a[0]===a[2]&&a[0]!==a[1])add('Đảo 1-1 ngắn',a[1]!=='T');
        }

        // 5. Đảo 1-1 dài
        {
            const a=results.slice(-5);
            if(a.length===5){
                let ok=true;
                for(let i=0;i<4;i++)if(a[i]===a[i+1])ok=false;
                if(ok)add('Đảo 1-1 dài',a[4]!=='T');
            }
        }

        // 6. Cầu 1-2
        {
            const a=results.slice(-3);
            if(a.length===3){
                const tc=a.filter(r=>r==='T').length;
                if(this.history.length%3!==1&&tc>=2)add('Cầu 1-2',true);
            }
        }

        // 7. Cầu 2-1
        {
            const a=results.slice(-3);
            if(a.length===3){
                const tc=a.filter(r=>r==='T').length;
                if(this.history.length%3===1&&tc>=2)add('Cầu 2-1',true);
            }
        }

        // 8. Kép 2-2
        {
            const a=results.slice(-4);
            if(a.length===4&&a[0]===a[1]&&a[2]===a[3]&&a[0]!==a[2])add('Kép 2-2',a[2]!=='T');
        }

        // 9. Cầu 3-1
        {
            const a=results.slice(-4);
            if(a.length===4){
                const tc=a.filter(r=>r==='T').length;
                if(tc>=3)add('Cầu 3-1',false);
                if(tc<=1)add('Cầu 3-1',true);
            }
        }

        // 10. Cầu 2-1-2
        {
            const a=results.slice(-5);
            if(a.length===5&&a[0]===a[2]&&a[2]===a[4]&&a[1]===a[3]&&a[0]!==a[1])add('Cầu 2-1-2',a[4]!=='T');
        }

        // 11. Cầu thời gian nhanh
        {
            if(this.y.length>=5){
                const avg=this.y.slice(-5).reduce((a,b)=>a+b,0)/5;
                if(avg<5)add('Cầu thời gian nhanh',last!=='T');
            }
        }

        // 12. Cầu thời gian chậm
        {
            if(this.y.length>=5){
                const avg=this.y.slice(-5).reduce((a,b)=>a+b,0)/5;
                if(avg>30)add('Cầu thời gian chậm',last==='T');
            }
        }

        // 13. Bệt siêu dài
        {
            const a=results.slice(-10);
            if(a.length===10&&a.every(r=>r===a[0]))add('Bệt siêu dài',a[0]==='T');
        }

        // 14. Bệt xen kẽ ngắn
        {
            const s=this.getStreak(results);
            if(s>=3&&s<=5)add('Bệt xen kẽ ngắn',last==='T');
        }

        // 15. Bệt gãy nhẹ
        {
            const s=this.getStreak(results);
            if(s>=4&&s<=7)add('Bệt gãy nhẹ',last!=='T');
        }

        // 16. Đảo 1-1
        {
            const a=results.slice(-2);
            if(a.length===2&&a[0]!==a[1])add('Đảo 1-1',a[1]!=='T');
        }

        // 17. Kép 2-2 mở rộng
        {
            const a=results.slice(-4);
            if(a.length===4&&a[0]===a[1]&&a[2]===a[3])add('Kép 2-2 mở rộng',a[3]!=='T');
        }

        // 18. 3-3
        {
            const a=results.slice(-6);
            if(a.length===6){
                const f=a.slice(0,3).every(r=>r===a[0]);
                const l=a.slice(3).every(r=>r===a[3]);
                if(f&&l&&a[0]!==a[3])add('3-3',a[3]!=='T');
            }
        }

        // 19. Chu kỳ 2
        {
            const a=results.slice(-4);
            if(a.length===4&&a[0]===a[2]&&a[1]===a[3]&&a[0]!==a[1])add('Chu kỳ 2',a[3]!=='T');
        }

        // 20. Chu kỳ 3
        {
            const a=results.slice(-6);
            if(a.length===6&&a[0]===a[3]&&a[1]===a[4]&&a[2]===a[5])add('Chu kỳ 3',a[5]!=='T');
        }

        // 21. Lặp 2-1
        {
            const a=results.slice(-3);
            const tc=a.filter(r=>r==='T').length;
            if(tc===2)add('Lặp 2-1',true);
            if(tc===1)add('Lặp 2-1',false);
        }

        // 22. Lặp 3-2
        {
            const a=results.slice(-5);
            const tc=a.filter(r=>r==='T').length;
            if(tc>=3)add('Lặp 3-2',false);
            if(tc<=2)add('Lặp 3-2',true);
        }

        // 23. Đối xứng
        {
            const a=results.slice(-5);
            if(a.length===5&&a[0]===a[4]&&a[1]===a[3])add('Đối xứng',a[2]!=='T');
        }

        // 24. Bán đối xứng
        {
            const a=results.slice(-5);
            if(a.length===5){
                let m=0;
                for(let i=0;i<5;i++)if(a[i]===a[4-i])m++;
                if(m>=4)add('Bán đối xứng',a[2]!=='T');
            }
        }

        // 25. Bệt ngược
        {
            if(this.getStreak(results)>=6)add('Bệt ngược',last!=='T');
        }

        // 26. Xỉu kép
        {
            const a=results.slice(-2);
            if(a.length===2&&a[0]==='X'&&a[1]==='X')add('Xỉu kép',false);
        }

        // 27. Tài kép
        {
            const a=results.slice(-2);
            if(a.length===2&&a[0]==='T'&&a[1]==='T')add('Tài kép',true);
        }

        // 28. Xen kẽ
        {
            const a=results.slice(-7);
            if(a.length===7){
                let ok=true;
                for(let i=0;i<6;i++)if(a[i]===a[i+1])ok=false;
                if(ok)add('Xen kẽ',a[6]!=='T');
            }
        }

        // 29. Gập ghềnh
        {
            if(taiCount10>=6)add('Gập ghềnh',true);
            if(taiCount10<=4)add('Gập ghềnh',false);
        }

        // 30. Bậc thang
        add('Bậc thang',last!=='T');

        // 31. Gãy ngang
        add('Gãy ngang',last!=='T');

        // 32. Cầu đôi
        add('Cầu đôi',last!=='T');

        // 33. Ngẫu nhiên
        add('Ngẫu nhiên',Math.random()<0.5);

        // 34. Đa dạng
        {
            if(taiCount10>=5)add('Đa dạng',true);
            else add('Đa dạng',false);
        }

        // 35. Chu kỳ tăng
        add('Chu kỳ tăng',last!=='T');

        // 36. Chu kỳ giảm
        add('Chu kỳ giảm',last!=='T');

        // 37. Cầu lặp
        {
            const a=results.slice(-6);
            if(a.length>0)add('Cầu lặp',a[0]==='T');
        }

        // 38. Đối ngược
        add('Đối ngược',last!=='T');

        // 39. Phân cụm
        {
            if(taiCount10>5)add('Phân cụm',true);
            if(taiCount10<5)add('Phân cụm',false);
        }

        // 40. Lệch ngẫu nhiên
        {
            if(taiCount10>=5)add('Lệch ngẫu nhiên',true);
            else add('Lệch ngẫu nhiên',false);
        }

        // 41. Xen kẽ dài
        add('Xen kẽ dài',last!=='T');

        // 42. Cầu gập
        add('Cầu gập',last!=='T');

        // 43. Xỉu lắc
        add('Xỉu lắc',last!=='T');

        // 44. Tài lắc
        add('Tài lắc',last!=='T');

        // 45. Phối hợp 1
        {
            if(taiCount10>5)add('Phối hợp 1',true);
            else add('Phối hợp 1',false);
        }

        // 46. Phối hợp 2
        add('Phối hợp 2',taiCount10>=5);

        // 47. Phối hợp 3
        add('Phối hợp 3',taiCount10>=5);

        // 48. Ngẫu nhiên bệt
        add('Ngẫu nhiên bệt',last==='T');

        matched.sort((a,b)=>b.score-a.score);
        return matched;
    }

    predict(sd){
        try{
            const total=sd&&sd.total?sd.total:null;
            const results=this.history.map(s=>s.result);
            const last=results.length?results[results.length-1]:null;

            if(this.history.length<this.MIN_S){
                let pred=null;
                if(total){pred=getDiceScore(total)==='T';}
                else if(last){pred=last!=='T';}
                else{pred=Math.random()<0.5;}
                this.lastPrediction=pred;
                log('DEBUG','WARMUP: total='+total+' last='+last+' -> pred='+(pred?'T':'X'));
                return{prediction:pred?'T':'X',confidence:50,method:'warmup'};
            }

            const a=this.analyze();
            if(!a.length){
                let pred=last?last!=='T':Math.random()<0.5;
                this.lastPrediction=pred;
                return{prediction:pred?'T':'X',confidence:50,method:'fallback'};
            }

            let taiVotes=0,xiuVotes=0,totalWeight=0;
            for(const p of a){
                const w=p.score;
                totalWeight+=w;
                if(p.prediction)taiVotes+=w;
                else xiuVotes+=w;
            }

            if(total){
                const dp=getDiceScore(total);
                if(dp==='T')taiVotes+=0.5;
                else xiuVotes+=0.5;
                totalWeight+=0.5;
            }

            if(last){
                if(last==='T')xiuVotes+=0.3;
                else taiVotes+=0.3;
                totalWeight+=0.3;
            }

            log('DEBUG','VOTES: tai='+taiVotes.toFixed(2)+' xiu='+xiuVotes.toFixed(2)+' total='+totalWeight.toFixed(2));

            if(a[0].score>0.72){
                const inv=!a[0].prediction;
                this.lastPrediction=inv;
                log('DEBUG','STRONG: '+a[0].name+' score='+a[0].score.toFixed(2)+' -> INV='+(inv?'T':'X'));
                return{
                    prediction:inv?'T':'X',
                    confidence:Math.round(clamp(a[0].score,0.4,0.6)*100),
                    method:'strong_inv',
                    pattern:a[0].name
                };
            }

            if(a[0].score>0.55){
                const b=a[0];
                const combined=(b.prediction?b.score:1-b.score)*0.6+b.successRate*0.4;
                const pred=combined>=0.5;
                this.lastPrediction=pred;
                log('DEBUG','MEDIUM: '+b.name+' score='+b.score.toFixed(2)+' combined='+combined.toFixed(2)+' -> '+(pred?'T':'X'));
                return{
                    prediction:pred?'T':'X',
                    confidence:Math.round(clamp(combined,0.4,0.6)*100),
                    method:'medium',
                    pattern:b.name
                };
            }

            const ep=taiVotes>xiuVotes;
            const conf=totalWeight>0?Math.abs(taiVotes-xiuVotes)/totalWeight:0.5;
            this.lastPrediction=ep;
            log('DEBUG','ENSEMBLE: '+ep+' conf='+conf.toFixed(2));
            return{
                prediction:ep?'T':'X',
                confidence:Math.round(clamp(conf,0.4,0.6)*100),
                method:'ensemble'
            };
        }catch(e){
            log('ERROR','predict: '+e.message);
            this.lastPrediction=Math.random()<0.5;
            return{prediction:this.lastPrediction?'T':'X',confidence:50,method:'error'};
        }
    }

    addResult(ri,sd){
        try{
            const r=normalizeResult(ri);
            const ts=(sd&&sd.timestamp)||Date.now();
            this.history.push({
                sessionId:sd?sd.sessionId:'unknown',
                result:r,
                total:sd?sd.total:null,
                timestamp:ts
            });
            if(this.history.length>MAX_H)this.history.shift();
            if(this.history.length>=2){
                this.y.push((this.history.at(-1).timestamp-this.history.at(-2).timestamp)/1000);
                if(this.y.length>20)this.y.shift();
            }
            this.stats.totalSessions++;
            if(r==='T')this.stats.totalTai++;
            else this.stats.totalXiu++;
            if(this.stats.currentStreakType===r){
                this.stats.currentStreakCount++;
            }else{
                this.stats.currentStreakType=r;
                this.stats.currentStreakCount=1;
            }
            if(r==='T'&&this.stats.currentStreakCount>this.stats.longestTaiStreak){
                this.stats.longestTaiStreak=this.stats.currentStreakCount;
            }
            if(r==='X'&&this.stats.currentStreakCount>this.stats.longestXiuStreak){
                this.stats.longestXiuStreak=this.stats.currentStreakCount;
            }
            if(this.lastPrediction!==null){
                const p=this.lastPrediction?'T':'X';
                const correct=p===r;
                this.predictionLog.push({
                    phien:String(sd?sd.sessionId:''),
                    xuc_xac:sd?sd.dice||'':'',
                    tong:sd?sd.total||0:0,
                    ket_qua:r==='T'?'Tài':'Xỉu',
                    du_doan:p==='T'?'Tài':'Xỉu',
                    danh_gia:correct?'✅ ĐÚNG':'❌ SAI',
                    do_tin_cay:'0%',
                    timestamp:new Date().toISOString()
                });
                if(this.predictionLog.length>MAX_H)this.predictionLog.shift();
                if(correct)this.stats.correctPredictions++;
                else this.stats.wrongPredictions++;
            }
        }catch(e){}
    }

    getPredictionLog(l){
        const r=this.predictionLog.slice(-(l||50));
        r.reverse();
        return r;
    }

    getAccuracy(){
        return this.stats.totalSessions>0
            ?(this.stats.correctPredictions/this.stats.totalSessions*100).toFixed(1)+'%'
            :'0.0%';
    }

    getRuntime(){
        const s=Math.floor((Date.now()-this.stats.startTime)/1000);
        const m=Math.floor(s/60);
        const h=Math.floor(m/60);
        return Math.floor(h/24)+'d '+h%24+'h '+m%60+'m';
    }
}

// ============================================================
// WEBSOCKET CLIENT
// ============================================================

let reconnectAttempts=0;

function connectWS(){
    log('INFO','Connecting WS...');
    try{
        const ws=new WebSocket(WS_URL);
        ws.on('open',function(){
            log('INFO','WS Connected!');
            reconnectAttempts=0;
            ws.send(JSON.stringify({H:HUB_NAME,M:'Register',A:[],I:0}));
        });
        ws.on('message',function(data){
            try{
                const msg=JSON.parse(data.toString());
                if(msg.M==='Md5sessionInfo'&&msg.A&&msg.A.length>0){
                    const s=msg.A[0];
                    if(s.CurrentState===1&&s.Dice1>0){
                        const d1=s.Dice1,d2=s.Dice2,d3=s.Dice3;
                        const total=d1+d2+d3;
                        const result=total>=11?'Tài':'Xỉu';
                        const sid=s.SessionId;
                        engine.addResult(result,{
                            sessionId:sid,
                            total:total,
                            dice:d1+'-'+d2+'-'+d3,
                            timestamp:Date.now()
                        });
                        const p=engine.predict({sessionId:sid+1,total:null});
                        console.log('');
                        console.log('========================================');
                        console.log('PHIEN #'+sid);
                        console.log('XUC XAC: ['+d1+','+d2+','+d3+'] = '+total+' -> '+result);
                        console.log('DU DOAN: '+ (p.prediction==='T'?'TAI':'XIU') +' ('+p.confidence+'%, '+p.method+')');
                        console.log('ACCURACY: '+engine.getAccuracy()+' | '+engine.stats.totalSessions+' phien');
                        console.log('========================================');
                    }
                }
            }catch(e){}
        });
        ws.on('close',function(){
            const d=Math.min(1000*Math.pow(1.5,reconnectAttempts),30000);
            reconnectAttempts++;
            log('WARN','WS closed, reconnect in '+Math.round(d/1000)+'s');
            setTimeout(connectWS,d);
        });
        ws.on('error',function(){
            setTimeout(connectWS,5000);
        });
    }catch(e){
        setTimeout(connectWS,5000);
    }
}

// ============================================================
// API SERVER
// ============================================================

const server=http.createServer(function(req,res){
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
    if(req.method==='OPTIONS'){res.writeHead(200);res.end();return;}

    const url=new URL(req.url,'http://localhost:'+API_PORT);
    const pn=url.pathname;

    try{
        if(pn==='/health'){
            res.writeHead(200,{'Content-Type':'application/json'});
            res.end(JSON.stringify({
                status:'running',
                version:'1.0.0',
                sessions:engine.stats.totalSessions,
                accuracy:engine.getAccuracy(),
                runtime:engine.getRuntime()
            }));
            return;
        }

        if(pn==='/api/predict'){
            const p=engine.predict({});
            res.writeHead(200,{'Content-Type':'application/json'});
            res.end(JSON.stringify({
                success:true,
                prediction:p.prediction==='T'?'Tài':'Xỉu',
                confidence:p.confidence,
                method:p.method,
                pattern:p.pattern||''
            }));
            return;
        }

        if(pn==='/api/stats'){
            res.writeHead(200,{'Content-Type':'application/json'});
            res.end(JSON.stringify({
                totalSessions:engine.stats.totalSessions,
                totalTai:engine.stats.totalTai,
                totalXiu:engine.stats.totalXiu,
                correctPredictions:engine.stats.correctPredictions,
                wrongPredictions:engine.stats.wrongPredictions,
                accuracy:engine.getAccuracy(),
                runtime:engine.getRuntime(),
                longestTaiStreak:engine.stats.longestTaiStreak,
                longestXiuStreak:engine.stats.longestXiuStreak,
                currentStreak:(engine.stats.currentStreakType||'N/A')+' x'+engine.stats.currentStreakCount
            }));
            return;
        }

        if(pn==='/api/prediction_log'){
            const limit=parseInt(url.searchParams.get('limit')||'50');
            res.writeHead(200,{'Content-Type':'application/json'});
            res.end(JSON.stringify(engine.getPredictionLog(limit)));
            return;
        }

        if(pn==='/'){
            const s=engine.stats;
            res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
            res.end(
                '<html><head><meta charset="utf-8"><title>XocDia88</title>'+
                '<meta http-equiv="refresh" content="5">'+
                '<style>body{font-family:monospace;background:#0a0a0a;color:#0f0;padding:20px}'+
                '.box{border:1px solid #0f0;padding:15px;margin:10px 0}h1{color:#0ff}</style></head>'+
                '<body><h1>XocDia88 - Engine MD5</h1>'+
                '<div class="box"><p>Phien: <b>'+s.totalSessions+'</b></p>'+
                '<p>Accuracy: <b>'+engine.getAccuracy()+'</b></p>'+
                '<p>Dung: '+s.correctPredictions+' | Sai: '+s.wrongPredictions+'</p>'+
                '<p>Runtime: '+engine.getRuntime()+'</p>'+
                '<p>Streak: '+(s.currentStreakType||'N/A')+' x'+s.currentStreakCount+'</p></div>'+
                '<p>API: /health | /api/predict | /api/stats | /api/prediction_log</p>'+
                '<p>'+new Date().toISOString()+'</p></body></html>'
            );
            return;
        }

        res.writeHead(404);
        res.end('Not found');
    }catch(e){
        res.writeHead(500);
        res.end(e.message);
    }
});

// ============================================================
// START
// ============================================================

const engine=new Engine();

try{
    if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true});
}catch(e){}

connectWS();

setInterval(function(){
    engine.saveHistory();
    engine.savePredictionLog();
},300000);

server.listen(API_PORT,function(){
    console.log('');
    console.log('========================================');
    console.log('  XocDia88 - Engine MD5');
    console.log('  Port: '+API_PORT);
    console.log('  API: http://localhost:'+API_PORT);
    console.log('========================================');
    console.log('');
});

process.on('SIGINT',function(){
    engine.saveHistory();
    engine.savePredictionLog();
    process.exit(0);
});
