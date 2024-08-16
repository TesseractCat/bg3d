local pawn
function game.start()
    lobby:system_chat(_VERSION .. " | " .. lobby:name())
    pawn = lobby:create_pawn{name="Test pawn", position=vec3(0, 1, 0), mesh="chess/pawn.gltf"}

    lobby:system_chat("ID " .. pawn.id)
end

local last_time
function game.physics()
    if last_time ~= math.floor(lobby:time() * 25) then
        last_time = math.floor(lobby:time() * 25)
        pawn.position = vec3(0, 1, 0) * (math.sin(lobby:time()) + 1)
        lobby:system_chat("Position: " .. tostring(pawn.position))
    end
end

function game.chat(user, message)
    lobby:system_chat("ECHO: " .. user .. " said '" .. message .. "'")
end