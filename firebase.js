import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { db } from "./firebase";
import {
  doc, getDoc, setDoc, onSnapshot, collection, getDocs
} from "firebase/firestore";

// ── Constants ────────────────────────────────────────────────────────────────
const APP_PASSWORD = "lifemate2024";
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const INTERVAL_LABELS = {
  daily:"Every day", weekdays:"Weekdays", weekends:"Weekends",
  weekly:"Once a week", custom:"Custom days", monthly:"Once a month",
  interval:"Every N days", linked:"Triggered by another", todayonly:"Today only"
};
const CATEGORY_META = {
  home:{label:"Home",color:"#4FC3F7"},
  meals:{label:"Meals",color:"#FFB74D"},
  errands:{label:"Errands",color:"#CE93D8"},
  shopping:{label:"Shopping",color:"#A5D6A7"}
};
const CAT_COLOR = { home:"#4FC3F7", meals:"#FFB74D", errands:"#CE93D8", shopping:"#A5D6A7" };
const ICON_GROUPS = [
  {label:"Home", icons:["🧹","🧺","👕","🪣","🧴","🍽️","🌿","💧","🔧","📦","🛋️","🪴","🛏️","🚿"]},
  {label:"Food", icons:["🍳","🥘","🥗","🥪","🍱","☕","🧃","🥤","🍰","🛒","🥩","🥦","🍎","🧁"]},
  {label:"Health", icons:["💊","🏃","🧘","🚶","⚕️","🩺","🦷","💉","❤️","🩹","😴","🧠","💪","🧬"]},
  {label:"Life", icons:["📅","✏️","📚","🎵","✈️","🚗","📞","💼","🎯","🎮","☀️","🌙","⭐","🎁"]},
  {label:"Money", icons:["💰","💳","🏦","📊","🧾","💹","✂️","🏠","🎀","🔑","📱","🖥️","📷","🎓"]}
];
const MEMBER_AVATARS = ["😀","😎","🥳","🤩","😇","🦸","🧑","👩","👨","🧒","👶","🐶","🐱","🌟"];

const DEFAULT_TASKS = [
  {id:1, label:"Do Laundry", icon:"🧺",category:"home", color:"#4FC3F7",active:true,scheduleType:"weekly",customDays:["Mon"],timeBound:false},
  {id:2, label:"Fold Clothes", icon:"👕",category:"home", color:"#81C784",active:true,scheduleType:"linked",timeBound:false},
  {id:3, label:"Cook Lunch", icon:"🍳",category:"meals", color:"#FFB74D",active:true,scheduleType:"daily",timeBound:true,time:"12:00"},
  {id:4, label:"Cook Dinner", icon:"🥘",category:"meals", color:"#FF8A65",active:true,scheduleType:"daily",timeBound:true,time:"18:00"},
  {id:5, label:"Grocery Shopping", icon:"🛒",category:"shopping",color:"#A5D6A7",active:true,scheduleType:"weekly",customDays:["Sat"],timeBound:false},
  {id:6, label:"Take Out Trash", icon:"🗑️",category:"home", color:"#90A4AE",active:true,scheduleType:"weekly",customDays:["Wed"],timeBound:false},
  {id:7, label:"Meal Prep", icon:"🥗",category:"meals", color:"#A5D6A7",active:true,scheduleType:"weekly",customDays:["Sun"],timeBound:false},
  {id:8, label:"Iron Clothes", icon:"👔",category:"home", color:"#F48FB1",active:false,scheduleType:"weekly",customDays:["Sun"],timeBound:false},
  {id:9, label:"Vacuum", icon:"🧹",category:"home", color:"#80DEEA",active:false,scheduleType:"weekly",customDays:["Sat"],timeBound:false},
  {id:10,label:"Water Plants", icon:"🪴",category:"home", color:"#C5E1A5",active:false,scheduleType:"weekly",customDays:["Wed"],timeBound:false},
  {id:11,label:"Pay Bills", icon:"💳",category:"errands",color:"#CE93D8",active:false,scheduleType:"monthly",monthDay:1,timeBound:false}
];
const DEFAULT_SHOPPING = [{id:"s1",name:"Milk",qty:"1L",checked:false},{id:"s2",name:"Eggs",qty:"12",checked:false}];
const DEFAULT_SLEEP = { enabled:false, times:{Sun:"22:30",Mon:"22:30",Tue:"22:30",Wed:"22:30",Thu:"22:30",Fri:"23:00",Sat:"23:00"} };
const DEFAULT_MEDS = { enabled:false, alertHousehold:false, doses:[{id:"m1",label:"Morning",time:"08:00",days:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]}] };

// ── Firebase helpers ──────────────────────────────────────────────────────────
function getDeviceId() {
  let id = localStorage.getItem("lm-device-id");
  if (!id) { id = "dev-" + Math.random().toString(36).slice(2); localStorage.setItem("lm-device-id", id); }
  return id;
}

async function loadUserData(deviceId) {
  try {
    const snap = await getDoc(doc(db, "users", deviceId));
    return snap.exists() ? snap.data() : null;
  } catch(e) { return null; }
}

async function saveUserData(deviceId, data) {
  try {
    await setDoc(doc(db, "users", deviceId), data, { merge: true });
  } catch(e) { console.error("Save failed", e); }
}

async function loadHousehold(hid) {
  try {
    const snap = await getDoc(doc(db, "households", hid));
    return snap.exists() ? snap.data() : null;
  } catch(e) { return null; }
}

async function saveHousehold(hid, data) {
  try {
    await setDoc(doc(db, "households", hid), data, { merge: true });
  } catch(e) { console.error("Household save failed", e); }
}

function generateHid() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let hid = "H";
  for (let i = 0; i < 9; i++) hid += chars[Math.floor(Math.random() * chars.length)];
  return hid;
}

// ── Task scheduling ───────────────────────────────────────────────────────────
function taskOccursOnDay(task, dayName, offset, fullDate) {
  if (task.scheduleType === "linked" || task.scheduleType === "todayonly") return false;
  if (task.scheduleType === "daily") return true;
  if (task.scheduleType === "weekdays") return ["Mon","Tue","Wed","Thu","Fri"].includes(dayName);
  if (task.scheduleType === "weekends") return ["Sat","Sun"].includes(dayName);
  if (task.scheduleType === "weekly" || task.scheduleType === "custom") return (task.customDays||[]).includes(dayName);
  if (task.scheduleType === "monthly") return fullDate ? fullDate.getDate() === (task.monthDay||1) : false;
  if (task.scheduleType === "interval") {
    const anchor = task._intervalAnchorOffset !== undefined ? task._intervalAnchorOffset : 0;
    const off = ((offset - anchor) % task.intervalDays + task.intervalDays) % task.intervalDays;
    return off === 0;
  }
  return false;
}

function buildDayWindow() {
  const today = new Date();
  const slots = [];
  for (let i = -1; i <= 6; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const dd = String(d.getDate()).padStart(2,"0");
    slots.push({ dayName:DAYS[d.getDay()], date:d.getDate(), fullDate:new Date(d), offset:i, key:`${y}-${m}-${dd}` });
  }
  return slots;
}

// ── Small reusable components ─────────────────────────────────────────────────
function Toggle({on, onChange}) {
  return (
    <div onClick={onChange} style={{width:44,height:26,borderRadius:99,background:on?"linear-gradient(135deg,#4FC3F7,#7C4DFF)":"#1A1A2E",position:"relative",cursor:"pointer",transition:"background .3s",flexShrink:0}}>
      <div style={{position:"absolute",top:3,left:on?20:3,width:18,height:18,borderRadius:"50%",background:"#fff",transition:"left .2s",boxShadow:"0 1px 4px rgba(0,0,0,.4)"}} />
    </div>
  );
}

function Lbl({children}) { return <div style={{color:"#666",fontSize:11,letterSpacing:2,textTransform:"uppercase",marginBottom:7,fontFamily:"monospace"}}>{children}</div>; }

function DayPills({selected, onChange, single}) {
  return (
    <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
      {DAYS.map(d => (
        <button key={d} onClick={() => { if (single) onChange([d]); else onChange(selected.includes(d)?selected.filter(x=>x!==d):[...selected,d]); }}
          style={{padding:"5px 10px",borderRadius:99,border:"none",cursor:"pointer",fontSize:12,
            background:selected.includes(d)?"linear-gradient(135deg,#4FC3F7,#7C4DFF)":"#1A1A2E",
            color:selected.includes(d)?"#fff":"#555",transition:"all .2s"}}>
          {d}
        </button>
      ))}
    </div>
  );
}

function IconPicker({value, onChange}) {
  const [open,setOpen] = useState(false);
  const [grp,setGrp] = useState(0);
  return (
    <div style={{position:"relative"}}>
      <button onClick={()=>setOpen(p=>!p)} style={{width:52,height:52,borderRadius:14,background:"#1A1A2E",border:"1px solid #2A2A44",fontSize:24,cursor:"pointer"}}>{value}</button>
      {open && (
        <div style={{position:"absolute",top:58,left:0,zIndex:50,background:"#181828",border:"1px solid #2A2A44",borderRadius:16,padding:12,width:260}}>
          <div style={{display:"flex",gap:5,marginBottom:10,flexWrap:"wrap"}}>
            {ICON_GROUPS.map((g,i) => (
              <button key={g.label} onClick={()=>setGrp(i)} style={{padding:"3px 8px",borderRadius:8,border:"none",cursor:"pointer",fontSize:11,background:grp===i?"#4FC3F7":"#1A1A2E",color:grp===i?"#000":"#888"}}>{g.label}</button>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
            {ICON_GROUPS[grp].icons.map(ic => (
              <button key={ic} onClick={()=>{onChange(ic);setOpen(false);}} style={{width:32,height:32,borderRadius:8,border:"none",cursor:"pointer",background:"transparent",fontSize:18}}>{ic}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Password Screen ───────────────────────────────────────────────────────────
function PasswordScreen({onUnlock}) {
  const [pw,setPw] = useState("");
  const [error,setError] = useState(false);
  const [shake,setShake] = useState(false);

  function attempt() {
    if (pw === APP_PASSWORD) {
      localStorage.setItem("lm-unlocked","1");
      onUnlock();
    } else {
      setError(true);
      setShake(true);
      setPw("");
      setTimeout(()=>setShake(false),500);
    }
  }

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(165deg,#0D0D1C,#0A0A14)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32}}>
      <div style={{fontSize:64,marginBottom:16}}>🏠</div>
      <div style={{color:"#4FC3F7",fontSize:11,letterSpacing:4,fontFamily:"monospace",marginBottom:8}}>LIFEMATE</div>
      <div style={{color:"#E0E0FF",fontSize:22,fontWeight:"bold",marginBottom:4}}>Welcome back</div>
      <div style={{color:"#555",fontSize:13,marginBottom:40,textAlign:"center"}}>Enter your family password to continue</div>
      <div style={{width:"100%",maxWidth:300,animation:shake?"shake .4s":"none"}}>
        <input
          type="password"
          value={pw}
          onChange={e=>{setPw(e.target.value);setError(false);}}
          onKeyDown={e=>e.key==="Enter"&&attempt()}
          placeholder="Password"
          autoFocus
          style={{width:"100%",padding:"14px 16px",borderRadius:14,border:`1px solid ${error?"#EF9A9A":"#2A2A44"}`,background:"#0F0F1E",color:"#E0E0FF",fontSize:16,outline:"none",marginBottom:12,boxSizing:"border-box"}}
        />
        {error && <div style={{color:"#EF9A9A",fontSize:13,textAlign:"center",marginBottom:8}}>Wrong password. Try again.</div>}
        <button onClick={attempt} style={{width:"100%",padding:14,borderRadius:14,border:"none",background:"linear-gradient(135deg,#4FC3F7,#7C4DFF)",color:"#fff",fontSize:16,fontWeight:"bold",cursor:"pointer"}}>
          Unlock
        </button>
      </div>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}`}</style>
    </div>
  );
}

// ── Loading Screen ────────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(165deg,#0D0D1C,#0A0A14)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
      <div style={{fontSize:48,marginBottom:16}}>🏠</div>
      <div style={{color:"#4FC3F7",fontSize:11,letterSpacing:4,fontFamily:"monospace"}}>LOADING...</div>
    </div>
  );
}

// ── Fireworks ─────────────────────────────────────────────────────────────────
function Fireworks({onDone}) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    if (navigator.vibrate) navigator.vibrate([80,40,80]);
    const particles = [];
    const colors = ["#4FC3F7","#7C4DFF","#FFB74D","#A5D6A7","#F48FB1","#fff"];
    for (let b = 0; b < 6; b++) {
      const bx = 60+Math.random()*280, by = 80+Math.random()*200;
      for (let i = 0; i < 40; i++) {
        const angle = (Math.PI*2*i)/40, speed = 2+Math.random()*4;
        particles.push({x:bx,y:by,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-2,color:colors[Math.floor(Math.random()*colors.length)],alpha:1,size:3+Math.random()*3});
      }
    }
    let frame = 0;
    function animate() {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vy+=0.1;p.alpha-=0.018;p.vx*=0.99;ctx.globalAlpha=Math.max(0,p.alpha);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();});
      ctx.globalAlpha=1; frame++;
      if (frame < 120) requestAnimationFrame(animate); else onDone();
    }
    animate();
  }, []);
  return (
    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:999}}>
      <canvas ref={ref} style={{width:"100%",height:"100%"}} />
      <div style={{position:"absolute",top:"40%",left:0,right:0,textAlign:"center"}}>
        <div style={{fontSize:36,marginBottom:8}}>🎉</div>
        <div style={{color:"#fff",fontSize:18,fontWeight:"bold",textShadow:"0 2px 10px rgba(0,0,0,.5)"}}>All done!</div>
      </div>
    </div>
  );
}

// ── Shopping Panel ────────────────────────────────────────────────────────────
function ShoppingPanel({items, setItems}) {
  const [name,setName] = useState(""); const [qty,setQty] = useState("");
  function addItem() { if (!name.trim()) return; setItems(p=>[...p,{id:"s"+Date.now(),name:name.trim(),qty:qty.trim(),checked:false}]); setName(""); setQty(""); }
  const checked = items.filter(i=>i.checked).length;
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div style={{color:"#A5D6A7",fontSize:10,letterSpacing:3,fontFamily:"monospace"}}>SHOPPING LIST</div>
        <div style={{display:"flex",gap:7}}>
          {checked > 0 && <button onClick={()=>setItems(p=>p.filter(i=>!i.checked))} style={{background:"rgba(239,83,80,.15)",border:"1px solid rgba(239,83,80,.3)",color:"#EF9A9A",borderRadius:8,padding:"4px 10px",fontSize:11,cursor:"pointer"}}>Clear done</button>}
          {items.length > 0 && <button onClick={()=>setItems([])} style={{background:"rgba(255,255,255,.05)",border:"1px solid #2A2A44",color:"#555",borderRadius:8,padding:"4px 10px",fontSize:11,cursor:"pointer"}}>Clear all</button>}
        </div>
      </div>
      <div style={{display:"flex",gap:7,marginBottom:14}}>
        <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addItem()} placeholder="Item name…" style={{flex:2,padding:"10px 12px",borderRadius:12,border:"1px solid #2A2A44",background:"#0F0F1E",color:"#E0E0FF",fontSize:13,outline:"none"}} />
        <input value={qty} onChange={e=>setQty(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addItem()} placeholder="Qty" style={{flex:1,padding:"10px 12px",borderRadius:12,border:"1px solid #2A2A44",background:"#0F0F1E",color:"#E0E0FF",fontSize:13,outline:"none"}} />
        <button onClick={addItem} style={{padding:"10px 14px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#4FC3F7,#7C4DFF)",color:"#fff",fontSize:18,cursor:"pointer"}}>+</button>
      </div>
      {items.length === 0 && <div style={{textAlign:"center",padding:"28px 0",color:"#444"}}>No items yet</div>}
      {items.filter(i=>!i.checked).map(item=>(
        <div key={item.id} style={{display:"flex",alignItems:"center",gap:9,padding:"10px 12px",background:"rgba(255,255,255,.04)",borderRadius:12,marginBottom:6}}>
          <div onClick={()=>setItems(p=>p.map(i=>i.id===item.id?{...i,checked:true}:i))} style={{width:22,height:22,borderRadius:7,border:"2px solid #2A2A44",cursor:"pointer",flexShrink:0}} />
          <span style={{flex:1,color:"#ddd",fontSize:13}}>{item.name}</span>
          {item.qty && <span style={{color:"#666",fontSize:11,fontFamily:"monospace"}}>{item.qty}</span>}
          <button onClick={()=>setItems(p=>p.filter(i=>i.id!==item.id))} style={{background:"none",border:"none",color:"#444",fontSize:16,cursor:"pointer"}}>×</button>
        </div>
      ))}
      {checked > 0 && items.filter(i=>!i.checked).length > 0 && <div style={{height:1,background:"#1A1A2E",margin:"10px 0"}} />}
      {items.filter(i=>i.checked).map(item=>(
        <div key={item.id} style={{display:"flex",alignItems:"center",gap:9,padding:"10px 12px",background:"rgba(255,255,255,.02)",borderRadius:12,marginBottom:6,opacity:.5}}>
          <div onClick={()=>setItems(p=>p.map(i=>i.id===item.id?{...i,checked:false}:i))} style={{width:22,height:22,borderRadius:7,background:"linear-gradient(135deg,#4FC3F7,#7C4DFF)",cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:14}}>✓</div>
          <span style={{flex:1,color:"#555",fontSize:13,textDecoration:"line-through"}}>{item.name}</span>
          {item.qty && <span style={{color:"#444",fontSize:11,fontFamily:"monospace"}}>{item.qty}</span>}
          <button onClick={()=>setItems(p=>p.filter(i=>i.id!==item.id))} style={{background:"none",border:"none",color:"#333",fontSize:16,cursor:"pointer"}}>×</button>
        </div>
      ))}
    </div>
  );
}

// ── Todo Panel ────────────────────────────────────────────────────────────────
function TodoPanel({todos, setTodos, onMoveToToday}) {
  const [text,setText] = useState("");
  function addTodo() { if (!text.trim()) return; setTodos(p=>[...p,{id:Date.now(),text:text.trim(),done:false}]); setText(""); }
  const pending = todos.filter(t=>!t.done);
  const finished = todos.filter(t=>t.done);
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div style={{color:"#4FC3F7",fontSize:10,letterSpacing:3,fontFamily:"monospace"}}>TO-DO LIST</div>
        {finished.length > 0 && <button onClick={()=>setTodos(p=>p.filter(t=>!t.done))} style={{background:"rgba(239,83,80,.15)",border:"1px solid rgba(239,83,80,.3)",color:"#EF9A9A",borderRadius:8,padding:"4px 10px",fontSize:11,cursor:"pointer"}}>Clear done</button>}
      </div>
      <div style={{display:"flex",gap:7,marginBottom:14}}>
        <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTodo()} placeholder="Add a to-do…" style={{flex:1,padding:"10px 12px",borderRadius:12,border:"1px solid #2A2A44",background:"#0F0F1E",color:"#E0E0FF",fontSize:13,outline:"none"}} />
        <button onClick={addTodo} style={{padding:"10px 14px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#4FC3F7,#7C4DFF)",color:"#fff",fontSize:18,cursor:"pointer"}}>+</button>
      </div>
      {todos.length === 0 && <div style={{textAlign:"center",padding:"28px 0",color:"#444"}}>No to-dos yet</div>}
      {pending.map(todo=>(
        <div key={todo.id} style={{display:"flex",alignItems:"center",gap:10,background:"rgba(255,255,255,.04)",borderRadius:12,padding:"10px 12px",marginBottom:6}}>
          <div onClick={()=>setTodos(p=>p.map(t=>t.id===todo.id?{...t,done:true}:t))} style={{width:22,height:22,borderRadius:7,border:"2px solid #2A2A44",cursor:"pointer",flexShrink:0}} />
          <span style={{flex:1,color:"#E0E0F0",fontSize:13}}>{todo.text}</span>
          <button onClick={()=>onMoveToToday(todo)} style={{background:"linear-gradient(135deg,rgba(79,195,247,.15),rgba(124,77,255,.15))",border:"1px solid rgba(79,195,247,.3)",color:"#4FC3F7",borderRadius:8,padding:"4px 8px",fontSize:10,cursor:"pointer"}}>→ Today</button>
          <button onClick={()=>setTodos(p=>p.filter(t=>t.id!==todo.id))} style={{background:"none",border:"none",color:"#444",fontSize:16,cursor:"pointer"}}>×</button>
        </div>
      ))}
      {finished.length > 0 && pending.length > 0 && <div style={{height:1,background:"#1A1A2E",margin:"10px 0"}} />}
      {finished.map(todo=>(
        <div key={todo.id} style={{display:"flex",alignItems:"center",gap:10,background:"rgba(255,255,255,.02)",borderRadius:12,padding:"10px 12px",marginBottom:6,opacity:.5}}>
          <div onClick={()=>setTodos(p=>p.map(t=>t.id===todo.id?{...t,done:false}:t))} style={{width:22,height:22,borderRadius:7,background:"linear-gradient(135deg,#4FC3F7,#7C4DFF)",cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:14}}>✓</div>
          <span style={{flex:1,color:"#555",fontSize:13,textDecoration:"line-through"}}>{todo.text}</span>
          <button onClick={()=>setTodos(p=>p.filter(t=>t.id!==todo.id))} style={{background:"none",border:"none",color:"#333",fontSize:16,cursor:"pointer"}}>×</button>
        </div>
      ))}
    </div>
  );
}

// ── Task Drawer ───────────────────────────────────────────────────────────────
function TaskDrawer({task, tasks, onSave, onDelete, onClose}) {
  const isNew = !task;
  const defaultForm = {label:"",icon:"⭐",category:"home",color:"#4FC3F7",active:true,timeBound:false,time:"09:00",remind:false,scheduleType:"daily",customDays:[],intervalDays:2,monthDay:1,linkedNextDay:null,_parentId:null};
  const [f,setF] = useState(task || defaultForm);
  function s(k,v) { setF(p=>({...p,[k]:v})); }
  const cats = Object.keys(CATEGORY_META);
  const schedTypes = Object.keys(INTERVAL_LABELS);
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.82)",backdropFilter:"blur(8px)",zIndex:100,display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
      <div onClick={e=>e.stopPropagation()} style={{width:"100%",background:"linear-gradient(180deg,#141428,#0D0D1C)",borderRadius:"24px 24px 0 0",padding:"0 20px 40px",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{width:40,height:4,background:"#333",borderRadius:99,margin:"16px auto 20px"}} />
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <div style={{color:"#4FC3F7",fontSize:10,letterSpacing:3,fontFamily:"monospace"}}>{isNew?"NEW ACTIVITY":"EDIT ACTIVITY"}</div>
          <button onClick={onClose} style={{marginLeft:"auto",background:"rgba(255,255,255,.08)",border:"1px solid #2A2A44",color:"#888",borderRadius:10,width:32,height:32,cursor:"pointer",fontSize:18}}>×</button>
        </div>
        <div style={{display:"flex",gap:9,marginBottom:13,alignItems:"flex-start"}}>
          <IconPicker value={f.icon} onChange={v=>s("icon",v)} />
          <input value={f.label} onChange={e=>s("label",e.target.value)} placeholder="Activity name…" style={{flex:1,padding:"14px 12px",borderRadius:14,border:"1px solid #2A2A44",background:"#0F0F1E",color:"#E0E0FF",fontSize:15,outline:"none"}} />
        </div>
        <div style={{marginBottom:13}}>
          <Lbl>Category</Lbl>
          <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
            {cats.map(cat=>(
              <button key={cat} onClick={()=>{s("category",cat);s("color",CAT_COLOR[cat]);}}
                style={{padding:"6px 14px",borderRadius:99,border:`1px solid ${f.category===cat?CATEGORY_META[cat].color:"#2A2A44"}`,background:f.category===cat?CATEGORY_META[cat].color+"22":"transparent",color:f.category===cat?CATEGORY_META[cat].color:"#555",fontSize:12,cursor:"pointer"}}>
                {CATEGORY_META[cat].label}
              </button>
            ))}
          </div>
        </div>
        <div style={{marginBottom:13}}>
          <Lbl>Schedule</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {schedTypes.map(type=>(
              <button key={type} onClick={()=>{s("scheduleType",type);if(type==="weekly"||type==="custom")s("customDays",f.customDays.length?f.customDays:[DAYS[new Date().getDay()]]);}}
                style={{padding:"5px 12px",borderRadius:99,border:`1px solid ${f.scheduleType===type?"#4FC3F7":"#2A2A44"}`,background:f.scheduleType===type?"rgba(79,195,247,.15)":"transparent",color:f.scheduleType===type?"#4FC3F7":"#555",fontSize:11,cursor:"pointer"}}>
                {INTERVAL_LABELS[type]}
              </button>
            ))}
          </div>
        </div>
        {(f.scheduleType==="weekly"||f.scheduleType==="custom") && (
          <div style={{marginBottom:13}}>
            <Lbl>{f.scheduleType==="weekly"?"Which day?":"Which days?"}</Lbl>
            <DayPills selected={f.customDays} onChange={v=>s("customDays",v)} single={f.scheduleType==="weekly"} />
          </div>
        )}
        {f.scheduleType==="interval" && (
          <div style={{marginBottom:13}}>
            <Lbl>Every how many days?</Lbl>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <button onClick={()=>s("intervalDays",Math.max(1,f.intervalDays-1))} style={{width:36,height:36,borderRadius:10,border:"1px solid #2A2A44",background:"#1A1A2E",color:"#fff",fontSize:18,cursor:"pointer"}}>−</button>
              <div style={{flex:1,textAlign:"center",color:"#4FC3F7",fontSize:22,fontFamily:"monospace"}}>{f.intervalDays}</div>
              <button onClick={()=>s("intervalDays",f.intervalDays+1)} style={{width:36,height:36,borderRadius:10,border:"1px solid #2A2A44",background:"#1A1A2E",color:"#fff",fontSize:18,cursor:"pointer"}}>+</button>
            </div>
          </div>
        )}
        {f.scheduleType==="monthly" && (
          <div style={{marginBottom:13}}>
            <Lbl>Day of the month</Lbl>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {Array.from({length:31},(_,i)=>i+1).map(d=>(
                <button key={d} onClick={()=>s("monthDay",d)} style={{width:36,height:36,borderRadius:10,border:`1px solid ${f.monthDay===d?"#4FC3F7":"#2A2A44"}`,background:f.monthDay===d?"rgba(79,195,247,.15)":"transparent",color:f.monthDay===d?"#4FC3F7":"#555",fontSize:12,cursor:"pointer"}}>{d}</button>
              ))}
            </div>
          </div>
        )}
        {f.scheduleType!=="linked"&&f.scheduleType!=="todayonly" && (
          <div style={{marginBottom:13}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <Lbl>Specific time</Lbl>
              <Toggle on={f.timeBound} onChange={()=>s("timeBound",!f.timeBound)} />
            </div>
            {f.timeBound && <input type="time" value={f.time} onChange={e=>s("time",e.target.value)} style={{width:"100%",padding:"10px 12px",borderRadius:12,border:"1px solid #2A2A44",background:"#0F0F1E",color:"#E0E0FF",fontSize:15,outline:"none",boxSizing:"border-box"}} />}
          </div>
        )}
        <div style={{display:"flex",gap:9,marginTop:8}}>
          {onDelete && <button onClick={onDelete} style={{width:44,height:44,background:"rgba(239,83,80,.15)",border:"1px solid rgba(239,83,80,.3)",borderRadius:12,color:"#EF9A9A",fontSize:18,cursor:"pointer"}}>🗑</button>}
          <button onClick={onClose} style={{flex:1,padding:13,background:"#1A1A2E",border:"1px solid #2A2A44",borderRadius:14,color:"#888",fontSize:14,cursor:"pointer"}}>Cancel</button>
          <button onClick={()=>{if(!f.label.trim())return;onSave(f);}} style={{flex:2,padding:13,background:"linear-gradient(135deg,#4FC3F7,#7C4DFF)",border:"none",borderRadius:14,color:"#fff",fontSize:14,fontWeight:"bold",cursor:"pointer"}}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Household Setup ───────────────────────────────────────────────────────────
function HouseholdSetup({deviceId, userName, userAvatar, onDone}) {
  const [mode,setMode] = useState("choose");
  const [code,setCode] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");

  async function createHousehold() {
    setBusy(true); setError("");
    const hid = generateHid();
    const hdata = {
      id: hid,
      members: [{uid:deviceId, name:userName, avatar:userAvatar, joinedAt:Date.now()}],
      shoppingList: [],
      sharedTodos: [],
      delegatedTasks: [],
      createdAt: Date.now()
    };
    await saveHousehold(hid, hdata);
    onDone(hdata);
    setBusy(false);
  }

  async function joinHousehold() {
    const hid = code.trim().toUpperCase();
    if (!hid) { setError("Enter a code"); return; }
    setBusy(true); setError("");
    const hh = await loadHousehold(hid);
    if (!hh) { setError("Household not found. Check the code."); setBusy(false); return; }
    if (!hh.members.find(m=>m.uid===deviceId)) {
      hh.members.push({uid:deviceId, name:userName, avatar:userAvatar, joinedAt:Date.now()});
      await saveHousehold(hid, hh);
    }
    onDone(hh);
    setBusy(false);
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",backdropFilter:"blur(8px)",zIndex:100,display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
      <div style={{background:"linear-gradient(180deg,#141428,#0D0D1C)",borderRadius:"24px 24px 0 0",padding:"0 20px 40px",maxHeight:"80vh",overflowY:"auto"}}>
        <div style={{width:40,height:4,background:"#333",borderRadius:99,margin:"16px auto 20px"}} />
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{fontSize:36,marginBottom:8}}>🏠</div>
          <div style={{color:"#4FC3F7",fontSize:11,letterSpacing:3,fontFamily:"monospace",marginBottom:4}}>HOUSEHOLD SYNC</div>
          <div style={{color:"#E0E0FF",fontSize:18,fontWeight:"bold"}}>Connect with your family</div>
        </div>
        {mode==="choose" && (
          <div>
            <button onClick={()=>setMode("create")} style={{width:"100%",display:"flex",alignItems:"center",gap:14,padding:"16px",background:"rgba(79,195,247,.08)",border:"1px solid rgba(79,195,247,.2)",borderRadius:16,cursor:"pointer",marginBottom:10}}>
              <span style={{fontSize:28}}>✚</span>
              <div style={{textAlign:"left"}}>
                <div style={{color:"#E0E0FF",fontSize:15,fontWeight:"bold"}}>Create new household</div>
                <div style={{color:"#555",fontSize:12}}>Get a code to share with family</div>
              </div>
            </button>
            <button onClick={()=>setMode("join")} style={{width:"100%",display:"flex",alignItems:"center",gap:14,padding:"16px",background:"rgba(124,77,255,.08)",border:"1px solid rgba(124,77,255,.2)",borderRadius:16,cursor:"pointer",marginBottom:10}}>
              <span style={{fontSize:28}}>🔗</span>
              <div style={{textAlign:"left"}}>
                <div style={{color:"#E0E0FF",fontSize:15,fontWeight:"bold"}}>Join existing household</div>
                <div style={{color:"#555",fontSize:12}}>Enter a code from a family member</div>
              </div>
            </button>
            <button onClick={()=>onDone(null)} style={{width:"100%",padding:14,background:"transparent",border:"none",color:"#555",fontSize:14,cursor:"pointer"}}>Not now</button>
          </div>
        )}
        {mode==="create" && (
          <div>
            <div style={{color:"#888",fontSize:13,marginBottom:20,lineHeight:1.7,textAlign:"center"}}>A unique 10-character code will be created. Share it with your family so they can join.</div>
            <button onClick={createHousehold} disabled={busy} style={{width:"100%",padding:14,background:"linear-gradient(135deg,#4FC3F7,#7C4DFF)",border:"none",borderRadius:14,color:"#fff",fontSize:15,fontWeight:"bold",cursor:"pointer",marginBottom:10}}>
              {busy?"Creating…":"Create Household"}
            </button>
            <button onClick={()=>setMode("choose")} style={{width:"100%",padding:14,background:"transparent",border:"none",color:"#555",fontSize:14,cursor:"pointer"}}>Back</button>
          </div>
        )}
        {mode==="join" && (
          <div>
            <div style={{color:"#777",fontSize:10,letterSpacing:2,fontFamily:"monospace",marginBottom:8}}>HOUSEHOLD CODE</div>
            <input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="Enter code (e.g. HABC123456)" style={{width:"100%",padding:"14px 16px",borderRadius:14,border:"1px solid #2A2A44",background:"#0F0F1E",color:"#4FC3F7",fontSize:18,fontFamily:"monospace",letterSpacing:3,outline:"none",marginBottom:12,boxSizing:"border-box",textAlign:"center"}} />
            {error && <div style={{color:"#EF9A9A",fontSize:12,textAlign:"center",marginBottom:8}}>{error}</div>}
            <button onClick={joinHousehold} disabled={busy||code.length<10} style={{width:"100%",padding:14,background:"linear-gradient(135deg,#4FC3F7,#7C4DFF)",border:"none",borderRadius:14,color:"#fff",fontSize:15,fontWeight:"bold",cursor:"pointer",opacity:code.length<10?.5:1,marginBottom:10}}>
              {busy?"Joining…":"Join Household"}
            </button>
            <button onClick={()=>setMode("choose")} style={{width:"100%",padding:14,background:"transparent",border:"none",color:"#555",fontSize:14,cursor:"pointer"}}>Back</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Profile Setup ─────────────────────────────────────────────────────────────
function ProfileSetup({onDone}) {
  const [name,setName] = useState("");
  const [avatar,setAvatar] = useState("😀");
  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(165deg,#0D0D1C,#0A0A14)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32}}>
      <div style={{fontSize:64,marginBottom:8}}>{avatar}</div>
      <div style={{color:"#4FC3F7",fontSize:11,letterSpacing:4,fontFamily:"monospace",marginBottom:8}}>LIFEMATE</div>
      <div style={{color:"#E0E0FF",fontSize:22,fontWeight:"bold",marginBottom:4}}>Who are you?</div>
      <div style={{color:"#555",fontSize:13,marginBottom:32,textAlign:"center"}}>Set up your profile to get started</div>
      <div style={{width:"100%",maxWidth:340}}>
        <div style={{color:"#777",fontSize:10,letterSpacing:2,fontFamily:"monospace",marginBottom:8}}>CHOOSE YOUR AVATAR</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:20,justifyContent:"center"}}>
          {MEMBER_AVATARS.map(a=>(
            <button key={a} onClick={()=>setAvatar(a)} style={{width:48,height:48,borderRadius:14,border:`2px solid ${avatar===a?"#4FC3F7":"#2A2A44"}`,background:avatar===a?"rgba(79,195,247,.15)":"#0F0F1E",fontSize:24,cursor:"pointer"}}>{a}</button>
          ))}
        </div>
        <div style={{color:"#777",fontSize:10,letterSpacing:2,fontFamily:"monospace",marginBottom:8}}>YOUR NAME</div>
        <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&name.trim()&&onDone(name.trim(),avatar)} placeholder="e.g. Maria" style={{width:"100%",padding:"14px 16px",borderRadius:14,border:"1px solid #2A2A44",background:"#0F0F1E",color:"#E0E0FF",fontSize:16,outline:"none",marginBottom:16,boxSizing:"border-box"}} />
        <button onClick={()=>name.trim()&&onDone(name.trim(),avatar)} style={{width:"100%",padding:14,borderRadius:14,border:"none",background:name.trim()?"linear-gradient(135deg,#4FC3F7,#7C4DFF)":"#1A1A2E",color:name.trim()?"#fff":"#555",fontSize:16,fontWeight:"bold",cursor:name.trim()?"pointer":"default"}}>
          Let's go →
        </button>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const deviceId = useMemo(()=>getDeviceId(),[]);
  const dayWindow = useMemo(()=>buildDayWindow(),[]);
  const todaySlot = dayWindow[1];
  const todayKey = todaySlot.key;
  const todayName = todaySlot.dayName;

  // Auth states
  const [unlocked, setUnlocked] = useState(()=>localStorage.getItem("lm-unlocked")==="1");
  const [loading, setLoading] = useState(true);
  const [profileDone, setProfileDone] = useState(false);

  // User data
  const [userName, setUserName] = useState("");
  const [userAvatar, setUserAvatar] = useState("😀");
  const [tasks, setTasks] = useState(DEFAULT_TASKS);
  const [done, setDone] = useState({});
  const [shopItems, setShopItems] = useState(DEFAULT_SHOPPING);
  const [todos, setTodos] = useState([]);
  const [sleep, setSleep] = useState(DEFAULT_SLEEP);
  const [meds, setMeds] = useState(DEFAULT_MEDS);
  const [medsDone, setMedsDone] = useState({});
  const [maxRollover, setMaxRollover] = useState(2);
  const [history, setHistory] = useState({});
  const [household, setHousehold] = useState(null);
  const [householdId, setHouseholdId] = useState(null);

  // UI states
  const [selKey, setSelKey] = useState(todayKey);
  const [tab, setTab] = useState("today");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [todoOpen, setTodoOpen] = useState(false);
  const [showHHSetup, setShowHHSetup] = useState(false);
  const [showSleep, setShowSleep] = useState(false);
  const [showMeds, setShowMeds] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [fireworks, setFireworks] = useState(false);
  const [clock, setClock] = useState(new Date());
  const prevDoneRef = useRef(0);
  const saveTimerRef = useRef(null);

  // Clock
  useEffect(()=>{ const t=setInterval(()=>setClock(new Date()),1000); return ()=>clearInterval(t); },[]);

  // Load user data from Firebase on start
  useEffect(()=>{
    if (!unlocked) { setLoading(false); return; }
    loadUserData(deviceId).then(data=>{
      if (data) {
        if (data.userName) { setUserName(data.userName); setProfileDone(true); }
        if (data.userAvatar) setUserAvatar(data.userAvatar);
        if (data.tasks) setTasks(data.tasks);
        if (data.done) setDone(data.done);
        if (data.shopItems) setShopItems(data.shopItems);
        if (data.todos) setTodos(data.todos);
        if (data.sleep) setSleep(data.sleep);
        if (data.meds) setMeds(data.meds);
        if (data.medsDone) setMedsDone(data.medsDone);
        if (data.maxRollover) setMaxRollover(data.maxRollover);
        if (data.history) setHistory(data.history);
        if (data.householdId) setHouseholdId(data.householdId);
      }
      setLoading(false);
    });
  },[unlocked]);

  // Load household when householdId is set
  useEffect(()=>{
    if (!householdId) return;
    loadHousehold(householdId).then(hh=>{ if (hh) setHousehold(hh); });
    // Listen for real-time household updates
    const unsub = onSnapshot(doc(db,"households",householdId), snap=>{
      if (snap.exists()) {
        const hh = snap.data();
        setHousehold(hh);
        if (hh.shoppingList) setShopItems(hh.shoppingList);
        if (hh.sharedTodos) setTodos(hh.sharedTodos);
      }
    });
    return ()=>unsub();
  },[householdId]);

  // Auto-save to Firebase (debounced)
  function scheduleSave(patch) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(()=>{
      saveUserData(deviceId, patch);
    }, 1500);
  }

  // Whenever key state changes, save it
  useEffect(()=>{ if (!profileDone) return; scheduleSave({tasks}); },[tasks]);
  useEffect(()=>{ if (!profileDone) return; scheduleSave({done}); },[done]);
  useEffect(()=>{ if (!profileDone) return; scheduleSave({shopItems}); },[shopItems]);
  useEffect(()=>{ if (!profileDone) return; scheduleSave({todos}); },[todos]);
  useEffect(()=>{ if (!profileDone) return; scheduleSave({sleep}); },[sleep]);
  useEffect(()=>{ if (!profileDone) return; scheduleSave({meds}); },[meds]);
  useEffect(()=>{ if (!profileDone) return; scheduleSave({medsDone}); },[medsDone]);
  useEffect(()=>{ if (!profileDone) return; scheduleSave({maxRollover}); },[maxRollover]);
  useEffect(()=>{ if (!profileDone) return; scheduleSave({history}); },[history]);

  // Sync shopping/todos to household
  function setShopAndSync(fn) {
    setShopItems(prev=>{
      const next = typeof fn==="function"?fn(prev):fn;
      if (household) saveHousehold(householdId,{...household,shoppingList:next});
      return next;
    });
  }
  function setTodosAndSync(fn) {
    setTodos(prev=>{
      const next = typeof fn==="function"?fn(prev):fn;
      if (household) saveHousehold(householdId,{...household,sharedTodos:next});
      return next;
    });
  }

  // Task scheduling
  const selSlot = dayWindow.find(s=>s.key===selKey)||todaySlot;
  const getTasksForSlot = useCallback((slot)=>{
    const {dayName,offset,key,fullDate} = slot;
    const prevSlot = dayWindow.find(s=>s.offset===offset-1);
    const prevKey = prevSlot?prevSlot.key:null;
    const natural = tasks.filter(t=>t.active&&taskOccursOnDay(t,dayName,offset,fullDate));
    const todayOnlyHere = tasks.filter(t=>t.active&&t.scheduleType==="todayonly"&&t._forDay===key);
    const linked = tasks.filter(t=>{
      if (!t.active||(t.scheduleType!=="linked"&&t.scheduleType!=="todayonly")) return false;
      if (natural.find(n=>n.id===t.id)||todayOnlyHere.find(n=>n.id===t.id)) return false;
      const parent = tasks.find(p=>p.linkedNextDay===t.id);
      if (!parent||!prevKey) return false;
      return !!done[prevKey+"-"+parent.id];
    });
    const rollover = prevKey?tasks.filter(t=>{
      if (!t.active) return false;
      if (natural.find(n=>n.id===t.id)||linked.find(l=>l.id===t.id)||todayOnlyHere.find(n=>n.id===t.id)) return false;
      const prevSlotObj = dayWindow.find(s=>s.key===prevKey);
      if (!prevSlotObj) return false;
      if (!taskOccursOnDay(t,prevSlotObj.dayName,prevSlotObj.offset,prevSlotObj.fullDate)) return false;
      if (done[prevKey+"-"+t.id]) return false;
      return (offset-prevSlotObj.offset)<=maxRollover;
    }):[];
    const all = [...natural,...todayOnlyHere,...linked,...rollover.filter(r=>!natural.find(n=>n.id===r.id))];
    return all.sort((a,b)=>{ if(!a.timeBound&&b.timeBound)return 1; if(a.timeBound&&!b.timeBound)return -1; if(a.timeBound&&b.timeBound)return a.time.localeCompare(b.time); return 0; });
  },[tasks,done,dayWindow,maxRollover]);

  const selTasks = getTasksForSlot(selSlot);
  const todayTasks = getTasksForSlot(todaySlot);
  const doneCount = selTasks.filter(t=>done[selKey+"-"+t.id]).length;
  const total = selTasks.length;
  const pct = total>0?(doneCount/total)*100:0;

  // History tracking
  useEffect(()=>{
    if (todayTasks.length===0) return;
    const completed = todayTasks.filter(t=>done[todayKey+"-"+t.id]).length;
    setHistory(p=>({...p,[todayKey]:{total:todayTasks.length,completed}}));
  },[done,todayKey,todayTasks.length]);

  // Streak
  const streak = useMemo(()=>{
    let count=0; const today=new Date();
    for (let i=0;i<=365;i++) {
      const d=new Date(today); d.setDate(today.getDate()-i);
      const k=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
      const h=history[k];
      if (!h||h.total===0){if(i===0)continue;break;}
      if (h.completed===h.total) count++;
      else if (i>0) break;
    }
    return count;
  },[history]);

  // Fireworks on completion
  useEffect(()=>{
    if (selKey!==todayKey) return;
    const td=todayTasks.filter(t=>done[todayKey+"-"+t.id]).length;
    const tt=todayTasks.length;
    if (tt>0&&td===tt&&prevDoneRef.current<tt) setFireworks(true);
    prevDoneRef.current=td;
  },[done,todayTasks,selKey,todayKey]);

  function tick(id) { setDone(p=>({...p,[selKey+"-"+id]:!p[selKey+"-"+id]})); }
  function tickMed(id) { setMedsDone(p=>({...p,[todayKey+"-"+id]:!p[todayKey+"-"+id]})); }

  function saveTask(t) {
    setTasks(p=>{
      const updated = p.map(x=>x.id===t.id?t:x);
      if (t._parentId) return updated.map(x=>x.id===t._parentId?{...x,linkedNextDay:t.id}:x);
      return updated;
    });
    setEditing(null);
  }
  function addTask(t) {
    const newTask={...t,id:Date.now(),linkedNextDay:t.linkedNextDay||null};
    if (t.scheduleType==="todayonly") newTask._forDay=selKey;
    setTasks(p=>[...p,newTask]);
    setShowAdd(false);
  }
  function delTask(id) { setTasks(p=>p.filter(t=>t.id!==id)); setEditing(null); }
  function moveToToday(todo) {
    setTasks(p=>[...p,{id:Date.now(),label:todo.text,icon:"📝",category:"errands",color:"#CE93D8",active:true,scheduleType:"todayonly",_forDay:selKey,timeBound:false}]);
    setTodos(p=>p.map(t=>t.id===todo.id?{...t,movedToToday:true,done:true}:t));
  }

  function handleProfileDone(name, avatar) {
    setUserName(name); setUserAvatar(avatar); setProfileDone(true);
    saveUserData(deviceId,{userName:name,userAvatar:avatar,tasks:DEFAULT_TASKS,done:{},shopItems:DEFAULT_SHOPPING,todos:[],sleep:DEFAULT_SLEEP,meds:DEFAULT_MEDS,medsDone:{},maxRollover:2,history:{},householdId:null});
  }

  function handleHouseholdDone(hh) {
    setShowHHSetup(false);
    if (!hh) return;
    setHousehold(hh);
    setHouseholdId(hh.id);
    saveUserData(deviceId,{householdId:hh.id});
  }

  function leaveHousehold() {
    setHousehold(null);
    setHouseholdId(null);
    saveUserData(deviceId,{householdId:null});
  }

  const timeStr = clock.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
  const dateStr = clock.toLocaleDateString([],{weekday:"long",month:"long",day:"numeric"});
  const now = new Date();

  // ── Render guards ─────────────────────────────────────────────────────────
  if (!unlocked) return <PasswordScreen onUnlock={()=>setUnlocked(true)} />;
  if (loading) return <LoadingScreen />;
  if (!profileDone) return <ProfileSetup onDone={handleProfileDone} />;

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"#04040e",display:"flex",justifyContent:"center"}}>
      <div style={{width:"100%",maxWidth:430,minHeight:"100vh",background:"linear-gradient(165deg,#0D0D1C,#0A0A14)",position:"relative",display:"flex",flexDirection:"column"}}>

        {/* Status bar */}
        <div style={{padding:"14px 28px 0",display:"flex",justifyContent:"space-between",alignItems:"center",color:"#E0E0FF",fontSize:13,fontWeight:600,flexShrink:0}}>
          <span>{timeStr}</span>
          <span style={{fontSize:11,letterSpacing:2,color:"#555"}}>◼◼◼</span>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",padding:"12px 20px 0",gap:7,flexShrink:0}}>
          {[{id:"today",lbl:"Today"},{id:"schedule",lbl:"Schedule"},{id:"settings",lbl:"⚙️"}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{flex:t.id==="settings"?0:1,padding:"8px 16px",borderRadius:12,border:"none",cursor:"pointer",fontSize:t.id==="settings"?18:13,fontWeight:600,
                background:tab===t.id?"linear-gradient(135deg,rgba(79,195,247,.2),rgba(124,77,255,.2))":"transparent",
                color:tab===t.id?"#4FC3F7":"#555",
                border:tab===t.id?"1px solid rgba(79,195,247,.3)":"1px solid transparent"}}>
              {t.lbl}
            </button>
          ))}
        </div>

        {/* TODAY TAB */}
        {tab==="today" && (
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            {/* Header */}
            <div style={{padding:"14px 22px 10px",flexShrink:0}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <div style={{color:"#4FC3F7",fontSize:10,letterSpacing:3,textTransform:"uppercase",fontFamily:"monospace"}}>{userAvatar} {userName}</div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{color:"#F0F0FF",fontSize:20,fontWeight:"bold"}}>{dateStr.split(", ")[0]}</div>
                    {streak>=3 && <div style={{background:"rgba(255,183,77,.12)",border:"1px solid rgba(255,183,77,.3)",borderRadius:8,padding:"2px 8px",color:"#FFB74D",fontSize:11}}>🔥{streak}</div>}
                  </div>
                  <div style={{color:"#555",fontSize:11,marginTop:1}}>{dateStr.split(", ").slice(1).join(", ")}</div>
                </div>
                <button onClick={()=>setShowAdd(true)} style={{background:"linear-gradient(135deg,#4FC3F7,#7C4DFF)",border:"none",borderRadius:14,width:40,height:40,fontSize:22,color:"#fff",cursor:"pointer"}}>+</button>
              </div>
              <div style={{marginTop:10}}>
                <div style={{display:"flex",justifyContent:"space-between",color:"#555",fontSize:11,marginBottom:5}}>
                  <span>{doneCount}/{total} complete</span>
                  <span style={{color:"#4FC3F7"}}>{Math.round(pct)}%</span>
                </div>
                <div style={{height:4,background:"#1A1A2E",borderRadius:99}}>
                  <div style={{height:"100%",borderRadius:99,width:pct+"%",background:"linear-gradient(90deg,#4FC3F7,#7C4DFF)",transition:"width .4s"}} />
                </div>
              </div>
            </div>

            {/* Day strip */}
            <div style={{padding:"0 14px 8px",display:"flex",gap:5,overflowX:"auto",flexShrink:0}}>
              {dayWindow.map(slot=>{
                const slotTasks=getTasksForSlot(slot);
                const allDone=slotTasks.length>0&&slotTasks.every(t=>done[slot.key+"-"+t.id]);
                const rem=slotTasks.filter(t=>!done[slot.key+"-"+t.id]).length;
                const isSel=slot.key===selKey,isToday=slot.offset===0;
                return (
                  <button key={slot.key} onClick={()=>setSelKey(slot.key)}
                    style={{flex:"0 0 auto",minWidth:46,padding:"6px 8px",borderRadius:12,border:`1px solid ${isSel?"rgba(79,195,247,.5)":isToday?"rgba(79,195,247,.2)":"#1A1A2E"}`,background:isSel?"linear-gradient(135deg,#4FC3F7,#7C4DFF)":"transparent",cursor:"pointer",textAlign:"center"}}>
                    <span style={{fontSize:8,color:isSel?"rgba(255,255,255,.7)":isToday?"#4FC3F7":"#444",display:"block",fontFamily:"monospace"}}>{slot.dayName}</span>
                    <span style={{fontSize:17,fontWeight:"bold",lineHeight:1,color:isSel?"#fff":isToday?"#E0E0FF":"#555",display:"block"}}>{slot.date}</span>
                    {allDone?<span style={{fontSize:9,color:isSel?"rgba(255,255,255,.8)":"#4FC3F7"}}>✓</span>:rem>0?<span style={{fontSize:9,color:isSel?"rgba(255,255,255,.6)":"#444"}}>{rem}</span>:<span style={{fontSize:9,color:"#1A1A2E"}}>·</span>}
                  </button>
                );
              })}
            </div>

            {/* Medicine reminder */}
            {meds.enabled && selSlot.offset===0 && (()=>{
              const todayDoses=meds.doses.filter(d=>d.days.includes(todayName));
              if (!todayDoses.length) return null;
              return (
                <div style={{margin:"0 18px 8px",background:"rgba(239,83,80,.1)",border:"1px solid rgba(239,83,80,.2)",borderRadius:14}}>
                  <div style={{padding:"9px 14px 4px",display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:16}}>💊</span>
                    <span style={{color:"#EF9A9A",fontSize:12,fontFamily:"monospace",letterSpacing:2}}>MEDICINE</span>
                  </div>
                  {todayDoses.map(dose=>{
                    const key=todayKey+"-"+dose.id;
                    const taken=!!medsDone[key];
                    const [dh,dm]=dose.time.split(":").map(Number);
                    const isMissed=now.getHours()*60+now.getMinutes()>dh*60+dm&&!taken;
                    return (
                      <div key={dose.id} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 14px 10px"}}>
                        <div onClick={()=>tickMed(dose.id)} style={{width:26,height:26,borderRadius:8,border:`2px solid ${taken?"transparent":"rgba(239,83,80,.4)"}`,background:taken?"linear-gradient(135deg,#4FC3F7,#7C4DFF)":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:14,flexShrink:0}}>{taken?"✓":""}</div>
                        <div style={{flex:1}}>
                          <div style={{color:taken?"#555":"#E0E0F0",fontSize:13}}>{dose.label}</div>
                          <div style={{display:"flex",alignItems:"center",gap:7,marginTop:2}}>
                            <span style={{color:isMissed?"#EF9A9A":taken?"#555":"#80DEEA",fontSize:11,fontFamily:"monospace"}}>{dose.time}</span>
                            {isMissed&&<span style={{background:"rgba(239,83,80,.15)",color:"#EF9A9A",fontSize:10,borderRadius:6,padding:"1px 6px"}}>MISSED</span>}
                            {taken&&<span style={{background:"rgba(128,222,234,.12)",color:"#80DEEA",fontSize:10,borderRadius:6,padding:"1px 6px"}}>TAKEN</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Shopping & Todos buttons */}
            <div onClick={()=>setShopOpen(true)} style={{margin:"0 18px 6px",padding:"10px 14px",background:"rgba(165,214,167,.08)",border:"1px solid rgba(165,214,167,.15)",borderRadius:12,display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
              <span style={{fontSize:16}}>🛒</span>
              <span style={{color:"#A5D6A7",fontSize:12,fontFamily:"monospace",letterSpacing:2,flex:1}}>SHOPPING LIST</span>
              {shopItems.filter(i=>!i.checked).length>0&&<span style={{background:"rgba(165,214,167,.2)",color:"#A5D6A7",borderRadius:8,padding:"2px 8px",fontSize:11}}>{shopItems.filter(i=>!i.checked).length}</span>}
              <span style={{color:"#A5D6A7",fontSize:16}}>›</span>
            </div>
            <div onClick={()=>setTodoOpen(true)} style={{margin:"0 18px 8px",padding:"10px 14px",background:"rgba(79,195,247,.08)",border:"1px solid rgba(79,195,247,.15)",borderRadius:12,display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
              <span style={{fontSize:16}}>📝</span>
              <span style={{color:"#4FC3F7",fontSize:12,fontFamily:"monospace",letterSpacing:2,flex:1}}>TO-DO LIST</span>
              {todos.filter(t=>!t.done).length>0&&<span style={{background:"rgba(79,195,247,.2)",color:"#4FC3F7",borderRadius:8,padding:"2px 8px",fontSize:11}}>{todos.filter(t=>!t.done).length}</span>}
              <span style={{color:"#4FC3F7",fontSize:16}}>›</span>
            </div>

            {/* Sleep banner */}
            {sleep.enabled&&selSlot.offset===0&&(()=>{
              const bt=sleep.times[todayName]; if(!bt) return null;
              const [bh,bm]=bt.split(":").map(Number);
              const minsLeft=(bh*60+bm)-(now.getHours()*60+now.getMinutes());
              const near=minsLeft>=0&&minsLeft<=120;
              if (!near) return null;
              return (
                <div style={{margin:"0 18px 8px",padding:"9px 14px",background:"rgba(124,77,255,.1)",border:"1px solid rgba(124,77,255,.2)",borderRadius:12,display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:16}}>🌙</span>
                  <span style={{color:"#CE93D8",fontSize:12}}>Bedtime in {Math.round(minsLeft)} min — tonight at <b>{bt}</b></span>
                </div>
              );
            })()}

            {/* Task list */}
            <div style={{flex:1,overflowY:"auto",padding:"0 18px 20px"}}>
              {selTasks.length===0?(
                <div style={{textAlign:"center",padding:"50px 0",color:"#333"}}>
                  <div style={{fontSize:32,marginBottom:8}}>✨</div>
                  <div>Nothing scheduled</div>
                </div>
              ):selTasks.map(task=>{
                const key=selKey+"-"+task.id;
                const isDone=!!done[key];
                return (
                  <div key={task.id+selKey} onClick={()=>tick(task.id)}
                    style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:isDone?"rgba(255,255,255,.02)":"rgba(255,255,255,.05)",borderRadius:16,marginBottom:8,border:`1px solid ${isDone?"#1A1A2E":task.color+"33"}`,cursor:"pointer",transition:"all .2s"}}>
                    <div style={{width:42,height:42,borderRadius:13,background:isDone?"#1A1A2E":task.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{task.icon}</div>
                    <div style={{flex:1}}>
                      <div style={{color:isDone?"#555":"#E8E8FF",fontSize:14,fontWeight:600,textDecoration:isDone?"line-through":"none"}}>{task.label}</div>
                      <div style={{display:"flex",gap:7,marginTop:3,alignItems:"center"}}>
                        {task.timeBound&&<span style={{color:isDone?"#444":task.color,fontSize:11,fontFamily:"monospace"}}>{task.time}</span>}
                        <span style={{background:CAT_COLOR[task.category]+"18",color:isDone?"#444":CAT_COLOR[task.category],borderRadius:6,padding:"1px 7px",fontSize:10}}>{CATEGORY_META[task.category]?.label}</span>
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
                      <div style={{width:26,height:26,borderRadius:8,background:isDone?"linear-gradient(135deg,#4FC3F7,#7C4DFF)":"#1A1A2E",border:`1px solid ${isDone?"transparent":"#2A2A44"}`,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:14}}>{isDone?"✓":""}</div>
                      <button onClick={e=>{e.stopPropagation();setEditing(task);}} style={{background:"none",border:"none",color:"#333",fontSize:14,cursor:"pointer",padding:0}}>✎</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* SCHEDULE TAB */}
        {tab==="schedule" && (
          <div style={{flex:1,overflowY:"auto",padding:"14px 18px 20px"}}>
            <div style={{color:"#4FC3F7",fontSize:10,letterSpacing:3,fontFamily:"monospace",marginBottom:14}}>WEEKLY OVERVIEW</div>
            {DAYS.map((day,idx)=>{
              const dts=tasks.filter(t=>t.active&&taskOccursOnDay(t,day,idx,null));
              return (
                <div key={day} style={{marginBottom:14}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                    <span style={{color:"#4FC3F7",fontSize:10,fontFamily:"monospace",width:30}}>{day}</span>
                    <div style={{flex:1,height:1,background:"#1A1A2E"}} />
                    <span style={{color:"#444",fontSize:10}}>{dts.length}</span>
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                    {dts.length===0?<span style={{color:"#2A2A3A",fontSize:11}}>—</span>:dts.map(t=>(
                      <div key={t.id} onClick={()=>setEditing(t)} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px",background:t.color+"18",border:`1px solid ${t.color}33`,borderRadius:10,cursor:"pointer"}}>
                        <span style={{fontSize:14}}>{t.icon}</span>
                        <span style={{color:"#ccc",fontSize:12}}>{t.label}</span>
                        {t.timeBound&&<span style={{color:t.color,fontSize:10,fontFamily:"monospace"}}>{t.time}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* SETTINGS TAB */}
        {tab==="settings" && (
          <div style={{flex:1,overflowY:"auto",padding:"14px 18px 28px"}}>
            <div style={{color:"#4FC3F7",fontSize:10,letterSpacing:3,fontFamily:"monospace",marginBottom:14}}>SETTINGS</div>

            {/* Profile */}
            <div style={{background:"#0F0F1E",borderRadius:18,padding:16,marginBottom:14,border:"1px solid #1A1A2E"}}>
              <div style={{color:"#777",fontSize:10,letterSpacing:2,fontFamily:"monospace",marginBottom:10}}>PROFILE</div>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <span style={{fontSize:32}}>{userAvatar}</span>
                <div style={{flex:1}}>
                  <div style={{color:"#E0E0FF",fontSize:16,fontWeight:"bold"}}>{userName}</div>
                  <div style={{color:"#555",fontSize:11}}>Your account</div>
                </div>
              </div>
            </div>

            {/* Household */}
            <div style={{background:"#0F0F1E",borderRadius:18,padding:16,marginBottom:14,border:"1px solid #1A1A2E"}}>
              <div style={{color:"#777",fontSize:10,letterSpacing:2,fontFamily:"monospace",marginBottom:10}}>HOUSEHOLD SYNC</div>
              {household?(
                <div>
                  <div style={{background:"#1A1A2E",borderRadius:12,padding:"10px 14px",marginBottom:12}}>
                    <div style={{color:"#555",fontSize:10,letterSpacing:2,fontFamily:"monospace",marginBottom:4}}>YOUR CODE</div>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{flex:1,color:"#4FC3F7",fontSize:20,fontWeight:"bold",letterSpacing:4,fontFamily:"monospace"}}>{household.id}</div>
                      <button onClick={()=>{try{navigator.clipboard.writeText(household.id);}catch(e){}}} style={{background:"rgba(79,195,247,.15)",border:"1px solid rgba(79,195,247,.3)",color:"#4FC3F7",borderRadius:8,padding:"6px 12px",fontSize:11,cursor:"pointer"}}>Copy</button>
                    </div>
                  </div>
                  <div style={{color:"#666",fontSize:10,letterSpacing:2,fontFamily:"monospace",marginBottom:8}}>MEMBERS</div>
                  {household.members.map(m=>(
                    <div key={m.uid} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0"}}>
                      <span style={{fontSize:22}}>{m.avatar}</span>
                      <span style={{flex:1,color:m.uid===deviceId?"#4FC3F7":"#ccc",fontSize:14}}>{m.name}{m.uid===deviceId?" (you)":""}</span>
                    </div>
                  ))}
                  <button onClick={leaveHousehold} style={{marginTop:12,width:"100%",padding:10,background:"rgba(239,83,80,.1)",border:"1px solid rgba(239,83,80,.2)",borderRadius:12,color:"#EF9A9A",fontSize:13,cursor:"pointer"}}>Leave Household</button>
                </div>
              ):(
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:20}}>🏠</span>
                    <div>
                      <div style={{color:"#ddd",fontSize:13}}>Family sync</div>
                      <div style={{color:"#555",fontSize:11}}>Not connected</div>
                    </div>
                  </div>
                  <button onClick={()=>setShowHHSetup(true)} style={{background:"linear-gradient(135deg,rgba(79,195,247,.15),rgba(124,77,255,.15))",border:"1px solid rgba(79,195,247,.3)",color:"#4FC3F7",borderRadius:10,padding:"8px 14px",fontSize:12,cursor:"pointer"}}>Set up</button>
                </div>
              )}
            </div>

            {/* Sleep */}
            <div style={{background:"#0F0F1E",borderRadius:18,padding:16,marginBottom:14,border:"1px solid #1A1A2E"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:showSleep&&sleep.enabled?14:0}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:20}}>🌙</span>
                  <div>
                    <div style={{color:"#ddd",fontSize:13}}>Sleep reminders</div>
                    <div style={{color:"#555",fontSize:11}}>{sleep.enabled?"Enabled":"Off"}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  {sleep.enabled&&<button onClick={()=>setShowSleep(p=>!p)} style={{background:"rgba(255,255,255,.06)",border:"1px solid #2A2A44",color:"#888",borderRadius:8,padding:"4px 10px",fontSize:11,cursor:"pointer"}}>{showSleep?"Hide":"Edit"}</button>}
                  <Toggle on={sleep.enabled} onChange={()=>setSleep(p=>({...p,enabled:!p.enabled}))} />
                </div>
              </div>
              {showSleep&&sleep.enabled&&(
                <div style={{borderTop:"1px solid #1A1A2E",paddingTop:14}}>
                  {DAYS.map(day=>(
                    <div key={day} style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
                      <span style={{color:"#888",fontSize:12,fontFamily:"monospace",width:30}}>{day}</span>
                      <input type="time" value={sleep.times[day]} onChange={e=>setSleep(p=>({...p,times:{...p.times,[day]:e.target.value}}))}
                        style={{flex:1,padding:"6px 10px",borderRadius:10,border:"1px solid #2A2A44",background:"#0F0F1E",color:"#E0E0FF",fontSize:13,outline:"none"}} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Medicine */}
            <div style={{background:"#0F0F1E",borderRadius:18,padding:16,marginBottom:14,border:"1px solid #1A1A2E"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:showMeds&&meds.enabled?14:0}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:20}}>💊</span>
                  <div>
                    <div style={{color:"#ddd",fontSize:13}}>Medicine reminders</div>
                    <div style={{color:"#555",fontSize:11}}>{meds.enabled?`${meds.doses.length} dose(s)`:"Off"}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  {meds.enabled&&<button onClick={()=>setShowMeds(p=>!p)} style={{background:"rgba(255,255,255,.06)",border:"1px solid #2A2A44",color:"#888",borderRadius:8,padding:"4px 10px",fontSize:11,cursor:"pointer"}}>{showMeds?"Hide":"Edit"}</button>}
                  <Toggle on={meds.enabled} onChange={()=>setMeds(p=>({...p,enabled:!p.enabled}))} />
                </div>
              </div>
              {showMeds&&meds.enabled&&(
                <div style={{borderTop:"1px solid #1A1A2E",paddingTop:14}}>
                  {meds.doses.map((dose,di)=>(
                    <div key={dose.id} style={{background:"rgba(128,222,234,.05)",border:"1px solid rgba(128,222,234,.1)",borderRadius:12,padding:12,marginBottom:10}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                        <input value={dose.label} onChange={e=>{const v=e.target.value;setMeds(p=>{const d=[...p.doses];d[di]={...d[di],label:v};return {...p,doses:d};})}} placeholder="Name (e.g. Morning)" style={{flex:1,padding:"8px 10px",borderRadius:10,border:"1px solid #2A2A44",background:"#0F0F1E",color:"#E0E0FF",fontSize:13,outline:"none"}} />
                        <input type="time" value={dose.time} onChange={e=>{const v=e.target.value;setMeds(p=>{const d=[...p.doses];d[di]={...d[di],time:v};return {...p,doses:d};})}} style={{padding:"8px 10px",borderRadius:10,border:"1px solid #2A2A44",background:"#0F0F1E",color:"#E0E0FF",fontSize:13,outline:"none"}} />
                        <button onClick={()=>setMeds(p=>({...p,doses:p.doses.filter((_,i)=>i!==di)}))} style={{background:"none",border:"none",color:"#EF9A9A",fontSize:18,cursor:"pointer"}}>×</button>
                      </div>
                      <DayPills selected={dose.days} onChange={v=>{setMeds(p=>{const d=[...p.doses];d[di]={...d[di],days:v};return {...p,doses:d};})}} />
                    </div>
                  ))}
                  <button onClick={()=>setMeds(p=>({...p,doses:[...p.doses,{id:"m"+Date.now(),label:"New dose",time:"09:00",days:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]}]}))} style={{width:"100%",padding:10,background:"rgba(128,222,234,.08)",border:"1px dashed rgba(128,222,234,.3)",borderRadius:12,color:"#80DEEA",fontSize:13,cursor:"pointer"}}>+ Add dose</button>
                </div>
              )}
            </div>

            {/* Smart Rollover */}
            <div style={{background:"#0F0F1E",borderRadius:18,padding:16,marginBottom:14,border:"1px solid #1A1A2E"}}>
              <div style={{color:"#777",fontSize:10,letterSpacing:2,fontFamily:"monospace",marginBottom:8}}>SMART ROLLOVER</div>
              <div style={{color:"#ddd",fontSize:13,marginBottom:10}}>Max days a missed task carries over</div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <button onClick={()=>setMaxRollover(p=>Math.max(1,p-1))} style={{width:36,height:36,borderRadius:10,border:"1px solid #2A2A44",background:"#1A1A2E",color:"#fff",fontSize:18,cursor:"pointer"}}>−</button>
                <div style={{flex:1,textAlign:"center"}}><span style={{color:"#4FC3F7",fontSize:24,fontFamily:"monospace"}}>{maxRollover}</span><span style={{color:"#555",fontSize:11}}> days</span></div>
                <button onClick={()=>setMaxRollover(p=>Math.min(7,p+1))} style={{width:36,height:36,borderRadius:10,border:"1px solid #2A2A44",background:"#1A1A2E",color:"#fff",fontSize:18,cursor:"pointer"}}>+</button>
              </div>
            </div>

            {/* Stats */}
            <div style={{background:"#0F0F1E",borderRadius:18,padding:16,marginBottom:14,border:"1px solid #1A1A2E"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:20}}>📊</span>
                  <div style={{color:"#ddd",fontSize:13}}>Statistics</div>
                </div>
                <button onClick={()=>setShowStats(p=>!p)} style={{background:"rgba(255,255,255,.06)",border:"1px solid #2A2A44",color:"#888",borderRadius:8,padding:"4px 10px",fontSize:11,cursor:"pointer"}}>{showStats?"Hide":"Show"}</button>
              </div>
              {showStats&&(
                <div style={{marginTop:14,borderTop:"1px solid #1A1A2E",paddingTop:14}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    {[{label:"Current Streak",value:streak+"d",icon:"🔥",color:"#FFB74D"},{label:"Tasks Today",value:`${doneCount}/${total}`,icon:"✅",color:"#A5D6A7"},{label:"History Days",value:Object.values(history).filter(h=>h.total>0).length,icon:"📅",color:"#4FC3F7"},{label:"Completion",value:(Object.values(history).filter(h=>h.total>0).length>0?Math.round(Object.values(history).filter(h=>h.total>0).reduce((a,h)=>a+h.completed/h.total,0)/Object.values(history).filter(h=>h.total>0).length*100):0)+"%",icon:"🎯",color:"#CE93D8"}].map(c=>(
                      <div key={c.label} style={{background:"rgba(255,255,255,.03)",borderRadius:12,padding:12}}>
                        <div style={{fontSize:20,marginBottom:4}}>{c.icon}</div>
                        <div style={{color:c.color,fontSize:20,fontWeight:"bold",fontFamily:"monospace"}}>{c.value}</div>
                        <div style={{color:"#555",fontSize:10,marginTop:2}}>{c.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Activity categories */}
            {Object.keys(CATEGORY_META).map(cat=>{
              const meta=CATEGORY_META[cat];
              const cts=tasks.filter(t=>t.category===cat&&t.scheduleType!=="todayonly");
              if (!cts.length) return null;
              return (
                <div key={cat} style={{background:"#0F0F1E",borderRadius:18,padding:16,marginBottom:14,border:"1px solid #1A1A2E"}}>
                  <div style={{color:meta.color,fontSize:10,letterSpacing:2,fontFamily:"monospace",marginBottom:10}}>{meta.label.toUpperCase()}</div>
                  {cts.map((task,i)=>(
                    <div key={task.id}>
                      {i>0&&<div style={{height:1,background:"#1A1A2E",margin:"10px 0"}} />}
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <span style={{fontSize:19,width:26,textAlign:"center"}}>{task.icon}</span>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{color:task.active?"#E0E0F0":"#555",fontSize:13}}>{task.label}</div>
                          <div style={{color:"#444",fontSize:10,fontFamily:"monospace",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{INTERVAL_LABELS[task.scheduleType]}</div>
                        </div>
                        <button onClick={()=>setEditing(task)} style={{display:"flex",alignItems:"center",justifyContent:"center",width:28,height:28,borderRadius:8,background:"rgba(255,255,255,.05)",border:"1px solid #2A2A44",color:"#555",fontSize:13,cursor:"pointer"}}>✎</button>
                        <Toggle on={task.active} onChange={()=>saveTask({...task,active:!task.active})} />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}

            <button onClick={()=>setShowAdd(true)} style={{width:"100%",padding:14,background:"rgba(79,195,247,.08)",border:"1px dashed rgba(79,195,247,.3)",borderRadius:14,color:"#4FC3F7",fontSize:14,cursor:"pointer",marginBottom:8}}>+ Add new activity</button>
          </div>
        )}

        {/* Bottom nav */}
        <div style={{background:"rgba(8,8,18,.97)",backdropFilter:"blur(20px)",padding:"10px 0 28px",display:"flex",justifyContent:"space-around",flexShrink:0,borderTop:"1px solid #1A1A2E"}}>
          {[{id:"today",icon:"📋",lbl:"TODAY"},{id:"schedule",icon:"📅",lbl:"WEEK"},{id:"settings",icon:"⚙️",lbl:"SETTINGS"}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,flex:1}}>
              <span style={{fontSize:20}}>{t.icon}</span>
              <span style={{fontSize:9,letterSpacing:1,fontFamily:"monospace",color:tab===t.id?"#4FC3F7":"#555"}}>{t.lbl}</span>
            </button>
          ))}
        </div>

        {/* Overlays */}
        {fireworks && <Fireworks onDone={()=>setFireworks(false)} />}

        {showAdd && (
          <TaskDrawer task={null} tasks={tasks} onSave={addTask} onDelete={null} onClose={()=>setShowAdd(false)} />
        )}
        {editing && (
          <TaskDrawer task={editing} tasks={tasks} onSave={saveTask} onDelete={()=>delTask(editing.id)} onClose={()=>setEditing(null)} />
        )}
        {showHHSetup && (
          <HouseholdSetup deviceId={deviceId} userName={userName} userAvatar={userAvatar} onDone={handleHouseholdDone} />
        )}

        {/* Shopping drawer */}
        {shopOpen && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",backdropFilter:"blur(8px)",zIndex:100,display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
            <div onClick={e=>e.stopPropagation()} style={{background:"linear-gradient(180deg,#141428,#0D0D1C)",borderRadius:"24px 24px 0 0",padding:"0 20px 40px",maxHeight:"85vh",overflowY:"auto"}}>
              <div style={{width:40,height:4,background:"#333",borderRadius:99,margin:"16px auto 20px"}} />
              {household&&<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:12,color:"#A5D6A7",fontSize:11,fontFamily:"monospace"}}>🏠 Synced with household</div>}
              <ShoppingPanel items={shopItems} setItems={household?setShopAndSync:setShopItems} />
              <button onClick={()=>setShopOpen(false)} style={{width:"100%",marginTop:16,padding:13,background:"#1A1A2E",border:"1px solid #2A2A44",borderRadius:14,color:"#888",fontSize:14,cursor:"pointer"}}>Close</button>
            </div>
          </div>
        )}

        {/* Todo drawer */}
        {todoOpen && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",backdropFilter:"blur(8px)",zIndex:100,display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
            <div onClick={e=>e.stopPropagation()} style={{background:"linear-gradient(180deg,#141428,#0D0D1C)",borderRadius:"24px 24px 0 0",padding:"0 20px 40px",maxHeight:"85vh",overflowY:"auto"}}>
              <div style={{width:40,height:4,background:"#333",borderRadius:99,margin:"16px auto 20px"}} />
              {household&&<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:12,color:"#4FC3F7",fontSize:11,fontFamily:"monospace"}}>🏠 Synced with household</div>}
              <TodoPanel todos={todos} setTodos={household?setTodosAndSync:setTodos} onMoveToToday={moveToToday} />
              <button onClick={()=>setTodoOpen(false)} style={{width:"100%",marginTop:16,padding:13,background:"#1A1A2E",border:"1px solid #2A2A44",borderRadius:14,color:"#888",fontSize:14,cursor:"pointer"}}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
