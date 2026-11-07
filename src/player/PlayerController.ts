import { Object3D, Vector3 } from "three";
import type { Character } from "../characters/Character";
import type { Input } from "../core/Input";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type RAPIER from "@dimforge/rapier3d-compat";

/** Tuning, in metres/second. Character is 1.20 m tall. */
export const MOVE = {
  walkSpeed: 4.5,
  runSpeed: 9.0,
  backSpeed: 2.2,
  accel: 42,
  decel: 36,
  reverseAccel: 65,
  airAccel: 20,
  airDecel: 8,
  gravity: -18,
  jumpSpeed: 7.2,
  doubleJumpSpeed: 6.8,
  turnRate: 14,
  radius: 0.22,
  height: 1.2,
} as const;

const _up = new Vector3(0, 1, 0);

export class PlayerController {
  readonly object = new Object3D();
  readonly velocity = new Vector3();
  readonly prevPosition = new Vector3();
  readonly currentPosition = new Vector3();
  grounded = false;

  private facing = 0;
  private jumpsUsed = 0;
  private jumpAnimationActive = false;
  private verticalVelocity = 0;
  private coyoteTimer = 0;

  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;

  constructor(
    private character: Character,
    private physics: PhysicsWorld,
  ) {
    this.object.add(character.root);

    const halfHeight = (MOVE.height - 2 * MOVE.radius) / 2; // 0.38m
    const { body, collider, controller } = this.physics.createCharacter(
      new Vector3(0, 0, 0),
      halfHeight,
      MOVE.radius,
    );
    this.body = body;
    this.collider = collider;
    this.controller = controller;
  }

  spawn(position: Vector3, facing = 0) {
    this.prevPosition.copy(position);
    this.currentPosition.copy(position);
    this.object.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.facing = facing;
    this.jumpsUsed = 0;
    this.jumpAnimationActive = false;
    this.grounded = false;
    this.coyoteTimer = 0;
    this.object.rotation.y = facing;

    this.body.setTranslation(
      { x: position.x, y: position.y, z: position.z },
      true,
    );
    this.controller.enableSnapToGround(0.35);
  }

  update(dt: number, input: Input, cameraYaw: number) {
    this.prevPosition.copy(this.currentPosition);

    const move = input.update();
    const wantsMove = move.lengthSq() > 1e-4;

    // FollowCamera orbits at target + offset; facing is negative horizontal orbit
    const forwardX = -Math.sin(cameraYaw);
    const forwardZ = -Math.cos(cameraYaw);
    const rightX = Math.cos(cameraYaw);
    const rightZ = -Math.sin(cameraYaw);
    const dirX = move.x * rightX + move.y * forwardX;
    const dirZ = move.x * rightZ + move.y * forwardZ;

    const backing = wantsMove && move.y < -0.3;
    const target = backing
      ? MOVE.backSpeed
      : input.sprint
        ? MOVE.runSpeed
        : MOVE.walkSpeed;

    const desiredX = wantsMove ? dirX * target : 0;
    const desiredZ = wantsMove ? dirZ * target : 0;

    // Use responsive air acceleration / deceleration when jumping
    const accelRate = this.grounded ? MOVE.accel : MOVE.airAccel;
    const decelRate = this.grounded ? MOVE.decel : MOVE.airDecel;
    const reverseRate = this.grounded ? MOVE.reverseAccel : MOVE.airAccel;

    const rateX =
      desiredX === 0
        ? decelRate
        : Math.sign(desiredX) !== Math.sign(this.velocity.x)
          ? reverseRate
          : accelRate;
    const rateZ =
      desiredZ === 0
        ? decelRate
        : Math.sign(desiredZ) !== Math.sign(this.velocity.z)
          ? reverseRate
          : accelRate;

    this.velocity.x += (desiredX - this.velocity.x) * (1 - Math.exp(-rateX * dt));
    this.velocity.z += (desiredZ - this.velocity.z) * (1 - Math.exp(-rateZ * dt));

    // Coyote timer allows jumps up to 120ms after stepping off a ledge
    if (this.grounded) {
      this.coyoteTimer = 0.12;
      this.jumpsUsed = 0;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }

    // Jump handling with 160ms input buffering
    const wantsJump = input.consumeJump();
    const canGroundJump = this.grounded || this.coyoteTimer > 0;
    const canAirJump = this.jumpsUsed < 2;

    if (wantsJump && (canGroundJump || canAirJump)) {
      const isFirst = canGroundJump;
      this.verticalVelocity = isFirst ? MOVE.jumpSpeed : MOVE.doubleJumpSpeed;
      this.jumpsUsed = isFirst ? 1 : this.jumpsUsed + 1;
      this.grounded = false;
      this.coyoteTimer = 0;
      this.jumpAnimationActive = true;
      this.controller.disableSnapToGround();
      this.character.play("Jump", 0.04);
    }

    // Apply gravity
    this.verticalVelocity += MOVE.gravity * dt;
    this.verticalVelocity = Math.max(this.verticalVelocity, -28); // terminal velocity

    // Desired translation delta for this frame
    const desiredDelta = {
      x: this.velocity.x * dt,
      y: this.verticalVelocity * dt,
      z: this.velocity.z * dt,
    };

    // Rapier computes character movement with slope sliding and autostep
    this.controller.computeColliderMovement(this.collider, desiredDelta);
    const computedMovement = this.controller.computedMovement();

    // Update body position in Rapier
    const currentTranslation = this.body.translation();
    const newTranslation = {
      x: currentTranslation.x + computedMovement.x,
      y: currentTranslation.y + computedMovement.y,
      z: currentTranslation.z + computedMovement.z,
    };
    this.body.setTranslation(newTranslation, true);

    // Sync Three.js character object position
    this.currentPosition.set(
      newTranslation.x,
      newTranslation.y,
      newTranslation.z,
    );
    this.object.position.copy(this.currentPosition);

    // Ground & ceiling resolution
    if (this.verticalVelocity > 0) {
      // Moving upwards: cannot be grounded
      this.grounded = false;
      if (desiredDelta.y > 0.02 && computedMovement.y < 0.005) {
        // Hit ceiling
        this.verticalVelocity = 0;
      }
    } else {
      // Falling or flat: check ground contact
      const wasGroundedBefore = this.grounded;
      this.grounded = this.controller.computedGrounded();
      if (this.grounded) {
        this.verticalVelocity = 0;
        this.jumpAnimationActive = false;
        if (!wasGroundedBefore) {
          this.controller.enableSnapToGround(0.35);
        }
      }
    }
    this.velocity.y = this.verticalVelocity;

    // Face the direction of travel
    if (wantsMove) {
      const heading = backing
        ? Math.atan2(-dirX, -dirZ)
        : Math.atan2(dirX, dirZ);
      this.facing = dampAngle(this.facing, heading, MOVE.turnRate, dt);
      this.object.quaternion.setFromAxisAngle(_up, this.facing);
    }

    this.updateAnimation(wantsMove, backing, input.sprint);

    // Fell through the world guard
    if (this.object.position.y < -25) {
      this.spawn(new Vector3(0, 2, 20), this.facing);
    }
  }

  private updateAnimation(moving: boolean, backing: boolean, sprint: boolean) {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.jumpAnimationActive) {
      if (this.character.state !== "Jump") this.character.play("JumpUp", 0.08);
      return;
    }

    if (!moving) {
      this.character.play("Idle", 0.15);
      this.character.setLocomotionSpeed(1);
      return;
    }
    if (backing) {
      this.character.play("WalkBack", 0.15);
      this.character.setLocomotionSpeed(speed / MOVE.backSpeed);
      return;
    }
    if (sprint) {
      this.character.play("Run", 0.15);
      this.character.setLocomotionSpeed(Math.max(speed / MOVE.runSpeed, 0.1));
    } else {
      this.character.play("Walk", 0.15);
      this.character.setLocomotionSpeed(Math.max(speed / MOVE.walkSpeed, 0.1));
    }
  }

  /** Interpolate between previous and current physics ticks for buttery smooth rendering */
  interpolate(alpha: number) {
    this.object.position.lerpVectors(this.prevPosition, this.currentPosition, alpha);
  }
}

function dampAngle(current: number, target: number, rate: number, dt: number) {
  let diff = (target - current) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * (1 - Math.exp(-rate * dt));
}
