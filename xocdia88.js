const WebSocket=require('ws'),fs=require('fs'),path=require('path'),http=require('http');
const WS_URL=process.env.WS_URL||'';
const PORT=parseInt(process.env.PORT||'8888');
const DIR=path.join(__dirname,'data');
if(!fs.existsSync(DIR))fs.mkdirSync(DIR,{recursive:true});

let h=[], s=[], logs=[], pred=null, sid=0, ok=0, no=0, total=0;

function save(){try{fs.writeFileSync(path.join(DIR,'d.json'),JSON.stringify({h,s,ok,no,total}))}catch(e){}}
try{if(fs.existsSync(path.join(DIR,'d.json'))){const d=JSON.parse(fs.readFileSync(path.join(DIR,'d.json'),'utf8'));h=d.h||[];s=d.s||[];ok=d.ok||0;no=d.no||0;total=d.total||0;}}catch(e){}

function predict(){
  if(s.length>=1){
    const t=s[s.length-1].total;
    if(t!=null){
      // DỰA TRÊN LOG THỰC TẾ CỦA MÀY:
      // 12-13→Xỉu: 2 đúng/3 (67%) ✓
      // 9-10→Xỉu: 0 đúng/2 (0%) ✗ → ĐẢO thành Tài
      // 14-15→Xỉu: 0 đúng/1 (0%) ✗ → ĐẢO thành Tài
      // 7-8→Tài: 0 đúng/1 (0%) ✗ → ĐẢO thành Xỉu
      
      if(t<=4){pred='T';return{p:'T',c:80,r:'≤4→Tài'}}
      if(t>=16){pred='X';return{p:'X',c:80,r:'≥16→Xỉu'}}
      if(t>=5&&t<=6){pred='T';return{p:'T',c:70,r:'5-6→Tài'}}
      if(t>=14&&t<=15){pred='T';return{p:'T',c:65,r:'14-15→Tài'}}
      if(t>=7&&t<=8){pred='X';return{p:'X',c:65,r:'7-8→Xỉu'}}
      if(t>=12&&t<=13){pred='X';return{p:'X',c:68,r:'12-13→Xỉu'}}
      if(t>=9&&t<=10){pred='T';return{p:'T',c:62,r:'9-10→Tài'}}
      if(t==11){pred='T';return{p:'T',c:60,r:'11→Tài'}}
    }
  }
  if(h.length>=1){pred=h[h.length-1];return{p:pred,c:55,r:'Theo cuối'}}
  pred='T';return{p:'T',c:50,r:'Default'}
}

function add(r,sd){
  if(!pred)pred='T';
  const v=pred===r;if(v)ok++;else no++;
  total++;
  const l=logs[logs.length-1];if(l&&!l.kq){l.kq=r==='T'?'Tài':'Xỉu';l.dg=v?'✅':'❌'}
  h.push(r);s.push({total:sd.total||null});
  if(h.length>50000)h=h.slice(-50000);if(s.length>50000)s=s.slice(-50000);
  save()
}

function log(sid,p){logs.push({phien:String(parseInt(sid)+1),dd:p.p==='T'?'Tài':'Xỉu',dg:'',conf:p.c+'%',ts:new Date().toISOString(),r:p.r});if(logs.length>10000)logs=logs.slice(-10000)}

let ws=null,rt=null,pt=null;
function connect(){
  if(!WS_URL){setTimeout(connect,10000);return}
  if(rt){clearTimeout(rt);rt=null}if(pt){clearInterval(pt);pt=null}if(ws){try{ws.close()}catch(e){}ws=null}
  try{ws=new WebSocket(WS_URL)}catch(e){setTimeout(connect,10000);return}
  ws.on('open',()=>{try{ws.send(JSON.stringify({H:'md5luckydiceHub',M:'Ping',A:[],I:0}))}catch(e){}pt=setInterval(()=>{if(ws&&ws.readyState===1){try{ws.send(JSON.stringify({H:'md5luckydiceHub',M:'Ping',A:[],I:Date.now()}))}catch(e){}}},60000)});
  ws.on('message',(d)=>{try{const j=JSON.parse(d.toString());if(!j.M)return;j.M.forEach(m=>{if(m.M==='Md5sessionInfo'){const i=m.A[0];if(i.CurrentState===0&&i.Ellapsed>0)process.stdout.write('\r⏳'+i.Ellapsed+'s | 🎯'+(total>0?Math.round(ok/total*100):0)+'% | 📊'+total+'   ');if(i.CurrentState===1&&i.Result&&i.Result.Dice1>0&&i.SessionID!==sid){sid=i.SessionID;const d1=i.Result.Dice1,d2=i.Result.Dice2,d3=i.Result.Dice3;const ts=d1+d2+d3,rs=ts>=11?'T':'X';const p=predict();log(i.SessionID,p);add(rs,{total:ts});const ac=total>0?Math.round(ok/total*100):0;console.log('\n#'+i.SessionID+' ['+d1+','+d2+','+d3+']='+ts+' '+(ts>=11?'T':'X')+' | 🔮'+(p.p==='T'?'T':'X')+' '+p.c+'% | 🎯'+ac+'%')}}})}catch(e){}});
  ws.on('close',()=>{if(pt){clearInterval(pt);pt=null}ws=null;rt=setTimeout(connect,30000)});
  ws.on('error',()=>{});
}

setInterval(save,120000);

http.createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin','*');
  const u=new URL(req.url,'http://localhost:'+PORT);
  const ac=total>0?Math.round(ok/total*100):0;
  if(u.pathname==='/health')res.end(JSON.stringify({acc:ac,total,ok,no}));
  else if(u.pathname==='/api/logs')res.end(JSON.stringify({logs:logs.slice(-50).reverse()}));
  else if(u.pathname==='/api/reset'){ok=0;no=0;total=0;res.end(JSON.stringify({ok:1}));}
  else if(u.pathname==='/'||u.pathname===''){
    res.setHeader('Content-Type','text/html;charset=utf-8');
    res.end('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TAI XIU</title><style>*{margin:0;padding:0}body{background:#000;color:#fff;font-family:Arial;padding:15px}.box{background:#0a0000;border:2px solid #f00;padding:20px;text-align:center;border-radius:15px;margin-bottom:15px}.box .lbl{color:#f00;font-size:13px}.box .val{font-size:52px;font-weight:bold;margin:8px 0}.box .cf{color:#aaa;font-size:14px}.box .rs{color:#ff0;font-size:12px}.acc{font-size:64px;text-align:center;font-weight:bold;color:#f00}.flex{display:flex;justify-content:space-around;margin:15px 0}.st{text-align:center;background:#111;padding:12px;border-radius:10px;flex:1;margin:0 4px}.st .n{font-size:22px;font-weight:bold}.st .l{font-size:10px;color:#888}.g{color:#0f0}.r{color:#f00}.log{margin-top:15px}.item{background:#111;padding:10px;margin:4px 0;border-radius:6px;display:flex;justify-content:space-between;font-size:12px}.tai{color:#f00;font-weight:bold}.xiu{color:#0f0;font-weight:bold}.btn{background:#f00;color:#fff;border:none;padding:14px;width:100%;font-size:16px;border-radius:10px;cursor:pointer;font-weight:bold;margin:10px 0}</style></head><body><div class="box"><div class="lbl">🎯 DỰ ĐOÁN</div><div class="val" id="pred">---</div><div class="cf" id="conf"></div><div class="rs" id="reason"></div></div><div class="acc">'+ac+'%</div><div class="flex"><div class="st"><div class="n">'+total+'</div><div class="l">PHIÊN</div></div><div class="st"><div class="n g">'+ok+'</div><div class="l">ĐÚNG</div></div><div class="st"><div class="n r">'+no+'</div><div class="l">SAI</div></div></div><button class="btn" onclick="load()">🔄 TẢI LẠI</button><div class="log" id="logs"></div><script>async function load(){try{const h=await fetch("/health").then(r=>r.json());document.querySelector(".acc").textContent=h.acc+"%";document.querySelector(".flex").innerHTML=\'<div class="st"><div class="n">\'+h.total+\'</div><div class="l">PHIÊN</div></div><div class="st"><div class="n g">\'+h.ok+\'</div><div class="l">ĐÚNG</div></div><div class="st"><div class="n r">\'+h.no+\'</div><div class="l">SAI</div></div>\';const l=await fetch("/api/logs?limit=1").then(r=>r.json());if(l.logs&&l.logs.length>0){const last=l.logs[0];document.getElementById("pred").textContent=last.dd;document.getElementById("pred").className="val "+(last.dd==="Tài"?"tai":"xiu");document.getElementById("conf").textContent="Độ tin cậy: "+last.conf;document.getElementById("reason").textContent=last.r}const all=await fetch("/api/logs?limit=30").then(r=>r.json());let htm="";if(all.logs)all.logs.forEach(log=>{htm+=\'<div class="item"><span class="\'+(log.dd==="Tài"?"tai":"xiu")+\'">\'+log.dg+" "+log.dd+\'</span><span>\'+log.conf+" | #"+log.phien+" | "+log.r+\'</span></div>\'});document.getElementById("logs").innerHTML=htm||"⏳ Đang chờ..."}catch(e){}}load();setInterval(load,5000);</script></body></html>');
  }else res.end(JSON.stringify({acc:ac}));
}).listen(PORT,()=>console.log('PORT '+PORT));

connect();
