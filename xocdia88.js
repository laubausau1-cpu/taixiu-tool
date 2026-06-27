const WebSocket=require('ws'),fs=require('fs'),path=require('path'),http=require('http');
const WS_URL=process.env.WS_URL||'wss://taixiumd5.system32-cloudfare-356783752985678522.monster/signalr/connect?transport=webSockets&connectionToken=z0%2Bp4sHHXusB7hFR4ZBSkc7TBejGa%2BoooswT8oNe8KhHmsJEIWLTtZh40jp%2FuaCUuwj1vJOAqw%2Fc1EBSv7ebeZGlhgS2FeQ1GNBYU%2F5AVausPA4HmHluu0RJW1Pwcy9H&connectionData=%5B%7B%22name%22%3A%22md5luckydiceHub%22%7D%5D&tid=1';
const HUB_NAME='md5luckydiceHub',DATA_DIR=path.join(__dirname,'data'),API_PORT=parseInt(process.env.PORT||'8888'),SAVE_MS=300000,MAX_H=100000,MIN_S=6;

function ensureDir(){try{if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true})}catch(e){}}
function log(l,m){console.log('['+new Date().toISOString()+'] ['+l+'] '+m)}
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}

function diceScore(total){
    if(total<=4)return{pred:'X',conf:99};
    if(total===5)return{pred:'X',conf:60};
    if(total>=6&&total<=10)return{pred:'X',conf:75};
    if(total===11)return{pred:'T',conf:60};
    if(total>=12&&total<=14)return{pred:'T',conf:75};
    if(total>=15)return{pred:'T',conf:99};
    return{pred:'T',conf:50};
}

class PredictionEngine{
    constructor(){
        this.history=[];this.predictionLog=[];this.lastPrediction=null;
        this.stats={total:0,tai:0,xiu:0,correct:0,wrong:0,curType:'',curStreak:0,startTime:Date.now()};
        this.patternSuccess={};this.patternFail={};this.recentPreds=[];
        this.load();
    }
    
    load(){
        try{
            const f=DATA_DIR+'/state.json';
            if(fs.existsSync(f)){
                const d=JSON.parse(fs.readFileSync(f,'utf8'));
                if(d.history)this.history=d.history;
                if(d.stats)this.stats={...this.stats,...d.stats};
                if(d.predictionLog)this.predictionLog=d.predictionLog;
            }
        }catch(e){}
    }
    
    save(){
        try{
            fs.writeFileSync(DATA_DIR+'/state.json',JSON.stringify({
                history:this.history.slice(-5000),
                stats:this.stats,
                predictionLog:this.predictionLog.slice(-5000)
            }));
        }catch(e){}
    }
    
    getStreak(arr){if(!arr.length)return 0;const l=arr[arr.length-1];let c=0;for(let i=arr.length-1;i>=0&&arr[i]===l;i--)c++;return c}
    countOcc(a,v){let c=0;for(let i=0;i<a.length;i++)if(a[i]===v)c++;return c}
    lastEl(arr,n){return arr.slice(-Math.min(n,arr.length))}
    elEnd(arr,p){return p<=0||p>arr.length?null:arr[arr.length-p]}
    
    analyze(){
        if(this.history.length<3)return[];
        const res=[],h=this.lastEl(this.history,80);
        const add=(n,p,s)=>{res.push({name:n,score:s||0.5,prediction:p})};
        const lst=(n)=>this.elEnd(h,n);
        const cnt=(a,v)=>this.countOcc(a,v);
        const sl=(n)=>this.lastEl(h,n);
        
        if(h.length>=2&&lst(1)===lst(2))add('1.Bet ngan',lst(1)==='T',0.68);
        let l6=sl(6),t6=cnt(l6,'T');if(t6>=6)add('2.Bet dai T',true,0.85);if(t6<=0)add('2.Bet dai X',false,0.85);
        if(h.length>=3&&lst(1)===lst(3)&&lst(1)!==lst(2))add('3.Dao 1-1 ngan',lst(1)!=='T',0.72);
        let l5=sl(5),alt=true;for(let i=1;i<5;i++)if(l5[i]===l5[i-1]){alt=false;break}if(alt)add('4.Dao 1-1 dai',l5[4]!=='T',0.75);
        let sz=h.length%3;if(sz===0||sz===2){let l3=sl(3),t3=cnt(l3,'T');add('5.Cau 1-2',t3>=2,0.62);}
        if(sz===1){let l3=sl(3),t3=cnt(l3,'T');add('6.Cau 2-1',!(t3>=2),0.62);}
        let l4=sl(4);if(l4.length===4&&l4[0]===l4[1]&&l4[2]===l4[3]&&l4[0]!==l4[2])add('7.Kep 2-2',l4[3]!=='T',0.75);
        l4=sl(4);let t4=cnt(l4,'T');if(t4>=3&&l4[3]!==l4[2])add('8.Cau 3-1 T',l4[2]==='T',0.69);if(t4<=1&&l4[3]!==l4[2])add('8.Cau 3-1 X',l4[2]==='T',0.69);
        let l10=sl(10),t10=cnt(l10,'T');if(t10>(10-t10))add('9.Imbalance T',true,0.68);if((10-t10)>t10)add('9.Imbalance X',false,0.68);
        add('10.Ngau nhien',Math.random()<0.5,0.40);
        l10=sl(10);t10=cnt(l10,'T');if(t10>=10)add('11.Sieu bet T',true,0.95);if(t10<=0)add('11.Sieu bet X',false,0.95);
        let st=this.getStreak(h);if(st>=3&&st<=5)add('12.Bet xen ke',h[h.length-1]!=='T',0.55);
        st=this.getStreak(h);if(st>=4&&st<=7)add('13.Bet gay nhe',h[h.length-1]!=='T',0.65);
        if(h.length>=2&&lst(1)!==lst(2))add('14.Dao 1-1',lst(2)==='T',0.58);
        l4=sl(4);if(l4.length===4&&((l4[0]===l4[1]&&l4[2]===l4[3]&&l4[0]!==l4[2])||(l4[0]===l4[2]&&l4[1]===l4[3]&&l4[0]!==l4[1])))add('15.Kep 2-2 MR',l4[3]!=='T',0.72);
        l6=sl(6);if(l6.length===6&&l6[0]===l6[1]&&l6[1]===l6[2]&&l6[3]===l6[4]&&l6[4]===l6[5]&&l6[0]!==l6[3])add('16.3-3',l6[5]!=='T',0.78);
        l4=sl(4);if(l4.length===4&&l4[0]===l4[2]&&l4[1]===l4[3]&&l4[0]!==l4[1])add('17.Chu ky 2',l4[3]!=='T',0.68);
        l6=sl(6);if(l6.length===6&&l6[0]===l6[3]&&l6[1]===l6[4]&&l6[2]===l6[5]&&l6[0]!==l6[1])add('18.Chu ky 3',l6[5]!=='T',0.65);
        let l2=sl(2);if(l2.length===2)add('19.Lap 2-1',l2[0]==='T',0.55);
        let l3=sl(3);if(l3.length===3)add('20.Lap 3-2',l3[0]==='T',0.55);
        l5=sl(5);if(l5.length===5){let rev=[...l5].reverse();if(l5.join('')===rev.join(''))add('21.Doi xung',l5[0]!=='T',0.78);}
        l5=sl(5);if(l5.length===5){let rev=[...l5].reverse();let m=0;for(let i=0;i<5;i++)if(l5[i]===rev[i])m++;if(m>=4)add('22.Ban doi xung',l5[2]!=='T',0.62);}
        st=this.getStreak(h);if(st>=6)add('23.Bet nguoc',h[h.length-1]!=='T',0.80);
        if(lst(1)==='X'&&lst(2)==='X')add('24.Xiu kep',false,0.60);
        if(lst(1)==='T'&&lst(2)==='T')add('25.Tai kep',true,0.60);
        let l7=sl(7);alt=true;for(let i=1;i<7;i++)if(l7[i]===l7[i-1]){alt=false;break}if(alt)add('26.Xen ke',l7[6]!=='T',0.72);
        l10=sl(10);t10=cnt(l10,'T');if(t10>=6)add('27.Gap ghenh T',true,0.62);if(t10<=4)add('27.Gap ghenh X',false,0.62);
        st=this.getStreak(h);if(st>=5)add('28.Bac thang',h[h.length-1]!=='T',0.70);
        st=this.getStreak(h);if(st>=3&&st<=5)add('29.Gay ngang',h[h.length-1]!=='T',0.65);
        l2=sl(2);if(l2.length===2&&l2[0]===l2[1])add('30.Cau doi',l2[0]!=='T',0.60);
        add('31.Da dang',Math.random()<0.5,0.50);
        st=this.getStreak(h);if(st>=3)add('32.Chu ky tang',h[h.length-1]==='T',0.55);
        st=this.getStreak(h);if(st>=3)add('33.Chu ky giam',h[h.length-1]!=='T',0.55);
        l6=sl(6);if(l6.length===6)add('34.Cau lap',l6[0]==='T',0.65);
        let last=h[h.length-1];if(last)add('35.Doi nguoc',last!=='T',0.55);
        l10=sl(10);t10=cnt(l10,'T');if(t10>5)add('36.Phan cum T',true,0.55);if(t10<5)add('36.Phan cum X',false,0.55);
        l10=sl(10);t10=cnt(l10,'T');if(t10>=5)add('37.Lech NN T',true,0.55);if(t10<5)add('37.Lech NN X',false,0.55);
        last=h[h.length-1];if(last)add('38.Xen ke dai',last!=='T',0.58);
        last=h[h.length-1];if(last)add('39.Cau gap',last!=='T',0.58);
        last=h[h.length-1];if(last)add('40.Xiu lac',last!=='T',0.58);
        last=h[h.length-1];if(last)add('41.Tai lac',last!=='T',0.58);
        l10=sl(10);t10=cnt(l10,'T');if(t10>5)add('42.Phoi hop 1',true,0.55);if(t10<5)add('42.Phoi hop 1',false,0.55);
        let l20=sl(20),t20=cnt(l20,'T');if(l20.length>=20)add('43.Phoi hop 2',t20>=10,0.55);
        l20=sl(20);t20=cnt(l20,'T');if(l20.length>=20)add('44.Phoi hop 3',t20>=10,0.55);
        last=h[h.length-1];if(last)add('45.Chan le lap',last!=='T',0.55);
        last=h[h.length-1];if(last)add('46.Dai ngan dao',last!=='T',0.55);
        last=h[h.length-1];if(last)add('47.Ngau nhien bet',last==='T',0.55);
        
        res.sort((a,b)=>b.score-a.score);
        return res;
    }
    
    predict(sd){
        const total=sd&&sd.total?sd.total:null;
        const results=this.history;
        const last=results.length?results[results.length-1]:null;
        
        if(total){
            const ds=diceScore(total);
            this.lastPrediction=ds.pred==='T';
            return{prediction:ds.pred==='T'?'T':'X',confidence:ds.conf,reason:'Tong '+total,method:'dice_table'};
        }
        
        const l10=this.lastEl(results,10);
        const tc10=this.countOcc(l10,'T');
        const streak=this.getStreak(results);
        
        if(streak>=6){
            const pred=last!=='T';
            this.lastPrediction=pred;
            return{prediction:pred?'T':'X',confidence:80,reason:'Be cau '+streak+' '+last,method:'break'};
        }
        if(tc10>=8){this.lastPrediction=false;return{prediction:'X',confidence:75,reason:'8+/10 Tai->Xiu',method:'overload_t'};}
        if(tc10<=2){this.lastPrediction=true;return{prediction:'T',confidence:75,reason:'8+/10 Xiu->Tai',method:'overload_x'};}
        
        if(this.history.length>=MIN_S){
            const pat=this.analyze();
            if(pat.length>0&&pat[0].score>0.72){
                const inv=!pat[0].prediction;
                this.lastPrediction=inv;
                return{prediction:inv?'T':'X',confidence:Math.round(pat[0].score*100),reason:pat[0].name,method:'strong'};
            }
            if(pat.length>0&&pat[0].score>0.55){
                this.lastPrediction=pat[0].prediction;
                return{prediction:pat[0].prediction?'T':'X',confidence:Math.round(pat[0].score*100),reason:pat[0].name,method:'pattern'};
            }
        }
        
        if(tc10>=6){this.lastPrediction=false;return{prediction:'X',confidence:60,reason:'Fallback Xiu',method:'fallback'};}
        if(tc10<=4){this.lastPrediction=true;return{prediction:'T',confidence:60,reason:'Fallback Tai',method:'fallback'};}
        
        const pred=last?last!=='T':Math.random()<0.5;
        this.lastPrediction=pred;
        return{prediction:pred?'T':'X',confidence:50,reason:'Reverse',method:'reverse'};
    }
    
    addResult(ri,sd){
        const n=String(ri).trim();
        let actual=null;
        if(n==='Tai'||n==='T'||n==='tai'||n==='t')actual='T';
        else if(n==='Xiu'||n==='X'||n==='xiu'||n==='x')actual='X';
        else return null;
        
        const sid=sd?sd.sessionId||0:0;
        const total=sd?sd.total||0:0;
        const dice=sd?sd.dice||'?-?-?':'?-?-?';
        
        this.history.push({sessionId:sid,result:actual,total:total,timestamp:Date.now()});
        if(this.history.length>MAX_H)this.history.shift();
        
        this.stats.total++;
        if(actual==='T')this.stats.tai++;else this.stats.xiu++;
        if(this.stats.curType===actual)this.stats.curStreak++;
        else{this.stats.curType=actual;this.stats.curStreak=1;}
        
        if(this.lastPrediction!==null){
            const pred=this.lastPrediction?'T':'X';
            const correct=pred===actual;
            if(correct)this.stats.correct++;else this.stats.wrong++;
            const lastLog=this.predictionLog[this.predictionLog.length-1];
            if(lastLog&&!lastLog.danh_gia){
                lastLog.xuc_xac=dice;lastLog.tong=total;
                lastLog.ket_qua=actual==='T'?'Tai':'Xiu';
                lastLog.danh_gia=correct?'DUNG':'SAI';
            }
        }
        this.recentPreds.push(this.lastPrediction?'T':'X');
        if(this.recentPreds.length>20)this.recentPreds.shift();
        return actual;
    }
    
    logPrediction(sid,prediction){
        const e={
            phien:String(sid),xuc_xac:'?-?-?',tong:0,ket_qua:'',
            du_doan:prediction.prediction==='T'?'Tai':'Xiu',danh_gia:'',
            do_tin_cay:prediction.confidence+'%',
            timestamp:new Date().toISOString(),
            reason:prediction.reason,method:prediction.method
        };
        this.predictionLog.push(e);
        if(this.predictionLog.length>10000)this.predictionLog.shift();
        return e;
    }
    
    getPredictionLog(l){const r=this.predictionLog.slice(-(l||50));r.reverse();return r}
    getAccuracy(){const t=this.stats.correct+this.stats.wrong;return t===0?0:Math.round(this.stats.correct/t*100)}
    getRuntime(){const s=Math.floor((Date.now()-this.stats.startTime)/1000),m=Math.floor(s/60),h=Math.floor(m/60);return Math.floor(h/24)+'d '+h%24+'h '+m%60+'m'}
}

let reconnectAttempts=0;
function connectWS(){
    try{
        const ws=new WebSocket(WS_URL);
        ws.on('open',()=>{
            log('WS','Connected');reconnectAttempts=0;
            ws.send(JSON.stringify({H:HUB_NAME,M:'Register',A:[],I:0}));
            setInterval(()=>{if(ws.readyState===1)ws.send(JSON.stringify({H:HUB_NAME,M:'Ping',A:[],I:0}))},60000);
        });
        ws.on('message',(data)=>{
            try{
                const msg=JSON.parse(data.toString());
                if(msg.M==='Md5sessionInfo'&&msg.A&&msg.A.length>0){
                    const s=msg.A[0];
                    if(s.CurrentState===1&&s.Dice1>0){
                        const d1=s.Dice1,d2=s.Dice2,d3=s.Dice3,total=d1+d2+d3,result=total>=11?'Tai':'Xiu',sid=s.SessionId;
                        engine.addResult(result,{sessionId:sid,total,dice:d1+'-'+d2+'-'+d3});
                        const p=engine.predict({sessionId:sid+1,total:null});
                        engine.logPrediction(sid+1,p);
                        console.log('#'+sid+': ['+d1+','+d2+','+d3+']='+total+'->'+result+' | '+(p.prediction==='T'?'TAI':'XIU')+'('+p.confidence+'%,'+p.method+') | '+engine.getAccuracy()+'%');
                    }
                }
            }catch(e){}
        });
        ws.on('close',()=>{const d=Math.min(1000*Math.pow(1.5,reconnectAttempts),30000);reconnectAttempts++;setTimeout(connectWS,d);});
        ws.on('error',()=>setTimeout(connectWS,5000));
    }catch(e){setTimeout(connectWS,5000);}
}

const server=http.createServer((req,res)=>{
    res.setHeader('Access-Control-Allow-Origin','*');
    if(req.method==='OPTIONS'){res.writeHead(200);res.end();return}
    const url=new URL(req.url,'http://localhost:'+API_PORT),pn=url.pathname;
    try{
        if(pn==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'ok',version:'v6',sessions:engine.stats.total,accuracy:engine.getAccuracy()}));}
        else if(pn==='/api/predict'){const p=engine.predict({});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({prediction:p.prediction==='T'?'Tai':'Xiu',confidence:p.confidence,reason:p.reason,method:p.method}));}
        else if(pn==='/api/stats'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({sessions:engine.stats.total,correct:engine.stats.correct,wrong:engine.stats.wrong,accuracy:engine.getAccuracy()}));}
        else if(pn==='/api/prediction_log'){const l=parseInt(url.searchParams.get('limit')||'50');res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(engine.getPredictionLog(l)));}
        else if(pn==='/'){const s=engine.stats;res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end('<html><head><meta charset="utf-8"><title>XocDia88</title><meta http-equiv="refresh" content="5"><style>body{font-family:monospace;background:#0a0a0a;color:#0f0;padding:20px}</style></head><body><h1>XocDia88 v6</h1><p>Sessions:'+s.total+'</p><p>Accuracy:'+engine.getAccuracy()+'%</p><p>Correct:'+s.correct+' Wrong:'+s.wrong+'</p><p>Runtime:'+engine.getRuntime()+'</p></body></html>');}
        else{res.writeHead(404);res.end('Not found');}
    }catch(e){res.writeHead(500);res.end(e.message);}
});

const engine=new PredictionEngine();ensureDir();connectWS();setInterval(()=>engine.save(),SAVE_MS);server.listen(API_PORT,()=>console.log('XocDia88 port '+API_PORT));process.on('SIGINT',()=>{engine.save();process.exit(0)});
