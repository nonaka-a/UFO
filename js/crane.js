let craneUnitMesh; 
let clawLinks = [];
let clawVisuals = [];
let sequenceTimer = 0;

// 4. クレーンユニットの生成
function createCrane() {
    craneUnitMesh = new THREE.Group();
    craneUnitMesh.position.set(0, CRANE_HOME_Y, 0);
    scene.add(craneUnitMesh);

    const matChrome = new THREE.MeshStandardMaterial({ color: 0xdcdde1, roughness: 0.15, metalness: 0.85 });
    const matPink = new THREE.MeshStandardMaterial({ color: 0xff7495, roughness: 0.3, metalness: 0.2 });
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.4 });

    const cyl1Geo = new THREE.CylinderGeometry(0.5, 0.5, 0.5, 16);
    const cyl1 = new THREE.Mesh(cyl1Geo, matWhite);
    cyl1.position.y = 0.4;
    cyl1.castShadow = true;
    craneUnitMesh.add(cyl1);

    const cyl2Geo = new THREE.CylinderGeometry(0.45, 0.45, 0.7, 16);
    const cyl2 = new THREE.Mesh(cyl2Geo, matPink);
    cyl2.position.y = -0.2;
    cyl2.castShadow = true;
    craneUnitMesh.add(cyl2);

    const cyl3Geo = new THREE.CylinderGeometry(0.35, 0.4, 0.3, 16);
    const cyl3 = new THREE.Mesh(cyl3Geo, matChrome);
    cyl3.position.y = -0.6;
    cyl3.castShadow = true;
    craneUnitMesh.add(cyl3);

    clawLinks = [];
    clawVisuals = [];

    // アーム外側への滑らかな湾曲をローカル座標系で定義
    const clawShape = new THREE.Shape();
    clawShape.moveTo(0, 0); 
    clawShape.lineTo(0.06, -0.05);
    clawShape.quadraticCurveTo(0.35, -0.3, 0.25, -0.8);
    clawShape.quadraticCurveTo(0.15, -1.1, -0.15, -1.15);
    clawShape.lineTo(-0.15, -1.07);
    clawShape.quadraticCurveTo(0.08, -1.0, 0.15, -0.7);
    clawShape.quadraticCurveTo(0.22, -0.3, -0.02, 0);

    const extrudeSettings = {
        depth: 0.06,
        bevelEnabled: true,
        bevelSegments: 2,
        steps: 1,
        bevelSize: 0.005,
        bevelThickness: 0.005
    };

    const clawGeo = new THREE.ExtrudeGeometry(clawShape, extrudeSettings);
    clawGeo.translate(0, 0, -0.03); // 厚みの中心をZ軸に合わせる

    for (let i = 0; i < CLAW_COUNT; i++) {
        const clawGroup = new THREE.Group();
        const clawMesh = new THREE.Mesh(clawGeo, matChrome);
        clawMesh.castShadow = true;
        clawGroup.add(clawMesh);
        scene.add(clawGroup);
        clawVisuals.push(clawGroup);

        const clawBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: materials.physicsClaw });
        
        const shapeUpper = new CANNON.Box(new CANNON.Vec3(0.08, 0.3, 0.03));
        clawBody.addShape(shapeUpper, new CANNON.Vec3(0.1, -0.3, 0));

        const shapeLower = new CANNON.Box(new CANNON.Vec3(0.15, 0.04, 0.03));
        const qLower = new CANNON.Quaternion();
        qLower.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), 0.5);
        clawBody.addShape(shapeLower, new CANNON.Vec3(-0.02, -1.0, 0), qLower);

        const shapeTip = new CANNON.Sphere(0.11);
        clawBody.addShape(shapeTip, new CANNON.Vec3(-0.14, -1.13, 0));

        world.addBody(clawBody);
        clawLinks.push(clawBody);
    }

    updateClawPositions(1.0);
}

// 5. アームの位置・回転の完全同期と向き修正
function updateClawPositions(openRatio) {
    const center = craneUnitMesh.position;
    const angleStep = (Math.PI * 2) / CLAW_COUNT;
    const baseY = center.y - 0.7; 
    const r_base = 0.25;          
    const dt = 1 / 60;

    const ratios = Array.isArray(openRatio) ? openRatio : Array(CLAW_COUNT).fill(openRatio);

    for (let i = 0; i < CLAW_COUNT; i++) {
        const angle = angleStep * i;
        const r = ratios[i];
        const swingAngle = -0.22 + r * 0.82; 

        const pX = center.x + Math.cos(angle) * r_base;
        const pZ = center.z + Math.sin(angle) * r_base;
        const pY = baseY;

        const nextPos = new CANNON.Vec3(pX, pY, pZ);

        const qFinal = new THREE.Quaternion();
        const qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);
        const qZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), swingAngle);
        
        qFinal.multiplyQuaternions(qY, qZ);
        const nextRot = new CANNON.Quaternion(qFinal.x, qFinal.y, qFinal.z, qFinal.w);

        const vx = (nextPos.x - clawLinks[i].position.x) / dt;
        const vy = (nextPos.y - clawLinks[i].position.y) / dt;
        const vz = (nextPos.z - clawLinks[i].position.z) / dt;

        const speedSq = vx*vx + vy*vy + vz*vz;
        if (speedSq > 400) { 
            clawLinks[i].velocity.set(0, 0, 0);
            clawLinks[i].angularVelocity.set(0, 0, 0);
        } else {
            clawLinks[i].velocity.set(vx, vy, vz);

            const qDiff = nextRot.mult(clawLinks[i].quaternion.inverse());
            clawLinks[i].angularVelocity.set(
                qDiff.x * 2 / dt,
                qDiff.y * 2 / dt,
                qDiff.z * 2 / dt
            );
        }

        clawLinks[i].position.copy(nextPos);
        clawLinks[i].quaternion.copy(nextRot);

        clawVisuals[i].position.copy(clawLinks[i].position);
        clawVisuals[i].quaternion.copy(clawLinks[i].quaternion);
    }
}

// 掴みシーケンス開始処理
function startCatchSequence() {
    gameState = 'drop';
    document.getElementById('catch-btn').disabled = true;
    keys.up = keys.down = keys.left = keys.right = false;
    sequenceTimer = 0;
    clawLockedRatios = Array(CLAW_COUNT).fill(null);
    currentClawRatios = Array(CLAW_COUNT).fill(1.0);
    heldPrizeBodies.clear();
    heldPrizeOffsets.clear();
    prizeContactClaws.clear();
}

// クレーンの自動行動状態機械（FSM）
function updateCraneSequence() {
    if (gameState === 'move') return;

    if (gameState === 'drop') {
        craneUnitMesh.position.y -= 0.045;
        currentClawRatios = Array(CLAW_COUNT).fill(1.0);
        updateClawPositions(currentClawRatios); 
        if (craneUnitMesh.position.y <= DROP_DEPTH) {
            gameState = 'grab';
            sequenceTimer = 0;
        }
    } 
    else if (gameState === 'grab') {
        sequenceTimer += 0.02; 
        let targetRatio = 1.0 - (sequenceTimer * 1.5); 
        if (targetRatio < 0.0) targetRatio = 0.0; 
        
        for (let i = 0; i < CLAW_COUNT; i++) {
            if (clawLockedRatios[i] !== null) {
                currentClawRatios[i] = clawLockedRatios[i];
            } else {
                currentClawRatios[i] = targetRatio;
                if (checkClawContact(i)) {
                    clawLockedRatios[i] = Math.max(0.0, targetRatio);
                }
            }
        }
        updateClawPositions(currentClawRatios);

        if (sequenceTimer >= 1.0) { 
            captureContactedPrizes();
            gameState = 'lift';
        }
    } 
    else if (gameState === 'lift') {
        craneUnitMesh.position.y += LIFT_SPEED;
        updateClawPositions(currentClawRatios);
        if (craneUnitMesh.position.y >= CRANE_HOME_Y) {
            craneUnitMesh.position.y = CRANE_HOME_Y;
            updateClawPositions(currentClawRatios);
            gameState = 'hold';
            sequenceTimer = 0;
        }
    }
    else if (gameState === 'hold') {
        sequenceTimer += 1 / 60;
        updateClawPositions(currentClawRatios);
        if (sequenceTimer >= HOLD_PAUSE_DURATION) {
            gameState = 'return';
        }
    } 
    else if (gameState === 'return') {
        const targetX = HOLE_POS.x;
        const targetZ = HOLE_POS.z;
        
        let dx = targetX - craneUnitMesh.position.x;
        let dz = targetZ - craneUnitMesh.position.z;
        let dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > 0.08) {
            craneUnitMesh.position.x += (dx / dist) * MOVE_SPEED;
            craneUnitMesh.position.z += (dz / dist) * MOVE_SPEED;
            updateClawPositions(currentClawRatios);
        } else {
            craneUnitMesh.position.x = targetX;
            craneUnitMesh.position.z = targetZ;
            gameState = 'releasePause';
            sequenceTimer = 0;
        }
    } 
    else if (gameState === 'releasePause') {
        sequenceTimer += 1 / 60;
        updateClawPositions(currentClawRatios);
        if (sequenceTimer >= RELEASE_PAUSE_DURATION) {
            prepareHeldPrizesForRelease();
            heldPrizeBodies.clear();
            heldPrizeOffsets.clear();
            releaseStartClawRatios = currentClawRatios.slice();
            gameState = 'release';
            sequenceTimer = 0;
        }
    }
    else if (gameState === 'release') {
        sequenceTimer += RELEASE_OPEN_SPEED;
        const openProgress = Math.min(sequenceTimer, 1.0);
        
        currentClawRatios = releaseStartClawRatios.map(startRatio => {
            return startRatio + (1.0 - startRatio) * openProgress;
        });
        updateClawPositions(currentClawRatios);

        if (openProgress >= 1.0) {
            gameState = 'reset';
            sequenceTimer = 0;
        }
    }
    else if (gameState === 'reset') {
        const targetX = 0;
        const targetZ = 0;
        let dx = targetX - craneUnitMesh.position.x;
        let dz = targetZ - craneUnitMesh.position.z;
        let dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > 0.08) {
            craneUnitMesh.position.x += (dx / dist) * MOVE_SPEED;
            craneUnitMesh.position.z += (dz / dist) * MOVE_SPEED;
            updateClawPositions(1.0); 
        } else {
            craneUnitMesh.position.x = targetX;
            craneUnitMesh.position.z = targetZ;
            updateClawPositions(1.0);
            
            gameState = 'move';
            clawLockedRatios = Array(CLAW_COUNT).fill(null);
            currentClawRatios = Array(CLAW_COUNT).fill(1.0);
            heldPrizeBodies.clear();
            heldPrizeOffsets.clear();
            prizeContactClaws.clear();
            startTimer();
        }
    }
}

function prepareHeldPrizesForRelease() {
    heldPrizeBodies.forEach(body => {
        body.position.x += (HOLE_POS.x - body.position.x) * 0.25;
        body.position.z += (HOLE_POS.z - body.position.z) * 0.25;
        body.velocity.set(0, RELEASE_DROP_SPEED, 0);
        body.angularVelocity.set(0, 0, 0);
    });
}

function holdPrize(body) {
    if (!heldPrizeBodies.has(body)) {
        heldPrizeBodies.add(body);
        heldPrizeOffsets.set(body, new CANNON.Vec3(
            body.position.x - craneUnitMesh.position.x,
            body.position.y - craneUnitMesh.position.y,
            body.position.z - craneUnitMesh.position.z
        ));
    }
}

function registerPrizeContact(body, clawIndex) {
    if (!prizeContactClaws.has(body)) {
        prizeContactClaws.set(body, new Set());
    }
    prizeContactClaws.get(body).add(clawIndex);
}

function captureContactedPrizes() {
    prizeContactClaws.forEach((contactingClaws, body) => {
        if (!prizeBodies.includes(body)) return;

        const dx = body.position.x - craneUnitMesh.position.x;
        const dz = body.position.z - craneUnitMesh.position.z;
        const dy = body.position.y - craneUnitMesh.position.y;
        const isUnderClawCenter = Math.sqrt(dx * dx + dz * dz) < 0.75 && dy < -0.8 && dy > -4.6;

        if (contactingClaws.size >= 2 && isUnderClawCenter) {
            holdPrize(body);
        }
    });
}

function checkClawContact(clawIndex) {
    const clawBody = clawLinks[clawIndex];
    for (let i = 0; i < world.contacts.length; i++) {
        const c = world.contacts[i];
        if (c.bi === clawBody || c.bj === clawBody) {
            const other = (c.bi === clawBody) ? c.bj : c.bi;
            if (prizeBodies.includes(other)) {
                registerPrizeContact(other, clawIndex);
                return true;
            }
        }
    }
    return false;
}

function calmHeldPrizeMotion(body) {
    const heldStates = ['lift', 'hold', 'return', 'releasePause'];
    if (!heldStates.includes(gameState)) return;
    if (!heldPrizeBodies.has(body)) return;

    const offset = heldPrizeOffsets.get(body);
    if (!offset) return;

    const targetX = craneUnitMesh.position.x + offset.x;
    const targetY = craneUnitMesh.position.y + offset.y;
    const targetZ = craneUnitMesh.position.z + offset.z;

    body.position.x += (targetX - body.position.x) * HELD_PRIZE_FOLLOW_STRENGTH;
    body.position.y += (targetY - body.position.y) * HELD_PRIZE_FOLLOW_STRENGTH;
    body.position.z += (targetZ - body.position.z) * HELD_PRIZE_FOLLOW_STRENGTH;

    body.velocity.scale(HELD_PRIZE_DAMPING, body.velocity);
    body.angularVelocity.scale(HELD_PRIZE_DAMPING, body.angularVelocity);

    const speed = body.velocity.length();
    if (speed > HELD_PRIZE_MAX_SPEED) {
        body.velocity.scale(HELD_PRIZE_MAX_SPEED / speed, body.velocity);
    }

    const angularSpeed = body.angularVelocity.length();
    if (angularSpeed > HELD_PRIZE_MAX_ANGULAR_SPEED) {
        body.angularVelocity.scale(HELD_PRIZE_MAX_ANGULAR_SPEED / angularSpeed, body.angularVelocity);
    }
}