export const earthVertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;

void main() {
  vUv = uv;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPosition = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/**
 * Physically-motivated Earth shading: Lambertian day side from the NASA Blue Marble
 * composite, VIIRS city lights on the night side, a Blinn-Phong ocean highlight masked
 * to water pixels, warm scattering through the terminator and a Rayleigh-tinted limb.
 */
export const earthFragmentShader = /* glsl */ `
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform vec3 sunDirection;
uniform float nightIntensity;
uniform float texelWidth;

varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;

float relativeLuminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec3 normal = normalize(vWorldNormal);
  vec3 lightDir = normalize(sunDirection);
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);

  vec3 dayColor = texture2D(dayMap, vUv).rgb;
  vec3 nightColor = texture2D(nightMap, vUv).rgb;

  // Ocean pixels in the Blue Marble composite are blue-dominant and comparatively dark.
  float water = smoothstep(0.015, 0.11, dayColor.b - dayColor.r)
              * (1.0 - smoothstep(0.42, 0.72, relativeLuminance(dayColor)));

  // Land relief from the luminance gradient of the shaded-relief texture.
  float lx = relativeLuminance(texture2D(dayMap, vUv + vec2(texelWidth, 0.0)).rgb)
           - relativeLuminance(texture2D(dayMap, vUv - vec2(texelWidth, 0.0)).rgb);
  float ly = relativeLuminance(texture2D(dayMap, vUv + vec2(0.0, texelWidth)).rgb)
           - relativeLuminance(texture2D(dayMap, vUv - vec2(0.0, texelWidth)).rgb);
  vec3 tangent = normalize(cross(vec3(0.0, 1.0, 0.0), normal));
  vec3 bitangent = cross(normal, tangent);
  vec3 shaded = normalize(normal - (tangent * lx + bitangent * ly) * 2.4 * (1.0 - water));

  float ndl = dot(shaded, lightDir);
  float smoothNdl = dot(normal, lightDir);
  float dayAmount = smoothstep(-0.14, 0.22, smoothNdl);

  vec3 color = dayColor * (0.045 + 1.06 * clamp(ndl, 0.0, 1.0));

  vec3 halfVector = normalize(lightDir + viewDir);
  float specular = pow(max(dot(normal, halfVector), 0.0), 900.0)
                 * water * smoothstep(0.0, 0.25, smoothNdl);
  color += vec3(0.60, 0.74, 0.94) * specular * 1.1;

  vec3 cityGlow = nightColor * vec3(1.0, 0.84, 0.56) * nightIntensity;
  color = mix(cityGlow, color, dayAmount);

  float fresnel = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 3.6);
  color += vec3(0.17, 0.34, 0.68) * fresnel * (0.16 + 0.7 * clamp(smoothNdl + 0.18, 0.0, 1.0));

  float terminator = smoothstep(0.0, 0.26, 0.26 - abs(smoothNdl));
  color += vec3(0.95, 0.46, 0.2) * terminator * fresnel * 0.65;

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const atmosphereVertexShader = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;

void main() {
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPosition = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const atmosphereFragmentShader = /* glsl */ `
uniform vec3 sunDirection;
uniform vec3 glowColor;
uniform float strength;

varying vec3 vWorldNormal;
varying vec3 vWorldPosition;

void main() {
  vec3 normal = normalize(vWorldNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float rim = pow(clamp(1.0 - dot(normal, viewDir), 0.0, 1.0), 4.2);
  float lit = clamp(dot(-normal, normalize(sunDirection)) + 0.32, 0.0, 1.0);
  float alpha = rim * lit * strength;
  gl_FragColor = vec4(glowColor * (0.65 + 0.6 * lit), alpha);
}
`;

export const starVertexShader = /* glsl */ `
attribute float size;
attribute float twinkle;
uniform float time;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vColor = color;
  vAlpha = 0.55 + 0.45 * sin(time * twinkle + twinkle * 40.0);
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (320.0 / -viewPosition.z);
  gl_Position = projectionMatrix * viewPosition;
}
`;

export const starFragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 offset = gl_PointCoord - vec2(0.5);
  float d = length(offset);
  if (d > 0.5) discard;
  float core = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vColor, pow(core, 2.4) * vAlpha);
}
`;
