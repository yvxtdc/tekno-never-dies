import * as THREE from "three";
import { buildStarGeometry } from "./star-geometry.js";
import { buildEnvironment } from "./environment.js";

/**
 * Trajectoires simulées : chaque étoile suit la somme de plusieurs sinusoïdes
 * de fréquences incommensurables. Le mouvement paraît libre et aléatoire, reste
 * lisse, ne sort jamais de l'écran et ne se répète pas avant très longtemps.
 * Les phases de départ sont tirées au hasard à chaque chargement de la page.
 *
 * startStars(canvas, config) renvoie { renderer, scene, tick(dt) } ou null si
 * WebGL n'est pas disponible.
 */
export function startStars(canvas, cfg) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (e) {
    console.warn("WebGL indisponible, étoiles désactivées.", e);
    return null;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, cfg.pixelRatioMax));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = cfg.chrome.exposure;
  renderer.shadowMap.enabled = cfg.shadow.enabled;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  const scene = new THREE.Scene();
  scene.environment = buildEnvironment(renderer);

  const { fov, distance } = cfg.camera;
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
  camera.position.set(0, 0, distance);

  // --- lumières + ombre --------------------------------------------------
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(-3.5, 4.5, 7);
  if (cfg.shadow.enabled) {
    key.castShadow = true;
    key.shadow.mapSize.set(cfg.shadow.mapSize, cfg.shadow.mapSize);
    Object.assign(key.shadow.camera, { left: -12, right: 12, top: 9, bottom: -9, near: 1, far: 30 });
    key.shadow.radius = cfg.shadow.blur;
    key.shadow.blurSamples = 25;
    key.shadow.bias = -0.0004;

    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90),
      new THREE.ShadowMaterial({ color: cfg.shadow.color, opacity: cfg.shadow.opacity })
    );
    wall.position.z = cfg.shadow.wallZ;
    wall.receiveShadow = true;
    scene.add(wall);
  }
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd8ff, 1.6);
  fill.position.set(5, -2, 4);
  scene.add(fill);

  // --- étoiles -------------------------------------------------------------
  const TAU = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const sign = () => (Math.random() < 0.5 ? -1 : 1);
  const m = cfg.motion;

  const geometries = new Map();
  const geometryFor = (name) => {
    if (!geometries.has(name)) geometries.set(name, buildStarGeometry(cfg.shapes[name]));
    return geometries.get(name);
  };

  const stars = cfg.stars.map((spec) => {
    const material = new THREE.MeshPhysicalMaterial({
      color: spec.color,
      metalness: 1,
      roughness: cfg.chrome.roughness,
      envMapIntensity: cfg.chrome.envMapIntensity,
      clearcoat: cfg.chrome.clearcoat,
      clearcoatRoughness: 0.03
    });
    const mesh = new THREE.Mesh(geometryFor(spec.shape), material);
    mesh.castShadow = true;
    scene.add(mesh);
    return {
      spec, mesh,
      phase: Array.from({ length: 8 }, () => rnd(0, TAU)),
      wx: [rnd(...m.driftSlow), rnd(...m.driftFast)],
      wy: [rnd(...m.driftSlow), rnd(...m.driftFast)],
      wz: rnd(0.05, 0.09),
      spin: [sign() * rnd(...m.spin) * 0.6, sign() * rnd(...m.spin), sign() * rnd(...m.spin) * 0.5]
    };
  });

  // --- cadrage adaptatif ---------------------------------------------------
  let halfW = 5, halfH = 3.6, unit = 1;
  function layout() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    halfH = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * distance;
    halfW = halfH * camera.aspect;
    const portrait = camera.aspect < 0.8;
    unit = THREE.MathUtils.clamp(Math.min(halfH / 3.6, halfW / 4.4), portrait ? 0.42 : 0.55, 1.3);
    stars.forEach((s) => { s.mesh.visible = !(portrait && s.spec.hideOnPortrait); });
  }
  layout();
  addEventListener("resize", layout);

  // légère parallaxe au pointeur
  let px = 0, py = 0;
  addEventListener("pointermove", (e) => {
    px = (e.clientX / innerWidth) * 2 - 1;
    py = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });

  // --- boucle --------------------------------------------------------------
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  const speed = (reduce ? m.reducedMotionSpeed : m.speed);
  let t = rnd(0, 600);       // départ aléatoire dans la "partition"
  let real = 0;              // temps réel écoulé (pour l'intro et le kick)

  function tick(dt) {
    real += dt;
    t += dt * speed;

    const beat = ((real * cfg.kick.bpm) / 60) % 1;
    const kick = reduce ? 0 : cfg.kick.amount * Math.exp(-beat * 7);

    stars.forEach((s, i) => {
      const k = s.spec.speed;
      const ax = halfW * m.marginX, ay = halfH * m.marginY;
      const x = ax * (0.64 * Math.sin(s.wx[0] * k * t + s.phase[0]) + 0.36 * Math.sin(s.wx[1] * k * t + s.phase[1]));
      const y = ay * (0.64 * Math.sin(s.wy[0] * k * t + s.phase[2]) + 0.36 * Math.sin(s.wy[1] * k * t + s.phase[3]));
      const z = s.spec.z + 0.35 * Math.sin(s.wz * t + s.phase[4]);
      s.mesh.position.set(x, y, z);
      s.mesh.rotation.set(
        s.spin[0] * t * k + s.phase[5],
        s.spin[1] * t * k + s.phase[6],
        s.spin[2] * t * k + s.phase[7]
      );
      // entrée en scène échelonnée
      const intro = reduce ? 1 : easeOut(THREE.MathUtils.clamp((real - 0.4 - i * 0.35) / 1.8, 0, 1));
      s.mesh.scale.setScalar(s.spec.scale * unit * intro * (1 + kick));
    });

    camera.position.x += (px * m.parallax - camera.position.x) * 0.03;
    camera.position.y += (-py * m.parallax * 0.63 - camera.position.y) * 0.03;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }

 const clock = new THREE.Clock();

function startAnimation() {
  clock.start();
  renderer.setAnimationLoop(() => {
    tick(Math.min(clock.getDelta(), 0.05));
  });
}

function stopAnimation() {
  renderer.setAnimationLoop(null);
  clock.stop();
}

startAnimation();

return {
  renderer,
  scene,
  camera,
  stars,
  tick,
  startAnimation,
  stopAnimation
};

}
