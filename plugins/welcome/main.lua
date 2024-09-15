local bird
function game.chat(user, message)
    --lobby:system_chat("ECHO: " .. user .. " said '" .. message .. "'")
    if message == "/test" then
        lobby:schedule(coroutine.create(function()
            while true do
                coroutine.yield(20)
                bird.mesh = 'generic/minibird.gltf'
                bird.position.y = bird.position.y + 1
                if bird.tint ~= nil then
                    bird.tint = bird.tint + 50
                else
                    bird.tint = tonumber("0x888888")
                end
            end
        end))
    end
end

local test
function game.page(path)
    local path, query = parseurl(path)
    if path == "/" then
        checkbox = query.test == "on"
        return string.format([[
            <style>
            html, body { height: fit-content; }
            </style>
            <script>
            addEventListener("load", () => {
                const onResize = () => {
                    window.parent.postMessage(getComputedStyle(document.documentElement).height, "*");
                };
                new ResizeObserver(onResize).observe(document.documentElement);
                onResize();
            });
            </script>

            <form id="form" action="">
                <input type="checkbox" name="test" %s>
                <button>Submit</button>
            </form>
        ]], checkbox and "checked" or "")
    end
end

local pawn
function game.start()
    bird = lobby:create_pawn{
        name = "Bird Statue",
        position = vec3(-1.6,2.8,-1.8),
        rotation = quat.from_euler(0, math.pi/6, 0),
        mesh = 'generic/bird.glb',
        on_release = function(user)
            lobby:system_chat("USER " .. user .. " RELEASED BIRD")
        end
    }

    bird.on_grab = function(user)
        lobby:system_chat("USER " .. user .. " GRABBED BIRD")
    end

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
        rotation = quat.from_euler(0, 0, 0),
        moveable = false,

        data = DeckData:new{
            contents = {"notes/cork.webp"},
            border = "notes/mat.svg",
            corner_radius = 0.03,
            size = vec2(10, 9),
            card_thickness = 0.2,
            side_color = tostring("0x926c51")
        }
    }

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

    local deck = lobby:create_pawn{
        name = 'Cards',
        position = bird.position + vec3(3.25, 1, 0),
        rotation = quat.from_euler(0, -math.pi/2 - math.pi/32, 0),

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

    local mini = Pawn:new{
        name = "Mini Bird",
        tint = 0xdd2222,
        mesh = 'generic/minibird.gltf'
    }
    local bag = lobby:create_pawn{
        name = "Mystery Bag",
        position = vec3(-6.5, 0, 0),
        rotation = quat.from_euler(0, math.pi/16, 0),
        mesh = 'generic/bag.gltf',
        data = ContainerData:new{
            holds = mini, capacity = 5,
        }
    }

    -- Post-its
    lobby:create_pawn{
        name = "Post-it", tint = tonumber("0xFFFF99"),
        position = vec3(-2.8, 5.8, 3),
        rotation = quat.from_euler(0, -math.pi/32, 0),
        texture = 'notes/welcome.webp',
        mesh = 'notes/post-it.gltf',
    }
    lobby:create_pawn{
        name = "Post-it", tint = tonumber("0xFF99FF"),
        position = vec3(1.0, 5.8, 2.8),
        rotation = quat.from_euler(0, math.pi/22, 0),
        texture = 'notes/info.webp',
        mesh = 'notes/post-it.gltf',
    }
    lobby:create_pawn{
        name = "Post-it", tint = tonumber("0xBBFFFF"),
        position = vec3(6.0, 5.8, -1.6),
        rotation = quat.from_euler(0, math.pi/2 - math.pi/64, 0),
        texture = 'notes/cards.webp',
        mesh = 'notes/post-it.gltf',
    }

    local queen = lobby:create_pawn{
        name = "Queen",
        mesh = 'chess/queen.gltf',
        position = vec3(3.5,1,1),
        tint = tonumber("0x303030")
    }

    lobby:create_pawn{
        name = 'D6',
        position = vec3(4,1,3),
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
end

function game.settings()

end

-- local last_time
-- function game.physics()
--     if last_time ~= math.floor(lobby:time() * 25) then
--         last_time = math.floor(lobby:time() * 25)
--         pawn.position = vec3(0, 1, 0) * (math.sin(lobby:time()) + 1)
--         lobby:system_chat("Position: " .. tostring(pawn.position))
--     end
-- end