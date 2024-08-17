local pawn
function game.start()
    lobby:system_chat(_VERSION .. " | " .. lobby:name())

    local bird = lobby:create_pawn{
        name = "Bird Statue",
        position = vec3(-1.6,2.8,-1.8),
        rotation =  vec3(0, math.pi/6, 0),
        mesh = 'generic/bird.glb',
    }

    local stand = lobby:create_pawn{
        name = "Stand",
        tint = 0xf1ede1,
        position = vec3(bird.position.x, 0, bird.position.z),
        mesh = 'generic/stand.gltf',
        moveable = false
    }

    local mat = lobby:create_pawn{
        name = "Mat",

        position = vec3(0, 0, 0.5),
        rotation = vec3(0, 0, 0),
        moveable = false,

        data = DeckData:new{
            contents = {"notes/cork.webp"},
            border = "notes/mat.svg",
            corner_radius = 0.03,
            size = vec2(10, 9),
        }
    }

    function standard_deck()
        local suits = {'S','D','C','H'};
        local ranks = {'A','2','3','4','5','6','7','8','9','10','J','Q','K'};

        return table.flat_map(suits,
            function(suit)
                return table.map(ranks,
                    function(rank)
                        return string.format("generic/cards/%s%s.webp", rank, suit)
                    end)
            end)
    end

    local deck = lobby:create_pawn{
        name = 'Cards',
        position = vec3(bird.position.x + 3.25, 1, bird.position.z),
        rotation = vec3(0, -math.pi/2 - math.pi/32, 0),

        data = DeckData:new{
            back = 'generic/cards/back.webp',
            contents = standard_deck(),
            corner_radius = 0.06,
            size = vec2(2.5, 3.5),
        }
    }

    local bird_snap = lobby:create_pawn{
        position = vec3(bird.position.x, 1, bird.position.z),
        data = SnapPointData:new{}
    }

    -- local mini = lobby:create_pawn{
    --     name: "Mini Bird",
    --     tint: 0xdd2222,
    --     mesh: 'generic/minibird.gltf'
    -- }
    -- local bag = lobby:create_pawn{
    --     name: "Mystery Bag", holds: mini, capacity: 5,
    --     position: vec3(-6.5, 0, 0),
    --     rotation: vec3(0, math.pi/16, 0),
    --     mesh: 'generic/bag.gltf',
    -- }

    -- local post_its = {
    --     lobby:create_pawn{
    --         name: "Post-it", tint: 0xFFFF99,
    --         position: vec3(-2.8, 2.8, 3),
    --         rotation: vec3(0, -math.pi/32, 0),
    --         texture: 'notes/welcome.webp',
    --         mesh: 'notes/post-it.gltf',
    --     },
    --     lobby:create_pawn{
    --         name: "Post-it", tint: 0xFF99FF,
    --         position: vec3(1.0, 2.8, 2.8),
    --         rotation: vec3(0, math.pi/22, 0),
    --         texture: 'notes/info.webp',
    --         mesh: 'notes/post-it.gltf',
    --     },
    --     lobby:create_pawn{
    --         name: "Post-it", tint: 0xBBFFFF,
    --         position: vec3(6.0, 2.8, -1.6),
    --         rotation: vec3(0, math.pi/2 - math.pi/64, 0),
    --         texture: 'notes/cards.webp',
    --         mesh: 'notes/post-it.gltf',
    --     },
    -- }

    -- let queen = new Pawn({
    --     name: "Queen",
    --     mesh: 'chess/queen.gltf',
    --     position: vec3(3.5,1,1),
    --     tint: 0x303030
    -- });
    -- let die = new Dice({
    --     name: 'Die',
    --     position: vec3(4,1,3),
    --     mesh: 'generic/die.gltf',
    --     rollRotations: [
    --         vec3(0, 0, 0),
    --         vec3(math.pi/2, 0, 0),
    --         vec3(math.pi, 0, 0),
    --         vec3(-math.pi/2, 0, 0),
    --         vec3(0, 0, math.pi/2),
    --         vec3(0, 0, -math.pi/2),
    --     ]
    -- });
end

-- local last_time
-- function game.physics()
--     if last_time ~= math.floor(lobby:time() * 25) then
--         last_time = math.floor(lobby:time() * 25)
--         pawn.position = vec3(0, 1, 0) * (math.sin(lobby:time()) + 1)
--         lobby:system_chat("Position: " .. tostring(pawn.position))
--     end
-- end

function game.chat(user, message)
    lobby:system_chat("ECHO: " .. user .. " said '" .. message .. "'")
end