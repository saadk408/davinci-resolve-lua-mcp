---@meta _
-- Definition file for lua-language-server (LuaLS). Not loaded at runtime.
--
-- Declares the globals that DaVinci Resolve's Scripts-menu Lua host injects, so
-- the LSP can type-check bridge code instead of flagging every host call as an
-- undefined global. Sources:
--   * `bmd`: the 28 keys measured in the free 21.1 menu host on this Mac on
--     2026-09-20. Signatures are given
--     only where Step 1 measured them; the rest are `fun(...): any`.
--   * The block between BEGIN GENERATED and END GENERATED is written by
--     `scripts/gen-types.mjs` (`make gen-types`) from Blackmagic's
--     `Developer/Scripting/DaVinciResolveScript.pyi` (the signature reference
--     for Lua too) and the README's Deprecated and Unsupported sections: the
--     string enums as aliases, the float constant groups, every TypedDict,
--     every API class with its methods and constants, the deprecated names
--     marked @deprecated so a call warns, and the `resolve` / `Resolve()`
--     globals. Python `list[T]` is a Resolve "list" (1-indexed, carries
--     `__flags`), typed `T[]`. Never edit the block by hand; `make lint-lua`
--     fails when it is stale.
--   * `Fusion`: the ten methods that Step 1 saw on the `fusion` object. Only the
--     prefs channel and `MapPath` have measured signatures.
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

-- BEGIN GENERATED (scripts/gen-types.mjs; do not edit by hand, run `make gen-types`)
-- Source: DaVinciResolveScript.pyi next to the README dated 31 Aug 2026: 5 string enums,
-- 36 constant groups, 48 TypedDicts, 15 API classes with 410 methods,
-- plus 29 deprecated or unsupported names from the README (marked @deprecated so a call warns).

-- String enums (Literal[...] in the .pyi).
---@alias ClipColor "Orange"|"Apricot"|"Yellow"|"Lime"|"Olive"|"Green"|"Teal"|"Navy"|"Blue"|"Purple"|"Violet"|"Pink"|"Tan"|"Beige"|"Brown"|"Chocolate"
---@alias FlagColor "Blue"|"Cyan"|"Green"|"Yellow"|"Red"|"Pink"|"Purple"|"Fuchsia"|"Rose"|"Lavender"|"Sky"|"Mint"|"Lemon"|"Sand"|"Cocoa"|"Cream"
---@alias MarkerColor "Blue"|"Cyan"|"Green"|"Yellow"|"Red"|"Pink"|"Purple"|"Fuchsia"|"Rose"|"Lavender"|"Sky"|"Mint"|"Lemon"|"Sand"|"Cocoa"|"Cream"
---@alias MarkType "video"|"audio"|"all"
---@alias TrackType "video"|"audio"|"subtitle"

-- Constant groups: each alias is a float; the resolve.* fields below carry the alias name.
--- One of the resolve.* constants: KEYFRAME_MODE_ALL, KEYFRAME_MODE_COLOR, KEYFRAME_MODE_SIZING
---@alias KeyframeMode number
--- One of the resolve.* constants: CLOUD_SETTING_PROJECT_NAME, CLOUD_SETTING_PROJECT_MEDIA_PATH, CLOUD_SETTING_IS_COLLAB, CLOUD_SETTING_SYNC_MODE, CLOUD_SETTING_IS_CAMERA_ACCESS
---@alias CloudSettingKey number
--- One of the resolve.* constants: CLOUD_SYNC_NONE, CLOUD_SYNC_PROXY_ONLY, CLOUD_SYNC_PROXY_AND_ORIG
---@alias CloudSyncMode number
--- One of the resolve.* constants: AUDIO_SYNC_MODE, AUDIO_SYNC_CHANNEL_NUMBER, AUDIO_SYNC_RETAIN_EMBEDDED_AUDIO, AUDIO_SYNC_RETAIN_VIDEO_METADATA
---@alias AudioSyncSettingKey number
--- One of the resolve.* constants: AUDIO_SYNC_WAVEFORM, AUDIO_SYNC_TIMECODE, AUDIO_SYNC_IN, AUDIO_SYNC_OUT, AUDIO_SYNC_MARKER
---@alias AudioSyncMode number
--- One of the resolve.* constants: AUDIO_SYNC_CHANNEL_AUTOMATIC, AUDIO_SYNC_CHANNEL_MIX
---@alias AudioSyncChannel number
--- One of the resolve.* constants: MULTICAM_ANGLE_SYNC_IN, MULTICAM_ANGLE_SYNC_OUT, MULTICAM_ANGLE_SYNC_TIMECODE, MULTICAM_ANGLE_SYNC_AUDIO, MULTICAM_ANGLE_SYNC_MARKER
---@alias MulticamAngleSyncMode number
--- One of the resolve.* constants: MULTICAM_ANGLE_NAME_SEQUENTIAL, MULTICAM_ANGLE_NAME_ANGLE, MULTICAM_ANGLE_NAME_CAMERA, MULTICAM_ANGLE_NAME_CLIP, MULTICAM_ANGLE_NAME_FILE
---@alias MulticamAngleNameMode number
--- One of the resolve.* constants: MULTICAM_DETECT_BY_CAMERA_NUMBER, MULTICAM_DETECT_BY_ANGLE, MULTICAM_DETECT_BY_REEL_NUMBER, MULTICAM_DETECT_BY_REEL_NAME, MULTICAM_DETECT_BY_ROLL_CARD, MULTICAM_DETECT_NONE
---@alias MulticamDetectMode number
--- One of the resolve.* constants: MULTICAM_AUDIO_ADAPTIVE, MULTICAM_AUDIO_SOURCE, MULTICAM_AUDIO_REFERENCE, MULTICAM_AUDIO_ALL
---@alias MulticamAudioMode number
--- One of the resolve.* constants: CLOUD_SYNC_DEFAULT, CLOUD_SYNC_DOWNLOAD_IN_QUEUE, CLOUD_SYNC_DOWNLOAD_IN_PROGRESS, CLOUD_SYNC_DOWNLOAD_SUCCESS, CLOUD_SYNC_DOWNLOAD_FAIL, CLOUD_SYNC_DOWNLOAD_NOT_FOUND, CLOUD_SYNC_UPLOAD_IN_QUEUE, CLOUD_SYNC_UPLOAD_IN_PROGRESS, CLOUD_SYNC_UPLOAD_SUCCESS, CLOUD_SYNC_UPLOAD_FAIL, CLOUD_SYNC_UPLOAD_NOT_FOUND, CLOUD_SYNC_SUCCESS
---@alias CloudSyncStatus number
--- One of the resolve.* constants: MARKER_NONE, MARKER_BLUE, MARKER_CYAN, MARKER_GREEN, MARKER_YELLOW, MARKER_RED, MARKER_PINK, MARKER_PURPLE, MARKER_FUCHSIA, MARKER_ROSE, MARKER_LAVENDER, MARKER_SKY, MARKER_MINT, MARKER_LEMON, MARKER_SAND, MARKER_COCOA, MARKER_CREAM
---@alias SlateMarkerColor number
--- One of the resolve.* constants: NORMALIZE_AUDIO_SET_LEVEL_RELATIVE, NORMALIZE_AUDIO_SET_LEVEL_INDEPENDENT
---@alias NormalizeAudioSetLevelMode number
--- One of the resolve.* constants: AUTO_ALIGN_CLIPS_USING_WAVEFORM, AUTO_ALIGN_CLIPS_USING_TIMECODE
---@alias AutoAlignSyncUsing number
--- One of the resolve.* constants: AUTO_ALIGN_CLIPS_WAVEFORM_TRACK_MIX, AUTO_ALIGN_CLIPS_WAVEFORM_TRACK_AUTOMATIC
---@alias AutoAlignUseTrack number
--- One of the resolve.* constants: EXPORT_AAF, EXPORT_DRT, EXPORT_EDL, EXPORT_FCP_7_XML, EXPORT_FCPXML_1_8, EXPORT_FCPXML_1_9, EXPORT_FCPXML_1_10, EXPORT_HDR_10_PROFILE_A, EXPORT_HDR_10_PROFILE_B, EXPORT_TEXT_CSV, EXPORT_TEXT_TAB, EXPORT_DOLBY_VISION_VER_2_9, EXPORT_DOLBY_VISION_VER_4_0, EXPORT_DOLBY_VISION_VER_5_1, EXPORT_OTIO, EXPORT_ALE, EXPORT_ALE_CDL
---@alias TimelineExportType number
--- One of the resolve.* constants: EXPORT_NONE, EXPORT_AAF_NEW, EXPORT_AAF_EXISTING, EXPORT_CDL, EXPORT_SDL, EXPORT_MISSING_CLIPS
---@alias TimelineExportSubtype number
--- One of the resolve.* constants: SUBTITLE_LANGUAGE, SUBTITLE_CAPTION_PRESET, SUBTITLE_CHARS_PER_LINE, SUBTITLE_LINE_BREAK, SUBTITLE_GAP
---@alias SubtitleSettingKey number
--- One of the resolve.* constants: AUTO_CAPTION_AUTO, AUTO_CAPTION_MANDARIN_SIMPLIFIED, AUTO_CAPTION_DUTCH, AUTO_CAPTION_ENGLISH, AUTO_CAPTION_FINNISH, AUTO_CAPTION_FRENCH, AUTO_CAPTION_GERMAN, AUTO_CAPTION_HINDI, AUTO_CAPTION_INDONESIAN, AUTO_CAPTION_ITALIAN, AUTO_CAPTION_JAPANESE, AUTO_CAPTION_KOREAN, AUTO_CAPTION_MALAY, AUTO_CAPTION_NORWEGIAN, AUTO_CAPTION_POLISH, AUTO_CAPTION_PORTUGUESE, AUTO_CAPTION_ROMANIAN, AUTO_CAPTION_RUSSIAN, AUTO_CAPTION_SPANISH, AUTO_CAPTION_SWEDISH, AUTO_CAPTION_TURKISH, AUTO_CAPTION_VIETNAMESE, AUTO_CAPTION_TAMIL, AUTO_CAPTION_THAI, AUTO_CAPTION_DANISH, AUTO_CAPTION_MANDARIN_TRADITIONAL
---@alias AutoCaptionLanguage number
--- One of the resolve.* constants: AUTO_CAPTION_SUBTITLE_DEFAULT, AUTO_CAPTION_TELETEXT, AUTO_CAPTION_NETFLIX
---@alias AutoCaptionPreset number
--- One of the resolve.* constants: AUTO_CAPTION_LINE_SINGLE, AUTO_CAPTION_LINE_DOUBLE
---@alias AutoCaptionLineBreak number
--- One of the resolve.* constants: DLB_BLEND_SHOTS
---@alias DolbyVisionAnalysisType number
--- One of the resolve.* constants: DYNAMIC_ZOOM_EASE_LINEAR, DYNAMIC_ZOOM_EASE_IN, DYNAMIC_ZOOM_EASE_OUT, DYNAMIC_ZOOM_EASE_IN_AND_OUT
---@alias DynamicZoomEase number
--- One of the resolve.* constants: COMPOSITE_NORMAL, COMPOSITE_ADD, COMPOSITE_SUBTRACT, COMPOSITE_DIFF, COMPOSITE_MULTIPLY, COMPOSITE_SCREEN, COMPOSITE_OVERLAY, COMPOSITE_HARDLIGHT, COMPOSITE_SOFTLIGHT, COMPOSITE_DARKEN, COMPOSITE_LIGHTEN, COMPOSITE_COLOR_DODGE, COMPOSITE_COLOR_BURN, COMPOSITE_EXCLUSION, COMPOSITE_HUE, COMPOSITE_SATURATE, COMPOSITE_COLORIZE, COMPOSITE_LUMA_MASK, COMPOSITE_DIVIDE, COMPOSITE_LINEAR_DODGE, COMPOSITE_LINEAR_BURN, COMPOSITE_LINEAR_LIGHT, COMPOSITE_VIVID_LIGHT, COMPOSITE_PIN_LIGHT, COMPOSITE_HARD_MIX, COMPOSITE_LIGHTER_COLOR, COMPOSITE_DARKER_COLOR, COMPOSITE_FOREGROUND, COMPOSITE_ALPHA, COMPOSITE_INVERTED_ALPHA, COMPOSITE_LUM, COMPOSITE_INVERTED_LUM
---@alias CompositeMode number
--- One of the resolve.* constants: RETIME_USE_PROJECT, RETIME_NEAREST, RETIME_FRAME_BLEND, RETIME_OPTICAL_FLOW
---@alias RetimeProcess number
--- One of the resolve.* constants: MOTION_EST_USE_PROJECT, MOTION_EST_STANDARD_FASTER, MOTION_EST_STANDARD_BETTER, MOTION_EST_ENHANCED_FASTER, MOTION_EST_ENHANCED_BETTER, MOTION_EST_SPEED_WARP_FASTER, MOTION_EST_SPEED_WARP_BETTER, MOTION_EST_METAL
---@alias MotionEstimation number
--- One of the resolve.* constants: SCALE_USE_PROJECT, SCALE_CROP, SCALE_FIT, SCALE_FILL, SCALE_STRETCH
---@alias Scaling number
--- One of the resolve.* constants: RESIZE_FILTER_USE_PROJECT, RESIZE_FILTER_SHARPER, RESIZE_FILTER_SMOOTHER, RESIZE_FILTER_BICUBIC, RESIZE_FILTER_BILINEAR, RESIZE_FILTER_BESSEL, RESIZE_FILTER_BOX, RESIZE_FILTER_CATMULL_ROM, RESIZE_FILTER_CUBIC, RESIZE_FILTER_GAUSSIAN, RESIZE_FILTER_LANCZOS, RESIZE_FILTER_MITCHELL, RESIZE_FILTER_NEAREST_NEIGHBOR, RESIZE_FILTER_QUADRATIC, RESIZE_FILTER_SINC, RESIZE_FILTER_LINEAR
---@alias ResizeFilter number
--- One of the resolve.* constants: CACHE_AUTO_ENABLED, CACHE_DISABLED, CACHE_ENABLED
---@alias CacheMode number
--- One of the resolve.* constants: DIALOGUE_LEVELER_MODE_ALLOW_WIDER_DYNAMICS, DIALOGUE_LEVELER_MODE_OPTIMIZE_MODERATE_LEVELS, DIALOGUE_LEVELER_MODE_MORE_LIFT_FOR_LOW_LEVELS, DIALOGUE_LEVELER_MODE_LIFT_SOFT_WHISPERY_SOURCES
---@alias DialogueLevelerMode number
--- One of the resolve.* constants: FLATTEN_MULTICAM_COPY_GRADE, FLATTEN_MULTICAM_RETAIN_GRADE_FROM_ANGLE
---@alias FlattenMulticamGrade number
--- One of the resolve.* constants: EXPORT_LUT_17PTCUBE, EXPORT_LUT_33PTCUBE, EXPORT_LUT_65PTCUBE, EXPORT_LUT_PANASONICVLUT
---@alias ExportLutType number
--- One of the resolve.* constants: SMART_SWITCH_QUALITY_FASTER, SMART_SWITCH_QUALITY_BETTER
---@alias SmartSwitchQuality number
--- One of the resolve.* constants: SMART_SWITCH_WIDE_ANGLE_FREQ_LOW, SMART_SWITCH_WIDE_ANGLE_FREQ_MEDIUM, SMART_SWITCH_WIDE_ANGLE_FREQ_HIGH
---@alias SmartSwitchWideAngleFrequency number
--- One of the resolve.* constants: SMART_SWITCH_ANALYSIS_MODE_NONE, SMART_SWITCH_ANALYSIS_MODE_DETECT_WIDE_ANGLE, SMART_SWITCH_ANALYSIS_MODE_AUDIO_ONLY
---@alias SmartSwitchAnalysisMode number
--- One of the resolve.* constants: CLONE_CHECKSUM_TYPE_NONE, CLONE_CHECKSUM_TYPE_FILESIZE, CLONE_CHECKSUM_TYPE_CRC32, CLONE_CHECKSUM_TYPE_MD5, CLONE_CHECKSUM_TYPE_SHA256, CLONE_CHECKSUM_TYPE_SHA512, CLONE_CHECKSUM_TYPE_XXH_64
---@alias CloneChecksumType number

-- TypedDicts (all total=False in the .pyi, so every field is optional).
---@class AAFImportOptions
---@field autoImportSourceClipsIntoMediaPool? boolean # Import source clips into media pool (default: True)
---@field ignoreFileExtensionsWhenMatching? boolean # Ignore file extensions when matching (default: False)
---@field linkToSourceCameraFiles? boolean # Link to source camera files (default: False)
---@field useSizingInfo? boolean # Use sizing information (default: False)
---@field importMultiChannelAudioTracksAsLinkedGroups? boolean # Import multi-channel audio tracks as linked groups (default: False)
---@field insertAdditionalTracks? boolean # Insert additional tracks (default: True)
---@field insertWithOffset? string # Insert with timecode offset, e.g. '00:00:00:00' (applies when insertAdditionalTracks is False)
---@field sourceClipsPath? string # Filesystem path to search for source clips if media is inaccessible
---@field sourceClipsFolders? Folder[] # Media Pool folders to search for source clips

---@class AppendClipInfo
---@field mediaPoolItem? MediaPoolItem # MediaPoolItem object to append
---@field startFrame? number # Source start frame (optional)
---@field endFrame? number # Source end frame (optional)
---@field mediaType? integer # 1 - Video only, 2 - Audio only (optional)
---@field trackIndex? integer # Destination track index (optional)
---@field recordFrame? number # Record frame position (optional)

---@class AudioSyncSettings
---@field syncMode? AudioSyncMode # Default: resolve.AUDIO_SYNC_TIMECODE
---@field channelNumber? integer|AudioSyncChannel # For AUDIO_SYNC_WAVEFORM mode: channel offset, 1 to min channel count across input clips (default: 1)
---@field retainEmbeddedAudio? boolean # Keep original embedded audio (default: False)
---@field retainVideoMetadata? boolean # Keep video metadata (default: False)

---@class AutoAlignOptions
---@field SyncUsing? AutoAlignSyncUsing # Default: resolve.AUTO_ALIGN_CLIPS_USING_TIMECODE
---@field UseTrack? integer|AutoAlignUseTrack # For USING_WAVEFORM mode: track index, 1, 2, ... (default: 1)

---@class AutoCaptionSettings
---@field language? AutoCaptionLanguage # Default: resolve.AUTO_CAPTION_AUTO
---@field captionPreset? AutoCaptionPreset # Default: resolve.AUTO_CAPTION_SUBTITLE_DEFAULT
---@field charsPerLine? integer # Max characters per line, 1 to 60 (default: 42, varies by preset/language)
---@field lineBreak? AutoCaptionLineBreak # Default: resolve.AUTO_CAPTION_LINE_SINGLE
---@field gap? integer # Gap between subtitles in frames, 0 to 10 (default: 0)

---@class CDL
---@field NodeIndex? integer # Target node index, 1 <= NodeIndex <= total number of nodes
---@field Slope? string # RGB slope values as space-separated string, e.g. '0.5 0.4 0.2'
---@field Offset? string # RGB offset values as space-separated string, e.g. '0.4 0.3 0.2'
---@field Power? string # RGB power values as space-separated string, e.g. '0.6 0.7 0.8'
---@field Saturation? number # Saturation value, e.g. 0.65

---@class ClipProperties
---@field ["Alpha mode"] string? # Alpha mode, e.g. 'None', 'Straight', 'Premultiplied'
---@field ["Audio Bit Depth"] string? # Audio bit depth, e.g. '24'
---@field ["Audio Ch"] string? # Number of audio channels, e.g. '2'
---@field ["Audio Codec"] string? # Audio codec, e.g. 'AAC', 'Linear PCM'
---@field ["Audio Offset"] string? # Audio offset value
---@field ["Bit Depth"] string? # Video bit depth, e.g. '10'
---@field ["Clip Color"] ClipColor|string? # Clip color, e.g. 'Orange', 'Teal'. Empty when no color is set
---@field ["Clip Directory"] string? # Directory path of the clip
---@field ["Clip Name"] string? # User-assigned clip name
---@field ["Cloud Sync"] string? # Cloud sync status as string
---@field ["Data Level"] string? # Data level, e.g. 'Auto', 'Full', 'Video'
---@field ["Date Added"] string? # Date clip was added to media pool
---@field ["Date Created"] string? # Date clip was created
---@field ["Date Modified"] string? # Date clip was last modified
---@field ["Drop frame"] string? # Drop frame setting, e.g. '0', '1'
---@field Duration? string # Duration in timecode, e.g. '00:00:10:00'
---@field ["Enable Deinterlacing"] string? # Deinterlacing enabled, e.g. '0', '1'
---@field ["End TC"] string? # End timecode, e.g. '01:00:10:00'
---@field FPS? number # Frame rate, e.g. 23.976, 25.0
---@field ["Field Dominance"] string? # Field dominance, e.g. 'Progressive'
---@field ["File Name"] string? # Source file name
---@field ["File Path"] string? # Full path to source file
---@field Flags? string # Flag colors assigned to the clip
---@field Format? string # File format, e.g. 'QuickTime', 'MXF'
---@field Frames? string # Total frame count
---@field IDT? string # ACES Input Device Transform
---@field In? string # Mark in point
---@field ["Input Color Space"] string? # Input color space, e.g. 'Rec.709'
---@field ["Input Gamma"] string? # Input gamma, e.g. 'Gamma 2.4'
---@field ["Input LUT"] string? # Input LUT filename
---@field ["Input Sizing Preset"] string? # Sizing preset name
---@field ["Noise Reduction"] string? # Noise reduction value
---@field ["Offline Reference"] string? # Offline reference path
---@field ["Online Status"] string? # Online/offline status
---@field Out? string # Mark out point
---@field PAR? string # Pixel aspect ratio
---@field Proxy? string # Proxy status
---@field ["Proxy Media Path"] string? # Path to proxy media
---@field ["Reel Name"] string? # Reel name
---@field Resolution? string # Resolution, e.g. '1920x1080'
---@field ["Sample Rate"] string? # Audio sample rate, e.g. '48000'
---@field Sharpness? string # Sharpness value
---@field Start? string # Start frame number
---@field ["Start TC"] string? # Start timecode, e.g. '01:00:00:00'
---@field ["Super Scale"] integer? # Super Scale multiplier (1=off, 2=2x, 3=3x, 4=4x)
---@field ["SuperScale Noise Reduction"] string? # Super Scale noise reduction value
---@field ["SuperScale Sharpness"] string? # Super Scale sharpness value
---@field ["Synced Audio"] string? # Synced audio filename
---@field Type? string # Clip type, e.g. 'Video', 'Audio', 'Video + Audio'
---@field Usage? string # Number of times clip is used in timelines
---@field ["Video Codec"] string? # Video codec, e.g. 'H.264', 'Apple ProRes 422 HQ'

---@class CloneStatus
---@field JobStatus? string # 'Complete', 'Cloning', 'Cancelled', or 'Failed'. If no clone job has been started yet, this is 'Complete'
---@field CompletionPercentage? number # Progress from 0.0 to 100.0
---@field Error? string # Error message (set when JobStatus is 'Failed')

---@class CloneToolSettings
---@field PreserveFolderName? boolean # Preserve folder name (default: False)
---@field ChecksumType? CloneChecksumType # Default: resolve.CLONE_CHECKSUM_TYPE_MD5

---@class CloudSettings
---@field projectName? string # Project name
---@field projectMediaPath? string # Local media storage path
---@field isCollab? boolean # Enable live collaboration mode
---@field syncMode? CloudSyncMode # Media sync mode of the cloud project
---@field isCameraAccess? boolean # Enable camera access

---@class CompoundClipOptions
---@field startTimecode? string # Start timecode, e.g. '00:00:00:00'
---@field name? string # Compound clip name

---@class CreateTimelineClipInfo
---@field mediaPoolItem? MediaPoolItem # MediaPoolItem object to append
---@field startFrame? number # Source start frame (optional)
---@field endFrame? number # Source end frame (optional)
---@field recordFrame? number # Record frame position (optional)

---@class DatabaseInfo
---@field DbType? string # 'Disk' or 'PostgreSQL'
---@field DbName? string # Name
---@field IpAddress? string # IP address of the PostgreSQL server, e.g. '127.0.0.1' (optional)

---@class DeblurOptions
---@field FileName? string # Output file name pattern (default: '%{Source Name} Deblur')
---@field Format? string # Output format, e.g. 'mov', 'mp4'
---@field Codec? string # Output codec, e.g. 'H264', 'H265', 'ProRes422'
---@field EncodingProfile? string # Encoding profile, e.g. 'Main10' (H.264/H.265 only)
---@field Encoder? string # 'Native' or 'MainConcept' (H.265 only)
---@field UseExtremeMode? boolean # Use extreme deblur mode (default: True)
---@field UseMarkInMarkOut? boolean # Only process mark in/out range (default: True)
---@field RenderAtSourceRes? boolean # Render at source resolution (default: False)
---@field UseMoreGpuMemory? boolean # Use more GPU memory for processing (default: False)

---@class EncryptDCTLOptions
---@field Name? string # Output filename (default: input filename)
---@field Expiry? string # Valid ISO 8601 string (default: no expiry if empty value)
---@field OutputFolder? string # Output folder (default: user's home folder)

---@class FadeInfo
---@field FadeIn? integer # Duration in frames
---@field FadeOut? integer # Duration in frames

---@class FloatingWindowParams
---@field left? number # Left edge offset in pixels
---@field right? number # Right edge offset in pixels
---@field top? number # Top edge offset in pixels
---@field bottom? number # Bottom edge offset in pixels

---@class ImportClipInfo
---@field FilePath? string # File path (supports %0Nd frame pattern for image sequences)
---@field StartIndex? integer # Start frame index for image sequences (optional)
---@field EndIndex? integer # End frame index for image sequences (optional)

---@class ImportOptions
---@field timelineName? string # Name for the created timeline (not valid for DRT import)
---@field importSourceClips? boolean # Import source clips into media pool (default: True, not valid for DRT)
---@field sourceClipsPath? string # Filesystem path to search for source clips if media is inaccessible
---@field sourceClipsFolders? Folder[] # Media Pool folders to search for source clips if importSourceClips is False
---@field interlaceProcessing? boolean # Enable interlace processing (AAF import only)

---@class MarkInOutRange
---@field ["in"] integer? # Record frame relative to timeline start, e.g. 10
---@field out? integer # Record frame relative to timeline start, e.g. 320

---@class MarkInOut
---@field video? MarkInOutRange # Video mark in/out range
---@field audio? MarkInOutRange # Audio mark in/out range

---@class MarkerInfo
---@field color? MarkerColor # Color name, e.g. 'Blue', 'Green'
---@field duration? integer # Duration in frames, e.g. 1
---@field note? string # Text note
---@field name? string # Name, e.g. 'Marker 1'
---@field customData? string # Custom data field not exposed via UI

---@class MediaStorageItemInfo
---@field media? string # File/folder path
---@field startFrame? integer # Start frame (optional)
---@field endFrame? integer # End frame (optional)

---@class MulticamOptions
---@field name? string # Clip name (auto-generated from first clip if omitted)
---@field startTimecode? string # Start timecode, default: '01:00:00:00'
---@field frameRate? number # Frame rate, e.g. 23.976 (default: project timeline frame rate)
---@field angleSyncMode? MulticamAngleSyncMode # Default: resolve.MULTICAM_ANGLE_SYNC_TIMECODE
---@field channelConfig? integer|AudioSyncChannel # Audio channel for sync: 1-8 (angleSyncMode=MULTICAM_ANGLE_SYNC_AUDIO only)
---@field multicamAudioMode? MulticamAudioMode # Default: resolve.MULTICAM_AUDIO_SOURCE
---@field angleNameMode? MulticamAngleNameMode # Default: resolve.MULTICAM_ANGLE_NAME_SEQUENTIAL
---@field splitAtGaps? boolean # Split at gaps (angleSyncMode=MULTICAM_ANGLE_SYNC_AUDIO only, default: False)
---@field useFullClipExtents? boolean # Use full clip extents (default: False)
---@field createBinForSourceClips? boolean # Create bin for source clips (default: True)
---@field detectSameCameraClipsMode? MulticamDetectMode # Default: resolve.MULTICAM_DETECT_NONE

---@class NormalizeAudioOptions
---@field normalizationMode? string # Mode name from GetNormalizeAudioModes() (default: 'Sample Peak Program')
---@field targetLevel? number # Target level in dBFS, e.g. -9.0
---@field targetLoudness? number # Target loudness in LKFS, e.g. -24.0
---@field setLevelMode? NormalizeAudioSetLevelMode # Default: resolve.NORMALIZE_AUDIO_SET_LEVEL_RELATIVE

---@class OutputBlanking
---@field Top? integer # Top blanking in pixels
---@field Bottom? integer # Bottom blanking in pixels
---@field Left? integer # Left blanking in pixels
---@field Right? integer # Right blanking in pixels

---@class ProjectAttributes
---@field lastModifiedDate? string # Last modified date in ISO 8601 format, e.g. '2024-06-15T09:30:00+05:30'
---@field creationDate? string # Creation date in ISO 8601 format, e.g. '2024-06-15T09:30:00+05:30'
---@field notes? string # Project notes
---@field liveCollaborationMode? string # 'multi_user' or 'single_user'

---@class ProjectSettings
---@field timelineResolutionWidth? string # e.g. '1920'
---@field timelineResolutionHeight? string # e.g. '1080'
---@field timelinePixelAspectRatio? string # 'square', 'cinemascope', '16_9' or '4_3'
---@field timelineFrameRate? number|string # Returned as a number, e.g. 23.976. Set as a string, e.g. '23.976' or '29.97 DF'
---@field timelineDropFrameTimecode? string # '0' or '1'
---@field timelineInterlaceProcessing? string # '0' or '1'
---@field timelinePlaybackFrameRate? string # Read-only. e.g. '24'
---@field timelineOutputResMatchTimelineRes? string # '0' or '1'
---@field timelineOutputResolutionWidth? string # e.g. '1920'
---@field timelineOutputResolutionHeight? string # e.g. '1080'
---@field timelineOutputPixelAspectRatio? string # 'square', 'cinemascope', '16_9' or '4_3'
---@field timelineInputResMismatchBehavior? string # 'centerCrop', 'scaleToFit', 'scaleToCrop' or 'stretch'
---@field timelineOutputResMismatchBehavior? string # 'centerCrop', 'scaleToFit', 'scaleToCrop' or 'stretch'
---@field timelineFrameRateMismatchBehavior? string # e.g. 'resolve'
---@field timelineInputResMismatchUseCustomPreset? string # '0' or '1'
---@field timelineInputResMismatchCustomPreset? string # Input sizing preset name
---@field timelineOutputResMismatchUseCustomPreset? string # '0' or '1'
---@field timelineOutputResMismatchCustomPreset? string # Output sizing preset name
---@field timelineSampleRate? string # Audio sample rate in Hz, e.g. '48000'
---@field timelineSaveThumbsInProject? string # '0' or '1'
---@field imageRetimeInterpolation? string # 'nearest', 'frameBlend' or 'opticalFlow'
---@field imageMotionEstimationMode? string # e.g. 'standardFaster'
---@field imageMotionEstimationRange? string # 'small', 'medium' or 'larger'
---@field imageResizeMode? string # e.g. 'sharper'
---@field imageDeinterlaceQuality? string # 'normal' or 'high'
---@field imageEnableFieldProcessing? string # '0' or '1'
---@field perfCacheClipsLocation? string # Cache files directory path
---@field perfOptimisedMediaOn? string # '0' or '1'
---@field perfProxyMediaMode? string # '0' disabled, '1' when available, '2' when source not available
---@field perfRenderCacheMode? string # 'none', 'smart' or 'user'
---@field perfOptimizedResolutionRatio? string # e.g. 'auto', 'original', 'half' or 'quarter'
---@field perfAutoRenderCacheEnable? string # '0' or '1'
---@field perfAutoRenderCacheAfterTime? string # Idle time in seconds before caching starts, e.g. '5'
---@field perfAutoRenderCacheTransition? string # '0' or '1'
---@field perfAutoRenderCacheComposite? string # '0' or '1'
---@field perfAutoRenderCacheFuEffect? string # '0' or '1'
---@field perfOptimisedCodec? string # Read-only. Optimized media codec name
---@field perfProxyResolutionRatio? string # 'original', 'half' or 'quarter'
---@field perfRenderCacheCodec? string # Read-only. Render cache codec name
---@field isAutoColorManage? string # '0' or '1'
---@field rcmPresetMode? string # 'SDR' or 'HDR' when isAutoColorManage is '1', otherwise e.g. 'SDR Rec.709' or 'Custom'
---@field separateColorSpaceAndGamma? string # '0' or '1'
---@field colorScienceMode? string # 'davinciYRGB', 'davinciYRGBColorManaged', 'davinciYRGBColorManagedv2', 'acescc' or 'acescct'
---@field colorSpaceTimeline? string # Timeline color space, e.g. 'Rec.709'
---@field colorSpaceTimelineGamma? string # Timeline gamma, e.g. 'Gamma 2.4'
---@field colorSpaceInput? string # Input color space
---@field colorSpaceInputGamma? string # Input gamma
---@field colorSpaceOutput? string # Output color space
---@field colorSpaceOutputGamma? string # Output gamma
---@field colorSpaceOutputToneMapping? string # 'None', 'Simple', 'Luminance Mapping', 'DaVinci', 'Saturation Preserving' or 'RED IPP2'
---@field inputDRT? string # 'None', 'Simple', 'Luminance Mapping', 'DaVinci', 'Saturation Preserving' or 'RED IPP2'
---@field outputDRT? string # 'None', 'Simple', 'Luminance Mapping', 'DaVinci', 'Saturation Preserving' or 'RED IPP2'
---@field useInverseDRT? string # '0' or '1'
---@field timelineWorkingLuminanceMode? string # e.g. 'SDR 100', 'HDR 1000', 'HDR ER 1000/4000' or 'Custom'
---@field timelineWorkingLuminance? string # Working luminance in nits, e.g. '1000'
---@field inputDRTSatRolloffStart? string # Input saturation rolloff start in nits, e.g. '10000'
---@field inputDRTSatRolloffLimit? string # Input saturation rolloff limit in nits, e.g. '10000'
---@field outputDRTSatRolloffStart? string # Output saturation rolloff start in nits, e.g. '10000'
---@field outputDRTSatRolloffLimit? string # Output saturation rolloff limit in nits, e.g. '10000'
---@field colorSpaceOutputGamutMapping? string # 'None', 'Saturation Mapping' or 'RED IPP2 Gamut Mapping'
---@field imageResizingGamma? string # 'Timeline', 'Log', 'Linear', 'Linear - Tone Mapped', 'Gamma' or 'Gamma - Tone Mapped'
---@field graphicsWhiteLevel? string # Graphics white level in nits, e.g. '200'
---@field useCATransform? string # '0' or '1'
---@field disableFusionToneMapping? string # '0' or '1'
---@field useColorSpaceAwareGradingTools? string # '0' or '1'
---@field colorAcesIDT? string # ACES Input Device Transform
---@field colorAcesGamutCompressType? string # ACES gamut compression type
---@field colorAcesODT? string # ACES Output Device Transform
---@field colorAcesNodeLUTProcessingSpace? string # 'projectSetting', 'acesccAp1' or 'acesAp0Linear'
---@field colorSpaceOutputToneLuminanceMax? string # Max output luminance in nits, e.g. '1000'
---@field colorSpaceOutputGamutSaturationKnee? string # Saturation knee, e.g. '0.9'
---@field colorSpaceOutputGamutSaturationMax? string # Saturation max, e.g. '1'
---@field colorKeyframeDynamicsStartProfile? string # Keyframe dynamics start profile, e.g. '1'
---@field colorKeyframeDynamicsEndProfile? string # Keyframe dynamics end profile, e.g. '1'
---@field colorLuminanceMixerDefaultZero? string # '0' or '1'
---@field colorUseLegacyLogGrades? string # '0', '1' or '2'
---@field colorUseContrastSCurve? string # '0' or '1'
---@field colorUseStereoConvergenceForEffects? string # '0' or '1'
---@field colorUseLocalVersionsAsDefault? string # '0' or '1'
---@field colorUseBGRPixelOrderForDPX? string # '0' or '1'
---@field colorGalleryStillsLocation? string # Gallery stills directory path
---@field colorGalleryStillsNamingEnabled? string # '0' or '1'
---@field colorGalleryStillsNamingPattern? string # Gallery stills naming pattern
---@field colorGalleryStillsNamingCustomPattern? string # Gallery stills custom naming pattern
---@field colorGalleryStillsNamingWithStillNumber? string # '0' or '1'
---@field colorVersion1Name? string # Name of color version 1
---@field colorVersion2Name? string # Name of color version 2
---@field colorVersion3Name? string # Name of color version 3
---@field colorVersion4Name? string # Name of color version 4
---@field colorVersion5Name? string # Name of color version 5
---@field colorVersion6Name? string # Name of color version 6
---@field colorVersion7Name? string # Name of color version 7
---@field colorVersion8Name? string # Name of color version 8
---@field colorVersion9Name? string # Name of color version 9
---@field colorVersion10Name? string # Name of color version 10
---@field hdrMasteringOn? string # '0' or '1'
---@field hdrMasteringLuminanceMax? string # Mastering luminance max in nits, e.g. '1000'
---@field hdrDolbyControlsOn? string # '0' or '1'
---@field hdrDolbyVersion? string # '2.9' or '4.0'
---@field hdrDolbyAnalysisTuning? string # 'Legacy', 'Most Mapping', 'More Mapping', 'Balanced', 'Less Mapping' or 'Least Mapping'
---@field hdrDolbyMasterDisplay? string # Dolby Vision master display name
---@field hdr10PlusControlsOn? string # '0' or '1'
---@field audioOutputHasTimecode? string # '0' or '1'
---@field videoMonitorFormat? string # e.g. 'HD 1080i 50'
---@field videoMonitorUseStereoSDI? string # '0' or '1'
---@field videoMonitorUse444SDI? string # '0' or '1'
---@field videoMonitorSDIConfiguration? string # 'single_link', 'dual_link' or 'quad_link'
---@field videoDataLevels? string # 'Video' or 'Full'
---@field videoDataLevelsRetainSubblockAndSuperWhiteData? string # '0' or '1'
---@field videoMonitorBitDepth? string # e.g. '10'
---@field videoMonitorScaling? string # 'basic' or 'bilinear'
---@field videoMonitorUseHDROverHDMI? string # '0' or '1'
---@field videoMonitorUseMatrixOverrideFor422SDI? string # '0' or '1'
---@field videoMonitorMatrixOverrideFor422SDI? string # 'Rec.601', 'Rec.709' or 'Rec.2020'
---@field videoDeckFormat? string # Read-only. e.g. 'HD 1080i 50'
---@field videoDeckUseStereoSDI? string # '0' or '1'
---@field videoMonitorUseLevelA? string # '0' or '1'
---@field videoDeckUse444SDI? string # '0' or '1'
---@field videoDeckSDIConfiguration? string # 'single_link', 'dual_link' or 'quad_link'
---@field videoDeckBitDepth? string # e.g. '10'
---@field videoDeckUseAudoEdit? string # '0' or '1'
---@field videoDeckNonAutoEditFrames? string # Number of frames, e.g. '30'
---@field videoDeckPrerollSec? string # Preroll in seconds, e.g. '5'
---@field videoDeckOutputSyncSource? string # Output sync source name
---@field videoDeckAdd32Pulldown? string # '0' or '1'
---@field videoCaptureMode? string # Capture mode, e.g. '0'
---@field videoCaptureFormat? string # Read-only. e.g. 'HD 1080i 50'
---@field videoCaptureCodec? string # Read-only. Capture codec name
---@field videoCaptureIngestHandles? string # Number of handle frames, e.g. '0'
---@field audioCaptureNumChannels? string # Number of audio channels, e.g. '2'
---@field videoPlayoutMode? string # Playout mode, e.g. '0'
---@field videoPlayoutShowSourceTimecode? string # '0' or '1'
---@field videoPlayoutShowLTC? string # '0' or '1'
---@field videoPlayoutLTCFramesOffset? string # LTC offset in frames, e.g. '0'
---@field videoPlayoutAudioFramesOffset? string # Audio offset in frames, e.g. '0'
---@field audioPlayoutNumChannels? string # Number of audio channels, e.g. '2'
---@field videoPlayoutBatchHeadDuration? string # Head duration in frames, e.g. '0'
---@field videoPlayoutBatchTailDuration? string # Tail duration in frames, e.g. '0'
---@field limitBroadcastSafeOn? string # '0' or '1'
---@field limitBroadcastSafeLevels? string # Broadcast safe levels, e.g. '-20 - 120'
---@field limitAudioMeterLUFS? string # Loudness standard, e.g. '-23'
---@field limitAudioMeterLoudnessScale? string # Loudness scale, e.g. '18_scale'
---@field limitAudioMeterAlignLevel? string # Align level in dB, e.g. '-20'
---@field limitAudioMeterHighLevel? string # High level in dB, e.g. '-10'
---@field limitAudioMeterLowLevel? string # Low level in dB, e.g. '-30'
---@field limitAudioMeterDisplayMode? string # Audio meter display mode
---@field limitSubtitleCPL? string # Max characters per line, e.g. '60'
---@field limitSubtitleCaptionDurationSec? string # Max caption duration in seconds, e.g. '3'
---@field superScale? integer # 0=Auto, 1=none, 2=2x, 3=3x, 4=4x
---@field superScaleSharpness? string # '0' or '1'
---@field superScaleNoiseReduction? string # '0' or '1'
---@field superScaleSharpnessStrength? string # Read-only. Sharpness strength, e.g. '0.5'
---@field superScaleNoiseReductionStrength? string # Read-only. Noise reduction strength, e.g. '0.5'
---@field transcriptionLanguage? string # Language code, e.g. 'en'
---@field speakerDetection? string # '0' or '1'
---@field nodeStackLayers? string # Number of node stack layers, e.g. '1'
---@field cloudProjectMediaLocation? string # Cloud project media directory path
---@field projectMediaLocation? string # Project media directory path

---@class ProjectSettingsPresetInfo
---@field Name? string # Preset name
---@field Width? integer # Resolution width, e.g. 1920
---@field Height? integer # Resolution height, e.g. 1080

---@class QuickExportRenderSettings
---@field TargetDir? string # Output directory path
---@field CustomName? string # Custom output filename
---@field VideoQuality? integer # Bit rate limit (0 = automatic)
---@field EnableUpload? boolean # Enable direct upload for supported web presets (default: False)

---@class QuickExportRenderStatus
---@field JobStatus? string # 'Render Complete', 'Render Failed', 'Render Cancelled', 'Upload Completed', 'Upload Failed' or 'Upload Cancelled'
---@field CompletionPercentage? integer # Completion percentage
---@field TimeTakenToRenderInMs? integer # Time taken to render (set on completion)
---@field Error? string # Error details (set on failure)

---@class RenderJobInfo
---@field JobId? string # Unique job identifier
---@field RenderJobName? string # Job display name
---@field TimelineName? string # Source timeline name
---@field TargetDir? string # Output directory path
---@field IsExportVideo? boolean # Video export enabled
---@field IsExportAudio? boolean # Audio export enabled
---@field FormatWidth? integer # Output width in pixels
---@field FormatHeight? integer # Output height in pixels
---@field FrameRate? string # Frame rate, e.g. '23.976'
---@field PixelAspectRatio? number # Pixel aspect ratio
---@field MarkIn? integer # Mark in frame
---@field MarkOut? integer # Mark out frame
---@field AudioBitDepth? integer # Audio bit depth, e.g. 16, 24
---@field AudioSampleRate? integer # Audio sample rate, e.g. 48000
---@field ExportAlpha? boolean # Alpha channel export enabled
---@field AlphaMode? integer # 0 = Premultiplied, 1 = Straight (set when ExportAlpha is True)
---@field OutputFilename? string # Output file name(s)
---@field RenderMode? string # 'Single clip' or 'Individual clips'
---@field PresetName? string # Render preset name
---@field VideoFormat? string # Video format name, e.g. 'QuickTime'
---@field VideoCodec? string # Video codec name
---@field AudioCodec? string # Audio codec name
---@field EncodingProfile? string # Encoding profile, e.g. 'Main10'
---@field MultiPassEncode? boolean # Multi-pass encoding enabled
---@field NetworkOptimization? boolean # Network optimization enabled
---@field UploadStatus? string # Upload status (if applicable)
---@field ClipStartFrame? integer # Clip start frame number
---@field TimelineStartTimecode? string # Timeline start timecode, e.g. '01:00:00:00'
---@field ReplaceExistingFilesInPlace? boolean # Replace existing files in place

---@class RenderJobStatus
---@field JobStatus? string # Current status, one of 'Ready', 'Ready for background render', 'Rendering', 'Complete', 'Cancelled', 'Background Render Cancelled', 'Failed', 'Ready to remotely render' or 'Remote Render Cancelled'
---@field CompletionPercentage? integer # Completion percentage
---@field TimeTakenToRenderInMs? integer # Time taken to complete render, set for 'Complete' jobs
---@field EstimatedTimeRemainingInMs? integer # Time remaining to render, set for 'Rendering' jobs
---@field Error? string # Error details, set for 'Failed' jobs

---@class RenderSettings
---@field SelectAllFrames? boolean # Select all frames (MarkIn/MarkOut ignored when True)
---@field MarkIn? integer # Render mark in frame
---@field MarkOut? integer # Render mark out frame
---@field TargetDir? string # Output directory path
---@field CustomName? string # Custom output filename
---@field UseUniqueFilenames? boolean # Enable unique filenames
---@field UniqueFilenameStyle? integer # 0 = Prefix, 1 = Suffix
---@field ExportVideo? boolean # Enable video export
---@field ExportAudio? boolean # Enable audio export
---@field FormatWidth? integer # Output width in pixels
---@field FormatHeight? integer # Output height in pixels
---@field FrameRate? number # Frame rate, e.g. 23.976, 24.0
---@field PixelAspectRatio? string # SD: '16_9' or '4_3'; other: 'square' or 'cinemascope'
---@field VideoQuality? integer|string # 0 = automatic, int > 0 = bit rate, or 'Least'/'Low'/'Medium'/'High'/'Best'
---@field AudioFormat? string # Audio format, e.g. 'mp3' (only if ExportVideo is False)
---@field AudioCodec? string # Audio codec, e.g. 'aac'
---@field AudioBitDepth? integer # Audio bit depth, e.g. 16, 24
---@field AudioSampleRate? integer # Audio sample rate, e.g. 48000
---@field ColorSpaceTag? string # Color space, e.g. 'Same as Project', 'AstroDesign'
---@field GammaTag? string # Gamma, e.g. 'Same as Project', 'ACEScct'
---@field ExportAlpha? boolean # Enable alpha channel export
---@field AlphaMode? integer # 0 = Premultiplied, 1 = Straight (requires ExportAlpha True)
---@field EncodingProfile? string # Encoding profile, e.g. 'Main10' (H.264/H.265 only)
---@field MultiPassEncode? boolean # Multi-pass encoding (H.264 only)
---@field NetworkOptimization? boolean # Network optimization (QuickTime/MP4 only)
---@field ClipStartFrame? integer # Clip start frame number
---@field TimelineStartTimecode? string # Timeline start timecode, e.g. '01:00:00:00'
---@field ReplaceExistingFilesInPlace? boolean # Replace existing files in place
---@field ExportSubtitle? boolean # Enable subtitle export
---@field SubtitleFormat? string # 'BurnIn', 'EmbeddedCaptions' or 'SeparateFile'
---@field UseFullExtents? boolean # Use full extents of clips
---@field AddFrameHandles? integer # Frame handles count >= 0 (ignored if UseFullExtents is True)
---@field DataBurnIn? string # Data burn-in preset, e.g. 'Same as project', 'None'

---@class ResolutionInfo
---@field Width? integer # Resolution width in pixels
---@field Height? integer # Resolution height in pixels

---@class SmartSwitchSettings
---@field minEditDuration? number # Minimum edit duration in seconds, 0.5 to 10.0 (default: 1.0)
---@field editChangeDelay? number # Edit change delay in seconds, 0.0 to 2.0 (default: 0.3)
---@field isAutoDetectWideAngle? boolean # Auto-detect wide angle from analysis (default: True)
---@field analysisMode? SmartSwitchAnalysisMode # Overrides isAutoDetectWideAngle
---@field wideAngleID? string # Wide angle name, or 'None' to disable (used when isAutoDetectWideAngle is False)
---@field wideAngleFrequency? SmartSwitchWideAngleFrequency # Default: resolve.SMART_SWITCH_WIDE_ANGLE_FREQ_MEDIUM
---@field isUseWideAngleForIntroOutro? boolean # Use wide angle for intro/outro (default: True)
---@field isUseWideAngleForSilence? boolean # Use wide angle for silence (default: True)
---@field switchOnVideoOnly? boolean # Switch on video only, not supported in adaptive/source mode (default: False)
---@field quality? SmartSwitchQuality # Default: resolve.SMART_SWITCH_QUALITY_BETTER

---@class SpeechSettings
---@field TextInput? string # Input text to synthesize (max 350 chars)
---@field VoiceModel? string # Voice model name, e.g. 'Female 1', 'Male 1', 'Custom Voice'
---@field CustomVoiceFile? string # Full path to custom voice file (required when VoiceModel is 'Custom Voice')
---@field Speed? number # Speed adjustment, -10.0 to 10.0
---@field Variation? number # Variation amount, 0.0 to 1.0
---@field Pitch? number # Pitch adjustment, -2.0 to 2.0
---@field GenerationID? integer # Generation ID for reproducibility (> 0)
---@field Filename? string # Output filename
---@field AddToTimeline? boolean # Add generated audio to timeline (default: False)
---@field AudioTrack? integer # Target audio track number (0 = new track)

---@class SpeedOptions
---@field Percentage? number # Speed in percentage, e.g. 110.0 (0.0 = freeze frame)
---@field PitchCorrection? boolean # Pitch correction of linked audio (default: clip's existing state)
---@field StretchKeyframesToFit? boolean # Stretch keyframes to fit (default: False)
---@field RippleTimeline? boolean # Ripple timeline (default: False)

---@class TakeInfo
---@field startFrame? integer # Take start frame
---@field endFrame? integer # Take end frame
---@field mediaPoolItem? MediaPoolItem # Take media pool item

---@class ThumbnailData
---@field width? integer # Width in pixels
---@field height? integer # Height in pixels
---@field format? string # Image format, e.g. 'RGB 8 bit'
---@field data? string # Base64-encoded image data

---@class TimelineItemProperties
---@field TransformEnabled? boolean # Enable/disable Transform filter section
---@field Pan? number # -4.0*width to 4.0*width
---@field Tilt? number # -4.0*height to 4.0*height
---@field ZoomX? number # 0.0 to 100.0
---@field ZoomY? number # 0.0 to 100.0
---@field ZoomGang? boolean # Gang ZoomX and ZoomY
---@field RotationAngle? number # -360.0 to 360.0
---@field AnchorPointX? number # -4.0*width to 4.0*width
---@field AnchorPointY? number # -4.0*height to 4.0*height
---@field Pitch? number # -1.5 to 1.5
---@field Yaw? number # -1.5 to 1.5
---@field FlipX? boolean # Flip horizontally
---@field FlipY? boolean # Flip vertically
---@field CroppingEnabled? boolean # Enable/disable Cropping filter section
---@field CropLeft? number # 0.0 to width
---@field CropRight? number # 0.0 to width
---@field CropTop? number # 0.0 to height
---@field CropBottom? number # 0.0 to height
---@field CropSoftness? number # -100.0 to 100.0
---@field CropRetain? boolean # Retain Image Position
---@field DynamicZoomEnabled? boolean # Enable/disable Dynamic Zoom filter section
---@field DynamicZoomEase? DynamicZoomEase
---@field CompositeEnabled? boolean # Enable/disable Composite filter section
---@field CompositeMode? CompositeMode # See README.md section 'Looking up Timeline item properties'.
---@field Opacity? number # 0.0 to 100.0
---@field LensCorrectionEnabled? boolean # Enable/disable Lens Correction filter section
---@field Distortion? number # -1.0 to 1.0
---@field RetimeAndScalingEnabled? boolean # Enable/disable Retime and Scaling filter section
---@field RetimeProcess? RetimeProcess
---@field MotionEstimation? MotionEstimation
---@field Scaling? Scaling
---@field ResizeFilter? ResizeFilter
---@field AudioVolumeEnabled? boolean # Enable/disable audio volume filter
---@field AudioVolume? number # -100.0 to 30.0 (dB)
---@field AudioPanEnabled? boolean # Enable/disable audio pan filter
---@field AudioPan? number # -100.0 to 100.0
---@field AudioPitchEnabled? boolean # Enable/disable audio pitch filter
---@field AudioPitchSemiTones? number # -24.0 to 24.0
---@field AudioPitchCents? number # -100.0 to 100.0
---@field AudioVoiceIsolationEnabled? boolean # Enable/disable Voice Isolation [Active Timeline Only]
---@field AudioVoiceIsolationAmount? integer # 0 to 100 (isolation strength) [Active Timeline Only]
---@field AudioDialogueLevelerEnabled? boolean # Enable/disable Dialogue Leveler [Active Timeline Only]
---@field AudioDialogueLevelerMode? DialogueLevelerMode # [Active Timeline Only]
---@field AudioDialogueLevelerReduceLoudDialogue? boolean # Reduce loud dialogue [Active Timeline Only]
---@field AudioDialogueLevelerLiftSoftDialogue? boolean # Lift soft dialogue [Active Timeline Only]
---@field AudioDialogueLevelerBackgroundReduction? boolean # Enable background reduction [Active Timeline Only]
---@field AudioDialogueLevelerOutputGain? number # 0.0 to 6.0 (dB) [Active Timeline Only]

---@class TimelineSettings
---@field useCustomSettings? string # '0' or '1'
---@field timelineResolutionWidth? string # e.g. '1920'
---@field timelineResolutionHeight? string # e.g. '1080'
---@field timelinePixelAspectRatio? string # e.g. 'square'
---@field timelineInputResMismatchBehavior? string # e.g. 'scaleToCrop'
---@field timelineFrameRate? number|string # Returned as a number, e.g. 23.976. Set as a string, e.g. '23.976' or '29.97 DF'
---@field timelineDropFrameTimecode? string # '0' or '1'
---@field timelineInterlaceProcessing? string # '0' or '1'
---@field timelineOutputResMatchTimelineRes? string # '0' or '1'
---@field timelineOutputResolutionWidth? string # e.g. '1920'
---@field timelineOutputResolutionHeight? string # e.g. '1080'
---@field timelineOutputPixelAspectRatio? string # e.g. 'square'
---@field timelineOutputResMismatchBehavior? string # e.g. 'scaleToCrop'
---@field superScale? integer # 0=Auto, 1=none, 2=2x, 3=3x, 4=4x
---@field videoMonitorFormat? string # e.g. 'HD 1080i 50'
---@field videoMonitorUse444SDI? string # '0' or '1'
---@field videoMonitorUseLevelA? string # '0' or '1'
---@field videoMonitorUseStereoSDI? string # '0' or '1'
---@field videoMonitorSDIConfiguration? string # SDI config string
---@field videoDataLevels? string # e.g. 'Auto'
---@field videoDataLevelsRetainSubblockAndSuperWhiteData? string # '0' or '1'
---@field videoMonitorBitDepth? string # e.g. '10'
---@field videoMonitorScaling? string # e.g. 'bilinear'
---@field videoMonitorUseHDROverHDMI? string # '0' or '1'
---@field videoMonitorUseMatrixOverrideFor422SDI? string # '0' or '1'
---@field videoMonitorMatrixOverrideFor422SDI? string # Matrix override value
---@field colorScienceMode? string # e.g. 'davinciYRGBColorManagedv2'
---@field acesVersion? string # e.g. 'aces_1.3'
---@field isAutoColorManage? string # '0' or '1'
---@field rcmPresetMode? string # Preset mode string
---@field separateColorSpaceAndGamma? string # '0' or '1'
---@field colorSpaceTimeline? string # e.g. 'Rec.709'
---@field colorSpaceTimelineGamma? string # e.g. 'Gamma 2.4'
---@field colorAcesGamutCompressType? string # Gamut compress type
---@field colorAcesODT? string # ACES Output Device Transform
---@field colorAcesMidGray? string # Mid gray value
---@field colorSpaceOutput? string # Output color space
---@field colorSpaceOutputGamma? string # Output gamma
---@field use203NitsReference? string # '0' or '1'
---@field colorSpaceOutputGamutLimit? string # Clipping color space
---@field colorAcesNodeLUTProcessingSpace? string # Node LUT processing space
---@field hdrMasteringOn? string # '0' or '1'
---@field hdrMasteringLuminanceMax? string # Max luminance value
---@field outputDRT? string # Output DRT string
---@field colorSpaceOutputToneMapping? string # Tone mapping mode
---@field colorSpaceOutputGamutMapping? string # Gamut mapping mode
---@field colorSpaceOutputGamutSaturationKnee? string # Saturation knee value
---@field colorSpaceOutputGamutSaturationMax? string # Saturation max value
---@field useInverseDRT? string # '0' or '1'
---@field colorSpaceOutputToneLuminanceMax? string # Tone luminance max
---@field outputDRTSatRolloffStart? string # Saturation rolloff start
---@field outputDRTSatRolloffLimit? string # Saturation rolloff limit
---@field inputDRT? string # Input DRT string
---@field inputDRTSatRolloffStart? string # Input saturation rolloff start
---@field inputDRTSatRolloffLimit? string # Input saturation rolloff limit
---@field useCATransform? string # '0' or '1'
---@field useColorSpaceAwareGradingTools? string # '0' or '1'
---@field imageResizingGamma? string # Image resizing gamma
---@field graphicsWhiteLevel? string # Graphics white level
---@field timelineWorkingLuminance? string # Working luminance value
---@field timelineWorkingLuminanceMode? string # Working luminance mode
---@field hdrDolbyControlsOn? string # '0' or '1'
---@field hdrDolbyVersion? string # Dolby Vision version
---@field hdrDolbyMasterDisplay? string # Dolby Vision master display
---@field hdrDolbyUseExternalCMU? string # '0' or '1'
---@field hdr10PlusControlsOn? string # '0' or '1'
---@field hdrVividControlsOn? string # '0' or '1'
---@field hdrVividMasterDisplay? string # HDR Vivid master display
---@field disableFusionToneMapping? string # '0' or '1'

---@class Transcription
---@field language? string # Transcription language code
---@field segments? TranscriptionSegment[] # List of transcription segments

---@class TranscriptionSegment
---@field start? string # Start timecode, e.g. '01:00:02:05'
---@field ["end"] string? # End timecode, e.g. '01:00:04:10'
---@field text? string # Concatenated text of all words in segment; '(...)' denotes silence
---@field speaker? string # Speaker name if detected, None otherwise
---@field words? TranscriptionWord[] # Individual words with timing

---@class TranscriptionWord
---@field start? string # Start timecode
---@field ["end"] string? # End timecode
---@field text? string # Word text; '(...)' denotes silence

---@class TransitionOptions
---@field type? string # Transition type name, e.g. 'Cross Dissolve'
---@field category? string # Transition category: 'simple', 'fusion', 'ofx' or 'audio'
---@field position? string # Edge of the item to attach the transition to: 'start' or 'end'
---@field alignment? string # Placement relative to the edge: 'left', 'center' or 'right'
---@field duration? integer # Duration in frames (default: automatically calculated)

---@class VersionInfo
---@field versionName? string # Version name
---@field versionType? integer # Version type, 0 = local, 1 = remote

---@class VoiceIsolationState
---@field isEnabled? boolean # Enabled flag
---@field amount? integer # Amount in range [0, 100]

-- API classes. Methods are colon-called (obj:Method()); constants are dot-read (resolve.EXPORT_AAF).
--- The Resolve application: pages, the current project and application-wide presets.
---@class Resolve
---@field KEYFRAME_MODE_ALL KeyframeMode
---@field KEYFRAME_MODE_COLOR KeyframeMode
---@field KEYFRAME_MODE_SIZING KeyframeMode
---@field CLOUD_SETTING_PROJECT_NAME CloudSettingKey
---@field CLOUD_SETTING_PROJECT_MEDIA_PATH CloudSettingKey
---@field CLOUD_SETTING_IS_COLLAB CloudSettingKey
---@field CLOUD_SETTING_SYNC_MODE CloudSettingKey
---@field CLOUD_SETTING_IS_CAMERA_ACCESS CloudSettingKey
---@field CLOUD_SYNC_NONE CloudSyncMode
---@field CLOUD_SYNC_PROXY_ONLY CloudSyncMode
---@field CLOUD_SYNC_PROXY_AND_ORIG CloudSyncMode
---@field AUDIO_SYNC_MODE AudioSyncSettingKey
---@field AUDIO_SYNC_CHANNEL_NUMBER AudioSyncSettingKey
---@field AUDIO_SYNC_RETAIN_EMBEDDED_AUDIO AudioSyncSettingKey
---@field AUDIO_SYNC_RETAIN_VIDEO_METADATA AudioSyncSettingKey
---@field AUDIO_SYNC_WAVEFORM AudioSyncMode
---@field AUDIO_SYNC_TIMECODE AudioSyncMode
---@field AUDIO_SYNC_IN AudioSyncMode
---@field AUDIO_SYNC_OUT AudioSyncMode
---@field AUDIO_SYNC_MARKER AudioSyncMode
---@field AUDIO_SYNC_CHANNEL_AUTOMATIC AudioSyncChannel
---@field AUDIO_SYNC_CHANNEL_MIX AudioSyncChannel
---@field MULTICAM_ANGLE_SYNC_IN MulticamAngleSyncMode
---@field MULTICAM_ANGLE_SYNC_OUT MulticamAngleSyncMode
---@field MULTICAM_ANGLE_SYNC_TIMECODE MulticamAngleSyncMode
---@field MULTICAM_ANGLE_SYNC_AUDIO MulticamAngleSyncMode
---@field MULTICAM_ANGLE_SYNC_MARKER MulticamAngleSyncMode
---@field MULTICAM_ANGLE_NAME_SEQUENTIAL MulticamAngleNameMode
---@field MULTICAM_ANGLE_NAME_ANGLE MulticamAngleNameMode
---@field MULTICAM_ANGLE_NAME_CAMERA MulticamAngleNameMode
---@field MULTICAM_ANGLE_NAME_CLIP MulticamAngleNameMode
---@field MULTICAM_ANGLE_NAME_FILE MulticamAngleNameMode
---@field MULTICAM_DETECT_BY_CAMERA_NUMBER MulticamDetectMode
---@field MULTICAM_DETECT_BY_ANGLE MulticamDetectMode
---@field MULTICAM_DETECT_BY_REEL_NUMBER MulticamDetectMode
---@field MULTICAM_DETECT_BY_REEL_NAME MulticamDetectMode
---@field MULTICAM_DETECT_BY_ROLL_CARD MulticamDetectMode
---@field MULTICAM_DETECT_NONE MulticamDetectMode
---@field MULTICAM_AUDIO_ADAPTIVE MulticamAudioMode
---@field MULTICAM_AUDIO_SOURCE MulticamAudioMode
---@field MULTICAM_AUDIO_REFERENCE MulticamAudioMode
---@field MULTICAM_AUDIO_ALL MulticamAudioMode
---@field CLOUD_SYNC_DEFAULT CloudSyncStatus
---@field CLOUD_SYNC_DOWNLOAD_IN_QUEUE CloudSyncStatus
---@field CLOUD_SYNC_DOWNLOAD_IN_PROGRESS CloudSyncStatus
---@field CLOUD_SYNC_DOWNLOAD_SUCCESS CloudSyncStatus
---@field CLOUD_SYNC_DOWNLOAD_FAIL CloudSyncStatus
---@field CLOUD_SYNC_DOWNLOAD_NOT_FOUND CloudSyncStatus
---@field CLOUD_SYNC_UPLOAD_IN_QUEUE CloudSyncStatus
---@field CLOUD_SYNC_UPLOAD_IN_PROGRESS CloudSyncStatus
---@field CLOUD_SYNC_UPLOAD_SUCCESS CloudSyncStatus
---@field CLOUD_SYNC_UPLOAD_FAIL CloudSyncStatus
---@field CLOUD_SYNC_UPLOAD_NOT_FOUND CloudSyncStatus
---@field CLOUD_SYNC_SUCCESS CloudSyncStatus
---@field MARKER_NONE SlateMarkerColor
---@field MARKER_BLUE SlateMarkerColor
---@field MARKER_CYAN SlateMarkerColor
---@field MARKER_GREEN SlateMarkerColor
---@field MARKER_YELLOW SlateMarkerColor
---@field MARKER_RED SlateMarkerColor
---@field MARKER_PINK SlateMarkerColor
---@field MARKER_PURPLE SlateMarkerColor
---@field MARKER_FUCHSIA SlateMarkerColor
---@field MARKER_ROSE SlateMarkerColor
---@field MARKER_LAVENDER SlateMarkerColor
---@field MARKER_SKY SlateMarkerColor
---@field MARKER_MINT SlateMarkerColor
---@field MARKER_LEMON SlateMarkerColor
---@field MARKER_SAND SlateMarkerColor
---@field MARKER_COCOA SlateMarkerColor
---@field MARKER_CREAM SlateMarkerColor
---@field NORMALIZE_AUDIO_SET_LEVEL_RELATIVE NormalizeAudioSetLevelMode
---@field NORMALIZE_AUDIO_SET_LEVEL_INDEPENDENT NormalizeAudioSetLevelMode
---@field AUTO_ALIGN_CLIPS_USING_WAVEFORM AutoAlignSyncUsing
---@field AUTO_ALIGN_CLIPS_USING_TIMECODE AutoAlignSyncUsing
---@field AUTO_ALIGN_CLIPS_WAVEFORM_TRACK_MIX AutoAlignUseTrack
---@field AUTO_ALIGN_CLIPS_WAVEFORM_TRACK_AUTOMATIC AutoAlignUseTrack
---@field EXPORT_AAF TimelineExportType
---@field EXPORT_DRT TimelineExportType
---@field EXPORT_EDL TimelineExportType
---@field EXPORT_FCP_7_XML TimelineExportType
---@field EXPORT_FCPXML_1_8 TimelineExportType
---@field EXPORT_FCPXML_1_9 TimelineExportType
---@field EXPORT_FCPXML_1_10 TimelineExportType
---@field EXPORT_HDR_10_PROFILE_A TimelineExportType
---@field EXPORT_HDR_10_PROFILE_B TimelineExportType
---@field EXPORT_TEXT_CSV TimelineExportType
---@field EXPORT_TEXT_TAB TimelineExportType
---@field EXPORT_DOLBY_VISION_VER_2_9 TimelineExportType
---@field EXPORT_DOLBY_VISION_VER_4_0 TimelineExportType
---@field EXPORT_DOLBY_VISION_VER_5_1 TimelineExportType
---@field EXPORT_OTIO TimelineExportType
---@field EXPORT_ALE TimelineExportType
---@field EXPORT_ALE_CDL TimelineExportType
---@field EXPORT_NONE TimelineExportSubtype
---@field EXPORT_AAF_NEW TimelineExportSubtype
---@field EXPORT_AAF_EXISTING TimelineExportSubtype
---@field EXPORT_CDL TimelineExportSubtype
---@field EXPORT_SDL TimelineExportSubtype
---@field EXPORT_MISSING_CLIPS TimelineExportSubtype
---@field SUBTITLE_LANGUAGE SubtitleSettingKey
---@field SUBTITLE_CAPTION_PRESET SubtitleSettingKey
---@field SUBTITLE_CHARS_PER_LINE SubtitleSettingKey
---@field SUBTITLE_LINE_BREAK SubtitleSettingKey
---@field SUBTITLE_GAP SubtitleSettingKey
---@field AUTO_CAPTION_AUTO AutoCaptionLanguage
---@field AUTO_CAPTION_MANDARIN_SIMPLIFIED AutoCaptionLanguage
---@field AUTO_CAPTION_DUTCH AutoCaptionLanguage
---@field AUTO_CAPTION_ENGLISH AutoCaptionLanguage
---@field AUTO_CAPTION_FINNISH AutoCaptionLanguage
---@field AUTO_CAPTION_FRENCH AutoCaptionLanguage
---@field AUTO_CAPTION_GERMAN AutoCaptionLanguage
---@field AUTO_CAPTION_HINDI AutoCaptionLanguage
---@field AUTO_CAPTION_INDONESIAN AutoCaptionLanguage
---@field AUTO_CAPTION_ITALIAN AutoCaptionLanguage
---@field AUTO_CAPTION_JAPANESE AutoCaptionLanguage
---@field AUTO_CAPTION_KOREAN AutoCaptionLanguage
---@field AUTO_CAPTION_MALAY AutoCaptionLanguage
---@field AUTO_CAPTION_NORWEGIAN AutoCaptionLanguage
---@field AUTO_CAPTION_POLISH AutoCaptionLanguage
---@field AUTO_CAPTION_PORTUGUESE AutoCaptionLanguage
---@field AUTO_CAPTION_ROMANIAN AutoCaptionLanguage
---@field AUTO_CAPTION_RUSSIAN AutoCaptionLanguage
---@field AUTO_CAPTION_SPANISH AutoCaptionLanguage
---@field AUTO_CAPTION_SWEDISH AutoCaptionLanguage
---@field AUTO_CAPTION_TURKISH AutoCaptionLanguage
---@field AUTO_CAPTION_VIETNAMESE AutoCaptionLanguage
---@field AUTO_CAPTION_TAMIL AutoCaptionLanguage
---@field AUTO_CAPTION_THAI AutoCaptionLanguage
---@field AUTO_CAPTION_DANISH AutoCaptionLanguage
---@field AUTO_CAPTION_MANDARIN_TRADITIONAL AutoCaptionLanguage
---@field AUTO_CAPTION_SUBTITLE_DEFAULT AutoCaptionPreset
---@field AUTO_CAPTION_TELETEXT AutoCaptionPreset
---@field AUTO_CAPTION_NETFLIX AutoCaptionPreset
---@field AUTO_CAPTION_LINE_SINGLE AutoCaptionLineBreak
---@field AUTO_CAPTION_LINE_DOUBLE AutoCaptionLineBreak
---@field DLB_BLEND_SHOTS DolbyVisionAnalysisType
---@field DYNAMIC_ZOOM_EASE_LINEAR DynamicZoomEase
---@field DYNAMIC_ZOOM_EASE_IN DynamicZoomEase
---@field DYNAMIC_ZOOM_EASE_OUT DynamicZoomEase
---@field DYNAMIC_ZOOM_EASE_IN_AND_OUT DynamicZoomEase
---@field COMPOSITE_NORMAL CompositeMode
---@field COMPOSITE_ADD CompositeMode
---@field COMPOSITE_SUBTRACT CompositeMode
---@field COMPOSITE_DIFF CompositeMode
---@field COMPOSITE_MULTIPLY CompositeMode
---@field COMPOSITE_SCREEN CompositeMode
---@field COMPOSITE_OVERLAY CompositeMode
---@field COMPOSITE_HARDLIGHT CompositeMode
---@field COMPOSITE_SOFTLIGHT CompositeMode
---@field COMPOSITE_DARKEN CompositeMode
---@field COMPOSITE_LIGHTEN CompositeMode
---@field COMPOSITE_COLOR_DODGE CompositeMode
---@field COMPOSITE_COLOR_BURN CompositeMode
---@field COMPOSITE_EXCLUSION CompositeMode
---@field COMPOSITE_HUE CompositeMode
---@field COMPOSITE_SATURATE CompositeMode
---@field COMPOSITE_COLORIZE CompositeMode
---@field COMPOSITE_LUMA_MASK CompositeMode
---@field COMPOSITE_DIVIDE CompositeMode
---@field COMPOSITE_LINEAR_DODGE CompositeMode
---@field COMPOSITE_LINEAR_BURN CompositeMode
---@field COMPOSITE_LINEAR_LIGHT CompositeMode
---@field COMPOSITE_VIVID_LIGHT CompositeMode
---@field COMPOSITE_PIN_LIGHT CompositeMode
---@field COMPOSITE_HARD_MIX CompositeMode
---@field COMPOSITE_LIGHTER_COLOR CompositeMode
---@field COMPOSITE_DARKER_COLOR CompositeMode
---@field COMPOSITE_FOREGROUND CompositeMode
---@field COMPOSITE_ALPHA CompositeMode
---@field COMPOSITE_INVERTED_ALPHA CompositeMode
---@field COMPOSITE_LUM CompositeMode
---@field COMPOSITE_INVERTED_LUM CompositeMode
---@field RETIME_USE_PROJECT RetimeProcess
---@field RETIME_NEAREST RetimeProcess
---@field RETIME_FRAME_BLEND RetimeProcess
---@field RETIME_OPTICAL_FLOW RetimeProcess
---@field MOTION_EST_USE_PROJECT MotionEstimation
---@field MOTION_EST_STANDARD_FASTER MotionEstimation
---@field MOTION_EST_STANDARD_BETTER MotionEstimation
---@field MOTION_EST_ENHANCED_FASTER MotionEstimation
---@field MOTION_EST_ENHANCED_BETTER MotionEstimation
---@field MOTION_EST_SPEED_WARP_FASTER MotionEstimation
---@field MOTION_EST_SPEED_WARP_BETTER MotionEstimation
---@field MOTION_EST_METAL MotionEstimation
---@field SCALE_USE_PROJECT Scaling
---@field SCALE_CROP Scaling
---@field SCALE_FIT Scaling
---@field SCALE_FILL Scaling
---@field SCALE_STRETCH Scaling
---@field RESIZE_FILTER_USE_PROJECT ResizeFilter
---@field RESIZE_FILTER_SHARPER ResizeFilter
---@field RESIZE_FILTER_SMOOTHER ResizeFilter
---@field RESIZE_FILTER_BICUBIC ResizeFilter
---@field RESIZE_FILTER_BILINEAR ResizeFilter
---@field RESIZE_FILTER_BESSEL ResizeFilter
---@field RESIZE_FILTER_BOX ResizeFilter
---@field RESIZE_FILTER_CATMULL_ROM ResizeFilter
---@field RESIZE_FILTER_CUBIC ResizeFilter
---@field RESIZE_FILTER_GAUSSIAN ResizeFilter
---@field RESIZE_FILTER_LANCZOS ResizeFilter
---@field RESIZE_FILTER_MITCHELL ResizeFilter
---@field RESIZE_FILTER_NEAREST_NEIGHBOR ResizeFilter
---@field RESIZE_FILTER_QUADRATIC ResizeFilter
---@field RESIZE_FILTER_SINC ResizeFilter
---@field RESIZE_FILTER_LINEAR ResizeFilter
---@field CACHE_AUTO_ENABLED CacheMode
---@field CACHE_DISABLED CacheMode
---@field CACHE_ENABLED CacheMode
---@field DIALOGUE_LEVELER_MODE_ALLOW_WIDER_DYNAMICS DialogueLevelerMode
---@field DIALOGUE_LEVELER_MODE_OPTIMIZE_MODERATE_LEVELS DialogueLevelerMode
---@field DIALOGUE_LEVELER_MODE_MORE_LIFT_FOR_LOW_LEVELS DialogueLevelerMode
---@field DIALOGUE_LEVELER_MODE_LIFT_SOFT_WHISPERY_SOURCES DialogueLevelerMode
---@field FLATTEN_MULTICAM_COPY_GRADE FlattenMulticamGrade
---@field FLATTEN_MULTICAM_RETAIN_GRADE_FROM_ANGLE FlattenMulticamGrade
---@field EXPORT_LUT_17PTCUBE ExportLutType
---@field EXPORT_LUT_33PTCUBE ExportLutType
---@field EXPORT_LUT_65PTCUBE ExportLutType
---@field EXPORT_LUT_PANASONICVLUT ExportLutType
---@field SMART_SWITCH_QUALITY_FASTER SmartSwitchQuality
---@field SMART_SWITCH_QUALITY_BETTER SmartSwitchQuality
---@field SMART_SWITCH_WIDE_ANGLE_FREQ_LOW SmartSwitchWideAngleFrequency
---@field SMART_SWITCH_WIDE_ANGLE_FREQ_MEDIUM SmartSwitchWideAngleFrequency
---@field SMART_SWITCH_WIDE_ANGLE_FREQ_HIGH SmartSwitchWideAngleFrequency
---@field SMART_SWITCH_ANALYSIS_MODE_NONE SmartSwitchAnalysisMode
---@field SMART_SWITCH_ANALYSIS_MODE_DETECT_WIDE_ANGLE SmartSwitchAnalysisMode
---@field SMART_SWITCH_ANALYSIS_MODE_AUDIO_ONLY SmartSwitchAnalysisMode
---@field CLONE_CHECKSUM_TYPE_NONE CloneChecksumType
---@field CLONE_CHECKSUM_TYPE_FILESIZE CloneChecksumType
---@field CLONE_CHECKSUM_TYPE_CRC32 CloneChecksumType
---@field CLONE_CHECKSUM_TYPE_MD5 CloneChecksumType
---@field CLONE_CHECKSUM_TYPE_SHA256 CloneChecksumType
---@field CLONE_CHECKSUM_TYPE_SHA512 CloneChecksumType
---@field CLONE_CHECKSUM_TYPE_XXH_64 CloneChecksumType
local ResolveClass = {}

--- Returns the project manager object for currently open database
---@return ProjectManager
function ResolveClass:GetProjectManager() end

--- Returns the media storage object to query and act on media locations
---@return MediaStorage
function ResolveClass:GetMediaStorage() end

--- Starting point for Fusion scripts
---@return Fusion
function ResolveClass:Fusion() end

--- Returns the currently loaded Resolve project
---@return Project
function ResolveClass:GetCurrentProject() end

--- Returns the currently loaded timeline
---@return Timeline
function ResolveClass:GetCurrentTimeline() end

--- Returns the MediaPool object for the current project
---@return MediaPool
function ResolveClass:GetMediaPool() end

--- Returns the Gallery object for the current project
---@return Gallery
function ResolveClass:GetGallery() end

--- Switches DaVinci Resolve Page. pageName can be: 'media', 'photo', 'cut', 'edit', 'fusion', 'color', 'fairlight', 'deliver'
---@param pageName string
---@return boolean
function ResolveClass:OpenPage(pageName) end

--- Returns current DaVinci Resolve Page: 'media', 'photo', 'cut', 'edit', 'fusion', 'color', 'fairlight', 'deliver'
---@return string
function ResolveClass:GetCurrentPage() end

--- Sets the script execution priority to high or normal
---@param highPriority boolean
---@return boolean
function ResolveClass:SetHighPriority(highPriority) end

--- Returns list of product version fields in [major, minor, patch, build, suffix] format
---@return (integer|string)[]
function ResolveClass:GetVersion() end

--- Returns product version in major.minor.patch[suffix].build format
---@return string
function ResolveClass:GetVersionString() end

--- Returns product name
---@return string
function ResolveClass:GetProductName() end

--- Returns whether this is the Studio version of the product
---@return boolean
function ResolveClass:IsStudio() end

--- Returns a list of available UI layout preset names
---@return string[]
function ResolveClass:GetLayoutPresetList() end

--- Loads UI layout from saved preset
---@param presetName string
---@return boolean
function ResolveClass:LoadLayoutPreset(presetName) end

--- Overwrites preset named 'presetName' with current UI layout
---@param presetName string
---@return boolean
function ResolveClass:UpdateLayoutPreset(presetName) end

--- Exports preset named 'presetName' to path 'presetFilePath'
---@param presetName string
---@param presetFilePath string
---@return boolean
function ResolveClass:ExportLayoutPreset(presetName, presetFilePath) end

--- Deletes preset named 'presetName'
---@param presetName string
---@return boolean
function ResolveClass:DeleteLayoutPreset(presetName) end

--- Saves current UI layout as a preset
---@param presetName string
---@return boolean
function ResolveClass:SaveLayoutPreset(presetName) end

--- Imports UI layout preset from file
---@param presetFilePath string
---@param presetName? string
---@return boolean
function ResolveClass:ImportLayoutPreset(presetFilePath, presetName) end

--- Quits the Resolve App
---@return boolean
function ResolveClass:Quit() end

--- Import a render preset from a file and select it
---@param presetPath string
---@return boolean
function ResolveClass:ImportRenderPreset(presetPath) end

--- Export a render preset to a file
---@param presetName string
---@param exportPath string
---@return boolean
function ResolveClass:ExportRenderPreset(presetName, exportPath) end

--- Returns a list of available data burn in preset names
---@return string[]
function ResolveClass:GetBurnInPresetList() end

--- Deletes the named data burn in preset
---@param presetName string
---@return boolean
function ResolveClass:DeleteBurnInPreset(presetName) end

--- Import a data burn in preset from a file
---@param presetPath string
---@return boolean
function ResolveClass:ImportBurnInPreset(presetPath) end

--- Export a data burn in preset to a file
---@param presetName string
---@param exportPath string
---@return boolean
function ResolveClass:ExportBurnInPreset(presetName, exportPath) end

--- Returns a list of available keyboard preset names
---@return string[]
function ResolveClass:GetKeyboardPresetList() end

--- Loads the named keyboard preset
---@param presetName string
---@return boolean
function ResolveClass:LoadKeyboardPreset(presetName) end

--- Deletes the named keyboard preset
---@param presetName string
---@return boolean
function ResolveClass:DeleteKeyboardPreset(presetName) end

--- Returns the name of the currently active keyboard preset
---@return string
function ResolveClass:GetCurrentKeyboardPreset() end

--- Imports a keyboard preset from file. Uses file base name as preset name if not specified.
---@param filePath string
---@param presetName? string
---@return boolean
function ResolveClass:ImportKeyboardPreset(filePath, presetName) end

--- Exports the named keyboard preset to the specified file path
---@param presetName string
---@param exportPath string
---@return boolean
function ResolveClass:ExportKeyboardPreset(presetName, exportPath) end

--- Returns the currently set keyframe mode, one of the resolve.KEYFRAME_MODE_* constants. Color Page only.
---@return integer
function ResolveClass:GetKeyframeMode() end

--- Set keyframe mode
---@param keyframeMode KeyframeMode
---@return boolean
function ResolveClass:SetKeyframeMode(keyframeMode) end

--- Returns a list of Fairlight presets by name
---@return string[]
function ResolveClass:GetFairlightPresets() end

--- Disables all background tasks for current Resolve session
function ResolveClass:DisableBackgroundTasksForCurrentResolveSession() end

--- Validates DCTL source code. Returns None on success, error string on failure.
---@param dctlSource string
---@return string?
function ResolveClass:ValidateDCTL(dctlSource) end

--- Encrypts the DCTL at inputPath and writes it to an output folder.
---@param inputPath string
---@param encryptDCTLOptions? EncryptDCTLOptions
---@return boolean
function ResolveClass:EncryptDCTL(inputPath, encryptDCTLOptions) end

--- Returns a list of available user preferences preset names
---@return string[]
function ResolveClass:GetUserPreferencesPresetList() end

--- Loads the named user preferences preset
---@param presetName string
---@return boolean
function ResolveClass:LoadUserPreferencesPreset(presetName) end

--- Saves current user preferences as a preset with the given name
---@param presetName string
---@return boolean
function ResolveClass:SaveUserPreferencesPreset(presetName) end

--- Deletes the named user preferences preset
---@param presetName string
---@return boolean
function ResolveClass:DeleteUserPreferencesPreset(presetName) end

--- Imports a user preferences preset from file. Uses file base name as preset name if not specified.
---@param filePath string
---@param presetName? string
---@return boolean
function ResolveClass:ImportUserPreferencesPreset(filePath, presetName) end

--- Exports the named user preferences preset to the specified file path
---@param presetName string
---@param exportPath string
---@return boolean
function ResolveClass:ExportUserPreferencesPreset(presetName, exportPath) end

--- Creates, loads and organizes projects, project folders and databases. See README.md section 'Cloud Projects Settings'.
---@class ProjectManager
local ProjectManager = {}

--- Loads and returns a project. Returns None if project was not found.
---@param projectName string
---@return Project?
function ProjectManager:LoadProject(projectName) end

--- Creates and returns a project. Returns None if projectName exists.
---@param projectName string
---@param mediaLocationPath? string
---@return Project?
function ProjectManager:CreateProject(projectName, mediaLocationPath) end

--- Delete project in the current folder. Project must not be currently loaded.
---@param projectName string
---@return boolean
function ProjectManager:DeleteProject(projectName) end

--- Saves the currently loaded project with its own name.
---@return boolean
function ProjectManager:SaveProject() end

--- Returns the currently loaded Resolve project
---@return Project
function ProjectManager:GetCurrentProject() end

--- Creates a folder. Returns False if it already existed.
---@param folderName string
---@return boolean
function ProjectManager:CreateFolder(folderName) end

--- Returns a list of project names in current folder
---@return string[]
function ProjectManager:GetProjectListInCurrentFolder() end

--- Returns a list of folder names in current folder
---@return string[]
function ProjectManager:GetFolderListInCurrentFolder() end

--- Opens root folder in database
---@return boolean
function ProjectManager:GotoRootFolder() end

--- Opens parent folder of current folder in database. Returns False if current folder has no parent.
---@return boolean
function ProjectManager:GotoParentFolder() end

--- Opens folder
---@param folderName string
---@return boolean
function ProjectManager:OpenFolder(folderName) end

--- Imports a project from the file
---@param filePath string
---@param projectName? string
---@return boolean
function ProjectManager:ImportProject(filePath, projectName) end

--- Exports project to a file.
---@param projectName string
---@param filePath string
---@param withStillsAndLUTs? boolean
---@return boolean
function ProjectManager:ExportProject(projectName, filePath, withStillsAndLUTs) end

--- Archives project to a file
---@param projectName string
---@param filePath string
---@param isArchiveSrcMedia? boolean
---@param isArchiveRenderCache? boolean
---@param isArchiveProxyMedia? boolean
---@return boolean
function ProjectManager:ArchiveProject(projectName, filePath, isArchiveSrcMedia, isArchiveRenderCache, isArchiveProxyMedia) end

--- Restores a project from the file
---@param filePath string
---@param projectName? string
---@return boolean
function ProjectManager:RestoreProject(filePath, projectName) end

--- Returns the last modified time of the project as an epoch timestamp
---@param projectName string
---@return integer
function ProjectManager:GetProjectLastModifiedTime(projectName) end

--- Returns a dict of project names mapped to their attributes (lastModifiedDate, creationDate, notes, liveCollaborationMode) for all projects in the current folder
---@return table<string, ProjectAttributes>
function ProjectManager:GetProjectAttributesInCurrentFolder() end

--- Closes the specified project without saving
---@param project Project
---@return boolean
function ProjectManager:CloseProject(project) end

--- Returns the current folder name
---@return string
function ProjectManager:GetCurrentFolder() end

--- Deletes the specified folder
---@param folderName string
---@return boolean
function ProjectManager:DeleteFolder(folderName) end

--- Returns a dictionary (with keys 'DbType', 'DbName' and optional 'IpAddress') corresponding to the current database connection
---@return DatabaseInfo
function ProjectManager:GetCurrentDatabase() end

--- Returns a list of dictionary items (with keys 'DbType', 'DbName' and optional 'IpAddress') corresponding to all the databases added to Resolve
---@return DatabaseInfo[]
function ProjectManager:GetDatabaseList() end

--- Switches current database connection to the database specified by the keys below, and closes any open project
---@param dbInfo DatabaseInfo
---@return boolean
function ProjectManager:SetCurrentDatabase(dbInfo) end

--- Loads and returns a cloud project with the given cloud settings. Returns None if not found
---@param cloudSettings CloudSettings
---@return Project?
function ProjectManager:LoadCloudProject(cloudSettings) end

--- Creates and returns a cloud project
---@param cloudSettings CloudSettings
---@return Project?
function ProjectManager:CreateCloudProject(cloudSettings) end

--- Imports a cloud project from the file path with given cloud settings
---@param filePath string
---@param cloudSettings CloudSettings
---@return boolean
function ProjectManager:ImportCloudProject(filePath, cloudSettings) end

--- Restores a cloud project from the folder path with given cloud settings
---@param folderPath string
---@param cloudSettings CloudSettings
---@return boolean
function ProjectManager:RestoreCloudProject(folderPath, cloudSettings) end

--- A project: timelines, settings, presets and render jobs. See README.md section 'Looking up Project and Clip properties'.
---@class Project
local Project = {}

--- Returns the MediaPool object
---@return MediaPool
function Project:GetMediaPool() end

--- Returns the currently loaded timeline
---@return Timeline
function Project:GetCurrentTimeline() end

--- Sets given timeline as current timeline for the project
---@param timeline Timeline
---@return boolean
function Project:SetCurrentTimeline(timeline) end

--- Returns the number of timelines in the project
---@return integer
function Project:GetTimelineCount() end

--- Returns timeline at the given index, 1 <= idx <= project.GetTimelineCount()
---@param idx integer
---@return Timeline?
function Project:GetTimelineByIndex(idx) end

--- Returns the Gallery object
---@return Gallery
function Project:GetGallery() end

--- Returns project name
---@return string
function Project:GetName() end

--- Sets project name if given projectName is unique
---@param projectName string
---@return boolean
function Project:SetName(projectName) end

--- Returns a list of project settings presets and their information
---@return ProjectSettingsPresetInfo[]
function Project:GetProjectSettingsPresetList() end

--- Sets project settings preset by given name into project
---@param presetName string
---@return boolean
function Project:SetProjectSettingsPreset(presetName) end

--- Deletes the project settings preset with the given name
---@param presetName string
---@return boolean
function Project:DeleteProjectSettingsPreset(presetName) end

--- Saves the current project settings as a new preset with the given name
---@param presetName string
---@return boolean
function Project:SaveCurrentProjectSettingsAsNewPreset(presetName) end

--- Updates the given project settings preset with current settings
---@param presetName string
---@return boolean
function Project:UpdateProjectSettingsPreset(presetName) end

--- Exports the given project settings preset to the specified file path
---@param presetName string
---@param exportPath string
---@return boolean
function Project:ExportProjectSettingsPreset(presetName, exportPath) end

--- Imports a project settings preset from file. Uses file base name as preset name if not specified.
---@param presetFilePath string
---@param presetName? string
---@return boolean
function Project:ImportProjectSettingsPreset(presetFilePath, presetName) end

--- Returns a list of render jobs and their information
---@return RenderJobInfo[]
function Project:GetRenderJobList() end

--- Returns a list of render preset names
---@return string[]
function Project:GetRenderPresetList() end

--- Loads a render preset by name
---@param presetName string
---@return boolean
function Project:LoadRenderPreset(presetName) end

--- Saves current render settings as a new preset with the given name
---@param presetName string
---@return boolean
function Project:SaveAsNewRenderPreset(presetName) end

--- Deletes given render preset
---@param presetName string
---@return boolean
function Project:DeleteRenderPreset(presetName) end

--- Updates given render preset with current render settings
---@param presetName string
---@return boolean
function Project:UpdateRenderPreset(presetName) end

--- Enables or disables quick export for the named render preset
---@param presetName string
---@param isEnabled boolean
---@return boolean
function Project:SetQuickExportEnabledForRenderPreset(presetName, isEnabled) end

--- Starts rendering jobs indicated by the input job ids
---@param jobIds string[]
---@param isInteractiveMode? boolean
---@return boolean
function Project:StartRendering(jobIds, isInteractiveMode) end

--- Stops any current render processes
function Project:StopRendering() end

--- Returns True if a rendering is in progress
---@return boolean
function Project:IsRenderingInProgress() end

--- Adds a render job based on current render settings to the render queue
---@return string
function Project:AddRenderJob() end

--- Deletes render job for input job id
---@param jobId string
---@return boolean
function Project:DeleteRenderJob(jobId) end

--- Deletes all render jobs in the queue
---@return boolean
function Project:DeleteAllRenderJobs() end

--- Sets given settings for rendering
---@param settings RenderSettings
---@return boolean
function Project:SetRenderSettings(settings) end

--- Returns list of resolutions applicable for the given render format and codec
---@param format? string
---@param codec? string
---@return ResolutionInfo[]
function Project:GetRenderResolutions(format, codec) end

--- Returns a dict with all project settings. See README.md section 'Looking up Project and Clip properties'.
---@return ProjectSettings
function Project:GetSettings() end

--- Sets the project settings with specified dict of setting names and values. See README.md section 'Looking up Project and Clip properties'.
---@param settings ProjectSettings
---@return boolean
function Project:SetSettings(settings) end

--- Returns a dict with job status and completion percentage
---@param jobId string
---@return RenderJobStatus
function Project:GetRenderJobStatus(jobId) end

--- Returns a list of quick export render presets
---@return string[]
function Project:GetQuickExportRenderPresets() end

--- Renders current timeline with quick export preset
---@param quickExportPresetName string
---@param presetInfo QuickExportRenderSettings
---@return QuickExportRenderStatus
function Project:RenderWithQuickExport(quickExportPresetName, presetInfo) end

--- Returns a dict (format -> file extension) of available render formats
---@return table
function Project:GetRenderFormats() end

--- Returns a dict (format -> file extension) of available audio render formats
---@return table
function Project:GetAudioRenderFormats() end

--- Returns a dict (codec description -> codec name) of available codecs
---@param renderFormatFileExtension string
---@return table
function Project:GetRenderCodecs(renderFormatFileExtension) end

--- Returns a dict (codec description -> codec name) of available audio codecs for the given format
---@param audioRenderFormatFileExtension string
---@return table
function Project:GetAudioRenderCodecs(audioRenderFormatFileExtension) end

--- Returns a dict with currently selected format and render codec
---@return table<string, string>
function Project:GetCurrentRenderFormatAndCodec() end

--- Sets given render format and render codec as options for rendering
---@param format string
---@param codec string
---@return boolean
function Project:SetCurrentRenderFormatAndCodec(format, codec) end

--- Returns the render mode: 0 - Individual clips, 1 - Single clip
---@return integer
function Project:GetCurrentRenderMode() end

--- Sets the render mode: 0 for Individual clips, 1 for Single clip
---@param renderMode integer
---@return boolean
function Project:SetCurrentRenderMode(renderMode) end

--- Refreshes LUT List
---@return boolean
function Project:RefreshLUTList() end

--- Returns a unique ID for the project item
---@return string
function Project:GetUniqueId() end

--- Inserts the media with startOffset and duration in samples to the current track at the playhead
---@param mediaPath string
---@param startOffsetInSamples integer
---@param durationInSamples integer
---@return boolean
function Project:InsertAudioToCurrentTrackAtPlayhead(mediaPath, startOffsetInSamples, durationInSamples) end

--- Loads user defined data burn in preset
---@param presetName string
---@return boolean
function Project:LoadBurnInPreset(presetName) end

--- Exports current frame as still to supplied filePath
---@param filePath string
---@return boolean
function Project:ExportCurrentFrameAsStill(filePath) end

--- Returns a list of all group objects in the timeline
---@return ColorGroup[]
function Project:GetColorGroupsList() end

--- Creates a new ColorGroup with unique groupName
---@param groupName string
---@return ColorGroup
function Project:AddColorGroup(groupName) end

--- Deletes the given ColorGroup and sets clips to ungrouped
---@param colorGroup ColorGroup
---@return boolean
function Project:DeleteColorGroup(colorGroup) end

--- Applies Fairlight preset to current timeline
---@param presetName string
---@return boolean
function Project:ApplyFairlightPresetToCurrentTimeline(presetName) end

--- Resets intellisearch analysis for the project
---@return boolean
function Project:ResetIntellisearchAnalysis() end

--- Generates speech for given speechSettings dict
---@param speechSettings SpeechSettings
---@return MediaPoolItem
function Project:GenerateSpeech(speechSettings) end

---@deprecated Returns a dict of presets and their information. (README "Deprecated Resolve API Functions")
---@param ... any
---@return any
function Project:GetPresets(...) end

---@deprecated Returns a dict of render presets and their information. (README "Deprecated Resolve API Functions")
---@param ... any
---@return any
function Project:GetRenderPresets(...) end

---@deprecated Returns a list of presets and their information. (README "Deprecated Resolve API Functions")
---@param ... any
---@return any
function Project:GetPresetList(...) end

---@deprecated Sets preset by given presetName (string) into project. (README "Deprecated Resolve API Functions")
---@param ... any
---@return any
function Project:SetPreset(...) end

---@deprecated Please use unique job ids (string) instead of indices. (README "Unsupported Resolve API Functions")
---@param ... any
---@return any
function Project:DeleteRenderJobByIndex(...) end

---@deprecated Use GetSettings(), which returns a dict of all settings, and index into the result. (README "Deprecated Calling Conventions")
---@param ... any
---@return any
function Project:GetSetting(...) end

---@deprecated Use SetSettings({settings}); for single keys SetSettings({timelineFrameRate = "24"}). Only the 4-argument superScale form is not deprecated. (README "Deprecated Calling Conventions")
---@param ... any
---@return any
function Project:SetSetting(...) end

--- The media pool of a project: its folders, its clips and the timelines created from them.
---@class MediaPool
local MediaPool = {}

--- Adds new subfolder under specified Folder object with the given name
---@param folder Folder
---@param name string
---@return Folder
function MediaPool:AddSubFolder(folder, name) end

--- Returns currently selected Folder
---@return Folder
function MediaPool:GetCurrentFolder() end

--- Updates the folders in collaboration mode
---@return boolean
function MediaPool:RefreshFolders() end

--- Sets current folder by given Folder
---@param folder Folder
---@return boolean
function MediaPool:SetCurrentFolder(folder) end

--- Returns root Folder of Media Pool
---@return Folder
function MediaPool:GetRootFolder() end

--- Creates new timeline with specified name, and appends the specified MediaPoolItem objects
---@param name string
---@param clipInfos CreateTimelineClipInfo[]
---@return Timeline
function MediaPool:CreateTimelineFromClips(name, clipInfos) end

--- Appends specified MediaPoolItem objects in the current timeline. Returns the list of appended timelineItems
---@param clipInfos AppendClipInfo[]
---@return TimelineItem[]
function MediaPool:AppendToTimeline(clipInfos) end

--- Adds new timeline with given name
---@param name string
---@return Timeline
function MediaPool:CreateEmptyTimeline(name) end

--- Creates timeline based on parameters within given file (AAF/EDL/XML/FCPXML/DRT/ADL/OTIO) and optional importOptions dict
---@param filePath string
---@param importOptions? ImportOptions
---@return Timeline
function MediaPool:ImportTimelineFromFile(filePath, importOptions) end

--- Deletes specified timelines in the media pool
---@param timelines Timeline[]
---@return boolean
function MediaPool:DeleteTimelines(timelines) end

--- Exports metadata of specified clips to 'fileName' in CSV format. If no clips are specified, all clips from media pool will be used
---@param fileName string
---@param clips? MediaPoolItem[]
---@return boolean
function MediaPool:ExportMetadata(fileName, clips) end

--- Deletes specified clips or timeline mattes in the media pool
---@param clips MediaPoolItem[]
---@return boolean
function MediaPool:DeleteClips(clips) end

--- Imports a DRB folder from the given file path
---@param filePath string
---@param sourceClipsPath? string
---@return boolean
function MediaPool:ImportFolderFromFile(filePath, sourceClipsPath) end

--- Deletes specified subfolders in the media pool
---@param subfolders Folder[]
---@return boolean
function MediaPool:DeleteFolders(subfolders) end

--- Moves specified clips to target folder
---@param clips MediaPoolItem[]
---@param targetFolder Folder
---@return boolean
function MediaPool:MoveClips(clips, targetFolder) end

--- Moves specified folders to target folder
---@param folders Folder[]
---@param targetFolder Folder
---@return boolean
function MediaPool:MoveFolders(folders, targetFolder) end

--- Get mattes for specified MediaPoolItem, as a list of paths to the matte files
---@param mediaPoolItem MediaPoolItem
---@return string[]
function MediaPool:GetClipMatteList(mediaPoolItem) end

--- Get mattes in specified Folder, as list of MediaPoolItems
---@param folder Folder
---@return MediaPoolItem[]
function MediaPool:GetTimelineMatteList(folder) end

--- Delete mattes based on their file paths, for specified MediaPoolItem
---@param mediaPoolItem MediaPoolItem
---@param paths string[]
---@return boolean
function MediaPool:DeleteClipMattes(mediaPoolItem, paths) end

--- Update the folder location of specified media pool clips with the specified folder path
---@param clips MediaPoolItem[]
---@param folderPath string
---@return boolean
function MediaPool:RelinkClips(clips, folderPath) end

--- Unlink specified media pool clips
---@param clips MediaPoolItem[]
---@return boolean
function MediaPool:UnlinkClips(clips) end

--- Imports specified file/folder paths into current Media Pool folder. Returns a list of the MediaPoolItems created
---@param clipInfos ImportClipInfo[]
---@return MediaPoolItem[]
function MediaPool:ImportMedia(clipInfos) end

--- Returns a unique ID for the media pool
---@return string
function MediaPool:GetUniqueId() end

--- Takes in two existing media pool items and creates a new 3D stereoscopic media pool entry replacing the input media
---@param leftMediaPoolItem MediaPoolItem
---@param rightMediaPoolItem MediaPoolItem
---@return MediaPoolItem
function MediaPool:CreateStereoClip(leftMediaPoolItem, rightMediaPoolItem) end

--- Creates Multicam clips from the specified MediaPoolItems and options
---@param clips MediaPoolItem[]
---@param multicamOptions MulticamOptions
---@return MediaPoolItem[]
function MediaPool:CreateMulticamClip(clips, multicamOptions) end

--- Syncs audio for specified MediaPoolItems. The list must contain at least one video and one audio clip.
---@param mediaPoolItems MediaPoolItem[]
---@param audioSyncSettings AudioSyncSettings
---@return boolean
function MediaPool:AutoSyncAudio(mediaPoolItems, audioSyncSettings) end

--- Returns the current selected MediaPoolItems
---@return MediaPoolItem[]
function MediaPool:GetSelectedClips() end

--- Sets the selected MediaPoolItem to the given MediaPoolItem
---@param mediaPoolItem MediaPoolItem
---@return boolean
function MediaPool:SetSelectedClip(mediaPoolItem) end

--- A clip in the media pool. See README.md section 'Looking up Project and Clip properties'.
---@class MediaPoolItem
local MediaPoolItem = {}

--- Returns the clip name.
---@return string
function MediaPoolItem:GetName() end

--- Sets the clip's name to name(string).
---@param name string
---@return boolean
function MediaPoolItem:SetName(name) end

--- Returns the timeline object if the mpItem is a timeline clip
---@return Timeline
function MediaPoolItem:GetTimeline() end

--- Returns the metadata value for the key 'metadataType'. If no argument is specified, a dict of all set metadata properties is returned.
---@param metadataType? string
---@return string|table
function MediaPoolItem:GetMetadata(metadataType) end

--- Sets the item metadata with specified dict of key-value pairs
---@param metadata table
---@return boolean
function MediaPoolItem:SetMetadata(metadata) end

--- Returns the third party metadata value for the key 'metadataType'. If no argument, a dict of all set third party metadata properties is returned.
---@param metadataType? string
---@return string|table
function MediaPoolItem:GetThirdPartyMetadata(metadataType) end

--- Sets/Add the item third party metadata with specified dict of key-value pairs
---@param metadata table
---@return boolean
function MediaPoolItem:SetThirdPartyMetadata(metadata) end

--- Returns the unique ID for the MediaPoolItem.
---@return string
function MediaPoolItem:GetMediaId() end

--- Creates a new marker at given frameId position. 'customData' is optional.
---@param frameId integer
---@param color MarkerColor
---@param name string
---@param note string
---@param duration integer
---@param customData? string
---@return boolean
function MediaPoolItem:AddMarker(frameId, color, name, note, duration, customData) end

--- Delete all markers of the specified color. 'All' as argument deletes all color markers.
---@param color MarkerColor|"All"
---@return boolean
function MediaPoolItem:DeleteMarkersByColor(color) end

--- Delete marker at frame number from the media pool item.
---@param frameNum integer
---@return boolean
function MediaPoolItem:DeleteMarkerAtFrame(frameNum) end

--- Delete first matching marker with specified customData.
---@param customData string
---@return boolean
function MediaPoolItem:DeleteMarkerByCustomData(customData) end

--- Returns a dict (frameId -> {information}) of all markers.
---@return table<integer, MarkerInfo>
function MediaPoolItem:GetMarkers() end

--- Returns marker {information} for the first matching marker with specified customData.
---@param customData string
---@return MarkerInfo
function MediaPoolItem:GetMarkerByCustomData(customData) end

--- Updates customData for the marker at given frameId position.
---@param frameId integer
---@param customData string
---@return boolean
function MediaPoolItem:UpdateMarkerCustomData(frameId, customData) end

--- Returns customData string for the marker at given frameId position.
---@param frameId integer
---@return string
function MediaPoolItem:GetMarkerCustomData(frameId) end

--- Adds a flag with given color (string).
---@param color FlagColor
---@return boolean
function MediaPoolItem:AddFlag(color) end

--- Returns a list of flag colors assigned to the item.
---@return string[]
function MediaPoolItem:GetFlagList() end

--- Clears the flag of the given color if one exists. An 'All' argument is supported and clears all flags.
---@param color FlagColor|"All"
---@return boolean
function MediaPoolItem:ClearFlags(color) end

--- Returns the item color as a string.
---@return ClipColor|string
function MediaPoolItem:GetClipColor() end

--- Sets the item color based on the colorName (string).
---@param colorName ClipColor
---@return boolean
function MediaPoolItem:SetClipColor(colorName) end

--- Clears the item color.
---@return boolean
function MediaPoolItem:ClearClipColor() end

--- Links proxy media to full resolution media files specified via its path.
---@param fullResMediaPath string
---@return boolean
function MediaPoolItem:LinkFullResolutionMedia(fullResMediaPath) end

--- Links proxy media located at path specified by arg 'proxyMediaFilePath' with the current clip.
---@param proxyMediaFilePath string
---@return boolean
function MediaPoolItem:LinkProxyMedia(proxyMediaFilePath) end

--- Unlinks any proxy media associated with clip.
---@return boolean
function MediaPoolItem:UnlinkProxyMedia() end

--- Replaces the underlying asset and metadata of MediaPoolItem with the specified absolute clip path.
---@param filePath string
---@return boolean
function MediaPoolItem:ReplaceClip(filePath) end

--- Replaces the underlying asset and metadata preserving original sub clip extents.
---@param filePath string
---@return boolean
function MediaPoolItem:ReplaceClipPreserveSubClip(filePath) end

--- Returns the property value for the key 'propertyName'. If no argument, a dict of all clip properties is returned.
---@param propertyName? string
---@return string|ClipProperties
function MediaPoolItem:GetClipProperty(propertyName) end

--- Sets the given property to propertyValue (string).
---@param propertyName string
---@param propertyValue string
---@return boolean
function MediaPoolItem:SetClipProperty(propertyName, propertyValue) end

--- Returns a unique ID for the media pool item
---@return string
function MediaPoolItem:GetUniqueId() end

--- Transcribes audio of the MediaPoolItem
---@param useSpeakerDetection? boolean
---@param transcribeAsNestedClip? boolean
---@return boolean
function MediaPoolItem:TranscribeAudio(useSpeakerDetection, transcribeAsNestedClip) end

--- Clears audio transcription of the MediaPoolItem.
---@param clearNestedClipTranscription? boolean
---@return boolean
function MediaPoolItem:ClearTranscription(clearNestedClipTranscription) end

--- Analyzes and classifies the audio of a MediaPoolItem.
---@return boolean
function MediaPoolItem:PerformAudioClassification() end

--- Clears audio classification of the MediaPoolItem.
---@return boolean
function MediaPoolItem:ClearAudioClassification() end

--- Returns a string with MediaPoolItem's audio mapping information (JSON format).
---@return string
function MediaPoolItem:GetAudioMapping() end

--- Sets audio mapping from a JSON string.
---@param audioMapping string
---@return boolean
function MediaPoolItem:SetAudioMapping(audioMapping) end

--- Returns dict of in/out marks set.
---@return MarkInOut
function MediaPoolItem:GetMarkInOut() end

--- Sets mark in/out of type MarkType (default: 'all').
---@param markIn integer
---@param markOut integer
---@param markType? MarkType
---@return boolean
function MediaPoolItem:SetMarkInOut(markIn, markOut, markType) end

--- Clears mark in/out of type MarkType (default: 'all').
---@param markType? MarkType
---@return boolean
function MediaPoolItem:ClearMarkInOut(markType) end

--- Monitor a file as long as it keeps growing.
---@return boolean
function MediaPoolItem:MonitorGrowingFile() end

--- Apply Motion Deblur on MediaPoolItem, Returns newly created MediaPoolItem.
---@param deblurOption DeblurOptions
---@return MediaPoolItem
function MediaPoolItem:RemoveMotionBlur(deblurOption) end

--- Perform Intellisearch analysis on the MediaPoolItem.
---@param identifyFaces boolean
---@param isBetterMode boolean
---@return boolean
function MediaPoolItem:AnalyzeForIntellisearch(identifyFaces, isBetterMode) end

--- Perform Slate analysis on the MediaPoolItem.
---@param markerColor SlateMarkerColor
---@return boolean
function MediaPoolItem:AnalyzeForSlate(markerColor) end

--- Returns transcription data for the media pool item if available.
---@param useNestedClipTranscription? boolean
---@return Transcription
function MediaPoolItem:GetTranscription(useNestedClipTranscription) end

---@deprecated Returns a dict of flag colors assigned to the item. (README "Deprecated Resolve API Functions")
---@param ... any
---@return any
function MediaPoolItem:GetFlags(...) end

--- A timeline: tracks, items, markers and export. See README.md section 'Looking up timeline export properties'.
---@class Timeline
local Timeline = {}

--- Returns the timeline name.
---@return string
function Timeline:GetName() end

--- Sets the timeline name if timelineName (string) is unique.
---@param timelineName string
---@return boolean
function Timeline:SetName(timelineName) end

--- Returns the frame number at the start of timeline.
---@return integer
function Timeline:GetStartFrame() end

--- Returns the frame number at the end of timeline.
---@return integer
function Timeline:GetEndFrame() end

--- Returns the number of tracks for the given TrackType.
---@param trackType TrackType
---@return integer
function Timeline:GetTrackCount(trackType) end

--- Returns a list of timeline items on specified track.
---@param trackType TrackType
---@param index integer
---@return TimelineItem[]
function Timeline:GetItemListInTrack(trackType, index) end

--- Returns the currently selected timeline items
---@return TimelineItem[]
function Timeline:GetSelectedClips() end

--- Returns a string timecode representation for the current playhead position.
---@return string
function Timeline:GetCurrentTimecode() end

--- Sets current playhead position from input timecode.
---@param timecode string
---@return boolean
function Timeline:SetCurrentTimecode(timecode) end

--- Returns the current video timeline item.
---@return TimelineItem?
function Timeline:GetCurrentVideoItem() end

--- Creates a new marker at given frameId position.
---@param frameId integer
---@param color MarkerColor
---@param name string
---@param note string
---@param duration integer
---@param customData? string
---@return boolean
function Timeline:AddMarker(frameId, color, name, note, duration, customData) end

--- Deletes all timeline markers of the specified color.
---@param color MarkerColor|"All"
---@return boolean
function Timeline:DeleteMarkersByColor(color) end

--- Deletes the timeline marker at the given frame number.
---@param frameNum integer
---@return boolean
function Timeline:DeleteMarkerAtFrame(frameNum) end

--- Delete first matching marker with specified customData.
---@param customData string
---@return boolean
function Timeline:DeleteMarkerByCustomData(customData) end

--- Returns a dict (frameId -> {information}) of all markers.
---@return table<integer, MarkerInfo>
function Timeline:GetMarkers() end

--- Returns marker {information} for the first matching marker with specified customData.
---@param customData string
---@return MarkerInfo
function Timeline:GetMarkerByCustomData(customData) end

--- Updates customData for the marker at given frameId position.
---@param frameId integer
---@param customData string
---@return boolean
function Timeline:UpdateMarkerCustomData(frameId, customData) end

--- Returns customData string for the marker at given frameId position.
---@param frameId integer
---@return string
function Timeline:GetMarkerCustomData(frameId) end

--- Returns a dict with data containing raw thumbnail image data for current media in the Color Page.
---@return ThumbnailData
function Timeline:GetCurrentClipThumbnailImage() end

--- Adds track of TrackType. Optional argument subTrackType.
---@param trackType TrackType
---@param subTrackType? string
---@return boolean
function Timeline:AddTrack(trackType, subTrackType) end

--- Deletes track of trackType and given trackIndex. 1 <= trackIndex <= GetTrackCount(trackType).
---@param trackType TrackType
---@param trackIndex integer
---@return boolean
function Timeline:DeleteTrack(trackType, trackIndex) end

--- Returns an audio track's format.
---@param trackType TrackType
---@param trackIndex integer
---@return string
function Timeline:GetTrackSubType(trackType, trackIndex) end

--- Enables/Disables track with given trackType and trackIndex
---@param trackType TrackType
---@param trackIndex integer
---@param enabled boolean
---@return boolean
function Timeline:SetTrackEnable(trackType, trackIndex, enabled) end

--- Returns True if track with given trackType and trackIndex is enabled.
---@param trackType TrackType
---@param trackIndex integer
---@return boolean
function Timeline:GetIsTrackEnabled(trackType, trackIndex) end

--- Locks/Unlocks track with given trackType and trackIndex
---@param trackType TrackType
---@param trackIndex integer
---@param locked boolean
---@return boolean
function Timeline:SetTrackLock(trackType, trackIndex, locked) end

--- Returns True if track with given trackType and trackIndex is locked.
---@param trackType TrackType
---@param trackIndex integer
---@return boolean
function Timeline:GetIsTrackLocked(trackType, trackIndex) end

--- Deletes specified TimelineItems from the timeline, performing ripple delete if second argument is True.
---@param timelineItems TimelineItem[]
---@param rippleDelete? boolean
---@return boolean
function Timeline:DeleteClips(timelineItems, rippleDelete) end

--- Links or unlinks the specified TimelineItems depending on second argument.
---@param timelineItems TimelineItem[]
---@param linked boolean
---@return boolean
function Timeline:SetClipsLinked(timelineItems, linked) end

--- Normalizes the audio level of specified TimelineItems using the given normalizeAudioOptions.
---@param timelineItems TimelineItem[]
---@param normalizeAudioOptions? NormalizeAudioOptions
---@return boolean
function Timeline:NormalizeAudioLevel(timelineItems, normalizeAudioOptions) end

--- Aligns specified TimelineItems using the given options. Returns True if successful, False otherwise.
---@param timelineItems TimelineItem[]
---@param autoAlignOptions? AutoAlignOptions
---@return boolean
function Timeline:AutoAlignClips(timelineItems, autoAlignOptions) end

--- Returns the list of valid normalizationMode strings for NormalizeAudioLevel.
---@return string[]
function Timeline:GetNormalizeAudioModes() end

--- Returns the track name for track indicated by trackType and index.
---@param trackType TrackType
---@param trackIndex integer
---@return string
function Timeline:GetTrackName(trackType, trackIndex) end

--- Sets the track name for track indicated by trackType and index.
---@param trackType TrackType
---@param trackIndex integer
---@param name string
---@return boolean
function Timeline:SetTrackName(trackType, trackIndex, name) end

--- Duplicates the timeline and returns the created timeline.
---@param timelineName string
---@return Timeline
function Timeline:DuplicateTimeline(timelineName) end

--- Grabs still from the current video clip. Returns a GalleryStill object.
---@return GalleryStill
function Timeline:GrabStill() end

--- Grabs stills from all clips at 'stillFrameSource' (1=First frame, 2=Middle frame).
---@param stillFrameSource integer
---@return GalleryStill[]
function Timeline:GrabAllStills(stillFrameSource) end

--- Creates a compound clip of input timeline items.
---@param timelineItems TimelineItem[]
---@param clipInfo? CompoundClipOptions
---@return TimelineItem
function Timeline:CreateCompoundClip(timelineItems, clipInfo) end

--- Creates a Fusion clip of input timeline items.
---@param timelineItems TimelineItem[]
---@return TimelineItem
function Timeline:CreateFusionClip(timelineItems) end

--- Exports timeline to 'fileName' as per input exportType & exportSubtype format. See README.md section 'Looking up timeline export properties'.
---@param fileName string
---@param exportType TimelineExportType
---@param exportSubtype TimelineExportSubtype
---@return boolean
function Timeline:Export(fileName, exportType, exportSubtype) end

--- Returns a dict with all timeline settings, or the project settings when useCustomSettings is '0'. See README.md section 'Looking up Project and Clip properties'.
---@return TimelineSettings|ProjectSettings
function Timeline:GetSettings() end

--- Sets the timeline settings with specified dict of setting names and values. See README.md section 'Looking up Project and Clip properties'.
---@param settings TimelineSettings
---@return boolean
function Timeline:SetSettings(settings) end

--- Returns the start timecode for the timeline.
---@return string
function Timeline:GetStartTimecode() end

--- Set the start timecode of the timeline to the string 'timecode'.
---@param timecode string
---@return boolean
function Timeline:SetStartTimecode(timecode) end

--- Imports timeline items from an AAF file.
---@param filePath string
---@param importOptions? AAFImportOptions
---@return boolean
function Timeline:ImportIntoTimeline(filePath, importOptions) end

--- Inserts a generator into the timeline.
---@param generatorName string
---@return TimelineItem
function Timeline:InsertGeneratorIntoTimeline(generatorName) end

--- Inserts a Fusion generator into the timeline.
---@param generatorName string
---@return TimelineItem
function Timeline:InsertFusionGeneratorIntoTimeline(generatorName) end

--- Inserts a Fusion composition into the timeline.
---@return TimelineItem
function Timeline:InsertFusionCompositionIntoTimeline() end

--- Inserts an OFX generator into the timeline.
---@param generatorName string
---@return TimelineItem
function Timeline:InsertOFXGeneratorIntoTimeline(generatorName) end

--- Inserts a title into the timeline.
---@param titleName string
---@return TimelineItem
function Timeline:InsertTitleIntoTimeline(titleName) end

--- Inserts a Fusion title into the timeline.
---@param titleName string
---@return TimelineItem
function Timeline:InsertFusionTitleIntoTimeline(titleName) end

--- Creates subtitles from audio for the timeline.
---@param autoCaptionSettings? AutoCaptionSettings
---@return boolean
function Timeline:CreateSubtitlesFromAudio(autoCaptionSettings) end

--- Returns a unique ID for the timeline
---@return string
function Timeline:GetUniqueId() end

--- Detects and makes scene cuts along the timeline.
---@return boolean
function Timeline:DetectSceneCuts() end

--- Converts timeline to stereo.
---@return boolean
function Timeline:ConvertTimelineToStereo() end

--- Returns the timeline's node graph object.
---@return Graph
function Timeline:GetNodeGraph() end

--- Analyzes Dolby Vision on clips present on the timeline.
---@param timelineItems TimelineItem[]
---@param analysisType DolbyVisionAnalysisType
---@return boolean
function Timeline:AnalyzeDolbyVision(timelineItems, analysisType) end

--- Returns the media pool item corresponding to the timeline
---@return MediaPoolItem?
function Timeline:GetMediaPoolItem() end

--- Returns dict of in/out marks set.
---@return MarkInOut
function Timeline:GetMarkInOut() end

--- Sets mark in/out of type MarkType (default: 'all')
---@param markIn integer
---@param markOut integer
---@param markType? MarkType
---@return boolean
function Timeline:SetMarkInOut(markIn, markOut, markType) end

--- Clears mark in/out of type MarkType (default: 'all')
---@param markType? MarkType
---@return boolean
function Timeline:ClearMarkInOut(markType) end

--- Returns the Voice Isolation State as a dict.
---@param trackIndex integer
---@return VoiceIsolationState
function Timeline:GetVoiceIsolationState(trackIndex) end

--- Sets Voice Isolation state of audio track.
---@param trackIndex integer
---@param voiceIsolationState VoiceIsolationState
---@return boolean
function Timeline:SetVoiceIsolationState(trackIndex, voiceIsolationState) end

--- Sets the output blanking for the timeline. Accepts a dictionary with keys 'Top', 'Bottom', 'Left' and 'Right'. The values are in pixels.
---@param outputBlanking OutputBlanking
---@return boolean
function Timeline:SetOutputBlanking(outputBlanking) end

--- Returns the output blanking for the timeline as a dictionary with keys 'Top', 'Bottom', 'Left' and 'Right'. The values are in pixels.
---@return OutputBlanking
function Timeline:GetOutputBlanking() end

---@deprecated Returns a dict of Timeline items on the video or audio track (based on trackType) at specified (README "Deprecated Resolve API Functions")
---@param ... any
---@return any
function Timeline:GetItemsInTrack(...) end

---@deprecated Use GetSettings(), which returns a dict of all settings, and index into the result. (README "Deprecated Calling Conventions")
---@param ... any
---@return any
function Timeline:GetSetting(...) end

---@deprecated Use SetSettings({settings}); for single keys SetSettings({timelineFrameRate = "24"}). Only the 4-argument superScale form is not deprecated. (README "Deprecated Calling Conventions")
---@param ... any
---@return any
function Timeline:SetSetting(...) end

--- A clip, title, generator or transition on a timeline track. See README.md section 'Looking up Timeline item properties'.
---@class TimelineItem
local TimelineItem = {}

--- Returns the type of the item: 'video', 'audio', 'generator' or 'transition'
---@return string
function TimelineItem:GetType() end

--- Adds a transition of the given type/category to the start or end of this item. Returns the created transition item or None on failure.
---@param transitionOptions TransitionOptions
---@return TimelineItem?
function TimelineItem:AddTransition(transitionOptions) end

--- Returns the item name
---@return string
function TimelineItem:GetName() end

--- Sets the clip's name to name.
---@param name string
---@return boolean
function TimelineItem:SetName(name) end

--- Returns the start frame position on the timeline. Returns fractional frames if subframe_precision is True
---@param subframePrecision? boolean
---@return number
function TimelineItem:GetStart(subframePrecision) end

--- Returns the end frame position on the timeline. Returns fractional frames if subframe_precision is True
---@param subframePrecision? boolean
---@return number
function TimelineItem:GetEnd(subframePrecision) end

--- Returns the start frame position of the media pool clip in the timeline clip
---@return integer
function TimelineItem:GetSourceStartFrame() end

--- Returns the end frame position of the media pool clip in the timeline clip
---@return integer
function TimelineItem:GetSourceEndFrame() end

--- Returns the start time position of the media pool clip in the timeline clip
---@return number
function TimelineItem:GetSourceStartTime() end

--- Returns the end time position of the media pool clip in the timeline clip
---@return number
function TimelineItem:GetSourceEndTime() end

--- Returns the item duration. Returns fractional frames if subframe_precision is True
---@param subframePrecision? boolean
---@return number
function TimelineItem:GetDuration(subframePrecision) end

--- Returns the maximum extension by frame for clip from left side. Returns fractional frames if subframe_precision is True
---@param subframePrecision? boolean
---@return number
function TimelineItem:GetLeftOffset(subframePrecision) end

--- Returns the maximum extension by frame for clip from right side. Returns fractional frames if subframe_precision is True
---@param subframePrecision? boolean
---@return number
function TimelineItem:GetRightOffset(subframePrecision) end

--- Returns number of Fusion compositions associated with the timeline item
---@return integer
function TimelineItem:GetFusionCompCount() end

--- Returns a list of Fusion composition names associated with the timeline item
---@return string[]
function TimelineItem:GetFusionCompNameList() end

--- Returns the Fusion composition object based on given index. 1 <= compIndex <= timelineItem.GetFusionCompCount()
---@param compIndex integer
---@return FusionComp?
function TimelineItem:GetFusionCompByIndex(compIndex) end

--- Returns the Fusion composition object based on given name
---@param compName string
---@return FusionComp?
function TimelineItem:GetFusionCompByName(compName) end

--- Adds a new Fusion composition associated with the timeline item
---@return FusionComp
function TimelineItem:AddFusionComp() end

--- Returns the media pool item corresponding to the timeline item if one exists
---@return MediaPoolItem?
function TimelineItem:GetMediaPoolItem() end

--- Creates a new marker at given frameId position and with given marker information. 'customData' is optional and helps to attach user specific data to the marker
---@param frameId integer
---@param color MarkerColor
---@param name string
---@param note string
---@param duration integer
---@param customData? string
---@return boolean
function TimelineItem:AddMarker(frameId, color, name, note, duration, customData) end

--- Deletes all markers of the specified color from the timeline item. 'All' as argument deletes all color markers
---@param color MarkerColor|"All"
---@return boolean
function TimelineItem:DeleteMarkersByColor(color) end

--- Deletes marker at frame number from the timeline item
---@param frameNum integer
---@return boolean
function TimelineItem:DeleteMarkerAtFrame(frameNum) end

--- Deletes first matching marker with specified customData
---@param customData string
---@return boolean
function TimelineItem:DeleteMarkerByCustomData(customData) end

--- Returns a dict (frameId -> {information}) of all markers and dicts with their information
---@return table<integer, MarkerInfo>
function TimelineItem:GetMarkers() end

--- Returns marker {information} for the first matching marker with specified customData
---@param customData string
---@return MarkerInfo
function TimelineItem:GetMarkerByCustomData(customData) end

--- Updates customData (string) for the marker at given frameId position. CustomData is not exposed via UI and is useful for scripting developer to attach any user specific data to markers
---@param frameId integer
---@param customData string
---@return boolean
function TimelineItem:UpdateMarkerCustomData(frameId, customData) end

--- Returns customData string for the marker at given frameId position
---@param frameId integer
---@return string
function TimelineItem:GetMarkerCustomData(frameId) end

--- Sets the item properties with specified dict of property keys and values. See README.md section 'Looking up Timeline item properties'.
---@param properties TimelineItemProperties
---@return boolean
function TimelineItem:SetProperties(properties) end

--- Returns a dict with all supported item properties. See README.md section 'Looking up Timeline item properties'.
---@return TimelineItemProperties
function TimelineItem:GetProperties() end

--- Sets the Clip Speed
---@param speedOptions SpeedOptions
---@return boolean
function TimelineItem:SetSpeed(speedOptions) end

--- Returns the clip speed options
---@return SpeedOptions
function TimelineItem:GetSpeed() end

--- Adds a flag with given color (string)
---@param color FlagColor
---@return boolean
function TimelineItem:AddFlag(color) end

--- Returns a list of flag colors assigned to the item
---@return string[]
function TimelineItem:GetFlagList() end

--- Clears flags of the specified color. An 'All' argument is supported to clear all flags
---@param color FlagColor|"All"
---@return boolean
function TimelineItem:ClearFlags(color) end

--- Returns a dict (offset -> value) of keyframe offsets and respective convergence values
---@return table<integer, number>
function TimelineItem:GetStereoConvergenceValues() end

--- For the LEFT eye -> returns a dict (offset -> dict) of keyframe offsets and respective floating window params
---@return table<integer, FloatingWindowParams>
function TimelineItem:GetStereoLeftFloatingWindowParams() end

--- For the RIGHT eye -> returns a dict (offset -> dict) of keyframe offsets and respective floating window params
---@return table<integer, FloatingWindowParams>
function TimelineItem:GetStereoRightFloatingWindowParams() end

--- Returns the item color as a string
---@return ClipColor|string
function TimelineItem:GetClipColor() end

--- Sets the item color based on the colorName (string)
---@param colorName ClipColor
---@return boolean
function TimelineItem:SetClipColor(colorName) end

--- Clears the item color
---@return boolean
function TimelineItem:ClearClipColor() end

--- Imports a Fusion composition from given file path by creating and adding a new composition for the item
---@param path string
---@return FusionComp
function TimelineItem:ImportFusionComp(path) end

--- Exports the Fusion composition based on given index to the path provided
---@param path string
---@param compIndex integer
---@return boolean
function TimelineItem:ExportFusionComp(path, compIndex) end

--- Deletes the named Fusion composition
---@param compName string
---@return boolean
function TimelineItem:DeleteFusionCompByName(compName) end

--- Loads the named Fusion composition as the active composition
---@param compName string
---@return FusionComp
function TimelineItem:LoadFusionCompByName(compName) end

--- Renames the Fusion composition identified by oldName
---@param oldName string
---@param newName string
---@return boolean
function TimelineItem:RenameFusionCompByName(oldName, newName) end

--- Renames the color version identified by oldName and versionType (0 - local, 1 - remote)
---@param oldName string
---@param newName string
---@param versionType integer
---@return boolean
function TimelineItem:RenameVersionByName(oldName, newName, versionType) end

--- Deletes a color version by name and versionType (0 - local, 1 - remote)
---@param versionName string
---@param versionType integer
---@return boolean
function TimelineItem:DeleteVersionByName(versionName, versionType) end

--- Loads a named color version as the active version. versionType: 0 - local, 1 - remote
---@param versionName string
---@param versionType integer
---@return boolean
function TimelineItem:LoadVersionByName(versionName, versionType) end

--- Adds a new color version for a video clip based on versionType (0 - local, 1 - remote)
---@param versionName string
---@param versionType integer
---@return boolean
function TimelineItem:AddVersion(versionName, versionType) end

--- Returns a list of all color versions for the given versionType (0 - local, 1 - remote)
---@param versionType integer
---@return string[]
function TimelineItem:GetVersionNameList(versionType) end

--- Sets CDL values on the node. Keys of map are: 'NodeIndex', 'Slope', 'Offset', 'Power', 'Saturation'
---@param cdl CDL
---@return boolean
function TimelineItem:SetCDL(cdl) end

--- Adds mediaPoolItem as a new take. Initializes a take selector for the timeline item if needed. By default, the full clip extents is added. startFrame and endFrame are optional arguments used to specify the extents
---@param mediaPoolItem MediaPoolItem
---@param startFrame? integer
---@param endFrame? integer
---@return boolean
function TimelineItem:AddTake(mediaPoolItem, startFrame, endFrame) end

--- Returns the index of the currently selected take, or 0 if the clip is not a take selector
---@return integer
function TimelineItem:GetSelectedTakeIndex() end

--- Returns the number of takes in take selector, or 0 if the clip is not a take selector
---@return integer
function TimelineItem:GetTakesCount() end

--- Returns a dict with take info for specified index
---@param idx integer
---@return TakeInfo?
function TimelineItem:GetTakeByIndex(idx) end

--- Deletes a take by index, 1 <= idx <= number of takes
---@param idx integer
---@return boolean
function TimelineItem:DeleteTakeByIndex(idx) end

--- Selects a take by index, 1 <= idx <= number of takes
---@param idx integer
---@return boolean
function TimelineItem:SelectTakeByIndex(idx) end

--- Finalizes take selection
---@return boolean
function TimelineItem:FinalizeTake() end

--- Copies the current node stack layer grade to the same layer for each item in tgtTimelineItems.
---@param tgtTimelineItems TimelineItem[]
---@return boolean
function TimelineItem:CopyGrades(tgtTimelineItems) end

--- Gets clip enabled status
---@return boolean
function TimelineItem:GetClipEnabled() end

--- Sets clip enabled based on argument
---@param enabled boolean
---@return boolean
function TimelineItem:SetClipEnabled(enabled) end

--- Returns the current version of the video clip. The returned value will have the keys versionName and versionType (0 - local, 1 - remote)
---@return VersionInfo
function TimelineItem:GetCurrentVersion() end

--- Updates sidecar file for BRAW clips or RMD file for R3D clips
---@return boolean
function TimelineItem:UpdateSidecar() end

--- Returns a unique ID for the timeline item
---@return string
function TimelineItem:GetUniqueId() end

--- Loads user defined data burn in preset for clip when supplied presetName (string).
---@param presetName string
---@return boolean
function TimelineItem:LoadBurnInPreset(presetName) end

--- Creates a magic mask. mode can be 'F' (forward), 'B' (backward), or 'BI' (bidirectional)
---@param mode string
---@return boolean
function TimelineItem:CreateMagicMask(mode) end

--- Regenerates the magic mask
---@return boolean
function TimelineItem:RegenerateMagicMask() end

--- Performs stabilization on the clip
---@return boolean
function TimelineItem:Stabilize() end

--- Performs Smart Reframe.
---@return boolean
function TimelineItem:SmartReframe() end

--- Returns the clip's node graph object at layerIdx (int, optional). Returns the first layer if layerIdx is skipped. 1 <= layerIdx <= project.GetSetting('nodeStackLayers')
---@param layerIdx? integer
---@return Graph
function TimelineItem:GetNodeGraph(layerIdx) end

--- Returns the clip's color group if one exists
---@return ColorGroup?
function TimelineItem:GetColorGroup() end

--- Assigns the clip to the given ColorGroup. ColorGroup must be an existing group in the current project
---@param colorGroup ColorGroup
---@return boolean
function TimelineItem:AssignToColorGroup(colorGroup) end

--- Removes the clip from its ColorGroup
---@return boolean
function TimelineItem:RemoveFromColorGroup() end

--- Exports a LUT of the size given by 'exportType', saving it in the provided 'path'
---@param exportType ExportLutType
---@param path string
---@return boolean
function TimelineItem:ExportLUT(exportType, path) end

--- Returns a list of linked timeline items
---@return TimelineItem[]
function TimelineItem:GetLinkedItems() end

--- Returns a list of two values that correspond to the TimelineItem's trackType (string) and trackIndex (int) respectively
---@return (string|integer)[]
function TimelineItem:GetTrackTypeAndIndex() end

--- Returns a string with TimelineItem's audio mapping information
---@return string
function TimelineItem:GetSourceAudioChannelMapping() end

--- Sets source audio channel mapping from a JSON string.
---@param audioMapping string
---@return boolean
function TimelineItem:SetSourceAudioChannelMapping(audioMapping) end

--- Returns if the cache corresponding to cache_type is enabled
---@return boolean
function TimelineItem:GetIsColorOutputCacheEnabled() end

--- Returns if the cache corresponding to cache_type is enabled (or auto)
---@return string
function TimelineItem:GetIsFusionOutputCacheEnabled() end

--- Sets caching to enabled or disabled. Equivalent to clip context menu action 'Render Cache Color Output'
---@param enabled boolean
---@return boolean
function TimelineItem:SetColorOutputCache(enabled) end

--- Sets caching to auto, enabled or disabled. Equivalent to clip context menu action 'Render Cache Fusion Output'
---@param cacheValue string
---@return boolean
function TimelineItem:SetFusionOutputCache(cacheValue) end

--- Returns the Voice Isolation State as a dict {isEnabled, amount}, of the timelineItem
---@return VoiceIsolationState
function TimelineItem:GetVoiceIsolationState() end

--- Sets Voice Isolation state of the timelineItem to the given VoiceIsolationState of {isEnabled (bool), amount (int)}. amount is in range of [0, 100].
---@param state VoiceIsolationState
---@return boolean
function TimelineItem:SetVoiceIsolationState(state) end

--- Resets node color for all nodes in the active version of the clip.
---@return boolean
function TimelineItem:ResetAllNodeColors() end

--- Sets the output blanking for the clip. Accepts a dictionary with keys 'Top', 'Bottom', 'Left' and 'Right'. The values are in pixels.
---@param outputBlanking OutputBlanking
---@return boolean
function TimelineItem:SetOutputBlanking(outputBlanking) end

--- Returns the output blanking for the clip as a dictionary with keys 'Top', 'Bottom', 'Left' and 'Right'. The values are in pixels. The dictionary will be empty if the timeline's output blanking is used.
---@return OutputBlanking
function TimelineItem:GetOutputBlanking() end

--- Sets the flag to use the timeline's output blanking for the clip.
---@param useTimelineOutputBlanking boolean
---@return boolean
function TimelineItem:SetUseTimelineForOutputBlanking(useTimelineOutputBlanking) end

--- Gets the flag to use the timeline's output blanking for the clip.
---@return boolean
function TimelineItem:GetUseTimelineForOutputBlanking() end

--- Performs Multicam SmartSwitch on the multicam TimelineItem using the given smartSwitchSettings
---@param smartSwitchSettings SmartSwitchSettings
---@return boolean
function TimelineItem:PerformMulticamSmartSwitch(smartSwitchSettings) end

--- Flattens the multicam TimelineItem, using the grade source specified by gradeOption
---@param gradeOption FlattenMulticamGrade
---@return boolean
function TimelineItem:FlattenMulticam(gradeOption) end

--- Returns a dict {FadeIn, FadeOut} of the fade durations (in frames) for the item's video or audio fader
---@return FadeInfo
function TimelineItem:GetFades() end

--- Sets the fade durations (in frames) for the item's video or audio fader from a dict {FadeIn, FadeOut}
---@param fades FadeInfo
---@return boolean
function TimelineItem:SetFades(fades) end

---@deprecated Returns a dict of Fusion composition names associated with the timeline item. (README "Deprecated Resolve API Functions")
---@param ... any
---@return any
function TimelineItem:GetFusionCompNames(...) end

---@deprecated Returns a dict of flag colors assigned to the item. (README "Deprecated Resolve API Functions")
---@param ... any
---@return any
function TimelineItem:GetFlags(...) end

---@deprecated Returns a dict of version names by provided versionType: 0 - local, 1 - remote. (README "Deprecated Resolve API Functions")
---@param ... any
---@return any
function TimelineItem:GetVersionNames(...) end

---@deprecated Returns the number of nodes in the current graph for the timeline item (README "Deprecated Resolve API Functions")
---@param ... any
---@return any
function TimelineItem:GetNumNodes(...) end

---@deprecated Sets LUT on the node mapping the node index provided, 1 <= nodeIndex <= total number of nodes. (README "Deprecated Resolve API Functions")
---@param ... any
---@return any
function TimelineItem:SetLUT(...) end

---@deprecated Gets relative LUT path based on the node index provided, 1 <= nodeIndex <= total number of nodes. (README "Deprecated Resolve API Functions")
---@param ... any
---@return any
function TimelineItem:GetLUT(...) end

---@deprecated Returns the label of the node at nodeIndex. (README "Deprecated Resolve API Functions")
---@param ... any
---@return any
function TimelineItem:GetNodeLabel(...) end

---@deprecated Use GetProperties(), which returns a dict of all supported item properties, and index into the result. (README "Deprecated Calling Conventions")
---@param ... any
---@return any
function TimelineItem:GetProperty(...) end

---@deprecated Use SetProperties({properties}); for single keys SetProperties({ZoomX = 2.0}). (README "Deprecated Calling Conventions")
---@param ... any
---@return any
function TimelineItem:SetProperty(...) end

--- A group of clips sharing a pre-clip and a post-clip grade.
---@class ColorGroup
local ColorGroup = {}

--- Returns the name of the ColorGroup
---@return string
function ColorGroup:GetName() end

--- Renames ColorGroup to groupName
---@param groupName string
---@return boolean
function ColorGroup:SetName(groupName) end

--- Returns a list of TimelineItems in the ColorGroup for the given Timeline
---@param timeline? Timeline
---@return TimelineItem[]
function ColorGroup:GetClipsInTimeline(timeline) end

--- Returns the ColorGroup Pre-clip graph
---@return Graph
function ColorGroup:GetPreClipNodeGraph() end

--- Returns the ColorGroup Post-clip graph
---@return Graph
function ColorGroup:GetPostClipNodeGraph() end

--- A media pool folder: its clips, its subfolders and their analysis.
---@class Folder
local Folder = {}

--- Returns the media folder name
---@return string
function Folder:GetName() end

--- Returns a list of subfolders in the folder
---@return Folder[]
function Folder:GetSubFolderList() end

--- Returns a list of clips (items) within the folder
---@return MediaPoolItem[]
function Folder:GetClipList() end

--- Returns true if folder is stale in collaboration mode
---@return boolean
function Folder:GetIsFolderStale() end

--- Returns a unique ID for the media pool folder
---@return string
function Folder:GetUniqueId() end

--- Exports the folder as a DRB file to filePath
---@param filePath string
---@return boolean
function Folder:Export(filePath) end

--- Transcribes audio of the MediaPoolItems within the folder and nested folders.
---@param useSpeakerDetection? boolean
---@param transcribeAsNestedClip? boolean
---@return boolean
function Folder:TranscribeAudio(useSpeakerDetection, transcribeAsNestedClip) end

--- Clears audio transcription of the MediaPoolItems within the folder and nested folders.
---@return boolean
function Folder:ClearTranscription() end

--- Analyzes and classifies the audio of the MediaPoolItems within the folder and nested folders into categories and subcategories
---@return boolean
function Folder:PerformAudioClassification() end

--- Clears audio classification of the MediaPoolItems within the folder and nested folders
---@return boolean
function Folder:ClearAudioClassification() end

--- Apply Motion Deblur on MediaPoolItems in Folder, Returns a list of original to newly created MediaPoolItems
---@param deblurOption? DeblurOptions
---@return MediaPoolItem[][]
function Folder:RemoveMotionBlur(deblurOption) end

--- Perform Intellisearch analysis to all the MediaPoolItems in the folder.
---@param identifyFaces boolean
---@param isBetterMode boolean
---@return boolean
function Folder:AnalyzeForIntellisearch(identifyFaces, isBetterMode) end

--- Perform Slate analysis with current settings and use the stated markerColor to all the MediaPoolItems in the folder.
---@param markerColor SlateMarkerColor
---@return boolean
function Folder:AnalyzeForSlate(markerColor) end

---@deprecated Returns a dict of clips (items) within the folder. (README "Deprecated Resolve API Functions")
---@param ... any
---@return any
function Folder:GetClips(...) end

---@deprecated Returns a dict of subfolders in the folder. (README "Deprecated Resolve API Functions")
---@param ... any
---@return any
function Folder:GetSubFolders(...) end

--- The gallery of a project: its still albums and PowerGrade albums.
---@class Gallery
local Gallery = {}

--- Returns the name of a GalleryStillAlbum object
---@param galleryStillAlbum GalleryStillAlbum
---@return string
function Gallery:GetAlbumName(galleryStillAlbum) end

--- Sets the name of a GalleryStillAlbum object
---@param galleryStillAlbum GalleryStillAlbum
---@param albumName string
---@return boolean
function Gallery:SetAlbumName(galleryStillAlbum, albumName) end

--- Returns current album as a GalleryStillAlbum object
---@return GalleryStillAlbum
function Gallery:GetCurrentStillAlbum() end

--- Sets current album to the given GalleryStillAlbum object
---@param galleryStillAlbum GalleryStillAlbum
---@return boolean
function Gallery:SetCurrentStillAlbum(galleryStillAlbum) end

--- Creates a new gallery still album
---@return GalleryStillAlbum
function Gallery:CreateGalleryStillAlbum() end

--- Creates a new gallery power grade album
---@return GalleryStillAlbum
function Gallery:CreateGalleryPowerGradeAlbum() end

--- Returns the gallery still albums as a list of GalleryStillAlbum objects
---@return GalleryStillAlbum[]
function Gallery:GetGalleryStillAlbums() end

--- Returns the gallery PowerGrade albums as a list of GalleryStillAlbum objects
---@return GalleryStillAlbum[]
function Gallery:GetGalleryPowerGradeAlbums() end

--- A still of a gallery album, used as a handle by the GalleryStillAlbum functions.
---@class GalleryStill
---@field [string] fun(...): any  -- opaque in the .pyi (no methods declared)

--- An album of gallery stills, which can be labelled, imported and exported.
---@class GalleryStillAlbum
local GalleryStillAlbum = {}

--- Returns the list of GalleryStill objects in the album
---@return GalleryStill[]
function GalleryStillAlbum:GetStills() end

--- Returns the label of the galleryStill
---@param galleryStill GalleryStill
---@return string
function GalleryStillAlbum:GetLabel(galleryStill) end

--- Sets the new label to a GalleryStill object
---@param galleryStill GalleryStill
---@param label string
---@return boolean
function GalleryStillAlbum:SetLabel(galleryStill, label) end

--- Imports GalleryStill from each filePath in the list
---@param filePaths string[]
---@return boolean
function GalleryStillAlbum:ImportStills(filePaths) end

--- Exports list of GalleryStill objects to a directory
---@param galleryStill GalleryStill[]
---@param folderPath string
---@param filePrefix string
---@param format string
---@return boolean
function GalleryStillAlbum:ExportStills(galleryStill, folderPath, filePrefix, format) end

--- Deletes specified list of GalleryStill objects
---@param galleryStill GalleryStill[]
---@return boolean
function GalleryStillAlbum:DeleteStills(galleryStill) end

--- The node graph of a clip or of a color group: its nodes, LUTs and grades. See README.md section 'Cache Mode information'.
---@class Graph
local Graph = {}

--- Returns the number of nodes in the graph
---@return integer
function Graph:GetNumNodes() end

--- Sets LUT on the node mapping the node index provided, 1 <= nodeIndex <= GetNumNodes()
---@param nodeIndex integer
---@param lutPath string
---@return boolean
function Graph:SetLUT(nodeIndex, lutPath) end

--- Gets relative LUT path based on the node index provided, 1 <= nodeIndex <= GetNumNodes()
---@param nodeIndex integer
---@return string
function Graph:GetLUT(nodeIndex) end

--- Sets the cache mode type on the node mapping the node index provided
---@param nodeIndex integer
---@param cacheValue CacheMode
---@return boolean
function Graph:SetNodeCacheMode(nodeIndex, cacheValue) end

--- Returns the cache mode type on the node mapping the node index provided
---@param nodeIndex integer
---@return integer
function Graph:GetNodeCacheMode(nodeIndex) end

--- Returns the label of the node at nodeIndex
---@param nodeIndex integer
---@return string
function Graph:GetNodeLabel(nodeIndex) end

--- Returns toolsList of the tools used in the node indicated by given nodeIndex
---@param nodeIndex integer
---@return string[]
function Graph:GetToolsInNode(nodeIndex) end

--- Sets the node at the given nodeIndex to isEnabled, 1 <= nodeIndex <= GetNumNodes()
---@param nodeIndex integer
---@param isEnabled boolean
---@return boolean
function Graph:SetNodeEnabled(nodeIndex, isEnabled) end

--- Applies ARRI CDL and LUT.
---@return boolean
function Graph:ApplyArriCdlLut() end

--- Loads a still from given file path and applies grade to graph with gradeMode (0=No keyframes, 1=Source Timecode aligned, 2=Start Frames aligned)
---@param path string
---@param gradeMode integer
---@return boolean
function Graph:ApplyGradeFromDRX(path, gradeMode) end

--- Resets all grades in the graph
---@return boolean
function Graph:ResetAllGrades() end

--- Browses the volumes of the file system and adds media files to the media pool.
---@class MediaStorage
local MediaStorage = {}

--- Returns list of folder paths corresponding to mounted volumes displayed in Resolve's Media Storage
---@return string[]
function MediaStorage:GetMountedVolumeList() end

--- Returns list of folder paths in the given absolute folder path
---@param folderPath string
---@return string[]
function MediaStorage:GetSubFolderList(folderPath) end

--- Returns list of media and file listings in the given absolute folder path
---@param folderPath string
---@return string[]
function MediaStorage:GetFileList(folderPath) end

--- Expands and displays given file/folder path in Resolve's Media Storage
---@param path string
---@return boolean
function MediaStorage:RevealInStorage(path) end

--- Adds specified file/folder paths from Media Storage into current Media Pool folder. Returns a list of the MediaPoolItems created
---@param itemInfos MediaStorageItemInfo[]
---@return MediaPoolItem[]
function MediaStorage:AddItemListToMediaPool(itemInfos) end

--- Adds specified media files as mattes for the specified MediaPoolItem. stereoEye is 'left' or 'right' for stereo clips
---@param mediaPoolItem MediaPoolItem
---@param paths string[]
---@param stereoEye? string
---@return boolean
function MediaStorage:AddClipMattesToMediaPool(mediaPoolItem, paths, stereoEye) end

--- Adds specified media files as timeline mattes in current media pool folder. Returns a list of created MediaPoolItems
---@param paths string[]
---@return MediaPoolItem[]
function MediaStorage:AddTimelineMattesToMediaPool(paths) end

--- Starts cloning media from sourceDir to targetDirs. Use SetCloneToolSettings to configure PreserveFolderName/ChecksumType beforehand.
---@param sourceDir string
---@param targetDirs string|string[]
---@return boolean
function MediaStorage:StartCloneMedia(sourceDir, targetDirs) end

--- Sets the PreserveFolderName/ChecksumType options used by subsequent StartCloneMedia calls (and by the Clone Tool UI).
---@param cloneToolSettings? CloneToolSettings
---@return boolean
function MediaStorage:SetCloneToolSettings(cloneToolSettings) end

--- Stops the currently in-progress clone job started via StartCloneMedia. Returns False if no clone job is in progress.
---@return boolean
function MediaStorage:StopCloneMedia() end

--- Returns a dict with the status of the current (or most recently started) clone job
---@return CloneStatus
function MediaStorage:GetCloneStatus() end

---@deprecated Returns a dict of folder paths corresponding to mounted volumes displayed in Resolve's Media Storage. (README "Deprecated Resolve API Functions")
---@param ... any
---@return any
function MediaStorage:GetMountedVolumes(...) end

---@deprecated Returns a dict of folder paths in the given absolute folder path. (README "Deprecated Resolve API Functions")
---@param ... any
---@return any
function MediaStorage:GetSubFolders(...) end

---@deprecated Returns a dict of media and file listings in the given absolute folder path. Note that media listings may be logically consolidated entries. (README "Deprecated Resolve API Functions")
---@param ... any
---@return any
function MediaStorage:GetFiles(...) end

---@deprecated Adds specified file/folder paths from Media Storage into current Media Pool folder. Input is one or more file/folder paths. Returns a dict of the MediaPoolItems created. (README "Deprecated Resolve API Functions")
---@param ... any
---@return any
function MediaStorage:AddItemsToMediaPool(...) end

---@class FusionComp
---@field [string] fun(...): any  -- opaque in the .pyi (no methods declared)

-- Globals: `resolve` is injected by the host; `Resolve()` is the shipped examples' form and
-- returns a proxy that is not == the global (measured in Step 1).
---@type Resolve
resolve = ResolveClass

---@return Resolve?
function Resolve() end
-- END GENERATED

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

---@deprecated Never call from the bridge: it takes Fusion's shared script executor for the whole session (project safety rule).
---@param script string
function fusion:Execute(script) end

---@deprecated Never call from the bridge: same executor as Execute (project safety rule).
---@param script string
function fusion:RunScript(script, ...) end

---@type Fusion
fu = fusion

---@type Fusion
app = fusion
