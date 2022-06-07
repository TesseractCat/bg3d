self.start = async function() {
    let birdHeight = 4.3;
    let bird = new Pawn({
        name: "Bird Statue",
        position: new Vector3(-1.9,2.8,-1.35),
        rotation: new Vector3(0, Math.PI/6, 0),
        mesh: 'generic/bird.gltf', colliderShapes: [
            new Cylinder(1.5, birdHeight)
        ],
    });
    addPawn(bird);

    let deck = new Deck({
        name: "Welcome", contents: ["generic/welcome.png"],
        sideColor: 0x000000, cornerRadius: 0.06,
        position: new Vector3(0.9, 0, 0),
        size: new Vector2(1.25 * 8, 1 * 8),
        moveable: false
    });
    addPawn(deck);

    addPawn(new SnapPoint({
        position: new Vector3(-1.9,0,-1.35),
    }));

    // let bag = new Container({
    //     name: "Bird Bag", holds: bird,
    //     position: new Vector3(1.9,1.25,-1.35),
    //     rotation: new Vector3(0, -Math.PI/6, 0),
    //     mesh: 'generic/bag.gltf', colliderShapes: [
    //         new Cylinder(1.5, 2.5)
    //     ],
    // })
    // addPawn(bag);
}
