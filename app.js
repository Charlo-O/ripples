/* 纸上涟漪 — ripples on paper.
   A sheet of paper behaves like still water: every glyph you write sends ring
   waves that refract the paper and ink beneath. Written from scratch; the water
   maths follows the same analytic ring-wave model as the reference piece.
   Every motion comes from the materials — water, ink, paper, seal — and stays quiet. */
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
  const reduced = () => reduceMQ.matches;

  const T0 = performance.now();
  const now = () => (performance.now() - T0) / 1000;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const ease = k => k * k * (3 - 2 * k);
  const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  const MAXR = 64, LIFE = 4.6;
  // One bamboo slip per column of writing: width = the column pitch, offset so seams fall between columns.
  let slipW = 34, slipOff = 0;
  const vertical = () => root.classList.contains('vertical');

  // Each kind of touch makes its own water: wavelength px, speed px/s, start width px, damping 1/s.
  const KINDS = {
    char:    [26, 135, 12, 1.1],
    punct:   [15, 112,  8, 1.6],
    newline: [44, 104, 18, 0.85],
    seal:    [34, 118, 16, 0.95],
    trail:   [13, 140,  6, 2.0],
    drip:    [17, 122,  8, 1.4],
    bubble:  [11,  88,  5, 2.0],
    idle:    [30, 116, 14, 1.0],
    wide:    [50, 126, 22, 0.8],
  };
  for (const k in KINDS) KINDS[k][0] = 6.2831853 / KINDS[k][0];

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
      dark:0, fiberAmt:.55, cloudAmt:.55, grain:.014, gold:'#b8912f', goldAmt:0,
      thin:.55, deckle:1, stiff:.85 },
    { id:'bamboo', name:'竹纸', swatch:'#e9dfc6',
      paper:'#e9dfc6', fiber:'#cdbd97', ink:'#2a2419', inkSoft:'#6b6146', seal:'#b03a2c', onSeal:'#f6f2ea',
      dark:0, fiberAmt:.72, cloudAmt:.6, grain:.016, gold:'#b8912f', goldAmt:0,
      thin:.42, deckle:.8, stiff:.95 },
    // Bamboo slips: strips laid side by side and bound with two cords. Rolled up and unrolled, never turned.
    { id:'slips', name:'竹简', swatch:'repeating-linear-gradient(90deg,#d8bf8a 0 4px,#7d6040 4px 5px)', slip:true,
      paper:'#d8bf8a', fiber:'#b39361', ink:'#2b1d10', inkSoft:'#6b583c', seal:'#a8392b', onSeal:'#f6f2ea',
      gap:'#4a3824', cord:'#5e4630', bare:'#4d3e2c',
      dark:0, fiberAmt:0, cloudAmt:0, grain:.016, gold:'#b8912f', goldAmt:0 },
    { id:'gold', name:'洒金笺', swatch:'linear-gradient(135deg,#e7dcc0,#d8c49a)',
      paper:'#e7dcc0', fiber:'#d3c197', ink:'#241f16', inkSoft:'#6a5f43', seal:'#b03a2c', onSeal:'#f6f2ea',
      dark:0, fiberAmt:.5, cloudAmt:.55, grain:.014, gold:'#c39a3a', goldAmt:.8,
      thin:.3, deckle:.35, stiff:1.05 },
    { id:'mulberry', name:'皮纸', swatch:'#d8c2a0',
      paper:'#d8c2a0', fiber:'#bda075', ink:'#2a2016', inkSoft:'#6f5c40', seal:'#a83a2c', onSeal:'#f6f2ea',
      dark:0, fiberAmt:.85, cloudAmt:.66, grain:.02, gold:'#b8912f', goldAmt:0,
      thin:.38, deckle:1.4, stiff:1 },
    { id:'indigo', name:'瓷青纸', swatch:'linear-gradient(135deg,#16283a,#22405a)',
      paper:'#16283a', fiber:'#22405a', ink:'#e6cf8f', inkSoft:'#9fb0bd', seal:'#c9503f', onSeal:'#16283a',
      dark:1, fiberAmt:.5, cloudAmt:.5, grain:.01, gold:'#d4af5a', goldAmt:.35,
      thin:.1, deckle:0, stiff:1.3 },
    { id:'night', name:'夜笺', swatch:'#101418',
      paper:'#101418', fiber:'#1d252b', ink:'#dde2db', inkSoft:'#8b948f', seal:'#c9503f', onSeal:'#101418',
      dark:1, fiberAmt:.55, cloudAmt:.55, grain:.01, gold:'#b8912f', goldAmt:0,
      thin:.14, deckle:.2, stiff:1.15 },
  ];
  // How a sheet behaves out of the water: how much writing shows through it, how ragged
  // its deckled edge is (毛边; 0 = trimmed clean), and how stiffly it bends.
  const matOf = p => [p.thin || 0, p.deckle || 0, p.stiff || 1];
  const hex = v => { v = v.trim().replace('#',''); if (v.length===3) v = v.replace(/./g,c=>c+c);
    const n = parseInt(v,16); return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255]; };
  const C = {};
  let preset = PAPERS[0];   // the paper in the water
  let chosen = PAPERS[0];   // the paper the picker shows (may still be on its way)

  function setColors(p) { glColors(p); cssColors(p); }
  function glColors(p) {
    preset = p;
    C.paper = hex(p.paper); C.fiber = hex(p.fiber); C.gold = hex(p.gold);
    C.dark = p.dark; C.fiberAmt = p.fiberAmt; C.cloudAmt = p.cloudAmt; C.grain = p.grain; C.goldAmt = p.goldAmt;
    C.seal = hex(p.seal); C.inkTo = hex(p.ink);
    C.slip = p.slip ? 1 : 0; C.gap = hex(p.gap || p.fiber); C.cord = hex(p.cord || p.fiber);
    if (!C.inkShown) C.inkShown = C.inkTo;
  }
  function cssColors(p) {
    root.style.setProperty('--paper', p.paper);
    root.style.setProperty('--fiber', p.fiber);
    root.style.setProperty('--ink', p.ink);
    root.style.setProperty('--ink-soft', p.inkSoft);
    root.style.setProperty('--seal', p.seal);
    root.style.setProperty('--on-seal', p.onSeal);
    root.style.colorScheme = p.dark ? 'dark' : 'light';
    root.classList.toggle('slips', !!p.slip);
  }
  // Slips are written top to bottom; returns true when the layout flipped.
  function setLayout(p) {
    const v = !!p.slip;
    if (vertical() === v) return false;
    root.classList.toggle('vertical', v);
    sheet.scrollTop = 0; sheet.scrollLeft = 0;
    markLayout();
    return true;
  }
  function measureSlips() {
    if (!vertical()) return;
    const cs = getComputedStyle(sheet);
    slipW = parseFloat(cs.lineHeight) || 34;
    const r = sheet.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
    const right = r.left - cr.left + sheet.clientWidth - parseFloat(cs.paddingRight);   // first column's right edge
    slipOff = ((right % slipW) + slipW) % slipW;
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
  // Alpha carries the fleck mask so the water can make the gold glint.
  const PAPER_FS = `#version 300 es
  precision highp float;
  uniform float uDpr; uniform vec3 uPaper, uFiber, uGold; uniform float uDark;
  uniform float uFiberAmt, uCloudAmt, uGrain, uGoldAmt;
  uniform float uSlip, uSlipOff, uH; uniform vec3 uGap, uCord; uniform vec2 uSeed;
  out vec4 o;
  ${NOISE}
  float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*noise(p); p=p*2.07+13.1; a*=.5; } return s; }
  // Bamboo slips: each strip its own tone, grain running its length, rounded edges, dark seams, two cords.
  vec3 slips(vec2 px){
    float sx = (px.x - uSlipOff)/uSlip, i = floor(sx), e = min(fract(sx), 1.-fract(sx))*uSlip;   // px to the strip's edge
    float h1 = hash(vec2(i, 3.7 + uSeed.x)), h2 = hash(vec2(i, 9.1 + uSeed.y));
    vec3 col = uPaper*(.93 + .11*h1);
    col = mix(col, uFiber, .22*h2);
    float g = noise(vec2(px.x*.9, px.y*.011 + i*17. + uSeed.y))*.6 + noise(vec2(px.x*2.3, px.y*.035 + i*5.))*.4;
    col = mix(col, uFiber, smoothstep(.56, .92, g)*.6);
    float st = fbm(vec2(px.x*.03 + i*3.1, px.y*.004 + uSeed.x));
    col = mix(col, uFiber*.82, smoothstep(.55, .78, st)*.42);
    col *= mix(.8, 1., smoothstep(.4, 3.5, e));
    col = mix(col, uGap, (1. - smoothstep(.2, .95, e))*.85);
    float yt = uH - px.y;
    for(int k=0;k<2;k++){
      float dy = yt - uH*(k==0 ? .1 : .88), ad = abs(dy), cw = 3.2;
      col *= 1. - .32*smoothstep(cw + 5., cw, abs(dy - 1.8));                 // the cord's shadow
      float tw = fract((px.x - dy*1.7)*.14);                                   // twist of the hemp
      vec3 rope = uCord*(.72 + .55*smoothstep(0., .45, tw)*smoothstep(1., .55, tw))*(1.08 - .38*ad/cw);
      col = mix(col, rope, 1. - smoothstep(cw - .7, cw + .3, ad));
    }
    return col;
  }
  void main(){
    vec2 px = gl_FragCoord.xy / uDpr;
    if(uSlip > 0.){ o = vec4(slips(px) + (hash(floor(px*1.5))-.5)*uGrain, 0.); return; }
    px += uSeed;                                   // each new sheet has its own clouds and fibres
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
    float fleck = 0.;
    if(uGoldAmt>0.){
      vec2 c = floor(px*.35);
      float h = hash(c+7.3), h2 = hash(c*1.7+2.1);
      fleck = clamp(smoothstep(.985,1.,h)*(.45+.55*h2),0.,1.)*uGoldAmt;
      col = mix(col, uGold, fleck);
    }
    col += grain*uGrain;
    o = vec4(col, fleck);
  }`;

  // The water: analytic ring waves, refraction of paper + ink, light and glints.
  // During a paper change the old sheet is turned like a book page from its top-left
  // corner (a cylinder curl along uDir), uncovering the new sheet lying beneath it.
  // On 换一张纸 a new sheet is laid on top instead: it comes down from the bottom-right
  // corner, the line where it meets the water sweeping up to the top-left; ahead of that
  // line it is still in the air, bending up over a cylinder and rising at an angle.
  // Out of the water a sheet shows what it is made of: a deckled or clean-cut edge, a dry,
  // lighter face, gold leaf flashing as it bends. Once down, water soaks in from the line it
  // landed on, the writing beneath shows through for a moment, and pockets of air are caught.
  const MAIN_FS = `#version 300 es
  precision highp float;
  #define MAXR ${MAXR}
  uniform vec2 uCss; uniform float uDpr, uTime;
  uniform vec4 uRip[MAXR]; uniform vec4 uRipB[MAXR]; uniform int uCount;
  uniform sampler2D uPaperTex, uPaperOld, uTextTex, uTextOld;
  uniform vec3 uInk, uInkOld, uSeal, uGold;
  uniform float uDark, uSlosh, uPaperFade, uOldInkA;
  uniform float uTurn, uFold, uRad, uBulge, uTurnFresh; uniform vec2 uDir;
  uniform float uRoll, uUnder, uSlip, uSlipOff; uniform vec4 uRollA, uRollB; uniform vec3 uBare;
  uniform float uLay, uLayF, uLayR, uLayTh, uSoak;
  uniform vec3 uMatOld, uMatNew;                   // thin, deckle, stiff — of the old and the new sheet
  uniform vec4 uBub[6]; uniform int uBubN;         // air caught under a new sheet: x, y, radius, height
  out vec4 o;
  ${NOISE}
  const float PI = 3.14159265;

  vec4 paperAt(sampler2D t, vec2 p){ return texture(t, vec2(p.x, uCss.y - p.y)/uCss); }
  // r = ink, g = seal paste, b = soft halo of the ink
  vec3 inkAt(sampler2D t, vec2 p, float spread){
    vec2 uv = p/uCss;
    if(any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.)))) return vec3(0.);
    vec2 e = spread/uCss;
    float halo = (texture(t, uv+vec2(e.x,0.)).r + texture(t, uv-vec2(e.x,0.)).r
                + texture(t, uv+vec2(0.,e.y)).r + texture(t, uv-vec2(0.,e.y)).r)*.25;
    return vec3(texture(t, uv).rg, halo);
  }
  vec3 putInk(vec3 col, vec3 k, vec3 ink, float bleed){
    col = mix(col, ink, k.z*bleed);
    col = mix(col, uSeal, k.y*.9);
    return mix(col, ink, k.x);
  }
  vec2 waves(vec2 px){
    vec2 g = vec2(0.);
    for(int i=0;i<MAXR;i++){
      if(i>=uCount) break;
      vec4 R = uRip[i], B = uRipB[i];          // B: wavenumber, speed, start width, damping
      float t = uTime - R.z;
      if(t<=0.) continue;
      vec2 d = px - R.xy;
      float r = length(d);
      float w = B.z + 30.*t;
      float x = r - B.y*t;
      if(abs(x) > 3.*w) continue;
      float env = exp(-x*x/(w*w));
      float amp = R.w*exp(-B.w*t)*smoothstep(0.,.05,t)*inversesqrt(1.+r*.03);
      float s = sin(B.x*x), c = cos(B.x*x);
      float dh = amp*env*(B.x*c - 2.*x/(w*w)*s);
      g += dh*(d/max(r,1e-3))*smoothstep(0.,5.,r);
    }
    g.y += uSlosh*.12*cos(px.y*.02 + px.x*.004 - uTime*2.4);   // the tray rocking after a scroll
    return g;
  }
  float inPage(vec2 q, float w){
    return smoothstep(-w,0.,q.x)*smoothstep(-w,0.,uCss.x-q.x)*smoothstep(-w,0.,q.y)*smoothstep(-w,0.,uCss.y-q.y);
  }
  // How much of a sheet out of the water covers q (in the sheet's own coordinates). Handmade
  // paper has a deckled edge: wavy, thinning to loose fibres, a few hairs standing past it;
  // dk = 0 is a clean cut. y: how far inside the edge q is.
  vec2 sheetCov(vec2 q, float dk){
    vec4 e = vec4(q.x, uCss.x - q.x, q.y, uCss.y - q.y);
    float m = min(min(e.x, e.y), min(e.z, e.w));
    float side = m == e.x ? 0. : m == e.y ? 1. : m == e.z ? 2. : 3.;
    float along = side < 1.5 ? q.y : q.x;
    float wav = noise(vec2(along*.07, side*7.1))*.7 + noise(vec2(along*.26, side*3.3 + 9.))*.3;
    float in_ = m - dk*(wav*2.8 + .3);
    float c = smoothstep(0., 1.1, in_);
    if(dk > 0.){
      c *= .5 + .5*smoothstep(0., 2.6*dk, in_);                    // the deckle thins out to fibres
      float hair = smoothstep(.8, .97, noise(vec2(along*.6, side*5.7 + 2.)))*dk;
      c = max(c, .5*hair*smoothstep(-(1. + 3.2*hair), 0., in_));   // stray fibres past the edge
    }
    return vec2(c, in_);
  }
  // the cut or torn edge of a lifted sheet catches a little light
  float rimLight(float e){ return smoothstep(1.8, .2, e)*mix(.035, .1, uDark); }
  // paper out of the water is a shade lighter and flatter than wet paper
  vec3 dryTone(vec3 c){ return uDark > .5 ? c*1.12 + .018 : mix(c, vec3(1.), .08); }
  // gold leaf on a bent sheet: each fleck flashes as its facet turns through the light
  vec3 goldFlash(float fleck, vec3 n){
    vec3 H = normalize(normalize(vec3(-.5,-.62,.72)) + vec3(0.,0.,1.));
    return uGold*fleck*(.2 + 2.4*pow(max(dot(normalize(n), H), 0.), 48.));
  }
  // writing on the sheet being turned: the live text, or the old sheet's snapshot on 换一张纸
  vec3 oldInk(vec2 q, float spread){ return uTurnFresh>.5 ? inkAt(uTextOld, q, spread) : inkAt(uTextTex, q, spread); }
  vec3 frontFace(vec2 q, float spread, float bleed){
    return putInk(paperAt(uPaperOld, q).rgb, oldInk(q, spread), uInkOld, bleed);
  }
  // the old sheet seen from behind: a little duller, its writing faintly showing through (mirrored)
  vec3 backFace(vec2 q){
    vec3 c = paperAt(uPaperOld, q).rgb;
    c = mix(c, vec3(dot(c, vec3(.3,.59,.11))), .25)*mix(.97, 1.05, uDark);
    vec3 k = oldInk(q, 1.3);
    return mix(c, uInkOld, k.x*(.03 + .19*uMatOld.x) + k.y*(.02 + .11*uMatOld.x));
  }

  // Bamboo slips rolled up or rolled out. A roll is (axis c, radius R, side, on), measured in its
  // own frame: x runs from the side the roll starts at, the sheet lies flat in the water beyond c,
  // and everything before c is wound onto the bundle. Roll A carries the old sheet, roll B the new.
  float rollX(vec4 r, vec2 px){ return r.z > 0. ? px.x : uCss.x - px.x; }
  bool onFlat(vec4 r, vec2 px){ return r.w > .5 && rollX(r, px) > r.x; }
  float rollShadow(vec4 r, vec2 px){
    if(r.w < .5) return 1.;
    float d = px.x - (r.z > 0. ? r.x : uCss.x - r.x), a = abs(d) - r.y;
    if(a < 0.) return 1.;
    return 1. - (d > 0. ? .34*exp(-a/18.) : .24*exp(-a/7.))*mix(1., 1.4, uDark);   // light comes from the left
  }
  vec4 rollSurf(vec4 r, float old, vec2 px){
    if(r.w < .5) return vec4(0.);
    float c = r.x, R = r.y, d = rollX(r, px) - c;
    if(abs(d) >= R) return vec4(0.);
    float u = c - R*(PI + asin(d/R));              // which part of the sheet is on top of the bundle here
    float L = clamp(c, 0., uCss.x), per = 2.*PI*R;
    if(u > uCss.x) u -= per*ceil((u - uCss.x)/per);
    if(u < 0.) u += per*ceil(-u/per);
    if(u > L) return vec4(0.);                     // not wound yet: nothing on the bundle at this angle
    float qx = r.z > 0. ? u : uCss.x - u;
    vec3 col = (old > .5 ? paperAt(uPaperOld, vec2(qx, px.y)) : paperAt(uPaperTex, vec2(qx, px.y))).rgb;
    col = mix(col, col*vec3(.84,.93,.66), .6);     // the green skin side of the bamboo faces out
    // each strip is a flat plank around the bundle: light it as one facet
    float uc = (floor((qx - uSlipOff)/uSlip) + .5)*uSlip + uSlipOff; uc = r.z > 0. ? uc : uCss.x - uc;
    float ak = (c - uc)/R;
    vec2 n = vec2(-sin(ak)*r.z, -cos(ak));
    float lit = clamp(dot(n, normalize(vec2(-.55, .83))), 0., 1.);
    col *= .46 + .64*lit;
    col += pow(lit, 40.)*mix(.12, .06, uDark);
    col *= mix(.62, 1., sqrt(max(0., 1. - d*d/(R*R))));
    return vec4(col, smoothstep(0., 1., R - abs(d)));
  }

  void main(){
    vec2 px = vec2(gl_FragCoord.x, uCss.y*uDpr - gl_FragCoord.y)/uDpr;   // CSS px, y down
    vec2 g = waves(px);
    float s = dot(px, uDir);                       // distance from the top-left corner along the turn
    if(uTurn>.5 && uBulge>0.){                     // water rushing in behind the lifting sheet
      float dy = s - (uFold - uRad - 34.);
      g += uDir*uBulge*(-2.*dy/1400.)*exp(-dy*dy/1400.)*2.6;
    }
    float smax = dot(uCss, uDir);
    // a new sheet: how far behind the line where it came down (negative: still in the air above)
    float layB = uLay > .5 ? uLayF - (smax - s) : -1.;
    if(uLay > .5 && uLayF > 0. && uLayF < smax && layB > 0.){   // water pressed out ahead of the landing line
      float y = layB - 7.;
      g += uDir*(-2.*y/40.)*exp(-y*y/40.)*.5*smoothstep(0., 3., layB);
    }
    float air = 0.;                                // low blisters of air caught under the sheet, not quite round
    for(int i=0;i<6;i++){
      if(i>=uBubN) break;
      vec4 B = uBub[i];
      vec2 d = px - B.xy; float r = length(d);
      float R = B.z*(1. + .3*(noise(d/max(r, 1e-3)*1.6 + B.xy*.37) - .5));
      float rho = r/R;
      if(rho >= 1.) continue;
      float w = 1. - rho*rho;
      g += (d/max(r, 1e-3))*(-4.*B.w*rho*w/R);
      air = max(air, smoothstep(0., .55, w));
    }
    float slope = length(g);
    vec2 off = -g*11.;
    float bleed = .16 + clamp(slope*1.6, 0., .34);    // ink feathers where the wave passes
    float spread = 1.3 + slope*6.;
    // the sheet in the water (during a turn: the new sheet, being uncovered)
    vec4 P = paperAt(uPaperTex, px+off);
    if(uPaperFade>0.) P = mix(P, paperAt(uPaperOld, px+off), uPaperFade);
    vec3 col = P.rgb; float glint = P.a, dry = 0.;
    if(air > 0.) col = mix(col, dryTone(dryTone(col)), air*.55);  // no water behind the paper there: it goes pale
    if(layB >= 0.){
      // water soaks in from the line it came down on, unevenly, along the fibres
      float soak = smoothstep(0., 1., (layB - (noise(px*.045)*.65 + noise(px*.17)*.35)*70.)/55.);
      // thin wet paper clings to the sheet beneath: its writing shows through, then sinks away
      float thru = uMatNew.x*.55*(1. - smoothstep(0., uSoak, layB));
      if(thru > .002){
        vec3 k = inkAt(uTextOld, px+off, 2.6);
        col = mix(col, uInkOld, thru*(k.x*.5 + k.z*.5));
        col = mix(col, uSeal, thru*k.y*.45);
      }
      col = mix(dryTone(col), col, soak);
      col *= 1. - .1*exp(-layB/4.);                              // a wet line where it has just come down
    }
    if(uOldInkA>0.) col = putInk(col, inkAt(uTextOld, px+off, spread)*uOldInkA, uInkOld, bleed);
    col = putInk(col, inkAt(uTextTex, px+off, spread), uInk, bleed);
    if(uTurn>.5){
      float f = uFold, R = uRad;
      float gap = f - R - s;
      if(gap > 0.) col *= 1. - mix(.3, .5, uDark)*exp(-gap/28.);      // the curl's shadow on the new sheet
      if(s > f){
        // still lying in the water: the old sheet, refracted as before
        vec4 O = paperAt(uPaperOld, px+off);
        col = putInk(O.rgb, oldInk(px+off, spread), uInkOld, bleed);
        glint = O.a;
        // shadow of the turned-over part lying above it
        vec2 ps = px - vec2(7., 11.);
        float ss = dot(ps, uDir);
        if(ss > f){ float a = PI*R + (ss - f); col *= 1. - mix(.2, .35, uDark)*inPage(ps + uDir*(f - a - ss), 8.); }
        // the turned-over part, back side up
        float a = PI*R + (s - f);
        vec2 qb = px + uDir*(f - a - s);
        vec2 cv = sheetCov(qb, uMatOld.y);
        if(cv.x > 0.){
          vec3 b = backFace(qb) + goldFlash(paperAt(uPaperOld, qb).a, vec3(0.,0.,1.))*.35 + rimLight(cv.y);
          col = mix(col, b, cv.x); dry = cv.x; glint *= 1. - cv.x;
        }
      } else if(s > f - R){
        float x = f - s;                                   // 0..R into the curl
        col *= 1. - mix(.3, .5, uDark)*(x/R);              // dark under the roll
        float th1 = asin(clamp(x/R, 0., 1.)), th2 = PI - th1;
        // the underside of the roll, rising out of the water
        vec2 qf = px + uDir*(x - th1*R);
        vec2 cvf = sheetCov(qf, uMatOld.y); float cf = cvf.x;
        vec3 front = frontFace(qf + off*(1. - sin(th1)), 1.3, .16)*mix(1., .72, sin(th1));
        front += goldFlash(paperAt(uPaperOld, qf).a, vec3(uDir*sin(th1), cos(th1))) + rimLight(cvf.y);
        // the outside of the roll: the sheet's back, catching the light along its crest,
        // still wet — the sheen breaks into runnels where the water drains off
        vec2 qb = px + uDir*(x - th2*R);
        vec2 cvb = sheetCov(qb, uMatOld.y); float cb = cvb.x;
        float lit = clamp(dot(vec2(-sin(th2), -cos(th2)), normalize(vec2(-.55, .83))), 0., 1.);
        float runnel = .45 + .9*noise(vec2(dot(qb, vec2(-uDir.y, uDir.x))*.07, th2*1.5));
        vec3 back = backFace(qb)*mix(.8, 1.06, lit) + pow(lit, 24.)*mix(.1, .05, uDark)*runnel;
        back += goldFlash(paperAt(uPaperOld, qb).a, vec3(-uDir*sin(th2), -cos(th2)))*.35 + rimLight(cvb.y);
        col = mix(col, front, cf);
        col = mix(col, back, cb);
        dry = max(cf*sin(th1), cb);
        glint *= 1. - max(cf, cb);
      }
    }
    if(uLay > .5){
      float d = -layB;                                     // how far ahead of the line where the sheet meets the water
      if(d > 0.){
        // not covered yet: the old sheet with its writing, refracted as before
        vec4 O = paperAt(uPaperOld, px+off);
        vec3 under = putInk(O.rgb, inkAt(uTextOld, px+off, spread), uInkOld, bleed);
        // which point of the new sheet floats above here, its tilt and height
        float R = uLayR, th = uLayTh, a, phi, h;
        if(d < R*sin(th)){ phi = asin(d/R); a = R*phi; h = R*(1. - cos(phi)); }
        else { phi = th; a = R*th + (d - R*sin(th))/cos(th); h = R*(1. - cos(th)) + (a - R*th)*sin(th); }
        vec2 q = px - uDir*(a - d);
        vec2 cv = sheetCov(q, uMatNew.y); float cov = cv.x;
        // its soft shadow on the old sheet around the floating edges
        float sh = inPage(q, 4. + h*.22)*smoothstep(0., 40., h);
        under *= 1. - mix(.16, .3, uDark)*sh*(1. - cov);
        under *= 1. - .1*exp(-d/5.)*(1. - cov);
        // the floating part, lit by its tilt: it faces away from the light as it rises
        vec3 n = vec3(uDir*sin(phi), cos(phi));
        float lit = clamp(dot(n, normalize(vec3(-.5,-.62,.72)))/.671, -1., 1.);
        vec4 Pq = paperAt(uPaperTex, q);
        vec3 top = putInk(dryTone(Pq.rgb), inkAt(uTextTex, q, 1.3), uInk, .16);
        top *= mix(.93, .9, uDark) + mix(.07, .1, uDark)*lit;
        top += goldFlash(Pq.a, n) + rimLight(cv.y);
        col = mix(under, top, cov);
        glint = O.a*(1. - cov); dry = cov;
      }
    }
    if(uRoll > .5){
      vec4 O = paperAt(uPaperOld, px+off);
      vec3 oldFlat = putInk(O.rgb, oldInk(px+off, spread), uInkOld, bleed);
      vec3 c2 = col; float g2 = glint;                       // uUnder 0: the new sheet lies beneath
      if(uUnder > 1.5){ c2 = uBare; g2 = 0.; }               // 2: bare water between two bundles
      else if(uUnder > .5){ c2 = oldFlat; g2 = O.a; }        // 1: the old sheet lies beneath
      if(onFlat(uRollA, px)){ c2 = oldFlat; g2 = O.a; }
      if(onFlat(uRollB, px)){ c2 = col; g2 = glint; }
      col = c2*rollShadow(uRollA, px)*rollShadow(uRollB, px); glint = g2;
      vec4 sa = rollSurf(uRollA, 1., px); col = mix(col, sa.rgb, sa.a);
      vec4 sb = rollSurf(uRollB, 0., px); col = mix(col, sb.rgb, sb.a);
      dry = max(sa.a, sb.a); glint *= 1. - dry;
    }
    vec2 gn = g*(1.-dry);
    vec3 n = normalize(vec3(-gn*1.4,1.));
    vec3 L = normalize(vec3(-.5,-.62,.72));
    float diff = dot(n,L) - L.z;
    vec3 H = normalize(L+vec3(0.,0.,1.));
    float spec = max(pow(max(dot(n,H),0.),90.) - pow(H.z,90.), 0.);
    if(uDark>.5){ col *= 1.+diff*1.1; col += diff*.07 + vec3(.72,.8,.9)*spec*1.1; }
    else { col *= 1.+diff*.75; col += spec*.22; }
    col += uGold*glint*(spec*6. + smoothstep(.03,.16,length(gn))*.45);   // gold leaf catching the wave
    vec2 q2 = gl_FragCoord.xy/(uCss*uDpr)-.5;
    col *= 1.-.07*dot(q2,q2)*2.2;
    col += (hash(gl_FragCoord.xy+fract(uTime)*61.)-.5)/255.;
    o = vec4(col,1.);
  }`;

  let paperProg, mainProg, paperTex, paperOld, textTex, textOld, fbo;
  let W=1, H=1, cssW=1, cssH=1;

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
    paperTex=makeTex(); paperOld=makeTex(); textTex=makeTex(); textOld=makeTex(); fbo=gl.createFramebuffer();
  }

  let paperSeed = [0, 0];
  function makePaper() {
    if (!gl) return;
    gl.activeTexture(gl.TEXTURE0);
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
    gl.uniform1f(u.uGrain, C.grain); gl.uniform1f(u.uGoldAmt, C.goldAmt); gl.uniform2f(u.uSeed, paperSeed[0], paperSeed[1]);
    if (C.slip) measureSlips();
    gl.uniform1f(u.uSlip, C.slip ? slipW : 0); gl.uniform1f(u.uSlipOff, slipOff); gl.uniform1f(u.uH, cssH); gl.uniform3fv(u.uGap, C.gap); gl.uniform3fv(u.uCord, C.cord);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function resize() {
    cssW = Math.max(1, canvas.clientWidth); cssH = Math.max(1, canvas.clientHeight);
    if (!gl) return;
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    W = Math.max(1, Math.round(cssW*dpr)); H = Math.max(1, Math.round(cssH*dpr));
    if (canvas.width!==W) canvas.width=W;
    if (canvas.height!==H) canvas.height=H;
    makePaper();
    layoutDirty = true; fullUpload = true;
    const t = now(); updateText(t); draw(t); kick();   // redraw now: a resized canvas is blank
  }

  /* ---------- Trace each glyph from the live layout into a texture ----------
     Red = ink, green = seal paste; the shader puts the colours on, so ink can
     change colour without retracing. Fresh ink blooms in, deleted ink fades out. */
  const tcan = document.createElement('canvas');
  const tctx = tcan.getContext('2d');
  const scan = document.createElement('canvas');      // scratch for partial uploads
  const sctx = scan.getContext('2d');
  const rng = document.createRange();
  const pickRect = r => { const rs=r.getClientRects(); for(const x of rs) if(x.width>0) return x; return rs[0]||null; };
  const INK_IN = .42, GHOST = .55, PRINT_IN = .2;
  let glyphs = [], layoutDirty = true, fullUpload = true, prevRect = null;
  let fontStr = '', fontPx = 20, asc = 18;
  const freshInk = [];   // { x, y (content), t }  where new glyphs landed
  const ghosts = [];     // { g, x, y, w, h, t, dx, dy }  deleted glyphs fading out
  const imprints = [];   // { x, y (content), rot, t }  seal marks on the paper
  // null: waiting for the opening (text hidden); a time: opening under way; -Infinity: all shown
  let introStart = (gl && !reduced()) ? null : -Infinity;

  function markLayout() { layoutDirty = true; kick(); }

  function layoutText(t) {
    if (tcan.width!==W || tcan.height!==H) { tcan.width=W; tcan.height=H; fullUpload = true; }
    const cs = getComputedStyle(sheet);
    fontStr = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    fontPx = parseFloat(cs.fontSize) || 20;
    tctx.font = fontStr;
    asc = tctx.measureText('永').fontBoundingBoxAscent || fontPx*0.88;
    const cr = canvas.getBoundingClientRect(), st = sheet.scrollTop, sl = sheet.scrollLeft, near = fontPx * .6;
    const live = freshInk.filter(f => t - f.t < INK_IN);
    glyphs = [];
    let idx = 0;
    const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
    for (let node=walker.nextNode(); node; node=walker.nextNode()) {
      let i=0;
      for (const g of graphemes(node.data)) {
        if (!isBlank(g)) {
          rng.setStart(node,i); rng.setEnd(node,i+g.length);
          const r = pickRect(rng);
          if (r && r.bottom>cr.top-40 && r.top<cr.top+cssH+40) {
            const l = r.left-cr.left, top = r.top-cr.top, cx = l + r.width/2, cy = top + r.height/2;
            let born = introStart === null ? Infinity
                     : introStart === -Infinity ? -Infinity
                     : introStart + .2 + Math.min(idx, 48) * .085;
            for (const f of live) if (Math.abs(f.x-sl-cx) < near && Math.abs(f.y-st-cy) < near) born = f.t;
            glyphs.push({ g, x:l, y:top+asc, l, t:top, w:r.width, h:r.height, born });
          }
          idx++;
        }
        i += g.length;
      }
    }
    layoutDirty = false;
  }

  // In columns, CJK stands upright; commas and stops sit in the top-right corner; brackets,
  // dashes and Latin text lie on their side — as the browser sets them.
  const CORNER = /^[，。、．,.]$/u;
  const SIDEWAYS = /[A-Za-z0-9—–…\-~～《》〈〉「」『』（）()\[\]【】〔〕“”‘’"'：；:;]/u;
  function glyphAt(g, l, t, w, h, dx, dy) {
    if (!vertical()) { tctx.fillText(g, l + dx, t + asc + dy); return; }
    const cx = l + w/2 + dx, cy = t + h/2 + dy;
    if (CORNER.test(g)) tctx.fillText(g, cx + fontPx*.34, cy - fontPx*.4);
    else if (SIDEWAYS.test(g)) { tctx.save(); tctx.translate(cx, cy); tctx.rotate(Math.PI/2); tctx.fillText(g, 0, 0); tctx.restore(); }
    else tctx.fillText(g, cx, cy);
  }

  const hits = (R, x, y, w, h) => !R || (x < R.x+R.w && x+w > R.x && y < R.y+R.h && y+h > R.y);
  function inkLook(age) {             // [alpha, blur px]: ink lands soft and spread, then tightens
    if (age < 0) return null;
    if (age >= INK_IN) return [1, 0];
    const e = 1 - Math.pow(1 - age/INK_IN, 3);
    return [.3 + .7*e, (1-e)*6];
  }

  let sprite = null;
  function sealSprite() {
    const k = W/cssW, w = sealEl.offsetWidth || 20, h = sealEl.offsetHeight || 38, key = `${w}x${h}@${k}`;
    if (sprite && sprite.key === key) return sprite;
    const S = 1.15, c = document.createElement('canvas');
    c.width = Math.ceil(w*S*k); c.height = Math.ceil(h*S*k);
    const x = c.getContext('2d');
    x.scale(k*S, k*S);
    x.fillStyle = '#0f0';
    x.beginPath(); if (x.roundRect) x.roundRect(0, 0, w, h, 2); else x.rect(0, 0, w, h); x.fill();
    x.globalCompositeOperation = 'destination-out';
    const cs = getComputedStyle(sealEl), fs = parseFloat(cs.fontSize) || 12;
    x.font = `600 ${fs}px ${cs.fontFamily}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#000';
    const chars = graphemes(sealEl.textContent.trim()), step = fs*1.14, top = (h - step*chars.length)/2 + step/2;
    chars.forEach((ch, i) => x.fillText(ch, w/2, top + i*step));
    // Where the paste didn't take: specks inside, bites along the rim.
    for (let i = 0; i < 34; i++) {
      const rim = i < 14;
      x.globalAlpha = .25 + Math.random()*.55;
      const px = rim ? (Math.random() < .5 ? Math.random()*1.2 : w - Math.random()*1.2) : Math.random()*w;
      x.beginPath(); x.arc(px, Math.random()*h, .25 + Math.random()*(rim ? 1.1 : .7), 0, 6.283); x.fill();
    }
    return (sprite = { key, c, w: w*S, h: h*S });
  }

  function paint(t, R) {
    const sx = W/cssW, sy = H/cssH;
    tctx.save();
    tctx.setTransform(1,0,0,1,0,0);
    if (R) {
      const x = Math.floor(R.x*sx), y = Math.floor(R.y*sy), w = Math.ceil(R.w*sx)+2, h = Math.ceil(R.h*sy)+2;
      tctx.beginPath(); tctx.rect(x, y, w, h); tctx.clip(); tctx.clearRect(x, y, w, h);
    } else tctx.clearRect(0,0,W,H);
    tctx.setTransform(sx,0,0,sy,0,0);
    tctx.shadowBlur = 0; tctx.globalAlpha = 1;
    const st = sheet.scrollTop, sl = sheet.scrollLeft;
    if (imprints.length) {
      const sp = sealSprite();
      for (const m of imprints) {
        const x = m.x - sl, y = m.y - st, a = clamp((t - m.t)/PRINT_IN, 0, 1)*.94;
        if (a <= 0 || !hits(R, x-36, y-36, 72, 72)) continue;
        tctx.save(); tctx.globalAlpha = a; tctx.translate(x, y); tctx.rotate(m.rot);
        tctx.drawImage(sp.c, -sp.w/2, -sp.h/2, sp.w, sp.h); tctx.restore();
      }
    }
    tctx.font = fontStr; tctx.fillStyle = '#f00'; tctx.shadowColor = '#f00';
    const v = vertical();
    tctx.textBaseline = v ? 'middle' : 'alphabetic'; tctx.textAlign = v ? 'center' : 'start';
    for (const gp of glyphs) {
      if (!hits(R, gp.l-10, gp.t-10, gp.w+20, gp.h+20)) continue;
      const look = inkLook(t - gp.born);
      if (!look) continue;
      tctx.globalAlpha = look[0]; tctx.shadowBlur = look[1]*sx;
      glyphAt(gp.g, gp.l, gp.t, gp.w, gp.h, 0, 0);
    }
    for (const gh of ghosts) {
      const k = (t - gh.born)/GHOST;
      if (k < 0 || k >= 1) continue;
      const e = 1 - (1-k)*(1-k);
      tctx.globalAlpha = (1-k)*(1-k)*.85; tctx.shadowBlur = k*7*sx;
      glyphAt(gh.g, gh.l, gh.t, gh.w, gh.h, gh.dx*e, gh.dy*e);
    }
    tctx.restore();
  }

  function animRect(t) {
    let x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
    const add = (x,y,w,h) => { if(x<x0)x0=x; if(y<y0)y0=y; if(x+w>x1)x1=x+w; if(y+h>y1)y1=y+h; };
    for (const gp of glyphs) if (gp.born !== Infinity && t < gp.born + INK_IN) add(gp.l-12, gp.t-12, gp.w+24, gp.h+24);
    for (const gh of ghosts) if (t - gh.born < GHOST) add(gh.l-14, gh.t-14, gh.w+28, gh.h+28);
    const st = sheet.scrollTop;
    for (const m of imprints) if (t - m.t < PRINT_IN) add(m.x-sheet.scrollLeft-36, m.y-st-36, 72, 72);
    return x0 < x1 ? { x:x0, y:y0, w:x1-x0, h:y1-y0 } : null;
  }
  function union(a, b) {
    if (!a) return b; if (!b) return a;
    const x = Math.min(a.x,b.x), y = Math.min(a.y,b.y);
    return { x, y, w: Math.max(a.x+a.w, b.x+b.w)-x, h: Math.max(a.y+a.h, b.y+b.h)-y };
  }
  function upload(R) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (!R || fullUpload) { gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,tcan); fullUpload = false; return; }
    const sx = W/cssW, sy = H/cssH;
    const x0 = clamp(Math.floor(R.x*sx)-1, 0, W), y0 = clamp(Math.floor(R.y*sy)-1, 0, H);
    const x1 = clamp(Math.ceil((R.x+R.w)*sx)+3, 0, W), y1 = clamp(Math.ceil((R.y+R.h)*sy)+3, 0, H);
    const w = x1-x0, h = y1-y0;
    if (w <= 0 || h <= 0) return;
    if (scan.width !== w || scan.height !== h) { scan.width = w; scan.height = h; } else sctx.clearRect(0,0,w,h);
    sctx.drawImage(tcan, x0, y0, w, h, 0, 0, w, h);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, gl.RGBA, gl.UNSIGNED_BYTE, scan);
  }
  // Full retrace when the layout moved; otherwise repaint only where ink is still settling.
  function updateText(t) {
    if (layoutDirty) { layoutText(t); paint(t, null); upload(null); prevRect = animRect(t); return; }
    const r = animRect(t), u = union(r, prevRect);
    prevRect = r;
    if (u) { paint(t, u); upload(u); }
  }
  function pruneText(t) {
    for (let i = freshInk.length-1; i >= 0; i--) if (t - freshInk[i].t > INK_IN + .1) freshInk.splice(i, 1);
    for (let i = ghosts.length-1; i >= 0; i--) if (t - ghosts[i].born > GHOST + .1) ghosts.splice(i, 1);
  }
  function collectGhosts(range) {
    const cr = canvas.getBoundingClientRect(), t = now(), top = range.commonAncestorContainer, nodes = [];
    if (top.nodeType === 3) nodes.push(top);
    else { const w = document.createTreeWalker(top, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) if (range.intersectsNode(n)) nodes.push(n); }
    for (const node of nodes) {
      const s = node === range.startContainer ? range.startOffset : 0;
      const e = node === range.endContainer ? range.endOffset : node.data.length;
      let i = s;
      for (const g of graphemes(node.data.slice(s, e))) {
        if (!isBlank(g) && ghosts.length < 160) {
          rng.setStart(node, i); rng.setEnd(node, i + g.length);
          const r = pickRect(rng);
          if (r && r.bottom > cr.top && r.top < cr.bottom) {
            const a = Math.random()*Math.PI*2;
            ghosts.push({ g, l:r.left-cr.left, t:r.top-cr.top, w:r.width, h:r.height, born:t,
                          dx:Math.cos(a)*5, dy:Math.sin(a)*4 + 3 });
          }
        }
        i += g.length;
      }
    }
  }
  function addImprint(x, y, rot) {
    imprints.push({ x: x + sheet.scrollLeft, y: y + sheet.scrollTop, rot, t: now() });
    if (imprints.length > 16) imprints.shift();
    kick();
  }

  /* ---------- Ripples ---------- */
  let ripples = [];
  const ripA = new Float32Array(MAXR*4), ripB = new Float32Array(MAXR*4);
  function drop(x, y, s, delayMs=0, kind='char') {
    if (!gl) return;
    if (reduced()) s *= 0.35;
    ripples.push({ x:x+(Math.random()-.5)*2, y:y+(Math.random()-.5)*2, t:now()+delayMs/1000, s, k:KINDS[kind]||KINDS.char });
    if (ripples.length>MAXR) ripples.splice(0, ripples.length-MAXR);
    kick();
  }

  /* ---------------------------------------------------------------------------
     Changing paper: the old sheet is turned like a book page. Its top-left corner
     lifts, the fold sweeps diagonally across and the sheet rolls over and away to
     the bottom-right, uncovering the new sheet already lying in the water beneath.
     The water answers: rings where the sheet leaves it, drips off the roll, a swell
     filling in behind, and a last ring as the page clears.
     Bamboo slips are rolled instead: the old slips wind up from the left into a
     bundle that rolls off to the right; new slips unroll from the side.
     A new sheet (换一张纸) is not a change of paper: nothing is taken away. A fresh
     sheet is swung in over the bottom-right corner and laid straight on top, the line
     where it lands sweeping up to the top-left until the last corner flops down. Water
     is pressed out along that line, a few pockets of air get caught and work their way
     out, and the old writing shows through the wet sheet a moment before it sinks away.
     Fresh slips simply unroll over the old ones from the right.
     Each paper bends and looks its own way out of the water (matOf), and the margins
     go with the sheet: each label takes the new colours as the new sheet reaches it,
     and the title steps aside while a sheet is in the air above it.
  --------------------------------------------------------------------------- */
  const TURN = 1.25, ROLL = 1.35, LAY = 1.5, LAND = .74, SOAK = 260, R0 = 8, THICK = 6;
  const DIR = (() => { const l = Math.hypot(1, .62); return [1/l, .62/l]; })();
  const T = { active:false, mode:'turn', k:0, t0:0, dur:TURN, fresh:false, target:null, inkOld:null, queue:null, queueFresh:false,
              nextLine:0, nextDrip:0, rolls:[], geo:[], under:0, bare:[0,0,0],
              matOld:[0,0,1], matNew:[0,0,1], chrome:[], touched:false, landed:false, bubLeft:0 };
  let colorAnim = null, paperFade = null, oldInk = null;
  const easeIO = k => k < .5 ? 4*k*k*k : 1 - Math.pow(-2*k + 2, 3)/2;
  const easeTurn = k => k < .5 ? .5*Math.pow(2*k, 2.2) : 1 - .5*Math.pow(2 - 2*k, 2.2);

  // The page turn: f is the fold, measured from the top-left corner along DIR; R the radius of
  // the roll, wider for a stiffer paper. The corner starts to come up at once, and the turn
  // ends the moment the last of the page clears the far corner.
  function turnGeom(k) {
    const e = easeTurn(k), smax = cssW*DIR[0] + cssH*DIR[1], st = T.matOld[2];
    const R = (22 + 74*ease(Math.min(1, e*1.6)))*st;     // the roll widens as the page comes up
    return { f: -6 + e*(smax + 96*st + 14), R };
  }
  // Laying a new sheet: f is where it meets the water, measured from the bottom-right corner
  // back along DIR; th is how steeply the part still in the air rises. It swings in nearly
  // upright over the corner, is laid down steadily, and the last of it flops down flat.
  // After LAND the line runs on unseen for SOAK px while the water soaks into the last corner.
  function layGeom(k) {
    const smax = cssW*DIR[0] + cssH*DIR[1], st = T.matNew[2];
    if (k >= LAND) { const v = (k - LAND)/(1 - LAND); return { f: smax + SOAK*(1 - (1 - v)*(1 - v)), R: 34*st, th: .18, smax, landed: true }; }
    const u = k/LAND, th0 = 1.32, R0 = 60*st;
    const f0 = -(R0*(Math.sin(th0) - th0*Math.cos(th0)) + smax*Math.cos(th0))/(1 - Math.cos(th0));
    const E = u + .42*Math.sin(2*Math.PI*u)/(2*Math.PI);   // quick in, steady across, quick at the end
    return { f: f0 + E*(smax - f0), R: (60 - 26*u)*st, th: th0 - 1.14*ease(u), smax, landed: false };
  }
  function startLay(p) {
    if (T.active) return;
    T.inkOld = C.inkShown;
    [paperTex, paperOld] = [paperOld, paperTex];          // the old sheet stays in the water; the new one comes down on it
    paperSeed = [Math.random()*900, Math.random()*900];
    glColors(p); C.inkShown = C.inkTo; makePaper();
    const rolls = p.slip ? [{ old:false, up:false, dir:1, delay:0, nextLine:0, nextDrip:0, nextClack:0 }] : [];
    Object.assign(T, { active:true, mode: p.slip ? 'roll' : 'lay', k:0, t0:now(), fresh:true, ownInk:false, target:p,
      nextLine:0, nextDrip:0, rolls, geo:[], dur: p.slip ? ROLL : LAY, under:1, bare: hex(p.bare || p.fiber),
      matOld: matOf(p), matNew: matOf(p), touched:false, landed:false, bubLeft: Math.round(1 + (p.thin || 0)*6) });
    if (p.slip) T.geo = rollsNow(T.t0);
    chromeStart();
    root.classList.add('lifting', 'laying');               // the caret waits for the sheet to reach it
    Sound.lay();
    kick();
  }
  function stepLay(t) {
    const L = layGeom(T.k), { f, smax } = L;
    if (!T.touched && f > 0) {                             // the corner touches down
      T.touched = true;
      drop(cssW - 10, cssH - 10, .55, 0, 'drip'); Sound.drip(cssW);
    }
    if (T.touched && f < smax && t >= T.nextLine) {        // water pressed out along the line where it lands
      T.nextLine = t + .05;
      const p = onLine(smax - f + 3); if (p) drop(p[0], p[1], .3, 0, 'trail');
    }
    if (T.touched && T.bubLeft > 0 && f > smax*.12 && f < smax*.86 && t >= T.nextDrip) {   // air caught under it
      T.nextDrip = t + .1 + Math.random()*.16;
      const p = onLine(smax - f + 12 + Math.random()*36);
      if (p && Math.random() < .7) { addBubble(p[0], p[1], 11 + Math.random()*13); T.bubLeft--; }
    }
    if (!T.landed && L.landed) {                           // the last corner flops down
      T.landed = true; root.classList.remove('laying');
      drop(cssW*.05, cssH*.07, .9, 0, 'wide'); Sound.enter();
      for (let i = 0; i < 3; i++) {                        // the air under it puffs out along the edges
        const a = Math.random(), top = i % 2 === 0;
        drop(top ? cssW*(.04 + a*.3) : 6, top ? 6 : cssH*(.04 + a*.3), .3, 50 + i*60, 'trail');
      }
    }
  }

  /* Air caught under a new sheet: a low blister that comes up as the sheet lands on it, is
     pushed on ahead of the landing line as it shrinks, and lets go with a tiny ring. */
  const bubbles = [], bubA = new Float32Array(24);
  function addBubble(x, y, r0) {
    const side = (Math.random() - .5)*16;
    bubbles.push({ x, y, r0, t0: now(), life: .55 + Math.random()*.5, vx: -DIR[0]*34 - DIR[1]*side, vy: -DIR[1]*34 + DIR[0]*side });
    if (bubbles.length > 6) bubbles.shift();
    kick();
  }
  function bubbleAt(b, t) {
    const age = clamp(t - b.t0, 0, b.life), go = age - age*age/(2*b.life);   // slows as it empties
    return { x: b.x + b.vx*go, y: b.y + b.vy*go,
             r: b.r0*ease(clamp(age/.09, 0, 1))*Math.sqrt(clamp(1 - age/b.life, 0, 1)) };
  }
  function stepBubbles(t) {
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      if (t - b.t0 < b.life) continue;
      const p = bubbleAt(b, t);
      bubbles.splice(i, 1); drop(p.x, p.y, .24, 0, 'bubble'); Sound.bubble(p.x, 0, .16);
    }
  }

  /* The margins sit on the paper: each label takes the new colours once the new sheet is
     under it, and the title steps aside while a sheet is in the air above it. */
  const markEl = document.querySelector('.mark');
  const CHROME_VARS = ['--paper', '--fiber', '--ink', '--ink-soft', '--seal', '--on-seal'];
  const chromeVals = p => [p.paper, p.fiber, p.ink, p.inkSoft, p.seal, p.onSeal];
  function chromeStart() {
    const cr = canvas.getBoundingClientRect();
    T.chrome = [markEl, countEl, papersEl, soundBtn, freshBtn].map(el => {
      const r = el.getBoundingClientRect();
      return { el, x: r.left + r.width/2 - cr.left, y: r.top + r.height/2 - cr.top, hide: el === markEl, done: false };
    });
  }
  // Is the new sheet what lies at (x, y) now, and is a sheet in the air above it?
  function sheetAt(x, y) {
    const s = x*DIR[0] + y*DIR[1];
    if (T.mode === 'turn') {
      const { f, R } = turnGeom(T.k);
      return { isNew: s < f - R, air: s > f - R - 24 && s < 2*f - Math.PI*R + 24 };
    }
    if (T.mode === 'lay') {
      const L = layGeom(T.k), sp = L.smax - s, a = L.smax - L.f;     // a: how much is still in the air
      if (a <= 0) return { isNew: true, air: false };
      const far = a < L.R*L.th ? L.f + L.R*Math.sin(a/L.R) : L.f + L.R*Math.sin(L.th) + (a - L.R*L.th)*Math.cos(L.th);
      return { isNew: sp < far, air: sp > L.f - 16 && sp < far + 24 };
    }
    let isNew = T.under !== 1, air = false;
    for (const g of T.geo) {
      if ((g.r.dir > 0 ? x : cssW - x) > g.c) isNew = !g.r.old;     // this roll's slips lie flat here
      if (Math.abs(x - g.x) < g.R + 24) air = true;
    }
    return { isNew, air };
  }
  function chromeStep() {
    for (const c of T.chrome) {
      const at = sheetAt(c.x, c.y);
      if (!c.done && at.isNew) {
        c.done = true;
        const v = chromeVals(T.target);
        CHROME_VARS.forEach((n, i) => c.el.style.setProperty(n, v[i]));
      }
      if (c.hide) c.el.classList.toggle('under', at.air);
    }
  }
  function chromeEnd() {
    cssColors(T.target);
    for (const c of T.chrome) { for (const n of CHROME_VARS) c.el.style.removeProperty(n); c.el.classList.remove('under'); }
    T.chrome = [];
  }
  // A point on the line dot(p, DIR) = s, inside the page.
  function onLine(s) {
    const [a, b] = DIR;
    const lo = Math.max((s*a - cssW)/b, -s*b/a), hi = Math.min(s*a/b, (cssH - s*b)/a);
    if (hi - lo < 8) return null;
    const u = lo + 4 + Math.random()*(hi - lo - 8);
    return [s*a - u*b, s*b + u*a];
  }
  // Where each roll is at time t. c and R are in the roll's own frame; x is its axis on screen.
  function rollsNow(t) {
    const Rmax = Math.sqrt(R0*R0 + cssW*THICK/Math.PI), far = cssW + Rmax + 30;
    const geo = T.rolls.map(r => {
      const k = clamp((t - T.t0 - r.delay)/ROLL, 0, 1), e = easeIO(k);
      let c = r.up ? -4 + e*(far + 4) : far - e*(far + 10);
      const R = Math.sqrt(R0*R0 + clamp(c, 0, cssW)*THICK/Math.PI);
      return { r, k, c, R, x: r.dir > 0 ? c : cssW - c };
    });
    const a = geo.find(g => g.r.old), b = geo.find(g => !g.r.old);
    if (a && b && b.r.dir < 0 && a.k < 1) {               // the new bundle never catches up with the old one
      const lim = a.x - a.R - b.R - 16;
      if (b.x > lim) { b.x = lim; b.c = cssW - lim; }
    }
    return geo;
  }
  function startTurn(p, fresh) {
    if (T.active) { if (!fresh) T.queue = p; return; }   // turn the next page once this one is over
    const from = preset;
    T.inkOld = C.inkShown;
    [paperTex, paperOld] = [paperOld, paperTex];          // the old sheet rides on top; the new one goes beneath
    // Writing turns between rows and columns: the old sheet keeps a snapshot of its own layout.
    const ownInk = setLayout(p) && !fresh;
    if (ownInk) { [textTex, textOld] = [textOld, textTex]; fullUpload = true; }
    glColors(p); C.inkShown = C.inkTo; makePaper();
    const rolls = [];
    if (from.slip) rolls.push({ old:true, up:true, dir:1, delay:0 });
    if (p.slip) rolls.push({ old:false, up:false, dir: from.slip ? -1 : 1, delay: from.slip ? .24 : 0 });
    for (const r of rolls) Object.assign(r, { nextLine:0, nextDrip:0, nextClack:0 });
    const roll = rolls.length > 0;
    Object.assign(T, { active:true, mode: roll ? 'roll' : 'turn', k:0, t0:now(), fresh, ownInk, target:p,
      nextLine:0, nextDrip:0, rolls, geo:[],
      dur: roll ? Math.max(...rolls.map(r => r.delay)) + ROLL : TURN,
      under: rolls.length === 2 ? 2 : roll && rolls[0].old ? 0 : 1, bare: hex(p.bare || from.bare || p.fiber),
      matOld: matOf(from), matNew: matOf(p) });
    if (roll) T.geo = rollsNow(T.t0);
    chromeStart();
    root.classList.add('lifting');
    if (!roll) drop(14, 12, .55, 0, 'drip');
    Sound.lift();
    kick();
  }
  function stepRoll(t) {
    T.geo = rollsNow(t);
    for (const g of T.geo) {
      const r = g.r;
      if (g.k <= 0 || g.k >= 1 || g.x < -g.R || g.x > cssW + g.R) continue;
      if (t >= r.nextLine) {                               // rings along the line where slips leave / meet the water
        r.nextLine = t + .05;
        drop(g.x + r.dir*(Math.random()*6 - 1), Math.random()*cssH, .3, 0, 'trail');
      }
      if (r.up && g.k > .08 && t >= r.nextDrip) {          // drips off the bundle onto what it uncovers
        r.nextDrip = t + .16 + Math.random()*.14;
        const x = g.x - r.dir*g.R*.9; drop(x, Math.random()*cssH, .45, 0, 'drip'); Sound.drip(x);
      }
      if (g.c > 0 && g.c < cssW && t >= r.nextClack) {     // strips knocking together as they wind
        r.nextClack = t + .05 + Math.random()*.035;
        Sound.clack(g.x);
      }
    }
  }
  function stepTurn(t) {
    if (!T.active) return;
    T.k = clamp((t - T.t0)/T.dur, 0, 1);
    if (T.mode === 'roll') stepRoll(t);
    else if (T.mode === 'lay') stepLay(t);
    else {
      const { f, R } = turnGeom(T.k);
      if (T.k > .03 && T.k < .92 && t >= T.nextLine) {    // rings where the sheet leaves the water
        T.nextLine = t + .065;
        const p = onLine(f + 3); if (p) drop(p[0], p[1], .3, 0, 'trail');
      }
      if (T.k > .14 && T.k < .86 && t >= T.nextDrip) {    // drips off the rolled edge onto the new sheet
        T.nextDrip = t + .14 + Math.random()*.12;
        const p = onLine(f - R*.92); if (p) { drop(p[0], p[1], .5, 0, 'drip'); Sound.drip(p[0]); }
      }
    }
    chromeStep();
    if (T.k >= 1) {
      T.active = false; root.classList.remove('lifting', 'laying');
      chromeEnd();
      if (T.mode !== 'lay') {                              // a laid sheet made its ring when it came down
        const last = T.mode === 'roll' ? T.rolls[T.rolls.length - 1] : null;
        const endX = !last ? cssW*.88 : last.up ? cssW*.9 : (last.dir > 0 ? cssW*.08 : cssW*.92);
        drop(endX, last ? cssH*.5 : cssH*.9, .85, 0, 'wide'); Sound.enter();
        for (let i = 0; i < 2; i++) {
          const x = cssW*(.5 + Math.random()*.4), y = cssH*(.45 + Math.random()*.45), d = 140 + i*120;
          drop(x, y, .3, d, 'bubble'); Sound.bubble(x, d/1000);
        }
      }
      if (T.queue) { const q = T.queue; T.queue = null; if (q.id !== preset.id) { startTurn(q, false); return; } }
      if (T.queueFresh) { T.queueFresh = false; freshSheet(); }
    }
  }
  function startColors(t, dur) { colorAnim = { t0:t, dur, ink:C.inkShown }; }
  function stepFades(t) {
    if (colorAnim) {
      const k = clamp((t - colorAnim.t0)/colorAnim.dur, 0, 1);
      C.inkShown = mix3(colorAnim.ink, C.inkTo, ease(k));
      if (k >= 1) colorAnim = null;
    }
    if (paperFade) { paperFade.v = 1 - ease(clamp((t - paperFade.t0)/.3, 0, 1)); if (paperFade.v <= 0) paperFade = null; }
    if (oldInk) { oldInk.v = 1 - ease(clamp((t - oldInk.t0)/.3, 0, 1)); if (oldInk.v <= 0) oldInk = null; }
  }

  function choosePaper(p) {
    Sound.ensure();
    if (p.id === (T.active ? (T.queue || T.target) : preset).id) return;
    markPreset(p);
    if (!gl) { setColors(p); setLayout(p); C.inkShown = C.inkTo; return; }
    if (reduced() && !T.active) {                   // a plain cross-fade
      [paperTex, paperOld] = [paperOld, paperTex];
      startColors(now(), .3); setColors(p); setLayout(p); makePaper();
      paperFade = { t0: now(), v: 1 }; kick(); return;
    }
    startTurn(p, false);
  }
  function freshSheet() {
    Sound.ensure();
    if (T.active) { T.queueFresh = true; return; }        // lay it once the sheet in motion has settled
    if (gl) { [textTex, textOld] = [textOld, textTex]; fullUpload = true; }   // old ink stays on the old sheet
    sheet.textContent = ''; imprints.length = 0; ghosts.length = 0; freshInk.length = 0;
    sheet.scrollTop = 0; sheet.scrollLeft = 0; sheet.focus(); updateCount(); Sound.resetPhrase();
    if (!gl) return;
    markLayout();
    if (reduced()) { oldInk = { t0: now(), v: 1 }; kick(); return; }
    startLay(preset);
  }

  /* ---------- Scroll sway: the tray rocks a little and comes back to rest ---------- */
  const slosh = { x:0, v:0, on:false };
  function stepSlosh(dt) {
    if (!slosh.on) return;
    slosh.v += (-38*slosh.x - 4.5*slosh.v)*dt;
    slosh.x = clamp(slosh.x + slosh.v*dt, -1.2, 1.2);
    if (Math.abs(slosh.x) < 1e-3 && Math.abs(slosh.v) < 1e-3) { slosh.x = slosh.v = 0; slosh.on = false; }
  }

  /* ---------- One frame loop, running only while something moves ---------- */
  let raf = 0, lastT = 0;
  const busy = () => ripples.length || T.active || bubbles.length || slosh.on || layoutDirty || prevRect || colorAnim || paperFade || oldInk;
  function kick() { if (!raf) { lastT = now(); raf = requestAnimationFrame(frame); } }
  function frame() {
    const t = now(), dt = clamp(t - lastT, 0, .05);
    lastT = t;
    stepTurn(t); stepBubbles(t); stepSlosh(dt); stepFades(t);
    if (gl) { updateText(t); draw(t); }
    pruneText(t);
    raf = busy() ? requestAnimationFrame(frame) : 0;
  }
  function draw(t) {
    if (!gl) return;
    ripples = ripples.filter(r => t-r.t < LIFE);
    ripA.fill(0); ripB.fill(0);
    ripples.forEach((r,i) => { ripA[i*4]=r.x; ripA[i*4+1]=r.y; ripA[i*4+2]=r.t; ripA[i*4+3]=r.s; ripB.set(r.k, i*4); });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0,0,W,H);
    const u = mainProg.u;
    gl.useProgram(mainProg.p);
    gl.uniform4fv(u.uRip, ripA); gl.uniform4fv(u.uRipB, ripB); gl.uniform1i(u.uCount, ripples.length);
    gl.uniform1f(u.uTime, t);
    gl.uniform2f(u.uCss, cssW, cssH); gl.uniform1f(u.uDpr, W/cssW);
    gl.uniform3fv(u.uInk, C.inkShown); gl.uniform3fv(u.uInkOld, T.active ? T.inkOld : C.inkShown);
    gl.uniform3fv(u.uSeal, C.seal); gl.uniform3fv(u.uGold, C.gold);
    gl.uniform1f(u.uDark, C.dark); gl.uniform1f(u.uSlosh, slosh.x);
    gl.uniform1f(u.uPaperFade, paperFade ? paperFade.v : 0); gl.uniform1f(u.uOldInkA, oldInk ? oldInk.v : 0);
    const rolling = T.active && T.mode === 'roll';
    const ra = [0, 1, 1, 0], rb = [0, 1, 1, 0];
    if (rolling) for (const g of T.geo) (g.r.old ? ra : rb).splice(0, 4, g.c, g.R, g.r.dir, 1);
    gl.uniform1f(u.uRoll, rolling ? 1 : 0); gl.uniform4fv(u.uRollA, ra); gl.uniform4fv(u.uRollB, rb);
    gl.uniform1f(u.uUnder, T.under); gl.uniform3fv(u.uBare, T.bare); gl.uniform1f(u.uSlip, slipW); gl.uniform1f(u.uSlipOff, slipOff);
    const lg = T.active && T.mode === 'lay' ? layGeom(T.k) : null;
    gl.uniform1f(u.uLay, lg ? 1 : 0); gl.uniform1f(u.uLayF, lg ? lg.f : 0);
    gl.uniform1f(u.uLayR, lg ? lg.R : 1); gl.uniform1f(u.uLayTh, lg ? lg.th : 1); gl.uniform1f(u.uSoak, SOAK);
    gl.uniform3fv(u.uMatOld, T.matOld); gl.uniform3fv(u.uMatNew, T.matNew);
    bubA.fill(0);
    bubbles.forEach((b, i) => {
      const p = bubbleAt(b, t);
      bubA[i*4] = p.x; bubA[i*4+1] = p.y; bubA[i*4+2] = Math.max(p.r, .01); bubA[i*4+3] = p.r*.05;
    });
    gl.uniform4fv(u.uBub, bubA); gl.uniform1i(u.uBubN, bubbles.length);
    const tg = T.active && T.mode === 'turn' ? turnGeom(T.k) : null;
    gl.uniform1f(u.uTurn, tg ? 1 : 0); gl.uniform1f(u.uFold, tg ? tg.f : 0); gl.uniform1f(u.uRad, tg ? tg.R : 1);
    gl.uniform2f(u.uDir, DIR[0], DIR[1]); gl.uniform1f(u.uTurnFresh, T.fresh || T.ownInk ? 1 : 0);
    gl.uniform1f(u.uBulge, tg ? Math.sin(Math.PI*T.k) : 0);
    const bind = (unit, tex, loc) => { gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit); };
    bind(0, paperTex, u.uPaperTex); bind(1, textTex, u.uTextTex); bind(2, paperOld, u.uPaperOld); bind(3, textOld, u.uTextOld);
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
    const v = vertical();
    if (rect && v && rect.width>0) return (lastPt = local(rect.left+rect.width/2, rect.top));
    if (rect && !v && rect.height>0) return (lastPt = local(rect.left, rect.top+rect.height/2));
    // Line-break carets have no client rect and sit in their own "\n" node — measure with a marker.
    const m = measureCaretMarker();
    if (m) return (lastPt = m);
    const n=r.endContainer, o=r.endOffset;
    if (n.nodeType===3 && o>0) {
      const prev=n.data[o-1]; r.setStart(n,o-1);
      const b=pickRect(r);
      if (b) {
        const cs=getComputedStyle(sheet), sb=sheet.getBoundingClientRect(), lh=parseFloat(cs.lineHeight);
        if (v) {    // columns: a new line is the next column to the left, starting at the top
          if (prev==='\n') return (lastPt = local(b.left+b.width/2-lh, sb.top+parseFloat(cs.paddingTop)));
          return (lastPt = local(b.left+b.width/2, b.bottom));
        }
        if (prev==='\n') return (lastPt = local(sb.left+parseFloat(cs.paddingLeft), b.top+b.height/2+lh));
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
    if (vertical()) return rect.width ? local(rect.left + rect.width/2, rect.top) : null;
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
  // One glyph lands: its ripple follows the same stressed/unstressed beat as its note.
  function strike(g, x, y, delayMs) {
    if (isPunct(g)) { drop(x, y, .6, delayMs, 'punct'); Sound.punct(x, delayMs/1000); }
    else {
      const b = Sound.beat();
      drop(x, y, b.loud ? 1.0 + Math.random()*.12 : .66 + Math.random()*.1, delayMs, 'char');
      Sound.note(x, delayMs/1000, b);
    }
    freshInk.push({ x: x + sheet.scrollLeft, y: y + sheet.scrollTop, t: now() + delayMs/1000 });
    markLayout();
  }
  function splash(text) {
    if (!text) return;
    let pts = insertedPoints(text);
    if (!pts.length) {
      const p = caretPoint();
      if (!p) return;
      const gs = graphemes(text).filter(g => !isBlank(g));
      if (!gs.length) { drop(p.x, p.y, .45); Sound.space(p.x); return; }
      gs.slice(0, 8).forEach((g, k) => strike(g, p.x, p.y, k*50));
      return;
    }
    if (pts.length>24) pts = pts.slice(-24);
    const step = pts.length>1 ? Math.min(70, 1400/pts.length) : 0;
    pts.forEach((it,k) => strike(it.g, it.p.x, it.p.y, k*step));
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
    const reverse = e => { const s=e.buf, r=ctx.createBuffer(s.numberOfChannels, s.length, s.sampleRate);
      for(let c=0;c<s.numberOfChannels;c++){ const a=s.getChannelData(c), b=r.getChannelData(c), n=a.length; for(let i=0;i<n;i++) b[i]=a[n-1-i]; }
      return { hz:0, buf:r }; };

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
        if (out.splash) out.splashUp = reverse(out.splash);   // water drawn back up off a lifted sheet
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
    const ready = () => enabled && ctx && buffers;
    function tuned(target) {
      const bank = buffers && buffers.drop; if (!bank || !bank.length) return null;
      let best=-1, bd=1e9;
      for (let i=0;i<bank.length;i++){ if(i===lastDrop) continue; const d=Math.abs(Math.log2(bank[i].hz/target)); if(d<bd){bd=d;best=i;} }
      if (best<0) best=0; lastDrop=best;
      return { buf:bank[best].buf, rate: target/bank[best].hz };
    }

    return {
      ensure,
      get enabled() { return enabled; },
      toggle() { enabled=!enabled; try{localStorage.setItem('ripple.sound', enabled?'1':'0');}catch(e){}
        if (enabled) { ensure(); play(buffers&&buffers.round,{rate:1.1,gain:0.25,wet:0.3}); } return enabled; },
      // The phrase advances whether or not sound is on, so ripples keep the rhythm in silence too.
      beat() { const n = charN++; return { deg: PHRASE[n % PHRASE.length], loud: STRESSED.has(n % 7) }; },
      resetPhrase() { charN = 0; },
      note(x, when, b) { if (!ready()) return; const d = tuned(SCALE[b.deg]); if (!d) return;
        play(d, { rate:d.rate, gain:b.loud?0.5:0.34, pan:panOf(x), wet:0.14, when });
        play(pick(buffers.brush), { gain:0.11, pan:panOf(x), wet:0.1, when }); },
      punct(x, when) { if (!ready()) return;
        play(pick(buffers.pencil), { gain:0.5, pan:panOf(x), wet:0.05, when });
        const d = tuned(SCALE[10]); if (d) play(d, { rate:d.rate, gain:0.2, pan:panOf(x), wet:0.1, when }); },
      space(x) { if(!ready()) return; play(buffers.plop,{rate:1.5,gain:0.12,pan:panOf(x),wet:0.1}); },
      newline(x) { charN=0; if(!ready()) return; const p=panOf(x);
        play(buffers.sparkle,{gain:0.4,pan:p,wet:0.5}); play(buffers.round,{rate:0.9,gain:0.3,pan:p,wet:0.4}); },
      del(x) { if(!ready()) return; play(buffers.dark,{gain:0.4,pan:panOf(x),wet:0.3}); },
      tap(x) { if(!ready()) return; play(buffers.plop,{gain:0.4,pan:panOf(x),wet:0.3}); },
      stamp(x) { if(!ready()) return; const p=panOf(x);
        play(buffers.stamp_a,{gain:0.5,pan:p,wet:0.25}); play(buffers.plop,{rate:0.8,gain:0.35,when:0.01,pan:p,wet:0.6}); },
      imprint(x) { if(!ready()) return; const p=panOf(x);
        play(buffers.stamp_b,{gain:0.55,pan:p,wet:0.2}); play(buffers.plop,{rate:0.7,gain:0.3,when:0.02,pan:p,wet:0.6}); },
      lift() { if(!ready()) return;
        play(buffers.splashUp,{gain:0.2,wet:0.45}); play(pick(buffers.brush),{rate:0.55,gain:0.14,wet:0.3,when:0.06}); },
      lay() { if(!ready()) return;          // a sheet swept through the air and set down
        play(pick(buffers.brush),{rate:0.42,gain:0.2,wet:0.35}); play(pick(buffers.brush),{rate:0.6,gain:0.12,pan:0.4,wet:0.3,when:0.14}); },
      clack(x) { if(!ready()) return;
        play(pick(buffers.pencil),{rate:1.45+Math.random()*.6,gain:0.08+Math.random()*.04,pan:panOf(x),wet:0.12}); },
      drip(x) { if(!ready()) return; play(buffers.twodrip,{rate:0.92+Math.random()*0.16,gain:0.26,pan:panOf(x),wet:0.35}); },
      enter() { if(!ready()) return;
        play(buffers.round,{rate:0.7,gain:0.32,wet:0.55}); play(buffers.plop,{rate:0.6,gain:0.2,wet:0.5,when:0.05}); },
      bubble(x, when=0, gain=0.28) { if(!ready()) return; play(pick(buffers.bubble),{gain,pan:panOf(x),wet:0.3,when}); },
      idle(x) { if(!ready()) return; const d = tuned(SCALE[2 + (Math.random()*5|0)]);
        if (d) play(d,{rate:d.rate,gain:0.07,pan:panOf(x),wet:0.6}); },
    };
  })();

  /* ---------- Quiet presence: dim the margins while writing, a stray drop when idle ---------- */
  let dimTimer = 0, moved = 0, lastPtr = null, lastActive = performance.now(), nextIdle = 0;
  const onActivity = () => { lastActive = performance.now(); };
  function dimForWriting() {
    root.classList.add('writing'); moved = 0;
    clearTimeout(dimTimer); dimTimer = setTimeout(() => root.classList.remove('writing'), 2600);
  }
  function wirePresence() {
    document.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      if (lastPtr) moved += Math.abs(e.clientX - lastPtr[0]) + Math.abs(e.clientY - lastPtr[1]);
      lastPtr = [e.clientX, e.clientY];
      if (moved > 18 && root.classList.contains('writing')) { root.classList.remove('writing'); clearTimeout(dimTimer); }
    }, { passive:true });
    document.addEventListener('pointerdown', () => { skipIntro(); onActivity(); }, true);
    document.addEventListener('keydown', () => { skipIntro(); onActivity(); }, true);
    setInterval(() => {
      if (!gl || document.hidden || reduced() || T.active || root.classList.contains('intro')) return;
      const t = performance.now();
      if (t - lastActive < 10000 || t < nextIdle) return;
      nextIdle = t + 6000 + Math.random()*8000;
      const x = cssW*(.15 + Math.random()*.7), y = cssH*(.15 + Math.random()*.65);
      drop(x, y, .24, 0, 'idle'); Sound.idle(x);
    }, 1000);
  }

  /* ---------- Interaction ---------- */
  function wireRipples() {
    let lastCompEnd = -1e9, trail = null;
    // Capture deleted glyphs before they leave the DOM, so they can fade off the water.
    sheet.addEventListener('beforeinput', e => {
      if (!gl || !(e.inputType || '').startsWith('delete')) return;
      const list = [];
      for (const sr of (e.getTargetRanges ? e.getTargetRanges() : [])) {
        try { const r = document.createRange(); r.setStart(sr.startContainer, sr.startOffset); r.setEnd(sr.endContainer, sr.endOffset); list.push(r); } catch (_) {}
      }
      // plaintext-only editors report no target ranges in Chrome: measure what the key will take.
      const sel = getSelection();
      if (!list.length && sel.rangeCount) {
        if (!sel.isCollapsed) list.push(sel.getRangeAt(0).cloneRange());
        else if (sel.modify) {
          const it = e.inputType, saved = sel.getRangeAt(0).cloneRange();
          sel.modify('extend', /Backward/.test(it) ? 'backward' : 'forward',
                     /Word/.test(it) ? 'word' : /Line/.test(it) ? 'lineboundary' : 'character');
          if (sel.rangeCount && !sel.isCollapsed) list.push(sel.getRangeAt(0).cloneRange());
          sel.removeAllRanges(); sel.addRange(saved);
        }
      }
      for (const r of list) collectGhosts(r);
    });
    sheet.addEventListener('input', e => {
      markLayout(); onActivity(); dimForWriting();
      const it = e.inputType || '';
      if (e.isComposing || it==='insertCompositionText') { const p=caretPoint(); if(p) drop(p.x,p.y,0.22,0,'punct'); return; }
      if (it==='insertFromComposition') return;
      if (it==='insertText' && performance.now()-lastCompEnd<80) return;
      if (it.startsWith('delete')) { const p=caretPoint(); if(p){ drop(p.x,p.y,-0.6); Sound.del(p.x); } return; }
      if (it==='insertParagraph' || it==='insertLineBreak') { const p=caretPoint(); Sound.newline(p ? p.x : cssW/2); if(p) drop(p.x,p.y,1.5,0,'newline'); return; }
      const txt = e.data != null ? e.data : (e.dataTransfer ? e.dataTransfer.getData('text/plain') : '');
      if (txt) splash(txt);
      else { const p=caretPoint(); if(p){ drop(p.x,p.y,0.9); Sound.space(p.x); } }
    });
    sheet.addEventListener('compositionend', e => {
      lastCompEnd = performance.now();
      if (e.data) requestAnimationFrame(() => splash(e.data));
    });
    sheet.addEventListener('pointerdown', e => {
      Sound.ensure(); const p=local(e.clientX,e.clientY); drop(p.x,p.y,0.55); Sound.tap(p.x);
      trail = { id:e.pointerId, x:p.x, y:p.y };
    });
    // Drawing a finger or pen through the water leaves a wake of small rings.
    sheet.addEventListener('pointermove', e => {
      if (!trail || e.pointerId !== trail.id || !e.buttons) return;
      const p = local(e.clientX, e.clientY);
      if (Math.hypot(p.x-trail.x, p.y-trail.y) < 26) return;
      trail.x = p.x; trail.y = p.y;
      if (ripples.length < 44) drop(p.x, p.y, .2, 0, 'trail');
    });
    const endTrail = () => { trail = null; };
    sheet.addEventListener('pointerup', endTrail);
    sheet.addEventListener('pointercancel', endTrail);
    sheet.addEventListener('keydown', () => Sound.ensure(), { once:true });
    let lastScroll = sheet.scrollTop + sheet.scrollLeft;
    sheet.addEventListener('scroll', () => {
      const pos = sheet.scrollTop + sheet.scrollLeft, d = pos - lastScroll; lastScroll = pos;
      if (gl && !reduced()) { slosh.v = clamp(slosh.v + d*.05, -4, 4); slosh.on = true; }
      markLayout();
    }, { passive:true });
  }

  /* ---------- Seal: press it where it stands, or carry it onto the paper ---------- */
  function wireSeal() {
    let drag = null;
    const doStamp = () => {
      Sound.ensure();
      restart(sealEl, 'press');
      const r = sealEl.getBoundingClientRect(), p = local(r.left + r.width/2, r.top + r.height/2);
      setTimeout(() => { drop(p.x,p.y,1.6,0,'seal'); drop(p.x,p.y,-0.8,260,'seal'); Sound.stamp(p.x); }, reduced() ? 0 : 200);
    };
    const placeGhost = (g, x, y) => { g.style.setProperty('--gx', x + 'px'); g.style.setProperty('--gy', y + 'px'); };
    const makeGhost = rot => {
      const g = sealEl.cloneNode(true);
      for (const a of ['id','role','tabindex','aria-label','title']) g.removeAttribute(a);
      g.setAttribute('aria-hidden', 'true');
      g.className = 'seal seal-ghost';
      g.style.setProperty('--gr', rot + 'rad');
      document.body.appendChild(g);
      return g;
    };
    sealEl.addEventListener('animationend', () => sealEl.classList.remove('press'));
    sealEl.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); Sound.ensure();
      drag = { id:e.pointerId, x0:e.clientX, y0:e.clientY, ghost:null, rot:0 };
      try { sealEl.setPointerCapture(e.pointerId); } catch (_) {}
    });
    sealEl.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.ghost) {
        if (!gl || Math.hypot(e.clientX-drag.x0, e.clientY-drag.y0) < 6) return;
        drag.rot = (-1.5 + Math.random()*8 - 4) * Math.PI/180;
        drag.ghost = makeGhost(drag.rot);
        sealEl.classList.add('lifted');
      }
      placeGhost(drag.ghost, e.clientX, e.clientY);
    });
    const end = (e, cancel) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      if (!d.ghost) { if (!cancel) doStamp(); return; }
      sealEl.classList.remove('lifted');
      const hit = cancel ? null : document.elementFromPoint(e.clientX, e.clientY);
      if (!hit || hit.closest('.bar, .mark')) {
        d.ghost.classList.add('away'); setTimeout(() => d.ghost.remove(), 260); return;
      }
      d.ghost.classList.add('land');
      const p = local(e.clientX, e.clientY);
      setTimeout(() => {
        addImprint(p.x, p.y, d.rot);
        drop(p.x,p.y,1.4,0,'seal'); drop(p.x,p.y,-0.7,240,'seal'); Sound.imprint(p.x);
      }, reduced() ? 0 : 160);
      setTimeout(() => d.ghost.remove(), 320);
    };
    sealEl.addEventListener('pointerup', e => end(e, false));
    sealEl.addEventListener('pointercancel', e => end(e, true));
    sealEl.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' '){ e.preventDefault(); doStamp(); } });
  }

  /* ---------- Count, paper picker, sound, new sheet ---------- */
  let countMode = 'idle', countN = -1;
  function updateCount() {
    if (document.activeElement !== sheet) {
      if (countMode !== 'idle') { countMode = 'idle'; countN = -1; countEl.textContent = '点一下纸面，开始写字'; restart(countEl, 'swap'); }
      return;
    }
    const n = graphemes(sheet.textContent).filter(g=>!isBlank(g)).length;
    if (countMode !== 'count') {
      countMode = 'count';
      const num = document.createElement('span'); num.className = 'num'; num.textContent = n;
      countEl.textContent = '已写 '; countEl.append(num, ' 字');
      restart(countEl, 'swap'); countN = n; return;
    }
    if (n !== countN) {
      const num = countEl.querySelector('.num');
      num.textContent = n; num.classList.remove('up', 'down'); void num.offsetWidth;
      num.classList.add(n > countN ? 'up' : 'down'); countN = n;
    }
  }
  let nameTok = 0;
  function showName(text, preview) {
    const tok = ++nameTok;
    if (paperName.textContent === text) { paperName.classList.toggle('preview', preview); paperName.style.opacity = ''; return; }
    paperName.style.opacity = '0';
    setTimeout(() => { if (tok !== nameTok) return;
      paperName.textContent = text; paperName.classList.toggle('preview', preview); paperName.style.opacity = ''; }, 120);
  }
  function markPreset(p) {
    chosen = p;
    for (const chip of papersEl.querySelectorAll('.chip'))
      chip.setAttribute('aria-pressed', String(chip.dataset.id === p.id));
    showName(p.name, false);
    try { localStorage.setItem('ripple.paper', p.id); } catch (e) {}
  }
  function wireUI() {
    sheet.addEventListener('input', updateCount);
    sheet.addEventListener('focus', updateCount);
    sheet.addEventListener('blur', updateCount);
    freshBtn.addEventListener('click', freshSheet);

    for (const p of PAPERS) {
      const chip = document.createElement('button');
      chip.type='button'; chip.className='chip'; chip.dataset.id=p.id;
      chip.style.setProperty('--sw', p.swatch);
      chip.title = p.name; chip.setAttribute('aria-label', '背景纸：'+p.name);
      chip.setAttribute('aria-pressed', 'false');
      chip.addEventListener('click', () => choosePaper(p));
      const peek = () => showName(p.name, p.id !== chosen.id), back = () => showName(chosen.name, false);
      chip.addEventListener('pointerenter', peek); chip.addEventListener('focus', peek);
      chip.addEventListener('pointerleave', back); chip.addEventListener('blur', back);
      papersEl.appendChild(chip);
    }

    const syncSound = () => { const on=Sound.enabled; soundBtn.classList.toggle('on',on);
      soundBtn.setAttribute('aria-pressed', String(on)); soundText.textContent = on?'音效':'静音'; };
    soundBtn.addEventListener('click', () => {
      if (Sound.toggle() && !reduced()) { restart(soundBtn, 'ping'); setTimeout(() => soundBtn.classList.remove('ping'), 1200); }
      syncSound();
    });
    syncSound();
  }

  /* ---------- Opening: the poem settles onto the water one character at a time ---------- */
  let introBegun = false;
  const introTimers = [];
  function intro() {
    if (introBegun) return; introBegun = true;
    root.classList.remove('intro-wait');
    if (reduced()) { introStart = -Infinity; markLayout(); return; }
    let sealAt = 1600;
    if (gl) {
      const pts = [];
      const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
      for (let node=walker.nextNode(); node; node=walker.nextNode()) pts.push(...pointsOf(node,0,node.data));
      introStart = now();
      pts.slice(0, 48).forEach((it,i) => drop(it.p.x, it.p.y, 0.7, 200+i*85));
      sealAt = Math.min(4400, 200 + Math.min(pts.length, 48)*85 + 250);
      markLayout();
    }
    root.style.setProperty('--seal-delay', sealAt + 'ms');
    root.classList.add('intro');
    introTimers.push(setTimeout(() => {
      const r = sealEl.getBoundingClientRect(), p = local(r.left + r.width/2, r.top + r.height/2);
      drop(p.x, p.y, 1.2, 0, 'seal');
    }, sealAt + 300));
    introTimers.push(setTimeout(endIntro, sealAt + 650));
  }
  function endIntro() {
    introTimers.forEach(clearTimeout); introTimers.length = 0;
    root.classList.remove('intro');
    if (introStart !== -Infinity) { introStart = -Infinity; markLayout(); }
  }
  function skipIntro() {
    if (!introBegun) { introBegun = true; root.classList.remove('intro-wait'); introStart = -Infinity; markLayout(); return; }
    if (!root.classList.contains('intro')) return;
    const t = now(); ripples = ripples.filter(r => r.t <= t);
    endIntro();
  }

  /* ---------- Boot ---------- */
  wireUI();
  let saved = 'xuan';
  try { saved = localStorage.getItem('ripple.paper') || 'xuan'; } catch (e) {}
  const first = PAPERS.find(p=>p.id===saved) || PAPERS[0];
  setColors(first); setLayout(first); chosen = first; paperName.textContent = first.name;
  for (const chip of papersEl.querySelectorAll('.chip')) chip.setAttribute('aria-pressed', String(chip.dataset.id === first.id));

  wireRipples();
  wireSeal();
  wirePresence();
  if (gl) { new ResizeObserver(resize).observe(canvas); }
  resize();
  window.addEventListener('resize', () => { if(!gl) resize(); });
  document.fonts.addEventListener('loadingdone', markLayout);

  document.fonts.ready.then(intro);
  setTimeout(intro, 1500);
})();
