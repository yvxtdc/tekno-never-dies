import * as THREE from "three";

/**
 * Environnement "studio" : c'est lui qui fait le rendu chrome.
 * Un dôme clair / sol noir avec un horizon net + des softboxes blanches
 * et des drapeaux noirs => grandes zones blanches et noirs profonds réfléchis.
 * Pour changer l'allure du chrome, modifie les intensités des `panel(...)`.
 */
export function buildEnvironment(renderer){
  const env = new THREE.Scene();

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 64, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: `varying vec3 vD;
        void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vD;
        void main(){
          float y = vD.y;
          vec3 sky = mix(vec3(.55,.57,.62), vec3(1.0,1.02,1.06), smoothstep(0.0,.9,y));
          vec3 flr = mix(vec3(.008,.008,.014), vec3(.16,.155,.15), smoothstep(-.75,0.0,y));
          gl_FragColor = vec4(mix(flr, sky, smoothstep(-.025,.025,y)), 1.0);
        }`
    })
  );
  env.add(dome);

  const panel = (w, h, rgb, intensity, x, y, z) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(rgb[0], rgb[1], rgb[2]).multiplyScalar(intensity),
        side: THREE.DoubleSide, toneMapped: false
      })
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  const W = [1,1,1], COOL = [.72,.86,1], BLACK = [0,0,0];

  panel(16, 16, W,    5.0,   0, 15,  2);     // grande softbox au zénith
  panel(11,  7, W,    8.0, -11,  6, 10);     // softbox principale avant-gauche
  panel(2.2,16, COOL, 10.0, 13,  2,  4);     // barre froide à droite
  panel(1.6,14, W,    9.0, -14,  0, -3);     // barre blanche à gauche
  panel(18,  3, W,    5.0,   0,  3,-14);     // rim arrière
  panel( 5,  9, BLACK, 1,   8,  5, 11);      // drapeaux noirs -> bandes noires
  panel( 3, 13, BLACK, 1,  -6,  3,-12);
  panel(10,  3, BLACK, 1,   0,  9,  9);
  panel(24, 24, [.93,.90,.86], .55, 0, -11, 0); // rebond du sol (beige de la charte)

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.012, 0.1, 100);
  pmrem.dispose();
  return rt.texture;
}
