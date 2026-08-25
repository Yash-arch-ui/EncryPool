"use client";

import { useMemo, useRef } from "react";
import { Float, MeshTransmissionMaterial, Sparkles } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useReducedMotion } from "motion/react";
import type { Group, Mesh } from "three";
import * as THREE from "three";

export type OrbVariant = "hero" | "compact" | "vault" | "prize";

type CoreProps = {
  active: boolean;
  variant: OrbVariant;
  reducedMotion: boolean;
};

const palette = {
  coral: "#ff6b4a",
  teal: "#2ec4b6",
  gold: "#ffc145",
  ink: "#07090f",
};

function EncryptedCore({ active, variant, reducedMotion }: CoreProps) {
  const group = useRef<Group>(null);
  const core = useRef<Mesh>(null);
  const rings = useRef<Group>(null);
  const { pointer } = useThree();
  const speeds = variant === "prize" ? 1.25 : variant === "vault" ? 0.75 : 1;
  const nodes = useMemo(
    () =>
      Array.from({ length: variant === "compact" ? 5 : 9 }, (_, index) => {
        const angle = (index / (variant === "compact" ? 5 : 9)) * Math.PI * 2;
        const radius = 2.05 + (index % 3) * 0.12;
        return [Math.cos(angle) * radius, Math.sin(angle * 1.7) * 0.5, Math.sin(angle) * radius] as const;
      }),
    [variant],
  );

  useFrame((state, delta) => {
    if (!group.current || !core.current || !rings.current || reducedMotion) return;
    const t = state.clock.elapsedTime;
    group.current.rotation.y += delta * 0.12 * speeds;
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, pointer.y * 0.16, 0.035);
    group.current.rotation.z = THREE.MathUtils.lerp(group.current.rotation.z, -pointer.x * 0.1, 0.035);
    rings.current.rotation.y += delta * 0.22 * speeds;
    rings.current.rotation.z -= delta * 0.08;
    const pulse = 1 + Math.sin(t * (active ? 2.6 : 1.4)) * (active ? 0.045 : 0.018);
    core.current.scale.setScalar(pulse);
  });

  const energy = active ? palette.gold : palette.coral;

  return (
    <Float
      speed={reducedMotion ? 0 : 1.35}
      rotationIntensity={reducedMotion ? 0 : 0.12}
      floatIntensity={reducedMotion ? 0 : 0.25}
    >
      <group ref={group}>
        <mesh ref={core}>
          <icosahedronGeometry args={[1.08, 5]} />
          <MeshTransmissionMaterial
            color={energy}
            thickness={1.5}
            roughness={0.16}
            transmission={0.58}
            chromaticAberration={0.08}
            anisotropy={0.15}
            distortion={0.22}
            distortionScale={0.35}
            temporalDistortion={reducedMotion ? 0 : 0.12}
            clearcoat={1}
          />
        </mesh>
        <mesh scale={0.72}>
          <dodecahedronGeometry args={[1, 2]} />
          <meshStandardMaterial
            color={palette.ink}
            emissive={energy}
            emissiveIntensity={active ? 2.4 : 1.4}
            metalness={0.7}
            roughness={0.18}
            wireframe
          />
        </mesh>
        <mesh scale={0.42}>
          <octahedronGeometry args={[1, 3]} />
          <meshStandardMaterial color={energy} emissive={energy} emissiveIntensity={active ? 5 : 3} roughness={0.25} />
        </mesh>

        <group ref={rings}>
          <mesh rotation={[1.12, 0.18, 0.35]}>
            <torusGeometry args={[1.55, 0.028, 12, 160]} />
            <meshStandardMaterial
              color={palette.teal}
              emissive={palette.teal}
              emissiveIntensity={4}
              toneMapped={false}
            />
          </mesh>
          <mesh rotation={[-0.42, 0.78, 1.1]}>
            <torusGeometry args={[1.82, 0.018, 12, 160]} />
            <meshStandardMaterial color={energy} emissive={energy} emissiveIntensity={3.5} toneMapped={false} />
          </mesh>
          <mesh rotation={[0.25, -0.8, 0.48]}>
            <torusKnotGeometry args={[1.28, 0.018, 180, 8, 2, 3]} />
            <meshStandardMaterial
              color={palette.coral}
              emissive={palette.coral}
              emissiveIntensity={2.4}
              transparent
              opacity={0.62}
              toneMapped={false}
            />
          </mesh>
        </group>

        {nodes.map((position, index) => (
          <mesh key={index} position={position} scale={index % 3 === 0 ? 0.09 : 0.055}>
            <sphereGeometry args={[1, 18, 18]} />
            <meshStandardMaterial
              color={index % 2 ? palette.teal : energy}
              emissive={index % 2 ? palette.teal : energy}
              emissiveIntensity={5}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
      <Sparkles
        count={variant === "compact" ? 18 : 42}
        scale={5.5}
        size={1.6}
        speed={reducedMotion ? 0 : 0.25}
        color={palette.teal}
        opacity={0.7}
      />
    </Float>
  );
}

export function FheOrb({
  decrypted = false,
  compact = false,
  variant,
  className = "",
}: {
  decrypted?: boolean;
  compact?: boolean;
  variant?: OrbVariant;
  className?: string;
}) {
  const reducedMotion = Boolean(useReducedMotion());
  const resolvedVariant = variant ?? (compact ? "compact" : "hero");
  const height = compact ? "h-44 sm:h-52" : "h-[420px] lg:h-[620px]";

  return (
    <div
      className={`relative w-full overflow-hidden ${height} ${className}`}
      aria-label={`${decrypted ? "Decrypted" : "Encrypted"} privacy core visualization`}
      role="img"
    >
      <div className="absolute inset-x-[20%] bottom-[12%] h-px bg-gradient-to-r from-transparent via-secondary/70 to-transparent shadow-[0_0_36px_var(--secondary)]" />
      <Canvas
        camera={{ position: [0, 0, compact ? 6.8 : 5.5], fov: compact ? 48 : 44 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      >
        <ambientLight intensity={0.7} />
        <pointLight position={[4, 4, 5]} color={decrypted ? palette.gold : palette.coral} intensity={35} />
        <pointLight position={[-4, -2, 3]} color={palette.teal} intensity={28} />
        <EncryptedCore active={decrypted} variant={resolvedVariant} reducedMotion={reducedMotion} />
      </Canvas>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_35%,var(--background)_82%)] opacity-55" />
    </div>
  );
}
