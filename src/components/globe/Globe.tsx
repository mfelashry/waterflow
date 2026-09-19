"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { lonLatToVector3 } from "@/lib/geo";
import {
  atmosphereFragmentShader,
  atmosphereVertexShader,
  earthFragmentShader,
  earthVertexShader,
  starFragmentShader,
  starVertexShader,
} from "@/components/globe/shaders";

export type GlobeTarget = { lat: number; lon: number } | null;

const IDLE_DISTANCE = 3.42;
const ARRIVAL_DISTANCE = 1.035;
const FLIGHT_MS = 2600;

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function easeOutQuint(t: number) {
  return 1 - (1 - t) ** 5;
}

function useEarthTextures() {
  const [textures, setTextures] = useState<{
    day: THREE.Texture;
    night: THREE.Texture;
  } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    const load = (layer: string) =>
      new Promise<THREE.Texture>((resolve, reject) =>
        loader.load(
          `/api/earth-texture?layer=${layer}`,
          resolve,
          undefined,
          reject,
        ),
      );

    Promise.all([load("day"), load("night")])
      .then(([day, night]) => {
        if (cancelled) return;
        for (const texture of [day, night]) {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 8;
          texture.wrapS = THREE.RepeatWrapping;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
        }
        setTextures({ day, night });
      })
      .catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
    };
  }, []);

  return { textures, failed };
}

const STAR_COUNT = 1500;

function allocateStarGeometry() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(STAR_COUNT * 3), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(STAR_COUNT * 3), 3));
  geo.setAttribute("size", new THREE.BufferAttribute(new Float32Array(STAR_COUNT), 1));
  geo.setAttribute("twinkle", new THREE.BufferAttribute(new Float32Array(STAR_COUNT), 1));
  return geo;
}

/** Fills an allocated star geometry with a plausible magnitude and colour distribution. */
function seedStars(geo: THREE.BufferGeometry) {
  const count = STAR_COUNT;
  const positions = geo.getAttribute("position") as THREE.BufferAttribute;
  const colors = geo.getAttribute("color") as THREE.BufferAttribute;
  const sizes = geo.getAttribute("size") as THREE.BufferAttribute;
  const twinkles = geo.getAttribute("twinkle") as THREE.BufferAttribute;
  const color = new THREE.Color();

  for (let i = 0; i < count; i += 1) {
    // Uniform direction on a sphere, pushed far enough to read as a backdrop.
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const radius = 42 + Math.random() * 18;
    positions.setXYZ(i, r * Math.cos(theta) * radius, u * radius, r * Math.sin(theta) * radius);

    // Most stars are dim; a few bright ones carry the colour of their temperature.
    const magnitude = Math.random() ** 3.2;
    sizes.setX(i, 0.55 + magnitude * 3.1);
    twinkles.setX(i, 0.4 + Math.random() * 1.6);
    color.setHSL(0.55 + (Math.random() - 0.5) * 0.14, 0.32 * magnitude, 0.72 + 0.2 * magnitude);
    colors.setXYZ(i, color.r, color.g, color.b);
  }

  for (const attribute of [positions, colors, sizes, twinkles]) attribute.needsUpdate = true;
}

function Starfield() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const geometry = useMemo(() => allocateStarGeometry(), []);

  useEffect(() => {
    seedStars(geometry);
    return () => geometry.dispose();
  }, [geometry]);

  useFrame(({ clock }) => {
    if (materialRef.current) materialRef.current.uniforms.time.value = clock.elapsedTime;
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={starVertexShader}
        fragmentShader={starFragmentShader}
        uniforms={{ time: { value: 0 } }}
        transparent
        depthWrite={false}
        vertexColors
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function Reticle({
  target,
  opacity,
}: {
  target: GlobeTarget;
  opacity: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef<THREE.Mesh>(null);

  const orientation = useMemo(() => {
    if (!target) return null;
    const point = lonLatToVector3(target.lon, target.lat, 1);
    const position = new THREE.Vector3(point.x, point.y, point.z);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      position.clone().normalize(),
    );
    return { position: position.multiplyScalar(1.004), quaternion };
  }, [target]);

  useFrame(({ clock }) => {
    if (!pulseRef.current || !innerRef.current) return;
    const phase = (clock.elapsedTime % 2.4) / 2.4;
    const scale = 0.4 + phase * 2.6;
    pulseRef.current.scale.setScalar(scale);
    (pulseRef.current.material as THREE.MeshBasicMaterial).opacity =
      (1 - phase) ** 2 * 0.85 * opacity;
    (innerRef.current.material as THREE.MeshBasicMaterial).opacity = opacity;
  });

  if (!orientation) return null;

  return (
    <group
      ref={groupRef}
      position={orientation.position}
      quaternion={orientation.quaternion}
    >
      <mesh ref={innerRef}>
        <ringGeometry args={[0.012, 0.017, 48]} />
        <meshBasicMaterial
          color="#5fd8ff"
          transparent
          opacity={opacity}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh ref={pulseRef}>
        <ringGeometry args={[0.014, 0.018, 48]} />
        <meshBasicMaterial
          color="#8ae9ff"
          transparent
          opacity={0}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

type SceneProps = {
  target: GlobeTarget;
  flying: boolean;
  interactive: boolean;
  onArrive: () => void;
  onProgress: (value: number) => void;
};

function Scene({
  target,
  flying,
  interactive,
  onArrive,
  onProgress,
}: SceneProps) {
  const { camera, gl } = useThree();
  const earthRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const atmosphereRef = useRef<THREE.ShaderMaterial>(null);
  const { textures } = useEarthTextures();

  const orbit = useRef({
    azimuth: -1.35,
    polar: 1.15,
    distance: IDLE_DISTANCE,
  });
  const progressStep = useRef(-1);
  // Set when the user leaves a site, so the camera eases back to orbit instead of
  // snapping out from the surface.
  const pullBack = useRef(false);
  const drag = useRef<{ active: boolean; x: number; y: number }>({
    active: false,
    x: 0,
    y: 0,
  });
  const flight = useRef<{
    start: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
    axis: THREE.Vector3;
    angle: number;
    fromDistance: number;
  } | null>(null);

  // Sunlight sits just off the opening camera direction, so most of the visible disk is
  // lit and the terminator falls near the right-hand limb.
  const sunDirection = useMemo(
    () => new THREE.Vector3(0.52, 0.36, -0.77).normalize(),
    [],
  );

  const uniforms = useMemo(
    () => ({
      dayMap: { value: null as THREE.Texture | null },
      nightMap: { value: null as THREE.Texture | null },
      sunDirection: { value: sunDirection },
      nightIntensity: { value: 0.92 },
      texelWidth: { value: 1 / 4096 },
    }),
    [sunDirection],
  );

  const atmosphereUniforms = useMemo(
    () => ({
      sunDirection: { value: sunDirection },
      glowColor: { value: new THREE.Color("#5f93d8") },
      strength: { value: 0.72 },
    }),
    [sunDirection],
  );

  useEffect(() => {
    if (!textures || !materialRef.current) return;
    materialRef.current.uniforms.dayMap.value = textures.day;
    materialRef.current.uniforms.nightMap.value = textures.night;
    materialRef.current.needsUpdate = true;
  }, [textures]);

  // Pointer orbiting, matched to the Google Earth feel: drag to spin, wheel to close in.
  useEffect(() => {
    const element = gl.domElement;

    const down = (event: PointerEvent) => {
      if (!interactive) return;
      pullBack.current = false;
      drag.current = { active: true, x: event.clientX, y: event.clientY };
      element.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!drag.current.active || !interactive) return;
      const dx = event.clientX - drag.current.x;
      const dy = event.clientY - drag.current.y;
      drag.current.x = event.clientX;
      drag.current.y = event.clientY;
      const scale = 0.0042 * (orbit.current.distance / IDLE_DISTANCE);
      orbit.current.azimuth -= dx * scale;
      orbit.current.polar = THREE.MathUtils.clamp(
        orbit.current.polar - dy * scale,
        0.22,
        Math.PI - 0.22,
      );
    };
    const up = (event: PointerEvent) => {
      drag.current.active = false;
      if (element.hasPointerCapture(event.pointerId))
        element.releasePointerCapture(event.pointerId);
    };
    const wheel = (event: WheelEvent) => {
      if (!interactive) return;
      event.preventDefault();
      pullBack.current = false;
      orbit.current.distance = THREE.MathUtils.clamp(
        orbit.current.distance * (1 + event.deltaY * 0.0011),
        1.35,
        7.0,
      );
    };

    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      element.removeEventListener("wheel", wheel);
    };
  }, [gl, interactive]);

  const targetLat = target?.lat ?? null;
  const targetLon = target?.lon ?? null;

  useEffect(() => {
    if (targetLat === null && targetLon === null) pullBack.current = true;
  }, [targetLat, targetLon]);

  useEffect(() => {
    if (!flying || targetLat === null || targetLon === null) {
      flight.current = null;
      return;
    }
    pullBack.current = false;
    const point = lonLatToVector3(targetLon, targetLat, 1);
    const from = camera.position.clone().normalize();
    const to = new THREE.Vector3(point.x, point.y, point.z).normalize();
    const axis = new THREE.Vector3().crossVectors(from, to);

    flight.current = {
      start: performance.now(),
      from,
      to,
      axis: axis.lengthSq() < 1e-8 ? new THREE.Vector3(0, 1, 0) : axis.normalize(),
      angle: from.angleTo(to),
      fromDistance: orbit.current.distance,
    };
  }, [flying, targetLat, targetLon, camera]);

  useFrame((_, delta) => {
    const active = flight.current;

    if (active) {
      const elapsed = performance.now() - active.start;
      const t = Math.min(1, elapsed / FLIGHT_MS);

      // Report progress in steps so the descent readout does not re-render every frame.
      const step = Math.round(t * 40);
      if (step !== progressStep.current) {
        progressStep.current = step;
        onProgress(t);
      }

      // Swing around the globe at a constant angular rate, then descend. Rotating about
      // the great-circle axis keeps the horizon steady instead of letting a straight
      // interpolation cut through the sphere.
      const swing = easeInOutCubic(Math.min(1, t / 0.78));
      const direction =
        active.angle > 1e-4
          ? active.from.clone().applyAxisAngle(active.axis, active.angle * swing)
          : active.to.clone();

      const lift = Math.sin(Math.PI * t) * 0.16;
      const descent = easeOutQuint(Math.max(0, (t - 0.2) / 0.8));
      const distance =
        THREE.MathUtils.lerp(active.fromDistance, ARRIVAL_DISTANCE, descent) + lift;

      camera.position.copy(direction.multiplyScalar(distance));
      camera.lookAt(0, 0, 0);
      orbit.current.distance = distance;

      if (t >= 1) {
        flight.current = null;
        onArrive();
      }
      return;
    }

    if (interactive && !drag.current.active)
      orbit.current.azimuth += delta * 0.018;

    const { azimuth, polar, distance } = orbit.current;
    camera.position.set(
      distance * Math.sin(polar) * Math.cos(azimuth),
      distance * Math.cos(polar),
      distance * Math.sin(polar) * Math.sin(azimuth),
    );
    camera.lookAt(0, 0, 0);

    if (atmosphereRef.current) {
      atmosphereRef.current.uniforms.strength.value = THREE.MathUtils.lerp(
        0.5,
        0.85,
        THREE.MathUtils.clamp((distance - 1.2) / 3, 0, 1),
      );
    }
  });

  return (
    <>
      <Starfield />
      <mesh ref={earthRef}>
        <sphereGeometry args={[1, 96, 96]} />
        <shaderMaterial
          ref={materialRef}
          vertexShader={earthVertexShader}
          fragmentShader={earthFragmentShader}
          uniforms={uniforms}
        />
      </mesh>
      <mesh scale={1.016}>
        <sphereGeometry args={[1, 64, 64]} />
        <shaderMaterial
          ref={atmosphereRef}
          vertexShader={atmosphereVertexShader}
          fragmentShader={atmosphereFragmentShader}
          uniforms={atmosphereUniforms}
          transparent
          side={THREE.BackSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <Reticle target={target} opacity={target ? 1 : 0} />
    </>
  );
}

export type GlobeProps = {
  target: GlobeTarget;
  flying: boolean;
  interactive?: boolean;
  onArrive: () => void;
  onProgress?: (value: number) => void;
};

export default function Globe({
  target,
  flying,
  interactive = true,
  onArrive,
  onProgress,
}: GlobeProps) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{
        fov: 32,
        position: [0, 0, IDLE_DISTANCE],
        near: 0.01,
        far: 200,
      }}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.08,
      }}
      style={{ touchAction: "none", cursor: interactive ? "grab" : "default" }}
    >
      <Scene
        target={target}
        flying={flying}
        interactive={interactive && !flying}
        onArrive={onArrive}
        onProgress={onProgress ?? (() => {})}
      />
    </Canvas>
  );
}
