/* 纸上涟漪 — ripples on paper.
   A sheet of paper behaves like still water: every glyph you write sends ring
   waves that refract the paper and ink beneath. Written from scratch; the water
   maths follows the same analytic ring-wave model as the reference piece. */
(() => {
  "use strict";
  const canvas = document.getElementById('water');
  const sheet  = document.getElementById('sheet');
  const countEl = document.getElementById('count');
  const freshBtn = document.getElementById('fresh');
  const soundBtn = document.getElementById('sound');
  const soundText = document.getElementById('soundText');
  const papersEl = document.getElementById('papers');
  const paperName = document.getElementById('paperName');
  const sealEl = document.getElementById('seal');
  const root = document.documentElement;
  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');

  const T0 = performance.now();
  const now = () => (performance.now() - T0) / 1000;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const MAXR = 64, LIFE = 4.6;

  const seg = (typeof Intl !== 'undefined' && Intl.Segmenter)
    ? new Intl.Segmenter('zh', { granularity: 'grapheme' }) : null;
  const graphemes = s => seg ? Array.from(seg.segment(s), x => x.segment) : Array.from(s);
  const isBlank = g => /^\s+$/.test(g);
  const isPunct = g => /[\p{P}\p{S}]/u.test(g);

  /* plaintext-only fallback for browsers without it */
  if (sheet.contentEditable !== 'plaintext-only') {
    sheet.setAttribute('contenteditable', 'true');
    sheet.addEventListener('paste', e => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
  }

  /* ---------------------------------------------------------------------------
     Background papers. Each drives both the DOM colours and the paper shader.
  --------------------------------------------------------------------------- */
  const PAPERS = [
    { id:'xuan', name:'宣纸', swatch:'#eceee8',
      paper:'#eceee8', fiber:'#d3d6cc', ink:'#1f2429', inkSoft:'#5f6763', seal:'#b03a2c', onSeal:'#f6f2ea',
      dark:0, fiberAmt:.55, cloudAmt:.55, grain:.014, gold:'#b8912f', goldAmt:0 },
    { id:'bamboo', name:'竹纸', swatch:'#e9dfc6',
      paper:'#e9dfc6', fiber:'#cdbd97', ink:'#2a2419', inkSoft:'#6b6146', seal:'#b03a2c', onSeal:'#f6f2ea',
      dark:0, fiberAmt:.72, cloudAmt:.6, grain:.016, gold:'#b8912f', goldAmt:0 },
    { id:'gold', name:'洒金笺', swatch:'linear-gradient(135deg,#e7dcc0,#d8c49a)',
      paper:'#e7dcc0', fiber:'#d3c197', ink:'#241f16', inkSoft:'#6a5f43', seal:'#b03a2c', onSeal:'#f6f2ea',
      dark:0, fiberAmt:.5, cloudAmt:.55, grain:.014, gold:'#c39a3a', goldAmt:.8 },
    { id:'mulberry', name:'皮纸', swatch:'#d8c2a0',
      paper:'#d8c2a0', fiber:'#bda075', ink:'#2a2016', inkSoft:'#6f5c40', seal:'#a83a2c', onSeal:'#f6f2ea',
      dark:0, fiberAmt:.85, cloudAmt:.66, grain:.02, gold:'#b8912f', goldAmt:0 },
    { id:'indigo', name:'瓷青纸', swatch:'linear-gradient(135deg,#16283a,#22405a)',
      paper:'#16283a', fiber:'#22405a', ink:'#e6cf8f', inkSoft:'#9fb0bd', seal:'#c9503f', onSeal:'#16283a',
      dark:1, fiberAmt:.5, cloudAmt:.5, grain:.01, gold:'#d4af5a', goldAmt:.35 },
    { id:'night', name:'夜笺', swatch:'#101418',
      paper:'#101418', fiber:'#1d252b', ink:'#dde2db', inkSoft:'#8b948f', seal:'#c9503f', onSeal:'#101418',
      dark:1, fiberAmt:.55, cloudAmt:.55, grain:.01, gold:'#b8912f', goldAmt:0 },
  ];
  const hex = v => { v = v.trim().replace('#',''); if (v.length===3) v = v.replace(/./g,c=>c+c);
    const n = parseInt(v,16); return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255]; };
  const C = {};
  let preset = PAPERS[0];

  function applyPreset(p, { sound = true } = {}) {
    preset = p;
    root.style.setProperty('--paper', p.paper);
    root.style.setProperty('--fiber', p.fiber);
    root.style.setProperty('--ink', p.ink);
    root.style.setProperty('--ink-soft', p.inkSoft);
    root.style.setProperty('--seal', p.seal);
    root.style.setProperty('--on-seal', p.onSeal);
    root.style.colorScheme = p.dark ? 'dark' : 'light';
    C.paper = hex(p.paper); C.fiber = hex(p.fiber); C.ink = hex(p.ink); C.inkCss = p.ink;
    C.gold = hex(p.gold); C.dark = p.dark; C.fiberAmt = p.fiberAmt; C.cloudAmt = p.cloudAmt;
    C.grain = p.grain; C.goldAmt = p.goldAmt;
    paperName.textContent = p.name;
    for (const chip of papersEl.querySelectorAll('.chip'))
      chip.setAttribute('aria-pressed', String(chip.dataset.id === p.id));
    try { localStorage.setItem('ripple.paper', p.id); } catch (e) {}
    if (gl) { makePaper(); queueText(); draw(); }
    if (sound) Sound.paper();
  }

  /* ---------------------------------------------------------------------------
     Rendering path: WebGL2 water, or a plain static sheet if WebGL is missing.
  --------------------------------------------------------------------------- */
  let gl = null;
  try { gl = canvas.getContext('webgl2', { alpha:false, antialias:false, premultipliedAlpha:true }); } catch (e) {}
  const hasGL = !!gl;
  if (!hasGL) root.classList.add('no-gl');
  else sheet.classList.add('traced');

  const VS = `#version 300 es
  void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p*2.-1.,0.,1.); }`;

  const NOISE = `
  float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
  float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }`;

  // Rice paper, generated once per size/preset: pulp clouds, fibres, grain, gold flecks.
  const PAPER_FS = `#version 300 es
  precision highp float;
  uniform float uDpr; uniform vec3 uPaper, uFiber, uGold; uniform float uDark;
  uniform float uFiberAmt, uCloudAmt, uGrain, uGoldAmt;
  out vec4 o;
  ${NOISE}
  float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*noise(p); p=p*2.07+13.1; a*=.5; } return s; }
  void main(){
    vec2 px = gl_FragCoord.xy / uDpr;
    float cloud = fbm(px*.006)*.65 + fbm(px*.024+7.)*.35;
    float fib = 0.;
    for(int i=0;i<4;i++){
      float a = float(i)*1.37+.3;
      vec2 q = mat2(cos(a),-sin(a),sin(a),cos(a))*px + float(i)*91.7;
      float n = noise(q*vec2(.05,1.1));
      float gate = noise(q*.015+3.);
      fib += smoothstep(.83,.97,n)*smoothstep(.45,.8,gate);
    }
    float grain = hash(floor(px*1.5))-.5;
    vec3 col = mix(uPaper, uFiber, clamp((cloud-.32)*1.2,0.,1.)*uCloudAmt);
    col = mix(col, uFiber, clamp(fib,0.,1.)*uFiberAmt);
    if(uGoldAmt>0.){
      vec2 c = floor(px*.35);
      float h = hash(c+7.3), h2 = hash(c*1.7+2.1);
      float fleck = smoothstep(.985,1.,h)*(.45+.55*h2);
      col = mix(col, uGold, clamp(fleck,0.,1.)*uGoldAmt);
    }
    col += grain*uGrain;
    o = vec4(col,1.);
  }`;

  // The water: analytic ring waves, refraction of paper + ink, light and glints.
  const MAIN_FS = `#version 300 es
  precision highp float;
  #define MAXR ${MAXR}
  uniform vec2 uCss; uniform float uDpr, uTime;
  uniform vec4 uRip[MAXR]; uniform int uCount;
  uniform vec4 uSheet;
  uniform sampler2D uPaperTex, uTextTex;
  uniform vec3 uInk; uniform float uDark;
  out vec4 o;
  ${NOISE}
  void main(){
    vec2 px = vec2(gl_FragCoord.x, uCss.y*uDpr - gl_FragCoord.y)/uDpr;   // CSS px, y down
    vec2 g = vec2(0.);
    const float C = 135.;              // ring speed px/s
    const float K = 6.2831853/26.;     // wavelength 26px
    for(int i=0;i<MAXR;i++){
      if(i>=uCount) break;
      vec4 R = uRip[i];
      float t = uTime - R.z;
      if(t<=0.) continue;
      vec2 d = px - R.xy;
      float r = length(d);
      float w = 12. + 30.*t;
      float x = r - C*t;
      if(abs(x) > 3.*w) continue;
      float env = exp(-x*x/(w*w));
      float amp = R.w*exp(-1.1*t)*smoothstep(0.,.05,t)*inversesqrt(1.+r*.03);
      float s = sin(K*x), c = cos(K*x);
      float dh = amp*env*(K*c - 2.*x/(w*w)*s);
      g += dh*(d/max(r,1e-3))*smoothstep(0.,5.,r);
    }
    vec2 off = -g*11.;
    vec2 uvP = (gl_FragCoord.xy + vec2(off.x,-off.y)*uDpr)/vec2(textureSize(uPaperTex,0));
    vec3 col = texture(uPaperTex, uvP).rgb;
    vec2 uvT = (px + off - uSheet.xy)/uSheet.zw;
    if(all(greaterThanEqual(uvT,vec2(0.))) && all(lessThanEqual(uvT,vec2(1.)))){
      vec4 tx = texture(uTextTex, uvT);
      vec2 e = 1.3/uSheet.zw;
      float halo = (texture(uTextTex,uvT+vec2(e.x,0.)).a + texture(uTextTex,uvT-vec2(e.x,0.)).a
                  + texture(uTextTex,uvT+vec2(0.,e.y)).a + texture(uTextTex,uvT-vec2(0.,e.y)).a)*.25;
      col = mix(col, uInk, halo*.16);
      col = col*(1.-tx.a) + tx.rgb;
    }
    vec3 n = normalize(vec3(-g*1.4,1.));
    vec3 L = normalize(vec3(-.5,-.62,.72));
    float diff = dot(n,L) - L.z;
    vec3 H = normalize(L+vec3(0.,0.,1.));
    float spec = max(pow(max(dot(n,H),0.),90.) - pow(H.z,90.), 0.);
    if(uDark>.5){ col *= 1.+diff*1.1; col += diff*.07 + vec3(.72,.8,.9)*spec*1.1; }
    else { col *= 1.+diff*.75; col += spec*.22; }
    vec2 q = gl_FragCoord.xy/(uCss*uDpr)-.5;
    col *= 1.-.07*dot(q,q)*2.2;
    col += (hash(gl_FragCoord.xy+fract(uTime)*61.)-.5)/255.;
    o = vec4(col,1.);
  }`;

  let paperProg, mainProg, paperTex, textTex, fbo;
  let W=1, H=1, cssW=1, cssH=1, sheetBox=[0,0,1,1];

  if (hasGL) {
    const compile = (type, src) => { const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const program = fs => { const p=gl.createProgram();
      gl.attachShader(p,compile(gl.VERTEX_SHADER,VS)); gl.attachShader(p,compile(gl.FRAGMENT_SHADER,fs)); gl.linkProgram(p);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u={}, n=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);
      for(let i=0;i<n;i++){ const name=gl.getActiveUniform(p,i).name.replace(/\[0\]$/,''); u[name]=gl.getUniformLocation(p,name); }
      return {p,u}; };
    try { paperProg=program(PAPER_FS); mainProg=program(MAIN_FS); }
    catch(err){ console.warn('shader failed, static sheet', err); gl=null; root.classList.add('no-gl'); sheet.classList.remove('traced'); }
  }

  if (gl) {
    const makeTex = () => { const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4)); return t; };
    paperTex=makeTex(); textTex=makeTex(); fbo=gl.createFramebuffer();
  }

  function makePaper() {
    if (!gl) return;
    gl.bindTexture(gl.TEXTURE_2D, paperTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,W,H,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, paperTex, 0);
    gl.viewport(0,0,W,H);
    gl.useProgram(paperProg.p);
    const u = paperProg.u;
    gl.uniform1f(u.uDpr, W/cssW);
    gl.uniform3fv(u.uPaper, C.paper); gl.uniform3fv(u.uFiber, C.fiber); gl.uniform3fv(u.uGold, C.gold);
    gl.uniform1f(u.uDark, C.dark); gl.uniform1f(u.uFiberAmt, C.fiberAmt); gl.uniform1f(u.uCloudAmt, C.cloudAmt);
    gl.uniform1f(u.uGrain, C.grain); gl.uniform1f(u.uGoldAmt, C.goldAmt);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function resize() {
    cssW = Math.max(1, canvas.clientWidth); cssH = Math.max(1, canvas.clientHeight);
    if (!gl) { draw(); return; }
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    W = Math.max(1, Math.round(cssW*dpr)); H = Math.max(1, Math.round(cssH*dpr));
    if (canvas.width!==W) canvas.width=W;
    if (canvas.height!==H) canvas.height=H;
    sheetBox = [0,0,cssW,cssH];
    makePaper(); queueText(); draw();
  }

  /* ---------- Trace each glyph from the live layout into a texture ---------- */
  const tcan = document.createElement('canvas');
  const tctx = tcan.getContext('2d');
  const rng = document.createRange();
  const pickRect = r => { const rs=r.getClientRects(); for(const x of rs) if(x.width>0) return x; return rs[0]||null; };
  let textQueued = false;
  function queueText() {
    if (!gl || textQueued) return;
    textQueued = true;
    requestAnimationFrame(() => { textQueued=false; renderText(); draw(); });
  }
  function renderText() {
    if (!gl) return;
    if (tcan.width!==W || tcan.height!==H) { tcan.width=W; tcan.height=H; }
    tctx.setTransform(1,0,0,1,0,0); tctx.clearRect(0,0,W,H);
    tctx.setTransform(W/cssW,0,0,H/cssH,0,0);
    const cs = getComputedStyle(sheet);
    tctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    tctx.fillStyle = C.inkCss; tctx.textBaseline = 'alphabetic';
    const asc = tctx.measureText('永').fontBoundingBoxAscent || parseFloat(cs.fontSize)*0.88;
    const cr = canvas.getBoundingClientRect();
    const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
    for (let node=walker.nextNode(); node; node=walker.nextNode()) {
      let i=0;
      for (const g of graphemes(node.data)) {
        if (!isBlank(g)) {
          rng.setStart(node,i); rng.setEnd(node,i+g.length);
          const r = pickRect(rng);
          if (r && r.bottom>cr.top-40 && r.top<cr.top+cssH+40) tctx.fillText(g, r.left-cr.left, r.top-cr.top+asc);
        }
        i += g.length;
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, textTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,tcan);
  }

  /* ---------- Ripples ---------- */
  let ripples = [];
  const ripArr = new Float32Array(MAXR*4);
  let raf = 0;
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
  function tick() { raf=0; draw(); if (ripples.length) kick(); }
  function drop(x, y, s, delayMs=0) {
    if (!gl) return;
    if (reduceMQ.matches) s *= 0.35;
    ripples.push({ x:x+(Math.random()-.5)*2, y:y+(Math.random()-.5)*2, t:now()+delayMs/1000, s });
    if (ripples.length>MAXR) ripples.splice(0, ripples.length-MAXR);
    kick();
  }
  function draw() {
    if (!gl) return;
    const t = now();
    ripples = ripples.filter(r => t-r.t < LIFE);
    ripArr.fill(0);
    ripples.forEach((r,i)=>{ ripArr[i*4]=r.x; ripArr[i*4+1]=r.y; ripArr[i*4+2]=r.t; ripArr[i*4+3]=r.s; });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0,0,W,H);
    const u = mainProg.u;
    gl.useProgram(mainProg.p);
    gl.uniform4fv(u.uRip, ripArr); gl.uniform1i(u.uCount, ripples.length);
    gl.uniform1f(u.uTime, t);
    gl.uniform2f(u.uCss, cssW, cssH); gl.uniform1f(u.uDpr, W/cssW);
    gl.uniform4f(u.uSheet, sheetBox[0], sheetBox[1], Math.max(1,sheetBox[2]), Math.max(1,sheetBox[3]));
    gl.uniform3fv(u.uInk, C.ink); gl.uniform1f(u.uDark, C.dark);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, paperTex); gl.uniform1i(u.uPaperTex,0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, textTex); gl.uniform1i(u.uTextTex,1);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.activeTexture(gl.TEXTURE0);
  }

  /* ---------- Where did the ink land? ---------- */
  let lastPt = null;
  const local = (x,y) => { const cr=canvas.getBoundingClientRect(); return { x:x-cr.left, y:y-cr.top }; };
  function caretPoint() {
    const sel = getSelection();
    if (!sel.rangeCount || !sheet.contains(sel.focusNode)) return lastPt;
    const r = sel.getRangeAt(0).cloneRange(); r.collapse(false);
    const rs = r.getClientRects();
    const rect = rs.length ? rs[rs.length-1] : null;
    if (rect && rect.height>0) return (lastPt = local(rect.left, rect.top+rect.height/2));
    // Line-break carets have no client rect and sit in their own "\n" node — measure with a marker.
    const m = measureCaretMarker();
    if (m) return (lastPt = m);
    const n=r.endContainer, o=r.endOffset;
    if (n.nodeType===3 && o>0) {
      const prev=n.data[o-1]; r.setStart(n,o-1);
      const b=pickRect(r);
      if (b) {
        if (prev==='\n') {
          const cs=getComputedStyle(sheet), sb=sheet.getBoundingClientRect();
          return (lastPt = local(sb.left+parseFloat(cs.paddingLeft), b.top+b.height/2+parseFloat(cs.lineHeight)));
        }
        return (lastPt = local(b.right, b.top+b.height/2));
      }
    }
    return lastPt;
  }
  function measureCaretMarker() {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    const caret = sel.getRangeAt(0).cloneRange(); caret.collapse(false);
    const marker = document.createElement('span'); marker.textContent = '';
    caret.insertNode(marker);
    const rect = marker.getBoundingClientRect();
    const restore = document.createRange(); restore.setStartBefore(marker); restore.collapse(true);
    marker.remove();
    sel.removeAllRanges(); sel.addRange(restore);
    return rect.height ? local(rect.left, rect.top + rect.height/2) : null;
  }
  function pointsOf(node, from, text) {
    const pts=[]; let i=from;
    for (const g of graphemes(text)) {
      if (!isBlank(g)) { rng.setStart(node,i); rng.setEnd(node,i+g.length);
        const b=pickRect(rng); if (b) pts.push({ p:local(b.left+b.width/2, b.top+b.height/2), g }); }
      i += g.length;
    }
    return pts;
  }
  function insertedPoints(text) {
    const sel = getSelection();
    if (!sel.rangeCount) return [];
    const r = sel.getRangeAt(0), node=r.endContainer, off=r.endOffset;
    if (node.nodeType===3 && off>=text.length && node.data.slice(off-text.length,off)===text)
      return pointsOf(node, off-text.length, text);
    return [];
  }
  function splash(text) {
    if (!text) return;
    let pts = insertedPoints(text);
    if (!pts.length) {
      const p = caretPoint();
      if (p) { drop(p.x, p.y, graphemes(text).every(isBlank)?0.45:0.9); Sound.text(text, p.x); }
      return;
    }
    if (pts.length>24) pts = pts.slice(-24);
    const step = pts.length>1 ? Math.min(70, 1400/pts.length) : 0;
    pts.forEach((it,k) => { drop(it.p.x, it.p.y, 0.8+Math.random()*0.3, k*step); Sound.text(it.g, it.p.x, k*step/1000); });
  }

  /* ---------------------------------------------------------------------------
     Sound — real-time Web Audio, one sound per glyph, tuned to a pentatonic set.
  --------------------------------------------------------------------------- */
  const Sound = (() => {
    const DATA = window.SFX_DATA || {};
    let ctx=null, master=null, verb=null, wetBus=null, buffers=null, decoding=false, opened=false;
    let enabled = true;
    try { enabled = localStorage.getItem('ripple.sound') !== '0'; } catch (e) {}
    let voices=0; const MAXV=28;
    let lastDrop=-1, charN=0;
    const SCALE = [587.33,659.25,739.99,880,987.77,1174.66,1318.51,1479.98,1760,1975.53,2349.32,2637.02];
    const PHRASE = [7,5,9,7,5,4,2];
    const STRESSED = new Set([1,3,5,6]);

    const b64ToBuf = b64 => { const bin=atob(b64); const a=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i); return a.buffer; };
    const normalize = buf => { let m=0; for(let c=0;c<buf.numberOfChannels;c++){ const d=buf.getChannelData(c);
      for(let i=0;i<d.length;i++){ const v=Math.abs(d[i]); if(v>m) m=v; } }
      if(m>0){ const g=0.98/m; for(let c=0;c<buf.numberOfChannels;c++){ const d=buf.getChannelData(c); for(let i=0;i<d.length;i++) d[i]*=g; } } return buf; };

    function makeIR(seconds, rt60) {
      const rate=ctx.sampleRate, n=Math.floor(seconds*rate), pre=Math.floor(0.015*rate);
      const ir=ctx.createBuffer(2,n,rate);
      for(let c=0;c<2;c++){ const d=ir.getChannelData(c); let energy=0;
        for(let i=0;i<n;i++){ const t=i/rate; let v=(Math.random()*2-1)*Math.exp(-6.91*t/rt60); d[i]=v; }
        for(let pass=0;pass<3;pass++){ let prev=0; for(let i=0;i<n;i++){ const cur=d[i]; d[i]=prev*0.65+cur*0.35; prev=d[i]; } }
        for(let i=0;i<pre;i++) d[i]=0;
        for(let i=0;i<n;i++) energy+=d[i]*d[i];
        const norm=1/Math.sqrt(energy||1); for(let i=0;i<n;i++) d[i]*=norm;
      }
      return ir;
    }

    async function decodeAll() {
      if (decoding || buffers) return; decoding=true;
      const out={};
      const one = async obj => ({ hz:obj.hz||0, buf: normalize(await ctx.decodeAudioData(b64ToBuf(obj.b))) });
      try {
        out.drop = await Promise.all((DATA.drop||[]).map(one));
        out.bubble = await Promise.all((DATA.bubble||[]).map(one));
        out.brush = await Promise.all((DATA.brush||[]).map(one));
        out.pencil = await Promise.all((DATA.pencil||[]).map(one));
        for (const k of ['round','plop','dark','sparkle','twodrip','splash','stamp_a','stamp_b'])
          if (DATA[k]) out[k] = await one(DATA[k]);
        buffers = out;
      } catch (e) { console.warn('audio decode failed', e); }
      decoding=false;
    }

    function ensure() {
      if (ctx) { if (ctx.state==='suspended') ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      verb = ctx.createConvolver(); verb.buffer = makeIR(1.1, 0.9);
      wetBus = ctx.createGain(); wetBus.gain.value = 0.4; verb.connect(wetBus); wetBus.connect(master);
      decodeAll();
      if (enabled && !opened) { opened=true; setTimeout(()=>play(buffers&&buffers.round,{rate:0.9,gain:0.3,wet:0.5}), 60); }
    }

    function play(entry, { rate=1, gain=1, pan=0, wet=0.12, when=0 }={}) {
      if (!enabled || !ctx || !entry || !entry.buf || voices>=MAXV) return;
      const t = ctx.currentTime + Math.max(0, when);
      const src = ctx.createBufferSource(); src.buffer = entry.buf;
      src.playbackRate.value = clamp(rate, 0.25, 4);
      try { src.preservesPitch=false; src.mozPreservesPitch=false; src.webkitPreservesPitch=false; } catch (e) {}
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(g);
      let node = g;
      if (ctx.createStereoPanner) { const p=ctx.createStereoPanner(); p.pan.value=clamp(pan,-1,1); g.connect(p); node=p; }
      node.connect(master);
      if (wet>0) { const w=ctx.createGain(); w.gain.value=wet; node.connect(w); w.connect(verb); }
      voices++; src.onended = () => { voices=Math.max(0,voices-1); };
      src.start(t);
    }

    const panOf = x => clamp(x/Math.max(1,cssW)*2-1, -1, 1)*0.6;
    const pick = arr => arr && arr.length ? arr[(Math.random()*arr.length)|0] : null;
    function tuned(target) {
      const bank = buffers && buffers.drop; if (!bank || !bank.length) return null;
      let best=-1, bd=1e9;
      for (let i=0;i<bank.length;i++){ if(i===lastDrop) continue; const d=Math.abs(Math.log2(bank[i].hz/target)); if(d<bd){bd=d;best=i;} }
      if (best<0) best=0; lastDrop=best;
      return { buf:bank[best].buf, rate: target/bank[best].hz };
    }
    function charSound(x, when) {
      const deg = PHRASE[charN % PHRASE.length];
      const d = tuned(SCALE[deg]); if (!d) return;
      const loud = STRESSED.has(charN % 7);
      play(d, { rate:d.rate, gain:loud?0.5:0.34, pan:panOf(x), wet:0.14, when });
      play(pick(buffers.brush), { gain:0.11, pan:panOf(x), wet:0.1, when });
      charN++;
    }
    function punctSound(x, when) {
      play(pick(buffers.pencil), { gain:0.5, pan:panOf(x), wet:0.05, when });
      const d = tuned(SCALE[10]); if (d) play(d, { rate:d.rate, gain:0.2, pan:panOf(x), wet:0.1, when });
    }
    function sheetSplash() {
      play(buffers.splash, { gain:0.5, wet:0.5 });
      play(buffers.round, { rate:0.85, gain:0.3, when:0.18, wet:0.6 });
    }

    return {
      ensure,
      get enabled() { return enabled; },
      toggle() { enabled=!enabled; try{localStorage.setItem('ripple.sound', enabled?'1':'0');}catch(e){}
        if (enabled) { ensure(); play(buffers&&buffers.round,{rate:1.1,gain:0.25,wet:0.3}); } return enabled; },
      text(txt, x, when=0) {
        if (!enabled || !ctx || !buffers) return;
        const gs = graphemes(txt).filter(g=>!isBlank(g));
        if (!gs.length) { play(buffers.plop,{rate:1.5,gain:0.1,pan:panOf(x),wet:0.1,when}); return; }
        const cap = gs.slice(0, 8);
        cap.forEach((g,k)=>{ const w=when+k*0.05; if(isPunct(g)) punctSound(x,w); else charSound(x,w); });
      },
      newline(x) { if(!enabled||!ctx||!buffers) return; const p=panOf(x);
        play(buffers.sparkle,{gain:0.4,pan:p,wet:0.5}); play(buffers.round,{rate:0.9,gain:0.3,pan:p,wet:0.4}); charN=0; },
      space(x) { if(!enabled||!ctx||!buffers) return; play(buffers.plop,{rate:1.5,gain:0.12,pan:panOf(x),wet:0.1}); },
      del(x) { if(!enabled||!ctx||!buffers) return; play(buffers.dark,{gain:0.4,pan:panOf(x),wet:0.3}); },
      tap(x) { if(!enabled||!ctx||!buffers) return; play(buffers.plop,{gain:0.4,pan:panOf(x),wet:0.3}); },
      fresh() { if(!enabled||!ctx||!buffers) return; sheetSplash(); charN=0; },
      paper() { if(!enabled||!ctx||!buffers) return; sheetSplash(); },
      stamp(x) { if(!enabled||!ctx||!buffers) return; const p=panOf(x);
        play(buffers.stamp_a,{gain:0.5,pan:p,wet:0.25}); play(buffers.plop,{rate:0.8,gain:0.35,when:0.01,pan:p,wet:0.6}); },
    };
  })();

  /* ---------- Interaction ---------- */
  function wireRipples() {
    let lastCompEnd = -1e9;
    sheet.addEventListener('input', e => {
      queueText();
      const it = e.inputType || '';
      if (e.isComposing || it==='insertCompositionText') { const p=caretPoint(); if(p) drop(p.x,p.y,0.22); return; }
      if (it==='insertFromComposition') return;
      if (it==='insertText' && performance.now()-lastCompEnd<80) return;
      if (it.startsWith('delete')) { const p=caretPoint(); if(p){ drop(p.x,p.y,-0.6); Sound.del(p.x); } return; }
      if (it==='insertParagraph' || it==='insertLineBreak') { const p=caretPoint(); if(p){ drop(p.x,p.y,1.5); Sound.newline(p.x); } return; }
      const txt = e.data != null ? e.data : (e.dataTransfer ? e.dataTransfer.getData('text/plain') : '');
      if (txt) splash(txt);
      else { const p=caretPoint(); if(p){ drop(p.x,p.y,0.9); Sound.text(' ', p.x); } }
    });
    sheet.addEventListener('compositionend', e => {
      lastCompEnd = performance.now();
      if (e.data) requestAnimationFrame(() => splash(e.data));
    });
    sheet.addEventListener('pointerdown', e => { Sound.ensure(); const p=local(e.clientX,e.clientY); drop(p.x,p.y,0.55); Sound.tap(p.x); });
    sheet.addEventListener('keydown', () => Sound.ensure(), { once:true });
    sheet.addEventListener('scroll', queueText, { passive:true });
  }

  /* ---------- Count, focus, new sheet, paper, sound, seal ---------- */
  function updateCount() {
    if (document.activeElement !== sheet) { countEl.textContent = '点一下纸面，开始写字'; return; }
    const n = graphemes(sheet.textContent).filter(g=>!isBlank(g)).length;
    countEl.textContent = `已写 ${n} 字`;
  }
  function wireUI() {
    sheet.addEventListener('input', updateCount);
    sheet.addEventListener('focus', updateCount);
    sheet.addEventListener('blur', updateCount);

    freshBtn.addEventListener('click', () => {
      Sound.ensure();
      sheet.textContent = ''; sheet.scrollTop = 0; sheet.focus(); updateCount();
      if (gl) { queueText(); drop(cssW/2, cssH*0.42, 2.4); setTimeout(()=>drop(cssW/2, cssH*0.42, -1.2), 380); }
      Sound.fresh();
    });

    for (const p of PAPERS) {
      const chip = document.createElement('button');
      chip.type='button'; chip.className='chip'; chip.dataset.id=p.id;
      chip.style.setProperty('--sw', p.swatch);
      chip.title = p.name; chip.setAttribute('aria-label', '背景纸：'+p.name);
      chip.setAttribute('aria-pressed', 'false');
      chip.addEventListener('click', () => { Sound.ensure(); applyPreset(p); });
      papersEl.appendChild(chip);
    }

    const syncSound = () => { const on=Sound.enabled; soundBtn.classList.toggle('on',on);
      soundBtn.setAttribute('aria-pressed', String(on)); soundText.textContent = on?'音效':'静音'; };
    soundBtn.addEventListener('click', () => { Sound.toggle(); syncSound(); });
    syncSound();

    const doStamp = () => { Sound.ensure(); const r=sealEl.getBoundingClientRect(); const p=local(r.left+r.width/2, r.top+r.height/2);
      drop(p.x, p.y, 1.6); setTimeout(()=>drop(p.x,p.y,-0.8),260); Sound.stamp(p.x); };
    sealEl.addEventListener('click', doStamp);
    sealEl.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' '){ e.preventDefault(); doStamp(); } });
  }

  /* ---------- Boot ---------- */
  wireUI();
  let saved = 'xuan';
  try { saved = localStorage.getItem('ripple.paper') || 'xuan'; } catch (e) {}
  applyPreset(PAPERS.find(p=>p.id===saved) || PAPERS[0], { sound:false });

  wireRipples();
  if (gl) { new ResizeObserver(resize).observe(canvas); }
  resize();
  window.addEventListener('resize', () => { if(!gl) resize(); });
  document.fonts.addEventListener('loadingdone', queueText);

  // Opening: the poem settles onto the water one character at a time.
  let introDone = false;
  function intro() {
    if (introDone) return; introDone = true;
    queueText();
    if (!gl || reduceMQ.matches) return;
    const pts = [];
    const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
    for (let node=walker.nextNode(); node; node=walker.nextNode()) pts.push(...pointsOf(node,0,node.data));
    pts.slice(0,36).forEach((it,i)=>drop(it.p.x, it.p.y, 0.7, 200+i*85));
  }
  document.fonts.ready.then(intro);
  setTimeout(intro, 1500);
})();