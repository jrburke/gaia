{
  baseUrl: '../js',
  out: '../../../build_stage/email/js/ext/main-frame-setup.js',

  optimize: 'none',

  name: 'ext/main-frame-setup',

  paths: {
    app_logic: 'api_app_logic',
    logic: 'ext/logic',
    gelam: 'ext'
  },

  exclude: ['evt']
}
