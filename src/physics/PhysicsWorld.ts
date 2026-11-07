import RAPIER from "@dimforge/rapier3d-compat";
import type { BufferGeometry, Vector3 } from "three";

export class PhysicsWorld {
  readonly world: RAPIER.World;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -18, z: 0 });
  }

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld();
  }

  createMapCollider(geometry: BufferGeometry): RAPIER.Collider {
    const posAttr = geometry.attributes.position;
    const vertices =
      posAttr.array instanceof Float32Array
        ? posAttr.array
        : new Float32Array(posAttr.array);

    let indices: Uint32Array;
    if (geometry.index) {
      indices =
        geometry.index.array instanceof Uint32Array
          ? geometry.index.array
          : new Uint32Array(geometry.index.array);
    } else {
      indices = new Uint32Array(posAttr.count);
      for (let i = 0; i < indices.length; i++) indices[i] = i;
    }

    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices);
    return this.world.createCollider(desc);
  }

  createCharacterController(offset = 0.02): RAPIER.KinematicCharacterController {
    const controller = this.world.createCharacterController(offset);
    controller.setSlideEnabled(true);
    controller.enableAutostep(0.35, 0.08, true);
    controller.enableSnapToGround(0.35);
    controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((50 * Math.PI) / 180);
    return controller;
  }

  createCharacter(
    spawnPos: Vector3,
    halfHeight = 0.38,
    radius = 0.22,
  ): {
    body: RAPIER.RigidBody;
    collider: RAPIER.Collider;
    controller: RAPIER.KinematicCharacterController;
  } {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      spawnPos.x,
      spawnPos.y,
      spawnPos.z,
    );
    const body = this.world.createRigidBody(bodyDesc);

    const colliderCenterY = halfHeight + radius;
    const colliderDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius).setTranslation(
      0,
      colliderCenterY,
      0,
    );
    const collider = this.world.createCollider(colliderDesc, body);
    const controller = this.createCharacterController(0.02);

    return { body, collider, controller };
  }

  step(_dt?: number) {
    this.world.step();
  }
}
