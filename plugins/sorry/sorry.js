function getCards() {
    return [...Array(44)].map((_, i) => `cards/cards_${i}.webp`);
}

self.world.addEventListener("start", () => {
    // Cards
    let deck = new Deck({
        name: "Cards",
        back: "back.webp",
        contents: getCards(), cornerRadius: 0.05,
        position: new Vector3(0, 1, 2.51),
        rotation: new Vector3(Math.PI, Math.PI/2, 0),
        size: new Vector2(1.9, 2.9),
    });
    deck.shuffle();

    let cardSnapPoints = [
        new SnapPoint({
            position: new Vector3(0, 0, 2.51),
            snaps: ["Cards"],
        }),
        new SnapPoint({
            position: new Vector3(0, 0, -2.3),
            snaps: ["Cards"],
        })
    ];

    // Board
    let board = new Deck({
        name: "Board",
        contents: ["board.webp"],
        cornerRadius: 0.0,
        position: new Vector3(0, 0, 0),
        size: new Vector2(18, 18),
        moveable: false,
    });

    self.world.add([deck, cardSnapPoints, board].flat());

    let home = new Vector2(3.8, 6.5);
    let players = [
        ["Red",    0xff0000, new Vector2(home.x, home.y)],
        ["Blue",   0x3164d4, new Vector2(-home.y, home.x)],
        ["Yellow", 0xffff00, new Vector2(-home.x, -home.y)],
        ["Green",  0x00ff00, new Vector2(home.y, -home.x)],
    ];
    let offsets = [
        new Vector2(1, 0),
        new Vector2(-1, 0),
        new Vector2(0, 1),
        new Vector2(0, -1),
    ];
    for (let [colorName, color, position] of players) {
        self.world.add(offsets.map((offset) => {
            return new Pawn({
                name: colorName + " Piece",
                tint: color,
                position: new Vector3(position.x + offset.x * 0.5, 1, position.y + offset.y * 0.5),
                mesh: 'generic/piece.gltf'
            });
        }));
    }

    self.world.close();
});