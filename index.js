// -- Caustics Art Project --
// Modifications by Skyler Fly-Wilson
// Forked from Martin Renous repo https://github.com/martinRenou/threejs-caustics

// Random Hashes and IDs for testing
function genTokenData(projectNum) {
  let data = {};
  let hash = "0x";
  for (var i = 0; i < 64; i++) hash += Math.floor(Math.random() * 16).toString(16);
  data.hash = hash;
  data.tokenId = ( projectNum * 1000000 + Math.floor(Math.random()*1000) ).toString();
  return data;
}
tokenData = genTokenData(11111);

// Allow ?h=0x... URL override of the token hash. Applied before Random() is
// constructed so the seeded PRNG uses the override hash.
const URL_PARAMS = new URLSearchParams(window.location.search);
if (URL_PARAMS.has('h')) {
  tokenData.hash = URL_PARAMS.get('h');
  tokenData.tokenId = '0';
}

// Static Hash and ID
// tokenData = {
//   hash: "0x11ac16678959949c12d5410212301960fc496813cbc3495bf77aeed738579738",
//   tokenId: "123000456",
// };
// let projectNumber = Math.floor(parseInt(tokenData.tokenId) / 1000000);
// let mintNumber = parseInt(tokenData.tokenId) % 1000000;

// Seedable Randomness Source (from ArtBlocks)
class Random {
  constructor() {
    this.useA = false;
    let sfc32 = function (uint128Hex) {
      let a = parseInt(uint128Hex.substring(0, 8), 16);
      let b = parseInt(uint128Hex.substring(8, 16), 16);
      let c = parseInt(uint128Hex.substring(16, 24), 16);
      let d = parseInt(uint128Hex.substring(24, 32), 16);
      return function () {
        a |= 0;
        b |= 0;
        c |= 0;
        d |= 0;
        let t = (((a + b) | 0) + d) | 0;
        d = (d + 1) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11);
        c = (c + t) | 0;
        return (t >>> 0) / 4294967296;
      };
    };
    // seed prngA with first half of tokenData.hash
    this.prngA = new sfc32(tokenData.hash.substring(2, 34));
    // seed prngB with second half of tokenData.hash
    this.prngB = new sfc32(tokenData.hash.substring(34, 66));
    for (let i = 0; i < 1e6; i += 2) {
      this.prngA();
      this.prngB();
    }
  }
  // random number between 0 (inclusive) and 1 (exclusive)
  random_dec() {
    this.useA = !this.useA;
    return this.useA ? this.prngA() : this.prngB();
  }
  // random number between a (inclusive) and b (exclusive)
  random_num(a, b) {
    return a + (b - a) * this.random_dec();
  }
  // random integer between a (inclusive) and b (inclusive)
  // requires a < b for proper probability distribution
  random_int(a, b) {
    return Math.floor(this.random_num(a, b + 1));
  }
  skewedRandom(a) {
      var power = 5; // Increase power to skew more towards smaller numbers
      return Math.ceil(Math.pow(this.random_dec(), power) * a);
  }
}

// Create a Random object for prng. Reassigned by reroll() to give the user
// fresh traits without a page reload.
let rng = new Random()

// FPS panel lives inside the settings drawer (#stats-container) so it
// doesn't crowd the canvas. Reset stats.js's fixed-corner positioning so
// it renders inline within the drawer.
const stats = new Stats()
stats.showPanel(0)
stats.domElement.style.position = 'static'
const statsContainer = document.getElementById('stats-container')
;(statsContainer || document.body).appendChild(stats.domElement)

// == Config==
const canvas = document.getElementById('canvas')
canvas.width = window.innerWidth
canvas.height = window.innerHeight
const width = canvas.width
const height = canvas.height

// TODO: create non linear mappings of random traits
// TODO: create floor reliefs as traits (maybe noise and pattern based normal maps?)
// Art Controls and Config
let simRes = 2**11
let soundReactive = false
let mouseReactive = false
let showWater = true
let renderObjects = false
let focusWater = false
let raindrops = true
let intensity = 0.2
let intensityVariability = 0.2
let intensityVariationVector = 0
let randPos = true
let wind = false
let windIntensity = 0.01
let windStrength = 1.0          // Multiplier on gust droplet size, mass, and count
let randomStart = true // Default token render state
let randomStartModes = true // On init / reroll, also fire a random cymatic mode
let polygonSides = rng.random_int(3,34) // ~ Trait
let scale = rng.random_int(1,10) // ~ Trait
let startDrops = rng.random_int(10,55) + scale // ~ Trait
let dAmt = rng.skewedRandom(1000)
let dilation = rng.random_dec() < .1 ? (rng.random_dec() < .5 ? [dAmt, 1]: [1, dAmt]) : [1,1] // ~ Trait
// delta is the neighbor-sampling distance for the laplacian, in UV space.
// At waterSize=1024, one texel is 1/1024 ~ 9.8e-4. Smaller divisor = wider
// stencil = softer waves; larger divisor = tighter stencil = crisper detail.
// 1024 = one texel (canonical finite-difference). Tightest stencil before
// stability breaks down.
let deltaRates = dilation.map( d => 1/(1024*d))
// Damping scales with scale so larger scales settle faster. Coefficient
// bumped from 0.0005 to 0.002 so waves settle in a few seconds instead of
// many - adjustable live via the settings drawer.
let attenuate = 1.0 - (0.002 * scale)
console.log("Attenuation: ", attenuate);

let phase = 0;
let omega = 2.0 * Math.PI * 1.0; // 0.5 Hz for testing (slow and visible)

console.log("Sides: ", polygonSides)
console.log("Scale: ", scale)
console.log("Drops: ", startDrops)
console.log("Time: ", dilation)

// state vars for simulating water effects
let gusting = false
let gustLength = 0
let gustStart = 0
let gustPosition,gustSize,gustMass

// === Cymatics tuning ===
// Audio-reactive cymatic bands. Each audio band drives one (m, n) mode at
// its own omega. Low audio frequencies map to simple modes / slow drives;
// high audio frequencies map to higher-order modes / faster drives.
//   loHz, hiHz: audio frequency range to integrate into this band
//   m, n: cymatic mode shape (angular lobes, radial bands)
//   omega: simulation drive angular frequency in rad/s
// Hand-tuned to walk diagonally through (m, n) space and the well-balanced
// 0.3-5.0 rad/s omega range.
let audioBands = [
  { name: 'subBass', loHz: 20,    hiHz: 60,    m: 1, n: 1, omega: 0.4, smooth: 0 },
  { name: 'bass',    loHz: 60,    hiHz: 250,   m: 2, n: 1, omega: 0.8, smooth: 0 },
  { name: 'lowMid',  loHz: 250,   hiHz: 500,   m: 3, n: 2, omega: 1.2, smooth: 0 },
  { name: 'mid',     loHz: 500,   hiHz: 2000,  m: 4, n: 2, omega: 1.8, smooth: 0 },
  { name: 'highMid', loHz: 2000,  hiHz: 4000,  m: 6, n: 3, omega: 2.5, smooth: 0 },
  { name: 'treble',  loHz: 4000,  hiHz: 12000, m: 8, n: 3, omega: 3.5, smooth: 0 },
];
// Overall amplitude scaling for audio-driven modes
let audioGain = 0.001;
// Exponential smoothing factor for per-band magnitude (0 = no smoothing,
// closer to 1 = more smoothing / slower response).
let audioSmoothing = 0.2;
// Gate threshold below which a band is treated as silent
let audioGate = 0.04;

// === Resonance model ===
// Circular-drum eigenfrequencies: bessel_zeros[m][n-1] = alpha_{m,n}, the
// n-th positive zero of J_m. Modes 0..8 angular, 1..5 radial.
const bessel_zeros = [
  [2.4048,  5.5201,  8.6537, 11.7915, 14.9309], // m=0
  [3.8317,  7.0156, 10.1735, 13.3237, 16.4706], // m=1
  [5.1356,  8.4172, 11.6198, 14.7960, 17.9598], // m=2
  [6.3802,  9.7610, 13.0152, 16.2235, 19.4094], // m=3
  [7.5883, 11.0647, 14.3725, 17.6160, 20.8269], // m=4
  [8.7715, 12.3386, 15.7002, 18.9801, 22.2178], // m=5
  [9.9361, 13.5893, 17.0038, 20.3208, 23.5861], // m=6
  [11.0864, 14.8213, 18.2876, 21.6415, 24.9349], // m=7
  [12.2251, 16.0378, 19.5545, 22.9452, 26.2668], // m=8
];

const SIM_DT = 1/30;    // nominal step interval gated by the animate loop
const SIM_C  = 0.25;    // c uniform on simUpdateFrag
const SIM_R  = 0.9;     // simulation domain radius (CircleGeometry)

// Estimated natural angular frequency (rad/s wall-clock) of cymatic mode
// (m, n) given the current sim. Uses the circular-drum approximation;
// dilation enters via the geometric mean of the two directional deltas.
function computeEigenOmega(m, n) {
  let alpha;
  if (m >= 0 && m < bessel_zeros.length && n >= 1 && n <= bessel_zeros[m].length) {
    alpha = bessel_zeros[m][n - 1];
  } else {
    // McMahon's asymptotic fallback for modes outside the table
    alpha = (n + m / 2 - 0.25) * Math.PI;
  }
  const dx = Math.sqrt(deltaRates[0] * deltaRates[1]);
  return Math.sqrt(SIM_C) * alpha / SIM_R * (dx / SIM_DT);
}

// When true, audio bands + random mode drive at the computed eigenfrequency
// for the mode (so they hit true resonance). When false, they use the
// hand-tuned omega values configured per band / random uniform.
let eigenTune = true;
// Gain compensation curve parameters (used inside addMode).
let OMEGA_REF = 0.83;
let OMEGA_EXP = 0.3;
// Bounds for the 'p' random-mode roll
let randomMaxM = 8;
let randomMaxN = 5;
// Fixed-mode test (key 'y')
let modeTest = false
let modeTestM = 4
let modeTestN = 2
let modeTestOmega = 1.0
let modeTestAmp = 0.001
// Sweep test (key 't'): sweeps omega over a range and logs which lock in
let modeSweep = false
let sweepM = 4
let sweepN = 2
let sweepOmegaMin = 0.1
let sweepOmegaMax = 20.0
let sweepDuration = 30000  // ms
let sweepStartTime = 0
let sweepLastLog = 0
// Random resonance (key 'p'): re-rolls a random (m,n,omega) and drives it
let modeRandom = false
let modeRandomM = 4
let modeRandomN = 2
let modeRandomOmega = 1.0
let modeRandomAmp = 0.001
function rollRandomMode() {
  modeRandomM = Math.floor(Math.random() * randomMaxM) + 1;  // 1..randomMaxM
  modeRandomN = Math.floor(Math.random() * randomMaxN) + 1;  // 1..randomMaxN
  modeRandomOmega = eigenTune
    ? computeEigenOmega(modeRandomM, modeRandomN)
    : Math.exp(Math.log(0.3) + Math.random() * Math.log(5.0/0.3));
  modeRandomAmp = 0.001;
  console.log(`random mode: m=${modeRandomM}, n=${modeRandomN}, omega=${modeRandomOmega.toFixed(3)} rad/s (eigenTune=${eigenTune})`);
}

// Constants
const black = new THREE.Color('black')
const white = new THREE.Color('white')
const waterPosition = new THREE.Vector3(0, 0, 4)
const surfacePosition = new THREE.Vector3(0, 0, 0)
const near = 0
const far = 4
const waterSize = 1024

// Create Renderer
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(53, width/height, 0.01, 100)
camera.position.set(0, 0, 2)
camera.up.set(1, 0, 1)
scene.add(camera)

// Create directional light
const lightCamera = new THREE.OrthographicCamera(-1.2, 1.2, 1.2, -1.2, near, far)
lightCamera.position.set(0, 0, far)

const light = new THREE.DirectionalLight(0xfff, 1);
light.position.set(0, 0, -1);
scene.add(light);
light.target.position.set(0, 0, -0.5);
scene.add(light.target);

const renderer = new THREE.WebGLRenderer({canvas: canvas, antialias: true, alpha: true});
renderer.setSize(width, height);
renderer.autoClear = false;
renderer.setPixelRatio( window.devicePixelRatio * 1.5 );

// Environment
const floorGeometry = new THREE.PlaneBufferGeometry(100, 100, 1, 1);

const objLoader = new THREE.OBJLoader();
let shark;
const sharkLoaded = new Promise((resolve) => {
  objLoader.load('assets/WhiteShark.obj', (sharkGeometry) => {
    sharkGeometry = sharkGeometry.children[0].geometry;
    sharkGeometry.computeVertexNormals();
    sharkGeometry.scale(0.12, 0.12, 0.12);
    sharkGeometry.rotateX(Math.PI / 2.);
    sharkGeometry.rotateZ(-Math.PI / 2.);
    sharkGeometry.translate(0, 0, 0.4);

    shark = sharkGeometry;
    resolve();
  });
});

let rock1;
let rock2;
const rockLoaded = new Promise((resolve) => {
  objLoader.load('assets/rock.obj', (rockGeometry) => {
    rockGeometry = rockGeometry.children[0].geometry;
    rockGeometry.computeVertexNormals();

    rock1 = new THREE.BufferGeometry().copy(rockGeometry);
    rock1.scale(0.05, 0.05, 0.02);
    rock1.translate(0.2, 0., 0.1);

    rock2 = new THREE.BufferGeometry().copy(rockGeometry);
    rock2.scale(0.05, 0.05, 0.05);
    rock2.translate(-0.5, 0.5, 0.2);
    rock2.rotateZ(Math.PI / 2.);

    resolve();
  });
});

let plant;
const plantLoaded = new Promise((resolve) => {
  objLoader.load('assets/plant.obj', (plantGeometry) => {
    plantGeometry = plantGeometry.children[0].geometry;
    plantGeometry.computeVertexNormals();

    plant = plantGeometry;
    plant.rotateX(Math.PI / 6.);
    plant.scale(0.03, 0.03, 0.03);
    plant.translate(-0.5, 0.5, 0.);

    resolve();
  });
});

class Audio {
  constructor() {
    this.frequencyData = null;
    this.analyser = null;
    this.micLoaded = false;
    this.audioLoaded = false;
  }
  startAudio() {
    // Get audio context and create an analyser node
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = audioContext.createAnalyser();
    // fftSize=2048 gives 1024 freq bins, ~21 Hz/bin at 44.1 kHz - enough
    // resolution for the bass/sub-bass bands that drive the largest modes.
    this.analyser.fftSize = 2048;
    // smoothingTimeConstant smooths the FFT magnitudes in the analyser node
    // itself; our per-band audioSmoothing then layers on top.
    this.analyser.smoothingTimeConstant = 0.5;

    try {
      // Get the microphone stream
      this.micLoaded = navigator.mediaDevices.getUserMedia({audio: true}).then( (value) => {
        // Connect the microphone stream to the analyser node
        const microphone = audioContext.createMediaStreamSource(value);
        microphone.connect(this.analyser);
        console.log("sound loading")
        // Get the frequency data from the analyser
        this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
        this.audioLoaded = true;
        console.log("sound loaded")
      });
    } catch(err) {console.log(err)} finally {}
  }
}

// Ray caster for mouse interaction
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const targetgeometry = new THREE.PlaneGeometry(2, 2);
for (let vertex of targetgeometry.vertices) vertex.z = waterPosition.z;
const targetmesh = new THREE.Mesh(targetgeometry);

const simUpdateFrag = `
  precision highp float;

  uniform sampler2D texture;
  uniform vec2 delta;
  uniform float damping;
  uniform float c;

  varying vec2 coord;

  void main() {
      vec4 info = texture2D(texture, coord);

      float h = info.r;
      float h_prev = info.g;

      vec2 dx = vec2(delta.x, 0.0);
      vec2 dy = vec2(0.0, delta.y);

      float hL = texture2D(texture, coord - dx).r;
      float hR = texture2D(texture, coord + dx).r;
      float hD = texture2D(texture, coord - dy).r;
      float hU = texture2D(texture, coord + dy).r;
      // Corner samples for 9-point isotropic laplacian (kills grid-aligned
      // cross/diamond artifacts that come from the 5-point stencil).
      float hNE = texture2D(texture, coord + dx + dy).r;
      float hNW = texture2D(texture, coord - dx + dy).r;
      float hSE = texture2D(texture, coord + dx - dy).r;
      float hSW = texture2D(texture, coord - dx - dy).r;

      // 9-point isotropic laplacian (Patra-Karttunen): cardinal weight 4,
      // corner weight 1, center weight -20, normalized by 1/6 so the wave
      // speed roughly matches the old 5-point version at the same c.
      float lap = (4.0*(hL + hR + hD + hU) + (hNE + hNW + hSE + hSW) - 20.0*h) / 6.0;

      float h_new = 2.0 * h - h_prev + c * lap;
      h_new *= damping;

      // Store surface gradient in .ba so the water/caustics shaders get correct normals
      gl_FragColor = vec4(h_new, h, hR - hL, hU - hD);
  }
`;
const simDropFrag = `
    precision highp float;
    precision highp int;
    const float PI = 3.141592653589793;
    uniform sampler2D texture;
    uniform vec2 center;
    uniform float radius;
    uniform float strength;
    uniform float falloff;
    varying vec2 coord;
    void main() {
      vec4 info = texture2D(texture, coord);
      float drop = max(0.0, 1.0 - length(center * 0.5 + 0.5 - coord) / radius);
      drop = pow(drop, falloff);
      info.r += drop * strength;
      gl_FragColor = info;
    }
`;
const simModeFrag = `
precision highp float;

uniform sampler2D texture;
uniform float radius;
uniform float m;
uniform float n;
uniform float amplitude;
uniform float time;
uniform float omega;

varying vec2 coord;

void main() {
    vec2 p = coord * 2.0 - 1.0;
    float r = length(p);

    vec4 info = texture2D(texture, coord);
    float h = info.r;
    float h_prev = info.g;

    if (r < radius) {
        float theta = atan(p.y, p.x);
        float mode = cos(m * theta) * sin(n * 3.14159265 * r / radius);
        float drive = sin(time * omega);
        // v_eff = h - h_prev, so to add velocity dv we subtract dv from h_prev
        h_prev -= mode * amplitude * drive;
    }

    gl_FragColor = vec4(h, h_prev, info.b, info.a);
}
`;
const resetFrag = `
    precision highp float;
    void main() {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    }
`;
const simVert = `
    attribute vec3 position;
    varying vec2 coord;
    void main() {
      coord = position.xy * 0.5 + 0.5;
      gl_Position = vec4(position.xyz, 1.0);
    }
`;
class WaterSimulation {

  constructor() {
    this._camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0, 2000);
    this._geometry = new THREE.CircleGeometry(0.9, polygonSides);
    this._targetA = new THREE.WebGLRenderTarget(waterSize, waterSize, {type: THREE.FloatType});
    this._targetB = new THREE.WebGLRenderTarget(waterSize, waterSize, {type: THREE.FloatType});
    this.target = this._targetA;

    const modeMaterial = new THREE.RawShaderMaterial({
      uniforms: {
        texture: { value: null },
        radius: { value: 0.9 },
        m: { value: 6.0 },
        n: { value: 1.0 },
        amplitude: { value: 0.000001 },
        time: { value: 0.0 },
        omega: { value: 6.28 }, // 2π rad/sec initially
      },
      vertexShader: simVert,
      fragmentShader: simModeFrag,
    });

    const dropMaterial = new THREE.RawShaderMaterial({
      uniforms: {
        center: { value: [0, 0] },
        radius: { value: 0 },
        strength: { value: 0 },
        falloff: { value: 2.0 },
        texture: { value: null },
      },
      vertexShader: simVert,
      fragmentShader: simDropFrag,
    });

    const updateMaterial = new THREE.RawShaderMaterial({
      uniforms: {
        delta: { value: deltaRates },
        damping: { value: attenuate },
        c: { value: 0.25 },
        texture: { value: null },
      },
      vertexShader: simVert,
      fragmentShader: simUpdateFrag,
    });

    this._modeMesh = new THREE.Mesh(this._geometry, modeMaterial);
    this._dropMesh = new THREE.Mesh(this._geometry, dropMaterial);
    this._updateMesh = new THREE.Mesh(this._geometry, updateMaterial);
  }
  
  resetSimulation(renderer) {
    // Clear via GL framebuffer clear (not a polygon-bounded shader pass)
    // so every pixel in both ping-pong targets goes to zero. Previously
    // we rendered a reset shader using the polygon geometry, which left
    // pixels outside the polygon untouched - a problem after reroll
    // changes polygonSides, since the old-shape wave data persisted in
    // the new shape's "outside" region and bled back in through the
    // laplacian's neighbor sampling. Also only one target was cleared,
    // so stale data returned on the next ping-pong swap.
    const oldTarget = renderer.getRenderTarget();
    const oldClearColor = renderer.getClearColor(new THREE.Color());
    const oldClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(black, 0);
    renderer.setRenderTarget(this._targetA);
    renderer.clear();
    renderer.setRenderTarget(this._targetB);
    renderer.clear();
    renderer.setRenderTarget(oldTarget);
    renderer.setClearColor(oldClearColor, oldClearAlpha);
    this.target = this._targetA;
  }

  // Add a drop of water at the (x, y) coordinate (in the range [-1, 1])
  addDrop(renderer, x, y, radius, strength) {
    const { uniforms } = this._dropMesh.material;
    // Mild radius shrink at high scale keeps drops feeling smaller without crushing energy.
    // The previous full 1/scale divide was compensating for the broken sim and is no longer needed.
    const sizeFactor = 1 / Math.sqrt(scale);
    Object.assign(uniforms, {
      'center': { value: [x, y] },
      'radius': { value: radius * sizeFactor },
      'strength': { value: strength }
    });
    this._render(renderer, this._dropMesh);
  }

  // Add an eigenmode (m, n) to the water surface.
  // omega is the drive angular frequency in rad/s (sim time, not audio Hz).
  addMode(renderer, m, n, omega, amp) {
    if (!this._modeMesh) return;
    // Compensate frequency-dependent gain. Module-level OMEGA_REF / OMEGA_EXP
    // are live-tunable via the Options drawer.
    const effectiveAmp = amp * Math.pow(omega / OMEGA_REF, OMEGA_EXP);
    this._modeMesh.material.uniforms.m.value = m;
    this._modeMesh.material.uniforms.n.value = n;
    this._modeMesh.material.uniforms.time.value = performance.now() * 0.001;
    this._modeMesh.material.uniforms.omega.value = omega;
    this._modeMesh.material.uniforms.amplitude.value = effectiveAmp;
    this._render(renderer, this._modeMesh);
  }

  stepSimulation(renderer) {
    this._render(renderer, this._updateMesh);
  }

  // Live setter for the damping coefficient (0..1; lower = more damping).
  setDamping(value) {
    this._updateMesh.material.uniforms.damping.value = value;
  }

  setWaveSpeed(value) {
    this._updateMesh.material.uniforms.c.value = value;
  }

  setDropFalloff(value) {
    this._dropMesh.material.uniforms.falloff.value = value;
  }

  // Replace the simulation domain shape (used by reroll() to change the
  // polygonSides trait). All three sim passes share the same geometry, so
  // dispose the old and reassign on each mesh.
  rerollGeometry(sides) {
    this._geometry.dispose();
    this._geometry = new THREE.CircleGeometry(0.9, sides);
    this._modeMesh.geometry = this._geometry;
    this._dropMesh.geometry = this._geometry;
    this._updateMesh.geometry = this._geometry;
  }

  // Live setter for the laplacian neighbor-sampling distance.
  setDelta(deltaArray) {
    this._updateMesh.material.uniforms.delta.value = deltaArray;
  }

  _render(renderer, mesh) {
    // Swap textures
    const _oldTarget = this.target;
    const _newTarget = this.target === this._targetA ? this._targetB : this._targetA;
    const oldTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(_newTarget);
    mesh.material.uniforms['texture'].value = _oldTarget.texture;
    // TODO Camera is useless here, what should be done?
    renderer.render(mesh, this._camera);
    renderer.setRenderTarget(oldTarget);
    this.target = _newTarget;
  }
}

const waterFrag = `
  uniform sampler2D envMap;
  uniform samplerCube skybox;
  varying vec2 refractedPosition[3];
  varying vec3 reflected;
  varying float reflectionFactor;
  void main() {
    // Color coming from the sky reflection
    vec3 reflectedColor = textureCube(skybox, reflected).xyz;
    // Color coming from the environment refraction, applying chromatic aberration
    vec3 refractedColor = vec3(1.);
    refractedColor.r = texture2D(envMap, refractedPosition[0] * 0.5 + 0.5).r;
    refractedColor.g = texture2D(envMap, refractedPosition[1] * 0.5 + 0.5).g;
    refractedColor.b = texture2D(envMap, refractedPosition[2] * 0.5 + 0.5).b;
    gl_FragColor = vec4(mix(refractedColor, reflectedColor, clamp(reflectionFactor, 0., 1.)), 1.);
  }
`;
const waterVert = `
    uniform sampler2D water;
    uniform float eta;
    uniform float fresnelBias;
    uniform float fresnelScale;
    uniform float fresnelPower;
    varying vec2 refractedPosition[3];
    varying vec3 reflected;
    varying float reflectionFactor;
    const float refractionFactor = 1.;
    void main() {
      vec4 info = texture2D(water, position.xy * 0.5 + 0.5);
      // The water position is the vertex position on which we apply the height-map
      vec3 pos = vec3(position.xy, position.z + info.r);
      vec3 norm = normalize(vec3(info.b, sqrt(1.0 - dot(info.ba, info.ba)), info.a)).xzy;
      vec3 eye = normalize(pos - cameraPosition);
      vec3 refracted = normalize(refract(eye, norm, eta));
      reflected = normalize(reflect(eye, norm));
      reflectionFactor = fresnelBias + fresnelScale * pow(1. + dot(eye, norm), fresnelPower);
      mat4 proj = projectionMatrix * modelViewMatrix;
      vec4 projectedRefractedPosition = proj * vec4(pos + refractionFactor * refracted, 1.0);
      refractedPosition[0] = projectedRefractedPosition.xy / projectedRefractedPosition.w;
      projectedRefractedPosition = proj * vec4(pos + refractionFactor * normalize(refract(eye, norm, eta * 0.96)), 1.0);
      refractedPosition[1] = projectedRefractedPosition.xy / projectedRefractedPosition.w;
      projectedRefractedPosition = proj * vec4(pos + refractionFactor * normalize(refract(eye, norm, eta * 0.92)), 1.0);
      refractedPosition[2] = projectedRefractedPosition.xy / projectedRefractedPosition.w;
      gl_Position = proj * vec4(pos, 1.0);
    }
`;
class Water {

  constructor() {
    this.geometry = new THREE.PlaneBufferGeometry(2, 2, waterSize, waterSize);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        light: { value: light.position },
        water: { value: null },
        envMap: { value: null },
        skybox: { value: null },
        eta: { value: 0.7504 },
        fresnelBias: { value: 0.1 },
        fresnelScale: { value: 1.0 },
        fresnelPower: { value: 2.0 },
      },
      vertexShader: waterVert,
      fragmentShader: waterFrag,
    });
    this.material.extensions = {
      derivatives: true
    };

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.set(waterPosition.x, waterPosition.y, waterPosition.z);
  }

  setHeightTexture(waterTexture) {
    this.material.uniforms['water'].value = waterTexture;
  }
  
  setEnvMapTexture(envMap) {
    this.material.uniforms['envMap'].value = envMap;
  }

  setEta(value) { this.material.uniforms.eta.value = value; }
  setFresnelBias(value) { this.material.uniforms.fresnelBias.value = value; }
  setFresnelScale(value) { this.material.uniforms.fresnelScale.value = value; }
  setFresnelPower(value) { this.material.uniforms.fresnelPower.value = value; }

}

// This renders the environment map seen from the light POV.
// The resulting texture contains (posx, posy, posz, depth) in the colors channels.
const mapVert = `
    varying vec4 worldPosition;
    varying float depth;
    void main() {
      // Compute world position
      worldPosition = modelMatrix * vec4(position, 1.);
      // Project vertex in the screen coordinates
      vec4 projectedPosition = projectionMatrix * viewMatrix * worldPosition;
      // Store vertex depth
      depth = projectedPosition.z;
      gl_Position = projectedPosition;
    }
`;
const mapFrag = `
    varying vec4 worldPosition;
    varying float depth;
    void main() {
      gl_FragColor = vec4(worldPosition.xyz, depth);
    }
`;
class EnvironmentMap {

  constructor() {
    this.size = simRes;
    this.target = new THREE.WebGLRenderTarget(this.size, this.size, {type: THREE.FloatType});
    this._meshes = [];
    this._material = new THREE.ShaderMaterial({
      vertexShader: mapVert,
      fragmentShader: mapFrag,
    });
  }

  setGeometries(geometries) {
    this._meshes = [];
    for (let geometry of geometries) this._meshes.push(new THREE.Mesh(geometry, this._material));
  }

  render(renderer) {
    const oldTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(black, 0);
    renderer.clear();
    for (let mesh of this._meshes)
      renderer.render(mesh, lightCamera);
    renderer.setRenderTarget(oldTarget);
  }

}

const causticFrag = `
    uniform float causticsFactor;
    uniform float compressK;
    varying vec3 oldPosition;
    varying vec3 newPosition;
    varying float waterDepth;
    varying float depth;
    void main() {
      float causticsIntensity = 0.;
      if (depth >= waterDepth) {
        float oldArea = length(cross(dFdx(oldPosition), dFdy(oldPosition)));
        float newArea = length(cross(dFdx(newPosition), dFdy(newPosition)));
        float ratio;
        if (newArea == 0.) {
          ratio = 2.0e+20;
        } else {
          ratio = oldArea / newArea;
        }
        causticsIntensity = causticsFactor * ratio;
        causticsIntensity = causticsIntensity / (1.0 + compressK * causticsIntensity);
      }
      gl_FragColor = vec4(causticsIntensity, 0., 0., depth);
    }
`;
const causticVert = `
    uniform vec3 light;
    uniform sampler2D water;
    uniform sampler2D env;
    uniform float deltaEnvTexture;
    uniform float eta;
    varying vec3 oldPosition;
    varying vec3 newPosition;
    varying float waterDepth;
    varying float depth;
    const int MAX_ITERATIONS = 50;
    void main() {
      vec4 waterInfo = texture2D(water, position.xy * 0.5 + 0.5);
      // The water position is the vertex position on which we apply the height-map
      // TODO Remove the ugly hardcoded +0.8 for the water position
      vec3 waterPosition = vec3(position.xy, position.z + waterInfo.r + 0.8);
      vec3 waterNormal = normalize(vec3(waterInfo.b, sqrt(1.0 - dot(waterInfo.ba, waterInfo.ba)), waterInfo.a)).xzy;
      // This is the initial position: the ray starting point
      oldPosition = waterPosition;
      // Compute water coordinates in the screen space
      vec4 projectedWaterPosition = projectionMatrix * viewMatrix * vec4(waterPosition, 1.);
      vec2 currentPosition = projectedWaterPosition.xy;
      vec2 coords = 0.5 + 0.5 * currentPosition;
      vec3 refracted = refract(light, waterNormal, eta);
      vec4 projectedRefractionVector = projectionMatrix * viewMatrix * vec4(refracted, 1.);
      vec3 refractedDirection = projectedRefractionVector.xyz;
      waterDepth = 0.5 + 0.5 * projectedWaterPosition.z / projectedWaterPosition.w;
      float currentDepth = projectedWaterPosition.z;
      vec4 environment = texture2D(env, coords);
      // This factor will scale the delta parameters so that we move from one pixel to the other in the env map
      float factor = deltaEnvTexture / length(refractedDirection.xy);
      vec2 deltaDirection = refractedDirection.xy * factor;
      float deltaDepth = refractedDirection.z * factor;
      for (int i = 0; i < MAX_ITERATIONS; i++) {
        // Move the coords in the direction of the refraction
        currentPosition += deltaDirection;
        currentDepth += deltaDepth;
        // End of loop condition: The ray has hit the environment
        if (environment.w <= currentDepth)
          break;
        environment = texture2D(env, 0.5 + 0.5 * currentPosition);
      }
      newPosition = environment.xyz;
      vec4 projectedEnvPosition = projectionMatrix * viewMatrix * vec4(newPosition, 1.0);
      depth = 0.5 + 0.5 * projectedEnvPosition.z / projectedEnvPosition.w;
      gl_Position = projectedEnvPosition;
    }
`;
class Caustics {

  constructor() {
    this.target = new THREE.WebGLRenderTarget(waterSize * 3., waterSize * 3., {type: THREE.FloatType});

    this._waterGeometry = new THREE.PlaneBufferGeometry(2, 2, waterSize, waterSize);

    this._waterMaterial = new THREE.ShaderMaterial({
      uniforms: {
        light: { value: light.position },
        env: { value: null },
        water: { value: null },
        deltaEnvTexture: { value: null },
        eta: { value: 0.7504 },
        causticsFactor: { value: 0.5 },
        compressK: { value: 0.1 },
      },
      vertexShader: causticVert,
      fragmentShader: causticFrag,
      transparent: true,
    });

    this._waterMaterial.blending = THREE.CustomBlending;

    // Caustics intensity uses an additive blending
    this._waterMaterial.blendEquation = THREE.AddEquation;
    this._waterMaterial.blendSrc = THREE.OneFactor;
    this._waterMaterial.blendDst = THREE.OneFactor;

    // Caustics depth does not use blending, we just set the value
    this._waterMaterial.blendEquationAlpha = THREE.AddEquation;
    this._waterMaterial.blendSrcAlpha = THREE.OneFactor;
    this._waterMaterial.blendDstAlpha = THREE.ZeroFactor;
    this._waterMaterial.side = THREE.DoubleSide;
    this._waterMaterial.extensions = {derivatives: true};

    this._waterMesh = new THREE.Mesh(this._waterGeometry, this._waterMaterial);
  }

  setDeltaEnvTexture(deltaEnvTexture) {
    this._waterMaterial.uniforms['deltaEnvTexture'].value = deltaEnvTexture;
  }

  setEta(value) { this._waterMaterial.uniforms.eta.value = value; }
  setCausticsFactor(value) { this._waterMaterial.uniforms.causticsFactor.value = value; }
  setCompressK(value) { this._waterMaterial.uniforms.compressK.value = value; }

  setTextures(waterTexture, envTexture) {
    this._waterMaterial.uniforms['env'].value = envTexture;
    this._waterMaterial.uniforms['water'].value = waterTexture;
  }

  render(renderer) {
    const oldTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(black, 0);
    renderer.clear();
    renderer.render(this._waterMesh, lightCamera);
    renderer.setRenderTarget(oldTarget);
  }

}

const envVert = `
    uniform vec3 light;
    // Light projection matrix
    uniform mat4 lightProjectionMatrix;
    uniform mat4 lightViewMatrix;
    varying float lightIntensity;
    varying vec3 lightPosition;
    void main(void){
      lightIntensity = - dot(light, normalize(normal));

      // Compute position in the light coordinates system, this will be used for
      // comparing fragment depth with the caustics texture
      vec4 lightRelativePosition = lightProjectionMatrix * lightViewMatrix * modelMatrix * vec4(position, 1.);
      lightPosition = 0.5 + lightRelativePosition.xyz / lightRelativePosition.w * 0.5;

      // The position of the vertex
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
    }
`;
const envFrag = `
  uniform sampler2D caustics;
  uniform vec3 underwaterColor;
  uniform float pcfBlur;
  varying float lightIntensity;
  varying vec3 lightPosition;
  const float bias = 0.001;
  const vec2 resolution = vec2(1024.);
  float blur(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
    float intensity = 0.;
    vec2 off1 = vec2(1.3846153846) * direction;
    vec2 off2 = vec2(3.2307692308) * direction;
    intensity += texture2D(image, uv).x * 0.2270270270;
    intensity += texture2D(image, uv + (off1 / resolution)).x * 0.3162162162;
    intensity += texture2D(image, uv - (off1 / resolution)).x * 0.3162162162;
    intensity += texture2D(image, uv + (off2 / resolution)).x * 0.0702702703;
    intensity += texture2D(image, uv - (off2 / resolution)).x * 0.0702702703;
    return intensity;
  }
  void main() {
    float computedLightIntensity = 0.5;
    computedLightIntensity += 0.2 * lightIntensity;
    float causticsDepth = texture2D(caustics, lightPosition.xy).w;
    if (causticsDepth > lightPosition.z - bias) {
      float causticsIntensity = 0.5 * (
        blur(caustics, lightPosition.xy, resolution, vec2(0., pcfBlur)) +
        blur(caustics, lightPosition.xy, resolution, vec2(pcfBlur, 0.))
      );
      computedLightIntensity += causticsIntensity * smoothstep(0., 1., lightIntensity);
    }
    vec3 color = underwaterColor * computedLightIntensity;
    color = color / (1.0 + color);
    gl_FragColor = vec4(color, 1.);
  }
`;
class Environment {

  constructor() {
    this._meshes = [];
    this._material = new THREE.ShaderMaterial({
      uniforms: {
        light: { value: light.position },
        caustics: { value: null },
        lightProjectionMatrix: { value: lightCamera.projectionMatrix },
        lightViewMatrix: { value: lightCamera.matrixWorldInverse  },
        underwaterColor: { value: new THREE.Color(0.2, 0.2, 0.2) },
        pcfBlur: { value: 0.125 },
      },
      vertexShader: envVert,
      fragmentShader: envFrag,
    });
  }

  removeFrom(scene) {
    for (let mesh of this._meshes) scene.remove(mesh);
  }

  setGeometries(geometries) {
    this._meshes = [];
    for (let geometry of geometries) this._meshes.push(new THREE.Mesh(geometry, this._material));
  }

  updateCaustics(causticsTexture) {
    this._material.uniforms['caustics'].value = causticsTexture;
  }

  setUnderwaterColor(color) {
    this._material.uniforms.underwaterColor.value.set(color);
  }
  setPcfBlur(value) { this._material.uniforms.pcfBlur.value = value; }

  addTo(scene) {
    for (let mesh of this._meshes) scene.add(mesh);
  }

}

function createADSR(attack, decay, sustain, release, duration) {
  return function (time) {
    var attackDur = attack * duration, decayDur = decay * duration, releaseDur = release * duration;
    var sustainDur = duration - attackDur - decayDur - releaseDur;
    if (time <= attackDur) return time / attackDur;
    if (time <= attackDur + decayDur) return (1 - sustain) * (1 - (time - attackDur) / decayDur) + sustain;
    return time <= duration - releaseDur ? sustain : sustain * (1 - (time - (duration - releaseDur)) / releaseDur);
  }
}
  
// Instantiate classes
const audio = new Audio();
const waterSimulation = new WaterSimulation();
const water = new Water();
const environmentMap = new EnvironmentMap();
const environment = new Environment();
const caustics = new Caustics();
const temporaryRenderTarget = new THREE.WebGLRenderTarget(width, height); // Target for computing the water refraction
const clock = new THREE.Clock();

// Main rendering loop
function animate() {
  stats.begin();
  // Rain
  if (raindrops) {
    // intensity variation random walk
    intensityVariationVector += (rng.random_dec() - 0.5) * 0.033 * intensityVariability
    intensityVariationVector = Math.max(-(intensityVariability) , Math.min(intensityVariability, intensityVariationVector))
    let intensityTotal = Math.max(Math.min(intensity + intensityVariationVector, 1), 0)
    //console.log(intensityVariationVector, intensityTotal)
    if (Math.random() <= intensityTotal) {
      let size = rng.random_dec() * 0.05;
      let mass = rng.random_dec() * 0.025;  // Reduced from 0.05
      mass = (rng.random_dec() > 0.5) ? mass : mass * -1
      let posX = randPos ? rng.random_dec() * 2 - 1 : 0;
      let posY = randPos ? rng.random_dec() * 2 - 1 : 0;
      waterSimulation.addDrop(renderer, posX, posY, size, mass);
    }
  }
  // Wind
  if (wind) {
    // threshold for a gust to start
    if (!gusting && Math.random() <= windIntensity) {
      gusting = true;
      gustStartTime = new Date().getTime();
      gustDuration = ((18 * Math.random()) + 2) * 1000;
      gustPosition = {x: Math.random() * 2 - 1, y: Math.random() * 2 - 1};
      gustDirection = {x: Math.random() * 2 - 1, y: Math.random() * 2 - 1};
      // Gust base size/mass. addDrop further multiplies by 1/sqrt(scale) so
      // these stay consistent with rain across simulation scale traits.
      // Wind used to dwarf rain by ~30x; these values match rain ranges
      // (rain: size 0..0.05, mass 0..0.025).
      gustSize = Math.random() * 0.03 + 0.02;   // 0.02..0.05
      gustMass = Math.random() * 0.005;          // 0..0.005
      gustAmplitude = 0;
      gustEnvelope = createADSR(0.2, 0.2, 0.6, 0.4, gustDuration);
    }
    if (gusting) {
      var timeSinceGustStart = new Date().getTime() - gustStartTime;
      if (timeSinceGustStart >= gustDuration) {
        gusting = false;
      } else {
        gustAmplitude = gustEnvelope(timeSinceGustStart);
        gustPosition = {
          x: gustPosition.x + (gustDirection.x * 0.005 * gustAmplitude),
          y: gustPosition.y + (gustDirection.y * 0.005 * gustAmplitude)
        };
        // windStrength scales everything linearly so a single slider tames or
        // amps wind energy without rebalancing each component.
        var dropletSize = (gustSize + (Math.random() * 0.01 - 0.005)) * windStrength;
        var dropletMass = (gustMass + (Math.random() - 0.5) * 0.001) * windStrength;
        var numDroplets = Math.floor(gustAmplitude * 3 * windStrength);
        for (var i = 0; i < numDroplets; i++) {
          waterSimulation.addDrop(
            renderer,
            gustPosition.x + (Math.random() - 0.5) * dropletSize * 2,
            gustPosition.y + (Math.random() - 0.5) * dropletSize * 2,
            dropletSize,
            dropletMass
          );
        }
      }
    }
  }

  // Update the water
  if (clock.getElapsedTime() > 0.032) {
    // Cymatics test harnesses (independent of audio)
    if (modeTest) {
      waterSimulation.addMode(renderer, modeTestM, modeTestN, modeTestOmega, modeTestAmp);
    }
    if (modeRandom) {
      waterSimulation.addMode(renderer, modeRandomM, modeRandomN, modeRandomOmega, modeRandomAmp);
    }
    if (modeSweep) {
      const now = performance.now();
      const t = (now - sweepStartTime) / sweepDuration;
      if (t >= 1.0) {
        modeSweep = false;
        console.log("sweep complete");
      } else {
        // Log-sweep so low frequencies get proportional dwell time
        const logMin = Math.log(sweepOmegaMin);
        const logMax = Math.log(sweepOmegaMax);
        const omega = Math.exp(logMin + (logMax - logMin) * t);
        waterSimulation.addMode(renderer, sweepM, sweepN, omega, 0.001);
        if (now - sweepLastLog > 500) {
          console.log(`sweep omega=${omega.toFixed(3)} rad/s  (${(t*100).toFixed(1)}%)`);
          sweepLastLog = now;
        }
      }
    }
    if (soundReactive && audio.audioLoaded) {
      const fd = audio.frequencyData;
      audio.analyser.getByteFrequencyData(fd);

      // One Hz/bin at the current sample rate
      const sampleRate = audio.analyser.context.sampleRate;
      const binWidth = (sampleRate * 0.5) / fd.length;

      for (const band of audioBands) {
        // Average bin magnitudes within the band's audio frequency range
        const loBin = Math.max(0, Math.floor(band.loHz / binWidth));
        const hiBin = Math.min(fd.length - 1, Math.ceil(band.hiHz / binWidth));
        let sum = 0;
        const count = hiBin - loBin + 1;
        for (let i = loBin; i <= hiBin; i++) sum += fd[i];
        const magnitude = count > 0 ? (sum / count) / 255 : 0;

        // Exponential smoothing for stable mode drive (prevents per-frame jitter)
        band.smooth = audioSmoothing * band.smooth + (1 - audioSmoothing) * magnitude;

        // Gate quiet bands so they don't bleed energy when there's no signal
        if (band.smooth > audioGate) {
          const omega = eigenTune ? computeEigenOmega(band.m, band.n) : band.omega;
          waterSimulation.addMode(renderer, band.m, band.n, omega, audioGain * band.smooth);
        }
      }
    }

    waterSimulation.stepSimulation(renderer);
    const waterTexture = waterSimulation.target.texture;
    water.setHeightTexture(waterTexture);
    environmentMap.render(renderer);
    const environmentMapTexture = environmentMap.target.texture;
    caustics.setTextures(waterTexture, environmentMapTexture);
    caustics.render(renderer);
    const causticsTexture = caustics.target.texture;
    environment.updateCaustics(causticsTexture);
    clock.start();
  }

  // Render everything but the refractive water.
  // Clear the envMap to black so refracted rays that miss the underwater
  // floor (when ripples tilt the surface steeply) sample dark instead of
  // pure white, which previously read as bright clipping spikes on ripples.
  renderer.setRenderTarget(temporaryRenderTarget);
  renderer.setClearColor(black, 1);
  renderer.clear();
  water.mesh.visible = false;
  renderer.render(scene, camera);
  water.setEnvMapTexture(temporaryRenderTarget.texture);

  // Then render the final scene with the refractive water
  renderer.setRenderTarget(null);
  renderer.setClearColor(white, 1);
  renderer.clear();
  water.mesh.visible = true;
  renderer.render(scene, camera);
  drawAudioVisIfOpen();
  drawModeVisIfOpen();
  refreshReadoutIfOpen();
  stats.end();
  window.requestAnimationFrame(animate);
}

// Periodic refresh of the Info readout (active drivers, sweep progress)
// while the Info drawer is open. Throttled to ~500ms so it stays cheap.
let _lastReadoutMs = 0;
function refreshReadoutIfOpen() {
  const drawer = infoDrawerRef();
  if (!drawer || !drawer.classList.contains('open')) return;
  const now = performance.now();
  if (now - _lastReadoutMs < 500) return;
  _lastReadoutMs = now;
  renderReadout();
}

// Per-frame audio visualization (FFT bars on log-x, gate line, per-band
// smoothed magnitude markers). Only draws when the Info drawer is open.
let audioVisCtx = null;
let audioVisCanvas = null;
let audioVisHint = null;
const infoDrawerRef = () => document.getElementById('info-drawer');
function drawAudioVisIfOpen() {
  if (!audioVisCanvas) {
    audioVisCanvas = document.getElementById('audio-vis');
    audioVisHint = document.getElementById('audio-vis-hint');
    if (audioVisCanvas) audioVisCtx = audioVisCanvas.getContext('2d');
    if (!audioVisCanvas) return;
  }
  const drawer = infoDrawerRef();
  if (!drawer || !drawer.classList.contains('open')) return;
  if (!audio.audioLoaded) {
    if (audioVisHint) audioVisHint.textContent = 'Press m to enable audio';
    audioVisCtx.clearRect(0, 0, audioVisCanvas.width, audioVisCanvas.height);
    return;
  }
  if (audioVisHint) audioVisHint.textContent = '';

  const fd = audio.frequencyData;
  audio.analyser.getByteFrequencyData(fd);

  const ctx = audioVisCtx;
  const W = audioVisCanvas.width;
  const H = audioVisCanvas.height;
  ctx.clearRect(0, 0, W, H);

  const nyquist = audio.analyser.context.sampleRate * 0.5;
  const binWidth = nyquist / fd.length;
  const fMin = 20, fMax = 12000;
  const logMin = Math.log(fMin), logMax = Math.log(fMax);
  const fToX = f => W * (Math.log(Math.max(f, fMin)) - logMin) / (logMax - logMin);

  // Band tint background
  for (let i = 0; i < audioBands.length; i++) {
    const band = audioBands[i];
    const x0 = fToX(Math.max(band.loHz, fMin));
    const x1 = fToX(Math.min(band.hiHz, fMax));
    const hue = i * 55;
    ctx.fillStyle = `hsla(${hue}, 70%, 50%, 0.10)`;
    ctx.fillRect(x0, 0, x1 - x0, H);
  }

  // FFT magnitude bars
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  for (let i = 1; i < fd.length; i++) {
    const f0 = i * binWidth;
    if (f0 > fMax) break;
    if (f0 < fMin) continue;
    const x = fToX(f0);
    const xNext = fToX(Math.min((i + 1) * binWidth, fMax));
    const h = (fd[i] / 255) * H;
    ctx.fillRect(x, H - h, Math.max(1, xNext - x), h);
  }

  // Gate level horizontal line
  const gateY = H - audioGate * H;
  ctx.strokeStyle = 'rgba(255, 90, 90, 0.85)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, gateY);
  ctx.lineTo(W, gateY);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 90, 90, 0.85)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('gate', 2, gateY - 2);

  // Per-band smoothed magnitude markers + labels
  ctx.textAlign = 'center';
  for (let i = 0; i < audioBands.length; i++) {
    const band = audioBands[i];
    const centerHz = Math.sqrt(band.loHz * band.hiHz);
    const x = fToX(centerHz);
    const y = H - band.smooth * H;
    const isLive = band.smooth > audioGate;
    const hue = i * 55;
    ctx.fillStyle = isLive ? `hsla(${hue}, 90%, 70%, 1)` : `hsla(${hue}, 40%, 55%, 0.6)`;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isLive ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)';
    ctx.font = '9px monospace';
    ctx.fillText(band.name.replace('subBass', 'sub'), x, H - 2);
  }
}

// Per-frame cymatic resonance mode-levels bar chart. Shows each audio band's
// current drive amplitude into its (m, n) mode, including the eigenfreq
// drive (if eigenTune is on) and the gain-comp curve. Only draws when the
// Info drawer is open.
let modeVisCtx = null;
let modeVisCanvas = null;
function drawModeVisIfOpen() {
  if (!modeVisCanvas) {
    modeVisCanvas = document.getElementById('mode-vis');
    if (modeVisCanvas) modeVisCtx = modeVisCanvas.getContext('2d');
    if (!modeVisCanvas) return;
  }
  const drawer = infoDrawerRef();
  if (!drawer || !drawer.classList.contains('open')) return;
  const ctx = modeVisCtx;
  const W = modeVisCanvas.width;
  const H = modeVisCanvas.height;
  ctx.clearRect(0, 0, W, H);

  const barW = W / audioBands.length;
  const gap = 4;
  // The "drive amplitude" we show is what was actually injected: audioGain *
  // band.smooth, scaled by the gain comp curve, only if above gate.
  let maxAmp = 0;
  const driveLevels = audioBands.map((band, i) => {
    if (band.smooth <= audioGate) return 0;
    const omega = eigenTune ? computeEigenOmega(band.m, band.n) : band.omega;
    const compFactor = Math.pow(omega / OMEGA_REF, OMEGA_EXP);
    const drive = audioGain * band.smooth * compFactor;
    if (drive > maxAmp) maxAmp = drive;
    return drive;
  });
  const scale = maxAmp > 0 ? (H - 18) / maxAmp : 0;

  ctx.textAlign = 'center';
  for (let i = 0; i < audioBands.length; i++) {
    const band = audioBands[i];
    const x = i * barW + gap;
    const w = barW - gap * 2;
    const isLive = driveLevels[i] > 0;
    const h = driveLevels[i] * scale;
    const hue = i * 55;

    // Faint background column showing the full bar slot
    ctx.fillStyle = `hsla(${hue}, 30%, 30%, 0.25)`;
    ctx.fillRect(x, 14, w, H - 18);

    // The actual bar
    ctx.fillStyle = isLive ? `hsla(${hue}, 90%, 60%, 0.95)` : `hsla(${hue}, 30%, 40%, 0.4)`;
    ctx.fillRect(x, H - 4 - h, w, h);

    // Mode label (m,n) on top
    ctx.fillStyle = isLive ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)';
    ctx.font = '9px monospace';
    ctx.fillText(`(${band.m},${band.n})`, x + w / 2, 10);
  }
}

function onMouseMove(event) {
  if (mouseReactive) {
    const rect = canvas.getBoundingClientRect();
    let mouse = { x: (event.clientX-rect.left)*2/width-1, y: -(event.clientY-rect.top)*2/height+1 }
    raycaster.setFromCamera(mouse, camera);
    for (let intersect of raycaster.intersectObject(targetmesh))
      waterSimulation.addDrop(renderer, intersect.point.x, intersect.point.y, 0.03, 0.02);
  }
}

Promise.all([
    waterSimulation.loaded,
    water.loaded,
    environmentMap.loaded,
    environment.loaded,
    caustics.loaded,
    audio.micLoaded,
    plantLoaded,
    rockLoaded,
    sharkLoaded
  ]).then(() => {
    
    applyRenderObjects();
    scene.add(water.mesh);
    caustics.setDeltaEnvTexture(1. / environmentMap.size);
    canvas.addEventListener('mousemove', { handleEvent: onMouseMove });
    document.onkeyup = function(e) {
      // Ignore key shortcuts while a form input is focused (sliders, hex input)
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      let touched = true;
      switch(e.key) {
        case 'm': if (!audio.audioLoaded) audio.startAudio(); soundReactive = !soundReactive; break;
        case 'r': raindrops = !raindrops; break;
        case 'w': wind = !wind; break;
        case 'c':
          waterSimulation.resetSimulation(renderer);
          modeTest = false;
          modeSweep = false;
          modeRandom = false;
          break;
        case 'p':
          rollRandomMode();
          modeRandom = true;
          break;
        case 'd': camera.position.set(0, 0, 6); camera.rotation.x = 0; break;
        case 'e': camera.position.set(0, 0, 2); camera.rotation.x = 0; break;
        case 's': camera.position.set(0, -1.25, 1.66); camera.rotation.x = 35 * Math.PI / 180; break;
        case 'v': showWater = !showWater; break;
        case 'h': document.getElementById('help-drawer').classList.toggle('open'); break;
        case 'i': {
          const d = document.getElementById('info-drawer');
          const opened = !d.classList.contains('open');
          d.classList.toggle('open');
          if (opened) renderReadout();
          break;
        }
        case 'o': {
          const d = document.getElementById('settings-drawer');
          const opened = !d.classList.contains('open');
          d.classList.toggle('open');
          if (opened) syncUIFromState();
          break;
        }
        case 'Escape': {
          document.getElementById('help-drawer').classList.remove('open');
          document.getElementById('info-drawer').classList.remove('open');
          document.getElementById('settings-drawer').classList.remove('open');
          break;
        }
        case 'y':
          modeTest = !modeTest;
          console.log(`mode test: ${modeTest} (m=${modeTestM}, n=${modeTestN}, omega=${modeTestOmega}, amp=${modeTestAmp})`);
          break;
        case 't':
          modeSweep = !modeSweep;
          if (modeSweep) {
            sweepStartTime = performance.now();
            sweepLastLog = 0;
            console.log(`sweep start: m=${sweepM}, n=${sweepN}, omega ${sweepOmegaMin}->${sweepOmegaMax} rad/s over ${sweepDuration}ms`);
          } else {
            console.log("sweep cancelled");
          }
          break;
        default: touched = false;
      }
      // Keep UI mirrored if a key changed any state
      if (touched) syncUIFromState();
    };
    if(randomStart) {
      for (var i=0; i<startDrops; i++) {
        waterSimulation.addDrop(renderer, rng.random_dec()*2-1, rng.random_dec()*2-1, rng.random_dec()*0.05, rng.random_dec()*0.025*(i&1||-1));
      }
    }
    if (randomStartModes) {
      rollRandomMode();
      modeRandom = true;
    }
    setupUI();
    applyURLParams();
    syncUIFromState();
    const hashInput = document.getElementById('opt-hash');
    if (hashInput) hashInput.value = tokenData.hash;
    animate();
});

// Apply current renderObjects flag: toggle whether the OBJ assets are
// included in the caustic environment alongside the floor. Removes any
// previously-added environment meshes from the scene before swapping the
// geometry list in.
function applyRenderObjects() {
  const envGeometries = renderObjects
    ? [rock1, rock2, shark, plant, floorGeometry]
    : [floorGeometry];
  environmentMap.setGeometries(envGeometries);
  environment.removeFrom(scene);
  environment.setGeometries(envGeometries);
  environment.addTo(scene);
}

// Re-run the trait dice without a page reload. Generates a new tokenData
// (or uses the supplied hash to reproduce a specific roll), recreates the
// seeded PRNG, re-rolls polygonSides / scale / startDrops / dilation /
// damping, and pushes the new values into the live simulation.
function reroll(forceHash) {
  if (forceHash) {
    tokenData = { hash: forceHash, tokenId: '0' };
  } else {
    tokenData = genTokenData(11111);
  }
  rng = new Random();
  polygonSides = rng.random_int(3, 34);
  scale = rng.random_int(1, 10);
  startDrops = rng.random_int(10, 55) + scale;
  dAmt = rng.skewedRandom(1000);
  dilation = rng.random_dec() < .1
    ? (rng.random_dec() < .5 ? [dAmt, 1] : [1, dAmt])
    : [1, 1];
  deltaRates = dilation.map(d => 1 / (1024 * d));
  attenuate = 1.0 - (0.002 * scale);
  console.log("Reroll: sides=" + polygonSides + ", scale=" + scale +
              ", drops=" + startDrops + ", dilation=" + JSON.stringify(dilation) +
              ", damping=" + attenuate.toFixed(4));

  waterSimulation.rerollGeometry(polygonSides);
  waterSimulation.setDelta(deltaRates);
  waterSimulation.setDamping(attenuate);
  waterSimulation.resetSimulation(renderer);

  // Stop any active cymatic driver so the fresh surface stays clean
  modeTest = false;
  modeSweep = false;
  modeRandom = false;

  if (randomStart) {
    for (let i = 0; i < startDrops; i++) {
      waterSimulation.addDrop(
        renderer,
        rng.random_dec() * 2 - 1,
        rng.random_dec() * 2 - 1,
        rng.random_dec() * 0.05,
        rng.random_dec() * 0.025 * (i & 1 || -1)
      );
    }
  }
  if (randomStartModes) {
    rollRandomMode();
    modeRandom = true;
  }
}

// Sync the Options drawer's inputs from current global state. Module-scoped
// so key-handlers can call it to keep the UI mirrored after keyboard toggles.
function syncUIFromState() {
  const set = (id, prop, val) => {
    const el = document.getElementById(id);
    if (el) el[prop] = val;
  };
  const fmt = (id, val, digits) => {
    const el = document.getElementById(id);
    if (el) el.textContent = Number(val).toFixed(digits);
  };
  set('opt-hash', 'value', tokenData.hash);
  set('opt-rain', 'checked', raindrops);
  set('opt-wind', 'checked', wind);
  set('opt-audio', 'checked', soundReactive);
  set('opt-mouse', 'checked', mouseReactive);
  set('opt-random-start', 'checked', randomStart);
  set('opt-random-start-modes', 'checked', randomStartModes);
  set('opt-eigen-tune', 'checked', eigenTune);
  set('opt-test-m', 'value', modeTestM); fmt('val-test-m', modeTestM, 0);
  set('opt-test-n', 'value', modeTestN); fmt('val-test-n', modeTestN, 0);
  set('opt-test-omega', 'value', modeTestOmega); fmt('val-test-omega', modeTestOmega, 2);
  set('opt-test-amp', 'value', modeTestAmp); fmt('val-test-amp', modeTestAmp, 4);
  renderAudioBandsTable();
  set('opt-render-objects', 'checked', renderObjects);

  const dampingAmount = 1.0 - waterSimulation._updateMesh.material.uniforms.damping.value;
  set('opt-damping', 'value', dampingAmount); fmt('val-damping', dampingAmount, 4);

  const waveSpeed = waterSimulation._updateMesh.material.uniforms.c.value;
  set('opt-wavespeed', 'value', waveSpeed); fmt('val-wavespeed', waveSpeed, 2);

  const dropFalloff = waterSimulation._dropMesh.material.uniforms.falloff.value;
  set('opt-dropfalloff', 'value', dropFalloff); fmt('val-dropfalloff', dropFalloff, 1);

  set('opt-intensity', 'value', intensity); fmt('val-intensity', intensity, 2);
  set('opt-wind-intensity', 'value', windIntensity); fmt('val-wind-intensity', windIntensity, 3);
  set('opt-wind-strength', 'value', windStrength); fmt('val-wind-strength', windStrength, 2);

  set('opt-audio-gain', 'value', audioGain); fmt('val-audio-gain', audioGain, 5);
  set('opt-audio-smooth', 'value', audioSmoothing); fmt('val-audio-smooth', audioSmoothing, 2);
  set('opt-audio-gate', 'value', audioGate); fmt('val-audio-gate', audioGate, 3);

  const cf = caustics._waterMaterial.uniforms.causticsFactor.value;
  set('opt-caustics-factor', 'value', cf); fmt('val-caustics-factor', cf, 2);
  const ck = caustics._waterMaterial.uniforms.compressK.value;
  set('opt-compress-k', 'value', ck); fmt('val-compress-k', ck, 3);
  const pcf = environment._material.uniforms.pcfBlur.value;
  set('opt-pcf-blur', 'value', pcf); fmt('val-pcf-blur', pcf, 3);

  const eta = water.material.uniforms.eta.value;
  set('opt-eta', 'value', eta); fmt('val-eta', eta, 3);
  const fb = water.material.uniforms.fresnelBias.value;
  set('opt-fresnel-bias', 'value', fb); fmt('val-fresnel-bias', fb, 2);
  const fs = water.material.uniforms.fresnelScale.value;
  set('opt-fresnel-scale', 'value', fs); fmt('val-fresnel-scale', fs, 2);
  const fp = water.material.uniforms.fresnelPower.value;
  set('opt-fresnel-power', 'value', fp); fmt('val-fresnel-power', fp, 1);

  const uw = environment._material.uniforms.underwaterColor.value;
  set('opt-underwater-color', 'value', '#' + uw.getHexString());

  set('opt-omega-ref', 'value', OMEGA_REF); fmt('val-omega-ref', OMEGA_REF, 2);
  set('opt-omega-exp', 'value', OMEGA_EXP); fmt('val-omega-exp', OMEGA_EXP, 2);
  set('opt-sweep-min', 'value', sweepOmegaMin); fmt('val-sweep-min', sweepOmegaMin, 2);
  set('opt-sweep-max', 'value', sweepOmegaMax); fmt('val-sweep-max', sweepOmegaMax, 1);
  set('opt-sweep-dur', 'value', sweepDuration / 1000); fmt('val-sweep-dur', sweepDuration / 1000, 0);
  set('opt-rand-max-m', 'value', randomMaxM); fmt('val-rand-max-m', randomMaxM, 0);
  set('opt-rand-max-n', 'value', randomMaxN); fmt('val-rand-max-n', randomMaxN, 0);
}

// Render the editable per-band audio mapping table inside the Options drawer.
// Each row: name, m, n, omega, Hz lo, Hz hi - all editable as you type.
// Eigenfreq column shows the current computed eigenomega so you can compare
// against the hand-tuned omega even when auto-tune is on.
function renderAudioBandsTable() {
  const container = document.getElementById('audio-bands-table');
  if (!container) return;
  let html = '<table class="bands-table"><thead><tr>';
  html += '<th>Band</th><th>m</th><th>n</th><th>&omega;</th><th>eig &omega;</th><th>Hz lo</th><th>Hz hi</th>';
  html += '</tr></thead><tbody>';
  audioBands.forEach((band, i) => {
    const eig = computeEigenOmega(band.m, band.n).toFixed(2);
    html += `<tr>
      <td>${band.name}</td>
      <td><input type="number" min="0" max="14" step="1" data-band="${i}" data-field="m" value="${band.m}"></td>
      <td><input type="number" min="1" max="8" step="1" data-band="${i}" data-field="n" value="${band.n}"></td>
      <td><input type="number" min="0.01" max="20" step="0.01" data-band="${i}" data-field="omega" value="${band.omega}"></td>
      <td>${eig}</td>
      <td><input type="number" min="0" max="20000" step="10" data-band="${i}" data-field="loHz" value="${band.loHz}"></td>
      <td><input type="number" min="0" max="20000" step="10" data-band="${i}" data-field="hiHz" value="${band.hiHz}"></td>
    </tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
  container.querySelectorAll('input[type="number"]').forEach(input => {
    input.addEventListener('input', e => {
      const idx = parseInt(e.target.dataset.band);
      const field = e.target.dataset.field;
      const v = parseFloat(e.target.value);
      if (!isNaN(v)) {
        audioBands[idx][field] = (field === 'm' || field === 'n') ? Math.round(v) : v;
        // Refresh eigenfreq column (lightweight; just re-render whole table)
        if (field === 'm' || field === 'n') renderAudioBandsTable();
      }
    });
  });
}

// Read-only display of derived values: traits, deltas, computed eigenfreqs
function renderReadout() {
  const el = document.getElementById('computed-readout');
  if (!el) return;
  const row = (label, value) => `<div class="row"><span>${label}</span><span>${value}</span></div>`;
  const sep = `<div class="sep"></div>`;
  let html = '';
  const shortHash = tokenData.hash.length > 18 ? tokenData.hash.slice(0, 10) + '...' + tokenData.hash.slice(-8) : tokenData.hash;
  html += row('Token hash', `<span title="${tokenData.hash}">${shortHash}</span>`);
  html += row('Polygon sides', polygonSides);
  html += row('Scale', scale);
  html += row('Start drops', startDrops);
  html += row('Time dilation', `[${dilation[0].toFixed(3)}, ${dilation[1].toFixed(3)}]`);
  html += row('dAmt', dAmt);
  html += row('Delta', `[${deltaRates[0].toExponential(2)}, ${deltaRates[1].toExponential(2)}]`);
  html += row('Damping uniform', waterSimulation._updateMesh.material.uniforms.damping.value.toFixed(4));
  html += sep;
  html += '<div class="row"><span>Active drivers</span><span></span></div>';
  if (modeRandom) {
    const eig = computeEigenOmega(modeRandomM, modeRandomN).toFixed(3);
    html += row('&nbsp;&nbsp;Random mode (m,n)', `(${modeRandomM},${modeRandomN})`);
    html += row('&nbsp;&nbsp;&nbsp;&nbsp;&omega; / eig', `${modeRandomOmega.toFixed(3)} / ${eig}`);
  } else {
    html += row('&nbsp;&nbsp;Random mode', 'off');
  }
  if (modeTest) {
    html += row('&nbsp;&nbsp;Fixed test (m,n)', `(${modeTestM},${modeTestN})`);
    html += row('&nbsp;&nbsp;&nbsp;&nbsp;&omega; / amp', `${modeTestOmega.toFixed(3)} / ${modeTestAmp.toFixed(4)}`);
  }
  if (modeSweep) {
    const t = (performance.now() - sweepStartTime) / sweepDuration;
    html += row('&nbsp;&nbsp;Sweep', `(${sweepM},${sweepN}) ${(t * 100).toFixed(0)}%`);
  }
  html += sep;
  html += '<div class="row"><span>Eigenfreqs (rad/s)</span><span></span></div>';
  for (const band of audioBands) {
    const omega = computeEigenOmega(band.m, band.n);
    html += row(`&nbsp;&nbsp;${band.name} (${band.m},${band.n})`, omega.toFixed(4));
  }
  el.innerHTML = html;
}

// Share/persist schema. Each entry: short URL key, getter (returns current
// value), setter (applies value from URL string), and the default that the
// "Reset to defaults" action restores. Booleans encoded as 0/1; numbers
// stringified. Items omitted from the URL fall back to the current value.
function shareSchema() {
  return [
    ['rain',  () => raindrops,           v => { raindrops = v === '1'; },           true],
    ['wind',  () => wind,                v => { wind = v === '1'; },                false],
    ['ar',    () => soundReactive,       v => { soundReactive = v === '1'; },       false],
    ['mr',    () => mouseReactive,       v => { mouseReactive = v === '1'; },       false],
    ['rs',    () => randomStart,         v => { randomStart = v === '1'; },         true],
    ['rsm',   () => randomStartModes,    v => { randomStartModes = v === '1'; },    true],
    ['et',    () => eigenTune,           v => { eigenTune = v === '1'; },           true],
    ['ro',    () => renderObjects,       v => { renderObjects = v === '1'; applyRenderObjects(); }, false],
    ['dmp',   () => 1.0 - waterSimulation._updateMesh.material.uniforms.damping.value, v => waterSimulation.setDamping(1.0 - parseFloat(v)), 0.002 * scale],
    ['ws',    () => waterSimulation._updateMesh.material.uniforms.c.value, v => waterSimulation.setWaveSpeed(parseFloat(v)), 0.25],
    ['df',    () => waterSimulation._dropMesh.material.uniforms.falloff.value, v => waterSimulation.setDropFalloff(parseFloat(v)), 2.0],
    ['ri',    () => intensity,           v => { intensity = parseFloat(v); },        0.2],
    ['wi',    () => windIntensity,       v => { windIntensity = parseFloat(v); },    0.01],
    ['wst',   () => windStrength,        v => { windStrength = parseFloat(v); },     1.0],
    ['ag',    () => audioGain,           v => { audioGain = parseFloat(v); },        0.001],
    ['asm',   () => audioSmoothing,      v => { audioSmoothing = parseFloat(v); },   0.2],
    ['agt',   () => audioGate,           v => { audioGate = parseFloat(v); },        0.04],
    ['cf',    () => caustics._waterMaterial.uniforms.causticsFactor.value, v => caustics.setCausticsFactor(parseFloat(v)), 0.5],
    ['ck',    () => caustics._waterMaterial.uniforms.compressK.value,      v => caustics.setCompressK(parseFloat(v)),       0.1],
    ['pcf',   () => environment._material.uniforms.pcfBlur.value, v => environment.setPcfBlur(parseFloat(v)), 0.125],
    ['eta',   () => water.material.uniforms.eta.value, v => { water.setEta(parseFloat(v)); caustics.setEta(parseFloat(v)); }, 0.7504],
    ['fb',    () => water.material.uniforms.fresnelBias.value, v => water.setFresnelBias(parseFloat(v)), 0.1],
    ['fs',    () => water.material.uniforms.fresnelScale.value, v => water.setFresnelScale(parseFloat(v)), 1.0],
    ['fp',    () => water.material.uniforms.fresnelPower.value, v => water.setFresnelPower(parseFloat(v)), 2.0],
    ['uw',    () => '#' + environment._material.uniforms.underwaterColor.value.getHexString(), v => environment.setUnderwaterColor(v), '#333333'],
    ['oref',  () => OMEGA_REF,           v => { OMEGA_REF = parseFloat(v); },        0.83],
    ['oexp',  () => OMEGA_EXP,           v => { OMEGA_EXP = parseFloat(v); },        0.3],
    ['smin',  () => sweepOmegaMin,       v => { sweepOmegaMin = parseFloat(v); },    0.1],
    ['smax',  () => sweepOmegaMax,       v => { sweepOmegaMax = parseFloat(v); },    20.0],
    ['sdur',  () => sweepDuration,       v => { sweepDuration = parseFloat(v); },    30000],
    ['rmm',   () => randomMaxM,          v => { randomMaxM = parseInt(v); },         8],
    ['rmn',   () => randomMaxN,          v => { randomMaxN = parseInt(v); },         5],
    ['tm',    () => modeTestM,           v => { modeTestM = parseInt(v); },           4],
    ['tn',    () => modeTestN,           v => { modeTestN = parseInt(v); },           2],
    ['to',    () => modeTestOmega,       v => { modeTestOmega = parseFloat(v); },     1.0],
    ['ta',    () => modeTestAmp,         v => { modeTestAmp = parseFloat(v); },       0.001],
  ];
}

function applyURLParams() {
  const schema = shareSchema();
  for (const [key, _, setter] of schema) {
    if (URL_PARAMS.has(key)) {
      try { setter(URL_PARAMS.get(key)); } catch (err) { console.warn('URL param', key, err); }
    }
  }
}

function buildShareURL() {
  const params = new URLSearchParams();
  params.set('h', tokenData.hash);
  for (const [key, getter, _, def] of shareSchema()) {
    const v = getter();
    const enc = typeof v === 'boolean' ? (v ? '1' : '0') : v;
    const defEnc = typeof def === 'boolean' ? (def ? '1' : '0') : def;
    // Omit equal-to-default values to keep URL short
    if (String(enc) !== String(defEnc)) params.set(key, enc);
  }
  return location.origin + location.pathname + '?' + params.toString();
}

function resetToDefaults() {
  for (const [_, __, setter, def] of shareSchema()) {
    try { setter(typeof def === 'boolean' ? (def ? '1' : '0') : String(def)); } catch (err) {}
  }
  syncUIFromState();
}

function showToast(msg, ms = 1600) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showToast('Copied to clipboard'),
      () => showToast('Copy failed - here it is in the console') || console.log(text)
    );
  } else {
    console.log(text);
    showToast('Copied (see console)');
  }
}

function saveScreenshot() {
  const link = document.createElement('a');
  link.download = 'caustics-' + Date.now() + '.png';
  link.href = renderer.domElement.toDataURL('image/png');
  link.click();
}

// Wire the floating buttons to drawers/modal. Each toggle is independent so
// the user can have Options and Info open simultaneously (one on each edge).
// Help is rendered as a centered modal instead of a drawer.
function setupUI() {
  const settingsBtn = document.getElementById('settings-toggle');
  const infoBtn = document.getElementById('info-toggle');
  const helpBtn = document.getElementById('help-toggle');
  const settingsDrawer = document.getElementById('settings-drawer');
  const infoDrawer = document.getElementById('info-drawer');
  const helpModal = document.getElementById('help-drawer');

  const toggle = (el, onOpen) => () => {
    const open = el.classList.toggle('open');
    if (open && onOpen) onOpen();
  };
  settingsBtn.addEventListener('click', toggle(settingsDrawer, syncUIFromState));
  infoBtn.addEventListener('click', toggle(infoDrawer, renderReadout));
  helpBtn.addEventListener('click', toggle(helpModal));

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.close);
      if (target) target.classList.remove('open');
    });
  });
  // Click outside modal content closes it
  helpModal.addEventListener('click', e => {
    if (e.target === helpModal) helpModal.classList.remove('open');
  });

  // Top-level Options actions
  document.getElementById('opt-reroll').addEventListener('click', () => {
    reroll();
    syncUIFromState();
    renderReadout();
  });
  document.getElementById('opt-hash-apply').addEventListener('click', () => {
    const hashInput = document.getElementById('opt-hash');
    const h = (hashInput.value || '').trim();
    if (!/^0x[0-9a-fA-F]+$/.test(h)) {
      showToast('Hash must be 0x... hex');
      return;
    }
    reroll(h);
    syncUIFromState();
    renderReadout();
    showToast('Hash applied');
  });
  document.getElementById('opt-share').addEventListener('click', () => {
    const url = buildShareURL();
    copyToClipboard(url);
  });
  document.getElementById('opt-screenshot').addEventListener('click', saveScreenshot);
  document.getElementById('opt-reset').addEventListener('click', () => {
    resetToDefaults();
    showToast('Reset to defaults');
  });

  // Source toggles
  document.getElementById('opt-rain').addEventListener('change', e => { raindrops = e.target.checked; });
  document.getElementById('opt-wind').addEventListener('change', e => { wind = e.target.checked; });
  document.getElementById('opt-audio').addEventListener('change', e => {
    if (e.target.checked && !audio.audioLoaded) audio.startAudio();
    soundReactive = e.target.checked;
  });
  document.getElementById('opt-mouse').addEventListener('change', e => { mouseReactive = e.target.checked; });
  document.getElementById('opt-random-start').addEventListener('change', e => { randomStart = e.target.checked; });
  document.getElementById('opt-random-start-modes').addEventListener('change', e => { randomStartModes = e.target.checked; });
  document.getElementById('opt-eigen-tune').addEventListener('change', e => {
    eigenTune = e.target.checked;
    renderReadout();
  });
  document.getElementById('opt-render-objects').addEventListener('change', e => {
    renderObjects = e.target.checked;
    applyRenderObjects();
  });
  document.getElementById('opt-underwater-color').addEventListener('input', e => {
    environment.setUnderwaterColor(e.target.value);
  });

  // View buttons mirror keyboard view shortcuts
  const setView = (cb) => () => { cb(); };
  document.getElementById('view-distant').addEventListener('click', setView(() => {
    camera.position.set(0, 0, 6); camera.rotation.x = 0;
  }));
  document.getElementById('view-even').addEventListener('click', setView(() => {
    camera.position.set(0, 0, 2); camera.rotation.x = 0;
  }));
  document.getElementById('view-side').addEventListener('click', setView(() => {
    camera.position.set(0, -1.25, 1.66); camera.rotation.x = 35 * Math.PI / 180;
  }));
  document.getElementById('view-hide-water').addEventListener('click', () => { showWater = !showWater; });

  // Sliders with live value display
  const bind = (id, valId, digits, setter) => {
    const el = document.getElementById(id);
    const val = document.getElementById(valId);
    el.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      setter(v);
      if (val) val.textContent = v.toFixed(digits);
    });
  };
  // Surface
  bind('opt-damping',         'val-damping',         4, v => { waterSimulation.setDamping(1.0 - v); });
  bind('opt-wavespeed',       'val-wavespeed',       2, v => { waterSimulation.setWaveSpeed(v); });
  bind('opt-dropfalloff',     'val-dropfalloff',     1, v => { waterSimulation.setDropFalloff(v); });
  // Rain / Wind
  bind('opt-intensity',       'val-intensity',       2, v => { intensity = v; });
  bind('opt-wind-intensity',  'val-wind-intensity',  3, v => { windIntensity = v; });
  bind('opt-wind-strength',   'val-wind-strength',   2, v => { windStrength = v; });
  // Audio
  bind('opt-audio-gain',      'val-audio-gain',      5, v => { audioGain = v; });
  bind('opt-audio-smooth',    'val-audio-smooth',    2, v => { audioSmoothing = v; });
  bind('opt-audio-gate',      'val-audio-gate',      3, v => { audioGate = v; });
  // Caustics
  bind('opt-caustics-factor', 'val-caustics-factor', 2, v => { caustics.setCausticsFactor(v); });
  bind('opt-compress-k',      'val-compress-k',      3, v => { caustics.setCompressK(v); });
  bind('opt-pcf-blur',        'val-pcf-blur',        3, v => { environment.setPcfBlur(v); });
  // Water material
  bind('opt-eta',             'val-eta',             3, v => { water.setEta(v); caustics.setEta(v); });
  bind('opt-fresnel-bias',    'val-fresnel-bias',    2, v => { water.setFresnelBias(v); });
  bind('opt-fresnel-scale',   'val-fresnel-scale',   2, v => { water.setFresnelScale(v); });
  bind('opt-fresnel-power',   'val-fresnel-power',   1, v => { water.setFresnelPower(v); });
  // Cymatics knobs
  bind('opt-omega-ref',       'val-omega-ref',       2, v => { OMEGA_REF = v; });
  bind('opt-omega-exp',       'val-omega-exp',       2, v => { OMEGA_EXP = v; });
  bind('opt-sweep-min',       'val-sweep-min',       2, v => { sweepOmegaMin = v; });
  bind('opt-sweep-max',       'val-sweep-max',       1, v => { sweepOmegaMax = v; });
  bind('opt-sweep-dur',       'val-sweep-dur',       0, v => { sweepDuration = v * 1000; });
  bind('opt-rand-max-m',      'val-rand-max-m',      0, v => { randomMaxM = v; });
  bind('opt-rand-max-n',      'val-rand-max-n',      0, v => { randomMaxN = v; });
  // Fixed-mode test sliders (key 'y')
  bind('opt-test-m',          'val-test-m',          0, v => { modeTestM = Math.round(v); });
  bind('opt-test-n',          'val-test-n',          0, v => { modeTestN = Math.round(v); });
  bind('opt-test-omega',      'val-test-omega',      2, v => { modeTestOmega = v; });
  bind('opt-test-amp',        'val-test-amp',        4, v => { modeTestAmp = v; });
}


// TODO: 
// - enviroment / wind and rain traits
// - Improve wind simulation
// - chromatic aberration?
// - balance quality and performance (add modes for diffrent devices and auto detect?)
// - finalize traits and rarity
// - minimize code for the deployment
// - test net deployment
// - calculate gas 

// - fix water shader derivatives extension issue on some intel GPUs (MacBooks) (AI generated comment - look into comapability)
// - add a gui for parameters tweaking
// - add a way to load custom objects
// - add a way to load custom skyboxes
// - add a way to load custom audio reactivity rules
// - add a way to load custom water simulation parameters
// - add a way to load custom wind and rain parameters
// - add a way to save a screenshot
// - add a way to record a video