import { useEffect, useRef } from "react";
import * as THREE from "three";

// Original 3D backdrop, written for this dashboard (not taken from any other site).
// A wireframe portal ring with a cyan and magenta rim, a faceted core, and a drifting
// particle field. Fewer particles on small screens; off for reduced motion. The UI stays monochrome.

const PARTICLES = 1400;
const COLOURS = [0x3ee0ff, 0x7dff9b, 0xffd166];

export function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      canvas.style.display = "none";
      return;
    }

    // Phones get half the particles to keep the GPU load light.
    const count = window.innerWidth < 900 ? Math.round(PARTICLES / 2) : PARTICLES;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 1);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 9);

    // Portal: two rims and a faceted core.
    const portal = new THREE.Group();
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(2.6, 0.02, 8, 180),
      new THREE.MeshBasicMaterial({ color: 0x3ee0ff, transparent: true, opacity: 0.9 }),
    );
    const rimMagenta = new THREE.Mesh(
      new THREE.TorusGeometry(2.8, 0.014, 8, 180),
      new THREE.MeshBasicMaterial({ color: 0xff3ec8, transparent: true, opacity: 0.7 }),
    );
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.9, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.55 }),
    );
    portal.add(rim, rimMagenta, core);
    scene.add(portal);

    // Particles: spawn in a ring around the portal and drift downward.
    const positions = new Float32Array(count * 3);
    const colours = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const palette = COLOURS.map((c) => new THREE.Color(c));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 2.4 + Math.random() * 3.2;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 12;
      positions[i * 3 + 2] = Math.sin(angle) * radius * 0.4;
      const c = palette[Math.floor(Math.random() * palette.length)];
      colours[i * 3] = c.r;
      colours[i * 3 + 1] = c.g;
      colours[i * 3 + 2] = c.b;
      speeds[i] = 0.15 + Math.random() * 0.35;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: 0.03, vertexColors: true, transparent: true, opacity: 0.8 }),
    );
    scene.add(points);

    // Pointer parallax: the camera drifts a little toward the pointer.
    let mx = 0;
    let my = 0;
    const onMove = (e: PointerEvent) => {
      mx = (e.clientX / window.innerWidth - 0.5) * 2;
      my = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("pointermove", onMove);

    // Scroll: 0 at the top of the page, 1 at the bottom. Drives the camera and motion speed.
    let progress = 0;
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    // Portrait screens: pull the camera back so the portal ring fits the width.
    let baseZ = 9;
    const resize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      camera.aspect = window.innerWidth / window.innerHeight;
      baseZ = Math.max(9, 3.1 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
      camera.updateProjectionMatrix();
    };
    resize();
    camera.position.z = baseZ;
    window.addEventListener("resize", resize);

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      portal.rotation.z += dt * (0.08 + progress * 0.25);
      core.rotation.x += dt * 0.2;
      core.rotation.y += dt * 0.3;
      rim.rotation.x = Math.sin(now / 2400) * 0.12;
      rimMagenta.rotation.y = Math.cos(now / 2900) * 0.1;

      const pos = geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < count; i++) {
        let y = pos.getY(i) - speeds[i] * dt * (1 + progress * 2);
        if (y < -6) y += 12;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;

      // Scrolling moves the camera in toward the portal.
      const targetZ = baseZ - progress * 3;
      camera.position.z += (targetZ - camera.position.z) * 0.05;
      camera.position.x += (mx * 0.5 - camera.position.x) * 0.04;
      camera.position.y += (-my * 0.4 - camera.position.y) * 0.04;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };

    // Stop drawing while the tab is hidden.
    const onVisibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", resize);
      geometry.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={ref} className="backdrop" aria-hidden="true" />;
}
