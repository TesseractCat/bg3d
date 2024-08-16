-- Global vector math

local vmath = require "math"
vec3 = vmath.vec3
vec2 = vmath.vec2
quat = vmath.quat

-- Pawns

Pawn = {}
function Pawn.update(self, table)
    table.id = self.id
    lobby:update_pawn(table)
end
function Pawn.destroy(self)
    lobby:destroy_pawn(self.id)
end
function Pawn.new(id)
    local o = {id = id}
    setmetatable(o, {
        __index = function(self, key)
            if key == "id" then
                return rawget(self, id)
            else
                if Pawn[key] ~= nil then
                    return Pawn[key] -- Pawn class methods
                else
                    return lobby:get_pawn(self.id, key) -- Pawn get fields
                end
            end
        end,
        __newindex = function(self, key, value)
            update = {}
            update[key] = value
            self:update(update)
        end
    })
    return o
end