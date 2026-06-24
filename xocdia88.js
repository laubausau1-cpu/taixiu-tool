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
  // BANK 3
  if(last3.length>=3){const k=last3[0]+'_'+last3[1]+'_'+last3[2];const a=acc(k,3);if(a!==null&&a>=0.90){const p=last3[2]>=11?'X':'T';pred=p;return{p,c:Math.round(a*100),r:'BANK3:'+k+'='+Math.round(a*100)+'%'}}}
  // BANK 2
  if(last2.length>=2){const k=last2[0]+'_'+last2[1];const a=acc(k,3);if(a!==null&&a>=0.88){const p=last2[1]>=11?'X':'T';pred=p;return{p,c:Math.round(a*100),r:'BANK2:'+k+'='+Math.round(a*100)+'%'}}}
  // HOT STREAK
  if(streak>=4&&h.length>=1){pred=h[h.length-1];return{p:pred,c:85,r:'STREAK '+streak}}
  // SIÊU BỆT
  const st8=h.slice(-8);if(st8.length>=8&&st8.every(x=>x==='T')){pred='T';return{p:'T',c:97,r:'BET TAI 8'}}
  if(st8.length>=8&&st8.every(x=>x==='X')){pred='X';return{p:'X',c:97,r:'BET XIU 8'}}
  const st6=h.slice(-6);if(st6.length>=6&&st6.every(x=>x==='T')){pred='T';return{p:'T',c:93,r:'BET TAI 6'}}
  if(st6.length>=6&&st6.every(x=>x==='X')){pred='X';return{p:'X',c:93,r:'BET XIU 6'}}
  const st5=h.slice(-5);if(st5.length>=5&&st5.every(x=>x==='T')){pred='T';return{p:'T',c:90,r:'BET TAI 5'}}
  if(st5.length>=5&&st5.every(x=>x==='X')){pred='X';return{p:'X',c:90,r:'BET XIU 5'}}
  // CỰC TRỊ
  if(s.length>=1){const t=s[s.length-1].total;if(t!=null){if(t<=3){pred='T';return{p:'T',c:94,r:'<=3 -> TAI'}}if(t>=17){pred='X';return{p:'X',c:94,r:'>=17 -> XIU'}}if(t==4){pred='T';return{p:'T',c:90,r:'4 -> TAI'}}if(t==16){pred='X';return{p:'X',c:90,r:'16 -> XIU'}}}}
  // 2 TỔNG
  if(s.length>=2){const t1=s[s.length-2].total,t2=s[s.length-1].total;if(t1!=null&&t2!=null){if(t1<=6&&t2<=6){pred='T';return{p:'T',c:84,r:'2 thap -> TAI'}}if(t1>=15&&t2>=15){pred='X';return{p:'X',c:84,r:'2 cao -> XIU'}}if(t1<=5&&t2>=16){pred='X';return{p:'X',c:92,r:'thap->cao -> XIU'}}if(t1>=16&&t2<=5){pred='T';return{p:'T',c:92,r:'cao->thap -> TAI'}}}}
  // TỔNG ĐƠN
  if(s.length>=1){const t=s[s.length-1].total;if(t!=null){if(t>=5&&t<=6){pred='T';return{p:'T',c:80,r:'5-6 -> TAI'}}if(t>=14&&t<=15){pred='X';return{p:'X',c:80,r:'14-15 -> XIU'}}if(t>=7&&t<=8){pred='T';return{p:'T',c:74,r:'7-8 -> TAI'}}if(t>=12&&t<=13){pred='X';return{p:'X',c:74,r:'12-13 -> XIU'}}if(t>=9&&t<=10){pred='X';return{p:'X',c:68,r:'9-10 -> XIU'}}if(t==11){pred='T';return{p:'T',c:68,r:'11 -> TAI'}}}}
  // CHU KỲ
  if(h.length>=3){const a=h[h.length-1],b=h[h.length-2],c=h[h.length-3];if(a!==b&&b!==c&&a===c){pred=a==='T'?'X':'T';return{p:pred,c:75,r:'1-1'}}}
  // 2 GIỐNG
  if(h.length>=2&&h[h.length-1]===h[h.length-2]){pred=h[h.length-1];return{p:pred,c:68,r:'2 giong'}}
  // THEO CUỐI
  if(h.length>=1){pred=h[h.length-1];return{p:pred,c:60,r:'theo cuoi'}}
  pred='T';return{p:'T',c:50,r:'default'}
}

function add(r,sd){
  if(!pred)pred='T';const v=pred===r;if(v){ok++;streak++}else{no++;streak=0};total++;
  if(s.length>=1){const t=s[s.length-1].total;if(t!=null){last3.push(t);if(last3.length>3)last3.shift();last2.push(t);if(last2.length>2)last2.shift()}}
  if(last3.length>=3)learn(last3[0]+'_'+last3[1]+'_'+last3[2],v);
  if(last2.length>=2)learn(last2[0]+'_'+last2[1],v);
  const l=logs[logs.length-1];if(l&&!l.kq){l.kq=r==='T'?'Tai':'Xiu';l.dg=v?'DUNG':'SAI'}
  h.push(r);s.push({total:sd.total||null});if(h.length>100000)h=h.slice(-100000);if(s.length>100000)s=s.slice(-100000);save()
}

function log(sid,p){logs.push({phien:String(parseInt(sid)+1),dd:p.p==='T'?'Tai':'Xiu',dg:'',conf:p.c+'%',ts:new Date().toISOString(),r:p.r});if(logs.length>20000)logs=logs.slice(-20000)}

let ws=null,rt=null,pt=null,ra=0;
function connect(){
  if(!WS_URL){setTimeout(connect,10000);return}
  if(rt){clearTimeout(rt);rt=null}if(pt){clearInterval(pt);pt=null}if(ws){try{ws.close()}catch(e){}ws=null}
  try{ws=new WebSocket(WS_URL)}catch(e){setTimeout(connect,10000);return}
  ra++;const bo=Math.min(1000*Math.pow(1.5,ra-1),30000);
  ws.on('open',()=>{ra=0;try{ws.send(JSON.stringify({H:'md5luckydiceHub',M:'Ping',A:[],I:0}))}catch(e){}pt=setInterval(()=>{if(ws&&ws.readyState===1){try{ws.send(JSON.stringify({H:'md5luckydiceHub',M:'Ping',A:[],I:Date.now()}))}catch(e){}}},60000)});
  ws.on('message',(d)=>{try{const j=JSON.parse(d.toString());if(!j.M)return;j.M.forEach(m=>{if(m.M==='Md5sessionInfo'){const i=m.A[0];if(i.CurrentState===0&&i.Ellapsed>0)process.stdout.write('\r['+i.Ellapsed+'s] '+(total>0?Math.round(ok/total*100):0)+'% | '+total+' | streak:'+streak+' | bank:'+Object.keys(bank).length+'   ');if(i.CurrentState===1&&i.Result&&i.Result.Dice1>0&&i.SessionID!==sid){sid=i.SessionID;const d1=i.Result.Dice1,d2=i.Result.Dice2,d3=i.Result.Dice3;const ts=d1+d2+d3,rs=ts>=11?'T':'X';const p=predict();log(i.SessionID,p);add(rs,{total:ts});const ac=total>0?Math.round(ok/total*100):0;console.log('\n#'+i.SessionID+' ['+d1+','+d2+','+d3+']='+ts+' '+(ts>=11?'T':'X')+' | '+p.p+' '+p.c+'% | '+ac+'% | bank:'+Object.keys(bank).length)}}})}catch(e){}});
  ws.on('close',()=>{if(pt){clearInterval(pt);pt=null}ws=null;rt=setTimeout(connect,bo)});
  ws.on('error',()=>{});
}

setInterval(save,120000);

http.createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin','*');
  const u=new URL(req.url,'http://localhost:'+PORT);
  const ac=total>0?Math.round(ok/total*100):0;
  if(u.pathname==='/health')res.end(JSON.stringify({acc:ac,total,ok,no,streak,bank:Object.keys(bank).length}));
  else if(u.pathname==='/api/logs')res.end(JSON.stringify({logs:logs.slice(-100).reverse()}));
  else if(u.pathname==='/api/reset'){ok=0;no=0;total=0;bank={};streak=0;last3=[];last2=[];res.end(JSON.stringify({ok:1}));}
  else if(u.pathname==='/'||u.pathname===''){
    res.setHeader('Content-Type','text/html;charset=utf-8');
    res.end('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tai Xiu</title><style>*{margin:0;padding:0}body{background:#111;color:#ddd;font-family:Arial;padding:12px}.box{background:#1a1a1a;border:1px solid #444;padding:18px;text-align:center;border-radius:10px;margin-bottom:12px}.box .l{font-size:12px;color:#888}.box .v{font-size:48px;font-weight:bold;margin:6px 0}.box .c{font-size:13px;color:#aaa}.box .r{font-size:11px;color:#777}.acc{font-size:56px;text-align:center;font-weight:bold;color:#fff}.f{display:flex;gap:8px;margin:12px 0}.st{background:#1a1a1a;padding:12px;border-radius:8px;text-align:center;flex:1}.st .n{font-size:20px;font-weight:bold}.st .l{font-size:10px;color:#888}.g{color:#4f4}.r{color:#f44}.item{background:#1a1a1a;padding:8px;margin:3px 0;border-radius:5px;display:flex;justify-content:space-between;font-size:12px}.tai{color:#f44;font-weight:bold}.xiu{color:#4f4;font-weight:bold}.btn{background:#555;color:#fff;border:none;padding:12px;width:100%;font-size:15px;border-radius:8px;cursor:pointer;margin:10px 0}</style></head><body><div class="box"><div class="l">DU DOAN</div><div class="v" id="pred">---</div><div class="c" id="conf"></div><div class="r" id="reason"></div></div><div class="acc">'+ac+'%</div><div class="f"><div class="st"><div class="n">'+total+'</div><div class="l">PHIEN</div></div><div class="st"><div class="n g">'+ok+'</div><div class="l">DUNG</div></div><div class="st"><div class="n r">'+no+'</div><div class="l">SAI</div></div><div class="st"><div class="n">'+streak+'</div><div class="l">STREAK</div></div><div class="st"><div class="n">'+Object.keys(bank).length+'</div><div class="l">BANK</div></div></div><button class="btn" onclick="load()">TAI LAI</button><div id="logs"></div><script>async function load(){try{const h=await fetch("/health").then(r=>r.json());document.querySelector(".acc").textContent=h.acc+"%";document.querySelector(".f").innerHTML=\'<div class="st"><div class="n">\'+h.total+\'</div><div class="l">PHIEN</div></div><div class="st"><div class="n g">\'+h.ok+\'</div><div class="l">DUNG</div></div><div class="st"><div class="n r">\'+h.no+\'</div><div class="l">SAI</div></div><div class="st"><div class="n">\'+h.streak+\'</div><div class="l">STREAK</div></div><div class="st"><div class="n">\'+(h.bank||0)+\'</div><div class="l">BANK</div></div>\';const l=await fetch("/api/logs?limit=1").then(r=>r.json());if(l.logs&&l.logs.length>0){const last=l.logs[0];document.getElementById("pred").textContent=last.dd;document.getElementById("pred").className="v "+(last.dd==="Tai"?"tai":"xiu");document.getElementById("conf").textContent="Tin cay: "+last.conf;document.getElementById("reason").textContent=last.r}const all=await fetch("/api/logs?limit=50").then(r=>r.json());let htm="";if(all.logs)all.logs.forEach(log=>{htm+=\'<div class="item"><span class="\'+(log.dd==="Tai"?"tai":"xiu")+\'">\'+log.dg+" "+log.dd+\'</span><span>\'+log.conf+" | #"+log.phien+" | "+log.r+\'</span></div>\'});document.getElementById("logs").innerHTML=htm||"Dang cho..."}catch(e){}}load();setInterval(load,5000);</script></body></html>');
  }else res.end(JSON.stringify({acc:ac}));
}).listen(PORT,()=>console.log('PORT '+PORT));

connect();
