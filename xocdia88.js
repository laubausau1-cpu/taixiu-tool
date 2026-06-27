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
    constructor(){this.history=[];this.predictionLog=[];this.lastPrediction=null;this.stats={total:0,tai:0,xiu:0,correct:0,wrong:0,curType:'',curStreak:0,startTime:Date.now()};this.patternSuccess={};this.patternFail={};this.recentPreds=[];this.load()}
    
    load(){try{const f=DATA_DIR+'/state.json';if(fs.existsSync(f)){const d=JSON.parse(fs.readFileSync(f,'utf8'));if(d.history)this.history=d.history;if(d.stats)this.stats={...this.stats,...d.stats};if(d.predictionLog)this.predictionLog=d.predictionLog}}catch(e){}}
    save(){try{fs.writeFileSync(DATA_DIR+'/state.json',JSON.stringify({history:this.history.slice(-5000),stats:this.stats,predictionLog:this.predictionLog.slice(-5000)}))}catch(e){}}
    
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
        
        // 1-10: PATTERN GOC
        if(h.length>=2&&lst(1)===lst(2))add('1.Bệt ngắn',lst(1)==='T',0.68);
        {const l6=sl(6);const t6=cnt(l6,'T');if(t6>=6)add('2.Bệt dài T','T'==='T',0.85);if(t6<=0)add('2.Bệt dài X','X'==='T',0.85);}
        if(h.length>=3&&lst(1)===lst(3)&&lst(1)!==lst(2))add('3.Đảo 1-1 ngắn',lst(1)!=='T',0.72);
        {const l5=sl(5);let alt=true;for(let i=1;i<5;i++)if(l5[i]===l5[i-1]){alt=false;break}if(alt)add('4.Đảo 1-1 dài',l5[4]!=='T',0.75);}
        {const sz=h.length%3;if(sz===0||sz===2){const l3=sl(3);const t3=cnt(l3,'T');add('5.Cầu 1-2',t3>=2,0.62);}}
        {const sz=h.length%3;if(sz===1){const l3=sl(3);const t3=cnt(l3,'T');add('6.Cầu 2-1',!(t3>=2),0.62);}}
        {const l4=sl(4);if(l4.length===4&&l4[0]===l4[1]&&l4[2]===l4[3]&&l4[0]!==l4[2])add('7.Kép 2-2',l4[3]!=='T',0.75);}
        {const l4=sl(4);const t4=cnt(l4,'T');if(t4>=3&&l4[3]!==l4[2])add('8.Cầu 3-1 T',l4[2]==='T',0.69);if(t4<=1&&l4[3]!==l4[2])add('8.Cầu 3-1 X',l4[2]==='T',0.69);}
        {const l10=sl(10);const t10=cnt(l10,'T');if(t10>(10-t10))add('9.Imbalance T','T'==='T',0.68);if((10-t10)>t10)add('9.Imbalance X','X'==='T',0.68);}
        add('10.Ngẫu nhiên',Math.random()<0.5,0.40);
        
        // 11-20
        {const l10=sl(10);const t10=cnt(l10,'T');if(t10>=10)add('11.Siêu bệt T','T'==='T',0.95);if(t10<=0)add('11.Siêu bệt X','X'==='T',0.95);}
        {const st=this.getStreak(h);if(st>=3&&st<=5)add('12.Bệt xen kẽ',h[h.length-1]!=='T',0.55);}
        {const st=this.getStreak(h);if(st>=4&&st<=7)add('13.Bệt gãy nhẹ',h[h.length-1]!=='T',0.65);}
        if(h.length>=2&&lst(1)!==lst(2))add('14.Đảo 1-1',lst(2)==='T',0.58);}
        {const l4=sl(4);if(l4.length===4&&((l4[0]===l4[1]&&l4[2]===l4[3]&&l4[0]!==l4[2])||(l4[0]===l4[2]&&l4[1]===l4[3]&&l4[0]!==l4[1])))add('15.Kép 2-2 MR',l4[3]!=='T',0.72);}
        {const l6=sl(6);if(l6.length===6&&l6[0]===l6[1]&&l6[1]===l6[2]&&l6[3]===l6[4]&&l6[4]===l6[5]&&l6[0]!==l6[3])add('16.3-3',l6[5]!=='T',0.78);}
        {const l4=sl(4);if(l4.length===4&&l4[0]===l4[2]&&l4[1]===l4[3]&&l4[0]!==l4[1])add('17.Chu kỳ 2',l4[3]!=='T',0.68);}
        {const l6=sl(6);if(l6.length===6&&l6[0]===l6[3]&&l6[1]===l6[4]&&l6[2]===l6[5]&&l6[0]!==l6[1])add('18.Chu kỳ 3',l6[5]!=='T',0.65);}
        {const l2=sl(2);if(l2.length===2)add('19.Lặp 2-1',l2[0]==='T',0.55);}
        {const l3=sl(3);if(l3.length===3)add('20.Lặp 3-2',l3[0]==='T',0.55);}
        
        // 21-30
        {const l5=sl(5);if(l5.length===5){const rev=[...l5].reverse();if(l5.join('')===rev.join(''))add('21.Đối xứng',l5[0]!=='T',0.78);}}
        {const l5=sl(5);if(l5.length===5){const rev=[...l5].reverse();let m=0;for(let i=0;i<5;i++)if(l5[i]===rev[i])m++;if(m>=4)add('22.Bán đối xứng',l5[2]!=='T',0.62);}}
        {const st=this.getStreak(h);if(st>=6)add('23.Bệt ngược',h[h.length-1]!=='T',0.80);}
        if(lst(1)==='X'&&lst(2)==='X')add('24.Xỉu kép','X'==='T',0.60);}
        if(lst(1)==='T'&&lst(2)==='T')add('25.Tài kép','T'==='T',0.60);}
        {const l7=sl(7);let alt=true;for(let i=1;i<7;i++)if(l7[i]===l7[i-1]){alt=false;break}if(alt)add('26.Xen kẽ',l7[6]!=='T',0.72);}
        {const l10=sl(10);const t10=cnt(l10,'T');if(t10>=6)add('27.Gập ghềnh T','T'==='T',0.62);if(t10<=4)add('27.Gập ghềnh X','X'==='T',0.62);}
        {const st=this.getStreak(h);if(st>=5)add('28.Bậc thang',h[h.length-1]!=='T',0.70);}
        {const st=this.getStreak(h);if(st>=3&&st<=5)add('29.Gãy ngang',h[h.length-1]!=='T',0.65);}
        {const l2=sl(2);if(l2.length===2&&l2[0]===l2[1])add('30.Cầu đôi',l2[0]!=='T',0.60);}
        
        // 31-40
        add('31.Đa dạng',Math.random()<0.5,0.50);}
        {const st=this.getStreak(h);if(st>=3)add('32.Chu kỳ tăng',h[h.length-1]==='T',0.55);}
        {const st=this.getStreak(h);if(st>=3)add('33.Chu kỳ giảm',h[h.length-1]!=='T',0.55);}
        {const l6=sl(6);if(l6.length===6)add('34.Cầu lặp',l6[0]==='T',0.65);}
        {const last=h[h.length-1];if(last)add('35.Đối ngược',last!=='T',0.55);}
        {const l10=sl(10);const t10=cnt(l10,'T');if(t10>5)add('36.Phân cụm T','T'==='T',0.55);if(t10<5)add('36.Phân cụm X','X'==='T',0.55);}
        {const l10=sl(10);const t10=cnt(l10,'T');if(t10>=5)add('37.Lệch NN T','T'==='T',0.55);if(t10<5)add('37.Lệch NN X','X'==='T',0.55);}
        {const last=h[h.length-1];if(last)add('38.Xen kẽ dài',last!=='T',0.58);}
        {const last=h[h.length-1];if(last)add('39.Cầu gập',last!=='T',0.58);}
        {const last=h[h.length-1];if(last)add('40.Xỉu lắc',last!=='T',0.58);}
        
        // 41-47
        {const last=h[h.length-1];if(last)add('41.Tài lắc',last!=='T',0.58);}
        {const l10=sl(10);const t10=cnt(l10,'T');if(t10>5)add('42.Phối hợp 1',true,0.55);if(t10<5)add('42.Phối hợp 1',false,0.55);}
        {const l20=sl(20);const t20=cnt(l20,'T');if(l20.length>=20)add('43.Phối hợp 2',t20>=10,0.55);}
        {const l20=sl(20);const t20=cnt(l20,'T');if(l20.length>=20)add('44.Phối hợp 3',t20>=10,0.55);}
        {const last=h[h.length-1];if(last)add('45.Chẵn lẻ lặp',last!=='T',0.55);}
        {const last=h[h.length-1];if(last)add('46.Dài ngắn đảo',last!=='T',0.55);}
        {const last=h[h.length-1];if(last)add('47.Ngẫu nhiên bệt',last==='T',0.55);}
        
        res.sort((a,b)=>b.score-a.score);
        return res;
    }
    
    predict(sd){
        const total=sd&&sd.total?sd.total:null;
        const results=this.history;
        const last=results.length?results[results.length-1]:null;
        
        // BUOC 1: DICE TABLE
        if(total){
            const ds=diceScore(total);
            this.lastPrediction=ds.pred==='T';
            return{prediction:ds.pred==='T'?'T':'X',confidence:ds.conf,reason:'Tổng '+total,method:'dice_table'};
        }
        
        // BUOC 2: BE CAU
        const l10=this.lastEl(results,10);
        const tc10=this.countOcc(l10,'T');
        const streak=this.getStreak(results);
        
        if(streak>=6){
            const pred=last!=='T';
            this.lastPrediction=pred;
            return{prediction:pred?'T':'X',confidence:80,reason:'Bẻ cầu '+streak+' '+last,method:'break'};
        }
        if(tc10>=8){this.lastPrediction=false;return{prediction:'X',confidence:75,reason:'8+/10 Tài→Xỉu',method:'overload_t'};}
        if(tc10<=2){this.lastPrediction=true;return{prediction:'T',confidence:75,reason:'8+/10 Xỉu→Tài',method:'overload_x'};}
        
        // BUOC 3: 47 PATTERN
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
        
        // BUOC 4: FALLBACK
        if(tc10>=6){this.lastPrediction=false;return{prediction:'X',confidence:60,reason:'Fallback Xỉu',method:'fallback'};}
        if(tc10<=4){this.lastPrediction=true;return{prediction:'T',confidence:60,reason:'Fallback Tài',method:'fallback'};}
        
        const pred=last?last!=='T':Math.random()<0.5;
        this.lastPrediction=pred;
        return{prediction:pred?'T':'X',confidence:50,reason:'Reverse',method:'reverse'};
    }
    
    addResult(ri,sd){
        const n=String(ri).trim();
        let actual=null;
        if(n==='Tài'||n==='T'||n==='tài'||n==='t')actual='T';
        else if(n==='Xỉu'||n==='X'||n==='xỉu'||n==='x')actual='X';
        else return null;
        
        const sid=sd?sd.sessionId||0:0;
        const total=sd?sd.total||0:0;
        const dice=sd?sd.dice||'?-?-?':'?-?-?';
        
        this.history.push({sessionId:sid,result:actual,total:total,timestamp:Date.now()});
        if(this.history.length>MAX_H)this.history.shift();
        
        this.stats.total++;
        if(actual==='T')this.stats.tai++;
        else this.stats.xiu++;
        if(this.stats.curType===actual)this.stats.curStreak++;
        else{this.stats.curType=actual;this.stats.curStreak=1;}
        
        if(this.lastPrediction!==null){
            const pred=this.lastPrediction?'T':'X';
            const correct=pred===actual;
            if(correct)this.stats.correct++;
            else this.stats.wrong++;
            const lastLog=this.predictionLog[this.predictionLog.length-1];
            if(lastLog&&!lastLog.danh_gia){
                lastLog.xuc_xac=dice;lastLog.tong=total;
                lastLog.ket_qua=actual==='T'?'Tài':'Xỉu';
                lastLog.danh_gia=correct?'✅ ĐÚNG':'❌ SAI';
            }
        }
        this.recentPreds.push(this.lastPrediction?'T':'X');
        if(this.recentPreds.length>20)this.recentPreds.shift();
        return actual;
    }
    
    logPrediction(sid,prediction){
        const e={phien:String(sid),xuc_xac:'?-?-?',tong:0,ket_qua:'',du_doan:prediction.prediction==='T'?'Tài':'Xỉu',danh_gia:'',do_tin_cay:prediction.confidence+'%',timestamp:new Date().toISOString(),reason:prediction.reason,method:prediction.method};
        this.predictionLog.push(e);if(this.predictionLog.length>10000)this.predictionLog.shift();return e;
    }
    getPredictionLog(l){const r=this.predictionLog.slice(-(l||50));r.reverse();return r}
    getAccuracy(){const t=this.stats.correct+this.stats.wrong;return t===0?0:Math.round(this.stats.correct/t*100)}
    getRuntime(){const s=Math.floor((Date.now()-this.stats.startTime)/1000),m=Math.floor(s/60),h=Math.floor(m/60);return Math.floor(h/24)+'d '+h%24+'h '+m%60+'m'}
}

let reconnectAttempts=0;
function connectWS(){
    try{
        const ws=new WebSocket(WS_URL);
        ws.on('open',()=>{log('WS','Connected');reconnectAttempts=0;ws.send(JSON.stringify({H:HUB_NAME,M:'Register',A:[],I:0}));setInterval(()=>{if(ws.readyState===1)ws.send(JSON.stringify({H:HUB_NAME,M:'Ping',A:[],I:0}))},60000)});
        ws.on('message',(data)=>{
            try{
                const msg=JSON.parse(data.toString());
                if(msg.M==='Md5sessionInfo'&&msg.A&&msg.A.length>0){
                    const s=msg.A[0];
                    if(s.CurrentState===1&&s.Dice1>0){
                        const d1=s.Dice1,d2=s.Dice2,d3=s.Dice3,total=d1+d2+d3,result=total>=11?'Tài':'Xỉu',sid=s.SessionId;
                        engine.addResult(result,{sessionId:sid,total,dice:d1+'-'+d2+'-'+d3});
                        const p=engine.predict({sessionId:sid+1,total:null});
                        engine.logPrediction(sid+1,p);
                        console.log('#'+sid+': ['+d1+','+d2+','+d3+']='+total+'→'+result+' | 🔮'+(p.prediction==='T'?'TÀI':'XỈU')+'('+p.confidence+'%,'+p.method+') | 🎯'+engine.getAccuracy()+'%');
                    }
                }
            }catch(e){}
        });
        ws.on('close',()=>{const d=Math.min(1000*Math.pow(1.5,reconnectAttempts),30000);reconnectAttempts++;setTimeout(connectWS,d)});
        ws.on('error',()=>setTimeout(connectWS,5000));
    }catch(e){setTimeout(connectWS,5000)}
}

const server=http.createServer((req,res)=>{
    res.setHeader('Access-Control-Allow-Origin','*');
    if(req.method==='OPTIONS'){res.writeHead(200);res.end();return}
    const url=new URL(req.url,'http://localhost:'+API_PORT),pn=url.pathname;
    try{
        if(pn==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'ok',version:'v6-47p',sessions:engine.stats.total,accuracy:engine.getAccuracy()}))}
        else if(pn==='/api/predict'){const p=engine.predict({});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({prediction:p.prediction==='T'?'Tài':'Xỉu',confidence:p.confidence,reason:p.reason,method:p.method}))}
        else if(pn==='/api/stats'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({sessions:engine.stats.total,correct:engine.stats.correct,wrong:engine.stats.wrong,accuracy:engine.getAccuracy()}))}
        else if(pn==='/api/prediction_log'){const l=parseInt(url.searchParams.get('limit')||'50');res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(engine.getPredictionLog(l)))}
        else if(pn==='/'){const s=engine.stats;res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end('<html><head><meta charset="utf-8"><title>XocDia88 v6</title><meta http-equiv="refresh" content="5"><style>body{font-family:monospace;background:#0a0a0a;color:#0f0;padding:20px}</style></head><body><h1>XocDia88 v6 - 47 Patterns</h1><p>Sessions: '+s.total+'</p><p>Accuracy: '+engine.getAccuracy()+'%</p><p>Correct: '+s.correct+' | Wrong: '+s.wrong+'</p><p>Runtime: '+engine.getRuntime()+'</p></body></html>')}
        else{res.writeHead(404);res.end('Not found')}
    }catch(e){res.writeHead(500);res.end(e.message)}
});

const engine=new PredictionEngine();ensureDir();connectWS();setInterval(()=>engine.save(),SAVE_MS);server.listen(API_PORT,()=>console.log('XocDia88 v6 - 47 Patterns - Port '+API_PORT));process.on('SIGINT',()=>{engine.save();process.exit(0)});
