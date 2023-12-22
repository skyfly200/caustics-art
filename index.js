// Caustics Art Project

// Random Hashes and IDs for testing
function genTokenData(projectNum) {
    let data = {};
    let hash = "0x";
    for (var i = 0; i < 64; i++) {
      hash += Math.floor(Math.random() * 16).toString(16);
    }
    data.hash = hash;
    data.tokenId = ( projectNum * 1000000 + Math.floor(Math.random()*1000) ).toString();
    return data;
  }
  let tokenData = genTokenData(123);
  
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
  }
  
  // Create a Random object for prng
  const rng = new Random()
  
  /* DEV BEGIN */
  // TODO: remove this after final testing for performance as its using an external dependency
  const stats = new Stats()
  stats.showPanel(2)
  document.body.appendChild(stats.domElement)
  /* DEV END */
  
  // == Config==
  const canvas = document.getElementById('canvas')
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  const width = canvas.width
  const height = canvas.height
  
  // Art Controls and Config
  let simRes = 2**13
  let soundReactive = false
  let mouseReactive = true
  let showWater = true
  let focusWater = false
  let raindrops = false
  let intensity = 0.033
  let randPos = true
  let wind = false
  let windIntensity = 0.01
  let randomStart = true // Default token render state
  let startDrops = rng.random_int(3,55) // ~ Trait
  let geometryType = "polygon" // ~ Trait
  let polygonSides = rng.random_int(3,24) // ~ Trait
  let scale = rng.random_int(1,10) // ~ Trait
  let deltaRates = [1/(216*scale), 1/(216*scale)]
  let attenuate = 1.0 - (0.0015 * scale) - 0.0035
  
  //TODO: use scale in droplets
  
  // state vars for simulating water effects
  let gusting = false
  let gustLength = 0
  let gustStart = 0
  let gustPosition,gustSize,gustMass
  
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
  
  // Create mouse Controls
  // const controls = new THREE.OrbitControls(camera, canvas);
  // Object.assign(controls, {
  //     target: focusWater ? waterPosition : surfacePosition,
  //     minPolarAngle: 0,
  //     maxPolarAngle: Math.PI / 2 - 0.1,
  //     minDistance: 0.1,
  //     maxDistance: 7
  // });
  
  // Audio Reactivity Settings
  let audioReactivityRules = {
    bandCount: 32768,
    globalThreshold: 50,
    debugResponders: true,
    responders: [
      { startBand: 0, endBand: 0, size: 0.2, amp: 0.01, threshold: 250 },
      { startBand: 1, endBand: 1, size: 0.1, amp: 0.015, threshold: 240 },
      { startBand: 2, endBand: 2, size: 0.075, amp: 0.02, threshold: 220 },
      { startBand: 3, endBand: 3, size: 0.05, amp: 0.025, threshold: 210 },
      { startBand: 4, endBand: 4, size: 0.033, amp: 0.025, threshold: 200 },
      { startBand: 10, endBand: 20, size: 0.01, amp: 0.05, threshold: 180 },
      { startBand: 20, endBand: 30, size: 0.05, amp: 0.03, threshold: 190 }
    ]
  }
  
  class Audio {
    constructor() {
      this.frequencyData = null;
      this.analyzer = null;
      this.micLoaded =  false;
      this.audioLoaded = false;
    }
    startAudio() {
      // Get audio context and create an analyser node
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = audioContext.createAnalyser();
      // Set the FFT size (the number of bins in the frequency domain)
      this.analyser.fftSize = audioReactivityRules.bandCount;
  
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
      } catch(err) {
        console.log(err)
      } finally {}
    }
  }
  
  let audio = new Audio()
  
  document.onkeyup = function(e) {
      switch(e.key) {
        case 'm': if (!audio.audioLoaded) audio.startAudio(); soundReactive = !soundReactive; break;
        case 'r': raindrops = !raindrops; break;
        case 'w': wind = !wind; break;
        case 'c': waterSimulation.resetSimulation(renderer); break;
        case 'd': camera.position.set(0, 0, 6); break;
        case 'e': camera.position.set(0, 0, 2); break;
        case 'h': showWater = !showWater; break;
      }
    };
  
  // Target for computing the water refraction
  const temporaryRenderTarget = new THREE.WebGLRenderTarget(width, height);
  const clock = new THREE.Clock();
  
  // Ray caster
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const targetgeometry = new THREE.PlaneGeometry(2, 2);
  for (let vertex of targetgeometry.vertices) vertex.z = waterPosition.z;
  const targetmesh = new THREE.Mesh(targetgeometry);
  
  const simUpdateFrag = `
      precision highp float;
      precision highp int;
      uniform sampler2D texture;
      uniform vec2 delta;
      uniform float att;
      varying vec2 coord;
      void main() {
        /* get vertex info */
        vec4 info = texture2D(texture, coord);
        /* calculate average neighbor height */
        vec2 dx = vec2(delta.x, 0.0);
        vec2 dy = vec2(0.0, delta.y);
        float average = (
          texture2D(texture, coord - dx).r +
          texture2D(texture, coord - dy).r +
          texture2D(texture, coord + dx).r +
          texture2D(texture, coord + dy).r
        ) * 0.25;
        /* change the velocity to move toward the average */
        info.g += (average - info.r) * 2.0;
        /* attenuate the velocity a little so waves do not last forever */
        info.g *= att;
        /* move the vertex along the velocity */
        info.r += info.g;
        /* update the normal */
        vec3 ddx = vec3(delta.x, texture2D(texture, vec2(coord.x + delta.x, coord.y)).r - info.r, 0.0);
        vec3 ddy = vec3(0.0, texture2D(texture, vec2(coord.x, coord.y + delta.y)).r - info.r, delta.y);
        info.ba = normalize(cross(ddy, ddx)).xz;
        gl_FragColor = info;
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
        drop = 0.5 - cos(drop * PI) * 0.5;
        info.r += drop * strength;
        gl_FragColor = info;
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
  
      if (geometryType == "plane")
        this._geometry = new THREE.PlaneBufferGeometry(1.8, 1.8);
      else if (geometryType == "polygon")
        this._geometry = new THREE.CircleGeometry(0.9, polygonSides);
  
      this._targetA = new THREE.WebGLRenderTarget(waterSize, waterSize, {type: THREE.FloatType});
      this._targetB = new THREE.WebGLRenderTarget(waterSize, waterSize, {type: THREE.FloatType});
      this.target = this._targetA;
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
          att: { value: attenuate },
          texture: { value: null },
        },
        vertexShader: simVert,
        fragmentShader: simUpdateFrag,
      });
  
      this._dropMesh = new THREE.Mesh(this._geometry, dropMaterial);
      this._updateMesh = new THREE.Mesh(this._geometry, updateMaterial);
    }
    
    resetSimulation(renderer) {
      const resetMaterial = new THREE.RawShaderMaterial({
        fragmentShader: resetFrag,
        vertexShader: simVert
      });
  
    //   const resetMesh = new THREE.Mesh(this._geometry, resetMaterial);
    //   const oldTarget = renderer.getRenderTarget();
    //   renderer.setRenderTarget(this.target);
    //   renderer.render(resetMesh, this._camera);
    //   renderer.setRenderTarget(oldTarget);
    }
  
    // Add a drop of water at the (x, y) coordinate (in the range [-1, 1])
    addDrop(renderer, x, y, radius, strength) {
      const { uniforms } = this._dropMesh.material;
      Object.assign(uniforms, {
        'center': { value: [x, y] },
        'radius': { value: radius },
        'strength': { value: strength }
      });
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
  const mapFrag = `
      varying vec4 worldPosition;
      varying float depth;
      void main() {
        gl_FragColor = vec4(worldPosition.xyz, depth);
      }
  `;
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
      for (let geometry of geometries)
        this._meshes.push(new THREE.Mesh(geometry, this._material));
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
      const float causticsFactor = 0.15;
      varying vec3 oldPosition;
      varying vec3 newPosition;
      varying float waterDepth;
      varying float depth;
      void main() {
        float causticsIntensity = 0.;
        if (depth >= waterDepth) {
          float oldArea = length(dFdx(oldPosition)) * length(dFdy(oldPosition));
          float newArea = length(dFdx(newPosition)) * length(dFdy(newPosition));
          float ratio;
          // Prevent dividing by zero (debug NVidia drivers)
          if (newArea == 0.) {
            // Arbitrary large value
            ratio = 2.0e+20;
          } else {
            ratio = oldArea / newArea;
          }
          causticsIntensity = causticsFactor * ratio;
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
          blur(caustics, lightPosition.xy, resolution, vec2(0., 0.5)) +
          blur(caustics, lightPosition.xy, resolution, vec2(0.5, 0.))
        );
        computedLightIntensity += causticsIntensity * smoothstep(0., 1., lightIntensity);;
      }
      gl_FragColor = vec4(underwaterColor * computedLightIntensity, 1.);
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
  
  function createADSR(attack, decay, sustain, release, duration) {
    return function (time) {
      var attackDur = attack * duration, decayDur = decay * duration, releaseDur = release * duration;
      var sustainDur = duration - attackDur - decayDur - releaseDur;
      if (time <= attackDur) return time / attackDur;
      if (time <= attackDur + decayDur) return (1 - sustain) * (1 - (time - attackDur) / decayDur) + sustain;
      return time <= duration - releaseDur ? sustain : sustain * (1 - (time - (duration - releaseDur)) / releaseDur);
    }
  }
  
  const waterSimulation = new WaterSimulation();
  const water = new Water();
  const environmentMap = new EnvironmentMap();
  const environment = new Environment();
  const caustics = new Caustics();
  
  // Main rendering loop
  function animate() {
    stats.begin();
    // Rain
    if (raindrops) {
      if (Math.random() <= intensity) {
        let size = Math.random() * 0.05 * scale;
        let mass = Math.random() * 0.05 * scale;
        mass = (Math.random() > 0.5) ? mass : mass * -1
        let posX = randPos ? Math.random() * 2 - 1 : 0;
        let posY = randPos ? Math.random() * 2 - 1 : 0;
        waterSimulation.addDrop( renderer, posX, posY, size, mass );
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
        gustSize = Math.random() * 0.1 + 0.05;
        gustMass = Math.random() * 0.01;
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
          var dropletSize = gustSize + (Math.random() * 0.02 - 0.01);
          var dropletMass = gustMass + (Math.random() - 0.5) * 0.002;
          var numDroplets = Math.floor(gustAmplitude * 10);
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
      if (soundReactive && audio.audioLoaded) {
        let fd = audio.frequencyData
        audio.analyser.getByteFrequencyData(fd);
        const responders = audioReactivityRules.responders;
        for (const r in responders) {
          let threshold = audioReactivityRules.globalThreshold / 255 * responders[r].threshold;
          let posX = randPos ? Math.random() * 2 - 1 : 0;
          let posY = randPos ? Math.random() * 2 - 1 : 0;
  
          if (responders[r].startBand === responders[r].endBand) {
            // Single band responder
            if (audioReactivityRules.debugResponders) console.log(responders[r].startBand, fd[responders[r].startBand], fd[responders[r].startBand] > threshold, threshold);
            waterSimulation.addDrop(renderer, posX, posY, responders[r].size, (audio.frequencyData[responders[r].startBand] > threshold ? responders[r].amp : 0 ));
          } else {
            // Range of bands responder
            let totalAmp = 0;
            for (let i = responders[r].startBand; i <= responders[r].endBand; i++) totalAmp += fd[i];
            let avgAmp = totalAmp / (responders[r].endBand - responders[r].startBand + 1);
            if (audioReactivityRules.debugResponders) console.log(responders[r].startBand + "-" + responders[r].endBand, avgAmp, avgAmp > threshold, threshold);
          waterSimulation.addDrop(renderer, posX, posY, responders[r].size, (avgAmp > threshold ? responders[r].amp : 0));
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
      audio.micLoaded
    ]).then(() => {
    const envGeometries = [new THREE.PlaneBufferGeometry(100, 100, 1, 1)];
    environmentMap.setGeometries(envGeometries);
    environment.setGeometries(envGeometries);
    environment.addTo(scene);
    scene.add(water.mesh);
    caustics.setDeltaEnvTexture(1. / environmentMap.size);
    canvas.addEventListener('mousemove', { handleEvent: onMouseMove });
    for (var i = 0; i < (randomStart ? startDrops : 0); i++)
      waterSimulation.addDrop(renderer, rng.random_dec()*2-1, rng.random_dec()*2-1, 0.05*(1/scale), 0.05*(i&1||-1))*(1/scale);
    animate();
  });