// 3. ステージの生成
function createStage() {
    // 筐体の床の白飛びを避けるため、落ち着いたグレー感のある薄いピンクベージュ（0xbaa4a7）にし、反射をしっかり抑える
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xbaa4a7, roughness: 0.85 });
    const holeHalf = HOLE_SIZE / 2;
    const stageMin = -5;
    const stageMax = 5;
    const holeMinX = HOLE_POS.x - holeHalf;
    const holeMaxX = HOLE_POS.x + holeHalf;
    const holeMinZ = HOLE_POS.z - holeHalf;
    const holeMaxZ = HOLE_POS.z + holeHalf;
    const floorSegments = [
        [stageMax - stageMin, 0.5, holeMinZ - stageMin, 0, -5, (stageMin + holeMinZ) / 2],
        [holeMinX - stageMin, 0.5, stageMax - holeMinZ, (stageMin + holeMinX) / 2, -5, (holeMinZ + stageMax) / 2],
        [stageMax - holeMaxX, 0.5, stageMax - holeMinZ, (holeMaxX + stageMax) / 2, -5, (holeMinZ + stageMax) / 2],
        [HOLE_SIZE, 0.5, stageMax - holeMaxZ, HOLE_POS.x, -5, (holeMaxZ + stageMax) / 2]
    ];

    floorSegments.forEach(data => {
        if (data[0] <= 0 || data[2] <= 0) return;

        const floorGeo = new THREE.BoxGeometry(data[0], data[1], data[2]);
        const floorMesh = new THREE.Mesh(floorGeo, floorMat);
        floorMesh.position.set(data[3], data[4], data[5]);
        floorMesh.receiveShadow = true;
        scene.add(floorMesh);

        const floorBody = new CANNON.Body({
            mass: 0, shape: new CANNON.Box(new CANNON.Vec3(data[0] / 2, data[1] / 2, data[2] / 2)), material: materials.physicsDefault
        });
        floorBody.position.set(data[3], data[4], data[5]);
        world.addBody(floorBody);
    });

    const holeGeo = new THREE.PlaneGeometry(HOLE_SIZE, HOLE_SIZE);
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x7f3548, side: THREE.DoubleSide });
    const holeMesh = new THREE.Mesh(holeGeo, holeMat);
    holeMesh.rotation.x = Math.PI / 2;
    holeMesh.position.set(HOLE_POS.x, -5.35, HOLE_POS.z);
    scene.add(holeMesh);

    const wallMat = new THREE.MeshStandardMaterial({
        color: 0xff4757, transparent: true, opacity: 0.25, roughness: 0.1, metalness: 0.1
    });

    const wallsData = [
        [0.1, 1.0, HOLE_SIZE, holeMaxX, -4.25, HOLE_POS.z],  
        [HOLE_SIZE, 1.0, 0.1, HOLE_POS.x, -4.25, holeMinZ],
        [10.0, 1.2, 0.1, 0, -4.15, -5.0], 
        [10.0, 1.2, 0.1, 0, -4.15, 5.0],  
        [0.1, 1.2, 10.0, 5.0, -4.15, 0],  
        [0.1, 1.2, 7.5, -5.0, -4.15, -1.25] 
    ];

    wallsData.forEach(data => {
        const wGeo = new THREE.BoxGeometry(data[0], data[1], data[2]);
        const wMesh = new THREE.Mesh(wGeo, wallMat);
        wMesh.position.set(data[3], data[4], data[5]);
        scene.add(wMesh);

        const wBody = new CANNON.Body({
            mass: 0, shape: new CANNON.Box(new CANNON.Vec3(data[0]/2, data[1]/2, data[2]/2)), material: materials.physicsDefault
        });
        wBody.position.set(data[3], data[4], data[5]);
        world.addBody(wBody);
    });
}