import { Pawn, SnapPoint, Dice } from './pawn';
import { Deck, Container } from './containers';

export { Pawn, SnapPoint, Dice } from './pawn';
export { Deck, Container } from './containers';

export function deserializePawn(serializedPawn) {
    let result;
    switch (serializedPawn.class) {
        case "Pawn":
            result = Pawn.deserialize(serializedPawn);
            break;
        case "SnapPoint":
            result = SnapPoint.deserialize(serializedPawn);
            break;
        case "Dice":
            result = Dice.deserialize(serializedPawn);
            break;
        case "Deck":
            result = Deck.deserialize(serializedPawn);
            break;
        case "Container":
            result = Container.deserialize(serializedPawn);
            break;
        default:
            console.error("Encountered unknown pawn type!");
            console.error(serializedPawn);
            return;
    }
    return result;
}