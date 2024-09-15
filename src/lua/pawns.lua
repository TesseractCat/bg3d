require "utility"

function standard_deck()
    local suits = {'S','D','C','H'};
    local ranks = {'A','2','3','4','5','6','7','8','9','10','J','Q','K'};

    return table.flat_map(
        suits,
        function(suit)
            return table.map(
                ranks, function(rank) return string.format("generic/cards/%s%s.webp", rank, suit) end
            )
        end
    )
end
function get_chess_piece(name)
    local white = Pawn:new{
        name = "White " .. name:gsub("^%l", string.upper),
        mesh = "chess/" .. name .. ".gltf"
    }
    local black = Pawn:new{
        name = "Black " .. name:gsub("^%l", string.upper),
        mesh = "chess/" .. name .. ".gltf",
        tint = tonumber("0x303030")
    }
    return {white, black}
end

return {
    generic = {
        Pawn:new{
            name = "Bird Statue",
            mesh = 'generic/bird.glb'
        },
        Pawn:new{
            name = "Mini Bird",
            tint = 0xdd2222,
            mesh = 'generic/minibird.gltf'
        },
        Pawn:new{
            name = "Mini Person",
            tint = 0x2222dd,
            mesh = 'generic/meeple.gltf'
        },
        Pawn:new{
            name = 'Cards',
            data = DeckData:new{
                back = 'generic/cards/back.webp',
                contents = standard_deck(),
                corner_radius = 0.06,
                size = vec2(2.5, 3.5),
            }
        }
    },
    dice = {
        Pawn:new{
            name = 'D6',
            mesh = 'generic/d6.gltf',
            data = DiceData:new{
                roll_rotations = {
                    quat.from_euler(0, 0, 0),
                    quat.from_euler(math.pi/2, 0, 0),
                    quat.from_euler(math.pi, 0, 0),
                    quat.from_euler(-math.pi/2, 0, 0),
                    quat.from_euler(0, 0, math.pi/2),
                    quat.from_euler(0, 0, -math.pi/2)
                }
            }
        }
    },
    checkers = {
        Pawn:new{
            name = "Red Checker",
            mesh = "checkers/checker.gltf",
            tint = tonumber("0xEE3030"),
        },
        Pawn:new{
            name = "Black Checker",
            mesh = "checkers/checker.gltf",
            tint = tonumber("0x303030"),
        }
    },
    chess = table.flat_map({"rook","knight","bishop","queen","king","pawn"}, get_chess_piece)
}