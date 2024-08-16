local pawn
function game.start()
    lobby:system_chat(_VERSION .. " | " .. lobby:name())

    pawn = lobby:create_pawn{name="Pawn", position=vec3(0, 1, 0), mesh="chess/pawn.gltf"}
    lobby:create_pawn{position=vec3(0,0,0), data=SnapPointData:new{radius=2, snaps={"Pawn"}}}
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