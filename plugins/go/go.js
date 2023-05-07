self.world.addEventListener("start", async () => {
    // Spawn board
    self.world.add(new Pawn({
        name: 'Board',
        position: new Vector3(0,0,0),
        mesh: 'go/goban.gltf',
        moveable: false
    }));

    // Snap positions
    self.world.add(new SnapPoint({
        position: new Vector3(0,0.5,0),
        size: new Vector2(19,19),
        radius: 0.5,
        scale: 0.85,
    }));

    // Stones
    let whiteStone = new Pawn({
        name: 'White Stone',
        position: new Vector3(0,1,0),
        mesh: 'go/stone.gltf'
    });
    let blackStone = whiteStone.clone();
    blackStone.name = 'Black Stone';
    blackStone.tint = 0x111111;

    // Bags
    let whiteStoneBag = new Container({
        name: 'White Stones', holds: whiteStone,
        position: new Vector3(10,1.25,7),
        mesh: 'generic/bag.gltf'
    })
    let blackStoneBag = whiteStoneBag.clone();
    blackStoneBag.name = 'Black Stones';
    blackStoneBag.holds = blackStone;
    blackStoneBag.position = new Vector3(-whiteStoneBag.position.x,
                                         whiteStoneBag.position.y,
                                         -whiteStoneBag.position.z);

    self.world.add([whiteStoneBag, blackStoneBag]);

    self.world.close();
});