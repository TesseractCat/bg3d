import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import Manager from './manager';
import { Pawn, Deck, Dice } from './pawn';

export class Game {
    manager;
    
    constructor(manager) {
        this.manager = manager;
    }
    init(clear, callback) {
        if (clear) {
            //this.manager.clear();
            this.manager.sendEvent("clear_pawns", true, {}, () => callback());
        } else {
            callback();
        }
    }
}

export class Checkers extends Game {
    init(clear) {
        super.init(clear, () => {
            let board = new Pawn(this.manager, new THREE.Vector3(0,0.5,0), new THREE.Quaternion(), 'checkerboard.gltf',
                new CANNON.Body({
                    mass: 0,
                    //shape: new CANNON.Box(new CANNON.Vec3(8.0,1.0,8.0))
                    shape: new CANNON.Box(new CANNON.Vec3(9.0,0.5,9.0))
                })
            );
            this.manager.addPawn(board);
            for (let x = 0; x < 8; x++) {
                for (let y = 0; y < 8; y++) {
                    if ((x + y) % 2 != 0 || y == 4 || y == 3)
                        continue;
                    let checker = new Dice(this.manager, new THREE.Vector3(-7.7 + x * 2.2,1.5,-7.7 + y * 2.2), new THREE.Quaternion(), y < 4 ? 'checker_red.gltf' : 'checker_black.gltf',
                        new CANNON.Body({
                            mass: 5,
                            shape: new CANNON.Cylinder(1.1, 1.1, 0.48, 6)//new CANNON.Vec3(1.0,0.2,1.0))
                        })
                    );
                    checker.moveable = true;
                    this.manager.addPawn(checker);
                }
            }
        });
    }
}

export class Cards extends Game {
    init(clear) {
        super.init(clear, () => {
            let ranks = "A,2,3,4,5,6,7,8,9,10,J,Q,K".split(",");
            let suits = "Clubs,Spades,Diamonds,Hearts".split(",");
            let cards = [];
            for (let rank of ranks) {
                for (let suit of suits) {
                    cards.push("./images/cards_k/card" + suit + rank + ".png");
                }
            }
            let deck = new Deck(this.manager, "standard_deck",
                new THREE.Vector3(0, 3, 0), new THREE.Quaternion(), new THREE.Vector2(3.75, 5.25), cards);
            deck.moveable = true;
            this.manager.addPawn(deck);
        });
    }
}
