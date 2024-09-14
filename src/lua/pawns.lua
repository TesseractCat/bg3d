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

return {
    generic = {
        Pawn:new{
            name = "Bird Statue",
            mesh = 'generic/bird.glb'
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
    }
}