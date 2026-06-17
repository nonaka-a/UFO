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

    // 左側面壁を 10.0 にフルサイズ延長したことで、横から見たときの筒抜けスリット（隙間）がアクリル板で美しく密閉されます。
    const wallsData = [
        [0.1, 1.6, HOLE_SIZE, holeMaxX, -3.95, HOLE_POS.z],  // 落とし口横（右側面）の仕切り
        [HOLE_SIZE, 1.6, 0.1, HOLE_POS.x, -3.95, holeMinZ],  // 落とし口奥側の仕切り
        [HOLE_SIZE, 1.6, 0.1, HOLE_POS.x, -3.95, holeMaxZ],  // 落とし口手前側の仕切り
        [10.0, 4.5, 0.1, 0, -2.5, -5.0],                      // 後面壁
        [10.0, 4.5, 0.1, 0, -2.5, 5.0],                       // 前面壁
        [0.1, 4.5, 10.0, 5.0, -2.5, 0],                       // 右側面壁
        [0.1, 4.5, 10.0, -5.0, -2.5, 0]                       // 左側面壁（隙間なく完全に閉じる）
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