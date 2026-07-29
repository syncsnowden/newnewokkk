--[[
  24-hour HWID-locked Key Checker (Luau / Roblox)
  ------------------------------------------------
  1. Prompts the user for a key
  2. Collects the device HWID (client-side only)
  3. Sends key + HWID to the backend validation endpoint
  4. Continues only if the server returns valid

  IMPORTANT:
  - Replace BACKEND_URL with your deployed API URL
  - Never put the Pastefy API key in this script
  - All validation is server-side
]]

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local RbxAnalyticsService = game:GetService("RbxAnalyticsService")

-- ======================== CONFIG ========================
local BACKEND_URL = "https://YOUR-APP.vercel.app"   -- change to your public API
local VALIDATE_PATH = "/api/validate"
local REQUEST_TIMEOUT = 12
-- ========================================================

local LocalPlayer = Players.LocalPlayer

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
local function getHWID(): string
    -- Primary method used by most Roblox executors / clients
    local ok, id = pcall(function()
        return RbxAnalyticsService:GetClientId()
    end)
    if ok and typeof(id) == "string" and #id > 0 then
        return id
    end

    -- Fallbacks (some environments restrict AnalyticsService)
    ok, id = pcall(function()
        return game:GetService("HttpService"):GenerateGUID(false)
    end)
    if ok and typeof(id) == "string" then
        return id
    end

    -- Last resort – still unique per machine in most cases
    return tostring(LocalPlayer.UserId) .. "-" .. tostring(os.time())
end

local function httpPost(url: string, body: table): (boolean, any)
    local json = HttpService:JSONEncode(body)
    local success, response = pcall(function()
        -- request is provided by most executors (Synapse, Fluxus, etc.)
        -- If you are inside a normal LocalScript with HttpEnabled, use
        -- HttpService:RequestAsync instead (see alternative below).
        if syn and syn.request then
            return syn.request({
                Url = url,
                Method = "POST",
                Headers = { ["Content-Type"] = "application/json" },
                Body = json,
            })
        elseif http and http.request then
            return http.request({
                Url = url,
                Method = "POST",
                Headers = { ["Content-Type"] = "application/json" },
                Body = json,
            })
        elseif request then
            return request({
                Url = url,
                Method = "POST",
                Headers = { ["Content-Type"] = "application/json" },
                Body = json,
            })
        else
            -- Pure Roblox (requires HttpService.HttpEnabled = true on server,
            -- and this must run from a context that can call RequestAsync)
            return HttpService:RequestAsync({
                Url = url,
                Method = "POST",
                Headers = { ["Content-Type"] = "application/json" },
                Body = json,
            })
        end
    end)

    if not success then
        return false, tostring(response)
    end

    local status = response.StatusCode or response.Status or 0
    local bodyText = response.Body or response.body or ""

    if status < 200 or status >= 300 then
        return false, "HTTP " .. tostring(status) .. ": " .. bodyText
    end

    local decodeOk, data = pcall(function()
        return HttpService:JSONDecode(bodyText)
    end)
    if not decodeOk then
        return false, "Invalid JSON response"
    end
    return true, data
end

local function notify(title: string, text: string)
    pcall(function()
        game:GetService("StarterGui"):SetCore("SendNotification", {
            Title = title,
            Text = text,
            Duration = 5,
        })
    end)
    print(string.format("[%s] %s", title, text))
end

-- ---------------------------------------------------------------------------
-- Main flow
-- ---------------------------------------------------------------------------
local function validateKey(key: string): boolean
    key = string.gsub(key, "%s+", "")
    if #key ~= 12 then
        notify("Key System", "Key must be exactly 12 characters")
        return false
    end

    local hwid = getHWID()
    notify("Key System", "Validating key…")

    local ok, result = httpPost(BACKEND_URL .. VALIDATE_PATH, {
        key = key,
        hwid = hwid,
    })

    if not ok then
        notify("Key System", "Connection failed: " .. tostring(result))
        return false
    end

    if result.valid == true then
        notify("Key System", result.message or "Key verified")
        return true
    end

    local status = result.status or "invalid"
    if status == "expired" then
        notify("Key System", "This key has expired")
    elseif status == "hwid_mismatch" then
        notify("Key System", "HWID mismatch – key is locked to another device")
    else
        notify("Key System", result.message or "Invalid key")
    end
    return false
end

-- Simple input prompt (works in most executors)
local function promptForKey(): string?
    if typeof(Drawing) == "table" then
        -- Advanced UI left as exercise; fall through to inputbox
    end

    -- Many executors provide a built-in input box
    if typeof(getgenv) == "function" and getgenv().InputBox then
        return getgenv().InputBox("Enter your 12-character key")
    end

    -- Fallback: use a ScreenGui TextBox
    local playerGui = LocalPlayer:WaitForChild("PlayerGui")
    local gui = Instance.new("ScreenGui")
    gui.Name = "KeyPrompt"
    gui.ResetOnSpawn = false
    gui.Parent = playerGui

    local frame = Instance.new("Frame")
    frame.Size = UDim2.fromOffset(320, 140)
    frame.Position = UDim2.fromScale(0.5, 0.4)
    frame.AnchorPoint = Vector2.new(0.5, 0.5)
    frame.BackgroundColor3 = Color3.fromRGB(18, 21, 28)
    frame.BorderSizePixel = 0
    frame.Parent = gui

    local corner = Instance.new("UICorner")
    corner.CornerRadius = UDim.new(0, 12)
    corner.Parent = frame

    local title = Instance.new("TextLabel")
    title.Size = UDim2.new(1, -20, 0, 28)
    title.Position = UDim2.fromOffset(10, 12)
    title.BackgroundTransparency = 1
    title.Text = "Enter Key"
    title.TextColor3 = Color3.fromRGB(232, 236, 244)
    title.Font = Enum.Font.GothamBold
    title.TextSize = 18
    title.Parent = frame

    local box = Instance.new("TextBox")
    box.Size = UDim2.new(1, -24, 0, 36)
    box.Position = UDim2.fromOffset(12, 50)
    box.BackgroundColor3 = Color3.fromRGB(13, 16, 23)
    box.TextColor3 = Color3.fromRGB(0, 214, 143)
    box.PlaceholderText = "A92LmQ7xP81Z"
    box.Font = Enum.Font.Code
    box.TextSize = 16
    box.Text = ""
    box.ClearTextOnFocus = false
    box.Parent = frame

    local boxCorner = Instance.new("UICorner")
    boxCorner.CornerRadius = UDim.new(0, 8)
    boxCorner.Parent = box

    local submit = Instance.new("TextButton")
    submit.Size = UDim2.new(1, -24, 0, 32)
    submit.Position = UDim2.fromOffset(12, 96)
    submit.BackgroundColor3 = Color3.fromRGB(108, 92, 231)
    submit.Text = "Submit"
    submit.TextColor3 = Color3.new(1, 1, 1)
    submit.Font = Enum.Font.GothamBold
    submit.TextSize = 14
    submit.Parent = frame

    local submitCorner = Instance.new("UICorner")
    submitCorner.CornerRadius = UDim.new(0, 8)
    submitCorner.Parent = submit

    local resultKey: string? = nil
    local done = Instance.new("BindableEvent")

    submit.MouseButton1Click:Connect(function()
        resultKey = box.Text
        done:Fire()
    end)

    box.FocusLost:Connect(function(enter)
        if enter then
            resultKey = box.Text
            done:Fire()
        end
    end)

    done.Event:Wait()
    gui:Destroy()
    return resultKey
end

-- ---------------------------------------------------------------------------
-- Entry point – call this from your script
-- ---------------------------------------------------------------------------
local function runKeySystem(): boolean
    local key = promptForKey()
    if not key or key == "" then
        notify("Key System", "No key entered")
        return false
    end
    return validateKey(key)
end

-- Auto-run when the script is executed
local success = runKeySystem()
if success then
    print("[Key System] Access granted – continuing script…")
    -- ============================================================
    -- PUT THE REST OF YOUR SCRIPT BELOW THIS LINE
    -- ============================================================

    -- Example:
    -- loadstring(game:HttpGet("https://example.com/your-script.lua"))()

else
    warn("[Key System] Access denied")
    -- Optionally kick or destroy the script
    -- LocalPlayer:Kick("Invalid or expired key")
end

return {
    validate = validateKey,
    run = runKeySystem,
    getHWID = getHWID,
}