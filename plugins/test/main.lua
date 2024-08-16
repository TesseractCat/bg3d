local pawn
function game.start()
    lobby:system_chat(_VERSION .. " | " .. lobby:name())
    pawn = lobby:create_pawn{name="Test pawn", position=Vec3.new(0, 1, 0), mesh="chess/pawn.gltf"}

    lobby:system_chat("ID " .. pawn.id)
    --pawn.position = Vec3.new(0, 5, 0)
end

-- function game.physics()
--     pawn:update{position = Vec3.new(0, 5, 0)}
-- end

function game.chat(user, message)
    lobby:system_chat("ECHO: " .. user .. " said '" .. message .. "'")
end