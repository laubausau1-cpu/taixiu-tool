const WebSocket=require('ws'),fs=require('fs'),path=require('path'),http=require('http');
const WS_URL=process.env.WS_URL||process.argv[2]||'wss://taixiumd5.system32-cloudfare-356783752985678522.monster/signalr/connect?transport=webSockets&connectionToken=z0%2Bp4sHHXusB7hFR4ZBSkc7TBejGa%2BoooswT8oNe8KhHmsJEIWLTtZh40jp%2FuaCUuwj1vJOAqw%2Fc1EBSv7ebeZGlhgS2FeQ1GNBYU%2F5AVausPA4HmHluu0RJW1Pwcy9H&connectionData=%5B%7B%22name%22%3A%22md5luckydiceHub%22%7D%5D&tid=1';
const HUB='md5luckydiceHub',DIR=path.join(__dirname,'data'),PORT=parseInt(process.env.PORT||'8888');
function d(){if(!fs.existsSync(DIR))fs.mkdirSync(DIR,{recursive:true})}
function log(l,m){const t='['+new Date().toISOString()+']['+l+']'+m;console.log(t);try{fs.appendFileSync(path.join(DIR,'log.txt'),t+'\n')}catch(_){}}
function clamp(v,lo,hi){return v<lo?lo:v>hi?hi:v}
function sigmoid(x){return 1/(1+Math.exp(-x))}

class CircularBuffer{constructor(cap){this.buf=[];this.cap=cap}push(v){this.buf.push(v);if(this.buf.length>this.cap)this.buf.shift()}last(n){return this.buf.slice(-n)}get length(){return this.buf.length}get(i){return i<0?this.buf[this.buf.length+i]:this.buf[i]}}

// Neural Network từ Smali - class Lx/he
class He{constructor(){this.b=[0.35,0.35,0.3];this.c=0.5}predict(p){let s=0;for(let i=0;i<3;i++)s+=this.b[i]*p[i];return clamp(sigmoid(s),0.4,0.6)}}

class XocDiaMD5{
  constructor(){
    this.history=new CircularBuffer(2000);this.sessions=[];this.logs=[];
    this.he=new He();this.lastPred=null;this.lastSid=0;
    this.patternSuccess={};this.patternFail={};
    this.stats={total:0,tai:0,xiu:0,correct:0,wrong:0,curType:'',curStreak:0};
    this.MIN_S=6;this._initPatterns();this._load();
  }
  _load(){try{const f=path.join(DIR,'state_md5.json');if(fs.existsSync(f)){const d=JSON.parse(fs.readFileSync(f,'utf8'));if(d.history){this.history=new CircularBuffer(2000);d.history.forEach(v=>this.history.push(v))}if(d.sessions)this.sessions=d.sessions;if(d.logs)this.logs=d.logs;if(d.stats)this.stats=d.stats;if(d.patternSuccess)this.patternSuccess=d.patternSuccess;if(d.patternFail)this.patternFail=d.patternFail}}catch(_){}}
  _save(){try{fs.writeFileSync(path.join(DIR,'state_md5.json'),JSON.stringify({history:this.history.buf.slice(-2000),sessions:this.sessions.slice(-2000),logs:this.logs.slice(-5000),stats:this.stats,patternSuccess:this.patternSuccess,patternFail:this.patternFail}))}catch(_){}}

  // 47 PATTERNS từ Smali
  _initPatterns(){
    const sl=(n)=>this.history.last(n);const lst=(n)=>this.history.get(-n);
    const cnt=(a,v)=>a.filter(x=>x===v).length;const self=this;
    this.patterns=[
      {name:'Bệt',check:()=>{const h=sl(6);if(h.length<6)return null;const t=cnt(h,'T');if(t>=6)return true;if(t===0)return false;return null}},
      {name:'Bệt siêu dài',check:()=>{const h=sl(10);if(h.length<10)return null;const t=cnt(h,'T');if(t>=10)return true;if(t===0)return false;return null}},
      {name:'Bệt xen kẽ ngắn',check:()=>{const h=sl(6);if(h.length<6)return null;const l=h[h.length-1];let s=0;for(let i=h.length-1;i>=0;i--){if(h[i]===l)s++;else break}return s>=3?l==='T':null}},
      {name:'Bệt gãy nhẹ',check:()=>{const h=sl(6);if(h.length<6)return null;let b=0;for(let i=1;i<h.length;i++)if(h[i]!==h[i-1])b++;return b<=1?h[h.length-1]==='T':null}},
      {name:'Đảo 1-1',check:()=>{if(self.history.length<4)return null;return lst(1)===lst(3)&&lst(1)!==lst(2)?lst(1)==='T':null}},
      {name:'Kép 2-2',check:()=>{const h=sl(4);if(h.length<4)return null;if(h[0]===h[1]&&h[2]===h[3]&&h[0]!==h[2])return h[3]==='T';return null}},
      {name:'3-3',check:()=>{const h=sl(6);if(h.length<6)return null;if(h[0]===h[1]&&h[1]===h[2]&&h[3]===h[4]&&h[4]===h[5]&&h[0]!==h[3])return h[5]==='T';return null}},
      {name:'Chu kỳ 2',check:()=>{const h=sl(4);if(h.length<4)return null;if(h[0]===h[2]&&h[1]===h[3]&&h[0]!==h[1])return h[3]!=='T';return null}},
      {name:'Chu kỳ 3',check:()=>{const h=sl(6);if(h.length<6)return null;if(h[0]===h[3]&&h[1]===h[4]&&h[2]===h[5]&&h[0]!==h[1])return h[5]!=='T';return null}},
      {name:'Lặp 2-1',check:()=>{const h=sl(3);if(h.length<3)return null;if(h[0]===h[1]&&h[1]!==h[2])return h[2]==='T';return null}},
      {name:'Lặp 3-2',check:()=>{const h=sl(5);if(h.length<5)return null;if(h[0]===h[1]&&h[1]===h[2]&&h[2]!==h[3]&&h[3]===h[4])return h[4]==='T';return null}},
      {name:'Đối xứng',check:()=>{const h=sl(5);if(h.length<5)return null;const rev=[...h].reverse();if(h.join('')===rev.join(''))return h[0]!=='T';return null}},
      {name:'Bán đối xứng',check:()=>{const h=sl(5);if(h.length<5)return null;const rev=[...h].reverse();let m=0;for(let i=0;i<5;i++)if(h[i]===rev[i])m++;return m>=4?h[2]!=='T':null}},
      {name:'Bệt ngược',check:()=>{const h=sl(6);if(h.length<6)return null;const l=h[h.length-1];let s=0;for(let i=h.length-1;i>=0;i--){if(h[i]===l)s++;else break}return s>=6?l!=='T':null}},
      {name:'Xỉu kép',check:()=>{const h=sl(2);return h.length>=2&&h[0]==='X'&&h[1]==='X'?false:null}},
      {name:'Tài kép',check:()=>{const h=sl(2);return h.length>=2&&h[0]==='T'&&h[1]==='T'?true:null}},
      {name:'Xen kẽ',check:()=>{const h=sl(5);if(h.length<5)return null;let a=true;for(let i=1;i<h.length;i++)if(h[i]===h[i-1]){a=false;break}return a?h[h.length-1]!=='T':null}},
      {name:'Gập ghềnh',check:()=>{const h=sl(6);if(h.length<6)return null;let sw=0;for(let i=1;i<h.length;i++)if(h[i]!==h[i-1])sw++;return sw>=3?h[h.length-1]!=='T':null}},
      {name:'Bậc thang',check:()=>{const h=sl(5);if(h.length<5)return null;let inc=true;for(let i=1;i<h.length;i++)if(h[i]===h[i-1]){inc=false;break}return inc?h[h.length-1]!=='T':null}},
      {name:'Gãy ngang',check:()=>{const h=sl(6);if(h.length<6)return null;const l=h[h.length-1];let s=0;for(let i=h.length-1;i>=0;i--){if(h[i]===l)s++;else break}return s>=3?l!=='T':null}},
      {name:'Cầu đôi',check:()=>{const h=sl(4);if(h.length<4)return null;if(h[0]===h[1]&&h[2]===h[3])return h[3]!=='T';return null}},
      {name:'Ngẫu nhiên',check:()=>null},
      {name:'Đa dạng',check:()=>{const h=sl(10);if(h.length<10)return null;return new Set(h).size>=4?h[h.length-1]!=='T':null}},
      {name:'Chu kỳ tăng',check:()=>{const h=sl(6);if(h.length<6)return null;let s=[],c=1;for(let i=h.length-2;i>=0;i--){if(h[i]===h[i+1])c++;else{s.push(c);c=1}}s.push(c);for(let j=1;j<s.length;j++)if(s[j]<=s[j-1])return null;return h[h.length-1]!=='T'}},
      {name:'Chu kỳ giảm',check:()=>{const h=sl(6);if(h.length<6)return null;let s=[],c=1;for(let i=h.length-2;i>=0;i--){if(h[i]===h[i+1])c++;else{s.push(c);c=1}}s.push(c);for(let j=1;j<s.length;j++)if(s[j]>=s[j-1])return null;return h[h.length-1]!=='T'}},
      {name:'Cầu lặp',check:()=>{const h=sl(6);return h.length>=6?h[0]==='T':null}},
      {name:'Đối ngược',check:()=>{const h=sl(4);if(h.length<4)return null;return h[0]!==h[1]&&h[1]===h[2]&&h[2]!==h[3]?h[3]!=='T':null}},
      {name:'Phân cụm',check:()=>{const h=sl(10);if(h.length<10)return null;return cnt(h,'T')>5?true:null}},
      {name:'Lệch ngẫu nhiên',check:()=>{const h=sl(10);if(h.length<10)return null;const t=cnt(h,'T');return t>=5?false:true}},
      {name:'Xen kẽ dài',check:()=>{const h=sl(8);if(h.length<8)return null;let a=true;for(let i=1;i<8;i++)if(h[i]===h[i-1]){a=false;break}return a?h[7]!=='T':null}},
      {name:'Cầu gập',check:()=>{const h=sl(6);if(h.length<6)return null;const l=h[h.length-1];let s=0;for(let i=h.length-1;i>=0;i--){if(h[i]===l)s++;else break}return s>=4?l!=='T':null}},
      {name:'Xỉu lắc',check:()=>{const h=sl(5);if(h.length<5)return null;return h[h.length-1]==='X'&&h[h.length-2]==='T'?false:null}},
      {name:'Tài lắc',check:()=>{const h=sl(5);if(h.length<5)return null;return h[h.length-1]==='T'&&h[h.length-2]==='X'?true:null}},
      {name:'Phối hợp 1',check:()=>{const h=sl(10);if(h.length<10)return null;return cnt(h,'T')>5?true:null}},
      {name:'Phối hợp 2',check:()=>{const h=sl(20);if(h.length<20)return null;const t=cnt(h,'T');return t>=(h.length-t)}},
      {name:'Phối hợp 3',check:()=>{const h=sl(20);if(h.length<20)return null;const t=cnt(h,'T');return t>=(h.length-t)}},
      {name:'Chẵn lẻ lặp',check:()=>{const h=sl(4);if(h.length<4)return null;if(h[0]===h[2]&&h[1]===h[3])return h[3]!=='T';return null}},
      {name:'Dài ngắn đảo',check:()=>{const h=sl(6);if(h.length<6)return null;return h[h.length-1]!=='T'}},
      {name:'Ngẫu nhiên bệt',check:()=>{const h=sl(5);if(h.length<5)return null;const l=h[h.length-1];let s=0;for(let i=h.length-1;i>=0;i--){if(h[i]===l)s++;else break}return s>=4?l==='T':null}},
      {name:'Cầu dài ngẫu',check:()=>{const h=sl(10);if(h.length<10)return null;const t=cnt(h,'T');return t>=6?false:null}},
      {name:'Ngược chu kỳ',check:()=>{const h=sl(6);if(h.length<6)return null;if(h[0]===h[3]&&h[1]===h[4]&&h[2]===h[5])return h[5]!=='T';return null}},
      {name:'Chu kỳ biến đổi',check:()=>{const h=sl(8);if(h.length<8)return null;let s=[],c=1;for(let i=h.length-2;i>=0;i--){if(h[i]===h[i+1])c++;else{s.push(c);c=1}}s.push(c);return s.length>=3?h[h.length-1]!=='T':null}},
      {name:'Cầu linh hoạt',check:()=>{const h=sl(6);if(h.length<6)return null;const t=cnt(h,'T');return t>=3?false:null}},
      {name:'Cầu 3-1',check:()=>{const h=sl(4);if(h.length<4)return null;if(h[0]===h[1]&&h[1]===h[2]&&h[2]!==h[3])return h[3]!=='T';return null}},
      {name:'Cầu 2-1-2',check:()=>{const h=sl(5);if(h.length<5)return null;if(h[0]===h[1]&&h[1]!==h[2]&&h[2]===h[3]&&h[3]===h[4])return h[4]!=='T';return null}},
      {name:'Cầu thời gian nhanh',check:()=>{return lst(1)?lst(1)!=='T':null}},
      {name:'Cầu thời gian chậm',check:()=>{return lst(1)?lst(1)!=='T':null}},
    ];
  }

  getQuickAnalysis(){
    const arr=this.history.last(20);if(arr.length===0)return{isTai:true,score:0.5};
    const tc=arr.filter(x=>x==='T').length;const ratio=(tc+1)/(arr.length+2);
    return{isTai:tc>=(arr.length-tc),score:clamp(Math.abs(ratio-0.5)*1.5,0.3,0.88)};
  }

  analyzePatterns(){
    const results=[];const h80=this.history.last(80);if(h80.length<8)return results;
    for(const p of this.patterns){const isTai=p.check();if(isTai===null)continue;
      const total=(this.patternSuccess[p.name]||0)+(this.patternFail[p.name]||0);
      const sr=total>0?(this.patternSuccess[p.name]||0)/total:0.5;
      results.push({name:p.name,score:clamp(sr*0.7+0.3,0.25,0.98),isTai});}
    return results.sort((a,b)=>b.score-a.score);
  }

  predict(){
    if(this.history.length<this.MIN_S){
      const last=this.history.length>0?this.history.get(-1):'T';
      const rand=Math.random();const pred=last==='T'?(rand<0.52?'T':'X'):(rand<0.48?'X':'T');
      this.lastPred=pred;return{prediction:pred==='T'?'Tài':'Xỉu',confidence:50,method:'warmup',reason:'Khởi động '+this.history.length+'/'+this.MIN_S};
    }
    const patterns=this.analyzePatterns();
    if(patterns.length>0&&patterns[0].score>0.72){const bp=patterns[0];const pred=bp.isTai?'T':'X';this.lastPred=pred;return{prediction:pred==='T'?'Tài':'Xỉu',confidence:Math.round(clamp(bp.score,0.4,0.6)*100),method:'strong',reason:bp.name}}
    if(patterns.length>0&&patterns[0].score>0.55){const bp=patterns[0];const q=this.getQuickAnalysis();const combined=bp.score*0.6+(bp.isTai?q.score:1-q.score)*0.4;const pred=combined>=0.5?'T':'X';this.lastPred=pred;return{prediction:pred==='T'?'Tài':'Xỉu',confidence:Math.round(clamp(combined,0.4,0.6)*100),method:'medium',reason:bp.name+' (medium)'}}
    const sc=this.stats.curStreak/10;const tr=this.stats.total>0?this.stats.tai/this.stats.total:0.5;
    const nnScore=this.he.predict([sc,tr,0.5]);const pred=nnScore>=0.5?'T':'X';this.lastPred=pred;
    return{prediction:pred==='T'?'Tài':'Xỉu',confidence:Math.round(nnScore*100),method:'nn',reason:'Neural Network'};
  }

  addResult(r,data={}){
    const n=String(r).toLowerCase().trim();let a=null;
    if(n==='tài'||n==='tai'||n==='t'||n==='1')a='T';else if(n==='xỉu'||n==='xiu'||n==='x'||n==='0')a='X';
    else if(n.includes('tài')||n.includes('tai'))a='T';else if(n.includes('xỉu')||n.includes('xiu'))a='X';else return null;
    const sid=data.sessionId||data.id||0,total=data.total||0,dice=data.dice||'?-?-?';
    if(this.lastPred){const lp=this.lastPred==='Tài'?'T':this.lastPred==='Xỉu'?'X':this.lastPred;const ok=lp===a;if(ok)this.stats.correct++;else this.stats.wrong++;
      const ll=this.logs[this.logs.length-1];if(ll&&!ll.ket_qua){ll.xuc_xac=dice;ll.tong=total;ll.ket_qua=a==='T'?'Tài':'Xỉu';ll.danh_gia=ok?'✅ ĐÚNG':'❌ SAI'}}
    if(this.stats.curType===a)this.stats.curStreak++;else{this.stats.curType=a;this.stats.curStreak=1}
    if(a==='T')this.stats.tai++;else this.stats.xiu++;this.stats.total++;this.history.push(a);
    this.sessions.push({ts:Date.now(),sid,result:a,total,dice});if(this.stats.total%50===0)this._save();return a;
  }

  logPrediction(sid,p){const e={phien:String(sid),xuc_xac:'?-?-?',tong:0,ket_qua:'',du_doan:p.prediction,danh_gia:'',do_tin_cay:p.confidence+'%',timestamp:new Date().toISOString(),reason:p.reason,method:p.method};this.logs.push(e);if(this.logs.length>10000)this.logs.shift();return e}
  getAccuracy(){const t=this.stats.correct+this.stats.wrong;return t===0?0:Math.round(this.stats.correct/t*100)}
  getLogs(n=50){return this.logs.slice(-n).reverse()}
}

const engine=new XocDiaMD5();

function connect(){
  if(!WS_URL){console.log('ERROR: No WS_URL');return}
  const ws=new WebSocket(WS_URL);
  ws.on('open',()=>{log('WS','Connected');ws.send(JSON.stringify({H:HUB,M:'Register',A:[],I:0}));setInterval(()=>{if(ws.readyState===1)ws.send(JSON.stringify({H:HUB,M:'Ping',A:[],I:Date.now()}))},60000)});
  ws.on('message',raw=>{try{const msg=JSON.parse(raw.toString());if(!msg.M)return;for(const m of msg.M){if(m.M==='Md5sessionInfo'){const s=m.A[0];if(s.CurrentState===0&&s.Ellapsed>0)process.stdout.write('\r⏳'+s.Ellapsed+'s | 🎯'+engine.getAccuracy()+'% | 📊'+engine.stats.total+'   ');if(s.CurrentState===1&&s.Result&&s.Result.Dice1>0&&engine.lastSid!==s.SessionID){engine.lastSid=s.SessionID;const d1=s.Result.Dice1,d2=s.Result.Dice2,d3=s.Result.Dice3,total=d1+d2+d3,result=total>=11?'Tài':'Xỉu';const p=engine.predict();engine.logPrediction(s.SessionID+1,p);engine.addResult(result,{sessionId:s.SessionID,total,dice:d1+'-'+d2+'-'+d3});console.log('\n┌──────────────────────────────────────────┐');console.log('│ #'+s.SessionID+' | 🎲['+d1+','+d2+','+d3+']='+total+' | '+result);console.log('│ 🎯 '+engine.getAccuracy()+'% | 📊 '+engine.stats.total);console.log('├──────────────────────────────────────────┤');console.log('│ 🔮 DỰ ĐOÁN: '+p.prediction+' ('+p.confidence+'%)');console.log('│ 💡 '+p.reason);console.log('└──────────────────────────────────────────┘\n');}}}}catch(_){}});
  ws.on('close',()=>{log('WS','Disconnected');setTimeout(connect,5000)});ws.on('error',()=>ws.close());
}

const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin','*');const url=new URL(req.url,'http://localhost:'+PORT);if(url.pathname==='/health')res.end(JSON.stringify({status:'ok',patterns:47,sessions:engine.stats.total,accuracy:engine.getAccuracy()}));else if(url.pathname==='/api/predict'){const p=engine.predict();res.end(JSON.stringify({prediction:p.prediction,confidence:p.confidence,reason:p.reason,method:p.method}));}else if(url.pathname==='/api/stats')res.end(JSON.stringify({...engine.stats,accuracy:engine.getAccuracy()}));else if(url.pathname==='/api/prediction_log')res.end(JSON.stringify(engine.getLogs(parseInt(url.searchParams.get('limit')||'50'))));else if(url.pathname==='/api/reset'){engine.stats.correct=0;engine.stats.wrong=0;res.end(JSON.stringify({status:'ok'}));}else res.end(JSON.stringify({name:'XocDiaMD5',version:'v1',patterns:47,accuracy:engine.getAccuracy()}));});

d();server.listen(PORT,()=>console.log('API: http://localhost:'+PORT));
console.log('╔══════════════════════════════════╗');
console.log('║  XOCDIAMD5 - 47 PATTERNS + NN   ║');
console.log('╚══════════════════════════════════╝');
connect();
process.on('SIGINT',()=>{engine._save();process.exit(0)});
