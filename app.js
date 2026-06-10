(() => {
  'use strict';

  const START = new Date('2026-06-10T00:00:00Z');
  const END = new Date('2036-06-10T00:00:00Z');
  const DAY = 86400000;
  const AU_SCALE = 34; // pixels per compressed AU before zoom/fisheye
  const MAX_DAYS = Math.round((END - START) / DAY);

  const canvas = document.getElementById('spaceCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const dateSlider = document.getElementById('dateSlider');
  const dateOutput = document.getElementById('dateOutput');
  const zoomSlider = document.getElementById('zoomSlider');
  const tiltSlider = document.getElementById('tiltSlider');
  const playBtn = document.getElementById('playBtn');
  const todayBtn = document.getElementById('todayBtn');
  const eventList = document.getElementById('eventList');
  const selectedTitle = document.getElementById('selectedTitle');
  const selectedSubtitle = document.getElementById('selectedSubtitle');
  const explainText = document.getElementById('explainText');
  const toggleExplain = document.getElementById('toggleExplain');
  const observerPanel = document.getElementById('observerPanel');
  const latInput = document.getElementById('latInput');
  const lonInput = document.getElementById('lonInput');
  const geoBtn = document.getElementById('geoBtn');
  const calcLocalBtn = document.getElementById('calcLocalBtn');
  const localResult = document.getElementById('localResult');
  const engineStatus = document.getElementById('engineStatus');
  const viewButtons = [...document.querySelectorAll('.viewSwitch button')];
  const filterButtons = [...document.querySelectorAll('.chip')];

  let W = 0, H = 0, DPR = 1;
  let stars = [];
  let currentView = 'solar';
  let selectedEvent = window.ECLIPSE_DATA[0];
  let filter = 'all';
  let simDate = new Date(START);
  let playing = false;
  let lastTime = performance.now();
  let camera = { rot: -0.48, tilt: deg(42), zoom: 1, panX: 0, panY: 0 };
  let pointer = { down:false, x:0, y:0, startRot:0, startTilt:0 };
  let localCache = new Map();

  const planets = Object.entries(window.PLANET_ELEMENTS);
  const monthFormatter = new Intl.DateTimeFormat('it-IT', { day:'2-digit', month:'2-digit', year:'numeric' });
  const fullDateFormatter = new Intl.DateTimeFormat('it-IT', { weekday:'long', day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit', timeZoneName:'short' });

  function deg(v){ return v * Math.PI / 180; }
  function radToDeg(v){ return v * 180 / Math.PI; }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
  function lerp(a,b,t){ return a + (b-a)*t; }
  function mod360(x){ return ((x % 360) + 360) % 360; }
  function normDate(d){ return new Date(d.getTime()); }

  function resize(){
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.floor(window.innerWidth));
    H = Math.max(1, Math.floor(window.innerHeight));
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    seedStars();
  }

  function seedStars(){
    const count = Math.floor((W * H) / 2600);
    let s = 918273;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    stars = Array.from({length: count}, () => ({
      x: rnd()*W, y: rnd()*H, r: rnd()*1.35 + 0.15, a: rnd()*0.75 + 0.15,
      tw: rnd()*Math.PI*2, hue: rnd()
    }));
  }

  function julianDate(date){ return date.getTime()/DAY + 2440587.5; }
  function planetVector(name, date){
    const p = window.PLANET_ELEMENTS[name];
    const T = (julianDate(date) - 2451545.0) / 36525;
    const a = p.a[0] + p.a[1]*T;
    const e = p.e[0] + p.e[1]*T;
    const I = deg(p.I[0] + p.I[1]*T);
    const L = p.L[0] + p.L[1]*T;
    const peri = p.peri[0] + p.peri[1]*T;
    const node = p.node[0] + p.node[1]*T;
    const omega = deg(peri - node);
    let M = deg(mod360(L - peri));
    if (M > Math.PI) M -= Math.PI*2;
    let E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
    for(let i=0; i<7; i++) E = E - (E - e*Math.sin(E) - M) / (1 - e*Math.cos(E));
    const xp = a * (Math.cos(E) - e);
    const yp = a * Math.sqrt(1-e*e) * Math.sin(E);
    const cosO = Math.cos(deg(node)), sinO = Math.sin(deg(node));
    const cosw = Math.cos(omega), sinw = Math.sin(omega);
    const cosI = Math.cos(I), sinI = Math.sin(I);
    const x = (cosw*cosO - sinw*sinO*cosI)*xp + (-sinw*cosO - cosw*sinO*cosI)*yp;
    const y = (cosw*sinO + sinw*cosO*cosI)*xp + (-sinw*sinO + cosw*cosO*cosI)*yp;
    const z = (sinw*sinI)*xp + (cosw*sinI)*yp;
    return {x,y,z,a,e,name};
  }

  function project(v, scaleBoost=1){
    // Fisheye compression: inner planets remain legible while Neptune still fits.
    const dist = Math.hypot(v.x, v.y, v.z);
    const k = dist > 0 ? (Math.log1p(dist*1.35) / dist) : 1;
    let x = v.x * k, y = v.y * k, z = v.z * k;
    const cr = Math.cos(camera.rot), sr = Math.sin(camera.rot);
    const ct = Math.cos(camera.tilt), st = Math.sin(camera.tilt);
    const xr = x*cr - y*sr;
    const yr = x*sr + y*cr;
    const zr = z;
    const yt = yr*ct - zr*st;
    const zt = yr*st + zr*ct;
    const s = AU_SCALE * camera.zoom * scaleBoost;
    return {x: W/2 + camera.panX + xr*s, y: H/2 + camera.panY + yt*s, z: zt, depth: zt};
  }

  function drawBackground(t){
    const g = ctx.createRadialGradient(W*0.32,H*0.20,0,W*0.45,H*0.43,Math.max(W,H));
    g.addColorStop(0,'#0c1b3e'); g.addColorStop(.45,'#050712'); g.addColorStop(1,'#010208');
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
    for(const st of stars){
      const tw = Math.sin(t/900 + st.tw)*0.22 + 0.78;
      ctx.globalAlpha = st.a * tw;
      ctx.fillStyle = st.hue > .88 ? '#ffd9aa' : st.hue < .12 ? '#b9d8ff' : '#ffffff';
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawOrbit(name, date, strong=false){
    const pts = [];
    const p = window.PLANET_ELEMENTS[name];
    for(let i=0;i<=220;i++){
      const E = i/220 * Math.PI*2;
      const fakeDate = date;
      const T = (julianDate(fakeDate) - 2451545.0) / 36525;
      const a = p.a[0] + p.a[1]*T, e = p.e[0] + p.e[1]*T;
      const I = deg(p.I[0] + p.I[1]*T);
      const peri = p.peri[0] + p.peri[1]*T;
      const node = p.node[0] + p.node[1]*T;
      const omega = deg(peri - node);
      const xp = a * (Math.cos(E) - e);
      const yp = a * Math.sqrt(1-e*e) * Math.sin(E);
      const cosO = Math.cos(deg(node)), sinO = Math.sin(deg(node));
      const cosw = Math.cos(omega), sinw = Math.sin(omega);
      const cosI = Math.cos(I), sinI = Math.sin(I);
      const x = (cosw*cosO - sinw*sinO*cosI)*xp + (-sinw*cosO - cosw*sinO*cosI)*yp;
      const y = (cosw*sinO + sinw*cosO*cosI)*xp + (-sinw*sinO + cosw*cosO*cosI)*yp;
      const z = (sinw*sinI)*xp + (cosw*sinI)*yp;
      pts.push(project({x,y,z}));
    }
    ctx.save();
    ctx.beginPath();
    pts.forEach((pt,i)=> i ? ctx.lineTo(pt.x,pt.y) : ctx.moveTo(pt.x,pt.y));
    const alpha = strong ? .42 : (name === 'Earth' ? .30 : .14);
    ctx.strokeStyle = `rgba(180,220,255,${alpha})`;
    ctx.lineWidth = strong ? 1.55 : 1;
    ctx.stroke();
    ctx.restore();
  }

  function drawPlanet(pv, data, t){
    const pos = project(pv);
    const baseR = data.radius * (data.name === 'Jupiter' || data.name === 'Saturn' ? 3.4 : 4.2) * camera.zoom;
    const r = clamp(baseR, data.name === 'Mercury' ? 2.4 : 3.6, data.name === 'Jupiter' ? 17 : 11);
    const glow = ctx.createRadialGradient(pos.x-r*.3,pos.y-r*.45,0,pos.x,pos.y,r*2.4);
    glow.addColorStop(0,'rgba(255,255,255,.95)');
    glow.addColorStop(.25,data.color);
    glow.addColorStop(.75,hexToRgba(data.color,.22));
    glow.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(pos.x,pos.y,r*2.1,0,Math.PI*2); ctx.fill();
    const body = ctx.createRadialGradient(pos.x-r*.35,pos.y-r*.45,0,pos.x,pos.y,r);
    body.addColorStop(0,'#ffffff'); body.addColorStop(.2, mixColor(data.color,'#ffffff',.20)); body.addColorStop(1, mixColor(data.color,'#000000',.35));
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(pos.x,pos.y,r,0,Math.PI*2); ctx.fill();
    if(data.name === 'Earth'){
      ctx.globalAlpha = .78;
      ctx.fillStyle = 'rgba(45,220,135,.55)';
      ctx.beginPath(); ctx.ellipse(pos.x-r*.15,pos.y+r*.02,r*.42,r*.18,deg(-18),0,Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.beginPath(); ctx.ellipse(pos.x+r*.18,pos.y-r*.25,r*.34,r*.11,deg(12),0,Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if(data.name === 'Saturn'){
      ctx.save(); ctx.translate(pos.x,pos.y); ctx.rotate(deg(-18));
      ctx.strokeStyle = 'rgba(230,214,170,.65)'; ctx.lineWidth = Math.max(1,r*.25);
      ctx.beginPath(); ctx.ellipse(0,0,r*1.8,r*.55,0,0,Math.PI*2); ctx.stroke(); ctx.restore();
    }
    if(shouldLabelPlanet(data.name)){
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(234,243,255,.88)'; ctx.fillText(data.label, pos.x + r + 5, pos.y - r - 3);
    }
  }

  function shouldLabelPlanet(name){
    if(camera.zoom > 1.3) return true;
    return ['Earth','Mars','Jupiter','Saturn','Neptune'].includes(name);
  }

  function hexToRgba(hex,a){
    const h = hex.replace('#','');
    const n = parseInt(h,16);
    return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
  }
  function mixColor(a,b,t){
    const A=parseInt(a.slice(1),16), B=parseInt(b.slice(1),16);
    const ar=[(A>>16)&255,(A>>8)&255,A&255], br=[(B>>16)&255,(B>>8)&255,B&255];
    const r=ar.map((v,i)=>Math.round(lerp(v,br[i],t)));
    return `rgb(${r[0]},${r[1]},${r[2]})`;
  }

  function drawSun(t){
    const c = project({x:0,y:0,z:0});
    const pulse = 1 + Math.sin(t/1200)*0.035;
    const r = clamp(18 * camera.zoom * pulse, 14, 36);
    const halo = ctx.createRadialGradient(c.x,c.y,0,c.x,c.y,r*7.5);
    halo.addColorStop(0,'rgba(255,244,190,.92)'); halo.addColorStop(.08,'rgba(255,199,93,.78)'); halo.addColorStop(.25,'rgba(255,126,46,.28)'); halo.addColorStop(1,'rgba(255,126,46,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(c.x,c.y,r*7.5,0,Math.PI*2); ctx.fill();
    const core = ctx.createRadialGradient(c.x-r*.28,c.y-r*.32,0,c.x,c.y,r);
    core.addColorStop(0,'#fffbe4'); core.addColorStop(.45,'#ffd66f'); core.addColorStop(1,'#ff6f2b');
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(c.x,c.y,r,0,Math.PI*2); ctx.fill();
    ctx.font = '700 13px system-ui, sans-serif'; ctx.fillStyle='rgba(255,238,190,.9)'; ctx.fillText('Sole', c.x+r+6, c.y-r-2);
  }

  function drawSolarSystem(t){
    drawBackground(t);
    planets.forEach(([name]) => drawOrbit(name, simDate, name==='Earth'));
    drawSun(t);
    const sorted = planets.map(([name,data]) => ({pv: planetVector(name, simDate), data})).sort((a,b)=>a.pv.z-b.pv.z);
    sorted.forEach(({pv,data}) => drawPlanet(pv, data, t));
    drawMoonNearEarth(t);
    drawScaleHint('Sistema solare compresso: distanze leggibili, posizioni orbitali calcolate da elementi JPL.');
  }

  function moonAngleForDate(date){
    // Approximate synodic phase fallback. New moon near solar eclipse dates is supplied by selected events.
    const knownNew = Date.UTC(2000,0,6,18,14);
    const synodic = 29.530588853 * DAY;
    const phase = ((date.getTime() - knownNew) % synodic + synodic) % synodic;
    return phase / synodic * Math.PI * 2;
  }

  function drawMoonNearEarth(t){
    const earth = planetVector('Earth', simDate);
    const ep = project(earth);
    const ang = moonAngleForDate(simDate);
    const orbitR = clamp(16 * camera.zoom, 9, 24);
    ctx.save();
    ctx.strokeStyle = 'rgba(210,225,255,.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(ep.x, ep.y, orbitR, orbitR*.42, camera.rot, 0, Math.PI*2); ctx.stroke();
    const mx = ep.x + Math.cos(ang + camera.rot)*orbitR;
    const my = ep.y + Math.sin(ang + camera.rot)*orbitR*.42;
    const mr = clamp(2.8*camera.zoom,2,4.8);
    const g=ctx.createRadialGradient(mx-mr*.3,my-mr*.3,0,mx,my,mr);
    g.addColorStop(0,'#fff'); g.addColorStop(.35,'#c7ccd4'); g.addColorStop(1,'#4c515a');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(mx,my,mr,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function drawEclipseGeometry(t){
    drawBackground(t);
    camera.zoom = parseFloat(zoomSlider.value);
    const eventDate = new Date(selectedEvent.date);
    const earth = planetVector('Earth', eventDate);
    const ep = project(earth, 1.5);
    const sp = project({x:0,y:0,z:0}, 1.5);
    drawSun(t);
    ctx.save();
    ctx.strokeStyle = 'rgba(143,215,255,.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sp.x,sp.y); ctx.lineTo(ep.x,ep.y); ctx.stroke();
    ctx.restore();

    // Draw enlarged Earth/Moon diagram near center for clarity.
    const cx = W * 0.48;
    const cy = H * 0.52;
    const solar = selectedEvent.kind === 'solar';
    const lineAng = solar ? 0 : Math.PI;
    const sunX = cx - 290, earthX = cx + (solar ? 120 : -20), moonX = solar ? cx + 10 : cx + 235;

    // Sun glow in geometry view.
    const sg = ctx.createRadialGradient(sunX, cy, 0, sunX, cy, 180);
    sg.addColorStop(0,'rgba(255,238,160,.98)'); sg.addColorStop(.18,'rgba(255,184,77,.55)'); sg.addColorStop(1,'rgba(255,146,48,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sunX, cy, 180, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ffd36d'; ctx.beginPath(); ctx.arc(sunX, cy, 56, 0, Math.PI*2); ctx.fill();

    if(solar){
      drawEarthSphere(earthX, cy, 72, t, true);
      drawMoonDisc(moonX, cy-2, 23);
      drawCone(moonX+16, cy-2, earthX-46, cy-28, earthX-46, cy+28, 'rgba(8,10,14,.70)', 'rgba(25,30,45,.12)');
      drawCone(moonX+16, cy-2, earthX+60, cy-96, earthX+60, cy+96, 'rgba(143,215,255,.10)', 'rgba(143,215,255,.02)');
      annotate(cx, cy+135, 'Eclisse solare: Luna tra Sole e Terra. Dal suolo conta dove cade la sua ombra.');
    } else {
      drawEarthSphere(earthX, cy, 72, t, true);
      drawCone(earthX+62, cy, moonX+36, cy-55, moonX+36, cy+55, 'rgba(4,7,15,.72)', 'rgba(120,35,22,.18)');
      drawMoonDisc(moonX, cy, 34, selectedEvent.type === 'Totale' ? 'blood' : 'shadow');
      annotate(cx, cy+135, 'Eclisse lunare: Terra tra Sole e Luna. La Luna attraversa penombra e ombra terrestre.');
    }
    drawMiniSolarSystemInset(eventDate, t);
    drawScaleHint('Geometria dell’eclisse selezionata. La scena è didattica: ingrandisce Sole, Terra e Luna per rendere visibili ombra e allineamento.');
  }

  function drawCone(ax,ay,bx1,by1,bx2,by2,fill,stroke){
    const g = ctx.createLinearGradient(ax,ay,bx1,by1);
    g.addColorStop(0,fill); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g; ctx.strokeStyle=stroke; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx1,by1); ctx.lineTo(bx2,by2); ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  function drawMoonDisc(x,y,r,mode='normal'){
    const g = ctx.createRadialGradient(x-r*.32,y-r*.35,0,x,y,r);
    if(mode==='blood') { g.addColorStop(0,'#ffc7a1'); g.addColorStop(.35,'#b14b36'); g.addColorStop(1,'#351819'); }
    else if(mode==='shadow') { g.addColorStop(0,'#dce2ef'); g.addColorStop(.55,'#8e96a5'); g.addColorStop(1,'#242936'); }
    else { g.addColorStop(0,'#fff'); g.addColorStop(.45,'#c9cbd0'); g.addColorStop(1,'#383d49'); }
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.18)'; ctx.stroke();
  }

  function drawEarthSphere(x,y,r,t,labels=false){
    const g = ctx.createRadialGradient(x-r*.35,y-r*.45,0,x,y,r);
    g.addColorStop(0,'#d7f4ff'); g.addColorStop(.12,'#74c8ff'); g.addColorStop(.55,'#2056a9'); g.addColorStop(1,'#051129');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.clip();
    ctx.globalAlpha=.58; ctx.fillStyle='#48d087';
    const drift = (t/90) % (r*2);
    for(let i=-2;i<4;i++){
      ctx.beginPath(); ctx.ellipse(x-r+drift+i*r*.72,y-r*.25+(i%2)*r*.25,r*.5,r*.16,deg(18),0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x-r*.45+drift+i*r*.65,y+r*.26,r*.4,r*.12,deg(-22),0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=.32; ctx.fillStyle='white';
    for(let i=0;i<5;i++){ ctx.beginPath(); ctx.ellipse(x-r+i*r*.52+drift*.2,y-r*.45+i*r*.22,r*.3,r*.07,deg(15),0,Math.PI*2); ctx.fill(); }
    ctx.restore();
    const night = ctx.createLinearGradient(x-r,y,x+r,y);
    night.addColorStop(0,'rgba(0,0,0,0)'); night.addColorStop(.62,'rgba(0,0,0,.07)'); night.addColorStop(1,'rgba(0,0,0,.52)');
    ctx.fillStyle=night; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.24)'; ctx.stroke();
    if(labels){ ctx.font='13px system-ui'; ctx.fillStyle='rgba(234,243,255,.85)'; ctx.fillText('Terra', x-r*.35, y+r+22); }
  }

  function annotate(x,y,text){
    ctx.save(); ctx.font='14px system-ui, sans-serif'; ctx.textAlign='center';
    const maxWidth = Math.min(560,W-60); const lines = wrapText(text,maxWidth,ctx);
    const h=lines.length*19+18;
    ctx.fillStyle='rgba(8,12,27,.62)'; roundRect(ctx,x-maxWidth/2,y-h/2,maxWidth,h,16); ctx.fill();
    ctx.strokeStyle='rgba(143,215,255,.22)'; ctx.stroke(); ctx.fillStyle='rgba(234,243,255,.86)';
    lines.forEach((ln,i)=>ctx.fillText(ln,x,y-h/2+26+i*19));
    ctx.restore();
  }
  function wrapText(text, maxWidth, ctx){
    const words=text.split(' '), lines=[]; let line='';
    for(const w of words){ const test=line?line+' '+w:w; if(ctx.measureText(test).width>maxWidth-26 && line){ lines.push(line); line=w; } else line=test; }
    if(line) lines.push(line); return lines;
  }
  function roundRect(ctx,x,y,w,h,r){
    ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  }

  function drawMiniSolarSystemInset(date,t){
    const x = 18, y = H-250, w = Math.min(360, W-36), h = 172;
    ctx.save(); ctx.fillStyle='rgba(8,12,27,.44)'; roundRect(ctx,x,y,w,h,18); ctx.fill(); ctx.strokeStyle='rgba(255,255,255,.10)'; ctx.stroke();
    ctx.fillStyle='rgba(234,243,255,.83)'; ctx.font='700 12px system-ui'; ctx.fillText('Allineamento visto dall’alto', x+14,y+22);
    const oldZoom=camera.zoom, oldRot=camera.rot, oldTilt=camera.tilt, oldPanX=camera.panX, oldPanY=camera.panY;
    camera.zoom=.72; camera.rot=-0.15; camera.tilt=deg(8); camera.panX=x+w/2-W/2; camera.panY=y+h/2-H/2+18;
    drawOrbit('Earth',date,true); drawOrbit('Mars',date,false); drawSun(t);
    drawPlanet(planetVector('Earth',date), window.PLANET_ELEMENTS.Earth, t);
    camera.zoom=oldZoom; camera.rot=oldRot; camera.tilt=oldTilt; camera.panX=oldPanX; camera.panY=oldPanY;
    ctx.restore();
  }

  function drawEarthView(t){
    drawBackground(t);
    const cx = W/2, cy = H/2 + 18;
    const r = Math.min(W,H) * 0.33;
    drawEarthSphere(cx, cy, r, t, false);
    drawLatLonGrid(cx, cy, r);
    drawRegionsOnGlobe(cx, cy, r, selectedEvent);
    drawEventPath(cx, cy, r, selectedEvent, t);
    drawScaleHint('Vista terrestre: la zona illuminata e le regioni di visibilità sono ricostruite per orientamento didattico; per i contatti locali usa il pannello Osservatore.');
  }

  function drawLatLonGrid(cx,cy,r){
    ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.clip();
    ctx.strokeStyle='rgba(255,255,255,.14)'; ctx.lineWidth=1;
    for(let lat=-60;lat<=60;lat+=30){
      const yy = cy - Math.sin(deg(lat))*r;
      const rx = Math.cos(deg(lat))*r;
      ctx.beginPath(); ctx.ellipse(cx,yy,rx,r*.12,0,0,Math.PI*2); ctx.stroke();
    }
    for(let lon=-120;lon<=120;lon+=30){
      ctx.beginPath(); ctx.ellipse(cx,cy,r*Math.cos(deg(lon)),r,0,0,Math.PI*2); ctx.stroke();
    }
    ctx.restore();
  }

  function globeProject(lat,lon,cx,cy,r){
    const lam = deg(lon + 20 + Math.sin(performance.now()/24000)*18);
    const phi = deg(lat);
    const x = cx + r * Math.cos(phi) * Math.sin(lam);
    const y = cy - r * Math.sin(phi);
    const visible = Math.cos(phi) * Math.cos(lam) > -0.10;
    const edge = clamp((Math.cos(phi) * Math.cos(lam)+.1)/.35,0,1);
    return {x,y,visible,edge};
  }

  function drawRegionsOnGlobe(cx,cy,r,event){
    for(const reg of (event.regions||[])){
      const anchor = window.REGION_ANCHORS[reg]; if(!anchor) continue;
      const p = globeProject(anchor.lat, anchor.lon, cx, cy, r);
      if(!p.visible) continue;
      ctx.globalAlpha = .15 + .55*p.edge;
      ctx.fillStyle = event.kind==='solar' ? '#ffd27a' : '#aabfff';
      ctx.beginPath(); ctx.arc(p.x,p.y, Math.max(10,r*.055),0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=1;
  }

  function drawEventPath(cx,cy,r,event,t){
    const solar = event.kind==='solar';
    const anchors = (event.regions||[]).map(reg=>window.REGION_ANCHORS[reg]).filter(Boolean);
    if(!anchors.length) return;
    ctx.save(); ctx.lineWidth=solar?3:2; ctx.strokeStyle=solar?'rgba(255,210,122,.88)':'rgba(168,190,255,.78)'; ctx.shadowBlur=20; ctx.shadowColor=solar?'rgba(255,210,122,.55)':'rgba(168,190,255,.45)';
    ctx.beginPath();
    anchors.forEach((a,i)=>{ const p=globeProject(a.lat,a.lon,cx,cy,r); if(i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); });
    ctx.stroke(); ctx.shadowBlur=0;
    const moving = anchors[Math.floor((Math.sin(t/1200)*.5+.5)*(anchors.length-1))] || anchors[0];
    const mp=globeProject(moving.lat,moving.lon,cx,cy,r);
    ctx.fillStyle=solar?'rgba(0,0,0,.78)':'rgba(130,35,28,.62)'; ctx.beginPath(); ctx.arc(mp.x,mp.y,solar?Math.max(8,r*.032):Math.max(16,r*.07),0,Math.PI*2); ctx.fill();
    ctx.strokeStyle=solar?'rgba(255,210,122,.75)':'rgba(255,190,170,.65)'; ctx.stroke();
    ctx.restore();
    const label = solar ? 'ombra/penombra lunare sulla Terra' : 'zone dove la Luna è sopra l’orizzonte durante l’eclisse';
    annotate(cx, cy+r+48, label);
  }

  function drawObserverView(t){
    drawBackground(t);
    const x = W/2, y = H/2 + 8;
    const solar = selectedEvent.kind === 'solar';
    drawHorizon(t);
    if(solar) drawSolarDiscSimulation(x,y,t); else drawLunarDiscSimulation(x,y,t);
    drawScaleHint('Vista osservatore: il disco mostra ciò che si vedrebbe dal suolo nel momento di massimo, se l’evento è visibile dalle coordinate impostate.');
  }

  function drawHorizon(t){
    const horizonY = H * .76;
    const sky = ctx.createLinearGradient(0,0,0,horizonY);
    sky.addColorStop(0,'rgba(2,5,15,.0)'); sky.addColorStop(.55,'rgba(12,27,58,.18)'); sky.addColorStop(1,'rgba(62,76,96,.28)');
    ctx.fillStyle=sky; ctx.fillRect(0,0,W,horizonY);
    ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(0,horizonY,W,H-horizonY);
    ctx.strokeStyle='rgba(200,220,255,.22)'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(0,horizonY); ctx.lineTo(W,horizonY); ctx.stroke();
    ctx.font='12px system-ui'; ctx.fillStyle='rgba(234,243,255,.65)'; ctx.fillText('orizzonte locale', 26, horizonY-10);
  }

  function getCachedLocal(){
    const key = `${selectedEvent.id}:${latInput.value}:${lonInput.value}`;
    return localCache.get(key);
  }

  function drawSolarDiscSimulation(x,y,t){
    const data = getCachedLocal();
    let obsc = selectedEvent.central ? (selectedEvent.type==='Totale' ? .96 : selectedEvent.type==='Anulare' ? .86 : .35) : .22;
    let visible = true;
    if(data && data.ok && data.type==='solar'){ obsc = data.obscuration ?? obsc; visible = data.visible; }
    if(data && !data.ok) visible = false;
    const r = Math.min(W,H)*.19;
    const g = ctx.createRadialGradient(x-r*.25,y-r*.3,0,x,y,r*2.2);
    g.addColorStop(0,'rgba(255,248,210,1)'); g.addColorStop(.23,'rgba(255,200,81,.82)'); g.addColorStop(.8,'rgba(255,150,42,.05)'); g.addColorStop(1,'rgba(255,150,42,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r*2.1,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#ffd15f'; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    const offset = (1 - Math.sqrt(clamp(obsc,0,1))) * r * 1.65;
    ctx.fillStyle='rgba(2,4,10,.96)'; ctx.beginPath(); ctx.arc(x + offset, y, r*.96,0,Math.PI*2); ctx.fill();
    if(selectedEvent.type==='Anulare' && obsc>.72){
      ctx.strokeStyle='rgba(255,235,150,.92)'; ctx.lineWidth=6; ctx.beginPath(); ctx.arc(x,y,r*.96,0,Math.PI*2); ctx.stroke();
    }
    ctx.fillStyle=visible?'rgba(234,243,255,.84)':'rgba(255,190,175,.9)'; ctx.font='700 15px system-ui'; ctx.textAlign='center';
    ctx.fillText(visible ? `Oscuramento stimato/calcolato: ${Math.round(obsc*100)}%` : 'Non visibile dal punto scelto o Sole sotto l’orizzonte', x, y+r+42);
    ctx.textAlign='start';
  }

  function drawLunarDiscSimulation(x,y,t){
    const data = getCachedLocal();
    let obsc = selectedEvent.type==='Totale'?1:selectedEvent.type==='Parziale'?clamp(selectedEvent.magnitude,0,1):0.12;
    let visible = true;
    if(data && data.type==='lunar'){ obsc = data.obscuration ?? obsc; visible = data.visible; }
    const r = Math.min(W,H)*.18;
    drawMoonDisc(x,y,r, selectedEvent.type==='Totale'?'blood':'normal');
    ctx.save(); ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.clip();
    const shadowX = x - r*1.2 + obsc*r*1.9;
    const sg = ctx.createRadialGradient(shadowX,y,0,shadowX,y,r*1.45);
    sg.addColorStop(0,'rgba(55,8,8,.86)'); sg.addColorStop(.55,'rgba(6,8,18,.70)'); sg.addColorStop(1,'rgba(6,8,18,0)');
    ctx.fillStyle=sg; ctx.beginPath(); ctx.arc(shadowX,y,r*1.45,0,Math.PI*2); ctx.fill();
    ctx.restore();
    ctx.fillStyle=visible?'rgba(234,243,255,.84)':'rgba(255,190,175,.9)'; ctx.font='700 15px system-ui'; ctx.textAlign='center';
    ctx.fillText(visible ? `Luna sopra l’orizzonte: ${data && data.altitude != null ? data.altitude.toFixed(1)+'°' : 'da verificare'}` : 'Non visibile: Luna sotto l’orizzonte nel massimo', x, y+r+42);
    ctx.textAlign='start';
  }

  function drawScaleHint(text){
    ctx.save();
    const y = H - (window.innerWidth < 960 ? 300 : 155);
    ctx.font='12px system-ui'; ctx.fillStyle='rgba(234,243,255,.55)';
    ctx.fillText(text, 28, Math.max(120, y));
    ctx.restore();
  }

  function render(now){
    const dt = now - lastTime; lastTime = now;
    if(playing){
      let v = Number(dateSlider.value) + dt/85;
      if(v > MAX_DAYS) v = 0;
      dateSlider.value = String(v);
      updateDateFromSlider(false);
    }
    camera.zoom = parseFloat(zoomSlider.value);
    camera.tilt = deg(parseFloat(tiltSlider.value));
    if(currentView === 'solar') drawSolarSystem(now);
    else if(currentView === 'eclipse') drawEclipseGeometry(now);
    else if(currentView === 'earth') drawEarthView(now);
    else drawObserverView(now);
    requestAnimationFrame(render);
  }

  function updateDateFromSlider(updateCard=true){
    simDate = new Date(START.getTime() + Number(dateSlider.value)*DAY);
    dateOutput.textContent = monthFormatter.format(simDate);
    if(updateCard && currentView==='solar') updateInfoForSystem();
  }
  function setDateTo(date){
    const days = clamp(Math.round((date - START)/DAY),0,MAX_DAYS);
    dateSlider.value = String(days); updateDateFromSlider(false);
  }

  function renderEventList(){
    const data = window.ECLIPSE_DATA.filter(e => filter==='all' || e.kind===filter);
    eventList.innerHTML = '';
    for(const e of data){
      const card = document.createElement('article');
      card.className = 'eventCard' + (selectedEvent.id===e.id ? ' active' : '');
      card.tabIndex = 0;
      card.innerHTML = `
        <div class="eventTop">
          <strong>${e.dateLabel}</strong>
          <span class="tag ${e.kind}">${e.kind==='solar'?'Solare':'Lunare'} · ${e.type}</span>
        </div>
        <div class="eventMeta">${e.visibility}</div>
        <div class="eventStats">
          <span class="miniStat">magn. ${e.magnitude}</span>
          <span class="miniStat">Saros ${e.saros}</span>
          <span class="miniStat">${e.duration}</span>
        </div>`;
      card.addEventListener('click', () => selectEvent(e));
      card.addEventListener('keydown', ev => { if(ev.key==='Enter' || ev.key===' ') selectEvent(e); });
      eventList.appendChild(card);
    }
  }

  function selectEvent(e){
    selectedEvent = e;
    setDateTo(new Date(e.date));
    currentView = 'eclipse';
    updateButtons();
    updateInfoForEvent();
    renderEventList();
    observerPanel.classList.add('visible');
  }

  function updateInfoForSystem(){
    selectedTitle.textContent = 'Sistema solare reale, scala leggibile';
    selectedSubtitle.textContent = 'Le posizioni planetarie sono calcolate con elementi kepleriani JPL; la scala è compressa per vedere tutto in un colpo d’occhio.';
  }
  function updateInfoForEvent(){
    selectedTitle.textContent = `${selectedEvent.kind==='solar'?'Eclisse solare':'Eclisse lunare'} ${selectedEvent.type.toLowerCase()} — ${selectedEvent.dateLabel}`;
    selectedSubtitle.textContent = `Massimo: ${fullDateFormatter.format(new Date(selectedEvent.date))}. Visibilità: ${selectedEvent.visibility}`;
    explainText.innerHTML = `<p><b>Che cosa stai vedendo.</b> ${selectedEvent.kind==='solar' ? 'La Luna passa tra Sole e Terra: dalla vista cosmica si vede l’allineamento, dalla vista terrestre la zona raggiunta da ombra e penombra, dalla vista osservatore il disco solare coperto.' : 'La Terra passa tra Sole e Luna: dalla vista cosmica si vede il cono d’ombra terrestre, dalla vista osservatore la Luna entra nella penombra/ombra e può diventare rossastra.'}</p><p><b>Nota onesta.</b> Le previsioni globali sono prese dai cataloghi NASA. I contatti locali precisi richiedono Astronomy Engine attivo nel browser; se non è disponibile, resta una visualizzazione didattica basata sulle regioni NASA.</p>`;
  }
  function updateButtons(){
    viewButtons.forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
    observerPanel.classList.toggle('visible', currentView === 'observer' || currentView === 'earth' || currentView === 'eclipse');
  }

  function astroAvailable(){ return typeof window.Astronomy !== 'undefined'; }
  function astroTimeToDate(t){
    if(!t) return null;
    if(t.date instanceof Date) return t.date;
    if(typeof t.toDate === 'function') return t.toDate();
    if(typeof t.toString === 'function') return new Date(t.toString());
    return null;
  }
  function eventTime(e){ return e && e.time ? astroTimeToDate(e.time) : null; }
  function kindName(k){
    if(!window.Astronomy || !window.Astronomy.EclipseKind) return String(k);
    const EK = window.Astronomy.EclipseKind;
    if(k === EK.Total) return 'Totale'; if(k === EK.Annular) return 'Anulare'; if(k === EK.Partial) return 'Parziale'; if(k === EK.Penumbral) return 'Penumbrale';
    return String(k);
  }

  async function calculateLocal(){
    const lat = parseFloat(latInput.value), lon = parseFloat(lonInput.value);
    const key = `${selectedEvent.id}:${latInput.value}:${lonInput.value}`;
    if(!Number.isFinite(lat) || !Number.isFinite(lon) || lat<-90 || lat>90 || lon<-180 || lon>180){
      localResult.textContent = 'Coordinate non valide.'; return;
    }
    if(!selectedEvent){ localResult.textContent = 'Seleziona prima un’eclisse.'; return; }

    if(!astroAvailable()){
      const approx = approximateLocalVisibility(selectedEvent, lat, lon);
      localCache.set(key, approx);
      localResult.innerHTML = approx.message;
      return;
    }

    try{
      const Astronomy = window.Astronomy;
      const observer = new Astronomy.Observer(lat, lon, 0);
      const start = new Date(new Date(selectedEvent.date).getTime() - 2*DAY);
      if(selectedEvent.kind === 'solar'){
        const eclipse = Astronomy.SearchLocalSolarEclipse(start, observer);
        const peakDate = eventTime(eclipse.peak);
        const match = peakDate && Math.abs(peakDate - new Date(selectedEvent.date)) < 3*DAY;
        if(!match){
          const approx = {ok:false, type:'solar', visible:false, message:'<b>Non risulta visibile da queste coordinate</b> nel calcolo locale Astronomy Engine. La visualizzazione resta globale/didattica.'};
          localCache.set(key, approx); localResult.innerHTML = approx.message; return;
        }
        const visible = eclipse.peak.altitude > 0;
        const phases = [
          ['inizio parziale', eclipse.partial_begin], ['inizio totalità/anularità', eclipse.total_begin], ['massimo', eclipse.peak], ['fine totalità/anularità', eclipse.total_end], ['fine parziale', eclipse.partial_end]
        ].filter(x=>x[1]).map(([name,ev]) => `${name}: ${formatDateTime(eventTime(ev))}, alt. Sole ${ev.altitude.toFixed(1)}°`).join('<br>');
        const res = {ok:true, type:'solar', visible, obscuration:eclipse.obscuration, message:`<b>${kindName(eclipse.kind)} locale</b> — oscuramento massimo ${(eclipse.obscuration*100).toFixed(1)}%.<br>${visible ? 'Il Sole è sopra l’orizzonte al massimo.' : 'Al massimo il Sole è sotto l’orizzonte: evento non osservabile direttamente.'}<br><br>${phases}`};
        localCache.set(key,res); localResult.innerHTML=res.message;
      } else {
        const eclipse = Astronomy.SearchLunarEclipse(start);
        const peakDate = astroTimeToDate(eclipse.peak);
        const match = peakDate && Math.abs(peakDate - new Date(selectedEvent.date)) < 3*DAY;
        let altitude = null;
        if(match){
          const eq = Astronomy.Equator('Moon', eclipse.peak, observer, true, true);
          const hor = Astronomy.Horizon(eclipse.peak, observer, eq.ra, eq.dec, 'normal');
          altitude = hor.altitude;
        }
        const approxVisible = altitude != null ? altitude > 0 : approximateLocalVisibility(selectedEvent,lat,lon).visible;
        const pen1 = minutesAround(peakDate, -eclipse.sd_penum), pen2 = minutesAround(peakDate, eclipse.sd_penum);
        const par1 = eclipse.sd_partial ? minutesAround(peakDate, -eclipse.sd_partial) : null;
        const par2 = eclipse.sd_partial ? minutesAround(peakDate, eclipse.sd_partial) : null;
        const tot1 = eclipse.sd_total ? minutesAround(peakDate, -eclipse.sd_total) : null;
        const tot2 = eclipse.sd_total ? minutesAround(peakDate, eclipse.sd_total) : null;
        const parts = [`massimo: ${formatDateTime(peakDate)}${altitude!=null ? `, alt. Luna ${altitude.toFixed(1)}°` : ''}`];
        if(pen1&&pen2) parts.push(`fase penombrale: ${formatDateTime(pen1)} → ${formatDateTime(pen2)}`);
        if(par1&&par2) parts.push(`fase parziale: ${formatDateTime(par1)} → ${formatDateTime(par2)}`);
        if(tot1&&tot2) parts.push(`totalità: ${formatDateTime(tot1)} → ${formatDateTime(tot2)}`);
        const res = {ok:match, type:'lunar', visible:approxVisible, altitude, obscuration:eclipse.obscuration ?? (selectedEvent.type==='Totale'?1:clamp(selectedEvent.magnitude,0,1)), message:`<b>${kindName(eclipse.kind)} locale</b> — ${approxVisible ? 'Luna sopra l’orizzonte nel momento chiave.' : 'Luna sotto l’orizzonte nel momento chiave.'}<br><br>${parts.join('<br>')}`};
        localCache.set(key,res); localResult.innerHTML=res.message;
      }
    } catch(err){
      const approx = approximateLocalVisibility(selectedEvent, lat, lon);
      approx.message = `<b>Calcolo preciso non completato.</b> Uso stima regionale NASA.<br>${approx.message}<br><span style="color:#9eb0ca">Dettaglio tecnico: ${String(err.message||err).slice(0,160)}</span>`;
      localCache.set(key, approx); localResult.innerHTML = approx.message;
    }
  }

  function approximateLocalVisibility(e, lat, lon){
    const anchors = (e.regions||[]).map(r=>window.REGION_ANCHORS[r]).filter(Boolean);
    if(!anchors.length) return {ok:false, type:e.kind, visible:false, message:'Non ho abbastanza dati regionali per stimare la visibilità.'};
    const minD = Math.min(...anchors.map(a => haversineKm(lat,lon,a.lat,a.lon)));
    const visible = minD < (e.kind==='solar' ? 4300 : 8200);
    const obsc = e.kind==='solar' ? clamp((1 - minD/5200) * (e.central?.62:.35), .02, e.type==='Totale'? .94 : e.type==='Anulare'? .84 : .42) : (e.type==='Totale'?1:clamp(e.magnitude,0,.9));
    return {ok:false, type:e.kind, visible, obscuration:obsc, message:`<b>Stima regionale</b>: ${visible?'probabilmente visibile':'probabilmente non visibile'} dalle coordinate inserite. Distanza indicativa dalla regione NASA più vicina: ${Math.round(minD)} km.`};
  }
  function haversineKm(lat1,lon1,lat2,lon2){
    const R=6371; const dLat=deg(lat2-lat1), dLon=deg(lon2-lon1);
    const a=Math.sin(dLat/2)**2+Math.cos(deg(lat1))*Math.cos(deg(lat2))*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(a));
  }
  function minutesAround(date, minutes){ return date ? new Date(date.getTime()+minutes*60000) : null; }
  function formatDateTime(date){ return date ? fullDateFormatter.format(date) : '—'; }

  function installEvents(){
    window.addEventListener('resize', resize);
    dateSlider.max = String(MAX_DAYS);
    dateSlider.addEventListener('input', () => updateDateFromSlider());
    zoomSlider.addEventListener('input', () => { camera.zoom = parseFloat(zoomSlider.value); });
    tiltSlider.addEventListener('input', () => { camera.tilt = deg(parseFloat(tiltSlider.value)); });
    playBtn.addEventListener('click', () => { playing = !playing; playBtn.textContent = playing ? '⏸ Pausa' : '▶︎ Anima'; });
    todayBtn.addEventListener('click', () => { playing=false; playBtn.textContent='▶︎ Anima'; setDateTo(START); currentView='solar'; updateButtons(); updateInfoForSystem(); });
    toggleExplain.addEventListener('click', () => { explainText.classList.toggle('collapsed'); });
    viewButtons.forEach(btn => btn.addEventListener('click', () => { currentView = btn.dataset.view; updateButtons(); if(currentView==='solar') updateInfoForSystem(); else updateInfoForEvent(); }));
    filterButtons.forEach(btn => btn.addEventListener('click', () => { filterButtons.forEach(b=>b.classList.remove('active')); btn.classList.add('active'); filter = btn.dataset.filter; renderEventList(); }));
    calcLocalBtn.addEventListener('click', calculateLocal);
    geoBtn.addEventListener('click', () => {
      if(!navigator.geolocation){ localResult.textContent = 'Geolocalizzazione non disponibile in questo browser.'; return; }
      navigator.geolocation.getCurrentPosition(pos => {
        latInput.value = pos.coords.latitude.toFixed(4); lonInput.value = pos.coords.longitude.toFixed(4); calculateLocal();
      }, () => { localResult.textContent = 'Permesso di posizione negato o non disponibile.'; }, {enableHighAccuracy:true, timeout:8000});
    });
    canvas.addEventListener('pointerdown', e => { pointer.down=true; pointer.x=e.clientX; pointer.y=e.clientY; pointer.startRot=camera.rot; pointer.startTilt=camera.tilt; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if(!pointer.down) return;
      const dx=e.clientX-pointer.x, dy=e.clientY-pointer.y;
      camera.rot = pointer.startRot + dx/260;
      camera.tilt = clamp(pointer.startTilt + dy/420, deg(0), deg(78));
      tiltSlider.value = String(Math.round(radToDeg(camera.tilt)));
    });
    canvas.addEventListener('pointerup', e => { pointer.down=false; try{canvas.releasePointerCapture(e.pointerId)}catch{} });
    canvas.addEventListener('wheel', e => { e.preventDefault(); const z=clamp(parseFloat(zoomSlider.value)*(e.deltaY>0?.92:1.08), .55, 2.5); zoomSlider.value=String(z); camera.zoom=z; }, {passive:false});
  }

  function init(){
    resize(); installEvents(); updateDateFromSlider(); renderEventList(); updateInfoForSystem(); updateButtons();
    setTimeout(() => { engineStatus.textContent = astroAvailable() ? 'NASA + Astronomy Engine' : 'NASA + fallback didattico'; }, 1200);
    if('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(()=>{});
    requestAnimationFrame(render);
  }
  init();
})();
