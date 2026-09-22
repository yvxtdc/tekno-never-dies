import * as THREE from 'three';

export function initChain() {
  const container = document.querySelector('.chain');
  if (!container) return;

  // Configuration de la chaîne (adaptée pour traverser l'écran en diagonale)
  const config = {
    count: 15,       // Nombre de maillons pour couvrir la diagonale
    spacing: 0.75,   // Espacement parfait pour l'emboîtement
    gravity: 0.03,   // Gravité légère
    wobble: 0.015,   // Mouvement organique subtil
    radius: 0.22,
    tube: 0.075,
    stretch: 0.35    // Allongement du maillon
  };

  // Points d'ancrage (Haut-Gauche vers Bas-Droite)
  const anchorStart = new THREE.Vector3(11.5, 2, 0);
  const anchorEnd = new THREE.Vector3(5, -6.5, 1);

  // Variables principales
  let scene, camera, renderer, instancedMesh, material;
  let nodes = [];
  let time = 0;
  
  // Interaction souris
  const raycaster = new THREE.Raycaster();
  const mouseWorld = new THREE.Vector3(999, 999, 999);
  const interactionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  // 1. Génération de l'environnement Chrome (Reflets)
  function createStudioEnvMap(renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();

    const envScene = new THREE.Scene();
    
    const light1 = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({color: 0xffffff}));
    light1.position.set(10, 10, 10);
    light1.lookAt(0,0,0);
    envScene.add(light1);

    const light2 = new THREE.Mesh(new THREE.PlaneGeometry(10, 30), new THREE.MeshBasicMaterial({color: 0x88bbff}));
    light2.position.set(-15, 0, 5);
    light2.lookAt(0,0,0);
    envScene.add(light2);

    const light3 = new THREE.Mesh(new THREE.PlaneGeometry(20, 5), new THREE.MeshBasicMaterial({color: 0x472AD2})); // Couleur de ta marque pour les reflets
    light3.position.set(0, -10, -5);
    light3.lookAt(0,0,0);
    envScene.add(light3);

    const tex = pmrem.fromScene(envScene).texture;
    pmrem.dispose();
    return tex;
  }

  // 2. Géométrie du maillon allongé
  function createElongatedLinkGeometry() {
    const geo = new THREE.TorusGeometry(config.radius, config.tube, 32, 64);
    const pos = geo.attributes.position;
    
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      const sign = x >= 0 ? 1 : -1;
      pos.setX(i, x + sign * config.stretch);
    }
    
    geo.computeVertexNormals();
    geo.rotateY(Math.PI / 2); // Aligne la longueur sur l'axe Z local
    return geo;
  }

  // 3. Initialisation de la physique (Noeuds et contraintes)
  function initPhysics() {
    nodes = [];
    const delta = new THREE.Vector3().subVectors(anchorEnd, anchorStart);
    
    for (let i = 0; i < config.count; i++) {
      const alpha = i / (config.count - 1 || 1);
      const pos = anchorStart.clone().add(delta.clone().multiplyScalar(alpha));
      
      // Ajout du mou initial (catenary curve)
      pos.y -= Math.sin(alpha * Math.PI) * 1.5;

      nodes.push({
        pos: pos,
        oldPos: pos.clone(),
        isPinned: (i === 0 || i === config.count - 1) // On fixe le premier et le dernier
      });
    }
  }

  // 4. Initialisation de la scène
  function initScene() {
    // Nettoyage au cas où
    container.innerHTML = '';

    scene = new THREE.Scene();
    // Pas de background pour garder la transparence (CSS visible derrière)

    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 15);

    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const envMap = createStudioEnvMap(renderer);
    scene.environment = envMap;

    material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 1.0,
      roughness: 0.08,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      envMapIntensity: 2.5
    });

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    initPhysics();

    const geometry = createElongatedLinkGeometry();
    instancedMesh = new THREE.InstancedMesh(geometry, material, config.count);
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(instancedMesh);
  }

  // 5. Moteur Physique (Verlet Integration)
  function stepPhysics() {
    const dt = 0.016; 
    time += dt;

    // A. Appliquer les forces et vitesses
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.isPinned) continue;

      const velocity = new THREE.Vector3().subVectors(node.pos, node.oldPos);
      velocity.multiplyScalar(0.98); // Friction/Amortissement

      const force = new THREE.Vector3(0, -config.gravity, 0);

      // Mouvement organique (Vent/Wobble)
      if (config.wobble > 0) {
        force.x += Math.sin(time * 2.0 + i * 0.2) * config.wobble;
        force.z += Math.cos(time * 1.5 + i * 0.3) * config.wobble;
      }

      // Répulsion de la souris
      const distToMouse = node.pos.distanceTo(mouseWorld);
      if (distToMouse < 4.0) {
        const repelDir = new THREE.Vector3().subVectors(node.pos, mouseWorld).normalize();
        repelDir.z += 0.3; 
        const repelForce = (1.0 - distToMouse / 4.0) * 0.08;
        force.add(repelDir.multiplyScalar(repelForce));
      }

      node.oldPos.copy(node.pos);
      node.pos.add(velocity).add(force);
    }

    // B. Résoudre les contraintes de distance (pour ne pas que la chaîne s'étire)
    const iterations = 20; 
    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < nodes.length - 1; i++) {
        const n1 = nodes[i];
        const n2 = nodes[i + 1];

        const delta = new THREE.Vector3().subVectors(n2.pos, n1.pos);
        const dist = delta.length();
        
        if (dist === 0) continue;

        const difference = (dist - config.spacing) / dist;
        const offset = delta.multiplyScalar(difference * 0.5);

        if (!n1.isPinned) n1.pos.add(offset);
        if (!n2.isPinned) n2.pos.sub(offset);
      }

      // Maintenir strictement les points d'ancrage
      nodes[0].pos.copy(anchorStart);
      nodes[nodes.length - 1].pos.copy(anchorEnd);
    }
  }

  // 6. Mise à jour du rendu des maillons
  function updateMeshes() {
    const dummy = new THREE.Object3D();
    
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      dummy.position.copy(node.pos);

      // Calcul de la tangente pour orienter le maillon
      const tangent = new THREE.Vector3();
      if (i === 0) {
        tangent.subVectors(nodes[1].pos, nodes[0].pos);
      } else if (i === nodes.length - 1) {
        tangent.subVectors(nodes[i].pos, nodes[i-1].pos);
      } else {
        tangent.subVectors(nodes[i+1].pos, nodes[i-1].pos);
      }
      tangent.normalize();

      const targetPoint = node.pos.clone().add(tangent);
      dummy.lookAt(targetPoint);

      // Rotation alternée pour l'emboîtement
      if (i % 2 === 1) {
        dummy.rotateZ(Math.PI / 2);
      }

      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);
    }
    
    instancedMesh.instanceMatrix.needsUpdate = true;
  }

  // 7. Écouteurs d'événements
  window.addEventListener('resize', () => {
    if (!container.clientWidth || !container.clientHeight) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  window.addEventListener('mousemove', (e) => {
    // Calcul pour convertir la position de la souris relative au container
    const rect = container.getBoundingClientRect();
    const mouse2D = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(mouse2D, camera);
    raycaster.ray.intersectPlane(interactionPlane, mouseWorld);
  });

  // 8. Boucle d'animation
  function animate() {
    requestAnimationFrame(animate);
    stepPhysics();
    updateMeshes();
    renderer.render(scene, camera);
  }

  // Démarrage
  initScene();
  animate();
}