function getPiece(name, radius, height) {
    let white = new Pawn({
        name: name,
        mesh: 'chess/' + name + '_white.gltf',
        colliderShapes: [
            new Cylinder(radius, height)
        ]
    });
    let black = new Pawn({
        name: name,
        mesh: 'chess/' + name + '_black.gltf',
        colliderShapes: [
            new Cylinder(radius, height)
        ]
    });
    return [white, black];
}
function addPiece(piece, positions) {
    positions.forEach((p) => {
        piece[1].position = new Vector3(-7 + p.x * 2, 3, -7 + p.z * 2);
        addPawn(piece[1]);
        piece[0].position = new Vector3(-7 + p.x * 2, 3, -7 + (7 - p.z) * 2);
        piece[0].rotation.y = Math.PI;
        addPawn(piece[0]);
    });
}

self.start = async function() {
    // Spawn board
    addPawn(new Pawn({
        name: 'Board',
        position: new Vector3(0,0.5,0),
        mesh: 'checkers/checkerboard.gltf',
        colliderShapes: [
            new Box(new Vector3(8.0,0.5,8.0))
        ],
        moveable: false
    }));

    // Define pieces
    let queen = getPiece('queen', 0.7, 2.81);
    let king = getPiece('king', 0.7, 3.18);
    let rook = getPiece('rook', 0.625, 1.9);
    let knight = getPiece('knight', 0.625, 2.09);
    let bishop = getPiece('bishop', 0.625, 2.67);
    let pawn = getPiece('pawn', 0.625, 1.78);

    // Spawn pieces
    let rookPositions = [
        new Vector3(0, 0, 0),
        new Vector3(7, 0, 0),
    ];
    addPiece(rook, rookPositions);
    let knightPositions = [
        new Vector3(1, 0, 0),
        new Vector3(6, 0, 0),
    ];
    addPiece(knight, knightPositions);
    let bishopPositions = [
        new Vector3(2, 0, 0),
        new Vector3(5, 0, 0),
    ];
    addPiece(bishop, bishopPositions);
    let queenPositions = [
        new Vector3(3, 0, 0),
    ];
    addPiece(queen, queenPositions);
    let kingPositions = [
        new Vector3(4, 0, 0),
    ];
    addPiece(king, kingPositions);

    let pawnPositions = [
        new Vector3(0, 0, 1),
        new Vector3(1, 0, 1),
        new Vector3(2, 0, 1),
        new Vector3(3, 0, 1),
        new Vector3(4, 0, 1),
        new Vector3(5, 0, 1),
        new Vector3(6, 0, 1),
        new Vector3(7, 0, 1),
    ];
    addPiece(pawn, pawnPositions);
}
