require "test"

function start()
    lobby:system_chat(_VERSION .. " | " .. lobby:name())
    local pawn = lobby:create_pawn{name="Test pawn", position=spawn_point(), mesh="chess/pawn.gltf"}
end