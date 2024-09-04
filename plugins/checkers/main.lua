function boardToWorldPos(chessPos, height)
    height = height or 3
    return vec3(-7 + chessPos.x * 2, height, -7 + chessPos.y * 2)
end

function game.start()
    -- Spawn board
    lobby:create_pawn{
        name = "Board",
        position = vec3(0,0,0),
        mesh = "checkers/checkerboard.glb",
        moveable = false
    }

    -- Snap positions
    lobby:create_pawn{
        position = vec3(0,1,0),
        data = SnapPointData:new{
            size = vec2(8,8),
            radius = 1,
            scale = 2,
        }
    }

    for x=0,7 do
        for y=0,2 do
            if (x + y) % 2 == 0 then
                lobby:create_pawn{
                    name = "red",
                    mesh = "checkers/checker.gltf",
                    tint = tonumber("0xEE3030"),
                    position = boardToWorldPos(vec2(x, y))
                }
            else
                lobby:create_pawn{
                    name = "black",
                    mesh = "checkers/checker.gltf",
                    tint = tonumber("0x303030"),
                    position = boardToWorldPos(vec2(x, 7-y))
                }
            end
        end
    end
end
