import RAPIER from '@dimforge/rapier3d-compat';

export class Physics {
  public world!: RAPIER.World;

  public initialize() {
    this.resetWorld(150);
  }

  public resetWorld(spread: number) {
    if (this.world) this.world.free();
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    this.world = new RAPIER.World(gravity);

    // Ground
    const groundBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(spread * 2, 0.1, spread * 2), groundBody);

    // Dynamic Walls based on spread
    const wallH = 40;
    const s = spread + 20; 
    const wallPos = [
      { x: 0, y: wallH/2, z: -s, hx: s, hy: wallH, hz: 1 },
      { x: 0, y: wallH/2, z: s, hx: s, hy: wallH, hz: 1 },
      { x: -s, y: wallH/2, z: 0, hx: 1, hy: wallH, hz: s },
      { x: s, y: wallH/2, z: 0, hx: 1, hy: wallH, hz: s },
    ];
    wallPos.forEach(w => {
      const wb = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(w.x, w.y, w.z));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(w.hx, w.hy, w.hz), wb);
    });
  }

  public update(_dt: number) {
    if (this.world) this.world.step();
  }
}
