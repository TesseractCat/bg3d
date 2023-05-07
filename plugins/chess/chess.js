function boardToWorldPos(chessPos, height = 3) {
    return new Vector3(-7 + chessPos.x * 2, height, -7 + chessPos.y * 2);
}

function getPiece(name) {
    let white = new Pawn({
        name: name,
        mesh: 'chess/' + name + '.gltf'
    });
    let black = new Pawn({
        name: name,
        mesh: 'chess/' + name + '.gltf',
        tint: 0x303030
    });
    return [white, black];
}
function addPiece(piece, positions) {
    let [white, black] = piece;

    let pawns = positions.flatMap((p) => {
        black.position = boardToWorldPos(p);
        black.rotation.y = 0;

        white.position = boardToWorldPos(new Vector2(p.x, 7 - p.y));
        white.rotation.y = Math.PI;

        return [white.clone(), black.clone()];
    });
    self.world.add(pawns);
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
    let queen = getPiece('queen');
    let king = getPiece('king');
    let rook = getPiece('rook');
    let knight = getPiece('knight');
    let bishop = getPiece('bishop');
    let pawn = getPiece('pawn');

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

    // await timeout(2000);

    // self.world.addEventListener("update", (e) => {
    //     self.world.pawns().get(e.detail[0]).position.y += 1;
    //     self.world.commit();
    // });

    self.world.close();
});
