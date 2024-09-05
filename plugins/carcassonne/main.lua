function getCards()
    local cards = table.map({
        'citybend2.webp',
        'citydiagonal3.webp',
        'cityends3.webp',
        'citygrass3.webp',
        'cityinterior1.webp',
        'cityintersection3.webp',
        'cityoutcrop5.webp',
        'citypath1.webp',
        'cityroad1.webp',
        'cityturn3.webp',
        'cityturnleft3.webp',
        'cityturnright3.webp',
        'intersection1.webp',
        'intersection4.webp',
        'monastery2.webp',
        'monastery4.webp',
        'road8.webp',
        'start3.webp',
        'turn9.webp',
        'shielded/citydiagonal2.webp',
        'shielded/citygrass1.webp',
        'shielded/cityinterior1.webp',
        'shielded/citypath2.webp',
        'shielded/cityroad2.webp',
        'shielded/cityturn2.webp',
    }, function(c) return 'cards/' .. c end);
    return table.flat_map(cards, function(card)
        local count = tonumber(card:gsub("[^%d]", ""))
        local res = {}
        for i=1,count do table.insert(res, card) end
        return res
    end)
end

function game.start()
    local cardSize = 1.8

    lobby:create_pawn{
        name = "Landscape Tiles",
        position = vec3(0, 1, 0),
        rotation = quat.from_euler(math.pi, 0, 0),
        select_rotation = quat.from_euler(math.pi, 0, 0),
        data = DeckData:new{
            back = "back.webp",
            contents = table.shuffle(getCards()), cornerRadius = 0.06,
            size = vec2(cardSize, cardSize),
        }
    }
    --deck.shuffle();

    lobby:create_pawn{
        name = "Landscape Tiles",
        position = vec3(0, 1, cardSize * 4 * 1.05),
        data = DeckData:new{
            back = "back.webp",
            contents = {"cards/start3.webp"}, cornerRadius = 0.06,
            size = vec2(cardSize, cardSize),
        }
    }

    lobby:create_pawn{
        name = "Scoreboard",
        position = vec3(0, 0.01/2, -6),
        moveable = false,
        data = DeckData:new{
            size = vec2(7 * 1.48, 7),
            contents = {'scoreboard.webp'},
        }
    }

    -- Snap positions
    lobby:create_pawn{
        data = SnapPointData:new{
            size = vec2(99,99),
            radius = cardSize * 1.05,
            scale = cardSize * 1.05,
            snaps = {"Landscape Tiles"},
        }
    }

    local meeple_info = {
        {"Blue",   tonumber("0x2222dd"), vec3(-5, 1, 0)},
        {"Yellow", tonumber("0xffff11"), vec3(-5 - 4, 1, 0)},
        {"Green",  tonumber("0x22dd22"), vec3(-5 - 8, 1, 0)},
        {"Red",    tonumber("0xdd2222"), vec3(-5 - 4, 1, -4)},
        {"Black",  tonumber("0x222222"), vec3(-5 - 8, 1, -4)},
    };
    for _, meeple in ipairs(meeple_info) do
        local color_name, color, position = unpack(meeple)
        local meeple = Pawn:new{
            name = color_name .. " Meeple",
            tint = color,
            mesh = 'generic/meeple.gltf'
        }
        lobby:create_pawn{
            name = color_name .. " Meeple",
            position = position,
            mesh = 'generic/bag.gltf',
            data = ContainerData:new{
                holds = meeple, capacity = 8,
            }
        }
    end
end
