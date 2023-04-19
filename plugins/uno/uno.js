function getCards() {
    let numbers = [...Array(48)].map((_, i) => `numbers_${i}.webp`);
    let special = [...Array(12)].map((_, i) => `special_${i}.webp`);

    return numbers.concat(special);
}

self.world.addEventListener("start", () => {
    let deck = new Deck({
        name: 'Uno',
        back: 'back.webp',
        contents: getCards(), cornerRadius: 0.06,
        position: new Vector3(0, 1, 0),
        rotation: new Vector3(Math.PI, 0, 0),
        size: new Vector2(2.5, 3.5),
    });
    deck.shuffle();

    self.world.add(deck);
});
