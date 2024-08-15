function start()
    lobby:system_chat(_VERSION .. " | " .. lobby:name())
    local pawn = lobby:create_pawn{name="Test pawn", position=Vec3.new(0, 1, 0), mesh="chess/pawn.gltf"}
    lobby:system_chat("Spawned pawn at the dawn: " .. pawn)
    -- lobby:update_pawn{id=pawn, position=Vec3.new(0, 4, 0)}
end