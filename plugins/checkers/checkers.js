function boardToWorldPos(boardPos, height = 3) {
    return new Vector3(-7 + boardPos.x * 2, height, -7 + boardPos.y * 2);
}

self.world.addEventListener("start", async () => {
    // Spawn board
    self.world.add(new Pawn({
        name: 'Board',
        position: new Vector3(0,0,0),
        mesh: 'checkers/checkerboard.glb',
        moveable: false
    }));

    // Snap positions
    self.world.add(new SnapPoint({
        position: new Vector3(0,1,0),
        size: new Vector2(8,8),
        radius: 1,
        scale: 2,
    }));

    // Define pieces
    let black = new Pawn({
        name: 'Black',
        mesh: 'checkers/checker.gltf',
        tint: 0x303030
    });
    let red = new Pawn({
        name: 'Red',
        mesh: 'checkers/checker.gltf',
        tint: 0xee3030
    });

    for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 3; y++) {
            if ((x + y) % 2 == 0) {
                self.world.add(red.clone({position: boardToWorldPos(new Vector2(x, y))}));
            } else {
                self.world.add(black.clone({position: boardToWorldPos(new Vector2(x, 7-y))}));
            }
        }
    }

    self.world.close();
});
