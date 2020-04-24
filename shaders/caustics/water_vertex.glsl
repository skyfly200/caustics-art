uniform vec3 light;

uniform sampler2D water;
uniform sampler2D env;

varying vec3 oldPosition;
varying vec3 newPosition;

// Air refractive index / Water refractive index
const float eta = 0.7504;

// TODO Make this a uniform
const float EPSILON = 0.01;

// TODO Make this a uniform
// This is the maximum iterations when looking for the ray intersection with the environment,
// if after this number of attempts we did not find the intersection, the result will be off.
const int MAX_ITERATIONS = 100;


void main() {
  vec4 waterInfo = texture2D(water, position.xy * 0.5 + 0.5);

  // The water position is the vertex position on which we apply the height-map
  // TODO Remove the ugly hardcoded +0.5 for the water position
  vec3 waterPosition = vec3(position.xy, position.z + waterInfo.r + 0.5);
  vec3 waterNormal = normalize(vec3(waterInfo.b, sqrt(1.0 - dot(waterInfo.ba, waterInfo.ba)), waterInfo.a)).xzy;

  // This is the initial position: the ray starting point
  oldPosition = waterPosition;

  // Compute water coordinates in the screen space
  vec4 projectedWaterPosition = projectionMatrix * viewMatrix * vec4(waterPosition, 1.);

  // Compute water depth, from the light POV
  float zDepth = projectedWaterPosition.z / projectedWaterPosition.w;
  float waterDepth = 0.5 + zDepth * 0.5;

  vec2 coords = projectedWaterPosition.xy * 0.5 + 0.5;

  vec3 refracted = refract(light, waterNormal, eta);
  vec4 projectedRefractionVector = projectionMatrix * viewMatrix * vec4(refracted, 1.);

  float refractedDepth = 0.5 + 0.5 * projectedRefractionVector.z / projectedRefractionVector.w;
  vec2 refractedDirection = projectedRefractionVector.xy;

  float currentDepth = waterDepth;
  vec4 environment;
  environment = texture2D(env, coords);

  for (int i = 0; i < MAX_ITERATIONS; i++) {
    if (environment.w - currentDepth <= EPSILON
        || any(lessThan(coords, vec2(0.)))
        || any(greaterThan(coords, vec2(1.)))) {
      break;
    }

    // Move the coords in the direction of the refraction
    coords += refractedDirection * 0.004;

    // Move the current ray depth in the direction of the refraction
    currentDepth += refractedDepth * 0.004;

    environment = texture2D(env, coords);
  }

  newPosition = environment.xyz;

  gl_Position = projectionMatrix * viewMatrix * vec4(newPosition, 1.0);
}