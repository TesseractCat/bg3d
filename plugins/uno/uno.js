function getCards() {
    let numbers = [...Array(48)].map((_, i) => `cards/numbers_${i}.webp`);
    let special = [...Array(12)].map((_, i) => `cards/special_${i}.webp`);

    return numbers.concat(special);
}

self.world.addEventListener("start", () => {
    let deck = new Deck({
        name: 'Uno',
        back: 'cards/back.webp',
        contents: getCards(), cornerRadius: 0.06,
        position: new Vector3(0, 1, 0),
        rotation: new Vector3(Math.PI, 0, 0),
        size: new Vector2(2.5, 3.5),
    });
    deck.shuffle();

    let mat = new Deck({
        name: 'Mat', moveable: false,
        contents: ['generic/white.png'],
        tint: 0x333333,
        cornerRadius: 0.05, cardThickness: 0.05,
        position: new Vector3(0, 0.025, 0),
        size: new Vector2(5, 5)
    });

    self.world.add([deck, mat]);

    self.world.close();
});
