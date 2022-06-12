self.start = async function() {
    // Spawn board
    new Pawn({
        name: 'Board',
        position: new Vector3(0,0.25,0),
        mesh: 'go/goban.gltf',
        colliderShapes: [
            new Box(new Vector3(8.5,0.25,8.5))
        ],
        moveable: false
    }).create();

    // Snap positions
    new SnapPoint({
        position: new Vector3(0,0.5,0),
        size: new Vector2(19,19),
        radius: 0.5,
        scale: 0.85,
    }).create();

    // Stones
    let whiteStone = new Pawn({
        name: 'White Stone',
        position: new Vector3(0,1,0),
        mesh: 'go/stone.gltf',
        colliderShapes: [
            new Cylinder(0.4,0.18*2)
        ]
    });
    let blackStone = whiteStone.clone();
    blackStone.name = 'Black Stone';
    blackStone.tint = 0x111111;

    // Bags
    let whiteStoneBag = new Container({
        name: 'White Stones', holds: whiteStone,
        position: new Vector3(10,1.25,7),
        mesh: 'generic/bag.gltf', colliderShapes: [
            new Cylinder(1.5, 2.5)
        ],
    })
    let blackStoneBag = whiteStoneBag.clone();
    blackStoneBag.name = 'Black Stones';
    blackStoneBag.holds = blackStone;
    blackStoneBag.position = new Vector3(-whiteStoneBag.position.x,
                                         whiteStoneBag.position.y,
                                         -whiteStoneBag.position.z);

    whiteStoneBag.create();
    blackStoneBag.create();
}
