function chessToWorldPos(chessPos, height = 3) {
    return new Vector3(-7 + chessPos.x * 2, height, -7 + chessPos.y * 2);
}

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
        piece[1].position = chessToWorldPos(p);
        addPawn(piece[1]);
        piece[0].position = chessToWorldPos(new Vector2(p.x, 7 - p.y));
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
        new Vector2(0, 0),
        new Vector2(7, 0),
    ];
    addPiece(rook, rookPositions);
    let knightPositions = [
        new Vector2(1, 0),
        new Vector2(6, 0),
    ];
    addPiece(knight, knightPositions);
    let bishopPositions = [
        new Vector2(2, 0),
        new Vector2(5, 0),
    ];
    addPiece(bishop, bishopPositions);
    let queenPositions = [
        new Vector2(3, 0),
    ];
    addPiece(queen, queenPositions);
    let kingPositions = [
        new Vector2(4, 0),
    ];
    addPiece(king, kingPositions);

    let pawnPositions = [
        new Vector2(0, 1),
        new Vector2(1, 1),
        new Vector2(2, 1),
        new Vector2(3, 1),
        new Vector2(4, 1),
        new Vector2(5, 1),
        new Vector2(6, 1),
        new Vector2(7, 1),
    ];
    addPiece(pawn, pawnPositions);

    // Snap positions
    addPawn(new SnapPoint({
        position: new Vector3(0,1,0),
        size: new Vector2(8,8),
        radius: 1,
        scale: 2,
    }));
}