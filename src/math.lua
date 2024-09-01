-- Modified from: https://github.com/bjornbytes/maf

local vec3, quat

local forward
local vtmp1
local vtmp2
local qtmp1
local v2tmp1

vec3 = {
    __call = function(_, x, y, z)
        return setmetatable({ x = x or 0, y = y or 0, z = z or 0 }, vec3)
    end,

    __tostring = function(v)
        return string.format('(%f, %f, %f)', v.x, v.y, v.z)
    end,

    __add = function(v, u) return v:add(u, vec3()) end,
    __sub = function(v, u) return v:sub(u, vec3()) end,
    __mul = function(v, u)
        if vec3.isvec3(u) then return v:mul(u, vec3())
        elseif type(u) == 'number' then return v:scale(u, vec3())
        else error('vec3s can only be multiplied by vec3s and numbers') end
    end,
    __div = function(v, u)
        if vec3.isvec3(u) then return v:div(u, vec3())
        elseif type(u) == 'number' then return v:scale(1 / u, vec3())
        else error('vec3s can only be divided by vec3s and numbers') end
    end,
    __unm = function(v) return v:scale(-1) end,
    __len = function(v) return v:length() end,

    __index = {
        isvec3 = function(x)
            return getmetatable(x) == vec3
        end,

        clone = function(v)
            return vec3(v.x, v.y, v.z)
        end,

        unpack = function(v)
            return v.x, v.y, v.z
        end,

        set = function(v, x, y, z)
            if vec3.isvec3(x) then x, y, z = x.x, x.y, x.z end
            v.x = x
            v.y = y
            v.z = z
            return v
        end,

        add = function(v, u, out)
            out = out or v
            out.x = v.x + u.x
            out.y = v.y + u.y
            out.z = v.z + u.z
            return out
        end,

        sub = function(v, u, out)
            out = out or v
            out.x = v.x - u.x
            out.y = v.y - u.y
            out.z = v.z - u.z
            return out
        end,

        mul = function(v, u, out)
            out = out or v
            out.x = v.x * u.x
            out.y = v.y * u.y
            out.z = v.z * u.z
            return out
        end,

        div = function(v, u, out)
            out = out or v
            out.x = v.x / u.x
            out.y = v.y / u.y
            out.z = v.z / u.z
            return out
        end,

        scale = function(v, s, out)
            out = out or v
            out.x = v.x * s
            out.y = v.y * s
            out.z = v.z * s
            return out
        end,

        length = function(v)
            return math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
        end,

        normalize = function(v, out)
            out = out or v
            local len = v:length()
            return len == 0 and v or v:scale(1 / len, out)
        end,

        distance = function(v, u)
            return vec3.sub(v, u, vtmp1):length()
        end,

        angle = function(v, u)
            return math.acos(v:dot(u) / (v:length() + u:length()))
        end,

        dot = function(v, u)
            return v.x * u.x + v.y * u.y + v.z * u.z
        end,

        cross = function(v, u, out)
            out = out or v
            local a, b, c = v.x, v.y, v.z
            out.x = b * u.z - c * u.y
            out.y = c * u.x - a * u.z
            out.z = a * u.y - b * u.x
            return out
        end,

        lerp = function(v, u, t, out)
            out = out or v
            out.x = v.x + (u.x - v.x) * t
            out.y = v.y + (u.y - v.y) * t
            out.z = v.z + (u.z - v.z) * t
            return out
        end,

        project = function(v, u, out)
            out = out or v
            local unorm = vtmp1
            u:normalize(unorm)
            local dot = v:dot(unorm)
            out.x = unorm.x * dot
            out.y = unorm.y * dot
            out.z = unorm.z * dot
            return out
        end,

        rotate = function(v, q, out)
            out = out or v
            local u, c, o = vtmp1, vtmp2, out
            u.x, u.y, u.z = q.x, q.y, q.z
            o.x, o.y, o.z = v.x, v.y, v.z
            u:cross(v, c)
            local uu = u:dot(u)
            local uv = u:dot(v)
            o:scale(q.w * q.w - uu)
            u:scale(2 * uv)
            c:scale(2 * q.w)
            return o:add(u:add(c))
        end
    }
}

vec2 = {
    __call = function(_, x, y)
        return setmetatable({ x = x or 0, y = y or 0 }, vec2)
    end,

    __tostring = function(v)
        return string.format('(%f, %f)', v.x, v.y)
    end,

    __add = function(v, u) return v:add(u, vec2()) end,
    __sub = function(v, u) return v:sub(u, vec2()) end,
    __mul = function(v, u)
        if vec2.isvec2(u) then return v:mul(u, vec2())
        elseif type(u) == 'number' then return v:scale(u, vec2())
        else error('vec2s can only be multiplied by vec2s and numbers') end
    end,
    __div = function(v, u)
        if vec2.isvec2(u) then return v:div(u, vec2())
        elseif type(u) == 'number' then return v:scale(1 / u, vec2())
        else error('vec2s can only be divided by vec2s and numbers') end
    end,
    __unm = function(v) return v:scale(-1) end,
    __len = function(v) return v:length() end,

    __index = {
        isvec2 = function(x)
            return getmetatable(x) == vec2
        end,

        clone = function(v)
            return vec2(v.x, v.y)
        end,

        unpack = function(v)
            return v.x, v.y
        end,

        set = function(v, x, y)
            if vec2.isvec2(x) then x, y, z = x.x, x.y end
            v.x = x
            v.y = y
            return v
        end,

        add = function(v, u, out)
            out = out or v
            out.x = v.x + u.x
            out.y = v.y + u.y
            return out
        end,

        sub = function(v, u, out)
            out = out or v
            out.x = v.x - u.x
            out.y = v.y - u.y
            return out
        end,

        mul = function(v, u, out)
            out = out or v
            out.x = v.x * u.x
            out.y = v.y * u.y
            return out
        end,

        div = function(v, u, out)
            out = out or v
            out.x = v.x / u.x
            out.y = v.y / u.y
            return out
        end,

        scale = function(v, s, out)
            out = out or v
            out.x = v.x * s
            out.y = v.y * s
            return out
        end,

        length = function(v)
            return math.sqrt(v.x * v.x + v.y * v.y)
        end,

        normalize = function(v, out)
            out = out or v
            local len = v:length()
            return len == 0 and v or v:scale(1 / len, out)
        end,

        distance = function(v, u)
            return vec2.sub(v, u, v2tmp1):length()
        end,

        angle = function(v, u)
            return math.acos(v:dot(u) / (v:length() + u:length()))
        end,

        dot = function(v, u)
            return v.x * u.x + v.y * u.y
        end,

        -- cross = function(v, u, out)
        --     out = out or v
        --     local a, b, c = v.x, v.y, v.z
        --     out.x = b * u.z - c * u.y
        --     out.y = c * u.x - a * u.z
        --     out.z = a * u.y - b * u.x
        --     return out
        -- end,

        lerp = function(v, u, t, out)
            out = out or v
            out.x = v.x + (u.x - v.x) * t
            out.y = v.y + (u.y - v.y) * t
            return out
        end,

        project = function(v, u, out)
            out = out or v
            local unorm = v2tmp1
            u:normalize(unorm)
            local dot = v:dot(unorm)
            out.x = unorm.x * dot
            out.y = unorm.y * dot
            return out
        end,

        rotate = function(v, a, out)
            out = out or v
            out.x = math.cos(-a) * v.x - math.sin(-a) * v.y
            out.y = math.sin(-a) * v.x + math.cos(-a) * v.y
            return out
        end
    }
}

quat = {
    __call = function(_, x, y, z, w)
        return setmetatable({ x = x, y = y, z = z, w = w }, quat)
    end,

    __tostring = function(q)
        return string.format('(%f, %f, %f, %f)', q.x, q.y, q.z, q.w)
    end,

    __add = function(q, r) return q:add(r, quat()) end,
    __sub = function(q, r) return q:sub(r, quat()) end,
    __mul = function(q, r)
        if quat.isquat(r) then return q:mul(r, quat())
        elseif vec3.isvec3(r) then return r:rotate(q, vec3())
        else error('quats can only be multiplied by quats and vec3s') end
    end,
    __unm = function(q) return q:scale(-1) end,
    __len = function(q) return q:length() end,

    __index = {
        isquat = function(x)
            return getmetatable(x) == quat
        end,

        clone = function(q)
            return quat(q.x, q.y, q.z, q.w)
        end,

        unpack = function(q)
            return q.x, q.y, q.z, q.w
        end,

        set = function(q, x, y, z, w)
            if quat.isquat(x) then x, y, z, w = x.x, x.y, x.z, x.w end
            q.x = x
            q.y = y
            q.z = z
            q.w = w
            return q
        end,

        from_angle_axis = function(angle, x, y, z)
            return quat():set_angle_axis(angle, x, y, z)
        end,

        set_angle_axis = function(q, angle, x, y, z)
            if vec3.isvec3(x) then x, y, z = x.x, x.y, x.z end
            local s = math.sin(angle * .5)
            local c = math.cos(angle * .5)
            q.x = x * s
            q.y = y * s
            q.z = z * s
            q.w = c
            return q
        end,

        get_angle_axis = function(q)
            if q.w > 1 or q.w < -1 then q:normalize() end
            local s = math.sqrt(1 - q.w * q.w)
            s = s < .0001 and 1 or 1 / s
            return 2 * math.acos(q.w), vec3(q.x * s, q.y * s, q.z * s)
        end,

        between = function(u, v)
            return quat():set_between(u, v)
        end,

        set_between = function(q, u, v)
            local dot = u:dot(v)
            if dot > .99999 then
                q.x, q.y, q.z, q.w = 0, 0, 0, 1
                return q
            elseif dot < -.99999 then
                vtmp1.x, vtmp1.y, vtmp1.z = 1, 0, 0
                vtmp1:cross(u)
                if #vtmp1 < .00001 then
                    vtmp1.x, vtmp1.y, vtmp1.z = 0, 1, 0
                    vtmp1:cross(u)
                end
                vtmp1:normalize()
                return q:set_angle_axis(math.pi, vtmp1)
            end

            q.x, q.y, q.z = u.x, u.y, u.z
            vec3.cross(q, v)
            q.w = 1 + dot
            return q:normalize()
        end,

        from_direction = function(x, y, z)
            return quat():set_direction(x, y, z)
        end,

        set_direction = function(q, x, y, z)
            if vec3.isvec3(x) then x, y, z = x.x, x.y, x.z end
            vtmp2.x, vtmp2.y, vtmp2.z = x, y, z
            return q:set_between(forward, vtmp2)
        end,
        
        from_euler = function(x, y, z, order)
            return quat():set_euler(x, y, z, order)
        end,

        set_euler = function(q, x, y, z, order)
            -- https://github.com/mrdoob/three.js/blob/97b5d428d598228cae9b206d9a321f18d53a3e86/src/math/Quaternion.js#L201
            if vec3.isvec3(x) then x, y, z, order = x.x, x.y, x.z, y end
            order = order or 'XYZ'

            local c1 = math.cos(x/2)
            local c2 = math.cos(y/2)
            local c3 = math.cos(z/2)

            local s1 = math.sin(x/2)
            local s2 = math.sin(y/2)
            local s3 = math.sin(z/2)

            if order == "XYZ" then
                q.x = s1 * c2 * c3 + c1 * s2 * s3;
                q.y = c1 * s2 * c3 - s1 * c2 * s3;
                q.z = c1 * c2 * s3 + s1 * s2 * c3;
                q.w = c1 * c2 * c3 - s1 * s2 * s3;
            elseif order == 'YXZ' then
                q.x = s1 * c2 * c3 + c1 * s2 * s3;
                q.y = c1 * s2 * c3 - s1 * c2 * s3;
                q.z = c1 * c2 * s3 - s1 * s2 * c3;
                q.w = c1 * c2 * c3 + s1 * s2 * s3;
            elseif order == 'ZXY' then
                q.x = s1 * c2 * c3 - c1 * s2 * s3;
                q.y = c1 * s2 * c3 + s1 * c2 * s3;
                q.z = c1 * c2 * s3 + s1 * s2 * c3;
                q.w = c1 * c2 * c3 - s1 * s2 * s3;
            elseif order == 'ZYX' then
                q.x = s1 * c2 * c3 - c1 * s2 * s3;
                q.y = c1 * s2 * c3 + s1 * c2 * s3;
                q.z = c1 * c2 * s3 - s1 * s2 * c3;
                q.w = c1 * c2 * c3 + s1 * s2 * s3;
            elseif order == 'YZX' then
                q.x = s1 * c2 * c3 + c1 * s2 * s3;
                q.y = c1 * s2 * c3 + s1 * c2 * s3;
                q.z = c1 * c2 * s3 - s1 * s2 * c3;
                q.w = c1 * c2 * c3 - s1 * s2 * s3;
            elseif order == 'XZY' then
                q.x = s1 * c2 * c3 - c1 * s2 * s3;
                q.y = c1 * s2 * c3 - s1 * c2 * s3;
                q.z = c1 * c2 * s3 + s1 * s2 * c3;
                q.w = c1 * c2 * c3 + s1 * s2 * s3;
            else
                -- Do nothing
            end

            return q
        end,

        get_euler = function(q, order)
            order = order or 'XYZ'
            q:normalize()

            local axis1 = order:sub(1, 1)
            local axis2 = order:sub(2, 2)
            local axis3 = order:sub(3, 3)

            local a1, a2, a3 = 0, 0, 0
            
            if axis1 == 'X' then
                a1 = math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y))
            elseif axis1 == 'Y' then
                a1 = math.atan2(2 * (q.w * q.y + q.z * q.x), 1 - 2 * (q.y * q.y + q.z * q.z))
            elseif axis1 == 'Z' then
                a1 = math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.z * q.z + q.x * q.x))
            end
            
            if axis2 == 'X' then
                local sinp = 2 * (q.w * q.x - q.y * q.z)
                a2 = math.abs(sinp) >= 1 and (math.pi / 2) * (sinp / math.abs(sinp)) or math.asin(sinp)
            elseif axis2 == 'Y' then
                local sinp = 2 * (q.w * q.y - q.z * q.x)
                a2 = math.abs(sinp) >= 1 and (math.pi / 2) * (sinp / math.abs(sinp)) or math.asin(sinp)
            elseif axis2 == 'Z' then
                local sinp = 2 * (q.w * q.z - q.x * q.y)
                a2 = math.abs(sinp) >= 1 and (math.pi / 2) * (sinp / math.abs(sinp)) or math.asin(sinp)
            end

            if axis3 == 'X' then
                a3 = math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.z * q.z))
            elseif axis3 == 'Y' then
                a3 = math.atan2(2 * (q.w * q.y + q.z * q.x), 1 - 2 * (q.y * q.y + q.x * q.x))
            elseif axis3 == 'Z' then
                a3 = math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.z * q.z + q.y * q.y))
            end
            
            return vec3(a1, a2, a3)
        end,

        add = function(q, r, out)
            out = out or q
            out.x = q.x + r.x
            out.y = q.y + r.y
            out.z = q.z + r.z
            out.w = q.w + r.w
            return out
        end,

        sub = function(q, r, out)
            out = out or q
            out.x = q.x - r.x
            out.y = q.y - r.y
            out.z = q.z - r.z
            out.w = q.w - r.w
            return out
        end,

        mul = function(q, r, out)
            out = out or q
            local qx, qy, qz, qw = q:unpack()
            local rx, ry, rz, rw = r:unpack()
            out.x = qx * rw + qw * rx + qy * rz - qz * ry
            out.y = qy * rw + qw * ry + qz * rx - qx * rz
            out.z = qz * rw + qw * rz + qx * ry - qy * rx
            out.w = qw * rw - qx * rx - qy * ry - qz * rz
            return out
        end,

        scale = function(q, s, out)
            out = out or q
            out.x = q.x * s
            out.y = q.y * s
            out.z = q.z * s
            out.w = q.w * s
            return out
        end,

        length = function(q)
            return math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w)
        end,

        normalize = function(q, out)
            out = out or q
            local len = q:length()
            return len == 0 and q or q:scale(1 / len, out)
        end,

        lerp = function(q, r, t, out)
            out = out or q
            r:scale(t, qtmp1)
            q:scale(1 - t, out)
            return out:add(qtmp1)
        end,

        slerp = function(q, r, t, out)
            out = out or q

            local dot = q.x * r.x + q.y * r.y + q.z * r.z + q.w * r.w
            if dot < 0 then
                dot = -dot
                r:scale(-1)
            end

            if 1 - dot < .0001 then
                return q:lerp(r, t, out)
            end

            local theta = math.acos(dot)
            q:scale(math.sin((1 - t) * theta), out)
            r:scale(math.sin(t * theta), qtmp1)
            return out:add(qtmp1):scale(1 / math.sin(theta))
        end
    }
}

setmetatable(vec3, vec3)
setmetatable(vec2, vec2)
setmetatable(quat, quat)

forward = vec3(0, 0, -1)
vtmp1 = vec3()
vtmp2 = vec3()
qtmp1 = quat()

return {
    vec3 = vec3,
    vec2 = vec2,
    quat = quat,
}