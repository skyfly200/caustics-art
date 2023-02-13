// Example

const stats = new Stats();
stats.showPanel(0);
document.body.appendChild(stats.domElement);

const canvas = document.getElementById('canvas');

const width = canvas.width * 0.66;
const height = canvas.height * 0.66;

// Art Controls and Config
let soundReactive = false;
let mouseReactive = false;
let focusWater = false;
let audioReactivityRules = {
  bandCount: 64,
  globalThreshold: 155,
  debugResponders: true,
  responders: [
    { band: 0, size: 0.2, amp: 0.01, threshold: 250 },
    { band: 1, size: 0.1, amp: 0.015, threshold: 240 },
    { band: 2, size: 0.075, amp: 0.02, threshold: 220 },
    { band: 3, size: 0.05, amp: 0.025, threshold: 210 },
    { band: 4, size: 0.033, amp: 0.025, threshold: 200 },
    { band: 10, size: 0.01, amp: 0.05, threshold: 130 },
  ]
};
    // { band: 6, size: 0.04, amp: 0.11, threshold: 150 },
    // { band: 8, size: 0.03, amp: 0.12, threshold: 140 },
    // { band: 15, size: 0.025, amp: 0.15, threshold: 130 },
let randomStart = false;
let startDrops = 33;
let raindrops = true;
let intensity = 0.075;
let wind = false;
let windIntensity = 0.005;
let geometryType = "plane";
let polygonSides = 6; 

// state vars for simulating water effects
let gusting = false;
let gustLength = 0;
let gustStart = 0;
let gustPosition;
let gustSize;
let gustMass;

// Colors
const black = new THREE.Color('black');
const white = new THREE.Color('white');

function loadFile(filename) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.FileLoader();

    loader.load(filename, (data) => {
      resolve(data);
    });
  });
}

// Constants
const waterPosition = new THREE.Vector3(0, 0, 4);
const surfacePosition = new THREE.Vector3(0, 0, 0);
const near = 0;
const far = 7;
const waterSize = 2048;

// Create directional light
// TODO Replace this by a THREE.DirectionalLight and use the provided matrix (check that it's an Orthographic matrix as expected)
const light = [0., 0., -1.];
const lightCamera = new THREE.OrthographicCamera(-1.2, 1.2, 1.2, -1.2, near, far);
lightCamera.position.set(0., 0., far);
lightCamera.lookAt(0, 0, 0);

// Create Renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, width / height, 0.01, 100);
camera.position.set(0, 0, 2.25);
camera.up.set(0, 0, 1);
scene.add(camera);

const renderer = new THREE.WebGLRenderer({canvas: canvas, antialias: true, alpha: true});
renderer.setSize(width, height);
renderer.autoClear = false;
renderer.setPixelRatio( window.devicePixelRatio * 1.5 );

// TODO: Replace OrbitControls lib with three.js core solution

// Create mouse Controls
const controls = new THREE.OrbitControls(
  camera,
  canvas
);

controls.target = focusWater ? waterPosition : surfacePosition;

controls.minPolarAngle = 0;
controls.maxPolarAngle = Math.PI / 2. - 0.1;

controls.minDistance = 0.1;
controls.maxDistance = 7;

// Get audio context and create an analyser node
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const analyser = audioContext.createAnalyser();
// Set the FFT size (the number of bins in the frequency domain)
analyser.fftSize = audioReactivityRules.bandCount;

let frequencyData;
let micLoaded;

// TODO: out this into a seperate function

try {
  // Get the microphone stream
  micLoaded = navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then( (value) => {
    // Connect the microphone stream to the analyser node
    const microphone = audioContext.createMediaStreamSource(value);
    microphone.connect(analyser);

    // Get the frequency data from the analyser
    frequencyData = new Uint8Array(analyser.frequencyBinCount);
  });
} finally {}

// Target for computing the water refraction
const temporaryRenderTarget = new THREE.WebGLRenderTarget(width, height);

// Clock
const clock = new THREE.Clock();

// Ray caster
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const targetgeometry = new THREE.PlaneGeometry(2, 2);
for (let vertex of targetgeometry.vertices) {
  vertex.z = waterPosition.z;
}
const targetmesh = new THREE.Mesh(targetgeometry);

// Geometries
const waterGeometry = new THREE.PlaneBufferGeometry(2, 2, waterSize, waterSize);
const vertices = new Float32Array([
  -1, -1, -1,
  -1, -1, 1,
  -1, 1, -1,
  -1, 1, 1,
  1, -1, -1,
  1, 1, -1,
  1, -1, 1,
  1, 1, 1,
  -1, -1, -1,
  1, -1, -1,
  -1, -1, 1,
  1, -1, 1,
  -1, 1, -1,
  -1, 1, 1,
  1, 1, -1,
  1, 1, 1,
  -1, -1, -1,
  -1, 1, -1,
  1, -1, -1,
  1, 1, -1,
  -1, -1, 1,
  1, -1, 1,
  -1, 1, 1,
  1, 1, 1
]);
const indices = new Uint32Array([
  0, 1, 2,
  2, 1, 3,
  4, 5, 6,
  6, 5, 7,
  12, 13, 14,
  14, 13, 15,
  16, 17, 18,
  18, 17, 19,
  20, 21, 22,
  22, 21, 23
]);

// Environment
const floorGeometry = new THREE.PlaneBufferGeometry(100, 100, 1, 1);

class WaterSimulation {

  constructor() {
    this._camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0, 2000);

    if (geometryType == "plane")
      this._geometry = new THREE.PlaneBufferGeometry(2, 2);
    else if (geometryType == "polygon")
      this._geometry = new THREE.CircleGeometry(0.9, polygonSides);

    this._targetA = new THREE.WebGLRenderTarget(waterSize, waterSize, {type: THREE.FloatType});
    this._targetB = new THREE.WebGLRenderTarget(waterSize, waterSize, {type: THREE.FloatType});
    this.target = this._targetA;

    const shadersPromises = [
      loadFile('https://raw.githubusercontent.com/martinRenou/threejs-caustics/master/shaders/simulation/vertex.glsl'),
      loadFile('https://raw.githubusercontent.com/martinRenou/threejs-caustics/master/shaders/simulation/drop_fragment.glsl'),
      loadFile('https://raw.githubusercontent.com/martinRenou/threejs-caustics/master/shaders/simulation/update_fragment.glsl'),
    ];

    this.loaded = Promise.all(shadersPromises)
        .then(([vertexShader, dropFragmentShader, updateFragmentShader]) => {
      const dropMaterial = new THREE.RawShaderMaterial({
        uniforms: {
            center: { value: [0, 0] },
            radius: { value: 0 },
            strength: { value: 0 },
            texture: { value: null },
        },
        vertexShader: vertexShader,
        fragmentShader: dropFragmentShader,
      });

      const updateMaterial = new THREE.RawShaderMaterial({
        uniforms: {
            delta: { value: [1 / 216, 1 / 216] },  // TODO: Remove this useless uniform and hardcode it in shaders?
            texture: { value: null },
        },
        vertexShader: vertexShader,
        fragmentShader: updateFragmentShader,
      });

      this._dropMesh = new THREE.Mesh(this._geometry, dropMaterial);
      this._updateMesh = new THREE.Mesh(this._geometry, updateMaterial);
    });
  }

  // Add a drop of water at the (x, y) coordinate (in the range [-1, 1])
  addDrop(renderer, x, y, radius, strength) {
    this._dropMesh.material.uniforms['center'].value = [x, y];
    this._dropMesh.material.uniforms['radius'].value = radius;
    this._dropMesh.material.uniforms['strength'].value = strength;

    this._render(renderer, this._dropMesh);
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


class Water {

  constructor() {
    this.geometry = waterGeometry;

    const shadersPromises = [
      loadFile('https://raw.githubusercontent.com/martinRenou/threejs-caustics/master/shaders/water/vertex.glsl'),
      loadFile('https://raw.githubusercontent.com/martinRenou/threejs-caustics/master/shaders/water/fragment.glsl')
    ];

    this.loaded = Promise.all(shadersPromises)
        .then(([vertexShader, fragmentShader]) => {
      this.material = new THREE.ShaderMaterial({
        uniforms: {
            light: { value: light },
            water: { value: null },
            envMap: { value: null },
            skybox: { value: null },
        },
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
      });
      this.material.extensions = {
        derivatives: true
      };

      this.mesh = new THREE.Mesh(this.geometry, this.material);
      this.mesh.position.set(waterPosition.x, waterPosition.y, waterPosition.z);
    });
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
class EnvironmentMap {

  constructor() {
    this.size = 1024;
    this.target = new THREE.WebGLRenderTarget(this.size, this.size, {type: THREE.FloatType});

    const shadersPromises = [
      loadFile('https://raw.githubusercontent.com/martinRenou/threejs-caustics/master/shaders/environment_mapping/vertex.glsl'),
      loadFile('https://raw.githubusercontent.com/martinRenou/threejs-caustics/master/shaders/environment_mapping/fragment.glsl')
    ];

    this._meshes = [];

    this.loaded = Promise.all(shadersPromises)
        .then(([vertexShader, fragmentShader]) => {
      this._material = new THREE.ShaderMaterial({
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
      });
    });
  }

  setGeometries(geometries) {
    this._meshes = [];

    for (let geometry of geometries) {
      this._meshes.push(new THREE.Mesh(geometry, this._material));
    }
  }

  render(renderer) {
    const oldTarget = renderer.getRenderTarget();

    renderer.setRenderTarget(this.target);
    renderer.setClearColor(black, 0);
    renderer.clear();

    for (let mesh of this._meshes) {
      renderer.render(mesh, lightCamera);
    }

    renderer.setRenderTarget(oldTarget);
  }

}


class Caustics {

  constructor() {
    this.target = new THREE.WebGLRenderTarget(waterSize * 3., waterSize * 3., {type: THREE.FloatType});

    this._waterGeometry = new THREE.PlaneBufferGeometry(2, 2, waterSize, waterSize);

    const shadersPromises = [
      loadFile('https://raw.githubusercontent.com/martinRenou/threejs-caustics/master/shaders/caustics/water_vertex.glsl'),
      loadFile('https://raw.githubusercontent.com/martinRenou/threejs-caustics/master/shaders/caustics/water_fragment.glsl'),
    ];

    this.loaded = Promise.all(shadersPromises)
        .then(([waterVertexShader, waterFragmentShader]) => {
      this._waterMaterial = new THREE.ShaderMaterial({
        uniforms: {
          light: { value: light },
          env: { value: null },
          water: { value: null },
          deltaEnvTexture: { value: null },
        },
        vertexShader: waterVertexShader,
        fragmentShader: waterFragmentShader,
        transparent: true,
      });

      this._waterMaterial.blending = THREE.CustomBlending;

      // Set the blending so that:
      // Caustics intensity uses an additive function
      this._waterMaterial.blendEquation = THREE.AddEquation;
      this._waterMaterial.blendSrc = THREE.OneFactor;
      this._waterMaterial.blendDst = THREE.OneFactor;

      // Caustics depth does not use blending, we just set the value
      this._waterMaterial.blendEquationAlpha = THREE.AddEquation;
      this._waterMaterial.blendSrcAlpha = THREE.OneFactor;
      this._waterMaterial.blendDstAlpha = THREE.ZeroFactor;


      this._waterMaterial.side = THREE.DoubleSide;
      this._waterMaterial.extensions = {
        derivatives: true
      };

      this._waterMesh = new THREE.Mesh(this._waterGeometry, this._waterMaterial);
    });
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


class Environment {

  constructor() {
    const shadersPromises = [
      loadFile('https://raw.githubusercontent.com/martinRenou/threejs-caustics/master/shaders/environment/vertex.glsl'),
      loadFile('https://raw.githubusercontent.com/skyfly200/caustics-art/master/shaders/environment/fragment.glsl')
    ];
    

    this._meshes = [];

    this.loaded = Promise.all(shadersPromises).then(([vertexShader, fragmentShader]) => {
      this._material = new THREE.ShaderMaterial({
        uniforms: {
          light: { value: light },
          caustics: { value: null },
          lightProjectionMatrix: { value: lightCamera.projectionMatrix },
          lightViewMatrix: { value: lightCamera.matrixWorldInverse  }
        },
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
      });
    });
  }

  setGeometries(geometries) {
    this._meshes = [];

    for (let geometry of geometries) {
      this._meshes.push(new THREE.Mesh(geometry, this._material));
    }
  }

  updateCaustics(causticsTexture) {
    this._material.uniforms['caustics'].value = causticsTexture;
  }

  addTo(scene) {
    for (let mesh of this._meshes) {
      scene.add(mesh);
    }
  }

}


class Debug {

  constructor() {
    this._camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0, 1);
    this._geometry = new THREE.PlaneBufferGeometry();

    const shadersPromises = [
      loadFile('https://raw.githubusercontent.com/martinRenou/threejs-caustics/master/shaders/debug/vertex.glsl'),
      loadFile('https://raw.githubusercontent.com/martinRenou/threejs-caustics/master/shaders/debug/fragment.glsl')
    ];

    this.loaded = Promise.all(shadersPromises)
        .then(([vertexShader, fragmentShader]) => {
      this._material = new THREE.RawShaderMaterial({
        uniforms: {
            texture: { value: null },
        },
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
      });

      this._mesh = new THREE.Mesh(this._geometry, this._material);
      this._material.transparent = true;
    });
  }

  draw(renderer, texture) {
    this._material.uniforms['texture'].value = texture;

    const oldTarget = renderer.getRenderTarget();

    renderer.setRenderTarget(null);
    renderer.render(this._mesh, this._camera);

    renderer.setRenderTarget(oldTarget);
  }

}

const waterSimulation = new WaterSimulation();

const water = new Water();

const environmentMap = new EnvironmentMap();
const environment = new Environment();
const caustics = new Caustics();

const debug = new Debug();


// Main rendering loop
function animate() {
  stats.begin();
  
  // Rain
  if (raindrops) {
    if (Math.random() <= intensity) {
      let size = Math.random() * 0.1;
      let mass = Math.random() * 0.1;
      mass = (Math.random() > 0.5) ? mass : mass * -1
      waterSimulation.addDrop(
        renderer,
        Math.random() * 2 - 1, Math.random() * 2 - 1,
        size, mass
      );
    }
  }
  
  // Wind
  if (wind) {
    // threshold for a gust to start
    if (!gusting && (new Date().getTime() - gustStart >= gustLength) && Math.random() <= windIntensity) {
      gusting = true;
      gustLength = ((18 * Math.random()) + 2) * 1000;
      gustStart = new Date().getTime();
      gustPosition = {x: Math.random() * 2 - 1, y: Math.random() * 2 - 1};
      gustDirection = {x: Math.random() * 2 - 1, y: Math.random() * 2 - 1};
      gustSize = Math.random() * 0.1 + 0.1;
      gustMass = Math.random() * 0.1;
    }
    if (gusting) {
      // move and vary wind gust variables frame by frame
      gustPosition = {
        x: gustPosition.x + (gustDirection.x * 0.005),
        y: gustPosition.y + (gustDirection.y * 0.005)
      };
      //gustSize = gustSize + (Math.random() * 0.02 - 0.01);
      //gustMass = gustMass + (Math.random() -0.5 * 0.002);
      waterSimulation.addDrop(
        renderer,
        gustPosition.x, gustPosition.y,
        gustSize, gustMass
      );
      // TODO: gust ramp with randomness in duration (ADSR envelope)
      // check for gust end
      gusting = (new Date().getTime() - gustStart) < gustLength;
    }
  }

  // Update the water
  if (clock.getElapsedTime() > 0.032) {
    analyser.getByteFrequencyData(frequencyData);
    
    if (soundReactive) {
      const responders = audioReactivityRules.responders;
      for (const r in responders) {
        let threshold = audioReactivityRules.globalThreshold / 255 * responders[r].threshold;
        if (audioReactivityRules.debugResponders) console.log(responders[r].band, frequencyData[responders[r].band], frequencyData[responders[r].band] > threshold, threshold);
        waterSimulation.addDrop(renderer, 0, 0, responders[r].size, (frequencyData[responders[r].band] > threshold ? responders[r].amp : 0 ));
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

    // debug.draw(renderer, environmentMapTexture);
    // debug.draw(renderer, causticsTexture);

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

  controls.update();

  stats.end();

  window.requestAnimationFrame(animate);
}

function onMouseMove(event) {
  if (mouseReactive) {
    const rect = canvas.getBoundingClientRect();

    mouse.x = (event.clientX - rect.left) * 2 / width - 1;
    mouse.y = - (event.clientY - rect.top) * 2 / height + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObject(targetmesh);

    for (let intersect of intersects) {
      waterSimulation.addDrop(renderer, intersect.point.x, intersect.point.y, 0.03, 0.02);
    }
  }
}

const loaded = [
  waterSimulation.loaded,
  water.loaded,
  environmentMap.loaded,
  environment.loaded,
  caustics.loaded,
  debug.loaded,
  micLoaded,
];

Promise.all(loaded).then(() => {
  const envGeometries = [floorGeometry];

  environmentMap.setGeometries(envGeometries);
  environment.setGeometries(envGeometries);

  environment.addTo(scene);
  scene.add(water.mesh);

  caustics.setDeltaEnvTexture(1. / environmentMap.size);

  canvas.addEventListener('mousemove', { handleEvent: onMouseMove });

  // Random starting drops
  if (randomStart) {
    for (var i = 0; i < startDrops; i++) {
      waterSimulation.addDrop(
        renderer,
        Math.random() * 2 - 1, Math.random() * 2 - 1,
        0.05, (i & 1) ? 0.05 : -0.05
      );
    }
  }

  animate();
});