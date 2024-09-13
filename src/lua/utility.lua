-- Extension functions

function table.extend(tbl, rhs)
    for i=1,#rhs do
        table.insert(tbl, rhs[i])
    end
    return tbl
end
function table.map(tbl, f)
    local t = {}
    for k,v in pairs(tbl) do
        t[k] = f(v)
    end
    return t
end
function table.flat_map(tbl, f)
    local t = {}
    for k,v in pairs(tbl) do
        table.extend(t, f(v))
    end
    return t
end
function table.shuffle(tbl)
    for i = #tbl, 2, -1 do
        local j = math.random(i)
        tbl[i], tbl[j] = tbl[j], tbl[i]
    end
    return tbl
end
function table.dump(o)
   if type(o) == 'table' then
      local s = '{ '
      for k,v in pairs(o) do
         if type(k) ~= 'number' then k = '"'..k..'"' end
         s = s .. '['..k..'] = ' .. table.dump(v) .. ','
      end
      return s .. '} '
   else
      return tostring(o)
   end
end

-- Utility functions

-- https://stackoverflow.com/a/28921280
function urldecode(s)
    s = s:gsub('+', ' ')
       :gsub('%%(%x%x)', function(h)
                           return string.char(tonumber(h, 16))
                         end)
    return s
end
function parseurl(s)
    local url, query = s:match("(.+)%?(.+)")
    if url == nil then url = s end
    local ans = {}
    if query ~= nil then
        for k,v in query:gmatch('([^&=?]-)=([^&=?]+)' ) do
            ans[ k ] = urldecode(v)
        end
    end
    return url, ans
end