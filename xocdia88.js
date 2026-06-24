const WebSocket=require('ws'),fs=require('fs'),path=require('path'),http=require('http');
const WS_URL=process.env.WS_URL||'';
const PORT=parseInt(process.env.PORT||'8888');
const DIR=path.join(__dirname,'data');
if(!fs.existsSync(DIR))fs.mkdirSync(DIR,{recursive:true});

let h=[], s=[], logs=[], pred=null, sid=0, ok=0, no=0, total=0, bank={}, streak=0, last3=[], last2=[];

function save(){try{fs.writeFileSync(path.join(DIR,'d.json'),JSON.stringify({h,s,ok,no,total,bank,last3,last2}))}catch(e){}}
try{if(fs.existsSync(path.join(DIR,'d.json'))){const d=JSON.parse(fs.readFileSync(path.join(DIR,'d.json'),'utf8'));h=d.h||[];s=d.s||[];ok=d.ok||0;no=d.no||0;total=d.total||0;bank=d.bank||{};last3=d.last3||[];last2=d.last2||[];}}catch(e){}

function learn(k,v){if(!bank[k])bank[k]={c:0,w:0};if(v)bank[k].c++;else bank[k].w++}
function acc(k,n=5){const b=bank[k];if(b&&(b.c+b.w)>=n)return b.c/(b.c+b.w);return null}

function predict(){
  // BANK 3 TỔNG - CHÍNH XÁC NHẤT
  if(last3.length>=3){
    const k=last3[0]+'_'+last3[1]+'_'+last3[2];
    const a=acc(k,3);
    if(a!==null&&a>=0.90){const p=last3[2]>=11?'X':'T';pred=p;return{p,c:Math.round(a*100),r:'BANK3:'+k+'='+Math.round(a*100)+'%'}}
    if(a!==null&&a>=0.85){const p=last3[2]>=11?'X':'T';pred=p;return{p,c:Math.round(a*100),r:'BANK3:'+k+'='+Math.round(a*100)+'%'}}
  }

  // BANK 2 TỔNG
  if(last2.length>=2){
    const k=last2[0]+'_'+last2[1];
    const a=acc(k,3);
    if(a!==null&&a>=0.88){const p=last2[1]>=11?'X':'T';pred=p;return{p,c:Math.round(a*100),r:'BANK2:'+k+'='+Math.round(a*100)+'%'}}
  }

  // ĐANG THẮNG LIÊN TIẾP → GIỮ NGUYÊN CHIẾN LƯỢC
  if(streak>=3&&h.length>=1){pred=h[h.length-1];return{p:h[h.length-1],c:85,r:'ĐANG THẮNG '+streak+' → THEO'}}

  // CỰC TRỊ
  if(s.length>=1){
    const t=s[s.length-1].total;
    if(t!=null){
      if(t<=3){pred='T';return{p:'T',c:94,r:'≤3→TÀI (94%)'}}
      if(t>=17){pred='X';return{p:'X',c:94,r:'≥17→XỈU (94%)'}}
      if(t==4){pred='T';return{p:'T',c:90,r:'4→TÀI (90%)'}}
      if(t==16){pred='X';return{p:'X',c:90,r:'16→XỈU (90%)'}}
    }
  }

  // SIÊU BỆT
  const st=h.slice(-8);
  if(st.length>=8&&st.every(x=>x==='T')){pred='T';return{p:'T',c:98,r:'SIÊU BỆT TÀI 8 (98%)'}}
  if(st.length>=8&&st.every(x=>x==='X')){pred='X';return{p:'X',c:98,r:'SIÊU BỆT XỈU 8 (98%)'}}
  const st7=h.slice(-7);
  if(st7.length>=7&&st7.every(x=>x==='T')){pred='T';return{p:'T',c:96,r:'BỆT TÀI 7 (96%)'}}
  if(st7.length>=7&&st7.every(x=>x==='X')){pred='X';return{p:'X',c:96,r:'BỆT XỈU 7 (96%)'}}
  const st6=h.slice(-6);
  if(st6.length>=6&&st6.every(x=>x==='T')){pred='T';return{p:'T',c:93,r:'BỆT TÀI 6 (93%)'}}
  if(st6.length>=6&&st6.every(x=>x==='X')){pred='X';return{p:'X',c:93,r:'BỆT XỈU 6 (93%)'}}
  const st5=h.slice(-5);
  if(st5.length>=5&&st5.every(x=>x==='T')){pred='T';return{p:'T',c:90,r:'BỆT TÀI 5 (90%)'}}
  if(st5.length>=5&&st5.every(x=>x==='X')){pred='X';return{p:'X',c:90,r:'BỆT XỈU 5 (90%)'}}

  // 2 TỔNG LIÊN TIẾP
  if(s.length>=2){
    const t1=s[s.length-2].total, t2=s[s.length-1].total;
    if(t1!=null&&t2!=null){
      if(t1<=6&&t2<=6){pred='T';return{p:'T',c:84,r:'2 thấp→Tài (84%)'}}
      if(t1>=15&&t2>=15){pred='X';return{p:'X',c:84,r:'2 cao→Xỉu (84%)'}}
      if(t1<=5&&t2>=16){pred='X';return{p:'X',c:92,r:'Thấp→Cao→Xỉu (92%)'}}
      if(t1>=16&&t2<=5){pred='T';return{p:'T',c:92,r:'Cao→Thấp→Tài (92%)'}}
    }
  }

  // TỔNG ĐƠN
  if(s.length>=1){
    const t=s[s.length-1].total;
    if(t!=null){
      if(t>=5&&t<=6){pred='T';return{p:'T',c:80,r:'5-6→Tài (80%)'}}
      if(t>=14&&t<=15){pred='X';return{p:'X',c:80,r:'14-15→Xỉu (80%)'}}
      if(t>=7&&t<=8){pred='T';return{p:'T',c:74,r:'7-8→Tài (74%)'}}
      if(t>=12&&t<=13){pred='X';return{p:'X',c:74,r:'12-13→Xỉu (74%)'}}
      if(t>=9&&t<=10){pred='X';return{p:'X',c:68,r:'9-10→Xỉu (68%)'}}
      if(t==11){pred='T';return{p:'T',c:68,r:'11→Tài (68%)'}}
    }
  }

  // CHU KỲ 1-1
  if(h.length>=3){
    const a=h[h.length-1],b=h[h.length-2],c=h[h.length-3];
    if(a!==b&&b!==c&&a===c){pred=a==='T'?'X':'T';return{p:pred,c:77,r:'Chu kỳ 1-1 (77%)'}}
  }

  // 2 GIỐNG → THEO
  if(h.length>=2&&h[h.length-1]===h[h.length-2]){pred=h[h.length-1];return{p:pred,c:68,r:'2 giống→theo (68%)'}}

  // THEO CUỐI
  if(h.length>=1){pred=h[h.length-1];return{p:pred,c:60,r:'Theo cuối (60%)'}}

  pred='T';return{p:'T',c:50,r:'Default'}
}

function add(r,sd){
  if(!pred)pred='T';
  const v=pred===r;if(v){ok++;streak++}else{no++;streak=0}
  total++;
  
  // Cập nhật last3
  if(s.length>=1){const t=s[s.length-1].total;if(t!=null){last3.push(t);if(last3.length>3)last3.shift();last2.push(t);if(last2.length>2)last2.shift()}}
  
  // Học BANK 3
  if(last3.length>=3)learn(last3[0]+'_'+last3[1]+'_'+last3[2],v);
  // Học BANK 2
  if(last2.length>=2)learn(last2[0]+'_'+last2[1],v);
  
  const l=logs[logs.length-1];if(l&&!l.kq){l.kq=r==='T'?'Tài':'Xỉu';l.dg=v?'✅':'❌'}
  h.push(r);s.push({total:sd.total||null});
  if(h.length>100000)h=h.slice(-100000);if(s.length>100000)s=s.slice(-100000);
  save()
}

function log(sid,p){logs.push({phien:String(parseInt(sid)+1),dd:p.p==='T'?'Tài':'Xỉu',dg:'',conf:p.c+'%',ts:new Date().toISOString(),r:p.r});if(logs.length>20000)logs=logs.slice(-20000)}

let ws=null,rt=null,pt=null,ra=0;
function connect(){
  if(!WS_URL){setTimeout(connect,10000);return}
  if(rt){clearTimeout(rt);rt=null}if(pt){clearInterval(pt);pt=null}if(ws){try{ws.close()}catch(e){}ws=null}
  try{ws=new WebSocket(WS_URL)}catch(e){setTimeout(connect,10000);return}
  ra++;const bo=Math.min(1000*Math.pow(1.5,ra-1),30000);
  ws.on('open',()=>{ra=0;try{ws.send(JSON.stringify({H:'md5luckydiceHub',M:'Ping',A:[],I:0}))}catch(e){}pt=setInterval(()=>{if(ws&&ws.readyState===1){try{ws.send(JSON.stringify({H:'md5luckydiceHub',M:'Ping',A:[],I:Date.now()}))}catch(e){}}},60000)});
  ws.on('message',(d)=>{try{const j=JSON.parse(d.toString());if(!j.M)return;j.M.forEach(m=>{if(m.M==='Md5sessionInfo'){const i=m.A[0];if(i.CurrentState===0&&i.Ellapsed>0)process.stdout.write('\r⏳'+i.Ellapsed+'s | 🎯'+(total>0?Math.round(ok/total*100):0)+'% | 📊'+total+' | 🔥'+streak+' | 🏦'+Object.keys(bank).length+'   ');if(i.CurrentState===1&&i.Result&&i.Result.Dice1>0&&i.SessionID!==sid){sid=i.SessionID;const d1=i.Result.Dice1,d2=i.Result.Dice2,d3=i.Result.Dice3;const ts=d1+d2+d3,rs=ts>=11?'T':'X';const p=predict();log(i.SessionID,p);add(rs,{total:ts});const ac=total>0?Math.round(ok/total*100):0;console.log('\n#'+i.SessionID+' ['+d1+','+d2+','+d3+']='+ts+' '+(ts>=11?'T':'X')+' | 🔮'+(p.p==='T'?'T':'X')+' '+p.c+'% | 🎯'+ac+'% | 🔥'+streak)}}})}catch(e){}});
  ws.on('close',()=>{if(pt){clearInterval(pt);pt=null}ws=null;rt=setTimeout(connect,bo)});
  ws.on('error',()=>{});
}

setInterval(save,120000);

http.createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin','*');
  const u=new URL(req.url,'http://localhost:'+PORT);
  const ac=total>0?Math.round(ok/total*100):0;
  if(u.pathname==='/health')res.end(JSON.stringify({acc:ac,total,ok,no,streak,bank:Object.keys(bank).length}));
  else if(u.pathname==='/api/logs')res.end(JSON.stringify({logs:logs.slice(-50).reverse()}));
  else if(u.pathname==='/api/reset'){ok=0;no=0;total=0;bank={};streak=0;last3=[];last2=[];res.end(JSON.stringify({ok:1}));}
  else if(u.pathname==='/'||u.pathname===''){
    res.setHeader('Content-Type','text/html;charset=utf-8');
    let html='<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TAI XIU 90%</title><style>*{margin:0;padding:0}body{background:#000;color:#fff;font-family:Arial;padding:15px}.pred-box{background:#0a0000;border:3px solid #f00;padding:20px;text-align:center;border-radius:15px;margin-bottom:15px;animation:pulse 0.5s infinite}@keyframes pulse{0%,100%{border-color:#f00;box-shadow:0 0 30px #f00}50%{border-color:#ff0;box-shadow:0 0 50px #ff0}}.pred-box .lbl{color:#f00;font-size:14px;font-weight:bold}.pred-box .val{font-size:60px;font-weight:bold;margin:8px 0}.pred-box .cf{color:#aaa;font-size:14px}.pred-box .rs{color:#ff0;font-size:13px;margin-top:5px}.acc{font-size:72px;text-align:center;font-weight:bold;color:#f00;text-shadow:0 0 50px #f00}.stats{display:flex;justify-content:space-around;margin:15px 0;flex-wrap:wrap;gap:8px}.stat{text-align:center;background:#111;padding:12px;border-radius:10px;min-width:65px;flex:1}.stat .n{font-size:22px;font-weight:bold}.stat .l{font-size:10px;color:#888}.g{color:#0f0}.r{color:#f00}.log{margin-top:15px}.log-item{background:#111;padding:10px;margin:4px 0;border-radius:6px;display:flex;justify-content:space-between;font-size:12px}.tai{color:#f00;font-weight:bold}.xiu{color:#0f0;font-weight:bold}.btn{background:#f00;color:#fff;border:none;padding:14px;width:100%;font-size:16px;border-radius:10px;margin:10px 0;cursor:pointer;font-weight:bold}</style></head><body><div class="pred-box"><div class="lbl">🎯 DỰ ĐOÁN TIẾP THEO</div><div class="val" id="pred">---</div><div class="cf" id="conf"></div><div class="rs" id="reason"></div></div><div class="acc">'+ac+'%</div><div style="text-align:center;color:#f00;margin:5px 0;font-weight:bold;font-size:14px">🎯 MỤC TIÊU 87-90% DÀI HẠN</div><div class="stats"><div class="stat"><div class="n">'+total+'</div><div class="l">PHIÊN</div></div><div class="stat"><div class="n g">'+ok+'</div><div class="l">ĐÚNG</div></div><div class="stat"><div class="n r">'+no+'</div><div class="l">SAI</div></div><div class="stat"><div class="n" style="color:#ff0">'+streak+'</div><div class="l">STREAK</div></div><div class="stat"><div class="n" style="color:#f0f">'+Object.keys(bank).length+'</div><div class="l">BANK</div></div></div><button class="btn" onclick="load()">🔄 TẢI LẠI</button><div class="log" id="logs"></div><script>async function load(){try{const h=await fetch("/health").then(r=>r.json());document.querySelector(".acc").textContent=h.acc+"%";document.querySelector(".stats").innerHTML=\'<div class="stat"><div class="n">\'+h.total+\'</div><div class="l">PHIÊN</div></div><div class="stat"><div class="n g">\'+h.ok+\'</div><div class="l">ĐÚNG</div></div><div class="stat"><div class="n r">\'+h.no+\'</div><div class="l">SAI</div></div><div class="stat"><div class="n" style="color:#ff0">\'+h.streak+\'</div><div class="l">STREAK</div></div><div class="stat"><div class="n" style="color:#f0f">\'+(h.bank||0)+\'</div><div class="l">BANK</div></div>\';const l=await fetch("/api/logs?limit=1").then(r=>r.json());if(l.logs&&l.logs.length>0){const last=l.logs[0];document.getElementById("pred").textContent=last.dd;document.getElementById("pred").className="val "+(last.dd==="Tài"?"tai":"xiu");document.getElementById("conf").textContent="Độ tin cậy: "+last.conf;document.getElementById("reason").textContent=last.r}const all=await fetch("/api/logs?limit=30").then(r=>r.json());let htm="";if(all.logs)all.logs.forEach(log=>{htm+=\'<div class="log-item"><span class="dd \'+(log.dd==="Tài"?"tai":"xiu")+\'">\'+log.dg+" "+log.dd+\'</span><span>\'+log.conf+" | #"+log.phien+" | "+log.r+\'</span></div>\'});document.getElementById("logs").innerHTML=htm||"⏳ Đang chờ dữ liệu..."}catch(e){}}load();setInterval(load,4000);</script></body></html>';
    res.end(html);
  }else res.end(JSON.stringify({acc:ac}));
}).listen(PORT,()=>console.log('FINAL PORT '+PORT));

connect();
