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

// Create a Random object for prng
const rng = new Random()

// Display FPS
/* DEV BEGIN */
// TODO: remove this after final testing for performance as its using an external dependency
const stats = new Stats()
stats.showPanel(0)
document.body.appendChild(stats.domElement)
/* DEV END */

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
let randomStart = true // Default token render state
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
// Damping scales with scale so larger scales settle faster (was previously dead code).
let attenuate = 1.0 - (0.0005 * scale)
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
let audioGain = 0.0003;
// Exponential smoothing factor for per-band magnitude (0 = no smoothing,
// closer to 1 = more smoothing / slower response).
let audioSmoothing = 0.75;
// Gate threshold below which a band is treated as silent
let audioGate = 0.04;
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
  modeRandomM = Math.floor(Math.random() * 8) + 1;  // 1..8 angular lobes
  modeRandomN = Math.floor(Math.random() * 5) + 1;  // 1..5 radial bands
  // log-uniform omega across the well-balanced range
  modeRandomOmega = Math.exp(Math.log(0.3) + Math.random() * Math.log(5.0/0.3));
  modeRandomAmp = 0.001;
  console.log(`random mode: m=${modeRandomM}, n=${modeRandomN}, omega=${modeRandomOmega.toFixed(3)} rad/s`);
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
    varying vec2 coord;
    void main() {
      /* Get vertex info */
      vec4 info = texture2D(texture, coord);
      /* Add the drop to the height */
      float drop = max(0.0, 1.0 - length(center * 0.5 + 0.5 - coord) / radius);
      // Quadratic falloff: a touch sharper than the original cos bell so
      // wavefronts stay crisp, but milder than the cubic which over-sharpened.
      drop = drop * drop;
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
    const resetMaterial = new THREE.RawShaderMaterial({
      fragmentShader: resetFrag,
      vertexShader: simVert
    });

    const resetMesh = new THREE.Mesh(this._geometry, resetMaterial);
    const oldTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(resetMesh, this._camera);
    renderer.setRenderTarget(oldTarget);
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
    // Compensate frequency-dependent gain. Iterative tuning: linear overshot,
    // sqrt still tilted low-weak/high-strong. Natural falloff exponent is
    // shallower than expected (~0.3). REF=0.83 rad/s puts the unity-gain
    // point at the 40% mark of the t-sweep.
    const OMEGA_REF = 0.83;
    const OMEGA_EXP = 0.3;
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
    varying vec2 refractedPosition[3];
    varying vec3 reflected;
    varying float reflectionFactor;
    const float refractionFactor = 1.;
    const float fresnelBias = 0.1;
    const float fresnelPower = 2.;
    const float fresnelScale = 1.;
    // Air refractive index / Water refractive index
    const float eta = 0.7504;
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
    // TODO Make it a uniform
    const float causticsFactor = 0.5;
    varying vec3 oldPosition;
    varying vec3 newPosition;
    varying float waterDepth;
    varying float depth;
    void main() {
      float causticsIntensity = 0.;
      if (depth >= waterDepth) {
        // Use the full Jacobian magnitude (cross product of partial derivatives)
        // instead of |dFdx| * |dFdy|. The latter is the axis-aligned bounding
        // rectangle and biases caustic intensity into a cross/diamond pattern
        // even when the underlying water surface is perfectly isotropic.
        float oldArea = length(cross(dFdx(oldPosition), dFdy(oldPosition)));
        float newArea = length(cross(dFdx(newPosition), dFdy(newPosition)));
        float ratio;
        // Prevent dividing by zero (debug NVidia drivers)
        if (newArea == 0.) {
          // Arbitrary large value
          ratio = 2.0e+20;
        } else {
          ratio = oldArea / newArea;
        }
        causticsIntensity = causticsFactor * ratio;
        // Soft-cap at the source. ratio blows up when newArea -> 0 at focal
        // points, generating values like 50+ that all collapse to ~1.0 under
        // any final tonemap and read as flat plateaus. Compressing here
        // bounds each contribution at ~10 while preserving low-intensity
        // gradient. Asymptote = 1/compressK = 10.
        const float compressK = 0.1;
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
    varying vec3 oldPosition;
    varying vec3 newPosition;
    varying float waterDepth;
    varying float depth;
    // Air refractive index / Water refractive index
    const float eta = 0.7504;
    // TODO Make this a uniform
    // This is the maximum iterations when looking for the ray intersection with the environment,
    // if after this number of attempts we did not find the intersection, the result will be wrong.
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
  varying float lightIntensity;
  varying vec3 lightPosition;
  const float bias = 0.001;
  const vec3 underwaterColor = vec3(0.2, 0.2, 0.2);
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
    // Set the frag color
    float computedLightIntensity = 0.5;
    computedLightIntensity += 0.2 * lightIntensity;
    // Retrieve caustics depth information
    float causticsDepth = texture2D(caustics, lightPosition.xy).w;
    if (causticsDepth > lightPosition.z - bias) {
      // Percentage Close Filtering
      float causticsIntensity = 0.5 * (
        blur(caustics, lightPosition.xy, resolution, vec2(0., 0.125)) +
        blur(caustics, lightPosition.xy, resolution, vec2(0.125, 0.))
      );
      computedLightIntensity += causticsIntensity * smoothstep(0., 1., lightIntensity);;
    }
    // Reinhard tonemap on the final color compresses caustic peaks smoothly
    // instead of clipping at 1.0, which previously produced hard plateaus
    // along the brightness gradients of focused ripples.
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
        lightViewMatrix: { value: lightCamera.matrixWorldInverse  }
      },
      vertexShader: envVert,
      fragmentShader: envFrag,
    });
  }

  setGeometries(geometries) {
    this._meshes = [];
    for (let geometry of geometries) this._meshes.push(new THREE.Mesh(geometry, this._material));
  }

  updateCaustics(causticsTexture) {
    this._material.uniforms['caustics'].value = causticsTexture;
  }

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
        var dropletSize = gustSize + (Math.random() * 0.01 - 0.005);
        var dropletMass = gustMass + (Math.random() - 0.5) * 0.001;
        // Was Math.floor(gustAmplitude * 10): up to 10 drops per frame.
        // Cut to ~3 max - still feels like a gust, far less energy.
        var numDroplets = Math.floor(gustAmplitude * 3);
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
          waterSimulation.addMode(renderer, band.m, band.n, band.omega, audioGain * band.smooth);
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

  // Render everything but the refractive water
  renderer.setRenderTarget(temporaryRenderTarget);
  renderer.setClearColor(white, 1);
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
  stats.end();
  window.requestAnimationFrame(animate);
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
    
    // TODO: create a 3d plane relief to project caustic patterns on using normal maps
    const envGeometries = renderObjects ? [rock1, rock2, shark, plant, new THREE.PlaneBufferGeometry(100, 100, 1, 1)] : [new THREE.PlaneBufferGeometry(100, 100, 1, 1)];
    environmentMap.setGeometries(envGeometries);
    environment.setGeometries(envGeometries);
    environment.addTo(scene);
    scene.add(water.mesh);
    caustics.setDeltaEnvTexture(1. / environmentMap.size);
    canvas.addEventListener('mousemove', { handleEvent: onMouseMove });
    document.onkeyup = function(e) {
      switch(e.key) {
        case 'm': if (!audio.audioLoaded) audio.startAudio(); soundReactive = !soundReactive; break;
        case 'r': raindrops = !raindrops; console.log("rain: ", raindrops); break;
        case 'w': wind = !wind; console.log("wind: ", wind); break;
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
        case 'h': showWater = !showWater; break;
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
      }
    };
    if(randomStart) {
      for (var i=0; i<startDrops; i++) {
        waterSimulation.addDrop(renderer, rng.random_dec()*2-1, rng.random_dec()*2-1, rng.random_dec()*0.05, rng.random_dec()*0.025*(i&1||-1));
      }
    }
    setupUI();
    animate();
});

// Wire the floating settings & help buttons to the drawer panels in index.html.
// Settings controls bidirectionally mirror the runtime state vars; drawers
// re-sync from current values whenever they're opened so that keyboard
// toggles stay reflected in the UI.
function setupUI() {
  const settingsBtn = document.getElementById('settings-toggle');
  const helpBtn = document.getElementById('help-toggle');
  const settingsDrawer = document.getElementById('settings-drawer');
  const helpDrawer = document.getElementById('help-drawer');

  function closeAll() {
    settingsDrawer.classList.remove('open');
    helpDrawer.classList.remove('open');
  }

  // Sync the inputs from the current global state
  function syncFromState() {
    const set = (id, prop, val) => {
      const el = document.getElementById(id);
      if (el) el[prop] = val;
    };
    const fmt = (id, val, digits) => {
      const el = document.getElementById(id);
      if (el) el.textContent = Number(val).toFixed(digits);
    };
    set('opt-rain', 'checked', raindrops);
    set('opt-wind', 'checked', wind);
    set('opt-audio', 'checked', soundReactive);
    set('opt-mouse', 'checked', mouseReactive);
    set('opt-intensity', 'value', intensity);
    fmt('val-intensity', intensity, 2);
    set('opt-wind-intensity', 'value', windIntensity);
    fmt('val-wind-intensity', windIntensity, 3);
    set('opt-audio-gain', 'value', audioGain);
    fmt('val-audio-gain', audioGain, 5);
    set('opt-audio-smooth', 'value', audioSmoothing);
    fmt('val-audio-smooth', audioSmoothing, 2);
    set('opt-audio-gate', 'value', audioGate);
    fmt('val-audio-gate', audioGate, 3);
  }

  settingsBtn.addEventListener('click', () => {
    const isOpen = settingsDrawer.classList.contains('open');
    closeAll();
    if (!isOpen) { syncFromState(); settingsDrawer.classList.add('open'); }
  });
  helpBtn.addEventListener('click', () => {
    const isOpen = helpDrawer.classList.contains('open');
    closeAll();
    if (!isOpen) helpDrawer.classList.add('open');
  });
  document.querySelectorAll('.drawer .close').forEach(btn => {
    btn.addEventListener('click', closeAll);
  });

  // Source toggles
  document.getElementById('opt-rain').addEventListener('change', e => {
    raindrops = e.target.checked;
  });
  document.getElementById('opt-wind').addEventListener('change', e => {
    wind = e.target.checked;
  });
  document.getElementById('opt-audio').addEventListener('change', e => {
    if (e.target.checked && !audio.audioLoaded) audio.startAudio();
    soundReactive = e.target.checked;
  });
  document.getElementById('opt-mouse').addEventListener('change', e => {
    mouseReactive = e.target.checked;
  });

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
  bind('opt-intensity',       'val-intensity',       2, v => { intensity = v; });
  bind('opt-wind-intensity',  'val-wind-intensity',  3, v => { windIntensity = v; });
  bind('opt-audio-gain',      'val-audio-gain',      5, v => { audioGain = v; });
  bind('opt-audio-smooth',    'val-audio-smooth',    2, v => { audioSmoothing = v; });
  bind('opt-audio-gate',      'val-audio-gate',      3, v => { audioGate = v; });
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