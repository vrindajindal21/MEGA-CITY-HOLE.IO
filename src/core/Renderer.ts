import * as THREE from 'three';

export class Renderer {
  public scene:    THREE.Scene;
  public camera:   THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;

  constructor() {
    // ── Scene ──
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#dde8ff');
    this.scene.fog = new THREE.Fog('#dde8ff', 150, 350);

    // ── Camera ── Hole.io top-down style
    this.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 1500);
    this.camera.position.set(0, 38, 30);
    this.camera.lookAt(0, 0, 0);

    // ── Renderer ──
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    // Append canvas to container
    const container = document.getElementById('canvas-container');
    (container ?? document.body).appendChild(this.renderer.domElement);

    window.addEventListener('resize', () => this.onResize());
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  public render() {
    this.renderer.render(this.scene, this.camera);
  }
}
