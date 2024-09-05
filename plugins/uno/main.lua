function getCards()
    local numbers = {}
    for i=0,47 do table.insert(numbers, string.format("cards/numbers_%i.webp", i)) end
    local special = {}
    for i=0,11 do table.insert(special, string.format("cards/special_%i.webp", i)) end

    table.extend(numbers, special)

    return numbers
end

function game.start()
    lobby:create_pawn{
        name = 'Uno',
        position = vec3(0, 1, 0),

        rotation = quat.from_euler(math.pi, 0, 0),
        select_rotation = quat.from_euler(math.pi, 0, 0),

        data = DeckData:new{
            back = 'cards/back.webp',
            contents = table.shuffle(getCards()), cornerRadius = 0.06,
            size = vec2(2.5, 3.5),
        }
    }

    lobby:create_pawn{
        name = 'Mat', moveable = false,
        position = vec3(0, 0.025, 0),
        tint = tonumber("0x333333"),

        data = DeckData:new{
            contents = {'generic/white.png'},
            cornerRadius = 0.05, cardThickness = 0.05,
            size = vec2(5, 5)
        }
    }
end