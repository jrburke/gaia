{
  "baseUrl": "../js",
  "mainConfigFile": "../js/mail-app.js",
  "out": "../js/mail-app-built.js",
/*
  "wrap": {
    "start": "var _xstart = performance.now(); var _fromStart = _xstart - performance.timing.fetchStart;",
    "end": "console.log('@@@@@@@TOP: ' + _xstart);console.log('@@@@@@@@BOTTOM: ' + (performance.now() - _xstart));"
  },
*/
  "include": ["alameda", "l10nbase", "l10ndate", "tmpl", "text", "value_selector",
              "folder_depth_classes", "mail-app"],
  "optimize": "none"
}
