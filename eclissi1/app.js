(() => {
  'use strict';

  const D = window.ECLIPSE_DATA;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const state = {
    filter: 'all', search: '', selected: null, view: 'all', phase: 0.5, playing: false,
    date: new Date('2026-08-12T17:47:05Z'), showOrbits: true, showLabels: true,
    place: {lat: 41.462, lon: 15.544, name: 'Foggia, Italia'},
    installPrompt: null,
    tick: 0,
  };

  const start = new Date(D.range.start);
  const end = new Date(D.range.end);
  const daysRange = Math.round((end-start)/86400000);

  const canvases = {
    star: $('#starCanvas'), cosmos: $('#cosmosCanvas'), earth: $('#earthCanvas'), ground: $('#groundCanvas')
  };
  const ctx = Object.fromEntries(Object.entries(canvases).map(([k,c]) => [k, c.getContext('2d')]));
  const groundImage = new Image();
  groundImage.src = './assets/vista_suolo_modello.jpg';

  function dateIT(d, withTime=false) {
    return new Intl.DateTimeFormat('it-IT', { dateStyle:'long', ...(withTime?{timeStyle:'short', timeZone:'UTC'}:{timeZone:'UTC'}) }).format(d);
  }
  function shortDate(d) { return new Intl.DateTimeFormat('it-IT', { day:'2-digit', month:'short', year:'numeric', timeZone:'UTC' }).format(d); }
  function clamp(x,a,b){ return Math.max(a, Math.min(b, x)); }
  function lerp(a,b,t){ return a + (b-a)*t; }
  function ease(t){ return t<.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2; }
  function rad(deg){ return deg*Math.PI/180; }
  function normLon(lon){ return ((lon+540)%360)-180; }
  function dayOfRange(date){ return clamp(Math.round((date-start)/86400000),0,daysRange); }
  function dateFromDay(n){ return new Date(+start + n*86400000); }
  function eventColor(ev){
    if(ev.type==='lunar') return '#aebcff';
    if(ev.kind==='Totale') return '#e83f45';
    if(ev.kind==='Anulare') return '#ff9a45';
    if(ev.kind==='Ibrida') return '#ffcf70';
    return '#f2d977';
  }
  function typeClass(ev){
    if(ev.type==='lunar') return 'lunar';
    if(ev.kind==='Totale') return 'total';
    if(ev.kind==='Anulare'||ev.kind==='Ibrida') return 'annular';
    return 'partial';
  }

  function resizeCanvas(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(r.width*dpr));
    const h = Math.max(1, Math.floor(r.height*dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width=w; canvas.height=h; }
    const c = canvas.getContext('2d');
    c.setTransform(dpr,0,0,dpr,0,0);
    return {w:r.width, h:r.height, dpr};
  }

  function init() {
    state.selected = D.events[0];
    $('#dateSlider').max = daysRange;
    $('#dateSlider').value = dayOfRange(state.date);
    $('#rangeText').textContent = `${dateIT(start)} → ${dateIT(end)}`;
    renderEvents(); bindUI(); selectEvent(state.selected.id);
    window.addEventListener('resize', renderAll);
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installPrompt = e; $('#installBtn').hidden = false; });
    requestAnimationFrame(loop);
  }

  function bindUI() {
    $$('.modeTabs button').forEach(btn => btn.addEventListener('click', () => { state.filter = btn.dataset.filter; $$('.modeTabs button').forEach(b=>b.classList.toggle('active', b===btn)); renderEvents(); }));
    $('#searchInput').addEventListener('input', e => { state.search = e.target.value.toLowerCase().trim(); renderEvents(); });
    $$('.viewTabs button').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
    $('#phaseSlider').addEventListener('input', e => { state.phase = Number(e.target.value)/1000; state.playing=false; $('#playBtn').textContent='▶'; updatePhaseLabel(); renderAll(); });
    $('#playBtn').addEventListener('click', () => { state.playing = !state.playing; $('#playBtn').textContent = state.playing ? '⏸' : '▶'; });
    $('#resetPhaseBtn').addEventListener('click', () => { state.phase=.5; $('#phaseSlider').value=500; state.playing=false; $('#playBtn').textContent='▶'; updatePhaseLabel(); renderAll(); });
    $('#dateSlider').addEventListener('input', e => { state.date = dateFromDay(Number(e.target.value)); $('#dateOutput').textContent = dateIT(state.date); renderAll(); });
    $('#orbitsToggle').addEventListener('change', e => { state.showOrbits=e.target.checked; renderAll(); });
    $('#labelsToggle').addEventListener('change', e => { state.showLabels=e.target.checked; renderAll(); });
    $('#placeSelect').addEventListener('change', e => { const [lat,lon,...name] = e.target.value.split(','); state.place = {lat:+lat, lon:+lon, name:name.join(',').trim()}; $('#latInput').value=state.place.lat.toFixed(3); $('#lonInput').value=state.place.lon.toFixed(3); updateLocal(); renderAll(); });
    $('#latInput').addEventListener('change', updatePlaceFromInputs);
    $('#lonInput').addEventListener('change', updatePlaceFromInputs);
    $('#geoBtn').addEventListener('click', () => {
      if (!navigator.geolocation) { $('#localBox').textContent='Geolocalizzazione non disponibile nel browser.'; return; }
      navigator.geolocation.getCurrentPosition(pos => { state.place={lat:pos.coords.latitude,lon:pos.coords.longitude,name:'Posizione attuale'}; $('#latInput').value=state.place.lat.toFixed(3); $('#lonInput').value=state.place.lon.toFixed(3); updateLocal(); renderAll(); }, () => { $('#localBox').textContent='Permesso di geolocalizzazione negato o non disponibile.'; });
    });
    $('#centerPathBtn').addEventListener('click', () => {
      const ev = state.selected;
      if (ev.path && ev.path.length) {
        const mid = ev.path[Math.floor(ev.path.length/2)];
        state.place = {lat: mid[0], lon: mid[1], name: 'Fascia centrale'};
        $('#latInput').value = state.place.lat.toFixed(3);
        $('#lonInput').value = state.place.lon.toFixed(3);
        updateLocal(); renderAll();
      } else {
        $('#localBox').innerHTML = '<b>Nessuna fascia centrale</b><br>Questa eclisse è parziale o lunare: non esiste un corridoio di totalità/anularità da raggiungere.';
      }
    });
    $('#explainToggle').addEventListener('click', () => $('#explainBox').classList.toggle('hidden'));
    $('#closeExplain').addEventListener('click', () => $('#explainBox').classList.add('hidden'));
    $('#fullscreenBtn').addEventListener('click', () => { if(!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); });
    $('#installBtn').addEventListener('click', async () => { if(state.installPrompt){ state.installPrompt.prompt(); state.installPrompt=null; $('#installBtn').hidden=true; } });
    window.addEventListener('keydown', e => {
      if(e.key==='ArrowRight') stepEvent(1);
      if(e.key==='ArrowLeft') stepEvent(-1);
      if(e.key===' ') { e.preventDefault(); $('#playBtn').click(); }
    });
  }

  function updatePlaceFromInputs(){
    state.place.lat = clamp(parseFloat($('#latInput').value)||0, -90, 90);
    state.place.lon = clamp(parseFloat($('#lonInput').value)||0, -180, 180);
    state.place.name = 'Coordinate personalizzate';
    updateLocal(); renderAll();
  }

  function setView(v){
    state.view=v; $$('.viewTabs button').forEach(b=>b.classList.toggle('active', b.dataset.view===v));
    document.body.classList.toggle('groundOnly', v==='ground');
    document.body.classList.toggle('cosmosOnly', v==='cosmos');
    document.body.classList.toggle('earthOnly', v==='earth');
    setTimeout(renderAll, 50);
  }

  function filteredEvents(){
    return D.events.filter(ev => (state.filter==='all'||ev.type===state.filter) && (!state.search || `${ev.title} ${ev.kind} ${ev.region} ${ev.note}`.toLowerCase().includes(state.search))).sort((a,b)=>new Date(a.date)-new Date(b.date));
  }
  function renderEvents(){
    const box = $('#eventList'); box.innerHTML='';
    for(const ev of filteredEvents()){
      const b = document.createElement('button'); b.className='eventItem' + (state.selected?.id===ev.id?' active':''); b.dataset.id=ev.id;
      b.innerHTML = `<i class="typeDot ${typeClass(ev)}"></i><div class="eventMeta"><span>${shortDate(new Date(ev.date))}</span><span>${ev.type==='solar'?'solare':'lunare'} · ${ev.kind}</span></div><h3>${ev.title}</h3><p>${ev.region}</p>`;
      b.addEventListener('click', ()=>selectEvent(ev.id)); box.appendChild(b);
    }
  }
  function stepEvent(dir){ const list=filteredEvents(); const i=list.findIndex(e=>e.id===state.selected.id); const next=list[clamp(i+dir,0,list.length-1)]; if(next) selectEvent(next.id); }

  function selectEvent(id){
    state.selected = D.events.find(e=>e.id===id) || D.events[0];
    state.date = new Date(state.selected.date);
    $('#dateSlider').value = dayOfRange(state.date);
    $('#dateOutput').textContent = dateIT(state.date);
    $('#eventTypeLabel').textContent = `Eclisse ${state.selected.type==='solar'?'solare':'lunare'} ${state.selected.kind.toLowerCase()}`;
    $('#eventTitle').textContent = `${shortDate(state.date)} · ${state.selected.title}`;
    $('#eventSubtitle').textContent = state.selected.region;
    $('#magnitudeBadge').textContent = `${state.selected.type==='solar'?'Magnitudine':'Magn. umbrale'} ${state.selected.magnitude}`;
    $('#durationBadge').textContent = `Durata ${state.selected.duration}`;
    updateExplain(); updateLocal(); updatePhaseLabel(); renderEvents(); renderAll();
  }

  function updateExplain(){
    const ev=state.selected;
    $('#explainTitle').textContent = ev.type==='solar' ? 'Dal cono d’ombra al paesaggio' : 'La Luna attraversa l’ombra terrestre';
    $('#explainText').textContent = ev.type==='solar'
      ? `In alto a sinistra vedi l’allineamento Sole–Luna–Terra; sulla Terra la traccia mostra dove passa ombra o antombra. La scena al suolo traduce la fase scelta nella timeline. ${ev.note}`
      : `La Terra si pone tra Sole e Luna. La vista cosmica mostra la Luna che passa nel cono d’ombra terrestre; la vista al suolo rende l’oscuramento e l’arrossamento lunare. ${ev.note}`;
  }

  function updatePhaseLabel(){
    const p=state.phase; let label='Fase massima';
    if(p<.18) label='Inizio'; else if(p<.42) label='Parziale crescente'; else if(p<.58) label='Fase massima'; else if(p<.84) label='Parziale calante'; else label='Fine';
    $('#phaseLabel').textContent=label;
  }

  function localEstimate(ev, place){
    const date = new Date(ev.date);
    const localSolarHours = ((date.getUTCHours()+date.getUTCMinutes()/60) + place.lon/15 + 24) % 24;
    if(ev.type==='lunar'){
      const visible = regionMatch(ev.region, place);
      const p = ev.kind==='Totale' ? 'visibile con totalità, se la Luna è sopra l’orizzonte' : ev.kind==='Parziale' ? 'visibile come oscuramento parziale, se la Luna è sopra l’orizzonte' : 'visibile come lieve penombra, se la Luna è sopra l’orizzonte';
      return {level: visible?0.78:0.35, title: visible?'Visibilità probabile':'Visibilità incerta', text:`${place.name}: ${visible?p:'fuori dalle regioni principali NASA; possibile solo ai margini orari.'} Massimo alle ${date.toISOString().slice(11,16)} UTC. Ora solare locale stimata: ${localSolarHours.toFixed(1)}.`};
    }
    if(ev.path && ev.path.length){
      const d = distanceToPath(place.lat, place.lon, ev.path);
      const central = ev.kind==='Totale'||ev.kind==='Anulare'||ev.kind==='Ibrida';
      let title='Fuori dalla fascia principale', text='La località è lontana dalla fascia centrale; può restare una parzialità debole o nulla.';
      let level=0;
      if(central && d < 1.8){ title = ev.kind==='Totale'?'Nel corridoio di totalità': ev.kind==='Anulare'?'Nel corridoio anulare':'Nel corridoio ibrido'; level=.98; text=`${place.name}: distanza stimata dalla linea centrale ${d.toFixed(1)}°. L’app visualizza la fase centrale al suolo.`; }
      else if(d < 12){ title='Parziale forte'; level=clamp(.75-d/40,.45,.9); text=`${place.name}: vicina alla fascia centrale (${d.toFixed(1)}°). Copertura parziale molto evidente.`; }
      else if(d < 28 || regionMatch(ev.region, place)){ title='Parziale visibile'; level=clamp(.56-d/70,.22,.65); text=`${place.name}: dentro o vicino alla regione di visibilità NASA. Copertura stimata didatticamente, non certificata per contatti locali.`; }
      else if(d < 45){ title='Parziale marginale'; level=.18; text=`${place.name}: ai margini della penombra. Serve una verifica locale precisa.`; }
      return {level,title,text:text+` Massimo globale: ${date.toISOString().slice(11,16)} UTC.`};
    }
    const visible = regionMatch(ev.region, place);
    return {level: visible?.32:.05, title: visible?'Parziale probabile':'Probabilmente non visibile', text:`${place.name}: ${visible?'la regione NASA include quest’area; visualizzazione parziale didattica.':'fuori dalle regioni principali indicate da NASA.'} Massimo globale: ${date.toISOString().slice(11,16)} UTC.`};
  }

  function regionMatch(region, p){
    const r=region.toLowerCase(); const lat=p.lat, lon=p.lon;
    if(r.includes('europa') && lat>34 && lat<72 && lon>-25 && lon<45) return true;
    if(r.includes('africa') && lat>-36 && lat<38 && lon>-20 && lon<55) return true;
    if(r.includes('asia') && lat>-10 && lat<75 && lon>25 && lon<180) return true;
    if(r.includes('medio oriente') && lat>12 && lat<42 && lon>25 && lon<65) return true;
    if(r.includes('america') && lon<-30 && lat>-55 && lat<75) return true;
    if(r.includes('nord america') && lon<-50 && lat>10) return true;
    if(r.includes('sud america') && lon<-30 && lat<15) return true;
    if(r.includes('australia') && lon>110 && lon<160 && lat<-8 && lat>-45) return true;
    if(r.includes('pacifico') && (lon>130 || lon<-120)) return true;
    if(r.includes('artico') && lat>62) return true;
    if(r.includes('antartide') && lat<-60) return true;
    if(r.includes('spagna') && lat>35 && lat<44 && lon>-10 && lon<4) return true;
    if(r.includes('italia') && lat>36 && lat<47 && lon>6 && lon<19) return true;
    if(r.includes('egitto') && lat>21 && lat<32 && lon>24 && lon<37) return true;
    if(r.includes('giappone') && lat>28 && lat<46 && lon>128 && lon<147) return true;
    return false;
  }

  function haversineDeg(aLat,aLon,bLat,bLon){
    const dLat=rad(bLat-aLat), dLon=rad(normLon(bLon-aLon));
    const la1=rad(aLat), la2=rad(bLat);
    const h=Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
    return (2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h))) * 180/Math.PI;
  }
  function distanceToPath(lat, lon, path){
    if(!path.length) return 999;
    let best=999;
    for(let i=0;i<path.length-1;i++){
      const [lat1,lon1]=path[i], [lat2,lon2]=path[i+1];
      for(let t=0;t<=1;t+=.08){ best=Math.min(best,haversineDeg(lat,lon,lerp(lat1,lat2,t),normLon(lerp(lon1,lon2,t)))); }
    }
    return best;
  }

  function updateLocal(){
    const est=localEstimate(state.selected,state.place);
    $('#localBox').innerHTML=`<b>${est.title}</b><br>${est.text}<br><br><small>Nota: la stima locale della PWA è didattica; per contatti al secondo e mappe ufficiali servono le tabelle NASA/GSFC o software astronomico dedicato.</small>`;
    $('#localSummary').textContent=`${state.place.name}: ${est.title.toLowerCase()}.`;
  }

  function loop(ts){
    state.tick = ts/1000;
    if(state.playing){ state.phase += 0.0019; if(state.phase>1) state.phase=0; $('#phaseSlider').value=Math.round(state.phase*1000); updatePhaseLabel(); }
    renderAll();
    requestAnimationFrame(loop);
  }

  function renderAll(){
    renderStars(); renderCosmos(); renderEarth(); renderGround();
  }

  function renderStars(){
    const {w,h}=resizeCanvas(canvases.star); const c=ctx.star; c.clearRect(0,0,w,h);
    c.fillStyle='#03050b'; c.fillRect(0,0,w,h);
    const n=Math.floor(w*h/9500);
    for(let i=0;i<n;i++){
      const x=(Math.sin(i*127.1)*43758.5453%1+1)%1*w;
      const y=(Math.sin(i*311.7)*24634.6345%1+1)%1*h;
      const tw=.45+.55*Math.sin(state.tick*.7+i);
      c.globalAlpha=.25+.55*tw; c.fillStyle=i%17===0?'#ffdba8':'#dfe9ff'; c.fillRect(x,y,i%7===0?1.7:1,i%7===0?1.7:1);
    }
    c.globalAlpha=1;
  }

  function renderCosmos(){
    const {w,h}=resizeCanvas(canvases.cosmos); const c=ctx.cosmos; c.clearRect(0,0,w,h);
    const cx=w*.5, cy=h*.53; const maxR=Math.min(w,h)*.44;
    const grad=c.createRadialGradient(cx,cy,0,cx,cy,Math.max(w,h)); grad.addColorStop(0,'rgba(23,34,55,.54)'); grad.addColorStop(1,'rgba(0,0,0,.05)'); c.fillStyle=grad; c.fillRect(0,0,w,h);
    const tDays=(state.date-new Date('2000-01-01T12:00:00Z'))/86400000;
    const scale = a => Math.log(1+a*1.5)/Math.log(1+39.482*1.5)*maxR;
    const tilt = .54;
    if(state.showOrbits){
      for(const p of D.planets){
        const r=scale(p.a); c.beginPath(); c.ellipse(cx,cy,r,r*tilt,0,0,Math.PI*2); c.strokeStyle=p.name==='Terra'?'rgba(83,169,255,.32)':'rgba(255,255,255,.13)'; c.lineWidth=p.name==='Terra'?1.4:.7; c.stroke();
      }
      // asteroid belt
      c.beginPath(); c.ellipse(cx,cy,scale(2.7),scale(2.7)*tilt,0,0,Math.PI*2); c.setLineDash([1,5]); c.strokeStyle='rgba(255,255,255,.12)'; c.stroke(); c.setLineDash([]);
    }
    // Sun
    const sg=c.createRadialGradient(cx,cy,0,cx,cy,46); sg.addColorStop(0,'#fff5c4'); sg.addColorStop(.22,'#ffcb62'); sg.addColorStop(.55,'#ff7e23'); sg.addColorStop(1,'rgba(255,111,28,0)');
    c.fillStyle=sg; c.beginPath(); c.arc(cx,cy,46,0,Math.PI*2); c.fill();
    c.fillStyle='#ffe8a7'; c.beginPath(); c.arc(cx,cy,12,0,Math.PI*2); c.fill();

    let earthPos=null;
    for(const p of D.planets){
      const theta = 2*Math.PI*((tDays/p.period + p.phase)%1);
      const r=scale(p.a); const x=cx+Math.cos(theta)*r; const y=cy+Math.sin(theta)*r*tilt;
      if(p.name==='Terra') earthPos={x,y,theta};
      c.save(); c.shadowBlur=18; c.shadowColor=p.color; c.fillStyle=p.color; c.beginPath(); c.arc(x,y,p.radius,0,Math.PI*2); c.fill();
      if(p.ring){ c.strokeStyle='rgba(236,212,157,.72)'; c.lineWidth=2; c.beginPath(); c.ellipse(x,y,p.radius*1.8,p.radius*.55,0.18,0,Math.PI*2); c.stroke(); }
      c.restore();
      if(state.showLabels && (p.a<=1.6 || w>420)){ c.fillStyle='rgba(240,244,255,.82)'; c.font='11px system-ui'; c.fillText(p.name, x+8, y-8); }
    }
    const ev=state.selected;
    if(earthPos){
      const moonAngle = ev.type==='solar' ? earthPos.theta + Math.PI + (state.phase-.5)*.85 : earthPos.theta + (state.phase-.5)*.85;
      const mr=38; const mx=earthPos.x+Math.cos(moonAngle)*mr; const my=earthPos.y+Math.sin(moonAngle)*mr*.62;
      c.strokeStyle='rgba(255,255,255,.24)'; c.beginPath(); c.ellipse(earthPos.x,earthPos.y,mr,mr*.62,0,0,Math.PI*2); c.stroke();
      c.fillStyle='#b8bcc8'; c.shadowBlur=12; c.shadowColor='#fff'; c.beginPath(); c.arc(mx,my,4.8,0,Math.PI*2); c.fill(); c.shadowBlur=0;
      // Rays / shadow cone
      c.globalCompositeOperation='lighter';
      const col=ev.type==='solar'?'rgba(255,210,130,.25)':'rgba(95,125,180,.18)';
      c.fillStyle=col; c.beginPath();
      if(ev.type==='solar') { c.moveTo(cx,cy); c.lineTo(mx,my-13); c.lineTo(earthPos.x,earthPos.y+18); c.lineTo(mx,my+13); }
      else { c.moveTo(cx,cy); c.lineTo(earthPos.x,earthPos.y-20); c.lineTo(mx,my); c.lineTo(earthPos.x,earthPos.y+20); }
      c.closePath(); c.fill(); c.globalCompositeOperation='source-over';
      if(state.showLabels){ c.fillStyle='#fff'; c.font='12px system-ui'; c.fillText('Terra', earthPos.x+12, earthPos.y+18); c.fillText('Luna', mx+8, my-8); }
    }
  }

  function projectOrtho(lat, lon, rot, cx, cy, R){
    const la=rad(lat), lo=rad(normLon(lon-rot));
    const cosc=Math.cos(la)*Math.cos(lo);
    return { x:cx+R*Math.cos(la)*Math.sin(lo), y:cy-R*Math.sin(la), visible: cosc>-0.18, cosc };
  }

  function renderEarth(){
    const {w,h}=resizeCanvas(canvases.earth); const c=ctx.earth; c.clearRect(0,0,w,h);
    const cx=w*.5, cy=h*.52, R=Math.min(w,h)*.36;
    const rot = normLon((state.tick*3 + ((state.date-start)/86400000)*.986)%360);
    const bg=c.createLinearGradient(0,0,w,h); bg.addColorStop(0,'rgba(8,18,31,.9)'); bg.addColorStop(1,'rgba(0,0,0,.12)'); c.fillStyle=bg; c.fillRect(0,0,w,h);
    // glow
    const glow=c.createRadialGradient(cx,cy,R*.55,cx,cy,R*1.35); glow.addColorStop(0,'rgba(40,110,180,.12)'); glow.addColorStop(.75,'rgba(54,146,255,.18)'); glow.addColorStop(1,'rgba(54,146,255,0)'); c.fillStyle=glow; c.beginPath(); c.arc(cx,cy,R*1.36,0,Math.PI*2); c.fill();
    c.save(); c.beginPath(); c.arc(cx,cy,R,0,Math.PI*2); c.clip();
    const ocean=c.createRadialGradient(cx-R*.25,cy-R*.3,R*.1,cx,cy,R); ocean.addColorStop(0,'#2c88c7'); ocean.addColorStop(.62,'#0a386a'); ocean.addColorStop(1,'#061128'); c.fillStyle=ocean; c.fillRect(cx-R,cy-R,R*2,R*2);
    // pseudo continents
    drawContinents(c,cx,cy,R,rot);
    // night terminator
    const lx = Math.cos(rad((new Date(state.selected.date).getUTCHours()/24)*360))*R*.36;
    const night=c.createLinearGradient(cx+lx-R,0,cx+lx+R,0); night.addColorStop(0,'rgba(0,0,0,.62)'); night.addColorStop(.44,'rgba(0,0,0,.22)'); night.addColorStop(.66,'rgba(255,255,255,.04)'); night.addColorStop(1,'rgba(255,255,255,.10)'); c.fillStyle=night; c.fillRect(cx-R,cy-R,R*2,R*2);
    // grid
    c.strokeStyle='rgba(255,255,255,.12)'; c.lineWidth=.6;
    for(let lat=-60;lat<=60;lat+=30){ c.beginPath(); for(let lon=-180;lon<=180;lon+=5){ const p=projectOrtho(lat,lon,rot,cx,cy,R); if(p.visible){ if(lon===-180)c.moveTo(p.x,p.y); else c.lineTo(p.x,p.y);} } c.stroke(); }
    for(let lon=-180;lon<180;lon+=30){ c.beginPath(); let started=false; for(let lat=-85;lat<=85;lat+=3){ const p=projectOrtho(lat,lon,rot,cx,cy,R); if(p.visible){ if(!started){c.moveTo(p.x,p.y); started=true;} else c.lineTo(p.x,p.y);} } c.stroke(); }
    // eclipse path
    drawEclipseOnEarth(c,cx,cy,R,rot,state.selected);
    // observer
    const op=projectOrtho(state.place.lat,state.place.lon,rot,cx,cy,R);
    if(op.visible){ c.fillStyle='#fff'; c.shadowBlur=18; c.shadowColor='#fff'; c.beginPath(); c.arc(op.x,op.y,4,0,Math.PI*2); c.fill(); c.shadowBlur=0; c.fillStyle='#fff'; c.font='11px system-ui'; c.fillText(state.place.name.split(',')[0], op.x+8, op.y-6); }
    c.restore();
    c.strokeStyle='rgba(210,235,255,.45)'; c.lineWidth=1.2; c.beginPath(); c.arc(cx,cy,R,0,Math.PI*2); c.stroke();
    c.fillStyle='rgba(230,235,246,.72)'; c.font='12px system-ui'; c.fillText(state.selected.type==='solar'?'Traccia dell’ombra/antombra':'Zone dove la Luna è sopra l’orizzonte', 18, h-20);
  }

  function drawContinents(c,cx,cy,R,rot){
    const blobs = [
      {name:'America N', pts:[[70,-160],[60,-130],[50,-105],[35,-95],[20,-105],[10,-85],[25,-70],[45,-62],[62,-80]]},
      {name:'America S', pts:[[12,-82],[0,-76],[-15,-72],[-32,-64],[-52,-70],[-42,-55],[-20,-45],[0,-50]]},
      {name:'Europa-Africa', pts:[[58,-10],[45,10],[32,30],[15,42],[-10,35],[-34,20],[-28,5],[-5,-10],[15,-18],[35,-8]]},
      {name:'Asia', pts:[[65,35],[55,70],[45,105],[55,140],[35,150],[15,112],[5,80],[20,55],[35,35]]},
      {name:'Australia', pts:[[-12,112],[-22,130],[-35,145],[-42,132],[-30,112]]},
      {name:'Greenland', pts:[[82,-55],[72,-30],[62,-42],[66,-70]]},
      {name:'Antarctica', pts:[[-68,-180],[-72,-90],[-70,0],[-74,90],[-68,180],[-84,180],[-84,-180]]}
    ];
    for(const b of blobs){
      c.beginPath(); let started=false;
      for(const [lat,lon] of b.pts){ const p=projectOrtho(lat,lon,rot,cx,cy,R); if(p.visible){ if(!started){c.moveTo(p.x,p.y); started=true;} else c.lineTo(p.x,p.y); } }
      if(started){ c.closePath(); c.fillStyle='rgba(80,140,96,.72)'; c.fill(); c.strokeStyle='rgba(200,255,210,.11)'; c.stroke(); }
    }
    // cloud bands
    c.strokeStyle='rgba(255,255,255,.13)'; c.lineWidth=6; c.lineCap='round';
    for(let j=0;j<4;j++){ c.beginPath(); let s=false; const lat=-35+j*22+Math.sin(state.tick*.25+j)*4; for(let lon=-180;lon<=180;lon+=7){ const p=projectOrtho(lat+Math.sin((lon+j*40)/30)*5,lon+state.tick*2,rot,cx,cy,R); if(p.visible){ if(!s){c.moveTo(p.x,p.y); s=true;} else c.lineTo(p.x,p.y); } } c.stroke(); }
  }

  function drawEclipseOnEarth(c,cx,cy,R,rot,ev){
    if(ev.type==='solar'){
      if(ev.path && ev.path.length){
        // penumbra corridor
        c.lineCap='round'; c.lineJoin='round';
        drawPath(c,cx,cy,R,rot,ev.path,'rgba(255,210,110,.24)',34);
        drawPath(c,cx,cy,R,rot,ev.path,ev.kind==='Totale'?'rgba(190,36,44,.76)':ev.kind==='Anulare'?'rgba(255,128,44,.8)':'rgba(255,206,100,.8)',8);
        // moving shadow dot
        const path=ev.path; const idx=(path.length-1)*state.phase; const i=Math.floor(idx); const t=idx-i; const a=path[i], b=path[Math.min(i+1,path.length-1)];
        if(a&&b){ const lat=lerp(a[0],b[0],t), lon=normLon(lerp(a[1],b[1],t)); const p=projectOrtho(lat,lon,rot,cx,cy,R); if(p.visible){ const g=c.createRadialGradient(p.x,p.y,0,p.x,p.y,46); g.addColorStop(0,'rgba(0,0,0,.78)'); g.addColorStop(.18,'rgba(80,0,0,.38)'); g.addColorStop(1,'rgba(255,190,80,0)'); c.fillStyle=g; c.beginPath(); c.arc(p.x,p.y,50,0,Math.PI*2); c.fill(); c.fillStyle='#fff1c8'; c.beginPath(); c.arc(p.x,p.y,3.5,0,Math.PI*2); c.fill(); } }
      } else {
        // partial cap
        const center = guessPartialCenter(ev.region);
        const p=projectOrtho(center[0],center[1],rot,cx,cy,R);
        if(p.visible){ const g=c.createRadialGradient(p.x,p.y,10,p.x,p.y,R*.75); g.addColorStop(0,'rgba(246,211,108,.28)'); g.addColorStop(1,'rgba(246,211,108,0)'); c.fillStyle=g; c.beginPath(); c.arc(p.x,p.y,R*.75,0,Math.PI*2); c.fill(); }
      }
    } else {
      // lunar visibility: show broad night-side arc and shadow diagram
      c.fillStyle='rgba(122,142,255,.16)'; c.beginPath(); c.arc(cx,cy,R*.92,rad(200),rad(20),false); c.lineWidth=18; c.strokeStyle='rgba(170,185,255,.22)'; c.stroke();
      const y=cy-R*.2; c.fillStyle='rgba(95,40,25,.58)'; c.beginPath(); c.arc(cx,y,R*.28,0,Math.PI*2); c.fill();
      const x=lerp(cx-R*.42,cx+R*.42,state.phase); c.fillStyle=ev.kind==='Totale'?'rgba(202,82,55,.88)':ev.kind==='Parziale'?'rgba(220,162,118,.9)':'rgba(210,210,230,.92)'; c.shadowBlur=18; c.shadowColor='#fff'; c.beginPath(); c.arc(x,y,R*.095,0,Math.PI*2); c.fill(); c.shadowBlur=0;
    }
  }
  function drawPath(c,cx,cy,R,rot,path,color,width){
    c.beginPath(); let started=false;
    for(const [lat,lon] of path){ const p=projectOrtho(lat,lon,rot,cx,cy,R); if(p.visible){ if(!started){c.moveTo(p.x,p.y); started=true;} else c.lineTo(p.x,p.y); } else started=false; }
    c.strokeStyle=color; c.lineWidth=width; c.stroke();
  }
  function guessPartialCenter(region){
    const r=region.toLowerCase();
    if(r.includes('antartide')) return [-72,40]; if(r.includes('artico')) return [72,20]; if(r.includes('asia')) return [42,90]; if(r.includes('america')) return [25,-85]; if(r.includes('cile')||r.includes('argentina')) return [-45,-70]; if(r.includes('australia')) return [-34,145]; return [20,0];
  }

  function renderGround(){
    const {w,h}=resizeCanvas(canvases.ground); const c=ctx.ground; c.clearRect(0,0,w,h);
    const ev=state.selected; const p=state.phase; const maxness=1-Math.min(1,Math.abs(p-.5)*2);
    // Background inspired by provided image: actual uploaded model image as base + cinematic overlays.
    if(groundImage.complete && groundImage.naturalWidth){
      const ir=groundImage.naturalWidth/groundImage.naturalHeight, cr=w/h; let dw,dh,dx,dy;
      if(ir>cr){ dh=h; dw=h*ir; dx=(w-dw)/2; dy=0; } else { dw=w; dh=w/ir; dx=0; dy=(h-dh)/2; }
      c.drawImage(groundImage,dx,dy,dw,dh);
    } else {
      const sky=c.createLinearGradient(0,0,0,h); sky.addColorStop(0,'#171d2d'); sky.addColorStop(.48,'#d77a35'); sky.addColorStop(.72,'#6d3325'); sky.addColorStop(1,'#07090f'); c.fillStyle=sky; c.fillRect(0,0,w,h);
    }
    // overlays for more realistic atmosphere
    c.fillStyle=`rgba(0,0,0,${ev.type==='solar'?0.12+maxness*.46:0.52})`; c.fillRect(0,0,w,h);
    const warm=c.createRadialGradient(w*.55,h*.37,0,w*.55,h*.52,w*.9); warm.addColorStop(0,`rgba(255,169,75,${ev.type==='solar'?0.20*(1-maxness):0.03})`); warm.addColorStop(.55,'rgba(255,126,45,.08)'); warm.addColorStop(1,'rgba(0,0,0,.22)'); c.fillStyle=warm; c.fillRect(0,0,w,h);
    // subtle haze and sea reflection
    c.fillStyle='rgba(255,190,110,.08)'; for(let i=0;i<9;i++){ c.fillRect(0,h*(.58+i*.03),w,1); }

    if(ev.type==='solar') drawSolarGround(c,w,h,ev,p,maxness); else drawLunarGround(c,w,h,ev,p,maxness);
    // dynamic foreground darkening
    const fg=c.createLinearGradient(0,h*.58,0,h); fg.addColorStop(0,'rgba(0,0,0,0)'); fg.addColorStop(1,'rgba(0,0,0,.62)'); c.fillStyle=fg; c.fillRect(0,h*.58,w,h*.42);
  }

  function drawSolarGround(c,w,h,ev,p,maxness){
    const est=localEstimate(ev,state.place);
    const localLevel = est.level;
    const kind = ev.kind;
    const sx=w*.52, sy=h*.23 + (kind==='Totale' && ev.id==='s2026-08-12'?h*.035:0);
    const sr=Math.min(w,h)*(kind==='Parziale'?0.07:0.085);
    const moonScale = kind==='Anulare'?0.86:kind==='Parziale'?1.02:1.06;
    const mr=sr*moonScale;
    const travel=(p-.5)*sr*3.0;
    const offsetY = kind==='Parziale' ? sr*.58 : 0;
    const mx=sx+travel, my=sy+offsetY*Math.sin((p-.5)*Math.PI);
    // localLevel modifies max coverage: if place far from path, draw partial rather than total even for central event
    const effectiveCentral = localLevel>.92;
    const visibleMax = kind==='Parziale' || localLevel<.92 ? clamp(localLevel || .25, .12, .82) : 1;
    const phaseCoverage = maxness * visibleMax;
    // corona / sun
    const darkAtMax = phaseCoverage;
    const coronaStrength = (effectiveCentral && kind!=='Anulare') ? Math.pow(maxness,3) : Math.pow(maxness,2)*.22;
    const glare=c.createRadialGradient(sx,sy,0,sx,sy,sr*8); glare.addColorStop(0,`rgba(255,245,196,${0.70*(1-darkAtMax)+0.15})`); glare.addColorStop(.08,`rgba(255,191,96,${0.55*(1-darkAtMax)+0.07})`); glare.addColorStop(.28,`rgba(255,121,49,${0.18*(1-darkAtMax)+0.04})`); glare.addColorStop(1,'rgba(255,150,60,0)'); c.fillStyle=glare; c.beginPath(); c.arc(sx,sy,sr*8,0,Math.PI*2); c.fill();
    if(coronaStrength>.02){ const cg=c.createRadialGradient(sx,sy,sr*.82,sx,sy,sr*3.8); cg.addColorStop(0,`rgba(255,255,230,${.55*coronaStrength})`); cg.addColorStop(.22,`rgba(255,233,194,${.30*coronaStrength})`); cg.addColorStop(.55,`rgba(170,190,255,${.08*coronaStrength})`); cg.addColorStop(1,'rgba(255,255,255,0)'); c.fillStyle=cg; c.beginPath(); c.arc(sx,sy,sr*4,0,Math.PI*2); c.fill(); }
    // sun disk
    c.fillStyle='#ffd17d'; c.beginPath(); c.arc(sx,sy,sr,0,Math.PI*2); c.fill();
    // Moon position adjusted for local partial: at maximum not perfectly centered if not central
    const localOffset = effectiveCentral?0:sr*(1.35-visibleMax*.95);
    const mx2=mx + localOffset*maxness;
    c.save();
    c.globalCompositeOperation='source-over';
    const mg=c.createRadialGradient(mx2-mr*.35,my-mr*.35,mr*.2,mx2,my,mr*1.2); mg.addColorStop(0,'#232323'); mg.addColorStop(.55,'#050505'); mg.addColorStop(1,'#000'); c.fillStyle=mg; c.beginPath(); c.arc(mx2,my,mr,0,Math.PI*2); c.fill();
    // annular ring refinement
    if(kind==='Anulare' && maxness>.82 && localLevel>.8){ c.globalCompositeOperation='destination-over'; c.fillStyle='#ffcc76'; c.beginPath(); c.arc(sx,sy,sr,0,Math.PI*2); c.fill(); c.globalCompositeOperation='source-over'; }
    c.restore();
    // bright ring edge
    if(maxness>.75){
      c.strokeStyle=kind==='Anulare'?'rgba(255,196,98,.95)':'rgba(255,236,200,.75)'; c.lineWidth=kind==='Anulare'?Math.max(2,sr*.12):Math.max(1.2,sr*.035); c.beginPath(); c.arc(sx,sy,sr*(kind==='Anulare'?1.01:1.02),0,Math.PI*2); c.stroke();
      if(effectiveCentral && kind==='Totale'){ const da=rad(210 + Math.sin(state.tick*2)*14); const dx=sx+Math.cos(da)*sr*.95, dy=sy+Math.sin(da)*sr*.95; const dg=c.createRadialGradient(dx,dy,0,dx,dy,sr*.9); dg.addColorStop(0,'rgba(255,244,210,.9)'); dg.addColorStop(.16,'rgba(255,196,93,.55)'); dg.addColorStop(1,'rgba(255,196,93,0)'); c.fillStyle=dg; c.beginPath(); c.arc(dx,dy,sr*.9,0,Math.PI*2); c.fill(); }
    }
    // labels
    drawGroundHud(c,w,h,`${kind} · copertura locale stimata ${(visibleMax*100).toFixed(0)}%`, est.title);
  }

  function drawLunarGround(c,w,h,ev,p,maxness){
    // night transform
    c.fillStyle='rgba(1,4,18,.62)'; c.fillRect(0,0,w,h);
    const mx=w*.52, my=h*.27, r=Math.min(w,h)*.09;
    const x=mx+lerp(-r*1.2,r*1.2,p); const y=my;
    // Earth shadow
    const sh=c.createRadialGradient(mx,my,r*.2,mx,my,r*2.2); sh.addColorStop(0,'rgba(50,8,0,.68)'); sh.addColorStop(.5,'rgba(20,0,0,.35)'); sh.addColorStop(1,'rgba(0,0,0,0)'); c.fillStyle=sh; c.beginPath(); c.arc(mx,my,r*2.1,0,Math.PI*2); c.fill();
    let moonColor='#e8e0d0'; if(ev.kind==='Totale') moonColor=`rgba(${lerp(235,168,maxness)},${lerp(224,68,maxness)},${lerp(204,40,maxness)},1)`; else if(ev.kind==='Parziale') moonColor=`rgba(230,${lerp(225,160,maxness)},${lerp(210,125,maxness)},1)`;
    c.shadowBlur=24; c.shadowColor='rgba(255,240,220,.55)'; c.fillStyle=moonColor; c.beginPath(); c.arc(x,y,r,0,Math.PI*2); c.fill(); c.shadowBlur=0;
    // shadow bite
    if(ev.kind!=='Penumbrale') { c.fillStyle=`rgba(20,4,0,${.55*maxness})`; c.beginPath(); c.arc(mx,my,r*1.18,0,Math.PI*2); c.fill(); }
    // details
    c.globalAlpha=.28; c.fillStyle='#7e6e62'; for(let i=0;i<12;i++){ const a=i*1.7; c.beginPath(); c.arc(x+Math.cos(a)*r*.42, y+Math.sin(a*1.4)*r*.36, r*(.04+(i%3)*.015),0,Math.PI*2); c.fill(); } c.globalAlpha=1;
    drawGroundHud(c,w,h,`${ev.kind} · magnitudine ${ev.magnitude}`, 'Luna nell’ombra terrestre');
  }

  function drawGroundHud(c,w,h,line1,line2){
    c.save();
    const x=w-270, y=h-96; const ww=244, hh=70;
    c.fillStyle='rgba(7,10,17,.54)'; roundRect(c,x,y,ww,hh,16); c.fill();
    c.strokeStyle='rgba(255,255,255,.16)'; c.stroke();
    c.fillStyle='#ffe0b7'; c.font='700 14px system-ui'; c.fillText(line1,x+14,y+25);
    c.fillStyle='rgba(237,241,249,.84)'; c.font='12px system-ui'; wrapText(c,line2,x+14,y+46,ww-28,15);
    c.restore();
  }
  function roundRect(c,x,y,w,h,r){ c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }
  function wrapText(c,text,x,y,maxWidth,lineHeight){ const words=text.split(' '); let line=''; for(const word of words){ const test=line+word+' '; if(c.measureText(test).width>maxWidth && line){ c.fillText(line,x,y); line=word+' '; y+=lineHeight; } else line=test; } c.fillText(line,x,y); }

  init();
})();
