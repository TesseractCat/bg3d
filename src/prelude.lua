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
        __index = function(table, key)
            if table[key] == nil then
                if Pawn[key] ~= nil then
                    return Pawn[key] -- Pawn class methods
                else
                    return lobby:get_pawn(id, key) -- Pawn get fields
                end
            else
                return table[key]
            end
        end,
        __newindex = function(table, key, value)
            if key == "id" then
                error("pawn `id` is constant")
            else
                update = {id = id}
                update[key] = value
                table:update(update)
            end
        end
    })
    return o
end