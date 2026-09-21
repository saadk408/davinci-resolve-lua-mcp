---@meta _
-- Definition file for lua-language-server (LuaLS). Not loaded at runtime.
--
-- Declares the globals that DaVinci Resolve's Scripts-menu Lua host injects, so
-- the LSP can type-check bridge code instead of flagging every host call as an
-- undefined global. Sources:
--   * `bmd`: the 28 keys measured in the free 21.1 menu host on this Mac on
--     2026-09-20 (docs/diagnostic-2026-09.md "bmd keys"). Signatures are given
--     only where Step 1 measured them; the rest are `fun(...): any`.
--   * `Resolve`: method signatures quoted from Blackmagic's
--     `Developer/Scripting/DaVinciResolveScript.pyi` (31 Aug 2026), class
--     `Resolve`, line 1256, plus the 234 `resolve.*` constants named in the
--     TypeAlias docstrings at lines 11 to 82 (every alias is `float`, so every
--     constant is `number`). Python `list[str]` is a Resolve "list" (1-indexed,
--     carries `__flags`), typed here as `string[]`.
--   * `Fusion`: the ten methods that Step 1 saw on the `fusion` object. Only the
--     prefs channel and `MapPath` have measured signatures.
--   * The other API classes are open placeholders (any method is accepted)
--     until Step 2 generates them from the `.pyi`.
-- Rules: keep `bmd` closed (a typo must be a warning); never silence a host
-- global with `diagnostics.globals` in `.luarc.json`; declare it here instead.

---------------------------------------------------------------------------
-- bmd: the host's utility table (Fusion 21.1 in-process, LuaJIT 2.1)
---------------------------------------------------------------------------

---@class bmd
---@field _VERSION string                                 -- "21.1" measured
---@field wait fun(seconds: number)                       -- sleeps (does not spin)
---@field gettime fun(): number                           -- float seconds, monotonic-style
---@field fileexists fun(path: string): boolean           -- ~2 us per call
---@field direxists fun(path: string): boolean
---@field getpid fun(): integer                           -- Resolve's own pid (in-process host)
---@field getcurrentdir fun(): string
---@field createuuid fun(): string
---@field scriptapp fun(name: string, ...): any           -- returns a proxy, not == the `resolve` global
---@field readstring fun(s: string): any                  -- Lua-table deserialiser, not file I/O
---@field writestring fun(v: any): string                 -- Lua-table serialiser, not file I/O
---@field fullpath fun(...): any
---@field getappname fun(...): any
---@field getappuuid fun(...): any
---@field getstateindex fun(...): any
---@field getuptime fun(...): any
---@field getusing fun(...): any
---@field isquotable fun(...): any
---@field isvalidname fun(...): any
---@field nextstate fun(...): any
---@field noise fun(...): any
---@field settrcontext fun(...): any
---@field stripname fun(...): any
---@field tounc fun(...): any
---@field touserdata fun(...): any
---@field translate fun(...): any
---@field UIDispatcher fun(...): any                      -- UIManager is nil in this host; unusable
---@field using fun(...): any
bmd = {}

---------------------------------------------------------------------------
-- Resolve API objects other than Resolve itself: open placeholders.
-- Every field is accepted until Step 2 generates real classes from the .pyi.
---------------------------------------------------------------------------

---@class ProjectManager
---@field [string] fun(...): any

---@class MediaStorage
---@field [string] fun(...): any

---@class Project
---@field [string] fun(...): any

---@class Timeline
---@field [string] fun(...): any

---@class MediaPool
---@field [string] fun(...): any

---@class Gallery
---@field [string] fun(...): any

---------------------------------------------------------------------------
-- resolve: the live Resolve object (userdata). Methods quoted from the .pyi.
---------------------------------------------------------------------------

---@class Resolve
---@field KEYFRAME_MODE_ALL number  -- KeyframeMode
---@field KEYFRAME_MODE_COLOR number  -- KeyframeMode
---@field KEYFRAME_MODE_SIZING number  -- KeyframeMode
---@field CLOUD_SETTING_PROJECT_NAME number  -- CloudSettingKey
---@field CLOUD_SETTING_PROJECT_MEDIA_PATH number  -- CloudSettingKey
---@field CLOUD_SETTING_IS_COLLAB number  -- CloudSettingKey
---@field CLOUD_SETTING_SYNC_MODE number  -- CloudSettingKey
---@field CLOUD_SETTING_IS_CAMERA_ACCESS number  -- CloudSettingKey
---@field CLOUD_SYNC_NONE number  -- CloudSyncMode
---@field CLOUD_SYNC_PROXY_ONLY number  -- CloudSyncMode
---@field CLOUD_SYNC_PROXY_AND_ORIG number  -- CloudSyncMode
---@field AUDIO_SYNC_MODE number  -- AudioSyncSettingKey
---@field AUDIO_SYNC_CHANNEL_NUMBER number  -- AudioSyncSettingKey
---@field AUDIO_SYNC_RETAIN_EMBEDDED_AUDIO number  -- AudioSyncSettingKey
---@field AUDIO_SYNC_RETAIN_VIDEO_METADATA number  -- AudioSyncSettingKey
---@field AUDIO_SYNC_WAVEFORM number  -- AudioSyncMode
---@field AUDIO_SYNC_TIMECODE number  -- AudioSyncMode
---@field AUDIO_SYNC_IN number  -- AudioSyncMode
---@field AUDIO_SYNC_OUT number  -- AudioSyncMode
---@field AUDIO_SYNC_MARKER number  -- AudioSyncMode
---@field AUDIO_SYNC_CHANNEL_AUTOMATIC number  -- AudioSyncChannel
---@field AUDIO_SYNC_CHANNEL_MIX number  -- AudioSyncChannel
---@field MULTICAM_ANGLE_SYNC_IN number  -- MulticamAngleSyncMode
---@field MULTICAM_ANGLE_SYNC_OUT number  -- MulticamAngleSyncMode
---@field MULTICAM_ANGLE_SYNC_TIMECODE number  -- MulticamAngleSyncMode
---@field MULTICAM_ANGLE_SYNC_AUDIO number  -- MulticamAngleSyncMode
---@field MULTICAM_ANGLE_SYNC_MARKER number  -- MulticamAngleSyncMode
---@field MULTICAM_ANGLE_NAME_SEQUENTIAL number  -- MulticamAngleNameMode
---@field MULTICAM_ANGLE_NAME_ANGLE number  -- MulticamAngleNameMode
---@field MULTICAM_ANGLE_NAME_CAMERA number  -- MulticamAngleNameMode
---@field MULTICAM_ANGLE_NAME_CLIP number  -- MulticamAngleNameMode
---@field MULTICAM_ANGLE_NAME_FILE number  -- MulticamAngleNameMode
---@field MULTICAM_DETECT_BY_CAMERA_NUMBER number  -- MulticamDetectMode
---@field MULTICAM_DETECT_BY_ANGLE number  -- MulticamDetectMode
---@field MULTICAM_DETECT_BY_REEL_NUMBER number  -- MulticamDetectMode
---@field MULTICAM_DETECT_BY_REEL_NAME number  -- MulticamDetectMode
---@field MULTICAM_DETECT_BY_ROLL_CARD number  -- MulticamDetectMode
---@field MULTICAM_DETECT_NONE number  -- MulticamDetectMode
---@field MULTICAM_AUDIO_ADAPTIVE number  -- MulticamAudioMode
---@field MULTICAM_AUDIO_SOURCE number  -- MulticamAudioMode
---@field MULTICAM_AUDIO_REFERENCE number  -- MulticamAudioMode
---@field MULTICAM_AUDIO_ALL number  -- MulticamAudioMode
---@field CLOUD_SYNC_DEFAULT number  -- CloudSyncStatus
---@field CLOUD_SYNC_DOWNLOAD_IN_QUEUE number  -- CloudSyncStatus
---@field CLOUD_SYNC_DOWNLOAD_IN_PROGRESS number  -- CloudSyncStatus
---@field CLOUD_SYNC_DOWNLOAD_SUCCESS number  -- CloudSyncStatus
---@field CLOUD_SYNC_DOWNLOAD_FAIL number  -- CloudSyncStatus
---@field CLOUD_SYNC_DOWNLOAD_NOT_FOUND number  -- CloudSyncStatus
---@field CLOUD_SYNC_UPLOAD_IN_QUEUE number  -- CloudSyncStatus
---@field CLOUD_SYNC_UPLOAD_IN_PROGRESS number  -- CloudSyncStatus
---@field CLOUD_SYNC_UPLOAD_SUCCESS number  -- CloudSyncStatus
---@field CLOUD_SYNC_UPLOAD_FAIL number  -- CloudSyncStatus
---@field CLOUD_SYNC_UPLOAD_NOT_FOUND number  -- CloudSyncStatus
---@field CLOUD_SYNC_SUCCESS number  -- CloudSyncStatus
---@field MARKER_NONE number  -- SlateMarkerColor
---@field MARKER_BLUE number  -- SlateMarkerColor
---@field MARKER_CYAN number  -- SlateMarkerColor
---@field MARKER_GREEN number  -- SlateMarkerColor
---@field MARKER_YELLOW number  -- SlateMarkerColor
---@field MARKER_RED number  -- SlateMarkerColor
---@field MARKER_PINK number  -- SlateMarkerColor
---@field MARKER_PURPLE number  -- SlateMarkerColor
---@field MARKER_FUCHSIA number  -- SlateMarkerColor
---@field MARKER_ROSE number  -- SlateMarkerColor
---@field MARKER_LAVENDER number  -- SlateMarkerColor
---@field MARKER_SKY number  -- SlateMarkerColor
---@field MARKER_MINT number  -- SlateMarkerColor
---@field MARKER_LEMON number  -- SlateMarkerColor
---@field MARKER_SAND number  -- SlateMarkerColor
---@field MARKER_COCOA number  -- SlateMarkerColor
---@field MARKER_CREAM number  -- SlateMarkerColor
---@field NORMALIZE_AUDIO_SET_LEVEL_RELATIVE number  -- NormalizeAudioSetLevelMode
---@field NORMALIZE_AUDIO_SET_LEVEL_INDEPENDENT number  -- NormalizeAudioSetLevelMode
---@field AUTO_ALIGN_CLIPS_USING_WAVEFORM number  -- AutoAlignSyncUsing
---@field AUTO_ALIGN_CLIPS_USING_TIMECODE number  -- AutoAlignSyncUsing
---@field AUTO_ALIGN_CLIPS_WAVEFORM_TRACK_MIX number  -- AutoAlignUseTrack
---@field AUTO_ALIGN_CLIPS_WAVEFORM_TRACK_AUTOMATIC number  -- AutoAlignUseTrack
---@field EXPORT_AAF number  -- TimelineExportType
---@field EXPORT_DRT number  -- TimelineExportType
---@field EXPORT_EDL number  -- TimelineExportType
---@field EXPORT_FCP_7_XML number  -- TimelineExportType
---@field EXPORT_FCPXML_1_8 number  -- TimelineExportType
---@field EXPORT_FCPXML_1_9 number  -- TimelineExportType
---@field EXPORT_FCPXML_1_10 number  -- TimelineExportType
---@field EXPORT_HDR_10_PROFILE_A number  -- TimelineExportType
---@field EXPORT_HDR_10_PROFILE_B number  -- TimelineExportType
---@field EXPORT_TEXT_CSV number  -- TimelineExportType
---@field EXPORT_TEXT_TAB number  -- TimelineExportType
---@field EXPORT_DOLBY_VISION_VER_2_9 number  -- TimelineExportType
---@field EXPORT_DOLBY_VISION_VER_4_0 number  -- TimelineExportType
---@field EXPORT_DOLBY_VISION_VER_5_1 number  -- TimelineExportType
---@field EXPORT_OTIO number  -- TimelineExportType
---@field EXPORT_ALE number  -- TimelineExportType
---@field EXPORT_ALE_CDL number  -- TimelineExportType
---@field EXPORT_NONE number  -- TimelineExportSubtype
---@field EXPORT_AAF_NEW number  -- TimelineExportSubtype
---@field EXPORT_AAF_EXISTING number  -- TimelineExportSubtype
---@field EXPORT_CDL number  -- TimelineExportSubtype
---@field EXPORT_SDL number  -- TimelineExportSubtype
---@field EXPORT_MISSING_CLIPS number  -- TimelineExportSubtype
---@field SUBTITLE_LANGUAGE number  -- SubtitleSettingKey
---@field SUBTITLE_CAPTION_PRESET number  -- SubtitleSettingKey
---@field SUBTITLE_CHARS_PER_LINE number  -- SubtitleSettingKey
---@field SUBTITLE_LINE_BREAK number  -- SubtitleSettingKey
---@field SUBTITLE_GAP number  -- SubtitleSettingKey
---@field AUTO_CAPTION_AUTO number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_MANDARIN_SIMPLIFIED number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_DUTCH number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_ENGLISH number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_FINNISH number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_FRENCH number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_GERMAN number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_HINDI number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_INDONESIAN number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_ITALIAN number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_JAPANESE number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_KOREAN number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_MALAY number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_NORWEGIAN number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_POLISH number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_PORTUGUESE number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_ROMANIAN number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_RUSSIAN number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_SPANISH number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_SWEDISH number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_TURKISH number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_VIETNAMESE number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_TAMIL number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_THAI number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_DANISH number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_MANDARIN_TRADITIONAL number  -- AutoCaptionLanguage
---@field AUTO_CAPTION_SUBTITLE_DEFAULT number  -- AutoCaptionPreset
---@field AUTO_CAPTION_TELETEXT number  -- AutoCaptionPreset
---@field AUTO_CAPTION_NETFLIX number  -- AutoCaptionPreset
---@field AUTO_CAPTION_LINE_SINGLE number  -- AutoCaptionLineBreak
---@field AUTO_CAPTION_LINE_DOUBLE number  -- AutoCaptionLineBreak
---@field DLB_BLEND_SHOTS number  -- DolbyVisionAnalysisType
---@field DYNAMIC_ZOOM_EASE_LINEAR number  -- DynamicZoomEase
---@field DYNAMIC_ZOOM_EASE_IN number  -- DynamicZoomEase
---@field DYNAMIC_ZOOM_EASE_OUT number  -- DynamicZoomEase
---@field DYNAMIC_ZOOM_EASE_IN_AND_OUT number  -- DynamicZoomEase
---@field COMPOSITE_NORMAL number  -- CompositeMode
---@field COMPOSITE_ADD number  -- CompositeMode
---@field COMPOSITE_SUBTRACT number  -- CompositeMode
---@field COMPOSITE_DIFF number  -- CompositeMode
---@field COMPOSITE_MULTIPLY number  -- CompositeMode
---@field COMPOSITE_SCREEN number  -- CompositeMode
---@field COMPOSITE_OVERLAY number  -- CompositeMode
---@field COMPOSITE_HARDLIGHT number  -- CompositeMode
---@field COMPOSITE_SOFTLIGHT number  -- CompositeMode
---@field COMPOSITE_DARKEN number  -- CompositeMode
---@field COMPOSITE_LIGHTEN number  -- CompositeMode
---@field COMPOSITE_COLOR_DODGE number  -- CompositeMode
---@field COMPOSITE_COLOR_BURN number  -- CompositeMode
---@field COMPOSITE_EXCLUSION number  -- CompositeMode
---@field COMPOSITE_HUE number  -- CompositeMode
---@field COMPOSITE_SATURATE number  -- CompositeMode
---@field COMPOSITE_COLORIZE number  -- CompositeMode
---@field COMPOSITE_LUMA_MASK number  -- CompositeMode
---@field COMPOSITE_DIVIDE number  -- CompositeMode
---@field COMPOSITE_LINEAR_DODGE number  -- CompositeMode
---@field COMPOSITE_LINEAR_BURN number  -- CompositeMode
---@field COMPOSITE_LINEAR_LIGHT number  -- CompositeMode
---@field COMPOSITE_VIVID_LIGHT number  -- CompositeMode
---@field COMPOSITE_PIN_LIGHT number  -- CompositeMode
---@field COMPOSITE_HARD_MIX number  -- CompositeMode
---@field COMPOSITE_LIGHTER_COLOR number  -- CompositeMode
---@field COMPOSITE_DARKER_COLOR number  -- CompositeMode
---@field COMPOSITE_FOREGROUND number  -- CompositeMode
---@field COMPOSITE_ALPHA number  -- CompositeMode
---@field COMPOSITE_INVERTED_ALPHA number  -- CompositeMode
---@field COMPOSITE_LUM number  -- CompositeMode
---@field COMPOSITE_INVERTED_LUM number  -- CompositeMode
---@field RETIME_USE_PROJECT number  -- RetimeProcess
---@field RETIME_NEAREST number  -- RetimeProcess
---@field RETIME_FRAME_BLEND number  -- RetimeProcess
---@field RETIME_OPTICAL_FLOW number  -- RetimeProcess
---@field MOTION_EST_USE_PROJECT number  -- MotionEstimation
---@field MOTION_EST_STANDARD_FASTER number  -- MotionEstimation
---@field MOTION_EST_STANDARD_BETTER number  -- MotionEstimation
---@field MOTION_EST_ENHANCED_FASTER number  -- MotionEstimation
---@field MOTION_EST_ENHANCED_BETTER number  -- MotionEstimation
---@field MOTION_EST_SPEED_WARP_FASTER number  -- MotionEstimation
---@field MOTION_EST_SPEED_WARP_BETTER number  -- MotionEstimation
---@field MOTION_EST_METAL number  -- MotionEstimation
---@field SCALE_USE_PROJECT number  -- Scaling
---@field SCALE_CROP number  -- Scaling
---@field SCALE_FIT number  -- Scaling
---@field SCALE_FILL number  -- Scaling
---@field SCALE_STRETCH number  -- Scaling
---@field RESIZE_FILTER_USE_PROJECT number  -- ResizeFilter
---@field RESIZE_FILTER_SHARPER number  -- ResizeFilter
---@field RESIZE_FILTER_SMOOTHER number  -- ResizeFilter
---@field RESIZE_FILTER_BICUBIC number  -- ResizeFilter
---@field RESIZE_FILTER_BILINEAR number  -- ResizeFilter
---@field RESIZE_FILTER_BESSEL number  -- ResizeFilter
---@field RESIZE_FILTER_BOX number  -- ResizeFilter
---@field RESIZE_FILTER_CATMULL_ROM number  -- ResizeFilter
---@field RESIZE_FILTER_CUBIC number  -- ResizeFilter
---@field RESIZE_FILTER_GAUSSIAN number  -- ResizeFilter
---@field RESIZE_FILTER_LANCZOS number  -- ResizeFilter
---@field RESIZE_FILTER_MITCHELL number  -- ResizeFilter
---@field RESIZE_FILTER_NEAREST_NEIGHBOR number  -- ResizeFilter
---@field RESIZE_FILTER_QUADRATIC number  -- ResizeFilter
---@field RESIZE_FILTER_SINC number  -- ResizeFilter
---@field RESIZE_FILTER_LINEAR number  -- ResizeFilter
---@field CACHE_AUTO_ENABLED number  -- CacheMode
---@field CACHE_DISABLED number  -- CacheMode
---@field CACHE_ENABLED number  -- CacheMode
---@field DIALOGUE_LEVELER_MODE_ALLOW_WIDER_DYNAMICS number  -- DialogueLevelerMode
---@field DIALOGUE_LEVELER_MODE_OPTIMIZE_MODERATE_LEVELS number  -- DialogueLevelerMode
---@field DIALOGUE_LEVELER_MODE_MORE_LIFT_FOR_LOW_LEVELS number  -- DialogueLevelerMode
---@field DIALOGUE_LEVELER_MODE_LIFT_SOFT_WHISPERY_SOURCES number  -- DialogueLevelerMode
---@field FLATTEN_MULTICAM_COPY_GRADE number  -- FlattenMulticamGrade
---@field FLATTEN_MULTICAM_RETAIN_GRADE_FROM_ANGLE number  -- FlattenMulticamGrade
---@field EXPORT_LUT_17PTCUBE number  -- ExportLutType
---@field EXPORT_LUT_33PTCUBE number  -- ExportLutType
---@field EXPORT_LUT_65PTCUBE number  -- ExportLutType
---@field EXPORT_LUT_PANASONICVLUT number  -- ExportLutType
---@field SMART_SWITCH_QUALITY_FASTER number  -- SmartSwitchQuality
---@field SMART_SWITCH_QUALITY_BETTER number  -- SmartSwitchQuality
---@field SMART_SWITCH_WIDE_ANGLE_FREQ_LOW number  -- SmartSwitchWideAngleFrequency
---@field SMART_SWITCH_WIDE_ANGLE_FREQ_MEDIUM number  -- SmartSwitchWideAngleFrequency
---@field SMART_SWITCH_WIDE_ANGLE_FREQ_HIGH number  -- SmartSwitchWideAngleFrequency
---@field SMART_SWITCH_ANALYSIS_MODE_NONE number  -- SmartSwitchAnalysisMode
---@field SMART_SWITCH_ANALYSIS_MODE_DETECT_WIDE_ANGLE number  -- SmartSwitchAnalysisMode
---@field SMART_SWITCH_ANALYSIS_MODE_AUDIO_ONLY number  -- SmartSwitchAnalysisMode
---@field CLONE_CHECKSUM_TYPE_NONE number  -- CloneChecksumType
---@field CLONE_CHECKSUM_TYPE_FILESIZE number  -- CloneChecksumType
---@field CLONE_CHECKSUM_TYPE_CRC32 number  -- CloneChecksumType
---@field CLONE_CHECKSUM_TYPE_MD5 number  -- CloneChecksumType
---@field CLONE_CHECKSUM_TYPE_SHA256 number  -- CloneChecksumType
---@field CLONE_CHECKSUM_TYPE_SHA512 number  -- CloneChecksumType
---@field CLONE_CHECKSUM_TYPE_XXH_64 number  -- CloneChecksumType
resolve = {}

---@return ProjectManager
function resolve:GetProjectManager() end

---@return MediaStorage
function resolve:GetMediaStorage() end

---@return Fusion
function resolve:Fusion() end

---@return Project
function resolve:GetCurrentProject() end

---@return Timeline
function resolve:GetCurrentTimeline() end

---@return MediaPool
function resolve:GetMediaPool() end

---@return Gallery
function resolve:GetGallery() end

---@param pageName string  # lowercase: media, cut, edit, fusion, color, fairlight, deliver
---@return boolean
function resolve:OpenPage(pageName) end

---@return string
function resolve:GetCurrentPage() end

---@param highPriority boolean
---@return boolean
function resolve:SetHighPriority(highPriority) end

---@return (integer|string)[]
function resolve:GetVersion() end

---@return string
function resolve:GetVersionString() end

---@return string
function resolve:GetProductName() end

---@return boolean
function resolve:IsStudio() end

---@return string[]
function resolve:GetLayoutPresetList() end

---@param presetName string
---@return boolean
function resolve:LoadLayoutPreset(presetName) end

---@param presetName string
---@return boolean
function resolve:UpdateLayoutPreset(presetName) end

---@param presetName string
---@param presetFilePath string
---@return boolean
function resolve:ExportLayoutPreset(presetName, presetFilePath) end

---@param presetName string
---@return boolean
function resolve:DeleteLayoutPreset(presetName) end

---@param presetName string
---@return boolean
function resolve:SaveLayoutPreset(presetName) end

---@param presetFilePath string
---@param presetName? string
---@return boolean
function resolve:ImportLayoutPreset(presetFilePath, presetName) end

---@return boolean
function resolve:Quit() end

---@param presetPath string
---@return boolean
function resolve:ImportRenderPreset(presetPath) end

---@param presetName string
---@param exportPath string
---@return boolean
function resolve:ExportRenderPreset(presetName, exportPath) end

---@return string[]
function resolve:GetBurnInPresetList() end

---@param presetName string
---@return boolean
function resolve:DeleteBurnInPreset(presetName) end

---@param presetPath string
---@return boolean
function resolve:ImportBurnInPreset(presetPath) end

---@param presetName string
---@param exportPath string
---@return boolean
function resolve:ExportBurnInPreset(presetName, exportPath) end

---@return string[]
function resolve:GetKeyboardPresetList() end

---@param presetName string
---@return boolean
function resolve:LoadKeyboardPreset(presetName) end

---@param presetName string
---@return boolean
function resolve:DeleteKeyboardPreset(presetName) end

---@return string
function resolve:GetCurrentKeyboardPreset() end

---@param filePath string
---@param presetName? string
---@return boolean
function resolve:ImportKeyboardPreset(filePath, presetName) end

---@param presetName string
---@param exportPath string
---@return boolean
function resolve:ExportKeyboardPreset(presetName, exportPath) end

---@return number  # one of resolve.KEYFRAME_MODE_ALL / _COLOR / _SIZING (`KeyframeMode: TypeAlias = float` in the .pyi)
function resolve:GetKeyframeMode() end

---@param keyframeMode number  # one of resolve.KEYFRAME_MODE_ALL / _COLOR / _SIZING
---@return boolean
function resolve:SetKeyframeMode(keyframeMode) end

---@return string[]
function resolve:GetFairlightPresets() end

function resolve:DisableBackgroundTasksForCurrentResolveSession() end

---@param dctlSource string
---@return string?
function resolve:ValidateDCTL(dctlSource) end

---@param inputPath string
---@param encryptDCTLOptions? table  # `EncryptDCTLOptions` TypedDict in the .pyi
---@return boolean
function resolve:EncryptDCTL(inputPath, encryptDCTLOptions) end

---@return string[]
function resolve:GetUserPreferencesPresetList() end

---@param presetName string
---@return boolean
function resolve:LoadUserPreferencesPreset(presetName) end

---@param presetName string
---@return boolean
function resolve:SaveUserPreferencesPreset(presetName) end

---@param presetName string
---@return boolean
function resolve:DeleteUserPreferencesPreset(presetName) end

---@param filePath string
---@param presetName? string
---@return boolean
function resolve:ImportUserPreferencesPreset(filePath, presetName) end

---@param presetName string
---@param exportPath string
---@return boolean
function resolve:ExportUserPreferencesPreset(presetName, exportPath) end

---------------------------------------------------------------------------
-- fusion / fu / app: one FusionUI object behind three globals (measured).
-- The prefs channel is the bridge's response path; everything else is open.
---------------------------------------------------------------------------

---@class Fusion
---@field [string] fun(...): any
fusion = {}

---@param key? string  # e.g. "Global.ResolveLuaBridge.RLBResp"; nil returns the whole tree
---@return any
function fusion:GetPrefs(key) end

---@param key string
---@param value any
function fusion:SetPrefs(key, value) end

--- Rewrites Fusion.prefs (rename-atomic, 1 to 6 ms even at 512 KB). Returns nil, not a boolean.
function fusion:SavePrefs() end

---@param path string  # e.g. "Profile:", "Scripts:/Utility"
---@return string
function fusion:MapPath(path) end

---@return table
function fusion:GetAttrs() end

---@return any
function fusion:GetCurrentComp() end

---@return any
function fusion:NewComp(...) end

---@param path string
---@return any
function fusion:LoadComp(path, ...) end

---@deprecated Never call from the bridge: it takes Fusion's shared script executor for the whole session (docs/plan.md safety rules).
---@param script string
function fusion:Execute(script) end

---@deprecated Never call from the bridge: same executor as Execute (docs/plan.md safety rules).
---@param script string
function fusion:RunScript(script, ...) end

---@type Fusion
fu = fusion

---@type Fusion
app = fusion
