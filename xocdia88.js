const WebSocket=require('ws'),fs=require('fs'),path=require('path'),http=require('http');
const WS_URL=process.env.WS_URL||'';
const PORT=parseInt(process.env.PORT||'8888');
const DIR=path.join(__dirname,'data');
if(!fs.existsSync(DIR))fs.mkdirSync(DIR,{recursive:true});

let history=[], sessions=[], logs=[], lastPred=null, lastSid=0;
let correct=0, wrong=0, total=0;

function save(){
  try{fs.writeFileSync(path.join(DIR,'data.json'),JSON.stringify({history,sessions,correct,wrong,total}))}catch(e){}
}
try{
  if(fs.existsSync(path.join(DIR,'data.json'))){
    const d=JSON.parse(fs.readFileSync(path.join(DIR,'data.json'),'utf8'));
    history=d.history||[]; sessions=d.sessions||[]; correct=d.correct||0; wrong=d.wrong||0; total=d.total||0;
  }
}catch(e){}

function predict(){
  const s=sessions;
  if(s.length>=1){
    const t=s[s.length-1].total;
    if(t!=null){
      if(t<=4) return {p:'X',c:82,r:'≤4→Xỉu'};
      if(t>=16) return {p:'X',c:78,r:'≥16→Xỉu'};
      if(t<=7) return {p:'X',c:65,r:'Thấp→Xỉu'};
      if(t>=14) return {p:'T',c:65,r:'Cao→Tài'};
      if(t<=10) return {p:'X',c:58,r:'TB thấp→Xỉu'};
      return {p:'T',c:58,r:'TB cao→Tài'};
    }
  }
  if(history.length>=1) return {p:history[history.length-1],c:52,r:'Theo cuối'};
  return {p:'T',c:50,r:'Default'};
}

function addResult(r, sd){
  if(!lastPred) lastPred='T';
  const ok=lastPred===r;
  if(ok) correct++; else wrong++;
  total++;
  if(logs.length>0&&!logs[logs.length-1].kq){
    logs[logs.length-1].kq=r==='T'?'Tài':'Xỉu';
    logs[logs.length-1].dg=ok?'✅':'❌';
  }
  history.push(r);
  sessions.push({total:sd.total||null});
  if(history.length>50000) history=history.slice(-50000);
  save();
}

let ws=null,rt=null,pt=null;
function connect(){
  if(!WS_URL){setTimeout(connect,10000);return}
  if(rt){clearTimeout(rt);rt=null}
  if(pt){clearInterval(pt);pt=null}
  if(ws){try{ws.close()}catch(e){}ws=null}
  try{ws=new WebSocket(WS_URL)}catch(e){setTimeout(connect,10000);return}
  ws.on('open',()=>{
    try{ws.send(JSON.stringify({H:'md5luckydiceHub',M:'Ping',A:[],I:0}))}catch(e){}
    pt=setInterval(()=>{if(ws&&ws.readyState===1){try{ws.send(JSON.stringify({H:'md5luckydiceHub',M:'Ping',A:[],I:Date.now()}))}catch(e){}}},60000);
  });
  ws.on('message',(data)=>{
    try{
      const json=JSON.parse(data.toString());
      if(!json.M)return;
      json.M.forEach(m=>{
        if(m.M==='Md5sessionInfo'){
          const info=m.A[0];
          if(info.CurrentState===0&&info.Ellapsed>0){
            process.stdout.write('\r⏳'+info.Ellapsed+'s | 🎯'+(total>0?Math.round(correct/total*100):0)+'% | 📊'+total+'   ');
          }
          if(info.CurrentState===1&&info.Result&&info.Result.Dice1>0&&info.SessionID!==lastSid){
            lastSid=info.SessionID;
            const d1=info.Result.Dice1,d2=info.Result.Dice2,d3=info.Result.Dice3;
            const totalScore=d1+d2+d3,result=totalScore>=11?'T':'X';
            const pred=predict();
            lastPred=pred.p;
            logs.push({phien:String(parseInt(info.SessionID)+1),dd:pred.p==='T'?'Tài':'Xỉu',dg:'',conf:pred.c+'%',ts:new Date().toISOString(),r:pred.r});
            if(logs.length>10000)logs=logs.slice(-10000);
            addResult(result,{total:totalScore});
            const acc=total>0?Math.round(correct/total*100):0;
            console.log('\n#'+info.SessionID+' ['+d1+','+d2+','+d3+']='+totalScore+' '+(totalScore>=11?'T':'X')+' | 🔮'+(pred.p==='T'?'T':'X')+' '+pred.c+'% | 🎯'+acc+'%');
          }
        }
      });
    }catch(e){}
  });
  ws.on('close',()=>{if(pt){clearInterval(pt);pt=null}ws=null;rt=setTimeout(connect,30000)});
  ws.on('error',()=>{});
}

setInterval(save,300000);

http.createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  res.setHeader('Access-Control-Allow-Origin','*');
  const url=new URL(req.url,'http://localhost:'+PORT);
  const acc=total>0?Math.round(correct/total*100):0;
  if(url.pathname==='/health') res.end(JSON.stringify({acc,total,correct,wrong}));
  else if(url.pathname==='/api/logs') res.end(JSON.stringify({logs:logs.slice(-50).reverse()}));
  else if(url.pathname==='/api/reset'){correct=0;wrong=0;total=0;res.end(JSON.stringify({ok:1}));}
  else if(url.pathname==='/'||url.pathname===''){
    res.setHeader('Content-Type','text/html;charset=utf-8');
    let html='<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TAI XIU</title><style>*{margin:0;padding:0}body{background:#0a0a0a;color:#fff;font-family:Arial;padding:15px}.pred-box{background:#1a1a0a;border:2px solid #ff6b00;padding:20px;text-align:center;border-radius:12px;margin-bottom:15px}.pred-box .label{color:#ff6b00;font-size:13px}.pred-box .val{font-size:48px;font-weight:bold;margin:8px 0}.pred-box .conf{color:#aaa;font-size:14px}.pred-box .reason{color:#888;font-size:12px;margin-top:5px}.acc{font-size:56px;text-align:center;font-weight:bold;color:#ff6b00}.stats{display:flex;justify-content:space-around;margin:15px 0}.stat{text-align:center}.stat .n{font-size:22px;font-weight:bold}.stat .l{font-size:11px;color:#888}.green{color:#0f0}.red{color:#f00}.log{margin-top:15px}.log-item{background:#111;padding:10px;margin:4px 0;border-radius:6px;display:flex;justify-content:space-between;font-size:14px}.log-item .dd{font-weight:bold}.log-item .tai{color:#f00}.log-item .xiu{color:#0f0}.btn{background:#ff6b00;color:#000;border:none;padding:12px;width:100%;font-size:16px;border-radius:8px;margin:10px 0;cursor:pointer}</style></head><body>';
    html+='<div class="pred-box"><div class="label">🎯 DỰ ĐOÁN TIẾP THEO</div><div class="val" id="pred">---</div><div class="conf" id="conf"></div><div class="reason" id="reason"></div></div>';
    html+='<div class="acc">'+acc+'%</div>';
    html+='<div class="stats"><div class="stat"><div class="n">'+total+'</div><div class="l">PHIÊN</div></div><div class="stat"><div class="n green">'+correct+'</div><div class="l">ĐÚNG</div></div><div class="stat"><div class="n red">'+wrong+'</div><div class="l">SAI</div></div></div>';
    html+='<button class="btn" onclick="load()">🔄 TẢI LẠI</button><div class="log" id="logs"></div>';
    html+='<script>async function load(){try{const h=await fetch("/health").then(r=>r.json());document.querySelector(".acc").textContent=h.acc+"%";document.querySelector(".stats").innerHTML=\'<div class="stat"><div class="n">\'+h.total+\'</div><div class="l">PHIÊN</div></div><div class="stat"><div class="n green">\'+h.correct+\'</div><div class="l">ĐÚNG</div></div><div class="stat"><div class="n red">\'+h.wrong+\'</div><div class="l">SAI</div></div>\';const l=await fetch("/api/logs?limit=1").then(r=>r.json());if(l.logs&&l.logs.length>0){const last=l.logs[0];document.getElementById("pred").textContent=last.dd;document.getElementById("pred").className="val "+(last.dd==="Tài"?"tai":"xiu");document.getElementById("conf").textContent="Độ tin cậy: "+last.conf;document.getElementById("reason").textContent=last.r}const all=await fetch("/api/logs?limit=30").then(r=>r.json());let htm="";if(all.logs)all.logs.forEach(log=>{htm+=\'<div class="log-item"><span class="dd \'+(log.dd==="Tài"?"tai":"xiu")+\'">\'+log.dg+" "+log.dd+\'</span><span>\'+log.conf+" | #"+log.phien+" | "+log.r+\'</span></div>\'});document.getElementById("logs").innerHTML=htm||"Đang chờ..."}catch(e){}}load();setInterval(load,8000);</script></body></html>';
    res.end(html);
  }
  else res.end(JSON.stringify({acc}));
}).listen(PORT,()=>console.log('PORT '+PORT));

connect();
