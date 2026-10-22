"use strict";(()=>{var j=Object.defineProperty;var _=(i,e,t)=>e in i?j(i,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):i[e]=t;var s=(i,e,t)=>_(i,typeof e!="symbol"?e+"":e,t);var V="audio-feedback";function U(i){return new Promise((e,t)=>{i.onsuccess=()=>e(i.result),i.onerror=()=>t(i.error)})}function M(i){return new Promise((e,t)=>{i.oncomplete=()=>e(),i.onerror=()=>t(i.error),i.onabort=()=>t(i.error)})}var h=class{constructor(){s(this,"db");this.db=new Promise(e=>{if(typeof indexedDB>"u")return e(null);let t=indexedDB.open(V,1);t.onupgradeneeded=()=>{let n=t.result;n.createObjectStore("sessions",{keyPath:"meta.id"}),n.createObjectStore("chunks",{keyPath:["sessionId","seq"]}).createIndex("bySession","sessionId")},t.onsuccess=()=>e(t.result),t.onerror=()=>e(null),t.onblocked=()=>e(null)})}async putSession(e){let t=await this.db;if(!t)return;let n=t.transaction("sessions","readwrite");n.objectStore("sessions").put(e),await M(n)}async putChunk(e,t,n){let r=await this.db;if(!r)return;let o=r.transaction("chunks","readwrite");o.objectStore("chunks").put({sessionId:e,seq:t,data:n}),await M(o)}async sessions(){let e=await this.db;if(!e)return[];let t=e.transaction("sessions","readonly");return U(t.objectStore("sessions").getAll())}async audio(e,t){let n=await this.db;if(!n)return new Blob([],{type:t});let r=n.transaction("chunks","readonly"),o=IDBKeyRange.bound([e,0],[e,Number.MAX_SAFE_INTEGER]),a=await U(r.objectStore("chunks").getAll(o));return a.sort((d,b)=>d.seq-b.seq),new Blob(a.map(d=>d.data),{type:t})}async remove(e){let t=await this.db;if(!t)return;let n=t.transaction(["sessions","chunks"],"readwrite");n.objectStore("sessions").delete(e),n.objectStore("chunks").delete(IDBKeyRange.bound([e,0],[e,Number.MAX_SAFE_INTEGER])),await M(n)}async clear(){let e=await this.db;if(!e)return;let t=e.transaction(["sessions","chunks"],"readwrite");t.objectStore("sessions").clear(),t.objectStore("chunks").clear(),await M(t)}};function N(i,e){let t=i;try{let n=new URL(i);if(e.stripQuery){let r=new URLSearchParams;for(let[o,a]of n.searchParams)e.keepParams.includes(o)&&r.append(o,a);n.search=r.toString()}e.stripHash&&(n.hash=""),t=n.toString()}catch{return""}return t.length>2048?t.slice(0,2048)+"\u2026":t}var E=class{constructor(e,t,n){s(this,"last","");s(this,"timer",0);s(this,"check",()=>this.sample());s(this,"opts");s(this,"now");s(this,"onEntry");this.opts=e,this.now=t,this.onEntry=n}currentUrl(){return N(location.href,this.opts)}start(){this.last=this.currentUrl(),window.addEventListener("popstate",this.check),window.addEventListener("hashchange",this.check),this.timer=window.setInterval(this.check,1e3)}stop(){window.removeEventListener("popstate",this.check),window.removeEventListener("hashchange",this.check),window.clearInterval(this.timer)}sample(){let e=this.currentUrl();e!==this.last&&(this.last=e,this.onEntry({at:this.now(),type:"navigate",url:e,title:document.title}))}};var H=["audio/webm;codecs=opus","audio/ogg;codecs=opus","audio/mp4;codecs=mp4a.40.2","audio/mp4","audio/webm"];var c=class extends Error{constructor(t,n){super(n);s(this,"code");this.code=t}};function F(){return typeof MediaRecorder>"u"?"":H.find(i=>MediaRecorder.isTypeSupported(i))??""}var P=class{constructor(){s(this,"onChunk",()=>{});s(this,"onInterrupted",()=>{});s(this,"stream",null);s(this,"media",null);s(this,"audioContext",null);s(this,"analyser",null);s(this,"levelBuffer",null);s(this,"accumulatedMs",0);s(this,"segmentStart",0);s(this,"stopped",null);s(this,"mimeType","")}get state(){return this.media?.state??"inactive"}elapsedMs(){let e=this.state==="recording"?performance.now()-this.segmentStart:0;return Math.round(this.accumulatedMs+e)}async start(){if(!window.isSecureContext)throw new c("insecure","Opnemen kan alleen via https.");if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder>"u")throw new c("unsupported","Deze browser kan geen audio opnemen.");try{this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:!0,noiseSuppression:!0,autoGainControl:!0}})}catch(r){let o=r?.name;throw o==="NotAllowedError"||o==="SecurityError"?new c("denied","Geen toegang tot de microfoon. Sta die toe in de adresbalk en probeer het opnieuw."):o==="NotFoundError"||o==="OverconstrainedError"?new c("no-device","Er is geen microfoon gevonden."):new c("failed","De microfoon kon niet worden gestart.")}let e=F(),t={audioBitsPerSecond:32e3};e&&(t.mimeType=e);let n=new MediaRecorder(this.stream,t);this.media=n,this.mimeType=n.mimeType||e||"audio/webm",this.stopped=new Promise(r=>n.addEventListener("stop",()=>r(),{once:!0})),n.addEventListener("dataavailable",r=>{r.data.size>0&&this.onChunk(r.data)});for(let r of this.stream.getAudioTracks())r.addEventListener("ended",()=>this.onInterrupted(),{once:!0});n.addEventListener("error",()=>this.onInterrupted(),{once:!0}),n.start(1e3),this.accumulatedMs=0,this.segmentStart=performance.now(),this.startLevelMeter(this.stream)}pause(){this.state==="recording"&&(this.media.pause(),this.accumulatedMs+=performance.now()-this.segmentStart,this.stream?.getAudioTracks().forEach(e=>e.enabled=!1))}resume(){this.state==="paused"&&(this.stream?.getAudioTracks().forEach(e=>e.enabled=!0),this.media.resume(),this.segmentStart=performance.now())}async stop(){this.media&&(this.state==="recording"&&(this.accumulatedMs+=performance.now()-this.segmentStart),this.state!=="inactive"&&this.media.stop(),await this.stopped,this.release())}level(){if(!this.analyser||!this.levelBuffer||this.state!=="recording")return 0;this.analyser.getByteTimeDomainData(this.levelBuffer);let e=0;for(let t of this.levelBuffer)e=Math.max(e,Math.abs(t-128));return Math.min(1,e/64)}release(){this.stream?.getTracks().forEach(e=>e.stop()),this.stream=null,this.audioContext?.close().catch(()=>{}),this.audioContext=null,this.analyser=null}startLevelMeter(e){try{this.audioContext=new AudioContext,this.audioContext.resume().catch(()=>{});let t=this.audioContext.createMediaStreamSource(e);this.analyser=this.audioContext.createAnalyser(),this.analyser.fftSize=512,this.levelBuffer=new Uint8Array(this.analyser.fftSize),t.connect(this.analyser)}catch{this.analyser=null}}};var m="AF Montserrat",D=`
:host {
  all: initial;
  --af-yellow: #f8e800;
  --af-darkblue: #242f36;
  --af-bg: #ffffff;
  --af-head: var(--af-darkblue);
  --af-head-fg: #ffffff;
  --af-fg: #3c3c3c;
  --af-muted: #77818b;
  --af-soft: #f6f8fa;
  --af-line: #eaedf0;
  --af-secondary: var(--af-darkblue);
  --af-secondary-fg: #ffffff;
  --af-record: #d0021b;
  --af-ok: #3f8a10;
  --af-focus: var(--af-darkblue);
}
@media (prefers-color-scheme: dark) {
  :host {
    --af-bg: #242f36;
    --af-head: #1a2227;
    --af-fg: #ffffff;
    --af-muted: #b3bcc4;
    --af-soft: #2e3b43;
    --af-line: #3a4852;
    --af-secondary: #3a4852;
    --af-record: #ff5a5f;
    --af-ok: #7ed321;
    --af-focus: var(--af-yellow);
  }
}
@media print {
  :host { display: none !important; }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }

.card, .pill {
  font: 500 14px/1.5 "${m}", Montserrat, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--af-fg);
  text-align: left;
  letter-spacing: normal;
}
.card {
  width: 300px;
  max-width: calc(100vw - 16px);
  background: var(--af-bg);
  border-radius: 16px;
  box-shadow: 1px 10px 40px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px 10px 16px;
  background: var(--af-head);
  color: var(--af-head-fg);
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.head:active { cursor: grabbing; }
.head::before {
  content: "";
  width: 4px;
  height: 18px;
  border-radius: 2px;
  background: var(--af-yellow);
  flex: none;
}
.title { flex: 1; font-weight: 600; font-size: 14px; }
.body { padding: 16px; display: grid; gap: 12px; }
.text { margin: 0; color: var(--af-muted); font-size: 13px; font-weight: 400; }
.text strong { color: var(--af-fg); font-weight: 600; }
.text a { color: var(--af-fg); text-decoration: underline; text-underline-offset: 2px; }
.text a:focus-visible { outline: 2px solid var(--af-focus); outline-offset: 2px; border-radius: 2px; }
.code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: 0.02em; }
.status { display: flex; align-items: baseline; gap: 8px; font-variant-numeric: tabular-nums; }
.time { font-size: 24px; font-weight: 600; line-height: 1; }
.limit { color: var(--af-muted); font-size: 12px; }
.time.warn { color: var(--af-record); }

.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--af-record); flex: none; align-self: center; }
.dot.live { animation: af-pulse 1.2s ease-in-out infinite; }
.dot.paused { background: var(--af-muted); }
@keyframes af-pulse { 50% { opacity: 0.3; } }

.meter { height: 6px; border-radius: 3px; background: var(--af-line); overflow: hidden; }
.meter > i { display: block; height: 100%; width: 0; border-radius: 3px; background: var(--af-yellow); transition: width 80ms linear; }

.row { display: flex; gap: 8px; flex-wrap: wrap; }
.row > button { flex: 1; }

/* Knop: de hoverkleur ligt als tweede helft van een verloop klaar en schuift van onderen in beeld. */
button {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 8px 18px;
  border-radius: 999px;
  --b: var(--af-secondary);
  --b-fg: var(--af-secondary-fg);
  --h: var(--af-yellow);
  --h-fg: var(--af-darkblue);
  background: linear-gradient(to top, var(--h) 50%, var(--b) 50%) top / 100% 200% no-repeat;
  color: var(--b-fg);
  font: 500 14px/1 "${m}", Montserrat, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  cursor: pointer;
  white-space: nowrap;
  transition: background-position 0.25s ease-in-out, color 0.2s ease-in;
}
button:hover { background-position: bottom; color: var(--h-fg); }
button:focus-visible { outline: 2px solid var(--af-focus); outline-offset: 2px; }
button:disabled { opacity: 0.55; cursor: default; }
button.primary, button.record { --b: var(--af-yellow); --b-fg: var(--af-darkblue); --h: var(--af-darkblue); --h-fg: #ffffff; }
button.ghost { --b: var(--af-soft); --b-fg: var(--af-fg); }
/* Donker thema: donkerblauw is daar de achtergrond, dus de gele knop vult zich met wit. */
@media (prefers-color-scheme: dark) {
  button.primary, button.record { --h: #ffffff; --h-fg: var(--af-darkblue); }
}
button.icon {
  min-height: 30px; width: 30px; padding: 0;
  --b: transparent; --b-fg: currentColor; --h: rgba(255, 255, 255, 0.14); --h-fg: currentColor;
}
button.icon:focus-visible { outline-color: var(--af-yellow); }
svg { width: 16px; height: 16px; fill: currentColor; flex: none; }

audio { width: 100%; height: 36px; }
.pages { margin: 0; padding: 10px 12px; list-style: none; font-size: 12px; font-weight: 400; color: var(--af-muted); display: grid; gap: 2px; background: var(--af-soft); border-radius: 8px; }
.pages li { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ok { color: var(--af-fg); font-weight: 600; margin: 0; display: flex; align-items: center; gap: 8px; }
.ok::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--af-ok); flex: none; }
.error { color: var(--af-record); margin: 0; font-size: 13px; }

.pill {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 10px 20px;
  --b: var(--af-darkblue);
  --b-fg: #ffffff;
  color: var(--b-fg);
  box-shadow: 1px 10px 40px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.1);
  font-variant-numeric: tabular-nums;
}
.pill > svg { color: var(--af-yellow); }
.pill:hover { color: var(--h-fg); }
.pill:hover > svg { color: inherit; }
.pill .time { font-size: 14px; }

@media (prefers-reduced-motion: reduce) {
  .dot.live { animation: none; }
  button { transition: none; }
}
`;var l=class extends Error{constructor(t,n){super(t);s(this,"retryable");this.retryable=n}};function W(i){return i.includes("ogg")?"ogg":i.includes("mp4")?"m4a":"webm"}async function $(i,e,t){let n=new FormData;n.append("meta",JSON.stringify(e)),n.append("audio",t,`${e.id}.${W(e.mimeType)}`);let r;try{r=await fetch(`${i}/api/recordings`,{method:"POST",body:n,credentials:"omit",mode:"cors",signal:AbortSignal.timeout(12e4)})}catch{throw new l("Versturen lukte niet. Controleer je verbinding en probeer het opnieuw.",!0)}if(r.ok){let o=await r.json().catch(()=>({}));return typeof o.retentionDays=="number"?{retentionDays:o.retentionDays}:{}}if(r.status===413)throw new l("De opname is te groot om te versturen.",!1);if(r.status>=400&&r.status<500&&r.status!==408&&r.status!==429){let o=await r.json().then(a=>a.error,()=>{});throw new l(`De server weigerde de opname${o?`: ${o}`:""}.`,!1)}throw new l("De server is even niet bereikbaar. Probeer het straks opnieuw.",!0)}var L="0.2.0",z=1e4,I=1440*60*1e3,q=3e4,X=4,T=16,K=["keydown","keyup","keypress","pointerdown","mousedown","click","dblclick","contextmenu","wheel","touchstart"],p={mic:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>',pause:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',play:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',stop:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6z"/></svg>',minimize:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11h14v2H5z"/></svg>'};function Q(i){if(typeof FontFace>"u"||[...document.fonts].some(t=>t.family===m))return;let e=new FontFace(m,`url(${i}/fonts/montserrat-latin-wght-normal.woff2) format("woff2")`,{weight:"100 900",display:"swap"});document.fonts.add(e),e.load().catch(()=>{})}function f(i){let e=Math.floor(i/1e3);return`${Math.floor(e/60)}:${String(e%60).padStart(2,"0")}`}function g(i){return i.replace(/[&<>"']/g,e=>`&#${e.charCodeAt(0)};`)}function G(i){try{let e=new URL(i);return decodeURI(e.pathname+e.search+e.hash)||"/"}catch{return i}}function Y(){if(crypto.randomUUID)return crypto.randomUUID();let i=crypto.getRandomValues(new Uint8Array(16));i[6]=i[6]&15|64,i[8]=i[8]&63|128;let e=[...i].map(t=>t.toString(16).padStart(2,"0")).join("");return`${e.slice(0,8)}-${e.slice(8,12)}-${e.slice(12,16)}-${e.slice(16,20)}-${e.slice(20)}`}var R=class{constructor(e){s(this,"host");s(this,"root");s(this,"store",new h);s(this,"recorder",null);s(this,"tracker",null);s(this,"view",{name:"idle"});s(this,"minimized");s(this,"session",null);s(this,"chunks",[]);s(this,"seq",0);s(this,"audioUrl","");s(this,"ticker",0);s(this,"sentTimer",0);s(this,"context");s(this,"receipt",null);s(this,"storageKey");s(this,"config");s(this,"releaseLock",null);s(this,"anchor",{h:"right",v:"bottom",x:T,y:T});s(this,"dragMoved",!1);s(this,"onResize",()=>this.clampToViewport());s(this,"onBeforeUnload",e=>{this.view.name!=="recording"&&this.view.name!=="paused"||(e.preventDefault(),e.returnValue="")});this.config=e,this.context={...e.context},this.storageKey=`audio-feedback:${e.project}`,this.minimized=this.loadPref("minimized")??e.startMinimized,this.host=document.createElement("audio-feedback-widget"),this.host.setAttribute("data-version",L);for(let[t,n]of Object.entries({all:"initial",position:"fixed","z-index":"2147483000"}))this.host.style.setProperty(t,n,"important");for(let t of K)this.host.addEventListener(t,n=>n.stopPropagation());this.root=this.host.attachShadow({mode:"open"}),Q(e.endpoint),this.root.addEventListener("click",t=>this.onClick(t)),this.root.addEventListener("pointerdown",t=>this.onPointerDown(t)),document.body.appendChild(this.host),this.applyAnchor(this.loadPref("anchor")??this.defaultAnchor()),window.addEventListener("resize",this.onResize),window.addEventListener("beforeunload",this.onBeforeUnload),this.render(),this.checkPending(),window.setTimeout(()=>{this.checkPending()},3e3)}setContext(e){Object.assign(this.context,e)}open(){this.setMinimized(!1)}minimize(){this.setMinimized(!0)}async clear(){await this.stopRecorder(),this.clearSession(),this.receipt=null,window.clearTimeout(this.sentTimer),await this.store.clear().catch(()=>{}),this.setView({name:"idle"})}destroy(){this.recorder?.stop(),this.tracker?.stop(),window.clearInterval(this.ticker),window.clearTimeout(this.sentTimer),window.removeEventListener("resize",this.onResize),window.removeEventListener("beforeunload",this.onBeforeUnload),this.audioUrl&&URL.revokeObjectURL(this.audioUrl),this.releaseLock?.(),this.host.remove()}claim(e){let t=()=>{};return navigator.locks?new Promise(n=>{navigator.locks.request(`audio-feedback:${e}`,{ifAvailable:!0},r=>r?new Promise(o=>n(o)):n(null)).catch(()=>n(t))}):Promise.resolve(t)}hold(e){this.releaseLock?.(),this.releaseLock=e}async checkPending(){if(this.view.name!=="idle"||this.session)return;let e=Date.now(),t=await this.store.sessions().catch(()=>[]);for(let a of t.filter(d=>e-d.heartbeat>I)){let d=await this.claim(a.meta.id);d&&(await this.store.remove(a.meta.id).catch(()=>{}),d())}let n=t.filter(a=>e-a.heartbeat<=I).filter(a=>a.meta.project===this.config.project).filter(a=>navigator.locks||a.status==="ready"||e-a.heartbeat>z).sort((a,d)=>a.meta.startedAt.localeCompare(d.meta.startedAt)),r,o=null;for(let a of n)if(o=await this.claim(a.meta.id),o){r=a;break}if(!(!r||!o)){if(this.view.name!=="idle"||this.session)return o();if(this.hold(o),r.status==="recording"&&(r.status="ready",r.meta.recovered=!0,r.meta.timeline.push({at:r.meta.durationMs,type:"stop"})),r.meta.durationMs<=0){await this.store.remove(r.meta.id).catch(()=>{});return}this.session=r,this.chunks=[await this.store.audio(r.meta.id,r.meta.mimeType)],this.store.putSession(r).catch(()=>{}),this.setView({name:"pending"})}}async startRecording(){this.setView({name:"starting"});let e=new P;try{await e.start()}catch(r){let o=r instanceof c?r.message:"De opname kon niet starten.";this.setView({name:"error",message:o,action:"back"});return}this.recorder=e,e.onInterrupted=()=>{this.stop()},this.chunks=[],this.seq=0;let t={id:Y(),project:this.config.project,startedAt:new Date().toISOString(),durationMs:0,mimeType:e.mimeType,url:"",title:document.title,timeline:[],context:{...this.context},client:{userAgent:navigator.userAgent,language:navigator.language,viewport:{width:window.innerWidth,height:window.innerHeight},widgetVersion:L},recovered:!1};this.session={meta:t,status:"recording",heartbeat:Date.now()};let n=await this.claim(t.id);n&&this.hold(n),this.tracker=new E({stripQuery:this.config.stripQuery,stripHash:this.config.stripHash,keepParams:this.config.keepParams},()=>e.elapsedMs(),r=>this.addTimeline(r)),t.url=this.tracker.currentUrl(),t.timeline.push({at:0,type:"start",url:t.url,title:t.title}),this.tracker.start(),e.onChunk=r=>{this.chunks.push(r);let o=this.session;!o||o.meta.id!==t.id||(o.meta.durationMs=e.elapsedMs(),o.heartbeat=Date.now(),this.store.putChunk(t.id,this.seq++,r).catch(()=>{}),this.store.putSession(o).catch(()=>{}))},this.store.putSession(this.session).catch(()=>{}),this.ticker=window.setInterval(()=>this.tick(),100),this.setView({name:"recording"})}addTimeline(e){this.session&&(this.session.meta.timeline.push(e),this.store.putSession(this.session).catch(()=>{}))}pause(){this.recorder&&(this.recorder.pause(),this.addTimeline({at:this.recorder.elapsedMs(),type:"pause"}),this.setView({name:"paused"}))}resume(){this.recorder&&(this.recorder.resume(),this.addTimeline({at:this.recorder.elapsedMs(),type:"resume"}),this.setView({name:"recording"}))}async stop(){let e=this.recorder,t=this.session;!e||!t||(window.clearInterval(this.ticker),this.tracker?.stop(),this.tracker=null,await e.stop(),this.recorder=null,t.meta.durationMs=e.elapsedMs(),t.meta.timeline.push({at:t.meta.durationMs,type:"stop"}),t.status="ready",this.store.putSession(t).catch(()=>{}),this.setView({name:"review"}))}async send(){let e=this.session;if(!e)return;this.setView({name:"uploading"});let t=new Blob(this.chunks,{type:e.meta.mimeType});try{let{retentionDays:n}=await $(this.config.endpoint,{...e.meta,context:{...e.meta.context}},t);this.receipt={kenmerk:e.meta.id.slice(0,8),retentionDays:n}}catch(n){let r=n instanceof l?n:new l("Versturen lukte niet.",!0);this.setView({name:"error",message:r.message,action:r.retryable?"retry-upload":"discard"});return}await this.store.remove(e.meta.id).catch(()=>{}),this.clearSession(),this.setView({name:"sent"}),this.sentTimer=window.setTimeout(()=>{this.view.name==="sent"&&(this.setView({name:"idle"}),this.checkPending())},q)}async stopRecorder(){this.recorder&&(window.clearInterval(this.ticker),this.tracker?.stop(),this.tracker=null,await this.recorder.stop(),this.recorder=null)}async discard(){await this.stopRecorder(),this.session&&await this.store.remove(this.session.meta.id).catch(()=>{}),this.clearSession(),this.setView({name:"idle"}),this.checkPending()}clearSession(){this.releaseLock?.(),this.releaseLock=null,this.session=null,this.chunks=[],this.audioUrl&&URL.revokeObjectURL(this.audioUrl),this.audioUrl=""}tick(){let e=this.recorder;if(!e)return;let t=e.elapsedMs();if(t>=this.config.maxDurationSec*1e3&&e.state==="recording"){this.stop();return}let n=this.session;n&&Date.now()-n.heartbeat>z/3&&(n.heartbeat=Date.now(),this.store.putSession(n).catch(()=>{}));let r=this.config.maxDurationSec*1e3-t;for(let a of this.root.querySelectorAll("[data-time]"))a.textContent=f(t),a.classList.toggle("warn",r<=3e4);let o=this.root.querySelector("[data-meter]");o&&(o.style.width=`${Math.round(e.level()*100)}%`)}setView(e){let t=this.root.activeElement!==null;this.view=e,this.render(),t&&this.root.querySelector("[data-autofocus]")?.focus()}setMinimized(e){this.minimized=e,this.savePref("minimized",e),this.render()}render(){let e=this.view,t=e.name==="recording"||e.name==="paused",n=this.recorder?.elapsedMs()??this.session?.meta.durationMs??0;if(this.minimized){let r=t?`<span class="dot ${e.name==="paused"?"paused":"live"}"></span>`:p.mic,o=t?`<span class="time" data-time>${f(n)}</span>`:"Feedback inspreken";this.root.innerHTML=`<style>${D}</style>
        <button class="pill" data-action="expand" data-drag data-autofocus
          aria-label="Feedback-kaartje openen${t?", opname loopt":""}">${r}${o}</button>`,this.clampToViewport();return}if(this.root.innerHTML=`<style>${D}</style>
      <section class="card" role="region" aria-label="Feedback inspreken">
        <div class="head" data-drag>
          <span class="title">Feedback inspreken</span>
          <button class="icon" data-action="minimize" title="Minimaliseren" aria-label="Minimaliseren">${p.minimize}</button>
        </div>
        <div class="body" aria-live="polite">${this.renderBody(e,n)}</div>
      </section>`,e.name==="review"||e.name==="pending"){let r=this.root.querySelector("audio");r&&(this.audioUrl||(this.audioUrl=URL.createObjectURL(new Blob(this.chunks,{type:this.session?.meta.mimeType}))),r.src=this.audioUrl)}this.clampToViewport()}renderBody(e,t){let n=f(this.config.maxDurationSec*1e3);switch(e.name){case"idle":return`<p class="text">Vertel wat je ziet of ervaart. Met je opname sturen we het adres en de titel mee van de pagina's die je bekijkt, en welke browser je gebruikt. Niet wat er op je scherm staat.${this.config.privacyUrl?` <a href="${g(this.config.privacyUrl)}" target="_blank" rel="noopener noreferrer">Hoe we hiermee omgaan</a>`:""}</p>
          <div class="row"><button class="record" data-action="record" data-autofocus>${p.mic}Opnemen</button></div>`;case"starting":return'<p class="text">Microfoon wordt gestart\u2026 Sta de microfoon toe als je browser erom vraagt.</p>';case"recording":case"paused":{let r=e.name==="recording";return`<div class="status">
            <span class="dot ${r?"live":"paused"}"></span>
            <span class="time" data-time>${f(t)}</span>
            <span class="limit">/ ${n}${r?"":" \xB7 gepauzeerd"}</span>
          </div>
          <div class="meter" aria-hidden="true"><i data-meter></i></div>
          <div class="row">
            ${r?`<button data-action="pause" data-autofocus>${p.pause}Pauzeren</button>`:`<button class="record" data-action="resume" data-autofocus>${p.play}Hervatten</button>`}
            <button data-action="stop">${p.stop}Stoppen</button>
          </div>`}case"review":case"pending":return`${e.name==="pending"?`<p class="text"><strong>Er staat nog een opname klaar</strong> van ${f(t)} die niet is verstuurd. Na een dag wordt hij vanzelf weggegooid.</p>`:'<p class="text">Luister eventueel terug en verstuur je feedback.</p>'}
          <audio controls preload="metadata"></audio>
          ${this.renderPages()}
          <div class="row">
            <button class="ghost" data-action="discard">Weggooien</button>
            <button class="primary" data-action="send" data-autofocus>Versturen</button>
          </div>`;case"uploading":return'<p class="text">Versturen\u2026</p>';case"sent":{let r=this.receipt,o=r?.retentionDays?` We bewaren hem ${r.retentionDays} dagen.`:"";return`<p class="ok">Bedankt! Je feedback is verstuurd.</p>
          ${r?`<p class="text">Kenmerk <strong class="code">${g(r.kenmerk)}</strong>. Noem dit als je je opname wilt laten inzien of verwijderen.${o}</p>`:""}
          <div class="row"><button data-action="new" data-autofocus>Nog een opname</button></div>`}case"error":{let r={"retry-upload":'<button class="ghost" data-action="later">Later</button><button class="primary" data-action="send" data-autofocus>Opnieuw proberen</button>',discard:'<button data-action="discard" data-autofocus>Weggooien</button>',back:'<button class="ghost" data-action="back" data-autofocus>Terug</button>'}[e.action];return`<p class="error" role="alert">${g(e.message)}</p><div class="row">${r}</div>`}}}renderPages(){let e=[...new Set((this.session?.meta.timeline??[]).filter(r=>r.url).map(r=>r.url))];if(e.length===0)return"";let t=e.slice(0,3).map(r=>`<li title="${g(r)}">${g(G(r))}</li>`).join(""),n=e.length>3?`<li>en ${e.length-3} meer</li>`:"";return`<ul class="pages" aria-label="Pagina's die worden meegestuurd">${t}${n}</ul>`}onClick(e){let t=e.target.closest("[data-action]");if(!(!t||this.dragMoved))switch(e.detail>0&&t.blur(),t.dataset.action){case"record":case"new":window.clearTimeout(this.sentTimer),this.startRecording();break;case"pause":this.pause();break;case"resume":this.resume();break;case"stop":this.stop();break;case"send":this.send();break;case"discard":this.discard();break;case"later":this.clearSession(),this.setView({name:"idle"});break;case"back":this.setView({name:"idle"});break;case"minimize":this.setMinimized(!0);break;case"expand":this.setMinimized(!1);break}}defaultAnchor(){let[e,t]=this.config.position.split("-");return{h:t,v:e,x:T,y:T}}applyAnchor(e){this.anchor=e;let t=this.host.style;for(let n of["left","right","top","bottom"])t.removeProperty(n);t.setProperty(e.h,`${Math.round(e.x)}px`,"important"),t.setProperty(e.v,`${Math.round(e.y)}px`,"important")}clampToViewport(){let{width:e,height:t}=this.host.getBoundingClientRect(),n=Math.max(0,window.innerWidth-e),r=Math.max(0,window.innerHeight-t),o=this.anchor;this.applyAnchor({...o,x:Math.min(Math.max(0,o.x),n),y:Math.min(Math.max(0,o.y),r)})}onPointerDown(e){let t=e.target.closest("[data-drag]");if(!t||e.button!==0||e.target.closest("[data-action]")&&t.matches(".head"))return;let n=this.host.getBoundingClientRect(),r=e.clientX-n.left,o=e.clientY-n.top,a=e.clientX,d=e.clientY;this.dragMoved=!1;let b=x=>{if(!this.dragMoved&&Math.hypot(x.clientX-a,x.clientY-d)<X)return;this.dragMoved=!0;let k=Math.min(Math.max(0,x.clientX-r),window.innerWidth-n.width),S=Math.min(Math.max(0,x.clientY-o),window.innerHeight-n.height),A=window.innerWidth-k-n.width,C=window.innerHeight-S-n.height;this.applyAnchor({h:k<=A?"left":"right",v:S<=C?"top":"bottom",x:k<=A?k:A,y:S<=C?S:C})},y=()=>{window.removeEventListener("pointermove",b),window.removeEventListener("pointerup",y),window.removeEventListener("pointercancel",y),this.dragMoved&&(this.savePref("anchor",this.anchor),setTimeout(()=>this.dragMoved=!1,0))};window.addEventListener("pointermove",b),window.addEventListener("pointerup",y),window.addEventListener("pointercancel",y)}loadPref(e){try{let t=localStorage.getItem(`${this.storageKey}:${e}`);return t===null?void 0:JSON.parse(t)}catch{return}}savePref(e,t){try{localStorage.setItem(`${this.storageKey}:${e}`,JSON.stringify(t))}catch{}}};var J=["bottom-right","bottom-left","top-right","top-left"],Z=1800,w=document.currentScript;function v(i){if(i!==void 0)return i===""||i==="true"||i==="1"}function ee(){if(!w)return{};let i=w.dataset,e={};if(i.endpoint&&(e.endpoint=i.endpoint),i.project&&(e.project=i.project),i.position&&J.includes(i.position)&&(e.position=i.position),i.maxDuration&&(e.maxDurationSec=Number(i.maxDuration)),i.stripQuery!==void 0&&(e.stripQuery=v(i.stripQuery)),i.stripHash!==void 0&&(e.stripHash=v(i.stripHash)),i.keepParams&&(e.keepParams=i.keepParams.split(",").map(t=>t.trim()).filter(Boolean)),i.privacyUrl&&(e.privacyUrl=i.privacyUrl),i.minimized!==void 0&&(e.startMinimized=v(i.minimized)),i.allowWebdriver!==void 0&&(e.allowWebdriver=v(i.allowWebdriver)),i.hosts&&(e.hosts=i.hosts.split(",").map(t=>t.trim().toLowerCase()).filter(Boolean)),i.context)try{e.context=JSON.parse(i.context)}catch{console.warn("[audio-feedback] data-context is geen geldige JSON en wordt genegeerd")}return e}function te(){try{if(w?.src)return new URL(w.src).origin}catch{}return location.origin}function ie(i){if(!i)return"";try{let e=new URL(i,location.href);if(e.protocol==="https:"||e.protocol==="http:")return e.href}catch{}return console.warn("[audio-feedback] data-privacy-url is geen http(s)-adres en wordt genegeerd"),""}function re(i){let e=Number(i.maxDurationSec),t={};for(let[n,r]of Object.entries(i.context??{}))t[String(n)]=String(r);return{endpoint:(i.endpoint??te()).replace(/\/+$/,""),project:i.project||location.hostname||"onbekend",position:i.position??"bottom-right",maxDurationSec:Number.isFinite(e)&&e>0?Math.min(e,Z):600,stripQuery:i.stripQuery??!0,stripHash:i.stripHash??!0,keepParams:(i.keepParams??[]).map(String),privacyUrl:ie(i.privacyUrl),startMinimized:i.startMinimized??!1,context:t}}var u=null,O={};function B(i={}){let e={...window.AudioFeedbackConfig,...ee(),...i};if(navigator.webdriver&&!e.allowWebdriver||e.hosts?.length&&!e.hosts.includes(location.hostname.toLowerCase()))return null;u?.destroy(),e.context={...e.context,...O};let t=()=>u=new R(re(e));return document.body?t():(document.addEventListener("DOMContentLoaded",t,{once:!0}),null)}window.AudioFeedback||(window.AudioFeedback={version:L,init:B,open:()=>u?.open(),minimize:()=>u?.minimize(),setContext:e=>{Object.assign(O,e),u?.setContext(e)},clear:()=>u?u.clear():new h().clear().catch(()=>{}),destroy:()=>{u?.destroy(),u=null}},(v(w?.dataset.manual)??!1)||B());})();
