{
  "baseUrl": "../../apps/email/js",
  "mainConfigFile": "../../apps/email/js/mail-app.js",
  "out": "../../apps/email/js/mail-app-built.js",
/*
  "wrap": {
    "start": "var _xstart = performance.now(); var _fromStart = _xstart - performance.timing.fetchStart;",
    "end": "console.log('@@@@@@@TOP: ' + _xstart);console.log('@@@@@@@@BOTTOM: ' + (performance.now() - _xstart));"
  },
*/
  "include": ["css", "tmpl", "text", "value_selector", "folder_depth_classes", "mail-app", "cards/setup-account-info"],
  "optimize": "none"
}
