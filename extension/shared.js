// Shared by the popup, the background worker (importScripts) and the content script, so the three always agree.

/** Predefined file types, grouped the way people think about them. */
var FLOWGET_FILE_GROUPS = [
  { id: "archives", label: "Archives & disk images", types: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "img"] },
  { id: "programs", label: "Programs & installers", types: ["exe", "msi", "apk", "dmg", "pkg", "deb", "rpm"] },
  { id: "video", label: "Video", types: ["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v"] },
  { id: "audio", label: "Audio", types: ["mp3", "flac", "wav", "aac", "m4a", "ogg"] },
  { id: "documents", label: "Documents", types: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "epub"] },
  { id: "other", label: "Other", types: ["bin", "torrent"] },
];

/** What is captured out of the box: big downloads people want in a download manager. */
var FLOWGET_DEFAULT_TYPES = [
  "zip", "rar", "7z", "tar", "gz", "bz2", "iso",
  "exe", "msi", "apk", "dmg", "pkg",
  "mp4", "mkv", "mp3", "pdf", "bin",
];

var FLOWGET_DEFAULTS = {
  enabled: true,
  autoSuggestBarEnabled: true,
  autoLaunch: true, // start FlowGet when something is grabbed while it is closed
  notifyOnStart: true, // a desktop notification when FlowGet starts a download
  fileTypes: FLOWGET_DEFAULT_TYPES,
  minSizeBytes: 0,
};
